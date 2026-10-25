import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { stockDocSchema, t } from '@flexpos/shared';
import { ilike } from '@flexpos/db';
import type { AppContext } from '../context.js';
import { audit, branchOf, currentUser, nextSeq, requireAuth } from '../auth.js';
import { badRequest, notFound } from '../errors.js';
import { localDateStr, nowIso, num, uuid } from '../util.js';
import { applyMove } from '../services/stock.js';
import { bumpCatalog } from '../services/catalog.js';

const DOC_PREFIX: Record<string, string> = { receive: 'GR', adjust: 'ADJ', count: 'CNT', transfer: 'TR' };

export function stockRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = (...p: Parameters<typeof requireAuth>[1][]) => ({ preHandler: requireAuth(ctx, ...p) });

  /** Stock on hand per product/variant for the current branch. */
  app.get('/api/stock', auth('stock.view'), async (req) => {
    const q = z.object({ q: z.string().optional(), filter: z.enum(['all', 'low', 'out', 'expiring']).default('all'), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    const branchId = branchOf(ctx, req);
    const like = ilike(ctx.dialect);
    let base = ctx.db
      .selectFrom('products')
      .leftJoin('product_variants', (j) => j.onRef('product_variants.product_id', '=', 'products.id').on('product_variants.active', '=', 1))
      .leftJoin('stock_levels', (j) =>
        j
          .onRef('stock_levels.product_id', '=', 'products.id')
          .on('stock_levels.branch_id', '=', branchId)
          .on((eb) => eb('stock_levels.variant_id', '=', eb.fn.coalesce('product_variants.id', eb.val(''))))
      )
      .leftJoin('categories', 'categories.id', 'products.category_id')
      .where('products.deleted_at', 'is', null)
      .where('products.track_stock', '=', 1);
    if (q.q) {
      const t = `%${q.q}%`;
      base = base.where((eb) => eb.or([eb('products.name', like, t), eb('products.sku', like, t), eb('product_variants.sku', like, t)]));
    }
    if (q.filter === 'low') base = base.where((eb) => eb(eb.fn.coalesce('stock_levels.qty', eb.val(0)), '<=', eb.ref('products.low_stock'))).where((eb) => eb(eb.fn.coalesce('stock_levels.qty', eb.val(0)), '>', 0));
    if (q.filter === 'out') base = base.where((eb) => eb(eb.fn.coalesce('stock_levels.qty', eb.val(0)), '<=', 0));
    const total = await base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const rows = await base
      .select(['products.id as product_id', 'products.name', 'products.sku', 'products.unit', 'products.low_stock', 'products.cost', 'product_variants.id as variant_id', 'product_variants.name as variant_name', 'product_variants.sku as variant_sku', 'stock_levels.qty', 'stock_levels.avg_cost', 'categories.name as category_name'])
      .orderBy('products.name')
      .orderBy('product_variants.sort')
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .execute();
    let expiring: { product_id: string; variant_id: string; lot_no: string; expiry_date: string; qty: number }[] = [];
    if (ctx.settings.modules.lotTracking) {
      const soon = new Date(Date.now() + 30 * 86400_000);
      expiring = await ctx.db.selectFrom('stock_lots').select(['product_id', 'variant_id', 'lot_no', 'expiry_date', 'qty']).where('branch_id', '=', branchId).where('qty', '>', 0).where('expiry_date', '!=', '').where('expiry_date', '<=', localDateStr(soon)).orderBy('expiry_date').execute();
    }
    const items = rows.map((r) => {
      const qty = num(r.qty);
      return {
        productId: r.product_id,
        variantId: r.variant_id ?? '',
        name: r.variant_name ? `${r.name} (${r.variant_name})` : r.name,
        sku: r.variant_sku || r.sku,
        unit: r.unit,
        category: r.category_name,
        qty,
        lowStock: r.low_stock,
        avgCost: num(r.avg_cost) || r.cost,
        value: Math.round(qty * (num(r.avg_cost) || r.cost)),
        status: qty <= 0 ? 'out' : qty <= r.low_stock ? 'low' : 'ok',
        lots: expiring.filter((e) => e.product_id === r.product_id && e.variant_id === (r.variant_id ?? '')),
      };
    });
    const valuation = await ctx.db.selectFrom('stock_levels').select((eb) => eb.fn.sum<number>(eb('qty', '*', eb.ref('avg_cost'))).as('v')).where('branch_id', '=', branchId).where('qty', '>', 0).executeTakeFirst();
    return { total: num(total?.n), items: q.filter === 'expiring' ? items.filter((i) => i.lots.length > 0) : items, valuation: Math.round(num(valuation?.v)), expiring };
  });

  app.get('/api/stock/moves', auth('stock.view'), async (req) => {
    const q = z.object({ productId: z.string().optional(), type: z.string().optional(), from: z.string().optional(), to: z.string().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    let base = ctx.db.selectFrom('stock_moves').innerJoin('products', 'products.id', 'stock_moves.product_id').leftJoin('product_variants', 'product_variants.id', 'stock_moves.variant_id').leftJoin('users', 'users.id', 'stock_moves.user_id').where('stock_moves.branch_id', '=', branchOf(ctx, req));
    if (q.productId) base = base.where('stock_moves.product_id', '=', q.productId);
    if (q.type) base = base.where('stock_moves.type', '=', q.type);
    if (q.from) base = base.where('stock_moves.created_at', '>=', new Date(q.from + 'T00:00:00').toISOString());
    if (q.to) base = base.where('stock_moves.created_at', '<=', new Date(q.to + 'T23:59:59.999').toISOString());
    const total = await base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const items = await base
      .select(['stock_moves.id', 'stock_moves.type', 'stock_moves.qty', 'stock_moves.unit_cost', 'stock_moves.balance_after', 'stock_moves.ref_type', 'stock_moves.ref_id', 'stock_moves.note', 'stock_moves.lot_no', 'stock_moves.created_at', 'products.name', 'product_variants.name as variant_name', 'users.name as user_name'])
      .orderBy('stock_moves.created_at', 'desc')
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .execute();
    return { total: num(total?.n), items };
  });

  app.get('/api/stock/docs', auth('stock.view'), async (req) => {
    return ctx.db
      .selectFrom('stock_docs')
      .leftJoin('suppliers', 'suppliers.id', 'stock_docs.supplier_id')
      .leftJoin('users', 'users.id', 'stock_docs.user_id')
      .leftJoin('branches as tb', 'tb.id', 'stock_docs.to_branch_id')
      .select(['stock_docs.id', 'stock_docs.doc_no', 'stock_docs.type', 'stock_docs.note', 'stock_docs.total_cost', 'stock_docs.created_at', 'suppliers.name as supplier_name', 'users.name as user_name', 'tb.name as to_branch_name'])
      .where((eb) => eb.or([eb('stock_docs.branch_id', '=', branchOf(ctx, req)), eb('stock_docs.to_branch_id', '=', branchOf(ctx, req))]))
      .orderBy('stock_docs.created_at', 'desc')
      .limit(200)
      .execute();
  });

  app.get('/api/stock/docs/:id', auth('stock.view'), async (req) => {
    const { id } = req.params as { id: string };
    const d = await ctx.db.selectFrom('stock_docs').selectAll().where('id', '=', id).executeTakeFirst();
    if (!d) throw notFound(t('เอกสาร'));
    const lines = await ctx.db.selectFrom('stock_doc_lines').innerJoin('products', 'products.id', 'stock_doc_lines.product_id').leftJoin('product_variants', 'product_variants.id', 'stock_doc_lines.variant_id').select(['stock_doc_lines.id', 'stock_doc_lines.qty', 'stock_doc_lines.system_qty', 'stock_doc_lines.unit_cost', 'stock_doc_lines.lot_no', 'stock_doc_lines.expiry_date', 'products.name', 'products.sku', 'product_variants.name as variant_name']).where('doc_id', '=', id).execute();
    return { ...d, lines };
  });

  /**
   * Post a stock document. receive/adjust: qty is the change. count: qty is the counted quantity
   * (difference is posted). transfer: qty moves from this branch to toBranchId.
   */
  app.post('/api/stock/docs', auth('stock.manage'), async (req) => {
    const b = stockDocSchema.parse(req.body);
    const user = currentUser(req);
    const branchId = b.branchId ?? branchOf(ctx, req);
    if (b.type === 'transfer') {
      if (!b.toBranchId) throw badRequest(t('กรุณาเลือกสาขาปลายทาง'));
      if (b.toBranchId === branchId) throw badRequest(t('สาขาปลายทางต้องไม่ใช่สาขาเดียวกัน'));
    }
    if (b.type !== 'count' && b.type !== 'adjust' && b.lines.some((l) => l.qty <= 0)) throw badRequest(t('จำนวนต้องมากกว่า 0'));
    const id = uuid();
    const docNo = await ctx.db.transaction().execute(async (tx) => {
      const seq = await nextSeq(tx, `stockdoc:${b.type}`);
      const docNo = `${DOC_PREFIX[b.type]}${String(seq).padStart(6, '0')}`;
      let totalCost = 0;
      for (const l of b.lines) {
        const variant = l.variantId ?? '';
        const p = await tx.selectFrom('products').select(['name', 'track_stock']).where('id', '=', l.productId).executeTakeFirst();
        if (!p) throw badRequest(t('ไม่พบสินค้าในเอกสาร'));
        if (p.track_stock !== 1) throw badRequest(t('“{0}” ไม่ได้เปิดการติดตามสต็อก', p.name));
        const level = await tx.selectFrom('stock_levels').select(['qty', 'avg_cost']).where('product_id', '=', l.productId).where('variant_id', '=', variant).where('branch_id', '=', branchId).executeTakeFirst();
        const sysQty = level?.qty ?? 0;
        const common = { productId: l.productId, variantId: l.variantId, refType: 'stock_doc', refId: id, note: b.note || docNo, userId: user.id, lotNo: l.lotNo, expiryDate: l.expiryDate, productName: p.name };
        if (b.type === 'receive') {
          await applyMove(ctx, tx, { ...common, branchId, qty: l.qty, type: 'receive', unitCost: l.unitCost, allowNegative: true });
          totalCost += Math.round(l.qty * l.unitCost);
        } else if (b.type === 'adjust') {
          if (l.qty === 0) continue;
          await applyMove(ctx, tx, { ...common, branchId, qty: l.qty, type: 'adjust', unitCost: l.unitCost || undefined, allowNegative: true });
        } else if (b.type === 'count') {
          const diff = Math.round((l.qty - sysQty) * 1000) / 1000;
          if (diff !== 0) await applyMove(ctx, tx, { ...common, branchId, qty: diff, type: 'count', allowNegative: true });
        } else {
          const out = await applyMove(ctx, tx, { ...common, branchId, qty: -l.qty, type: 'transfer_out', allowNegative: ctx.settings.pos.allowNegativeStock });
          await applyMove(ctx, tx, { ...common, branchId: b.toBranchId!, qty: l.qty, type: 'transfer_in', unitCost: out.avgCost, allowNegative: true });
          totalCost += Math.round(l.qty * out.avgCost);
        }
        await tx.insertInto('stock_doc_lines').values({ id: uuid(), doc_id: id, product_id: l.productId, variant_id: variant, qty: l.qty, system_qty: sysQty, unit_cost: l.unitCost, lot_no: l.lotNo, expiry_date: l.expiryDate }).execute();
        if (b.type === 'receive' && l.unitCost > 0) {
          // Keep the product's reference cost in line with the latest purchase.
          if (variant) await tx.updateTable('product_variants').set({ cost: l.unitCost }).where('id', '=', variant).execute();
          else await tx.updateTable('products').set({ cost: l.unitCost, updated_at: nowIso() }).where('id', '=', l.productId).execute();
        }
      }
      await tx.insertInto('stock_docs').values({ id, doc_no: docNo, type: b.type, branch_id: branchId, to_branch_id: b.toBranchId ?? null, supplier_id: b.supplierId ?? null, note: b.note, total_cost: totalCost, user_id: user.id, created_at: nowIso() }).execute();
      await audit(ctx, tx, req, `stock.${b.type}`, 'stock_doc', id, { docNo, lines: b.lines.length, totalCost });
      return docNo;
    });
    bumpCatalog(ctx);
    return { id, docNo };
  });

  /* ---------- Suppliers ---------- */
}
