/**
 * Copies this store's data to a FlexPOS Cloud server (the vendor's or the store's own) so managers
 * can see the dashboard on the web. The POS never depends on it: selling works offline, changes
 * wait in sync_outbox (filled by DB triggers) and are pushed when the cloud is reachable again.
 * Master-data edits made on the web come back as commands and are applied here.
 */
import { dropSyncTriggers, enqueueAll, installSyncTriggers, SYNC_EDITABLE, SYNC_REDACT, TABLE_COLUMNS } from '@flexpos/db';
import { t, type WsEvent } from '@flexpos/shared';
import type { AppContext } from '../context.js';
import type { CloudConfig } from '../config.js';
import { decryptSecret, encryptSecret } from '../config.js';
import { AppError, badRequest } from '../errors.js';
import { audit } from '../auth.js';
import { nowIso } from '../util.js';
import { VERSION } from '../context.js';
import type { LicenseService } from './license.js';

const INTERVAL_MS = 30_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const BATCH = 500;
const MAX_BODY = 12 * 1024 * 1024;
/** Bus events that mean data changed (customer-display updates do not). */
const DATA_EVENTS = new Set<WsEvent['type']>(['sale.completed', 'catalog.changed', 'settings.changed', 'orders.changed', 'kitchen.changed']);

export interface CloudStatus {
  mode: CloudConfig['mode'] | null;
  url: string | null;
  connected: boolean;
  tenantId: string | null;
  tenantName: string | null;
  account: string | null;
  pending: number;
  lastPushAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  online: boolean;
}

interface Command {
  seq: number;
  id: string;
  tbl: string;
  op: 'upsert' | 'delete';
  row_id: string;
  payload: Record<string, unknown>;
  created_by: string;
}

export class CloudSyncError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export class CloudSync {
  private timer: NodeJS.Timeout | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private failures = 0;
  private lastPushAt: string | null = null;
  private lastOkAt: string | null = null;
  private lastError: string | null = null;
  private started = false;
  private readonly onBus = (e: WsEvent) => {
    if (DATA_EVENTS.has(e.type)) this.schedule(2000);
  };

  constructor(
    private readonly ctx: AppContext,
    private readonly license: LicenseService,
  ) {}

  get cfg(): CloudConfig | undefined {
    return this.ctx.config.cloud;
  }

  private get connected(): boolean {
    const c = this.cfg;
    return !!c && c.mode !== 'local' && !!c.url && !!c.tokenEnc;
  }

  private token(): string {
    return decryptSecret(this.cfg!.tokenEnc!);
  }

  /** Begin background syncing when this machine is connected to a cloud. */
  async start(): Promise<void> {
    if (this.started || !this.connected || !this.ctx.conn) return;
    this.started = true;
    await installSyncTriggers(this.ctx.conn);
    this.ctx.bus.on('ws', this.onBus);
    this.schedule(1000);
  }

  stop(): void {
    this.started = false;
    this.ctx.bus.off('ws', this.onBus);
    if (this.timer) clearTimeout(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
    this.timer = this.debounce = null;
  }

  private schedule(ms: number) {
    if (!this.started) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.syncNow().catch(() => undefined), ms);
  }

  private planNext() {
    if (!this.started) return;
    if (this.timer) clearTimeout(this.timer);
    const wait = this.failures ? Math.min(INTERVAL_MS * 2 ** (this.failures - 1), MAX_BACKOFF_MS) : INTERVAL_MS;
    this.timer = setTimeout(() => void this.syncNow().catch(() => undefined), wait);
  }

  async status(): Promise<CloudStatus> {
    const c = this.cfg;
    let pending = 0;
    if (this.ctx.conn) {
      const r = await this.ctx.db.selectFrom('sync_outbox').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
      pending = Number(r?.n ?? 0);
    }
    return {
      mode: c?.mode ?? null,
      url: c?.url ?? null,
      connected: this.connected,
      tenantId: c?.tenantId ?? null,
      tenantName: c?.tenantName ?? null,
      account: c?.account ?? null,
      pending,
      lastPushAt: this.lastPushAt,
      lastOkAt: this.lastOkAt,
      lastError: this.lastError,
      online: !!this.lastOkAt && !this.lastError,
    };
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, opts: { url?: string; token?: string | null } = {}): Promise<T> {
    const base = (opts.url ?? this.cfg?.url ?? '').replace(/\/+$/, '');
    const token = opts.token === undefined ? this.token() : opts.token;
    let res: Response;
    try {
      res = await fetch(base + path, {
        method,
        headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new CloudSyncError(0, t('เชื่อมต่อเซิร์ฟเวอร์คลาวด์ไม่ได้ ({0})', (e as Error).message));
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* not json */
    }
    if (!res.ok) {
      const d = data as { message?: string; details?: unknown } | null;
      throw new CloudSyncError(res.status, d?.message ?? t('เซิร์ฟเวอร์คลาวด์ตอบกลับผิดพลาด ({0})', res.status), d?.details);
    }
    return data as T;
  }

  /**
   * Pair this POS with a store on the cloud, then queue the whole history for upload.
   * FlexPOS Cloud identifies the store by the license key; a store's own server by a manager account.
   */
  async connect(o: { mode: 'cloud' | 'self'; url: string; licenseKey?: string; username?: string; password?: string; tenantId?: string; deviceName: string; machineId: string }) {
    if (!this.ctx.conn) throw badRequest(t('ยังไม่ได้ตั้งค่าฐานข้อมูล'));
    const url = o.url.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^\s/]+/.test(url)) throw badRequest(t('ที่อยู่เซิร์ฟเวอร์ไม่ถูกต้อง ต้องขึ้นต้นด้วย https://'));
    let r: { deviceToken: string; deviceId: string; tenantId: string; tenantName: string; licenseKey: string | null };
    const device = { storeName: this.ctx.settings.store.name || 'FlexPOS', deviceName: o.deviceName, machineId: o.machineId, appVersion: VERSION };
    const body = o.mode === 'cloud' ? { licenseKey: o.licenseKey, ...device } : { username: o.username, password: o.password, tenantId: o.tenantId, ...device };
    try {
      r = await this.request('POST', '/api/sync/register', body, { url, token: null });
    } catch (e) {
      if (e instanceof CloudSyncError) throw new AppError(e.status === 0 ? 502 : e.status, 'cloud', e.message, e.details);
      throw e;
    }
    this.stop();
    this.ctx.config.cloud = { mode: o.mode, url, tokenEnc: encryptSecret(r.deviceToken), tenantId: r.tenantId, tenantName: r.tenantName, account: o.mode === 'self' ? (o.username ?? null) : null, deviceId: r.deviceId, connectedAt: nowIso() };
    this.ctx.store.save(this.ctx.config);
    this.applyLicense(r.licenseKey);
    // Triggers first, then a full snapshot: nothing written in between can be missed.
    await installSyncTriggers(this.ctx.conn);
    await this.ctx.db.deleteFrom('sync_outbox').execute();
    await enqueueAll(this.ctx.conn);
    this.failures = 0;
    this.lastError = null;
    await this.start();
    return { tenantId: r.tenantId, tenantName: r.tenantName };
  }

  /** Keep data on this machine only. */
  async setLocal(): Promise<void> {
    this.stop();
    this.ctx.config.cloud = { mode: 'local', url: null, tokenEnc: null, tenantId: null, tenantName: null, account: null, deviceId: null, connectedAt: null };
    this.ctx.store.save(this.ctx.config);
    if (this.ctx.conn) {
      await dropSyncTriggers(this.ctx.conn);
      await this.ctx.db.deleteFrom('sync_outbox').execute();
    }
    this.lastError = this.lastOkAt = this.lastPushAt = null;
  }

  /** Push pending changes, then pull and apply web edits. Safe to call any time. */
  syncNow(): Promise<void> {
    if (!this.connected || !this.ctx.conn) return Promise.resolve();
    if (!this.running) {
      this.running = this.cycle().finally(() => {
        this.running = null;
        this.planNext();
      });
    }
    return this.running;
  }

  private async cycle(): Promise<void> {
    try {
      let pushed = false;
      for (let i = 0; i < 40; i++) {
        const more = await this.pushBatch();
        pushed ||= more !== null;
        if (!more) break;
      }
      await this.pullCommands();
      if (!pushed) {
        const pending = (await this.status()).pending;
        this.applyLicense((await this.request<{ licenseKey?: string | null }>('POST', '/api/sync/heartbeat', { pending, appVersion: VERSION })).licenseKey);
      }
      this.failures = 0;
      this.lastError = null;
      this.lastOkAt = nowIso();
    } catch (e) {
      this.failures++;
      this.lastError = (e as Error).message;
      if (e instanceof CloudSyncError && e.status === 401) {
        // Device revoked on the web: stop until someone reconnects.
        this.lastError = t('เครื่องนี้ถูกยกเลิกการเชื่อมต่อจากเว็บ กรุณาเชื่อมต่อใหม่ที่หน้าตั้งค่า');
        this.stop();
      }
      throw e;
    }
  }

  /** @returns true if a full batch was sent (more may remain), false if the outbox is now empty, null if nothing to send */
  private async pushBatch(): Promise<boolean | null> {
    const db = this.ctx.db;
    let take = BATCH;
    for (;;) {
      const entries = await db.selectFrom('sync_outbox').select(['seq', 'tbl', 'row_id']).orderBy('seq').limit(take).execute();
      if (!entries.length) return null;
      const maxSeq = entries[entries.length - 1]!.seq;
      const byTable = new Map<string, Set<string>>();
      for (const e of entries) {
        if (!TABLE_COLUMNS[e.tbl]) continue;
        const s = byTable.get(e.tbl) ?? new Set<string>();
        s.add(e.row_id);
        byTable.set(e.tbl, s);
      }
      const tables: Record<string, { rows: Record<string, unknown>[]; deleted: string[] }> = {};
      for (const [tbl, idSet] of byTable) {
        const ids = [...idSet];
        const rows = (await db.selectFrom(tbl as never).selectAll().where('id' as never, 'in', ids as never).execute()) as Record<string, unknown>[];
        const found = new Set(rows.map((r) => String(r.id)));
        const redact = SYNC_REDACT[tbl] ?? [];
        for (const r of rows) for (const c of redact) r[c] = '';
        tables[tbl] = { rows, deleted: ids.filter((id) => !found.has(id)) };
      }
      const body = { tables, pending: 0, appVersion: VERSION };
      if (JSON.stringify(body).length > MAX_BODY && take > 1) {
        take = Math.max(1, Math.floor(take / 2)); // large rows (images): send fewer at a time
        continue;
      }
      const left = await db.selectFrom('sync_outbox').select((eb) => eb.fn.countAll<number>().as('n')).where('seq', '>', maxSeq).executeTakeFirst();
      body.pending = Number(left?.n ?? 0);
      this.applyLicense((await this.request<{ licenseKey?: string | null }>('POST', '/api/sync/push', body)).licenseKey);
      await db.deleteFrom('sync_outbox').where('seq', '<=', maxSeq).execute();
      this.lastPushAt = nowIso();
      return entries.length === take;
    }
  }

  /** The superadmin changed the license (e.g. more devices): install the re-signed key. */
  private applyLicense(key: string | null | undefined) {
    if (!key || key === this.license.key()) return;
    try {
      this.license.activate(key);
      this.ctx.emit({ type: 'settings.changed' });
    } catch (e) {
      console.warn('[flexpos] cloud license key rejected', e);
    }
  }

  private async pullCommands(): Promise<void> {
    const r = await this.request<{ commands: Command[] }>('GET', '/api/sync/commands?after=0');
    if (!r.commands.length) return;
    const results: { id: string; ok: boolean; error?: string }[] = [];
    let settingsChanged = false;
    for (const c of r.commands) {
      try {
        await this.apply(c);
        if (c.tbl === 'settings') settingsChanged = true;
        results.push({ id: c.id, ok: true });
      } catch (e) {
        results.push({ id: c.id, ok: false, error: (e as Error).message });
        // Send our real row back so the web copy is corrected.
        await this.ctx.db.insertInto('sync_outbox').values({ tbl: c.tbl, row_id: c.row_id }).execute().catch(() => undefined);
      }
    }
    await this.request('POST', '/api/sync/commands/ack', { results });
    if (settingsChanged) {
      await this.ctx.reloadSettings();
      this.ctx.emit({ type: 'settings.changed' });
    }
    this.ctx.emit({ type: 'catalog.changed' });
  }

  private async apply(c: Command): Promise<void> {
    if (!SYNC_EDITABLE.includes(c.tbl)) throw new Error(t('ตารางนี้แก้ไขจากเว็บไม่ได้'));
    const cols = TABLE_COLUMNS[c.tbl]!;
    const names = new Set(cols.map((x) => x.name));
    await this.ctx.db.transaction().execute(async (tx) => {
      const table = c.tbl as never;
      if (c.op === 'delete') {
        await tx.deleteFrom(table).where('id' as never, '=', c.row_id as never).execute();
      } else {
        const row = Object.fromEntries(Object.entries(c.payload).filter(([k]) => names.has(k)));
        row.id = c.row_id;
        const exists = await tx.selectFrom(table).select('id' as never).where('id' as never, '=', c.row_id as never).executeTakeFirst();
        if (exists) {
          const { id: _id, ...set } = row;
          await tx.updateTable(table).set(set as never).where('id' as never, '=', c.row_id as never).execute();
        } else {
          for (const col of cols) if (row[col.name] === undefined && !col.nullable) throw new Error(t('ข้อมูลไม่ครบ: {0}', col.name));
          await tx.insertInto(table).values(row as never).execute();
        }
      }
      await audit(this.ctx, tx, null, `cloud.${c.op}`, c.tbl, c.row_id, { by: c.created_by }, { id: '', name: `web: ${c.created_by}` });
    });
  }
}
