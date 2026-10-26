import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { t } from '@flexpos/shared';
import type { CloudContext } from '../context.js';
import { audit, loginSchema, newToken, normLogin, nowIso, requireDevice, sha256, uuid, verifyPassword } from '../auth.js';
import { badRequest, conflict, forbidden, unauthorized } from '../errors.js';
import { cleanRow, deleteRows, isSyncTable, upsertRows } from '../replica.js';
import { createTenant } from '../tenants.js';
import { licenseForKey } from '../licenses.js';

const deviceInfo = {
  storeName: z.string().min(1).max(200),
  deviceName: z.string().min(1).max(120),
  machineId: z.string().max(200).default(''),
  appVersion: z.string().max(32).default(''),
};
/** Vendor cloud: the license key decides the store. */
const licenseRegister = z.object({ licenseKey: z.string().min(20), ...deviceInfo });
/** Store's own server: an existing manager account (created by its superadmin). */
const accountRegister = z.object({ username: loginSchema, password: z.string().min(1), tenantId: z.string().optional(), ...deviceInfo });

const pushSchema = z.object({
  tables: z.record(z.string(), z.object({ rows: z.array(z.record(z.string(), z.unknown())).max(5000).default([]), deleted: z.array(z.string()).max(5000).default([]) })),
  pending: z.number().int().nonnegative().default(0),
  appVersion: z.string().max(32).optional(),
});

export function syncRoutes(app: FastifyInstance, ctx: CloudContext) {
  const device = { preHandler: requireDevice(ctx) };
  /** Latest signed key of the store's license, so POS machines follow limit changes. */
  const currentKey = async (tenantId: string) => (await ctx.db.selectFrom('licenses').select('key').where('tenant_id', '=', tenantId).where('revoked', '=', 0).executeTakeFirst())?.key ?? null;

  /**
   * Pair a POS machine with a store. With license keys (vendor cloud) the store is created the
   * first time its key connects and every later machine with that key joins it, up to the
   * license's device limit. Accounts are never created here: only the superadmin adds managers.
   */
  app.post('/api/sync/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    let tenantId: string;
    let info: z.infer<typeof licenseRegister> | z.infer<typeof accountRegister>;
    let licenseKey: string | null = null;
    if (ctx.config.licensePrivateKey) {
      const b = licenseRegister.parse(req.body);
      info = b;
      const lic = await licenseForKey(ctx, b.licenseKey);
      licenseKey = lic.key;
      if (!lic.tenant_id) {
        tenantId = (await createTenant(ctx, { name: b.storeName || lic.licensee, plan: lic.plan })).id;
        await ctx.db.updateTable('licenses').set({ tenant_id: tenantId, updated_at: nowIso() }).where('id', '=', lic.id).execute();
      } else {
        tenantId = lic.tenant_id;
      }
      // A reinstall on the same machine replaces its old device instead of using another slot.
      if (b.machineId) await ctx.db.updateTable('devices').set({ revoked: 1 }).where('tenant_id', '=', tenantId).where('machine_id', '=', b.machineId).where('revoked', '=', 0).execute();
      const used = await ctx.db.selectFrom('devices').select((eb) => eb.fn.countAll<number>().as('n')).where('tenant_id', '=', tenantId).where('revoked', '=', 0).executeTakeFirst();
      if (Number(used?.n ?? 0) >= lic.max_devices) throw forbidden(t('License นี้ใช้ครบ {0} เครื่องแล้ว ยกเลิกเครื่องเก่าที่หน้าเว็บ หรือติดต่อผู้ให้บริการเพื่อเพิ่มจำนวนเครื่อง', lic.max_devices));
    } else {
      const b = accountRegister.parse(req.body);
      info = b;
      const user = await ctx.db.selectFrom('cloud_users').selectAll().where('email', '=', normLogin(b.username)).executeTakeFirst();
      if (!user || user.disabled === 1 || !(await verifyPassword(user.password_hash, b.password))) throw unauthorized(t('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'));
      const managed = await ctx.db
        .selectFrom('memberships')
        .innerJoin('tenants', 'tenants.id', 'memberships.tenant_id')
        .select(['tenants.id', 'tenants.name'])
        .where('memberships.user_id', '=', user.id)
        .where('memberships.role', '=', 'manager')
        .execute();
      if (b.tenantId) {
        if (user.is_superadmin !== 1 && !managed.some((m) => m.id === b.tenantId)) throw forbidden(t('บัญชีนี้ไม่ใช่ผู้จัดการของร้านที่เลือก'));
        tenantId = b.tenantId;
      } else if (managed.length === 1) {
        tenantId = managed[0]!.id;
      } else if (managed.length > 1) {
        throw conflict(t('บัญชีนี้ดูแลหลายร้าน กรุณาเลือกร้าน'), { stores: managed });
      } else {
        // First connection of this manager: their store is created now, once.
        tenantId = (await createTenant(ctx, { name: b.storeName, managerId: user.id })).id;
      }
      req.cloudUser = { id: user.id, email: user.email, name: user.name, isSuperadmin: user.is_superadmin === 1, memberships: new Map() };
    }
    const tenant = await ctx.db.selectFrom('tenants').selectAll().where('id', '=', tenantId).executeTakeFirst();
    if (!tenant) throw badRequest(t('ไม่พบร้าน'));
    if (tenant.status !== 'active') throw forbidden(t('ร้านนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ให้บริการ'));

    const token = newToken();
    const deviceId = uuid();
    await ctx.db
      .insertInto('devices')
      .values({ id: deviceId, tenant_id: tenant.id, name: info.deviceName, token_hash: sha256(token), machine_id: info.machineId, app_version: info.appVersion, created_at: nowIso(), last_seen_at: nowIso(), pending: 0, revoked: 0 })
      .execute();
    await audit(ctx, req, 'device.register', 'device', deviceId, { name: info.deviceName, machineId: info.machineId, by: licenseKey ? 'license' : 'account' }, tenant.id);
    return { deviceToken: token, deviceId, tenantId: tenant.id, tenantName: tenant.name, licenseKey };
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
    return { ok: true, rows, deleted, licenseKey: await currentKey(d.tenant_id) };
  });

  app.post('/api/sync/heartbeat', device, async (req) => {
    const b = z.object({ pending: z.number().int().nonnegative().default(0), appVersion: z.string().max(32).optional() }).parse(req.body ?? {});
    const d = req.device!;
    const at = nowIso();
    await ctx.db.updateTable('devices').set({ last_seen_at: at, pending: b.pending, ...(b.appVersion ? { app_version: b.appVersion } : {}) }).where('id', '=', d.id).execute();
    await ctx.db.updateTable('tenants').set({ last_seen_at: at }).where('id', '=', d.tenant_id).execute();
    const pendingCommands = await ctx.db.selectFrom('sync_commands').select((eb) => eb.fn.countAll<number>().as('n')).where('tenant_id', '=', d.tenant_id).where('status', '=', 'pending').executeTakeFirst();
    return { ok: true, serverTime: at, commands: Number(pendingCommands?.n ?? 0), licenseKey: await currentKey(d.tenant_id) };
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
