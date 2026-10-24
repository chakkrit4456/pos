import { Kysely, Migrator, MysqlDialect, PostgresDialect, SqliteDialect, sql } from 'kysely';
import type { DB } from './types.js';
import { migrationProvider } from './migrations.js';

export type Dialect = 'sqlite' | 'postgres' | 'mysql';

export type ConnectionConfig =
  | { kind: 'sqlite'; file: string }
  | {
      kind: 'postgres' | 'mysql';
      host: string;
      port: number;
      user: string;
      password: string;
      database: string;
      ssl: boolean;
    };

export interface Database {
  db: Kysely<DB>;
  dialect: Dialect;
  close(): Promise<void>;
}

export async function connect(cfg: ConnectionConfig): Promise<Database> {
  if (cfg.kind === 'sqlite') {
    const { default: SQLite } = await import('better-sqlite3');
    const { mkdirSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    if (cfg.file !== ':memory:') mkdirSync(dirname(cfg.file), { recursive: true });
    const sqlite = new SQLite(cfg.file);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('synchronous = NORMAL');
    sqlite.pragma('foreign_keys = OFF');
    sqlite.pragma('busy_timeout = 5000');
    const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
    return { db, dialect: 'sqlite', close: () => db.destroy() };
  }
  if (cfg.kind === 'postgres') {
    const pg = await import('pg');
    const types = pg.default.types;
    types.setTypeParser(20, (v: string) => Number(v)); // int8
    types.setTypeParser(1700, (v: string) => Number(v)); // numeric
    const pool = new pg.default.Pool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
      max: 10,
      connectionTimeoutMillis: 8000,
    });
    const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
    return { db, dialect: 'postgres', close: () => db.destroy() };
  }
  const mysql = await import('mysql2');
  const pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
    connectionLimit: 10,
    connectTimeout: 8000,
    decimalNumbers: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
    charset: 'utf8mb4',
    timezone: 'Z',
  });
  const db = new Kysely<DB>({ dialect: new MysqlDialect({ pool }) });
  return { db, dialect: 'mysql', close: () => db.destroy() };
}

/** Connect, run a trivial query, and close. Throws a readable error. */
export async function testConnection(cfg: ConnectionConfig): Promise<{ ok: true; version: string }> {
  const conn = await connect(cfg);
  try {
    const q =
      conn.dialect === 'sqlite'
        ? sql<{ v: string }>`select sqlite_version() as v`
        : sql<{ v: string }>`select version() as v`;
    const r = await q.execute(conn.db);
    return { ok: true, version: String(r.rows[0]?.v ?? '') };
  } finally {
    await conn.close();
  }
}

export async function migrate(conn: Database): Promise<string[]> {
  const migrator = new Migrator({
    db: conn.db,
    provider: migrationProvider(conn.dialect),
    migrationTableName: 'flexpos_migrations',
    migrationLockTableName: 'flexpos_migrations_lock',
  });
  const { error, results } = await migrator.migrateToLatest();
  if (error) throw error instanceof Error ? error : new Error(String(error));
  return (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}

/** Case-insensitive LIKE operator for the dialect. */
export function ilike(dialect: Dialect): 'ilike' | 'like' {
  return dialect === 'postgres' ? 'ilike' : 'like';
}
