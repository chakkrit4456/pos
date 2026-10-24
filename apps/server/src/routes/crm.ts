import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { customerGroupSchema, customerSchema, memberTierSchema, promotionSchema, supplierSchema } from '@flexpos/shared';
import { ilike } from '@flexpos/db';
import type { AppContext } from '../context.js';
import { audit, nextSeq, requireAuth } from '../auth.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { bool, nowIso, num, parseJson, uuid } from '../util.js';
import { validateCustom } from '../services/catalog.js';
import { rowToRule } from '../services/promotions.js';

export function crmRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = (...p: Parameters<typeof requireAuth>[1][]) => ({ preHandler: requireAuth(ctx, ...p) });

  /* ---------- Customers ---------- */
  app.get('/api/customers', auth('customers.view'), async (req) => {
    const q = z.object({ q: z.string().optional(), groupId: z.string().optional(), debt: z.coerce.boolean().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    let base = ctx.db.selectFrom('customers').leftJoin('customer_groups', 'customer_groups.id', 'customers.group_id').leftJoin('member_tiers', 'member_tiers.id', 'customers.tier_id').where('customers.active', '=', 1);
    if (q.q) {
      const t = `%${q.q.trim()}%`;
      const like = ilike(ctx.dialect);
      base = base.where((eb) => eb.or([eb('customers.name', like, t), eb('customers.phone', like, t), eb('customers.code', like, t), eb('customers.tax_id', like, t)]));
    }
    if (q.groupId) base = base.where('customers.group_id', '=', q.groupId);
    if (q.debt) base = base.where('customers.credit_balance', '>', 0);
    const total = await base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const items = await base
      .select(['customers.id', 'customers.code', 'customers.name', 'customers.phone', 'customers.points', 'customers.credit_balance', 'customers.total_spent', 'customers.visit_count', 'customers.last_visit_at', 'customers.group_id', 'customers.tier_id', 'customer_groups.name as group_name', 'customer_groups.discount_percent', 'member_tiers.name as tier_name', 'customers.tax_id'])
      .orderBy('customers.last_visit_at', 'desc')
      .orderBy('customers.name')
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .execute();
    return { total: num(total?.n), items };
  });

  app.get('/api/customers/:id', auth('customers.view'), async (req) => {
    const { id } = req.params as { id: string };
    const c = await ctx.db.selectFrom('customers').selectAll().where('id', '=', id).executeTakeFirst();
    if (!c) throw notFound('ลูกค้า');
    const [points, credits, sales] = await Promise.all([
      ctx.db.selectFrom('point_moves').selectAll().where('customer_id', '=', id).orderBy('created_at', 'desc').limit(50).execute(),
      ctx.db.selectFrom('credit_moves').selectAll().where('customer_id', '=', id).orderBy('created_at', 'desc').limit(50).execute(),
      ctx.db.selectFrom('sales').select(['id', 'doc_no', 'type', 'status', 'total', 'created_at']).where('customer_id', '=', id).orderBy('created_at', 'desc').limit(50).execute(),
    ]);
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      phone: c.phone,
      email: c.email,
      birthday: c.birthday,
      groupId: c.group_id,
      tierId: c.tier_id,
      points: c.points,
      creditBalance: c.credit_balance,
      creditLimit: c.credit_limit,
      taxId: c.tax_id,
      taxBranch: c.tax_branch,
      taxName: c.tax_name,
      address: c.address,
      note: c.note,
      custom: parseJson<Record<string, unknown>>(c.custom, {}),
      totalSpent: c.total_spent,
      visitCount: c.visit_count,
      lastVisitAt: c.last_visit_at,
      createdAt: c.created_at,
      active: c.active === 1,
      pointMoves: points,
      creditMoves: credits,
      sales,
    };
  });

  const customerRow = async (b: z.infer<typeof customerSchema>) => ({
    code: b.code,
    name: b.name,
    phone: b.phone.replace(/[^\d+]/g, ''),
    email: b.email,
    birthday: b.birthday,
    group_id: b.groupId ?? null,
    tier_id: b.tierId ?? null,
    credit_limit: b.creditLimit,
    tax_id: b.taxId,
    tax_branch: b.taxBranch,
    tax_name: b.taxName,
    address: b.address,
    note: b.note,
    custom: JSON.stringify(await validateCustom(ctx, 'customer', b.custom)),
    active: bool(b.active),
  });

  const assertPhoneFree = async (phone: string, id: string | null) => {
    const p = phone.replace(/[^\d+]/g, '');
    if (!p) return;
    let q = ctx.db.selectFrom('customers').select(['id', 'name']).where('phone', '=', p).where('active', '=', 1);
    if (id) q = q.where('id', '!=', id);
    const dup = await q.executeTakeFirst();
    if (dup) throw conflict(`เบอร์นี้เป็นของสมาชิก “${dup.name}” อยู่แล้ว`);
  };

  app.post('/api/customers', auth('customers.manage'), async (req) => {
    const b = customerSchema.parse(req.body);
    await assertPhoneFree(b.phone, null);
    const id = uuid();
    const row = await customerRow(b);
    if (!row.code) row.code = `M${String(await nextSeq(ctx.db, 'customer')).padStart(5, '0')}`;
    await ctx.db.insertInto('customers').values({ id, ...row, points: 0, credit_balance: 0, total_spent: 0, visit_count: 0, last_visit_at: null, created_at: nowIso() }).execute();
    return { id };
  });

  app.put('/api/customers/:id', auth('customers.manage'), async (req) => {
    const { id } = req.params as { id: string };
    const b = customerSchema.parse(req.body);
    await assertPhoneFree(b.phone, id);
    await ctx.db.updateTable('customers').set(await customerRow(b)).where('id', '=', id).execute();
    return { id };
  });

  app.delete('/api/customers/:id', auth('customers.manage'), async (req) => {
    const { id } = req.params as { id: string };
    const c = await ctx.db.selectFrom('customers').select(['credit_balance', 'name']).where('id', '=', id).executeTakeFirst();
    if (!c) throw notFound('ลูกค้า');
    if (c.credit_balance > 0) throw conflict('ลูกค้ายังมียอดค้างชำระ ลบไม่ได้');
    await ctx.db.updateTable('customers').set({ active: 0, phone: '' }).where('id', '=', id).execute();
    await audit(ctx, ctx.db, req, 'customer.delete', 'customer', id, { name: c.name });
    return { ok: true };
  });

  app.post('/api/customers/:id/points', auth('customers.manage'), async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ points: z.number().int(), note: z.string().trim().min(1).max(200) }).parse(req.body);
    await ctx.db.transaction().execute(async (tx) => {
      const c = await tx.selectFrom('customers').select('points').where('id', '=', id).executeTakeFirst();
      if (!c) throw notFound('ลูกค้า');
      if (c.points + b.points < 0) throw badRequest('แต้มคงเหลือติดลบไม่ได้');
      await tx.updateTable('customers').set({ points: c.points + b.points }).where('id', '=', id).execute();
      await tx.insertInto('point_moves').values({ id: uuid(), customer_id: id, sale_id: null, points: b.points, type: 'adjust', note: b.note, created_at: nowIso() }).execute();
      await audit(ctx, tx, req, 'customer.points_adjust', 'customer', id, b);
    });
    return { ok: true };
  });

  /* ---------- Groups & tiers ---------- */
  app.get('/api/customer-groups', auth(), async () => ctx.db.selectFrom('customer_groups').selectAll().orderBy('name').execute());
  app.post('/api/customer-groups', auth('customers.manage'), async (req) => {
    const b = customerGroupSchema.parse(req.body);
    const id = uuid();
    await ctx.db.insertInto('customer_groups').values({ id, name: b.name, discount_percent: b.discountPercent, price_tier_id: b.priceTierId ?? null }).execute();
    return { id };
  });
  app.put('/api/customer-groups/:id', auth('customers.manage'), async (req) => {
    const b = customerGroupSchema.parse(req.body);
    await ctx.db.updateTable('customer_groups').set({ name: b.name, discount_percent: b.discountPercent, price_tier_id: b.priceTierId ?? null }).where('id', '=', (req.params as { id: string }).id).execute();
    return { ok: true };
  });
  app.delete('/api/customer-groups/:id', auth('customers.manage'), async (req) => {
    const { id } = req.params as { id: string };
    await ctx.db.updateTable('customers').set({ group_id: null }).where('group_id', '=', id).execute();
    await ctx.db.deleteFrom('customer_groups').where('id', '=', id).execute();
    return { ok: true };
  });

  app.get('/api/member-tiers', auth(), async () => ctx.db.selectFrom('member_tiers').selectAll().orderBy('min_spend').execute());
  app.post('/api/member-tiers', auth('customers.manage'), async (req) => {
    const b = memberTierSchema.parse(req.body);
    const id = uuid();
    await ctx.db.insertInto('member_tiers').values({ id, name: b.name, min_spend: b.minSpend, point_multiplier: b.pointMultiplier }).execute();
    return { id };
  });
  app.put('/api/member-tiers/:id', auth('customers.manage'), async (req) => {
    const b = memberTierSchema.parse(req.body);
    await ctx.db.updateTable('member_tiers').set({ name: b.name, min_spend: b.minSpend, point_multiplier: b.pointMultiplier }).where('id', '=', (req.params as { id: string }).id).execute();
    return { ok: true };
  });
  app.delete('/api/member-tiers/:id', auth('customers.manage'), async (req) => {
    const { id } = req.params as { id: string };
    await ctx.db.updateTable('customers').set({ tier_id: null }).where('tier_id', '=', id).execute();
    await ctx.db.deleteFrom('member_tiers').where('id', '=', id).execute();
    return { ok: true };
  });

  /* ---------- Suppliers ---------- */
  app.get('/api/suppliers', auth('stock.view'), async (req) => {
    const { q } = z.object({ q: z.string().optional() }).parse(req.query);
    let base = ctx.db.selectFrom('suppliers').selectAll().where('active', '=', 1);
    if (q) base = base.where('name', ilike(ctx.dialect), `%${q}%`);
    return (await base.orderBy('name').execute()).map((s) => ({ ...s, custom: parseJson(s.custom, {}) }));
  });
  const supplierRow = async (b: z.infer<typeof supplierSchema>) => ({
    name: b.name,
    contact: b.contact,
    phone: b.phone,
    email: b.email,
    tax_id: b.taxId,
    address: b.address,
    custom: JSON.stringify(await validateCustom(ctx, 'supplier', b.custom)),
    active: bool(b.active),
  });
  app.post('/api/suppliers', auth('stock.manage'), async (req) => {
    const id = uuid();
    await ctx.db.insertInto('suppliers').values({ id, ...(await supplierRow(supplierSchema.parse(req.body))), created_at: nowIso() }).execute();
    return { id };
  });
  app.put('/api/suppliers/:id', auth('stock.manage'), async (req) => {
    await ctx.db.updateTable('suppliers').set(await supplierRow(supplierSchema.parse(req.body))).where('id', '=', (req.params as { id: string }).id).execute();
    return { ok: true };
  });
  app.delete('/api/suppliers/:id', auth('stock.manage'), async (req) => {
    await ctx.db.updateTable('suppliers').set({ active: 0 }).where('id', '=', (req.params as { id: string }).id).execute();
    return { ok: true };
  });

  /* ---------- Promotions ---------- */
  app.get('/api/promotions', auth(), async () => {
    const rows = await ctx.db.selectFrom('promotions').selectAll().orderBy('priority', 'desc').orderBy('created_at', 'desc').execute();
    return rows.map((r) => ({ ...rowToRule(r), usageCount: r.usage_count, usageLimit: r.usage_limit }));
  });
  const promoRow = (b: z.infer<typeof promotionSchema>) => {
    if (b.type === 'bxgy' && (b.buyQty < 1 || b.getQty < 1)) throw badRequest('ซื้อ X แถม Y ต้องกำหนดจำนวนซื้อและจำนวนแถมอย่างน้อย 1');
    if (b.type === 'percent' && b.value > 100) throw badRequest('ส่วนลดเปอร์เซ็นต์ต้องไม่เกิน 100');
    if (b.type === 'threshold' && b.minSubtotal <= 0) throw badRequest('โปรซื้อครบยอดต้องกำหนดยอดขั้นต่ำ');
    if (b.startsAt && b.endsAt && b.startsAt > b.endsAt) throw badRequest('วันเริ่มต้องไม่หลังวันสิ้นสุด');
    if ((b.timeFrom && !b.timeTo) || (!b.timeFrom && b.timeTo)) throw badRequest('กรุณากำหนดทั้งเวลาเริ่มและเวลาสิ้นสุด');
    return {
      name: b.name,
      type: b.type,
      priority: b.priority,
      exclusive: bool(b.exclusive),
      value: b.value,
      scope: b.scope,
      product_ids: JSON.stringify(b.productIds),
      category_ids: JSON.stringify(b.categoryIds),
      customer_group_ids: JSON.stringify(b.customerGroupIds),
      branch_ids: JSON.stringify(b.branchIds),
      buy_qty: b.buyQty,
      get_qty: b.getQty,
      get_discount_percent: b.getDiscountPercent,
      min_subtotal: b.minSubtotal,
      max_discount: b.maxDiscount,
      coupon_code: b.couponCode ? b.couponCode.trim() : null,
      usage_limit: b.usageLimit,
      starts_at: b.startsAt,
      ends_at: b.endsAt,
      days_of_week: JSON.stringify(b.daysOfWeek),
      time_from: b.timeFrom,
      time_to: b.timeTo,
      active: bool(b.active),
    };
  };
  app.post('/api/promotions', auth('promotions.manage'), async (req) => {
    const b = promotionSchema.parse(req.body);
    const id = uuid();
    await ctx.db.insertInto('promotions').values({ id, ...promoRow(b), usage_count: 0, created_at: nowIso() }).execute();
    await audit(ctx, ctx.db, req, 'promotion.create', 'promotion', id, { name: b.name });
    return { id };
  });
  app.put('/api/promotions/:id', auth('promotions.manage'), async (req) => {
    const { id } = req.params as { id: string };
    const b = promotionSchema.parse(req.body);
    await ctx.db.updateTable('promotions').set(promoRow(b)).where('id', '=', id).execute();
    await audit(ctx, ctx.db, req, 'promotion.update', 'promotion', id, { name: b.name });
    return { ok: true };
  });
  app.delete('/api/promotions/:id', auth('promotions.manage'), async (req) => {
    const { id } = req.params as { id: string };
    await ctx.db.deleteFrom('promotions').where('id', '=', id).execute();
    await audit(ctx, ctx.db, req, 'promotion.delete', 'promotion', id);
    return { ok: true };
  });
}
