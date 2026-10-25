import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { TABLE_NAMES, type DB } from '@flexpos/db';
import type { AppContext } from '../context.js';
import { VERSION } from '../context.js';
import { chunk } from '../util.js';
import { invalidateUserCache } from '../auth.js';
import { bumpCatalog } from './catalog.js';

interface BackupFile {
  app: 'flexpos';
  version: string;
  createdAt: string;
  dialect: string;
  tables: Record<string, Record<string, unknown>[]>;
}

const SKIP = new Set(['idempotency', 'refresh_tokens']);
type TableName = keyof DB;

/**
 * Backups are portable gzipped JSON of every table, so they restore into any supported
 * database (e.g. move from local SQLite to the shop's PostgreSQL).
 */
export class BackupService {
  private timer: NodeJS.Timeout | null = null;
  constructor(private readonly ctx: AppContext) {}

  defaultDir(): string {
    return join(this.ctx.dataDir, 'backups');
  }

  /** The chosen folder, or the program's own folder when the chosen drive is unavailable (e.g. USB unplugged). */
  dir(): string {
    const chosen = this.ctx.settings.backup.dir;
    if (chosen) {
      try {
        mkdirSync(chosen, { recursive: true });
        return chosen;
      } catch {
        /* fall through */
      }
    }
    const d = this.defaultDir();
    mkdirSync(d, { recursive: true });
    return d;
  }

  usingFallback(): boolean {
    const chosen = this.ctx.settings.backup.dir;
    return !!chosen && this.dir() !== chosen;
  }

  async dump(): Promise<Buffer> {
    const tables: BackupFile['tables'] = {};
    for (const t of TABLE_NAMES) {
      if (SKIP.has(t)) continue;
      tables[t] = (await this.ctx.db.selectFrom(t as TableName).selectAll().execute()) as Record<string, unknown>[];
    }
    const data: BackupFile = { app: 'flexpos', version: VERSION, createdAt: new Date().toISOString(), dialect: this.ctx.dialect, tables };
    return gzipSync(Buffer.from(JSON.stringify(data)));
  }

  async create(reason: 'auto' | 'manual' | 'pre-restore' = 'manual'): Promise<{ file: string; size: number }> {
    const buf = await this.dump();
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const file = join(this.dir(), `flexpos-${reason}-${stamp}.json.gz`);
    writeFileSync(file, buf);
    this.prune();
    return { file, size: buf.length };
  }

  list() {
    const d = this.dir();
    return readdirSync(d)
      .filter((f) => f.startsWith('flexpos-') && f.endsWith('.json.gz'))
      .map((f) => {
        const s = statSync(join(d, f));
        return { name: f, size: s.size, createdAt: s.mtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  read(name: string): Buffer {
    if (!/^flexpos-[\w-]+\.json\.gz$/.test(name)) throw new Error('ชื่อไฟล์สำรองไม่ถูกต้อง');
    const f = join(this.dir(), name);
    if (!existsSync(f)) throw new Error('ไม่พบไฟล์สำรอง');
    return readFileSync(f);
  }

  prune() {
    const keep = this.ctx.settings.backup.keep;
    const autos = this.list().filter((b) => b.name.startsWith('flexpos-auto-'));
    for (const b of autos.slice(keep)) unlinkSync(join(this.dir(), b.name));
  }

  async restore(buf: Buffer): Promise<{ tables: number; rows: number }> {
    let data: BackupFile;
    try {
      data = JSON.parse(gunzipSync(buf).toString('utf8')) as BackupFile;
    } catch {
      throw new Error('ไฟล์สำรองเสียหายหรือไม่ใช่ไฟล์ของ FlexPOS');
    }
    if (data.app !== 'flexpos' || !data.tables) throw new Error('ไฟล์นี้ไม่ใช่ไฟล์สำรองของ FlexPOS');
    await this.create('pre-restore');
    let rows = 0;
    const db = this.ctx.db;
    await db.transaction().execute(async (tx) => {
      for (const t of TABLE_NAMES) {
        if (SKIP.has(t) || t === 'meta') continue;
        await tx.deleteFrom(t as TableName).execute();
      }
      for (const [t, list] of Object.entries(data.tables)) {
        if (!TABLE_NAMES.includes(t) || SKIP.has(t) || t === 'meta' || list.length === 0) continue;
        for (const part of chunk(list, 200)) {
          // Each table's rows come from the same schema version, so columns match.
          await tx.insertInto(t as TableName).values(part as never).execute();
          rows += part.length;
        }
      }
    });
    invalidateUserCache();
    await this.ctx.reloadSettings();
    const b = await db.selectFrom('branches').select('id').orderBy('created_at').executeTakeFirst();
    this.ctx.defaultBranchId = b?.id ?? null;
    bumpCatalog(this.ctx);
    return { tables: Object.keys(data.tables).length, rows };
  }

  start() {
    this.timer = setInterval(() => void this.tick(), 10 * 60_000);
    setTimeout(() => void this.tick(), 60_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (!this.ctx.conn || !this.ctx.settings.backup.auto) return;
    try {
      const last = this.list().find((b) => b.name.startsWith('flexpos-auto-'));
      const due = !last || Date.now() - new Date(last.createdAt).getTime() > this.ctx.settings.backup.intervalHours * 3600_000;
      if (due) await this.create('auto');
    } catch (e) {
      console.error('[backup] auto backup failed', e);
    }
  }
}
