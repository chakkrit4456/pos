import {
  baseQty,
  buildReceiptDoc,
  computeTender,
  effectiveBillDiscount,
  formatDocNo,
  pointsEarned,
  pointsValue,
  priceCart,
  resolveBasePrice,
  validateModifiers,
  type Catalog,
  type CartLine,
  type PricingConfig,
  type PricingResult,
  type SaleInput,
  type SaleView,
  type SessionUser,
} from '@flexpos/shared';
import { z } from 'zod';
import type { quoteSchema, refundSchema } from '@flexpos/shared';
import type { AppContext, Tx } from '../context.js';
import { audit, authorizeWithPin, hasPerm, nextSeq } from '../auth.js';
import { AppError, badRequest, conflict, notFound } from '../errors.js';
import { bizStamp, nowIso, parseJson, uuid } from '../util.js';
import { buildCatalog, getCatalogVersion } from './catalog.js';
import { loadPromotions } from './promotions.js';
import { moveSaleStock } from './stock.js';
import { tableLabel } from './tables.js';
import type { FastifyRequest } from 'fastify';

const catalogCache = new Map<string, Catalog>();
export async function cachedCatalog(ctx: AppContext, branchId: string): Promise<Catalog> {
  const key = `${branchId}|${getCatalogVersion()}`;
  const hit = catalogCache.get(key);
  if (hit) return hit;
  const c = await buildCatalog(ctx, branchId);
  catalogCache.clear();
  catalogCache.set(key, c);
  return c;
}

export function pricingConfig(ctx: AppContext): PricingConfig {
  const t = ctx.settings.tax;
  return {
    vatEnabled: t.vatEnabled,
    vatRate: t.vatRate,
    pricesIncludeVat: t.pricesIncludeVat,
    serviceChargeRate: ctx.settings.modules.restaurant ? t.serviceChargeRate : 0,
    roundingStep: t.roundingStep,
  };
}

interface ResolvedLine {
  input: SaleInput['lines'][number];
  cart: CartLine;
  sku: string;
  categoryId: string | null;
  baseQty: number;
  modifiers: { id: string; name: string; priceDelta: number }[];
}

interface CustomerCtx {
  id: string;
  groupId: string | null;
  groupPercent: number;
  tierId: string | null;
  pointMultiplier: number;
  points: number;
  creditBalance: number;
  creditLimit: number;
  name: string;
  phone: string;
}

async function loadCustomer(ctx: AppContext, id: string | null | undefined): Promise<CustomerCtx | null> {
  if (!id) return null;
  const c = await ctx.db.selectFrom('customers').selectAll().where('id', '=', id).where('active', '=', 1).executeTakeFirst();
  if (!c) throw notFound('สมาชิก');
  const g = c.group_id ? await ctx.db.selectFrom('customer_groups').selectAll().where('id', '=', c.group_id).executeTakeFirst() : undefined;
  const t = c.tier_id ? await ctx.db.selectFrom('member_tiers').selectAll().where('id', '=', c.tier_id).executeTakeFirst() : undefined;
  return {
    id: c.id,
    groupId: c.group_id,
    groupPercent: g?.discount_percent ?? 0,
    tierId: g?.price_tier_id ?? null,
    pointMultiplier: t?.point_multiplier ?? 1,
    points: c.points,
    creditBalance: c.credit_balance,
    creditLimit: c.credit_limit,
    name: c.name,
    phone: c.phone,
  };
}

/** Resolve client lines against the server catalog; prices are authoritative here. */
function resolveLines(catalog: Catalog, lines: SaleInput['lines'], allowOverride: boolean, priceTierId: string | null): ResolvedLine[] {
  const byId = new Map(catalog.products.map((p) => [p.id, p]));
  return lines.map((l) => {
    const p = byId.get(l.productId);
    if (!p) throw badRequest(`สินค้า “${l.name}” ถูกปิดการขายหรือถูกลบแล้ว`);
    if (p.variants.length > 0 && !l.variantId) throw badRequest(`กรุณาเลือกตัวเลือกของ ${p.name}`);
    if (l.variantId && !p.variants.some((v) => v.id === l.variantId)) throw badRequest(`ตัวเลือกของ ${p.name} ไม่ถูกต้อง`);
    const mods = validateModifiers(p, catalog.modifierGroups, l.modifiers);
    if (!mods.ok) throw badRequest(mods.message);
    let unitPrice: number;
    if (p.kind === 'open_price' || (l.priceOverridden && allowOverride)) unitPrice = l.unitPrice;
    else unitPrice = resolveBasePrice(p, { variantId: l.variantId, unitId: l.unitId, tierId: priceTierId }) + mods.priceDelta;
    if (p.kind !== 'weighted' && !Number.isInteger(l.qty)) throw badRequest(`จำนวนของ ${p.name} ต้องเป็นจำนวนเต็ม`);
    const variant = p.variants.find((v) => v.id === l.variantId);
    const name = variant ? `${p.name} (${variant.name})` : l.unitId ? `${p.name} (${p.units.find((u) => u.id === l.unitId)?.name ?? ''})` : p.name;
    return {
      input: l,
      cart: {
        id: l.id,
        productId: p.id,
        categoryId: p.categoryId,
        name,
        qty: l.qty,
        unitPrice,
        taxable: p.taxable,
        discount: l.discount,
      },
      sku: variant?.sku || p.sku,
      categoryId: p.categoryId,
      baseQty: baseQty(p, l.unitId, l.qty),
      modifiers: mods.names,
    };
  });
}

export async function quote(ctx: AppContext, branchId: string, input: z.infer<typeof quoteSchema>): Promise<PricingResult> {
  const catalog = await cachedCatalog(ctx, branchId);
  const customer = await loadCustomer(ctx, input.customerId);
  const resolved = resolveLines(catalog, input.lines, true, customer?.tierId ?? null);
  const promotions = await loadPromotions(ctx);
  return priceCart({
    lines: resolved.map((r) => r.cart),
    billDiscount: effectiveBillDiscount(input.billDiscount, customer?.groupPercent ?? 0),
    config: pricingConfig(ctx),
    promotions,
    promoContext: { now: new Date(), branchId, customerGroupId: customer?.groupId ?? null, couponCodes: input.couponCodes },
  });
}

async function findOpenShift(tx: Tx, branchId: string, register: string) {
  return tx
    .selectFrom('shifts')
    .selectAll()
    .where('branch_id', '=', branchId)
    .where('register', '=', register)
    .where('status', '=', 'open')
    .executeTakeFirst();
}

export async function createSale(
  ctx: AppContext,
  req: FastifyRequest,
  user: SessionUser,
  branchId: string,
  register: string,
  input: SaleInput,
  license: { canSell(): boolean },
  opts: { offline?: boolean } = {},
): Promise<SaleView> {
  const existing = await ctx.db.selectFrom('sales').select('id').where('id', '=', input.id).executeTakeFirst();
  if (existing) return getSaleView(ctx, input.id); // idempotent retry / offline sync
  if (!license.canSell()) throw new AppError(402, 'license', 'ระยะทดลองใช้หมดแล้ว กรุณาใส่ License key ที่หน้า ตั้งค่า → License');

  const settings = ctx.settings;
  const catalog = await cachedCatalog(ctx, branchId);
  const customer = await loadCustomer(ctx, input.customerId);

  // Permissions that can be granted by a manager PIN
  const needsOverride = input.lines.some((l) => l.priceOverridden);
  const needsDiscount = !!input.billDiscount || input.lines.some((l) => l.discount && l.discount.value > 0);
  let approvedBy: SessionUser | null = null;
  if (needsOverride) approvedBy = await authorizeWithPin(ctx, user, 'pos.price_override', input.managerPin);
  if (needsDiscount) approvedBy = (await authorizeWithPin(ctx, user, 'pos.discount', input.managerPin)) ?? approvedBy;

  const resolved = resolveLines(catalog, input.lines, needsOverride, customer?.tierId ?? null);
  const promotions = await loadPromotions(ctx);
  const created = input.createdAt ? new Date(input.createdAt) : new Date();
  const pricing = priceCart({
    lines: resolved.map((r) => r.cart),
    billDiscount: effectiveBillDiscount(input.billDiscount, customer?.groupPercent ?? 0),
    config: pricingConfig(ctx),
    promotions,
    promoContext: { now: created, branchId, customerGroupId: customer?.groupId ?? null, couponCodes: input.couponCodes },
  });

  // Points redemption is paid as a "points" tender.
  const pointsCfg = settings.points;
  if (input.pointsRedeemed > 0) {
    if (!customer) throw badRequest('ต้องเลือกสมาชิกก่อนใช้แต้ม');
    if (!pointsCfg.enabled) throw badRequest('ระบบแต้มสะสมปิดอยู่');
    if (input.pointsRedeemed > customer.points) throw badRequest(`แต้มไม่พอ (มี ${customer.points} แต้ม)`);
  }
  const pointsAmount = Math.min(pointsValue(input.pointsRedeemed, pointsCfg), pricing.total);

  const methods = new Map(catalog.paymentMethods.map((m) => [m.code, m]));
  const payments = input.payments
    .filter((p) => p.amount > 0)
    .map((p) => {
      const m = methods.get(p.methodCode);
      if (!m || !m.active) throw badRequest(`ไม่พบวิธีชำระเงิน ${p.methodCode}`);
      return { ...p, name: m.name, kind: m.kind };
    });
  if (pointsAmount > 0) payments.push({ methodCode: 'points', amount: pointsAmount, ref: '', name: `แต้มสะสม ${input.pointsRedeemed}`, kind: 'points' });
  const tender = computeTender(
    pricing.total,
    payments.map((p) => ({ method: p.methodCode, amount: p.amount, allowsChange: p.kind === 'cash' })),
  );
  if (!tender.ok) {
    if (tender.due > 0) throw badRequest(`ยอดชำระยังขาดอีก ${(tender.due / 100).toFixed(2)} บาท`);
    throw badRequest('ยอดที่ไม่ใช่เงินสดเกินยอดที่ต้องชำระ');
  }
  const creditAmount = payments.filter((p) => p.kind === 'credit').reduce((a, p) => a + p.amount, 0);
  if (creditAmount > 0) {
    if (!customer) throw badRequest('การค้างชำระต้องเลือกลูกค้าก่อน');
    await authorizeWithPin(ctx, user, 'pos.credit_sale', input.managerPin);
    if (customer.creditLimit > 0 && customer.creditBalance + creditAmount > customer.creditLimit)
      throw badRequest(`เกินวงเงินเครดิตของลูกค้า (คงเหลือ ${((customer.creditLimit - customer.creditBalance) / 100).toFixed(2)} บาท)`);
  }
  if (input.taxInvoice && !settings.tax.vatEnabled) throw badRequest('ร้านยังไม่ได้เปิดใช้ VAT จึงออกใบกำกับภาษีเต็มรูปไม่ได้');

  const stamp = bizStamp(created);
  const earned = customer ? Math.floor(pointsEarned(pricing.total - pointsAmount, pointsCfg) * customer.pointMultiplier) : 0;

  await ctx.db.transaction().execute(async (tx) => {
    const shift = await findOpenShift(tx, branchId, register);
    if (settings.pos.requireShift && !shift && !opts.offline) throw badRequest('ยังไม่ได้เปิดกะ กรุณาเปิดกะก่อนขาย');
    const branch = await tx.selectFrom('branches').select(['code', 'tax_branch_no']).where('id', '=', branchId).executeTakeFirstOrThrow();
    const r = settings.receipt;
    const seq = await nextSeq(tx, `receipt:${branchId}:${stamp.biz_date.slice(0, 7)}`);
    const docNo = formatDocNo(r.receiptPattern, { prefix: r.receiptPrefix + branch.code, branch: branch.code, seq, date: created });
    let taxNo: string | null = null;
    if (input.taxInvoice) {
      const tseq = await nextSeq(tx, `taxinv:${branchId}:${created.getFullYear()}`);
      taxNo = formatDocNo(r.taxInvoicePattern, { prefix: r.taxInvoicePrefix, branch: branch.code, seq: tseq, date: created });
    }
    const dup = await tx.selectFrom('sales').select('id').where('doc_no', '=', docNo).executeTakeFirst();
    if (dup) throw conflict('เลขที่เอกสารซ้ำ กรุณาลองอีกครั้ง');

    const costs = await moveSaleStock(
      ctx,
      tx,
      resolved.map((l) => ({ productId: l.cart.productId, variantId: l.input.variantId ?? null, qty: l.baseQty, name: l.cart.name })),
      { branchId, sign: -1, type: 'sale', refId: input.id, userId: user.id, allowNegative: settings.pos.allowNegativeStock || !!opts.offline },
    );
    let tableName: string | null = null;
    if (input.orderId) {
      const order = await tx.selectFrom('orders').selectAll().where('id', '=', input.orderId).executeTakeFirst();
      if (!order || order.status === 'paid' || order.status === 'cancelled') throw badRequest('บิลโต๊ะนี้ปิดไปแล้ว');
      if (order.table_id) {
        tableName = (await tableLabel(tx, order.table_id)) ?? order.name;
      } else tableName = order.name || null;
      await tx.updateTable('orders').set({ status: 'paid', closed_at: stamp.created_at, sale_id: input.id }).where('id', '=', order.id).execute();
    }

    await tx
      .insertInto('sales')
      .values({
        id: input.id,
        doc_no: docNo,
        tax_invoice_no: taxNo,
        type: 'sale',
        status: creditAmount > 0 ? 'credit' : 'completed',
        ref_sale_id: null,
        branch_id: branchId,
        shift_id: shift?.id ?? null,
        user_id: user.id,
        customer_id: customer?.id ?? null,
        order_id: input.orderId ?? null,
        table_name: tableName,
        subtotal: pricing.subtotal,
        line_discount: pricing.lineDiscountTotal,
        promo_discount: pricing.promoDiscountTotal,
        bill_discount: pricing.billDiscountTotal,
        discount_total: pricing.discountTotal,
        service_charge: pricing.serviceCharge,
        vatable: pricing.vatableBase,
        vat: pricing.vat,
        exempt: pricing.exemptAmount,
        rounding: pricing.rounding,
        total: pricing.total,
        cost_total: costs.reduce((a, b) => a + b, 0),
        paid: tender.paid,
        change_amount: tender.change,
        points_earned: earned,
        points_redeemed: input.pointsRedeemed,
        promotions: JSON.stringify(pricing.appliedPromotions),
        tax_invoice: input.taxInvoice ? JSON.stringify(input.taxInvoice) : null,
        pricing: JSON.stringify({ ...pricingConfig(ctx), billDiscount: input.billDiscount }),
        note: input.note,
        ...stamp,
        voided_at: null,
        voided_by: null,
        void_reason: null,
      })
      .execute();
    for (const [i, l] of resolved.entries()) {
      const pl = pricing.lines[i]!;
      await tx
        .insertInto('sale_lines')
        .values({
          id: uuid(),
          sale_id: input.id,
          product_id: l.cart.productId,
          variant_id: l.input.variantId ?? null,
          category_id: l.categoryId,
          name: l.cart.name,
          sku: l.sku,
          qty: l.cart.qty,
          base_qty: l.baseQty,
          unit_price: l.cart.unitPrice,
          unit_cost: l.cart.qty ? Math.round((costs[i] ?? 0) / l.cart.qty) : 0,
          gross: pl.gross,
          line_discount: pl.lineDiscount,
          promo_discount: pl.promoDiscount,
          bill_discount: pl.billDiscount,
          net: pl.net,
          vat: pl.vat,
          taxable: l.cart.taxable ? 1 : 0,
          modifiers: JSON.stringify(l.modifiers),
          note: l.input.note,
          refunded_qty: 0,
        })
        .execute();
    }
    // Cash is recorded as the applied amount (tendered minus change) so payments sum to the total.
    let changeLeft = tender.change;
    for (const p of payments) {
      let amount = p.amount;
      if (p.kind === 'cash' && changeLeft > 0) {
        const d = Math.min(changeLeft, amount);
        amount -= d;
        changeLeft -= d;
      }
      await tx
        .insertInto('sale_payments')
        .values({
          id: uuid(),
          sale_id: input.id,
          method_code: p.methodCode,
          method_name: p.name,
          kind: p.kind,
          amount,
          ref: p.ref,
          shift_id: shift?.id ?? null,
          biz_date: stamp.biz_date,
          created_at: stamp.created_at,
        })
        .execute();
    }
    if (customer) {
      const delta = earned - input.pointsRedeemed;
      await tx
        .updateTable('customers')
        .set((eb) => ({
          points: eb('points', '+', delta),
          credit_balance: eb('credit_balance', '+', creditAmount),
          total_spent: eb('total_spent', '+', pricing.total),
          visit_count: eb('visit_count', '+', 1),
          last_visit_at: stamp.created_at,
        }))
        .where('id', '=', customer.id)
        .execute();
      if (earned > 0)
        await tx.insertInto('point_moves').values({ id: uuid(), customer_id: customer.id, sale_id: input.id, points: earned, type: 'earn', note: docNo, created_at: stamp.created_at }).execute();
      if (input.pointsRedeemed > 0)
        await tx.insertInto('point_moves').values({ id: uuid(), customer_id: customer.id, sale_id: input.id, points: -input.pointsRedeemed, type: 'redeem', note: docNo, created_at: stamp.created_at }).execute();
      if (creditAmount > 0)
        await tx.insertInto('credit_moves').values({ id: uuid(), customer_id: customer.id, sale_id: input.id, amount: creditAmount, type: 'sale', method: '', note: docNo, user_id: user.id, created_at: stamp.created_at }).execute();
      await upgradeTier(tx, customer.id);
    }
    for (const ap of pricing.appliedPromotions) {
      await tx.updateTable('promotions').set((eb) => ({ usage_count: eb('usage_count', '+', 1) })).where('id', '=', ap.id).execute();
    }
    if (needsOverride || needsDiscount) {
      await audit(ctx, tx, req, needsOverride ? 'sale.price_override' : 'sale.discount', 'sale', input.id, {
        docNo,
        discount: pricing.lineDiscountTotal + pricing.billDiscountTotal,
        approvedBy: approvedBy && approvedBy.id !== user.id ? approvedBy.name : undefined,
      });
    }
  });
  ctx.emit({ type: 'sale.completed', saleId: input.id, branchId });
  if (input.orderId) ctx.emit({ type: 'orders.changed', tableId: null, orderId: input.orderId });
  return getSaleView(ctx, input.id);
}

async function upgradeTier(tx: Tx, customerId: string) {
  const c = await tx.selectFrom('customers').select(['total_spent', 'tier_id']).where('id', '=', customerId).executeTakeFirst();
  if (!c) return;
  const tier = await tx
    .selectFrom('member_tiers')
    .select('id')
    .where('min_spend', '<=', c.total_spent)
    .orderBy('min_spend', 'desc')
    .executeTakeFirst();
  if (tier && tier.id !== c.tier_id) await tx.updateTable('customers').set({ tier_id: tier.id }).where('id', '=', customerId).execute();
}

export async function getSaleView(ctx: AppContext, id: string): Promise<SaleView> {
  const db = ctx.db;
  const s = await db.selectFrom('sales').selectAll().where('id', '=', id).executeTakeFirst();
  if (!s) throw notFound('บิล');
  const [lines, pays, user, branch, customer, ref, productFields] = await Promise.all([
    db.selectFrom('sale_lines').selectAll().where('sale_id', '=', id).execute(),
    db.selectFrom('sale_payments').selectAll().where('sale_id', '=', id).execute(),
    db.selectFrom('users').select('name').where('id', '=', s.user_id).executeTakeFirst(),
    db.selectFrom('branches').select('name').where('id', '=', s.branch_id).executeTakeFirst(),
    s.customer_id ? db.selectFrom('customers').select(['name', 'phone', 'points']).where('id', '=', s.customer_id).executeTakeFirst() : undefined,
    s.ref_sale_id ? db.selectFrom('sales').select('doc_no').where('id', '=', s.ref_sale_id).executeTakeFirst() : undefined,
    db.selectFrom('custom_fields').selectAll().where('entity', '=', 'product').where('show_on_receipt', '=', 1).execute(),
  ]);
  const customByProduct = new Map<string, Record<string, string>>();
  if (productFields.length) {
    const prods = await db.selectFrom('products').select(['id', 'custom']).where('id', 'in', [...new Set(lines.map((l) => l.product_id))]).execute();
    for (const p of prods) {
      const c = parseJson<Record<string, unknown>>(p.custom, {});
      const out: Record<string, string> = {};
      for (const f of productFields) if (c[f.field_key] != null && c[f.field_key] !== '') out[f.label] = String(c[f.field_key]);
      customByProduct.set(p.id, out);
    }
  }
  const pricing = parseJson<PricingConfig>(s.pricing, pricingConfig(ctx));
  return {
    id: s.id,
    docNo: s.doc_no,
    taxInvoiceNo: s.tax_invoice_no,
    type: s.type as SaleView['type'],
    status: s.status,
    createdAt: s.created_at,
    userName: user?.name ?? '',
    branchName: ctx.settings.modules.multiBranch ? (branch?.name ?? '') : '',
    tableName: s.table_name,
    customer: customer ? { name: customer.name, phone: customer.phone, points: customer.points } : null,
    lines: lines.map((l) => ({
      id: l.id,
      name: l.name,
      qty: l.qty,
      unitPrice: l.unit_price,
      gross: l.gross,
      lineDiscount: l.line_discount,
      promoDiscount: l.promo_discount,
      net: l.net,
      modifiers: parseJson<{ name: string; priceDelta: number }[]>(l.modifiers, []),
      note: l.note,
      custom: customByProduct.get(l.product_id),
    })),
    subtotal: s.subtotal,
    discountTotal: s.discount_total,
    billDiscount: s.bill_discount,
    promoDiscount: s.promo_discount,
    serviceCharge: s.service_charge,
    vatableBase: s.vatable,
    vat: s.vat,
    exemptAmount: s.exempt,
    rounding: s.rounding,
    total: s.total,
    paid: s.paid,
    change: s.change_amount,
    payments: pays.map((p) => ({ name: p.method_name, amount: p.amount, kind: p.kind })),
    pointsEarned: s.points_earned,
    pointsRedeemed: s.points_redeemed,
    promotions: parseJson<{ name: string; amount: number }[]>(s.promotions, []),
    taxInvoice: parseJson(s.tax_invoice, null),
    pricesIncludeVat: pricing.pricesIncludeVat,
    vatRate: pricing.vatRate,
    vatEnabled: pricing.vatEnabled,
    serviceChargeRate: pricing.serviceChargeRate,
    voidReason: s.void_reason,
    refOfDocNo: ref?.doc_no ?? null,
  };
}

export function receiptFor(ctx: AppContext, sale: SaleView, reprint = false) {
  return buildReceiptDoc(sale, ctx.settings, { reprint });
}

/** Cancel a whole bill: reverse stock, points, credit. */
export async function voidSale(ctx: AppContext, req: FastifyRequest, user: SessionUser, id: string, reason: string, managerPin?: string) {
  const approver = await authorizeWithPin(ctx, user, 'pos.void', managerPin);
  await ctx.db.transaction().execute(async (tx) => {
    const s = await tx.selectFrom('sales').selectAll().where('id', '=', id).executeTakeFirst();
    if (!s) throw notFound('บิล');
    if (s.type !== 'sale') throw badRequest('ยกเลิกได้เฉพาะบิลขาย');
    if (s.status === 'voided') throw badRequest('บิลนี้ถูกยกเลิกไปแล้ว');
    const refunds = await tx.selectFrom('sales').select('id').where('ref_sale_id', '=', id).where('status', '!=', 'voided').executeTakeFirst();
    if (refunds) throw badRequest('บิลนี้มีการคืนสินค้าแล้ว ใช้การคืนสินค้าแทนการยกเลิก');
    const lines = await tx.selectFrom('sale_lines').selectAll().where('sale_id', '=', id).execute();
    await reverseStockForLines(ctx, tx, s.branch_id, user.id, id, lines.map((l) => ({ line: l, qty: l.qty })), 'void');
    if (s.customer_id) {
      const credit = await tx.selectFrom('sale_payments').select('amount').where('sale_id', '=', id).where('kind', '=', 'credit').execute();
      const creditAmt = credit.reduce((a, c) => a + c.amount, 0);
      await tx
        .updateTable('customers')
        .set((eb) => ({
          points: eb('points', '+', s.points_redeemed - s.points_earned),
          credit_balance: eb('credit_balance', '-', creditAmt),
          total_spent: eb('total_spent', '-', s.total),
          visit_count: eb('visit_count', '-', 1),
        }))
        .where('id', '=', s.customer_id)
        .execute();
      const now = nowIso();
      if (s.points_earned || s.points_redeemed)
        await tx.insertInto('point_moves').values({ id: uuid(), customer_id: s.customer_id, sale_id: id, points: s.points_redeemed - s.points_earned, type: 'void', note: s.doc_no, created_at: now }).execute();
      if (creditAmt)
        await tx.insertInto('credit_moves').values({ id: uuid(), customer_id: s.customer_id, sale_id: id, amount: -creditAmt, type: 'void', method: '', note: s.doc_no, user_id: user.id, created_at: now }).execute();
    }
    await tx.updateTable('sales').set({ status: 'voided', voided_at: nowIso(), voided_by: approver.id, void_reason: reason }).where('id', '=', id).execute();
    await audit(ctx, tx, req, 'sale.void', 'sale', id, { docNo: s.doc_no, total: s.total, reason, approvedBy: approver.name });
  });
  return getSaleView(ctx, id);
}

async function reverseStockForLines(
  ctx: AppContext,
  tx: Tx,
  branchId: string,
  userId: string,
  refId: string,
  items: { line: { product_id: string; variant_id: string | null; qty: number; base_qty: number; name: string }; qty: number }[],
  type: 'void' | 'refund',
) {
  await moveSaleStock(
    ctx,
    tx,
    items.map(({ line, qty }) => ({
      productId: line.product_id,
      variantId: line.variant_id,
      qty: line.qty ? (line.base_qty * qty) / line.qty : qty,
      name: line.name,
    })),
    { branchId, sign: 1, type, refId, userId, allowNegative: true },
  );
}

export async function refundSale(
  ctx: AppContext,
  req: FastifyRequest,
  user: SessionUser,
  saleId: string,
  input: z.infer<typeof refundSchema>,
  register: string,
): Promise<SaleView> {
  const exists = await ctx.db.selectFrom('sales').select('id').where('id', '=', input.id).executeTakeFirst();
  if (exists) return getSaleView(ctx, input.id);
  const approver = await authorizeWithPin(ctx, user, 'pos.refund', input.managerPin);
  const now = new Date();
  const stamp = bizStamp(now);
  await ctx.db.transaction().execute(async (tx) => {
    const s = await tx.selectFrom('sales').selectAll().where('id', '=', saleId).executeTakeFirst();
    if (!s) throw notFound('บิล');
    if (s.type !== 'sale' || s.status === 'voided') throw badRequest('บิลนี้คืนสินค้าไม่ได้');
    const lines = await tx.selectFrom('sale_lines').selectAll().where('sale_id', '=', saleId).execute();
    const method = await tx.selectFrom('payment_methods').selectAll().where('code', '=', input.methodCode).executeTakeFirst();
    if (!method) throw badRequest('ไม่พบวิธีคืนเงิน');
    const shift = await findOpenShift(tx, s.branch_id, register);
    const picked = input.lines.map((r) => {
      const l = lines.find((x) => x.id === r.lineId);
      if (!l) throw badRequest('ไม่พบรายการในบิล');
      if (r.qty > l.qty - l.refunded_qty + 1e-9) throw badRequest(`คืน “${l.name}” ได้ไม่เกิน ${l.qty - l.refunded_qty}`);
      return { line: l, qty: r.qty, ratio: r.qty / l.qty };
    });
    const part = (v: number, ratio: number) => Math.round(v * ratio);
    const totals = picked.reduce(
      (a, p) => {
        a.gross += part(p.line.gross, p.ratio);
        a.net += part(p.line.net, p.ratio);
        a.vat += part(p.line.vat, p.ratio);
        a.cost += part(p.line.unit_cost * p.line.qty, p.ratio);
        a.disc += part(p.line.line_discount + p.line.promo_discount + p.line.bill_discount, p.ratio);
        a.exempt += p.line.taxable ? 0 : part(p.line.net, p.ratio);
        return a;
      },
      { gross: 0, net: 0, vat: 0, cost: 0, disc: 0, exempt: 0 },
    );
    // Service charge refunded proportionally to net.
    const svc = s.subtotal - s.discount_total > 0 ? Math.round((s.service_charge * totals.net) / (s.subtotal - s.discount_total)) : 0;
    const pricing = parseJson<PricingConfig>(s.pricing, pricingConfig(ctx));
    const total = totals.net + svc + (pricing.vatEnabled && !pricing.pricesIncludeVat ? totals.vat : 0);
    const branch = await tx.selectFrom('branches').select('code').where('id', '=', s.branch_id).executeTakeFirstOrThrow();
    const seq = await nextSeq(tx, `refund:${s.branch_id}:${stamp.biz_date.slice(0, 7)}`);
    const docNo = formatDocNo('{prefix}{yy}{mm}-{seq:5}', { prefix: 'CN' + branch.code, branch: branch.code, seq, date: now });
    const ratioAll = s.total > 0 ? total / s.total : 0;
    const pointsBack = Math.round(s.points_earned * ratioAll);

    await tx
      .insertInto('sales')
      .values({
        id: input.id,
        doc_no: docNo,
        tax_invoice_no: null,
        type: 'refund',
        status: 'completed',
        ref_sale_id: s.id,
        branch_id: s.branch_id,
        shift_id: shift?.id ?? null,
        user_id: user.id,
        customer_id: s.customer_id,
        order_id: null,
        table_name: null,
        subtotal: totals.gross,
        line_discount: 0,
        promo_discount: 0,
        bill_discount: totals.disc,
        discount_total: totals.disc,
        service_charge: svc,
        vatable: pricing.vatEnabled ? (pricing.pricesIncludeVat ? totals.net - totals.exempt + svc - totals.vat : totals.net - totals.exempt + svc) : 0,
        vat: totals.vat,
        exempt: totals.exempt,
        rounding: 0,
        total,
        cost_total: input.restock ? totals.cost : 0,
        paid: total,
        change_amount: 0,
        points_earned: -pointsBack,
        points_redeemed: 0,
        promotions: '[]',
        tax_invoice: s.tax_invoice,
        pricing: s.pricing,
        note: input.reason,
        ...stamp,
        voided_at: null,
        voided_by: null,
        void_reason: null,
      })
      .execute();
    for (const p of picked) {
      await tx
        .insertInto('sale_lines')
        .values({
          id: uuid(),
          sale_id: input.id,
          product_id: p.line.product_id,
          variant_id: p.line.variant_id,
          category_id: p.line.category_id,
          name: p.line.name,
          sku: p.line.sku,
          qty: p.qty,
          base_qty: p.line.qty ? (p.line.base_qty * p.qty) / p.line.qty : p.qty,
          unit_price: p.line.unit_price,
          unit_cost: p.line.unit_cost,
          gross: part(p.line.gross, p.ratio),
          line_discount: 0,
          promo_discount: 0,
          bill_discount: part(p.line.line_discount + p.line.promo_discount + p.line.bill_discount, p.ratio),
          net: part(p.line.net, p.ratio),
          vat: part(p.line.vat, p.ratio),
          taxable: p.line.taxable,
          modifiers: p.line.modifiers,
          note: '',
          refunded_qty: 0,
        })
        .execute();
      await tx.updateTable('sale_lines').set({ refunded_qty: p.line.refunded_qty + p.qty }).where('id', '=', p.line.id).execute();
    }
    await tx
      .insertInto('sale_payments')
      .values({
        id: uuid(),
        sale_id: input.id,
        method_code: method.code,
        method_name: method.name,
        kind: method.kind,
        amount: total,
        ref: '',
        shift_id: shift?.id ?? null,
        biz_date: stamp.biz_date,
        created_at: stamp.created_at,
      })
      .execute();
    if (input.restock) await reverseStockForLines(ctx, tx, s.branch_id, user.id, input.id, picked, 'refund');
    if (s.customer_id) {
      const creditBack = method.kind === 'credit' ? total : 0;
      await tx
        .updateTable('customers')
        .set((eb) => ({
          points: eb('points', '-', pointsBack),
          total_spent: eb('total_spent', '-', total),
          credit_balance: eb('credit_balance', '-', creditBack),
        }))
        .where('id', '=', s.customer_id)
        .execute();
      if (pointsBack)
        await tx.insertInto('point_moves').values({ id: uuid(), customer_id: s.customer_id, sale_id: input.id, points: -pointsBack, type: 'refund', note: docNo, created_at: stamp.created_at }).execute();
      if (creditBack)
        await tx.insertInto('credit_moves').values({ id: uuid(), customer_id: s.customer_id, sale_id: input.id, amount: -creditBack, type: 'refund', method: '', note: docNo, user_id: user.id, created_at: stamp.created_at }).execute();
    }
    const allLines = await tx.selectFrom('sale_lines').select(['qty', 'refunded_qty']).where('sale_id', '=', s.id).execute();
    const full = allLines.every((l) => l.refunded_qty >= l.qty - 1e-9);
    await tx.updateTable('sales').set({ status: full ? 'refunded' : 'partial_refund' }).where('id', '=', s.id).execute();
    await audit(ctx, tx, req, 'sale.refund', 'sale', s.id, { docNo: s.doc_no, refundDoc: docNo, total, reason: input.reason, approvedBy: approver.name });
  });
  return getSaleView(ctx, input.id);
}

export { hasPerm };
