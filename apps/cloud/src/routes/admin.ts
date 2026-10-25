import { existsSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql, type Kysely } from 'kysely';
import { t } from '@flexpos/shared';
import type { CloudContext } from '../context.js';
import { audit, hashPassword, normEmail, nowIso, requireSuperadmin, session, uuid } from '../auth.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { cleanRow, isEditable } from '../replica.js';
import { createTenant, deleteTenant } from '../tenants.js';
import { isOnline, queueChange } from './store.js';

const SECRET_COL = /(password_hash|token_hash|pin_hash)$/;
const MASK = '••••••';

type AnyDb = Kysely<Record<string, Record<string, unknown>>>;

export function adminRoutes(app: FastifyInstance, ctx: CloudContext) {
  const su = { preHandler: requireSuperadmin(ctx) };
  const raw = ctx.db as unknown as AnyDb;
  const ID = z.object({ id: z.string().uuid() });

  app.get('/api/admin/overview', su, async () => {
    const count = async (tbl: 'tenants' | 'cloud_users' | 'devices') => Number((await ctx.db.selectFrom(tbl).select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst())?.n ?? 0);
    const devices = await ctx.db.selectFrom('devices').select('last_seen_at').where('revoked', '=', 0).execute();
    const since = new Date(Date.now() - 86400_000).toISOString();
    const ingest = await ctx.db.selectFrom('ingest_log').select([(eb) => eb.fn.countAll<number>().as('n'), (eb) => eb.fn.sum<number>('rows').as('rows'), sql<number>`sum(case when error is null then 0 else 1 end)`.as('errors')]).where('created_at', '>=', since).executeTakeFirst();
    const size = await sql<{ n: number }>`select pg_database_size(current_database()) as n`.execute(ctx.db).catch(() => ({ rows: [{ n: 0 }] }));
    return {
      tenants: await count('tenants'),
      users: await count('cloud_users'),
      devices: devices.length,
      devicesOnline: devices.filter((d) => isOnline(d.last_seen_at)).length,
      ingest24h: { batches: Number(ingest?.n ?? 0), rows: Number(ingest?.rows ?? 0), errors: Number(ingest?.errors ?? 0) },
      dbBytes: Number(size.rows[0]?.n ?? 0),
      uptimeSec: Math.round(process.uptime()),
      node: process.version,
    };
  });

  // ---- stores ----
  app.get('/api/admin/tenants', su, async () => {
    const rows = await ctx.db.selectFrom('tenants').selectAll().orderBy('created_at', 'desc').execute();
    const mgrs = await ctx.db.selectFrom('memberships').innerJoin('cloud_users', 'cloud_users.id', 'memberships.user_id').select(['memberships.tenant_id', 'memberships.role', 'cloud_users.email']).execute();
    const devs = await ctx.db.selectFrom('devices').select(['tenant_id', 'last_seen_at']).where('revoked', '=', 0).execute();
    return {
      tenants: rows.map((r) => ({
        id: r.id, name: r.name, status: r.status, plan: r.plan, note: r.note, schema: r.schema_name, createdAt: r.created_at, lastSyncAt: r.last_sync_at, lastSeenAt: r.last_seen_at, online: isOnline(r.last_seen_at), posVersion: r.pos_version,
        managers: mgrs.filter((m) => m.tenant_id === r.id && m.role === 'manager').map((m) => m.email),
        members: mgrs.filter((m) => m.tenant_id === r.id).length,
        devices: devs.filter((d) => d.tenant_id === r.id).length,
      })),
    };
  });

  app.post('/api/admin/tenants', su, async (req) => {
    const b = z.object({ name: z.string().min(1).max(200), plan: z.string().max(32).default(''), managerEmail: z.string().email().optional(), managerName: z.string().max(120).optional(), managerPassword: z.string().min(8).optional() }).parse(req.body);
    let managerId: string | null = null;
    if (b.managerEmail) {
      const email = normEmail(b.managerEmail);
      const u = await ctx.db.selectFrom('cloud_users').select('id').where('email', '=', email).executeTakeFirst();
      if (u) managerId = u.id;
      else {
        if (!b.managerPassword) throw badRequest(t('บัญชีใหม่ต้องตั้งรหัสผ่านอย่างน้อย 8 ตัวอักษร'));
        managerId = uuid();
        await ctx.db.insertInto('cloud_users').values({ id: managerId, email, name: b.managerName || email, password_hash: await hashPassword(b.managerPassword), is_superadmin: 0, disabled: 0, created_at: nowIso(), last_login_at: null }).execute();
      }
    }
    const tn = await createTenant(ctx, { name: b.name, managerId, plan: b.plan });
    await audit(ctx, req, 'tenant.create', 'tenant', tn.id, { name: b.name, managerEmail: b.managerEmail }, tn.id);
    return { id: tn.id };
  });

  app.patch('/api/admin/tenants/:id', su, async (req) => {
    const { id } = ID.parse(req.params);
    const b = z.object({ name: z.string().min(1).max(200).optional(), status: z.enum(['active', 'suspended']).optional(), plan: z.string().max(32).optional(), note: z.string().max(5000).optional() }).parse(req.body);
    const r = await ctx.db.updateTable('tenants').set(b).where('id', '=', id).executeTakeFirst();
    if (!Number(r.numUpdatedRows)) throw notFound(t('ร้าน'));
    await audit(ctx, req, 'tenant.update', 'tenant', id, b, id);
    return { ok: true };
  });

  app.delete('/api/admin/tenants/:id', su, async (req) => {
    const { id } = ID.parse(req.params);
    if (!(await deleteTenant(ctx, id))) throw notFound(t('ร้าน'));
    await audit(ctx, req, 'tenant.delete', 'tenant', id, {}, null);
    return { ok: true };
  });

  // ---- users ----
  app.get('/api/admin/users', su, async () => {
    const users = await ctx.db.selectFrom('cloud_users').select(['id', 'email', 'name', 'is_superadmin', 'disabled', 'created_at', 'last_login_at']).orderBy('created_at', 'desc').execute();
    const ms = await ctx.db.selectFrom('memberships').innerJoin('tenants', 'tenants.id', 'memberships.tenant_id').select(['memberships.user_id', 'memberships.tenant_id', 'memberships.role', 'tenants.name']).execute();
    return {
      users: users.map((u) => ({ id: u.id, email: u.email, name: u.name, isSuperadmin: u.is_superadmin === 1, disabled: u.disabled === 1, createdAt: u.created_at, lastLoginAt: u.last_login_at, stores: ms.filter((m) => m.user_id === u.id).map((m) => ({ tenantId: m.tenant_id, name: m.name, role: m.role })) })),
    };
  });

  app.post('/api/admin/users', su, async (req) => {
    const b = z.object({ email: z.string().email(), name: z.string().min(1).max(120), password: z.string().min(8), isSuperadmin: z.boolean().default(false) }).parse(req.body);
    const email = normEmail(b.email);
    if (await ctx.db.selectFrom('cloud_users').select('id').where('email', '=', email).executeTakeFirst()) throw conflict(t('อีเมลนี้มีบัญชีอยู่แล้ว'));
    const id = uuid();
    await ctx.db.insertInto('cloud_users').values({ id, email, name: b.name, password_hash: await hashPassword(b.password), is_superadmin: b.isSuperadmin ? 1 : 0, disabled: 0, created_at: nowIso(), last_login_at: null }).execute();
    await audit(ctx, req, 'user.create', 'user', id, { email, isSuperadmin: b.isSuperadmin });
    return { id };
  });

  app.patch('/api/admin/users/:id', su, async (req) => {
    const { id } = ID.parse(req.params);
    const b = z.object({ email: z.string().email().optional(), name: z.string().min(1).max(120).optional(), password: z.string().min(8).optional(), disabled: z.boolean().optional(), isSuperadmin: z.boolean().optional() }).parse(req.body);
    const me = session(req);
    if (id === me.id && (b.disabled === true || b.isSuperadmin === false)) throw badRequest(t('ไม่สามารถปิดหรือลดสิทธิ์บัญชีของตัวเองได้'));
    const set: Record<string, unknown> = {};
    if (b.email) set.email = normEmail(b.email);
    if (b.name) set.name = b.name;
    if (b.password) set.password_hash = await hashPassword(b.password);
    if (b.disabled !== undefined) set.disabled = b.disabled ? 1 : 0;
    if (b.isSuperadmin !== undefined) set.is_superadmin = b.isSuperadmin ? 1 : 0;
    if (!Object.keys(set).length) return { ok: true };
    const r = await ctx.db.updateTable('cloud_users').set(set).where('id', '=', id).executeTakeFirst();
    if (!Number(r.numUpdatedRows)) throw notFound(t('บัญชี'));
    if (b.password || b.disabled) await ctx.db.updateTable('cloud_refresh_tokens').set({ revoked: 1 }).where('user_id', '=', id).execute();
    await audit(ctx, req, 'user.update', 'user', id, { ...b, password: b.password ? '(changed)' : undefined });
    return { ok: true };
  });

  app.delete('/api/admin/users/:id', su, async (req) => {
    const { id } = ID.parse(req.params);
    if (id === session(req).id) throw badRequest(t('ไม่สามารถลบบัญชีของตัวเองได้'));
    await ctx.db.deleteFrom('cloud_users').where('id', '=', id).execute();
    await audit(ctx, req, 'user.delete', 'user', id);
    return { ok: true };
  });

  app.put('/api/admin/users/:id/memberships', su, async (req) => {
    const { id } = ID.parse(req.params);
    const b = z.object({ tenantId: z.string().uuid(), role: z.enum(['manager', 'viewer']).nullable() }).parse(req.body);
    await ctx.db.deleteFrom('memberships').where('user_id', '=', id).where('tenant_id', '=', b.tenantId).execute();
    if (b.role) await ctx.db.insertInto('memberships').values({ id: uuid(), user_id: id, tenant_id: b.tenantId, role: b.role, created_at: nowIso() }).execute();
    await audit(ctx, req, 'member.set', 'user', id, b, b.tenantId);
    return { ok: true };
  });

  // ---- database browser ----
  const schemas = async () => {
    const ts = await ctx.db.selectFrom('tenants').select(['schema_name', 'name', 'id']).orderBy('name').execute();
    return [{ name: 'public', label: t('ระบบคลาวด์'), tenantId: null as string | null }, ...ts.map((x) => ({ name: x.schema_name, label: x.name, tenantId: x.id as string | null }))];
  };
  const checkSchema = async (s: string) => {
    const found = (await schemas()).find((x) => x.name === s);
    if (!found) throw notFound(t('ฐานข้อมูล'));
    return found;
  };
  const tablesOf = async (schema: string) => {
    const names = (await sql<{ name: string }>`select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = ${schema} and c.relkind = 'r' order by c.relname`.execute(ctx.db)).rows;
    // Exact counts capped at 100k, so huge tables stay cheap (shown as 100000+).
    const out: { name: string; rows: number; more: boolean }[] = [];
    for (const { name } of names) {
      const r = await sql<{ n: number }>`select count(*)::int as n from (select 1 from ${sql.id(schema, name)} limit 100001) x`.execute(ctx.db);
      const n = Number(r.rows[0]?.n ?? 0);
      out.push({ name, rows: Math.min(n, 100000), more: n > 100000 });
    }
    return out;
  };
  const columnsOf = async (schema: string, table: string) => {
    const cols = (await sql<{ name: string; type: string; nullable: string }>`select column_name as name, data_type as type, is_nullable as nullable from information_schema.columns where table_schema = ${schema} and table_name = ${table} order by ordinal_position`.execute(ctx.db)).rows;
    if (!cols.length) throw notFound(t('ตาราง'));
    const pk = (await sql<{ name: string }>`select a.attname as name from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey) where i.indisprimary and n.nspname = ${schema} and c.relname = ${table}`.execute(ctx.db)).rows.map((r) => r.name);
    return { cols, pk };
  };
  const mask = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, SECRET_COL.test(k) && v ? MASK : v]));

  app.get('/api/admin/db/schemas', su, async () => ({ schemas: await schemas() }));

  app.get('/api/admin/db/tables', su, async (req) => {
    const { schema } = z.object({ schema: z.string() }).parse(req.query);
    await checkSchema(schema);
    return { tables: await tablesOf(schema) };
  });

  app.get('/api/admin/db/rows', su, async (req) => {
    const q = z.object({ schema: z.string(), table: z.string(), limit: z.coerce.number().int().min(1).max(500).default(50), offset: z.coerce.number().int().min(0).default(0), q: z.string().max(100).optional(), orderBy: z.string().optional(), desc: z.coerce.boolean().default(false) }).parse(req.query);
    await checkSchema(q.schema);
    const { cols, pk } = await columnsOf(q.schema, q.table);
    const db = raw.withSchema(q.schema);
    let base = db.selectFrom(q.table);
    if (q.q) {
      const textCols = cols.filter((c) => /char|text/.test(c.type) && !SECRET_COL.test(c.name)).map((c) => c.name);
      if (textCols.length) base = base.where((eb) => eb.or(textCols.map((c) => eb(sql.ref(c), 'ilike', `%${q.q}%`))));
    }
    const total = await base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const order = q.orderBy && cols.some((c) => c.name === q.orderBy) ? q.orderBy : (cols.find((c) => c.name === 'created_at')?.name ?? pk[0] ?? cols[0]!.name);
    const rows = await base.selectAll().orderBy(sql.ref(order), q.desc || (order === 'created_at' && !q.orderBy) ? 'desc' : 'asc').limit(q.limit).offset(q.offset).execute();
    return { columns: cols, primaryKey: pk, rows: rows.map(mask), total: Number(total?.n ?? 0) };
  });

  const rowBody = z.object({ schema: z.string(), table: z.string(), key: z.record(z.string(), z.unknown()).optional(), values: z.record(z.string(), z.unknown()).default({}) });

  /** Insert (no key) or update (key) one row. Master-data edits in a store schema also go to the POS. */
  app.post('/api/admin/db/row', su, async (req) => {
    const b = rowBody.parse(req.body);
    const sch = await checkSchema(b.schema);
    const { cols, pk } = await columnsOf(b.schema, b.table);
    const names = new Set(cols.map((c) => c.name));
    const values = Object.fromEntries(Object.entries(b.values).filter(([k, v]) => names.has(k) && !(SECRET_COL.test(k) && v === MASK)));
    if (values.password_hash !== undefined && typeof values.password_hash === 'string') values.password_hash = await hashPassword(values.password_hash);
    const db = raw.withSchema(b.schema);
    if (sch.tenantId && isEditable(b.table)) {
      // Route through the command queue so the POS receives the change.
      const key = b.key ?? {};
      const pkName = pk[0] ?? 'id';
      const id = String(key[pkName] ?? values[pkName] ?? uuid());
      const existing = await db.selectFrom(b.table).selectAll().where(pkName, '=', id).executeTakeFirst();
      const row = cleanRow(b.table, { ...(existing ?? {}), ...values, [pkName]: id }, { fillDefaults: true });
      const tenant = (await ctx.db.selectFrom('tenants').select(['id', 'schema_name']).where('id', '=', sch.tenantId).executeTakeFirstOrThrow());
      await queueChange(ctx, req, tenant, b.table, 'upsert', id, row);
      return { ok: true, queued: true };
    }
    if (b.key) {
      if (!pk.length) throw badRequest(t('ตารางนี้ไม่มีคีย์หลัก แก้ไขรายแถวไม่ได้'));
      let q = db.updateTable(b.table).set(values);
      for (const k of pk) q = q.where(k, '=', b.key[k]);
      const r = await q.executeTakeFirst();
      if (!Number(r.numUpdatedRows)) throw notFound();
    } else {
      await db.insertInto(b.table).values(values).execute();
    }
    await audit(ctx, req, b.key ? 'db.update' : 'db.insert', `${b.schema}.${b.table}`, JSON.stringify(b.key ?? {}).slice(0, 64), { values: mask(values) }, sch.tenantId);
    return { ok: true, queued: false };
  });

  app.post('/api/admin/db/delete', su, async (req) => {
    const b = rowBody.extend({ key: z.record(z.string(), z.unknown()) }).parse(req.body);
    const sch = await checkSchema(b.schema);
    const { pk } = await columnsOf(b.schema, b.table);
    if (!pk.length) throw badRequest(t('ตารางนี้ไม่มีคีย์หลัก แก้ไขรายแถวไม่ได้'));
    if (sch.tenantId && isEditable(b.table)) {
      const tenant = await ctx.db.selectFrom('tenants').select(['id', 'schema_name']).where('id', '=', sch.tenantId).executeTakeFirstOrThrow();
      await queueChange(ctx, req, tenant, b.table, 'delete', String(b.key[pk[0]!]), null);
      return { ok: true, queued: true };
    }
    let q = raw.withSchema(b.schema).deleteFrom(b.table);
    for (const k of pk) q = q.where(k, '=', b.key[k]);
    await q.execute();
    await audit(ctx, req, 'db.delete', `${b.schema}.${b.table}`, JSON.stringify(b.key).slice(0, 64), {}, sch.tenantId);
    return { ok: true, queued: false };
  });

  /** Read-only SQL console: runs inside a READ ONLY transaction with a timeout. */
  app.post('/api/admin/db/query', su, async (req) => {
    const b = z.object({ sql: z.string().min(1).max(20_000) }).parse(req.body);
    b.sql = b.sql.trim().replace(/;+\s*$/, '');
    // One statement only, so nothing can COMMIT its way out of the read-only transaction.
    if (b.sql.includes(';')) throw badRequest(t('รันได้ครั้งละ 1 คำสั่ง'));
    const started = Date.now();
    const result = await ctx.db.transaction().execute(async (trx) => {
      await sql`set transaction read only`.execute(trx);
      await sql`set local statement_timeout = 15000`.execute(trx).catch(() => undefined);
      return sql.raw<Record<string, unknown>>(b.sql).execute(trx);
    }).catch((e: Error) => {
      throw badRequest(e.message);
    });
    await audit(ctx, req, 'db.query', 'sql', '', { sql: b.sql.slice(0, 2000) });
    const rows = result.rows.slice(0, 1000).map(mask);
    return { rows, columns: rows[0] ? Object.keys(rows[0]) : [], truncated: result.rows.length > 1000, ms: Date.now() - started };
  });

  // ---- logs ----
  const page = z.object({ tenantId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0), q: z.string().max(100).optional() });

  app.get('/api/admin/logs/audit', su, async (req) => {
    const q = page.parse(req.query);
    let b = ctx.db.selectFrom('cloud_audit_logs').leftJoin('tenants', 'tenants.id', 'cloud_audit_logs.tenant_id').selectAll('cloud_audit_logs').select('tenants.name as tenant_name');
    if (q.tenantId) b = b.where('cloud_audit_logs.tenant_id', '=', q.tenantId);
    if (q.q) b = b.where((eb) => eb.or([eb('cloud_audit_logs.action', 'ilike', `%${q.q}%`), eb('cloud_audit_logs.user_email', 'ilike', `%${q.q}%`)]));
    return { items: await b.orderBy('cloud_audit_logs.created_at', 'desc').limit(q.limit).offset(q.offset).execute() };
  });

  app.get('/api/admin/logs/ingest', su, async (req) => {
    const q = page.parse(req.query);
    let b = ctx.db.selectFrom('ingest_log').leftJoin('tenants', 'tenants.id', 'ingest_log.tenant_id').leftJoin('devices', 'devices.id', 'ingest_log.device_id').selectAll('ingest_log').select(['tenants.name as tenant_name', 'devices.name as device_name']);
    if (q.tenantId) b = b.where('ingest_log.tenant_id', '=', q.tenantId);
    return { items: await b.orderBy('ingest_log.created_at', 'desc').limit(q.limit).offset(q.offset).execute() };
  });

  /** Audit trail recorded on the POS machines (replicated). */
  app.get('/api/admin/logs/pos', su, async (req) => {
    const q = page.extend({ tenantId: z.string().uuid() }).parse(req.query);
    const tn = await ctx.db.selectFrom('tenants').select('schema_name').where('id', '=', q.tenantId).executeTakeFirst();
    if (!tn) throw notFound(t('ร้าน'));
    let b = ctx.tenantDb(tn.schema_name).selectFrom('audit_logs').selectAll();
    if (q.q) b = b.where((eb) => eb.or([eb('action', 'ilike', `%${q.q}%`), eb('user_name', 'ilike', `%${q.q}%`)]));
    return { items: await b.orderBy('created_at', 'desc').limit(q.limit).offset(q.offset).execute() };
  });

  /** Tail of the server log file (LOG_FILE). */
  app.get('/api/admin/logs/app', su, async (req) => {
    const { lines } = z.object({ lines: z.coerce.number().int().min(10).max(5000).default(300) }).parse(req.query);
    const f = ctx.config.logFile;
    if (!f || !existsSync(f)) return { file: f, lines: [] as string[], note: t('ยังไม่ได้ตั้งค่า LOG_FILE ดู log ได้ด้วยคำสั่ง journalctl -u flexpos-cloud') };
    const size = statSync(f).size;
    const len = Math.min(size, lines * 600);
    const buf = Buffer.alloc(len);
    const fd = openSync(f, 'r');
    try {
      readSync(fd, buf, 0, len, size - len);
    } finally {
      closeSync(fd);
    }
    return { file: f, lines: buf.toString('utf8').split('\n').filter(Boolean).slice(-lines) };
  });
}
