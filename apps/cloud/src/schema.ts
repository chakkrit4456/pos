import { sql, type Generated, type Kysely, type Migration, type MigrationProvider } from 'kysely';

/** Cloud-own tables in the public schema. Store data lives in one schema per tenant (t_<id>). */
export interface TenantsTable {
  id: string;
  name: string;
  schema_name: string;
  status: string; // active | suspended
  plan: string;
  note: string;
  created_at: string;
  last_sync_at: string | null;
  last_seen_at: string | null;
  pos_version: string | null;
}
export interface CloudUsersTable {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  is_superadmin: number;
  disabled: number;
  created_at: string;
  last_login_at: string | null;
}
export interface MembershipsTable {
  id: string;
  user_id: string;
  tenant_id: string;
  role: string; // manager | viewer
  created_at: string;
}
export interface DevicesTable {
  id: string;
  tenant_id: string;
  name: string;
  token_hash: string;
  machine_id: string;
  app_version: string;
  created_at: string;
  last_seen_at: string | null;
  pending: number;
  revoked: number;
}
export interface SyncCommandsTable {
  seq: Generated<number>;
  id: string;
  tenant_id: string;
  tbl: string;
  op: string; // upsert | delete
  row_id: string;
  payload: string;
  status: string; // pending | applied | rejected
  error: string | null;
  created_by: string;
  created_at: string;
  applied_at: string | null;
}
export interface IngestLogTable {
  id: string;
  tenant_id: string;
  device_id: string;
  rows: number;
  deleted: number;
  tables: string;
  ms: number;
  error: string | null;
  created_at: string;
}
export interface CloudAuditLogsTable {
  id: string;
  user_id: string | null;
  user_email: string;
  tenant_id: string | null;
  action: string;
  entity: string;
  entity_id: string;
  detail: string;
  ip: string;
  created_at: string;
}
export interface CloudRefreshTokensTable {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  revoked: number;
}

export interface LicensesTable {
  id: string;
  tenant_id: string | null;
  licensee: string;
  plan: string;
  max_devices: number;
  max_branches: number;
  /** latest signed key; re-signed whenever the limits change */
  key: string;
  note: string;
  revoked: number;
  created_at: string;
  updated_at: string;
}

export interface CloudDB {
  licenses: LicensesTable;
  tenants: TenantsTable;
  cloud_users: CloudUsersTable;
  memberships: MembershipsTable;
  devices: DevicesTable;
  sync_commands: SyncCommandsTable;
  ingest_log: IngestLogTable;
  cloud_audit_logs: CloudAuditLogsTable;
  cloud_refresh_tokens: CloudRefreshTokensTable;
}

const id = sql`varchar(36)`;
const ts = sql`varchar(30)`;
const str = sql`varchar(255)`;

const migrations: Record<string, Migration> = {
  '0001_cloud': {
    async up(db: Kysely<unknown>) {
      await db.schema
        .createTable('tenants')
        .addColumn('id', id, (c) => c.primaryKey())
        .addColumn('name', str, (c) => c.notNull())
        .addColumn('schema_name', sql`varchar(63)`, (c) => c.notNull().unique())
        .addColumn('status', sql`varchar(16)`, (c) => c.notNull().defaultTo('active'))
        .addColumn('plan', sql`varchar(32)`, (c) => c.notNull().defaultTo(''))
        .addColumn('note', 'text', (c) => c.notNull().defaultTo(''))
        .addColumn('created_at', ts, (c) => c.notNull())
        .addColumn('last_sync_at', ts)
        .addColumn('last_seen_at', ts)
        .addColumn('pos_version', sql`varchar(32)`)
        .execute();
      await db.schema
        .createTable('cloud_users')
        .addColumn('id', id, (c) => c.primaryKey())
        .addColumn('email', str, (c) => c.notNull().unique())
        .addColumn('name', str, (c) => c.notNull())
        .addColumn('password_hash', str, (c) => c.notNull())
        .addColumn('is_superadmin', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('disabled', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('created_at', ts, (c) => c.notNull())
        .addColumn('last_login_at', ts)
        .execute();
      await db.schema
        .createTable('memberships')
        .addColumn('id', id, (c) => c.primaryKey())
        .addColumn('user_id', id, (c) => c.notNull().references('cloud_users.id').onDelete('cascade'))
        .addColumn('tenant_id', id, (c) => c.notNull().references('tenants.id').onDelete('cascade'))
        .addColumn('role', sql`varchar(16)`, (c) => c.notNull())
        .addColumn('created_at', ts, (c) => c.notNull())
        .addUniqueConstraint('uq_memberships_user_tenant', ['user_id', 'tenant_id'])
        .execute();
      await db.schema
        .createTable('devices')
        .addColumn('id', id, (c) => c.primaryKey())
        .addColumn('tenant_id', id, (c) => c.notNull().references('tenants.id').onDelete('cascade'))
        .addColumn('name', str, (c) => c.notNull())
        .addColumn('token_hash', sql`varchar(64)`, (c) => c.notNull().unique())
        .addColumn('machine_id', str, (c) => c.notNull().defaultTo(''))
        .addColumn('app_version', sql`varchar(32)`, (c) => c.notNull().defaultTo(''))
        .addColumn('created_at', ts, (c) => c.notNull())
        .addColumn('last_seen_at', ts)
        .addColumn('pending', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('revoked', 'integer', (c) => c.notNull().defaultTo(0))
        .execute();
      await db.schema
        .createTable('sync_commands')
        .addColumn('seq', 'bigserial', (c) => c.primaryKey())
        .addColumn('id', id, (c) => c.notNull().unique())
        .addColumn('tenant_id', id, (c) => c.notNull().references('tenants.id').onDelete('cascade'))
        .addColumn('tbl', sql`varchar(64)`, (c) => c.notNull())
        .addColumn('op', sql`varchar(16)`, (c) => c.notNull())
        .addColumn('row_id', sql`varchar(64)`, (c) => c.notNull())
        .addColumn('payload', 'text', (c) => c.notNull())
        .addColumn('status', sql`varchar(16)`, (c) => c.notNull())
        .addColumn('error', 'text')
        .addColumn('created_by', str, (c) => c.notNull())
        .addColumn('created_at', ts, (c) => c.notNull())
        .addColumn('applied_at', ts)
        .execute();
      await db.schema.createIndex('ix_sync_commands_tenant').on('sync_commands').columns(['tenant_id', 'status', 'seq']).execute();
      await db.schema
        .createTable('ingest_log')
        .addColumn('id', id, (c) => c.primaryKey())
        .addColumn('tenant_id', id, (c) => c.notNull())
        .addColumn('device_id', id, (c) => c.notNull())
        .addColumn('rows', 'integer', (c) => c.notNull())
        .addColumn('deleted', 'integer', (c) => c.notNull())
        .addColumn('tables', 'text', (c) => c.notNull())
        .addColumn('ms', 'integer', (c) => c.notNull())
        .addColumn('error', 'text')
        .addColumn('created_at', ts, (c) => c.notNull())
        .execute();
      await db.schema.createIndex('ix_ingest_log_created').on('ingest_log').columns(['created_at']).execute();
      await db.schema
        .createTable('cloud_audit_logs')
        .addColumn('id', id, (c) => c.primaryKey())
        .addColumn('user_id', id)
        .addColumn('user_email', str, (c) => c.notNull())
        .addColumn('tenant_id', id)
        .addColumn('action', sql`varchar(64)`, (c) => c.notNull())
        .addColumn('entity', sql`varchar(64)`, (c) => c.notNull())
        .addColumn('entity_id', sql`varchar(64)`, (c) => c.notNull())
        .addColumn('detail', 'text', (c) => c.notNull())
        .addColumn('ip', sql`varchar(64)`, (c) => c.notNull())
        .addColumn('created_at', ts, (c) => c.notNull())
        .execute();
      await db.schema.createIndex('ix_cloud_audit_created').on('cloud_audit_logs').columns(['created_at']).execute();
      await db.schema
        .createTable('cloud_refresh_tokens')
        .addColumn('id', id, (c) => c.primaryKey())
        .addColumn('user_id', id, (c) => c.notNull().references('cloud_users.id').onDelete('cascade'))
        .addColumn('token_hash', sql`varchar(64)`, (c) => c.notNull().unique())
        .addColumn('expires_at', ts, (c) => c.notNull())
        .addColumn('created_at', ts, (c) => c.notNull())
        .addColumn('revoked', 'integer', (c) => c.notNull().defaultTo(0))
        .execute();
    },
  },
  '0002_licenses': {
    async up(db: Kysely<unknown>) {
      await db.schema
        .createTable('licenses')
        .addColumn('id', id, (c) => c.primaryKey())
        .addColumn('tenant_id', id, (c) => c.references('tenants.id').onDelete('set null'))
        .addColumn('licensee', str, (c) => c.notNull())
        .addColumn('plan', sql`varchar(32)`, (c) => c.notNull().defaultTo(''))
        .addColumn('max_devices', 'integer', (c) => c.notNull())
        .addColumn('max_branches', 'integer', (c) => c.notNull().defaultTo(1))
        .addColumn('key', 'text', (c) => c.notNull())
        .addColumn('note', 'text', (c) => c.notNull().defaultTo(''))
        .addColumn('revoked', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('created_at', ts, (c) => c.notNull())
        .addColumn('updated_at', ts, (c) => c.notNull())
        .execute();
      await db.schema.createIndex('ix_licenses_tenant').on('licenses').columns(['tenant_id']).execute();
    },
  },
};

export const cloudMigrations: MigrationProvider = { getMigrations: async () => migrations };
