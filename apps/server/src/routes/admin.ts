import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ALL_PERMISSIONS,
  branchSchema,
  buildReceiptDoc,
  mergeSettings,
  paymentMethodSchema,
  printerSchema,
  roleSchema,
  userSchema,
  type SaleView,
} from '@flexpos/shared';
import type { AppContext } from '../context.js';
import { audit, hashPassword, invalidateUserCache, pinHash, requireAuth } from '../auth.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { bool, nowIso, num, parseJson, uuid } from '../util.js';
import { bumpCatalog } from '../services/catalog.js';
import type { PrintService } from '../services/printing.js';
import type { BackupService } from '../services/backup.js';
import type { LicenseService } from '../services/license.js';
import { probe } from '../services/escpos.js';
import { networkInterfaces } from 'node:os';

export function adminRoutes(app: FastifyInstance, ctx: AppContext, printer: PrintService, backup: BackupService, license: LicenseService) {
  const auth = (...p: Parameters<typeof requireAuth>[1][]) => ({ preHandler: requireAuth(ctx, ...p) });

  /* ---------- Settings ---------- */
  app.get('/api/settings', auth(), async () => ctx.settings);
  app.put('/api/settings', auth('settings.manage'), async (req) => {
    const patch = z.record(z.string(), z.unknown()).parse(req.body);
    let next;
    try {
      next = mergeSettings(ctx.settings, patch);
    } catch (e) {
      throw badRequest(e instanceof z.ZodError ? `ค่าตั้งค่าไม่ถูกต้อง: ${e.issues[0]?.path.join('.')} ${e.issues[0]?.message}` : 'ค่าตั้งค่าไม่ถูกต้อง');
    }
    const branchCount = num((await ctx.db.selectFrom('branches').select((eb) => eb.fn.countAll<number>().as('n')).where('active', '=', 1).executeTakeFirst())?.n);
    if (next.modules.multiBranch && branchCount > license.status().maxBranches && license.status().state !== 'active')
      throw badRequest('แพ็กเกจปัจจุบันไม่รองรับหลายสาขา');
    await ctx.saveSettings(next);
    await audit(ctx, ctx.db, req, 'settings.update', 'settings', 'app', { keys: Object.keys(patch) });
    bumpCatalog(ctx);
    return next;
  });

  /** Preview the receipt layout with sample data (receipt designer). */
  app.post('/api/settings/receipt-preview', auth('settings.manage'), async (req) => {
    const patch = z.record(z.string(), z.unknown()).parse(req.body ?? {});
    const s = mergeSettings(ctx.settings, patch);
    const sample: SaleView = {
      id: 'preview', docNo: 'R2510-00481', taxInvoiceNo: null, type: 'sale', status: 'completed', createdAt: new Date().toISOString(), userName: 'นภัส', branchName: '', tableName: s.modules.restaurant ? 'A2' : null,
      customer: s.modules.members ? { name: 'คุณสมใจ ใจดี', phone: '0812345678', points: 132 } : null,
      lines: [
        { id: '1', name: 'อเมริกาโน่เย็น', qty: 2, unitPrice: 6500, gross: 13000, lineDiscount: 0, promoDiscount: 0, net: 13000, modifiers: [{ name: 'หวานน้อย', priceDelta: 0 }], note: '' },
        { id: '2', name: 'มัทฉะลาเต้', qty: 1, unitPrice: 8500, gross: 8500, lineDiscount: 0, promoDiscount: 0, net: 8500, modifiers: [], note: 'ไม่ใส่น้ำแข็ง' },
      ],
      subtotal: 21500, discountTotal: 0, billDiscount: 0, promoDiscount: 0, serviceCharge: 0, vatableBase: s.tax.vatEnabled ? 20093 : 0, vat: s.tax.vatEnabled ? 1407 : 0, exemptAmount: 0, rounding: 0, total: 21500, paid: 50000, change: 28500,
      payments: [{ name: 'เงินสด', amount: 21500, kind: 'cash' }], pointsEarned: s.points.enabled ? 8 : 0, pointsRedeemed: 0, promotions: [], taxInvoice: null,
      pricesIncludeVat: s.tax.pricesIncludeVat, vatRate: s.tax.vatRate, vatEnabled: s.tax.vatEnabled, serviceChargeRate: s.tax.serviceChargeRate, voidReason: null,
    };
    return buildReceiptDoc(sample, s);
  });

  /* ---------- Roles ---------- */
  app.get('/api/roles', auth('users.manage'), async () => {
    const roles = await ctx.db.selectFrom('roles').selectAll().orderBy('system', 'desc').orderBy('name').execute();
    const counts = await ctx.db.selectFrom('users').select(['role_id', (eb) => eb.fn.countAll<number>().as('n')]).where('active', '=', 1).groupBy('role_id').execute();
    return roles.map((r) => ({ id: r.id, code: r.code, name: r.name, permissions: parseJson<string[]>(r.permissions, []), system: r.system === 1, userCount: num(counts.find((c) => c.role_id === r.id)?.n) }));
  });
  app.post('/api/roles', auth('users.manage'), async (req) => {
    const b = roleSchema.parse(req.body);
    const id = uuid();
    await ctx.db.insertInto('roles').values({ id, code: `custom_${id.slice(0, 8)}`, name: b.name, permissions: JSON.stringify(b.permissions), system: 0 }).execute();
    await audit(ctx, ctx.db, req, 'role.create', 'role', id, b);
    return { id };
  });
  app.put('/api/roles/:id', auth('users.manage'), async (req) => {
    const { id } = req.params as { id: string };
    const b = roleSchema.parse(req.body);
    const r = await ctx.db.selectFrom('roles').selectAll().where('id', '=', id).executeTakeFirst();
    if (!r) throw notFound('บทบาท');
    // The owner role always keeps every permission so the shop cannot lock itself out.
    const perms = r.code === 'owner' ? ALL_PERMISSIONS : b.permissions;
    await ctx.db.updateTable('roles').set({ name: b.name, permissions: JSON.stringify(perms) }).where('id', '=', id).execute();
    invalidateUserCache();
    await audit(ctx, ctx.db, req, 'role.update', 'role', id, { name: b.name, permissions: perms });
    return { ok: true };
  });
  app.delete('/api/roles/:id', auth('users.manage'), async (req) => {
    const { id } = req.params as { id: string };
    const r = await ctx.db.selectFrom('roles').select(['system', 'code']).where('id', '=', id).executeTakeFirst();
    if (!r) throw notFound('บทบาท');
    if (r.system === 1 || ['owner', 'manager', 'cashier', 'kitchen'].includes(r.code)) throw conflict('ลบบทบาทเริ่มต้นไม่ได้');
    const used = await ctx.db.selectFrom('users').select('id').where('role_id', '=', id).where('active', '=', 1).executeTakeFirst();
    if (used) throw conflict('ยังมีพนักงานใช้บทบาทนี้อยู่');
    await ctx.db.deleteFrom('roles').where('id', '=', id).execute();
    return { ok: true };
  });

  /* ---------- Users ---------- */
  app.get('/api/users', auth('users.manage'), async () => {
    const rows = await ctx.db.selectFrom('users').innerJoin('roles', 'roles.id', 'users.role_id').leftJoin('branches', 'branches.id', 'users.branch_id').select(['users.id', 'users.username', 'users.name', 'users.role_id', 'users.branch_id', 'users.active', 'users.last_login_at', 'users.pin_hash', 'roles.name as role_name', 'roles.code as role_code', 'roles.permissions', 'branches.name as branch_name']).orderBy('users.active', 'desc').orderBy('users.name').execute();
    return rows.map((r) => ({ id: r.id, username: r.username, name: r.name, roleId: r.role_id, roleName: r.role_name, roleCode: r.role_code, branchId: r.branch_id, branchName: r.branch_name, active: r.active === 1, lastLoginAt: r.last_login_at, hasPin: !!r.pin_hash, permissionCount: parseJson<string[]>(r.permissions, []).length }));
  });

  const assertUnique = async (username: string, pin: string | undefined, id: string | null) => {
    let q = ctx.db.selectFrom('users').select('id').where('username', '=', username.toLowerCase());
    if (id) q = q.where('id', '!=', id);
    if (await q.executeTakeFirst()) throw conflict('ชื่อผู้ใช้นี้ถูกใช้แล้ว');
    if (pin) {
      let pq = ctx.db.selectFrom('users').select('id').where('pin_hash', '=', pinHash(ctx.config.secret, pin)).where('active', '=', 1);
      if (id) pq = pq.where('id', '!=', id);
      if (await pq.executeTakeFirst()) throw conflict('PIN นี้ถูกใช้แล้ว กรุณาเลือก PIN อื่น');
    }
  };

  const ensureOwnerRemains = async (id: string, nextRoleId: string, active: boolean) => {
    const owner = await ctx.db.selectFrom('roles').select('id').where('code', '=', 'owner').executeTakeFirst();
    if (!owner) return;
    const cur = await ctx.db.selectFrom('users').select(['role_id']).where('id', '=', id).executeTakeFirst();
    if (cur?.role_id !== owner.id || (nextRoleId === owner.id && active)) return;
    const others = await ctx.db.selectFrom('users').select('id').where('role_id', '=', owner.id).where('active', '=', 1).where('id', '!=', id).executeTakeFirst();
    if (!others) throw conflict('ต้องมีเจ้าของร้านที่ใช้งานอยู่อย่างน้อย 1 คน');
  };

  app.post('/api/users', auth('users.manage'), async (req) => {
    const b = userSchema.parse(req.body);
    if (!b.password) throw badRequest('กรุณาตั้งรหัสผ่าน (อย่างน้อย 8 ตัวอักษร)');
    await assertUnique(b.username, b.pin || undefined, null);
    const id = uuid();
    await ctx.db.insertInto('users').values({ id, username: b.username.toLowerCase(), name: b.name, password_hash: await hashPassword(b.password), pin_hash: b.pin ? pinHash(ctx.config.secret, b.pin) : null, role_id: b.roleId, branch_id: b.branchId ?? null, active: bool(b.active), created_at: nowIso(), last_login_at: null }).execute();
    await audit(ctx, ctx.db, req, 'user.create', 'user', id, { username: b.username, roleId: b.roleId });
    return { id };
  });

  app.put('/api/users/:id', auth('users.manage'), async (req) => {
    const { id } = req.params as { id: string };
    const b = userSchema.parse(req.body);
    await assertUnique(b.username, b.pin || undefined, id);
    await ensureOwnerRemains(id, b.roleId, b.active);
    const set: Record<string, unknown> = { username: b.username.toLowerCase(), name: b.name, role_id: b.roleId, branch_id: b.branchId ?? null, active: bool(b.active) };
    if (b.password) set.password_hash = await hashPassword(b.password);
    if (b.pin) set.pin_hash = pinHash(ctx.config.secret, b.pin);
    await ctx.db.updateTable('users').set(set).where('id', '=', id).execute();
    if (!b.active || b.password) await ctx.db.updateTable('refresh_tokens').set({ revoked: 1 }).where('user_id', '=', id).execute();
    invalidateUserCache();
    await audit(ctx, ctx.db, req, 'user.update', 'user', id, { username: b.username, roleId: b.roleId, active: b.active, passwordChanged: !!b.password, pinChanged: !!b.pin });
    return { ok: true };
  });

  /* ---------- Branches ---------- */
  app.get('/api/branches', auth(), async () => ctx.db.selectFrom('branches').selectAll().orderBy('code').execute());
  app.post('/api/branches', auth('settings.manage'), async (req) => {
    const b = branchSchema.parse(req.body);
    const count = num((await ctx.db.selectFrom('branches').select((eb) => eb.fn.countAll<number>().as('n')).where('active', '=', 1).executeTakeFirst())?.n);
    const lic = license.status();
    if (count >= lic.maxBranches) throw badRequest(`แพ็กเกจ ${lic.plan} ใช้ได้สูงสุด ${lic.maxBranches} สาขา`);
    const dup = await ctx.db.selectFrom('branches').select('id').where('code', '=', b.code).executeTakeFirst();
    if (dup) throw conflict('รหัสสาขาซ้ำ');
    const id = uuid();
    await ctx.db.insertInto('branches').values({ id, code: b.code, name: b.name, address: b.address, phone: b.phone, tax_branch_no: b.taxBranchNo, active: bool(b.active), created_at: nowIso() }).execute();
    await audit(ctx, ctx.db, req, 'branch.create', 'branch', id, b);
    return { id };
  });
  app.put('/api/branches/:id', auth('settings.manage'), async (req) => {
    const b = branchSchema.parse(req.body);
    const { id } = req.params as { id: string };
    const dup = await ctx.db.selectFrom('branches').select('id').where('code', '=', b.code).where('id', '!=', id).executeTakeFirst();
    if (dup) throw conflict('รหัสสาขาซ้ำ');
    if (!b.active && id === ctx.defaultBranchId) throw conflict('ปิดสาขาหลักไม่ได้');
    await ctx.db.updateTable('branches').set({ code: b.code, name: b.name, address: b.address, phone: b.phone, tax_branch_no: b.taxBranchNo, active: bool(b.active) }).where('id', '=', id).execute();
    return { ok: true };
  });

  /* ---------- Payment methods ---------- */
  app.get('/api/payment-methods', auth(), async () => (await ctx.db.selectFrom('payment_methods').selectAll().orderBy('sort').execute()).map((m) => ({ ...m, active: m.active === 1 })));
  app.post('/api/payment-methods', auth('settings.manage'), async (req) => {
    const b = paymentMethodSchema.parse(req.body);
    if (await ctx.db.selectFrom('payment_methods').select('id').where('code', '=', b.code).executeTakeFirst()) throw conflict('รหัสวิธีชำระซ้ำ');
    const id = uuid();
    await ctx.db.insertInto('payment_methods').values({ id, code: b.code, name: b.name, kind: b.kind, active: bool(b.active), sort: b.sort }).execute();
    bumpCatalog(ctx);
    return { id };
  });
  app.put('/api/payment-methods/:id', auth('settings.manage'), async (req) => {
    const b = paymentMethodSchema.parse(req.body);
    const { id } = req.params as { id: string };
    const cur = await ctx.db.selectFrom('payment_methods').select('code').where('id', '=', id).executeTakeFirst();
    if (!cur) throw notFound('วิธีชำระเงิน');
    if (cur.code === 'cash' && !b.active) throw conflict('ปิดการรับเงินสดไม่ได้');
    await ctx.db.updateTable('payment_methods').set({ name: b.name, kind: cur.code === 'cash' ? 'cash' : b.kind, active: bool(b.active), sort: b.sort }).where('id', '=', id).execute();
    bumpCatalog(ctx);
    return { ok: true };
  });

  /* ---------- Printers ---------- */
  app.get('/api/printers', auth(), async () => {
    const rows = await ctx.db.selectFrom('printers').selectAll().orderBy('name').execute();
    const q = await ctx.db.selectFrom('print_jobs').select(['printer_id', (eb) => eb.fn.countAll<number>().as('n')]).where('status', '=', 'queued').groupBy('printer_id').execute();
    return rows.map((p) => ({ id: p.id, branchId: p.branch_id, name: p.name, kind: p.kind, address: p.address, port: p.port, paper: p.paper, role: p.role, categoryIds: parseJson<string[]>(p.category_ids, []), textMode: p.text_mode, openDrawer: p.open_drawer === 1, active: p.active === 1, online: p.online === 1, lastError: p.last_error, queued: num(q.find((x) => x.printer_id === p.id)?.n) }));
  });
  const printerRow = (b: z.infer<typeof printerSchema>) => {
    if (b.kind === 'network' && !b.address) throw badRequest('กรุณากรอก IP ของเครื่องพิมพ์');
    if (b.kind === 'system' && b.role !== 'receipt' && b.role !== 'label') throw badRequest('เครื่องพิมพ์ครัว/บาร์ต้องเป็นเครื่องพิมพ์เครือข่าย (LAN/Wi-Fi) เพื่อพิมพ์อัตโนมัติจากทุกเครื่อง');
    return { name: b.name, kind: b.kind, address: b.address, port: b.port, paper: b.paper, role: b.role, category_ids: JSON.stringify(b.categoryIds), text_mode: b.textMode, open_drawer: bool(b.openDrawer), active: bool(b.active) };
  };
  app.post('/api/printers', auth('settings.manage'), async (req) => {
    const b = printerSchema.parse(req.body);
    const id = uuid();
    const branchId = (req.headers['x-branch-id'] as string | undefined) || ctx.defaultBranchId!;
    await ctx.db.insertInto('printers').values({ id, branch_id: branchId, ...printerRow(b), online: 0, last_error: '' }).execute();
    void printer.probeAll();
    return { id };
  });
  app.put('/api/printers/:id', auth('settings.manage'), async (req) => {
    await ctx.db.updateTable('printers').set(printerRow(printerSchema.parse(req.body))).where('id', '=', (req.params as { id: string }).id).execute();
    void printer.probeAll();
    return { ok: true };
  });
  app.delete('/api/printers/:id', auth('settings.manage'), async (req) => {
    const { id } = req.params as { id: string };
    await ctx.db.updateTable('print_jobs').set({ status: 'failed', error: 'ลบเครื่องพิมพ์' }).where('printer_id', '=', id).where('status', '=', 'queued').execute();
    await ctx.db.deleteFrom('printers').where('id', '=', id).execute();
    return { ok: true };
  });
  app.post('/api/printers/:id/test', auth('settings.manage'), async (req) => {
    const p = await ctx.db.selectFrom('printers').selectAll().where('id', '=', (req.params as { id: string }).id).executeTakeFirst();
    if (!p) throw notFound('เครื่องพิมพ์');
    if (p.kind !== 'network') throw badRequest('ทดสอบเครื่องพิมพ์ระบบได้จากปุ่มพิมพ์ในเบราว์เซอร์');
    try {
      await printer.send(p, {
        paper: p.paper === '58' ? '58' : '80',
        cut: true,
        blocks: [
          { t: 'text', text: 'ทดสอบพิมพ์ FlexPOS', align: 'center', size: 2, bold: true },
          { t: 'text', text: `${p.name} · ${p.address}:${p.port}`, align: 'center' },
          { t: 'line', dashed: true },
          { t: 'row', left: '2× อเมริกาโน่เย็น', right: '130.00' },
          { t: 'row', left: 'ภาษาไทย ก ข ค ง ญ ฎ ฏ ฐ ปู่ ป้า', right: '฿' },
          { t: 'row', left: 'รวม', right: '130.00', bold: true, size: 2 },
          { t: 'qr', data: 'https://flexpos.app', size: 160 },
        ],
      });
      await ctx.db.updateTable('printers').set({ online: 1, last_error: '' }).where('id', '=', p.id).execute();
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await ctx.db.updateTable('printers').set({ online: 0, last_error: msg }).where('id', '=', p.id).execute();
      throw badRequest(msg);
    }
  });
  app.post('/api/printers/:id/retry', auth(), async (req) => {
    await ctx.db.updateTable('print_jobs').set({ attempts: 0 }).where('printer_id', '=', (req.params as { id: string }).id).where('status', '=', 'queued').execute();
    await printer.process();
    return { ok: true };
  });
  /** Scan the local /24 subnet for devices listening on the raw print port 9100. */
  app.post('/api/printers/discover', auth('settings.manage'), async () => {
    const nets = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal);
    const found: string[] = [];
    for (const n of nets.slice(0, 2)) {
      const base = n!.address.split('.').slice(0, 3).join('.');
      const hosts = Array.from({ length: 254 }, (_, i) => `${base}.${i + 1}`).filter((h) => h !== n!.address);
      for (let i = 0; i < hosts.length; i += 64) {
        const batch = hosts.slice(i, i + 64);
        const res = await Promise.all(batch.map((h) => probe(h, 9100, 400).then((ok) => (ok ? h : null))));
        found.push(...res.filter((x): x is string => !!x));
      }
    }
    return { printers: found.map((address) => ({ address, port: 9100 })) };
  });

  /* ---------- Audit ---------- */
  app.get('/api/audit', auth('audit.view'), async (req) => {
    const q = z.object({ action: z.string().optional(), userId: z.string().optional(), from: z.string().optional(), to: z.string().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    let base = ctx.db.selectFrom('audit_logs');
    if (q.action) base = base.where('action', 'like', `${q.action}%`);
    if (q.userId) base = base.where('user_id', '=', q.userId);
    if (q.from) base = base.where('created_at', '>=', new Date(q.from + 'T00:00:00').toISOString());
    if (q.to) base = base.where('created_at', '<=', new Date(q.to + 'T23:59:59.999').toISOString());
    const total = await base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const items = await base.selectAll().orderBy('created_at', 'desc').limit(q.pageSize).offset((q.page - 1) * q.pageSize).execute();
    return { total: num(total?.n), items: items.map((i) => ({ ...i, detail: parseJson(i.detail, {}) })) };
  });

  /* ---------- Backup ---------- */
  app.get('/api/backups', auth('backup.manage'), async () => ({ dir: backup.dir(), items: backup.list() }));
  app.post('/api/backups', auth('backup.manage'), async (req) => {
    const r = await backup.create('manual');
    await audit(ctx, ctx.db, req, 'backup.create', 'backup', r.file.slice(-60), { size: r.size });
    return r;
  });
  app.get('/api/backups/:name', auth('backup.manage'), async (req, reply) => {
    const { name } = req.params as { name: string };
    try {
      const buf = backup.read(name);
      reply.header('content-type', 'application/gzip').header('content-disposition', `attachment; filename="${name}"`);
      return buf;
    } catch (e) {
      throw badRequest(e instanceof Error ? e.message : 'อ่านไฟล์ไม่ได้');
    }
  });
  app.post('/api/backups/restore', auth('backup.manage'), async (req) => {
    const { name } = z.object({ name: z.string().optional() }).parse(req.query);
    let buf: Buffer;
    if (name) buf = backup.read(name);
    else {
      const f = await req.file();
      if (!f) throw badRequest('กรุณาเลือกไฟล์สำรอง (.json.gz)');
      buf = await f.toBuffer();
    }
    try {
      const r = await backup.restore(buf);
      await audit(ctx, ctx.db, req, 'backup.restore', 'backup', name ?? 'upload', r);
      return r;
    } catch (e) {
      throw badRequest(e instanceof Error ? e.message : 'กู้คืนไม่สำเร็จ');
    }
  });

  app.get('/api/license', auth(), async () => license.status());

  app.get('/api/system/info', auth('settings.manage'), async () => {
    const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i!.address);
    return { ips, dataDir: ctx.dataDir, dbKind: ctx.dialect, port: Number(process.env.PORT ?? 4100) };
  });
}
