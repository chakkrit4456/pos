import type { AppContext, Tx } from '../context.js';
import { badRequest } from '../errors.js';
import { nowIso, roundCost, uuid } from '../util.js';

export interface MoveInput {
  productId: string;
  variantId?: string | null;
  branchId: string;
  /** signed quantity in base units */
  qty: number;
  type: 'sale' | 'refund' | 'void' | 'receive' | 'adjust' | 'count' | 'transfer_in' | 'transfer_out';
  /** Cost of incoming goods (satang per base unit). Updates moving average for inbound moves. */
  unitCost?: number;
  refType: string;
  refId: string;
  note?: string;
  userId: string | null;
  lotNo?: string;
  expiryDate?: string;
  /** when false, block moves that would make stock negative */
  allowNegative: boolean;
  productName?: string;
}

export interface MoveResult {
  balance: number;
  avgCost: number;
}

/** Apply one stock movement: ledger entry + level + moving-average cost. Never edit levels directly. */
export async function applyMove(ctx: AppContext, tx: Tx, m: MoveInput): Promise<MoveResult> {
  const variant = m.variantId ?? '';
  const now = nowIso();
  let level = await tx
    .selectFrom('stock_levels')
    .selectAll()
    .where('product_id', '=', m.productId)
    .where('variant_id', '=', variant)
    .where('branch_id', '=', m.branchId)
    .executeTakeFirst();
  if (!level) {
    const p = await tx.selectFrom('products').select('cost').where('id', '=', m.productId).executeTakeFirst();
    const v = variant
      ? await tx.selectFrom('product_variants').select('cost').where('id', '=', variant).executeTakeFirst()
      : undefined;
    level = {
      id: uuid(),
      product_id: m.productId,
      variant_id: variant,
      branch_id: m.branchId,
      qty: 0,
      avg_cost: v?.cost || p?.cost || 0,
      updated_at: now,
    };
    await tx.insertInto('stock_levels').values(level).execute();
  }
  const oldQty = level.qty;
  const newQty = Math.round((oldQty + m.qty) * 1000) / 1000;
  if (!m.allowNegative && m.qty < 0 && newQty < 0) {
    throw badRequest(`สต็อกไม่พอ: ${m.productName ?? 'สินค้า'} คงเหลือ ${oldQty}`);
  }
  let avg = level.avg_cost;
  const inbound = m.qty > 0 && (m.type === 'receive' || m.type === 'transfer_in' || m.type === 'adjust' || m.type === 'count');
  if (inbound && m.unitCost !== undefined && m.unitCost > 0) {
    avg = oldQty > 0 ? roundCost((oldQty * avg + m.qty * m.unitCost) / (oldQty + m.qty)) : m.unitCost;
  }
  await tx
    .updateTable('stock_levels')
    .set({ qty: newQty, avg_cost: avg, updated_at: now })
    .where('id', '=', level.id)
    .execute();
  await tx
    .insertInto('stock_moves')
    .values({
      id: uuid(),
      product_id: m.productId,
      variant_id: variant,
      branch_id: m.branchId,
      type: m.type,
      qty: m.qty,
      unit_cost: m.unitCost ?? avg,
      balance_after: newQty,
      ref_type: m.refType,
      ref_id: m.refId,
      lot_no: m.lotNo ?? '',
      expiry_date: m.expiryDate ?? '',
      note: m.note ?? '',
      user_id: m.userId,
      created_at: now,
    })
    .execute();
  if (ctx.settings.modules.lotTracking) await applyLots(tx, m, variant);
  return { balance: newQty, avgCost: avg };
}

async function applyLots(tx: Tx, m: MoveInput, variant: string) {
  if (m.qty > 0 && m.lotNo) {
    const lot = await tx
      .selectFrom('stock_lots')
      .selectAll()
      .where('product_id', '=', m.productId)
      .where('variant_id', '=', variant)
      .where('branch_id', '=', m.branchId)
      .where('lot_no', '=', m.lotNo)
      .executeTakeFirst();
    if (lot) await tx.updateTable('stock_lots').set({ qty: lot.qty + m.qty }).where('id', '=', lot.id).execute();
    else
      await tx
        .insertInto('stock_lots')
        .values({
          id: uuid(),
          product_id: m.productId,
          variant_id: variant,
          branch_id: m.branchId,
          lot_no: m.lotNo,
          expiry_date: m.expiryDate ?? '',
          qty: m.qty,
        })
        .execute();
  } else if (m.qty < 0) {
    // First-expiry-first-out
    let need = -m.qty;
    const lots = await tx
      .selectFrom('stock_lots')
      .selectAll()
      .where('product_id', '=', m.productId)
      .where('variant_id', '=', variant)
      .where('branch_id', '=', m.branchId)
      .where('qty', '>', 0)
      .orderBy('expiry_date')
      .execute();
    for (const l of lots) {
      if (need <= 0) break;
      const take = Math.min(l.qty, need);
      await tx.updateTable('stock_lots').set({ qty: l.qty - take }).where('id', '=', l.id).execute();
      need -= take;
    }
  }
}

export interface SaleStockLine {
  productId: string;
  variantId: string | null;
  /** quantity in base units (unit factor applied) */
  qty: number;
  name: string;
}

/**
 * Deduct (sign=-1) or return (sign=+1) stock for sold lines. Bundles move their components.
 * Returns the cost of goods for each line (satang, total for the line).
 */
export async function moveSaleStock(
  ctx: AppContext,
  tx: Tx,
  lines: SaleStockLine[],
  opts: { branchId: string; sign: 1 | -1; type: MoveInput['type']; refId: string; userId: string; allowNegative: boolean },
): Promise<number[]> {
  const costs: number[] = [];
  const stockOn = ctx.settings.modules.stock;
  for (const l of lines) {
    const p = await tx
      .selectFrom('products')
      .select(['id', 'kind', 'track_stock', 'cost', 'name'])
      .where('id', '=', l.productId)
      .executeTakeFirst();
    if (!p) {
      costs.push(0);
      continue;
    }
    if (p.kind === 'bundle') {
      const parts = await tx.selectFrom('bundle_items').selectAll().where('bundle_id', '=', p.id).execute();
      let cost = 0;
      for (const part of parts) {
        const sub = await moveSaleStock(ctx, tx, [{ productId: part.product_id, variantId: part.variant_id, qty: part.qty * l.qty, name: p.name }], opts);
        cost += sub[0] ?? 0;
      }
      costs.push(cost);
      continue;
    }
    if (stockOn && p.track_stock === 1) {
      const r = await applyMove(ctx, tx, {
        productId: l.productId,
        variantId: l.variantId,
        branchId: opts.branchId,
        qty: opts.sign * l.qty,
        type: opts.type,
        refType: 'sale',
        refId: opts.refId,
        userId: opts.userId,
        allowNegative: opts.sign > 0 || opts.allowNegative,
        productName: l.name,
      });
      costs.push(Math.round(r.avgCost * l.qty));
    } else {
      const v = l.variantId
        ? await tx.selectFrom('product_variants').select('cost').where('id', '=', l.variantId).executeTakeFirst()
        : undefined;
      costs.push(Math.round((v?.cost || p.cost) * l.qty));
    }
  }
  return costs;
}
