import { EventEmitter } from 'node:events';
import type { Kysely, Transaction } from 'kysely';
import { connect, migrate, type Database, type DB } from '@flexpos/db';
import { DEFAULT_SETTINGS, mergeSettings, type Settings, type WsEvent, t, setLanguage } from '@flexpos/shared';
import { ConfigStore, dbFromEnv, type AppConfig, type StoredDbConfig } from './config.js';
import { AppError } from './errors.js';
import { nowIso, parseJson } from './util.js';

export type Tx = Transaction<DB> | Kysely<DB>;

export const VERSION = '1.0.0';

export class AppContext {
  readonly store: ConfigStore;
  config: AppConfig;
  conn: Database | null = null;
  settings: Settings = DEFAULT_SETTINGS;
  readonly bus = new EventEmitter();
  readonly webDir: string | null;
  defaultBranchId: string | null = null;

  constructor(opts: { dataDir: string; webDir?: string | null }) {
    this.store = new ConfigStore(opts.dataDir);
    this.config = this.store.load();
    this.webDir = opts.webDir ?? null;
    this.bus.setMaxListeners(200);
    const envDb = dbFromEnv();
    if (envDb) this.config.db = envDb;
  }

  get dataDir(): string {
    return this.store.dataDir;
  }

  get db(): Kysely<DB> {
    if (!this.conn) throw new AppError(503, 'not_configured', t('ยังไม่ได้ตั้งค่าฐานข้อมูล กรุณาทำตัวช่วยตั้งค่าร้านให้เสร็จ'));
    return this.conn.db;
  }

  get dialect() {
    if (!this.conn) throw new AppError(503, 'not_configured', t('ยังไม่ได้ตั้งค่าฐานข้อมูล'));
    return this.conn.dialect;
  }

  async openDb(stored: StoredDbConfig | null = this.config.db): Promise<void> {
    if (!stored) return;
    if (this.conn) await this.conn.close();
    this.conn = await connect(this.store.toConnection(stored));
    await migrate(this.conn);
    await this.reloadSettings();
    const b = await this.conn.db.selectFrom('branches').select('id').orderBy('created_at').executeTakeFirst();
    this.defaultBranchId = b?.id ?? null;
  }

  async reloadSettings(): Promise<Settings> {
    const row = await this.db.selectFrom('settings').select('data').where('id', '=', 'app').executeTakeFirst();
    this.settings = mergeSettings(DEFAULT_SETTINGS, parseJson(row?.data, {}));
    setLanguage(this.settings.locale.language);
    return this.settings;
  }

  async saveSettings(next: Settings, tx: Tx = this.db): Promise<void> {
    const data = JSON.stringify(next);
    const exists = await tx.selectFrom('settings').select('id').where('id', '=', 'app').executeTakeFirst();
    if (exists) await tx.updateTable('settings').set({ data, updated_at: nowIso() }).where('id', '=', 'app').execute();
    else await tx.insertInto('settings').values({ id: 'app', data, updated_at: nowIso() }).execute();
    this.settings = next;
    setLanguage(next.locale.language);
    this.emit({ type: 'settings.changed' });
  }

  emit(e: WsEvent): void {
    this.bus.emit('ws', e);
  }

  async close(): Promise<void> {
    if (this.conn) await this.conn.close();
    this.conn = null;
  }
}
