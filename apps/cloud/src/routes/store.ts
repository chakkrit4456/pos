import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sql } from 'kysely';
import { DEFAULT_SETTINGS, mergeSettings, t, type Settings } from '@flexpos/shared';
import { SYNC_TABLES, TABLE_COLUMNS, type DB } from '@flexpos/db';
import { adjustmentsReport, dashboard, salesReport, vatReport } from '@flexpos/reports';
import type { Kysely } from 'kysely';
import { ONLINE_MS, type CloudContext } from '../context.js';
import { audit, hashPassword, normEmail, nowIso, requireUser, session, tenantFor, uuid, type Role } from '../auth.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { cleanRow, deleteRows, isEditable, pkOf, upsertRows } from '../replica.js';

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const rangeSchema = z.object({ from: z.string().regex(dateRe), to: z.string().regex(dateRe), branchId: z.string().optional() });
const branchParam = (b?: string) => (!b || b === 'all' ? null : b);

export async function tenantSettings(tdb: Kysely<DB>): Promise<Settings> {
  const row = await tdb.selectFrom('settings').select('data').where('id', '=', 'app').executeTakeFirst();
  let data: Partial<Settings> = {};
  try {
    data = row?.data ? (JSON.parse(row.data) as Partial<Settings>) : {};
  } catch {
    /* defaults */
  }
  return mergeSettings(DEFAULT_SETTINGS, data);
}

export const isOnline = (lastSeenAt: string | null) => !!lastSeenAt && Date.now() - Date.parse(lastSeenAt) < ONLINE_MS;

/** Queue a master-data change for the POS and apply it to the replica right away. */
export async function queueChange(ctx: CloudContext, req: FastifyRequest, tenant: { id: string; schema_name: string }, tbl: string, op: 'upsert' | 'delete', rowId: string, row: Record<string, unknown> | null) {
  const tdb = ctx.tenantDb(tenant.schema_name);
  if (op === 'upsert' && row) await upsertRows(tdb, tbl, [row]);
  else await deleteRows(tdb, tbl, [rowId]);
  const s = req.cloudUser!;
  const id = uuid();
  await ctx.db.insertInto('sync_commands').values({ id, tenant_id: tenant.id, tbl, op, row_id: rowId, payload: JSON.stringify(row ?? {}), status: 'pending', error: null, created_by: s.email, created_at: nowIso(), applied_at: null }).execute();
  await audit(ctx, req, `data.${op}`, tbl, rowId, op === 'upsert' ? { row } : {}, tenant.id);
  ctx.emit({ type: 'commands.changed', tenantId: tenant.id });
  return id;
}

export function storeRoutes(app: FastifyInstance, ctx: CloudContext) {
  const user = { preHandler: requireUser(ctx) };
  const P = z.object({ tid: z.string().uuid() });

  app.get('/api/stores', user, async (req) => {
    const s = session(req);
    let q = ctx.db.selectFrom('tenants').selectAll().orderBy('name');
    if (!s.isSuperadmin) {
      const ids = [...s.memberships.keys()];
      if (!ids.length) return { stores: [] };
      q = q.where('id', 'in', ids);
    }
    const rows = await q.execute();
    return {
      stores: rows
        .filter((r) => s.isSuperadmin || r.status === 'active')
        .map((r) => ({ id: r.id, name: r.name, status: r.status, role: s.isSuperadmin ? 'superadmin' : s.memberships.get(r.id), lastSyncAt: r.last_sync_at, lastSeenAt: r.last_seen_at, online: isOnline(r.last_seen_at), posVersion: r.pos_version })),
    };
  });

  app.get('/api/stores/:tid', user, async (req) => {
    const { tid } = P.parse(req.params);
    const tn = await tenantFor(ctx, req, tid);
    const tdb = ctx.tenantDb(tn.schema_name);
    const settings = await tenantSettings(tdb);
    const branches = await tdb.selectFrom('branches').select(['id', 'name', 'code']).where('active', '=', 1).orderBy('created_at').execute();
    const devices = await ctx.db.selectFrom('devices').select(['id', 'name', 'app_version', 'last_seen_at', 'pending', 'created_at']).where('tenant_id', '=', tid).where('revoked', '=', 0).orderBy('created_at').execute();
    const pending = await ctx.db.selectFrom('sync_commands').select((eb) => eb.fn.countAll<number>().as('n')).where('tenant_id', '=', tid).where('status', '=', 'pending').executeTakeFirst();
    return {
      id: tn.id,
      name: tn.name,
      status: tn.status,
      role: tn.role,
      lastSyncAt: tn.last_sync_at,
      lastSeenAt: tn.last_seen_at,
      online: isOnline(tn.last_seen_at),
      posVersion: tn.pos_version,
      store: settings.store,
      modules: settings.modules,
      currency: settings.locale,
      branches,
      devices: devices.map((d) => ({ id: d.id, name: d.name, appVersion: d.app_version, lastSeenAt: d.last_seen_at, online: isOnline(d.last_seen_at), pending: d.pending, createdAt: d.created_at })),
      pendingCommands: Number(pending?.n ?? 0),
    };
  });

  app.get('/api/stores/:tid/dashboard', user, async (req) => {
    const { tid } = P.parse(req.params);
    const q = z.object({ range: z.enum(['today', '7d', '30d']).default('today'), branchId: z.string().optional() }).parse(req.query);
    const tn = await tenantFor(ctx, req, tid);
    const tdb = ctx.tenantDb(tn.schema_name);
    const settings = await tenantSettings(tdb);
    const first = await tdb.selectFrom('branches').select('id').orderBy('created_at').executeTakeFirst();
    const data = await dashboard(tdb, { range: q.range, branchId: branchParam(q.branchId), canProfit: true, modules: { stock: settings.modules.stock, restaurant: settings.modules.restaurant }, defaultBranchId: first?.id ?? null });
    return { ...data, syncedAt: tn.last_sync_at, online: isOnline(tn.last_seen_at) };
  });

  app.get('/api/stores/:tid/reports/sales', user, async (req) => {
    const { tid } = P.parse(req.params);
    const q = rangeSchema.extend({ groupBy: z.enum(['day', 'hour', 'product', 'category', 'staff', 'method', 'branch']).default('day') }).parse(req.query);
    const tn = await tenantFor(ctx, req, tid);
    return salesReport(ctx.tenantDb(tn.schema_name), { from: q.from, to: q.to, groupBy: q.groupBy, branchId: branchParam(q.branchId), canProfit: true });
  });

  app.get('/api/stores/:tid/reports/vat', user, async (req) => {
    const { tid } = P.parse(req.params);
    const q = rangeSchema.parse(req.query);
    const tn = await tenantFor(ctx, req, tid);
    return vatReport(ctx.tenantDb(tn.schema_name), { from: q.from, to: q.to, branchId: branchParam(q.branchId) });
  });

  app.get('/api/stores/:tid/reports/adjustments', user, async (req) => {
    const { tid } = P.parse(req.params);
    const q = rangeSchema.parse(req.query);
    const tn = await tenantFor(ctx, req, tid);
    return adjustmentsReport(ctx.tenantDb(tn.schema_name), { from: q.from, to: q.to, branchId: branchParam(q.branchId) });
  });

  /** Browse replicated tables. */
  app.get('/api/stores/:tid/data/:table', user, async (req) => {
    const { tid, table } = P.extend({ table: z.string() }).parse(req.params);
    const q = z.object({ q: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(500).default(50), offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    if (!SYNC_TABLES.includes(table)) throw notFound(t('ตาราง'));
    const tn = await tenantFor(ctx, req, tid, table === 'audit_logs' || table === 'users' ? 'manager' : 'viewer');
    const tdb = ctx.tenantDb(tn.schema_name) as unknown as Kysely<Record<string, Record<string, unknown>>>;
    const cols = TABLE_COLUMNS[table]!;
    const names = new Set(cols.map((c) => c.name));
    let base = tdb.selectFrom(table);
    if (q.q) {
      const like = `%${q.q}%`;
      const searchable = ['name', 'doc_no', 'sku', 'code', 'phone', 'email', 'action'].filter((c) => names.has(c));
      if (searchable.length) base = base.where((eb) => eb.or(searchable.map((c) => eb(sql.ref(c), 'ilike', like))));
    }
    if (names.has('deleted_at') && table === 'products') base = base.where('deleted_at', 'is', null);
    const total = await base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const order = names.has('created_at') ? 'created_at' : names.has('sort') ? 'sort' : names.has('name') ? 'name' : pkOf(table);
    const rows = await base.selectAll().orderBy(order, order === 'created_at' ? 'desc' : 'asc').limit(q.limit).offset(q.offset).execute();
    const pending = await ctx.db.selectFrom('sync_commands').select(['row_id', 'op', 'status']).where('tenant_id', '=', tid).where('tbl', '=', table).where('status', '=', 'pending').execute();
    return { table, editable: isEditable(table) && tn.role !== 'viewer', columns: cols, rows, total: Number(total?.n ?? 0), pending: Object.fromEntries(pending.map((p) => [p.row_id, p.op])) };
  });

  app.post('/api/stores/:tid/data/:table', user, async (req) => {
    const { tid, table } = P.extend({ table: z.string() }).parse(req.params);
    const b = z.object({ row: z.record(z.string(), z.unknown()) }).parse(req.body);
    if (!isEditable(table)) throw forbidden(t('ตารางนี้แก้ไขจากเว็บไม่ได้ ข้อมูลการขายแก้ไขได้ที่เครื่อง POS เท่านั้น'));
    const tn = await tenantFor(ctx, req, tid, 'manager');
    const tdb = ctx.tenantDb(tn.schema_name) as unknown as Kysely<Record<string, Record<string, unknown>>>;
    const pk = pkOf(table);
    const id = typeof b.row[pk] === 'string' && b.row[pk] ? (b.row[pk] as string) : uuid();
    const existing = await tdb.selectFrom(table).selectAll().where(pk, '=', id).executeTakeFirst();
    const names = new Set(TABLE_COLUMNS[table]!.map((c) => c.name));
    const now = nowIso();
    const merged: Record<string, unknown> = { ...(existing ?? {}), ...b.row, [pk]: id };
    if (!existing && names.has('created_at') && !merged.created_at) merged.created_at = now;
    if (names.has('updated_at')) merged.updated_at = now;
    const row = cleanRow(table, merged, { fillDefaults: true });
    await queueChange(ctx, req, tn, table, 'upsert', id, row);
    return { row, queued: true };
  });

  app.delete('/api/stores/:tid/data/:table/:id', user, async (req) => {
    const { tid, table, id } = P.extend({ table: z.string(), id: z.string().min(1) }).parse(req.params);
    if (!isEditable(table) || table === 'settings') throw forbidden(t('ตารางนี้ลบจากเว็บไม่ได้'));
    const tn = await tenantFor(ctx, req, tid, 'manager');
    const tdb = ctx.tenantDb(tn.schema_name) as unknown as Kysely<Record<string, Record<string, unknown>>>;
    const existing = await tdb.selectFrom(table).selectAll().where(pkOf(table), '=', id).executeTakeFirst();
    if (!existing) throw notFound();
    if (table === 'products') {
      // POS keeps sold products for history: soft delete.
      const now = nowIso();
      await queueChange(ctx, req, tn, table, 'upsert', id, cleanRow(table, { ...existing, deleted_at: now, active: 0, updated_at: now }, { fillDefaults: true }));
    } else {
      await queueChange(ctx, req, tn, table, 'delete', id, null);
    }
    return { ok: true, queued: true };
  });

  app.get('/api/stores/:tid/commands', user, async (req) => {
    const { tid } = P.parse(req.params);
    await tenantFor(ctx, req, tid);
    const rows = await ctx.db.selectFrom('sync_commands').select(['id', 'tbl', 'op', 'row_id', 'status', 'error', 'created_by', 'created_at', 'applied_at']).where('tenant_id', '=', tid).orderBy('seq', 'desc').limit(100).execute();
    return { commands: rows };
  });

  // ---- members ----
  const roleSchema = z.enum(['manager', 'viewer']);

  app.get('/api/stores/:tid/members', user, async (req) => {
    const { tid } = P.parse(req.params);
    await tenantFor(ctx, req, tid, 'manager');
    const rows = await ctx.db.selectFrom('memberships').innerJoin('cloud_users', 'cloud_users.id', 'memberships.user_id').select(['cloud_users.id', 'cloud_users.email', 'cloud_users.name', 'cloud_users.disabled', 'cloud_users.last_login_at', 'memberships.role', 'memberships.created_at']).where('memberships.tenant_id', '=', tid).orderBy('memberships.created_at').execute();
    return { members: rows.map((r) => ({ id: r.id, email: r.email, name: r.name, disabled: r.disabled === 1, lastLoginAt: r.last_login_at, role: r.role, addedAt: r.created_at })) };
  });

  app.post('/api/stores/:tid/members', user, async (req) => {
    const { tid } = P.parse(req.params);
    const b = z.object({ email: z.string().email(), name: z.string().min(1).max(120), password: z.string().min(8).optional(), role: roleSchema.default('viewer') }).parse(req.body);
    await tenantFor(ctx, req, tid, 'manager');
    const email = normEmail(b.email);
    let u = await ctx.db.selectFrom('cloud_users').select(['id']).where('email', '=', email).executeTakeFirst();
    if (!u) {
      if (!b.password) throw badRequest(t('บัญชีใหม่ต้องตั้งรหัสผ่านอย่างน้อย 8 ตัวอักษร'));
      u = { id: uuid() };
      await ctx.db.insertInto('cloud_users').values({ id: u.id, email, name: b.name, password_hash: await hashPassword(b.password), is_superadmin: 0, disabled: 0, created_at: nowIso(), last_login_at: null }).execute();
    }
    const exists = await ctx.db.selectFrom('memberships').select('id').where('user_id', '=', u.id).where('tenant_id', '=', tid).executeTakeFirst();
    if (exists) throw conflict(t('บัญชีนี้เป็นสมาชิกของร้านอยู่แล้ว'));
    await ctx.db.insertInto('memberships').values({ id: uuid(), user_id: u.id, tenant_id: tid, role: b.role, created_at: nowIso() }).execute();
    await audit(ctx, req, 'member.add', 'user', u.id, { email, role: b.role }, tid);
    return { ok: true, userId: u.id };
  });

  const managersLeft = async (tid: string, exceptUserId: string) => {
    const r = await ctx.db.selectFrom('memberships').select((eb) => eb.fn.countAll<number>().as('n')).where('tenant_id', '=', tid).where('role', '=', 'manager').where('user_id', '!=', exceptUserId).executeTakeFirst();
    return Number(r?.n ?? 0);
  };

  app.patch('/api/stores/:tid/members/:uid', user, async (req) => {
    const { tid, uid } = P.extend({ uid: z.string().uuid() }).parse(req.params);
    const b = z.object({ role: roleSchema }).parse(req.body);
    await tenantFor(ctx, req, tid, 'manager');
    if (b.role === 'viewer' && (await managersLeft(tid, uid)) === 0) throw badRequest(t('ร้านต้องมีผู้จัดการอย่างน้อย 1 คน'));
    await ctx.db.updateTable('memberships').set({ role: b.role as Role }).where('tenant_id', '=', tid).where('user_id', '=', uid).execute();
    await audit(ctx, req, 'member.role', 'user', uid, { role: b.role }, tid);
    return { ok: true };
  });

  app.delete('/api/stores/:tid/members/:uid', user, async (req) => {
    const { tid, uid } = P.extend({ uid: z.string().uuid() }).parse(req.params);
    await tenantFor(ctx, req, tid, 'manager');
    if ((await managersLeft(tid, uid)) === 0) throw badRequest(t('ร้านต้องมีผู้จัดการอย่างน้อย 1 คน'));
    await ctx.db.deleteFrom('memberships').where('tenant_id', '=', tid).where('user_id', '=', uid).execute();
    await audit(ctx, req, 'member.remove', 'user', uid, {}, tid);
    return { ok: true };
  });

  app.delete('/api/stores/:tid/devices/:did', user, async (req) => {
    const { tid, did } = P.extend({ did: z.string().uuid() }).parse(req.params);
    await tenantFor(ctx, req, tid, 'manager');
    await ctx.db.updateTable('devices').set({ revoked: 1 }).where('tenant_id', '=', tid).where('id', '=', did).execute();
    await audit(ctx, req, 'device.revoke', 'device', did, {}, tid);
    return { ok: true };
  });
}
