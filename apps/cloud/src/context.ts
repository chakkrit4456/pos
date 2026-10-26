import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, Migrator, PostgresDialect, sql } from 'kysely';
import { migrationProvider, type DB } from '@flexpos/db';
import { LICENSE_PUBLIC_KEY } from '@flexpos/shared';
import { cloudMigrations, type CloudDB } from './schema.js';
import { pgliteKysely } from './pglite.js';

export interface CloudConfig {
  port: number;
  host: string;
  /** postgres://user:pass@host:5432/db, or pglite:<dir> / pglite:memory */
  databaseUrl: string;
  jwtSecret: string;
  webDir: string | null;
  logFile: string | null;
  /**
   * Ed25519 private key (PEM) for issuing license keys. When set (the vendor's FlexPOS Cloud),
   * a POS joins/creates its store with a license key; without it (a store's own server), a POS
   * signs in with a manager account the superadmin created.
   */
  licensePrivateKey: string | null;
  licensePublicKey: string;
  dataDir: string;
}

export function configFromEnv(env = process.env): CloudConfig {
  const dataDir = env.FLEXPOS_CLOUD_DATA ?? join(process.cwd(), 'data');
  let jwtSecret = env.JWT_SECRET ?? '';
  if (!jwtSecret) {
    // Development convenience: a random secret persisted next to the data.
    mkdirSync(dataDir, { recursive: true });
    const f = join(dataDir, 'jwt-secret');
    if (!existsSync(f)) writeFileSync(f, randomBytes(48).toString('base64url'), { mode: 0o600 });
    jwtSecret = readFileSync(f, 'utf8').trim();
  }
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
  return {
    port: Number(env.PORT ?? 4200),
    host: env.HOST ?? '127.0.0.1',
    databaseUrl: env.DATABASE_URL ?? `pglite:${join(dataDir, 'pglite')}`,
    jwtSecret,
    webDir: env.WEB_DIR ?? null,
    logFile: env.LOG_FILE ?? null,
    licensePrivateKey: env.LICENSE_PRIVATE_KEY ?? (env.LICENSE_PRIVATE_KEY_FILE ? readFileSync(env.LICENSE_PRIVATE_KEY_FILE, 'utf8') : null),
    licensePublicKey: env.LICENSE_PUBLIC_KEY ?? LICENSE_PUBLIC_KEY,
    dataDir,
  };
}

export type CloudEvent =
  | { type: 'tenant.synced'; tenantId: string; at: string; tables: string[] }
  | { type: 'tenant.status'; tenantId: string; online: boolean; lastSeenAt: string | null }
  | { type: 'commands.changed'; tenantId: string };

export const ONLINE_MS = 90_000;

export class CloudContext {
  readonly bus = new EventEmitter();
  private tenantMigrated = new Set<string>();

  private constructor(
    readonly config: CloudConfig,
    readonly db: Kysely<CloudDB>,
    private readonly closeDb: () => Promise<void>,
  ) {
    this.bus.setMaxListeners(1000);
  }

  static async open(config: CloudConfig): Promise<CloudContext> {
    let db: Kysely<CloudDB>;
    let close: () => Promise<void>;
    if (config.databaseUrl.startsWith('pglite:')) {
      const dir = config.databaseUrl.slice('pglite:'.length);
      const r = await pgliteKysely<CloudDB>(dir === 'memory' ? undefined : dir);
      db = r.db;
      close = r.close;
    } else {
      const pg = await import('pg');
      pg.default.types.setTypeParser(20, (v: string) => Number(v));
      pg.default.types.setTypeParser(1700, (v: string) => Number(v));
      const pool = new pg.default.Pool({ connectionString: config.databaseUrl, max: 20, connectionTimeoutMillis: 8000 });
      db = new Kysely<CloudDB>({ dialect: new PostgresDialect({ pool }) });
      close = () => db.destroy();
    }
    const ctx = new CloudContext(config, db, close);
    const m = new Migrator({ db, provider: cloudMigrations, migrationTableName: 'cloud_migrations', migrationLockTableName: 'cloud_migrations_lock' });
    const r = await m.migrateToLatest();
    if (r.error) throw r.error instanceof Error ? r.error : new Error(String(r.error));
    for (const t of await db.selectFrom('tenants').select('schema_name').execute()) await ctx.migrateTenant(t.schema_name);
    return ctx;
  }

  /** Kysely handle whose unqualified table names resolve inside the tenant's schema. */
  tenantDb(schemaName: string): Kysely<DB> {
    if (!/^t_[a-f0-9]{32}$/.test(schemaName)) throw new Error('bad tenant schema');
    return (this.db as unknown as Kysely<DB>).withSchema(schemaName);
  }

  /** Create (if needed) and migrate a tenant schema to the current POS schema version. */
  async migrateTenant(schemaName: string): Promise<void> {
    if (this.tenantMigrated.has(schemaName)) return;
    const tdb = this.tenantDb(schemaName);
    await sql`create schema if not exists ${sql.id(schemaName)}`.execute(this.db);
    const m = new Migrator({
      db: tdb,
      provider: migrationProvider('postgres'),
      migrationTableSchema: schemaName,
      migrationTableName: 'flexpos_migrations',
      migrationLockTableName: 'flexpos_migrations_lock',
    });
    const r = await m.migrateToLatest();
    if (r.error) throw r.error instanceof Error ? r.error : new Error(String(r.error));
    this.tenantMigrated.add(schemaName);
  }

  async dropTenantSchema(schemaName: string): Promise<void> {
    this.tenantDb(schemaName); // validates the name
    await sql`drop schema if exists ${sql.id(schemaName)} cascade`.execute(this.db);
    this.tenantMigrated.delete(schemaName);
  }

  emit(e: CloudEvent): void {
    this.bus.emit('event', e);
  }

  close(): Promise<void> {
    return this.closeDb();
  }
}
