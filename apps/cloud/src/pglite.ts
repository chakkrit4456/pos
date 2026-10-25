/**
 * Embedded PostgreSQL (PGlite) behind Kysely's PostgresDialect. PGlite has a single session, so
 * the fake pool hands out one connection at a time; code inside a transaction must use the trx.
 * Used for tests, development and very small self-hosted installs (DATABASE_URL=pglite:<dir>).
 */
import { Kysely, PostgresDialect } from 'kysely';
import { PGlite } from '@electric-sql/pglite';

export async function pgliteKysely<T>(dataDir?: string): Promise<{ db: Kysely<T>; close(): Promise<void> }> {
  const pg = new PGlite(dataDir);
  await pg.waitReady;
  let queue: Promise<void> = Promise.resolve();
  const toNum = (v: unknown) => (typeof v === 'bigint' ? Number(v) : v);
  const client = {
    async query(text: string, params: unknown[] = []) {
      const r = await pg.query<Record<string, unknown>>(text, params, { rowMode: 'object' });
      const rows = r.rows.map((row) => {
        for (const k in row) row[k] = toNum(row[k]);
        return row;
      });
      return { rows, rowCount: r.affectedRows ?? rows.length, command: 'SELECT' };
    },
    release() {},
  };
  const pool = {
    async connect() {
      let release!: () => void;
      const prev = queue;
      queue = new Promise<void>((res) => (release = res));
      await prev;
      return { ...client, release };
    },
    async end() {
      await pg.close();
    },
  };
  const db = new Kysely<T>({ dialect: new PostgresDialect({ pool: pool as never }) });
  return { db, close: () => db.destroy() };
}
