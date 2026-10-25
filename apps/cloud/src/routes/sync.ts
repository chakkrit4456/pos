import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { t } from '@flexpos/shared';
import type { CloudContext } from '../context.js';
import { audit, hashPassword, newToken, normEmail, nowIso, requireDevice, sha256, uuid, verifyPassword } from '../auth.js';
import { badRequest, conflict, forbidden, unauthorized } from '../errors.js';
import { cleanRow, deleteRows, isSyncTable, upsertRows } from '../replica.js';
import { createTenant } from '../tenants.js';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  /** create a new manager account with this name (first connect from the setup wizard) */
  createAccount: z.object({ name: z.string().min(1).max(120) }).optional(),
  tenantId: z.string().optional(),
  storeName: z.string().min(1).max(200),
  deviceName: z.string().min(1).max(120),
  machineId: z.string().max(200).default(''),
  appVersion: z.string().max(32).default(''),
});

const pushSchema = z.object({
  tables: z.record(z.string(), z.object({ rows: z.array(z.record(z.string(), z.unknown())).max(5000).default([]), deleted: z.array(z.string()).max(5000).default([]) })),
  pending: z.number().int().nonnegative().default(0),
  appVersion: z.string().max(32).optional(),
});

export function syncRoutes(app: FastifyInstance, ctx: CloudContext) {
  const device = { preHandler: requireDevice(ctx) };

  /** Pair a POS machine with a store. Creates the store (and manager account) on first connect. */
  app.post('/api/sync/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const b = registerSchema.parse(req.body);
    const email = normEmail(b.email);
    let user = await ctx.db.selectFrom('cloud_users').selectAll().where('email', '=', email).executeTakeFirst();
    if (b.createAccount) {
      if (user) throw conflict(t('อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเลือก "มีบัญชีอยู่แล้ว" แล้วเข้าสู่ระบบ'));
      if (!ctx.config.allowSignup) throw forbidden(t('เซิร์ฟเวอร์นี้ไม่เปิดให้สมัครเอง กรุณาติดต่อผู้ดูแลระบบ'));
      user = { id: uuid(), email, name: b.createAccount.name, password_hash: await hashPassword(b.password), is_superadmin: 0, disabled: 0, created_at: nowIso(), last_login_at: null };
      await ctx.db.insertInto('cloud_users').values(user).execute();
    } else if (!user || user.disabled === 1 || !(await verifyPassword(user.password_hash, b.password))) {
      throw unauthorized(t('อีเมลหรือรหัสผ่านไม่ถูกต้อง'));
    }

    const managed = await ctx.db
      .selectFrom('memberships')
      .innerJoin('tenants', 'tenants.id', 'memberships.tenant_id')
      .select(['tenants.id', 'tenants.name', 'tenants.status'])
      .where('memberships.user_id', '=', user.id)
      .where('memberships.role', '=', 'manager')
      .execute();
    let tenantId = b.tenantId;
    if (tenantId) {
      const allowed = user.is_superadmin === 1 || managed.some((m) => m.id === tenantId);
      if (!allowed) throw forbidden(t('บัญชีนี้ไม่ใช่ผู้จัดการของร้านที่เลือก'));
    } else if (managed.length === 1 && !b.createAccount) {
      tenantId = managed[0]!.id;
    } else if (managed.length > 1) {
      throw conflict(t('บัญชีนี้ดูแลหลายร้าน กรุณาเลือกร้าน'), { stores: managed.map((m) => ({ id: m.id, name: m.name })) });
    } else {
      if (!ctx.config.allowSignup && user.is_superadmin !== 1) throw forbidden(t('เซิร์ฟเวอร์นี้ไม่เปิดให้สร้างร้านเอง กรุณาติดต่อผู้ดูแลระบบ'));
      tenantId = (await createTenant(ctx, { name: b.storeName, managerId: user.id })).id;
    }
    const tenant = await ctx.db.selectFrom('tenants').selectAll().where('id', '=', tenantId).executeTakeFirst();
    if (!tenant) throw badRequest(t('ไม่พบร้าน'));
    if (tenant.status !== 'active') throw forbidden(t('ร้านนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ให้บริการ'));

    const token = newToken();
    const deviceId = uuid();
    await ctx.db
      .insertInto('devices')
      .values({ id: deviceId, tenant_id: tenant.id, name: b.deviceName, token_hash: sha256(token), machine_id: b.machineId, app_version: b.appVersion, created_at: nowIso(), last_seen_at: nowIso(), pending: 0, revoked: 0 })
      .execute();
    req.cloudUser = { id: user.id, email: user.email, name: user.name, isSuperadmin: user.is_superadmin === 1, memberships: new Map() };
    await audit(ctx, req, 'device.register', 'device', deviceId, { name: b.deviceName, machineId: b.machineId }, tenant.id);
    return { deviceToken: token, deviceId, tenantId: tenant.id, tenantName: tenant.name, email: user.email };
  });

  /** Upsert/delete replicated rows. Idempotent: replaying a batch leaves the same state. */
  app.post('/api/sync/push', device, async (req) => {
    const b = pushSchema.parse(req.body);
    const d = req.device!;
    const started = Date.now();
    await ctx.migrateTenant(d.schema_name);
    let rows = 0;
    let deleted = 0;
    const tables = Object.keys(b.tables);
    for (const tbl of tables) if (!isSyncTable(tbl)) throw badRequest(t('ไม่รู้จักตาราง {0}', tbl));
    try {
      await ctx.db.transaction().execute(async (trx) => {
        const tdb = trx.withSchema(d.schema_name) as never as Parameters<typeof upsertRows>[0];
        for (const tbl of tables) {
          const part = b.tables[tbl]!;
          const clean = part.rows.map((r) => cleanRow(tbl, r, { fillDefaults: true }));
          await upsertRows(tdb, tbl, clean);
          await deleteRows(tdb, tbl, part.deleted);
          rows += clean.length;
          deleted += part.deleted.length;
        }
      });
    } catch (e) {
      await ctx.db.insertInto('ingest_log').values({ id: uuid(), tenant_id: d.tenant_id, device_id: d.id, rows, deleted, tables: tables.join(','), ms: Date.now() - started, error: String((e as Error).message ?? e).slice(0, 2000), created_at: nowIso() }).execute();
      throw e;
    }
    const at = nowIso();
    const settingsRow = b.tables.settings?.rows.find((r) => r.id === 'app');
    let name: string | undefined;
    if (settingsRow && typeof settingsRow.data === 'string') {
      try {
        name = (JSON.parse(settingsRow.data) as { store?: { name?: string } }).store?.name || undefined;
      } catch {
        /* keep the current name */
      }
    }
    await ctx.db.updateTable('tenants').set({ last_sync_at: at, last_seen_at: at, ...(b.appVersion ? { pos_version: b.appVersion } : {}), ...(name ? { name } : {}) }).where('id', '=', d.tenant_id).execute();
    await ctx.db.updateTable('devices').set({ last_seen_at: at, pending: b.pending, ...(b.appVersion ? { app_version: b.appVersion } : {}) }).where('id', '=', d.id).execute();
    if (rows || deleted) {
      await ctx.db.insertInto('ingest_log').values({ id: uuid(), tenant_id: d.tenant_id, device_id: d.id, rows, deleted, tables: tables.join(','), ms: Date.now() - started, error: null, created_at: at }).execute();
      ctx.emit({ type: 'tenant.synced', tenantId: d.tenant_id, at, tables });
    }
    return { ok: true, rows, deleted };
  });

  app.post('/api/sync/heartbeat', device, async (req) => {
    const b = z.object({ pending: z.number().int().nonnegative().default(0), appVersion: z.string().max(32).optional() }).parse(req.body ?? {});
    const d = req.device!;
    const at = nowIso();
    await ctx.db.updateTable('devices').set({ last_seen_at: at, pending: b.pending, ...(b.appVersion ? { app_version: b.appVersion } : {}) }).where('id', '=', d.id).execute();
    await ctx.db.updateTable('tenants').set({ last_seen_at: at }).where('id', '=', d.tenant_id).execute();
    const pendingCommands = await ctx.db.selectFrom('sync_commands').select((eb) => eb.fn.countAll<number>().as('n')).where('tenant_id', '=', d.tenant_id).where('status', '=', 'pending').executeTakeFirst();
    return { ok: true, serverTime: at, commands: Number(pendingCommands?.n ?? 0) };
  });

  /** Changes made on the web, waiting for the POS. */
  app.get('/api/sync/commands', device, async (req) => {
    const q = z.object({ after: z.coerce.number().int().nonnegative().default(0) }).parse(req.query);
    const rows = await ctx.db
      .selectFrom('sync_commands')
      .select(['seq', 'id', 'tbl', 'op', 'row_id', 'payload', 'created_by', 'created_at'])
      .where('tenant_id', '=', req.device!.tenant_id)
      .where('status', '=', 'pending')
      .where('seq', '>', q.after)
      .orderBy('seq')
      .limit(200)
      .execute();
    return { commands: rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) as unknown })) };
  });

  app.post('/api/sync/commands/ack', device, async (req) => {
    const b = z.object({ results: z.array(z.object({ id: z.string(), ok: z.boolean(), error: z.string().max(2000).optional() })).max(500) }).parse(req.body);
    const d = req.device!;
    for (const r of b.results) {
      await ctx.db
        .updateTable('sync_commands')
        .set({ status: r.ok ? 'applied' : 'rejected', error: r.ok ? null : (r.error ?? 'rejected'), applied_at: nowIso() })
        .where('id', '=', r.id)
        .where('tenant_id', '=', d.tenant_id)
        .where('status', '=', 'pending')
        .execute();
    }
    if (b.results.length) ctx.emit({ type: 'commands.changed', tenantId: d.tenant_id });
    return { ok: true };
  });
}
