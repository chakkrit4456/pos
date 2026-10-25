import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { sql } from 'kysely';
import ExcelJS from 'exceljs';
import { localDate, toCsv } from '@flexpos/shared';
import type { AppContext } from '../context.js';
import { branchOf, currentUser, hasPerm, requireAuth } from '../auth.js';
import { num, parseJson } from '../util.js';
import { tableLabels } from '../services/tables.js';

const rangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  branchId: z.string().optional(),
  format: z.enum(['json', 'csv', 'xlsx']).default('json'),
});

const signed = (col: string) => sql<number>`sum(case when sales.type = 'refund' then -${sql.ref(col)} else ${sql.ref(col)} end)`;

function shiftDays(d: string, days: number): string {
  const x = new Date(d + 'T12:00:00');
  x.setDate(x.getDate() + days);
  return localDate(x);
}

async function sendTable(reply: FastifyReply, format: 'csv' | 'xlsx', name: string, header: string[], rows: (string | number)[][]) {
  if (format === 'csv') {
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${name}.csv"`);
    return toCsv([header, ...rows]);
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(name.slice(0, 30));
  ws.addRow(header);
  rows.forEach((r) => ws.addRow(r));
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((c) => (c.width = 18));
  reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition', `attachment; filename="${name}.xlsx"`);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const baht = (s: number) => Number((s / 100).toFixed(2));

export function reportRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = (...p: Parameters<typeof requireAuth>[1][]) => ({ preHandler: requireAuth(ctx, ...p) });

  const scopeBranch = (req: Parameters<typeof branchOf>[1], requested?: string) => {
    const user = currentUser(req);
    if (requested === 'all' && !user.branchId) return null;
    return requested && !user.branchId ? requested : branchOf(ctx, req);
  };

  const totals = async (from: string, to: string, branchId: string | null) => {
    let q = ctx.db
      .selectFrom('sales')
      .select([
        signed('sales.total').as('net'),
        signed('sales.vat').as('vat'),
        signed('sales.discount_total').as('discount'),
        signed('sales.cost_total').as('cost'),
        sql<number>`sum(case when sales.type = 'sale' then 1 else 0 end)`.as('bills'),
        sql<number>`sum(case when sales.type = 'refund' then sales.total else 0 end)`.as('refunds'),
      ])
      .where('sales.biz_date', '>=', from)
      .where('sales.biz_date', '<=', to)
      .where('sales.status', '!=', 'voided');
    if (branchId) q = q.where('sales.branch_id', '=', branchId);
    const r = await q.executeTakeFirst();
    const net = num(r?.net);
    const bills = num(r?.bills);
    return { net, vat: num(r?.vat), discount: num(r?.discount), cost: num(r?.cost), bills, avg: bills ? Math.round(net / bills) : 0, refunds: num(r?.refunds) };
  };

  app.get('/api/reports/dashboard', auth('reports.view'), async (req) => {
    const q = z.object({ range: z.enum(['today', '7d', '30d']).default('today'), branchId: z.string().optional() }).parse(req.query);
    const branchId = scopeBranch(req, q.branchId);
    const today = localDate();
    const days = q.range === 'today' ? 1 : q.range === '7d' ? 7 : 30;
    const from = shiftDays(today, -(days - 1));
    const prevTo = shiftDays(from, -1);
    const prevFrom = shiftDays(prevTo, -(days - 1));
    const [cur, prev] = await Promise.all([totals(from, today, branchId), totals(prevFrom, prevTo, branchId)]);
    const canProfit = hasPerm(currentUser(req), 'reports.profit');

    const bucketCol = q.range === 'today' ? 'sales.hour' : 'sales.biz_date';
    const series = async (f: string, t: string) => {
      let s = ctx.db.selectFrom('sales').select([sql.ref<string | number>(bucketCol).as('k'), signed('sales.total').as('v')]).where('sales.biz_date', '>=', f).where('sales.biz_date', '<=', t).where('sales.status', '!=', 'voided');
      if (branchId) s = s.where('sales.branch_id', '=', branchId);
      return s.groupBy(sql.ref(bucketCol)).execute();
    };
    const [curS, prevS] = await Promise.all([series(from, today), series(prevFrom, prevTo)]);
    let bars: { label: string; cur: number; prev: number }[];
    if (q.range === 'today') {
      const hours = curS.map((r) => num(r.k));
      const minH = Math.min(8, ...hours);
      const maxH = Math.max(20, ...hours);
      bars = [];
      for (let h = minH; h <= maxH; h++) bars.push({ label: String(h).padStart(2, '0'), cur: num(curS.find((r) => num(r.k) === h)?.v), prev: num(prevS.find((r) => num(r.k) === h)?.v) });
    } else {
      bars = Array.from({ length: days }, (_, i) => {
        const d = shiftDays(from, i);
        const pd = shiftDays(prevFrom, i);
        return { label: d.slice(8) + '/' + d.slice(5, 7), cur: num(curS.find((r) => r.k === d)?.v), prev: num(prevS.find((r) => r.k === pd)?.v) };
      });
    }

    let lq = ctx.db
      .selectFrom('sale_lines')
      .innerJoin('sales', 'sales.id', 'sale_lines.sale_id')
      .leftJoin('categories', 'categories.id', 'sale_lines.category_id')
      .where('sales.biz_date', '>=', from)
      .where('sales.biz_date', '<=', today)
      .where('sales.status', '!=', 'voided');
    if (branchId) lq = lq.where('sales.branch_id', '=', branchId);
    const top = await lq.select(['sale_lines.product_id', sql<string>`max(sale_lines.name)`.as('name'), signed('sale_lines.qty').as('qty'), signed('sale_lines.net').as('rev')]).groupBy('sale_lines.product_id').orderBy('rev', 'desc').limit(8).execute();
    const cats = await lq.select([sql<string>`coalesce(categories.name, 'ไม่มีหมวด')`.as('name'), signed('sale_lines.net').as('rev')]).groupBy(sql`coalesce(categories.name, 'ไม่มีหมวด')`).orderBy('rev', 'desc').execute();

    let sq = ctx.db.selectFrom('sales').innerJoin('users', 'users.id', 'sales.user_id').where('sales.biz_date', '>=', from).where('sales.biz_date', '<=', today).where('sales.status', '!=', 'voided');
    if (branchId) sq = sq.where('sales.branch_id', '=', branchId);
    const staff = await sq.select(['users.id', 'users.name', signed('sales.total').as('rev'), sql<number>`sum(case when sales.type = 'sale' then 1 else 0 end)`.as('bills')]).groupBy(['users.id', 'users.name']).orderBy('rev', 'desc').limit(6).execute();

    let aq = ctx.db.selectFrom('sales').where('sales.biz_date', '>=', from).where('sales.biz_date', '<=', today);
    if (branchId) aq = aq.where('sales.branch_id', '=', branchId);
    const adj = await aq
      .select([
        sql<number>`sum(case when sales.status != 'voided' and sales.type = 'sale' then sales.discount_total else 0 end)`.as('disc'),
        sql<number>`sum(case when sales.status != 'voided' and sales.type = 'sale' and sales.discount_total > 0 then 1 else 0 end)`.as('discBills'),
        sql<number>`sum(case when sales.status = 'voided' then sales.total else 0 end)`.as('voids'),
        sql<number>`sum(case when sales.status = 'voided' then 1 else 0 end)`.as('voidBills'),
        sql<number>`sum(case when sales.type = 'refund' and sales.status != 'voided' then sales.total else 0 end)`.as('refunds'),
        sql<number>`sum(case when sales.type = 'refund' and sales.status != 'voided' then 1 else 0 end)`.as('refundBills'),
        sql<number>`sum(case when sales.status != 'voided' and sales.type = 'sale' then sales.promo_discount else 0 end)`.as('promo'),
      ])
      .executeTakeFirst();

    const stockBranch = branchId ?? ctx.defaultBranchId ?? '';
    const low = ctx.settings.modules.stock
      ? await ctx.db
          .selectFrom('stock_levels')
          .innerJoin('products', 'products.id', 'stock_levels.product_id')
          .leftJoin('product_variants', 'product_variants.id', 'stock_levels.variant_id')
          .select(['products.id', 'products.name', 'product_variants.name as variant_name', 'stock_levels.qty', 'products.low_stock', 'products.unit'])
          .where('stock_levels.branch_id', '=', stockBranch)
          .where('products.track_stock', '=', 1)
          .where('products.deleted_at', 'is', null)
          .where((eb) => eb('stock_levels.qty', '<=', eb.ref('products.low_stock')))
          .orderBy('stock_levels.qty')
          .limit(6)
          .execute()
      : [];
    // Sales velocity for the low-stock rows (units/day over 7 days)
    const velocity = low.length
      ? await ctx.db.selectFrom('sale_lines').innerJoin('sales', 'sales.id', 'sale_lines.sale_id').select(['sale_lines.product_id', signed('sale_lines.base_qty').as('q')]).where('sale_lines.product_id', 'in', low.map((l) => l.id)).where('sales.biz_date', '>=', shiftDays(today, -6)).where('sales.status', '!=', 'voided').groupBy('sale_lines.product_id').execute()
      : [];

    let open = { count: 0, total: 0, list: [] as { id: string; name: string; meta: string; total: number }[] };
    if (ctx.settings.modules.restaurant) {
      let oq = ctx.db.selectFrom('orders').leftJoin('tables', 'tables.id', 'orders.table_id').select(['orders.id', 'orders.name', 'orders.opened_at', 'orders.guests', 'orders.table_id', 'tables.name as table_name']).where('orders.status', '=', 'open');
      if (branchId) oq = oq.where('orders.branch_id', '=', branchId);
      const orders = await oq.orderBy('orders.opened_at').execute();
      const sums = orders.length ? await ctx.db.selectFrom('order_items').select(['order_id', (eb) => eb.fn.sum<number>(eb('qty', '*', eb.ref('unit_price'))).as('t')]).where('order_id', 'in', orders.map((o) => o.id)).where('status', '!=', 'cancelled').groupBy('order_id').execute() : [];
      const labels = await tableLabels(ctx.db, branchId ?? undefined);
      const list = orders.map((o) => ({ id: o.id, name: o.table_id ? `โต๊ะ ${labels.get(o.table_id) ?? o.table_name}` : o.name, meta: `${o.guests ? o.guests + ' คน · ' : ''}เปิด ${new Date(o.opened_at).toTimeString().slice(0, 5)}`, total: Math.round(num(sums.find((s) => s.order_id === o.id)?.t)) }));
      open = { count: list.length, total: list.reduce((a, b) => a + b.total, 0), list: list.slice(0, 6) };
    }

    const topTotal = top.reduce((a, t) => a + num(t.rev), 0) || 1;
    const catTotal = cats.reduce((a, c) => a + Math.max(0, num(c.rev)), 0) || 1;
    return {
      range: { from, to: today, prevFrom, prevTo },
      kpis: { cur, prev: { ...prev } },
      profit: canProfit ? { cur: cur.net - cur.vat - cur.cost, prev: prev.net - prev.vat - prev.cost } : null,
      bars,
      top: top.map((t) => ({ id: t.product_id, name: t.name, qty: num(t.qty), rev: num(t.rev), share: num(t.rev) / topTotal })),
      categories: cats.map((c) => ({ name: c.name, rev: num(c.rev), share: Math.max(0, num(c.rev)) / catTotal })),
      staff: staff.map((s) => ({ id: s.id, name: s.name, rev: num(s.rev), bills: num(s.bills) })),
      adjustments: {
        discount: num(adj?.disc), discountBills: num(adj?.discBills), promo: num(adj?.promo),
        voids: num(adj?.voids), voidBills: num(adj?.voidBills), refunds: num(adj?.refunds), refundBills: num(adj?.refundBills),
      },
      lowStock: low.map((l) => ({ id: l.id, name: l.variant_name ? `${l.name} (${l.variant_name})` : l.name, qty: l.qty, lowStock: l.low_stock, unit: l.unit, perDay: Math.round((num(velocity.find((v) => v.product_id === l.id)?.q) / 7) * 10) / 10 })),
      open,
    };
  });

  /** Sales summary grouped by a dimension. */
  app.get('/api/reports/sales', auth('reports.view'), async (req, reply) => {
    const q = rangeSchema.extend({ groupBy: z.enum(['day', 'hour', 'product', 'category', 'staff', 'method', 'branch']).default('day') }).parse(req.query);
    const branchId = scopeBranch(req, q.branchId);
    const canProfit = hasPerm(currentUser(req), 'reports.profit');
    let rows: { key: string; label: string; qty: number; bills: number; gross: number; discount: number; net: number; vat: number; cost: number }[];

    if (q.groupBy === 'method') {
      let pq = ctx.db.selectFrom('sale_payments').innerJoin('sales', 'sales.id', 'sale_payments.sale_id').where('sales.biz_date', '>=', q.from).where('sales.biz_date', '<=', q.to).where('sales.status', '!=', 'voided');
      if (branchId) pq = pq.where('sales.branch_id', '=', branchId);
      const r = await pq.select(['sale_payments.method_name as label', signed('sale_payments.amount').as('net'), (eb) => eb.fn.count<number>('sales.id').distinct().as('bills')]).groupBy('sale_payments.method_name').orderBy('net', 'desc').execute();
      rows = r.map((x) => ({ key: x.label, label: x.label, qty: 0, bills: num(x.bills), gross: num(x.net), discount: 0, net: num(x.net), vat: 0, cost: 0 }));
    } else if (q.groupBy === 'product' || q.groupBy === 'category') {
      let lq = ctx.db.selectFrom('sale_lines').innerJoin('sales', 'sales.id', 'sale_lines.sale_id').leftJoin('categories', 'categories.id', 'sale_lines.category_id').where('sales.biz_date', '>=', q.from).where('sales.biz_date', '<=', q.to).where('sales.status', '!=', 'voided');
      if (branchId) lq = lq.where('sales.branch_id', '=', branchId);
      const keyExpr = q.groupBy === 'product' ? sql<string>`sale_lines.product_id` : sql<string>`coalesce(sale_lines.category_id, '')`;
      const labelExpr = q.groupBy === 'product' ? sql<string>`max(sale_lines.name)` : sql<string>`coalesce(max(categories.name), 'ไม่มีหมวด')`;
      const r = await lq
        .select([keyExpr.as('key'), labelExpr.as('label'), signed('sale_lines.qty').as('qty'), (eb) => eb.fn.count<number>('sales.id').distinct().as('bills'), signed('sale_lines.gross').as('gross'), sql<number>`sum(case when sales.type = 'refund' then 0 else sale_lines.line_discount + sale_lines.promo_discount + sale_lines.bill_discount end)`.as('discount'), signed('sale_lines.net').as('net'), signed('sale_lines.vat').as('vat'), sql<number>`sum(case when sales.type = 'refund' then -(sale_lines.unit_cost * sale_lines.qty) else sale_lines.unit_cost * sale_lines.qty end)`.as('cost')])
        .groupBy(keyExpr)
        .orderBy('net', 'desc')
        .execute();
      rows = r.map((x) => ({ key: x.key, label: x.label, qty: num(x.qty), bills: num(x.bills), gross: num(x.gross), discount: num(x.discount), net: num(x.net), vat: num(x.vat), cost: Math.round(num(x.cost)) }));
    } else {
      const col = q.groupBy === 'day' ? 'sales.biz_date' : q.groupBy === 'hour' ? 'sales.hour' : q.groupBy === 'staff' ? 'sales.user_id' : 'sales.branch_id';
      let sq = ctx.db.selectFrom('sales').leftJoin('users', 'users.id', 'sales.user_id').leftJoin('branches', 'branches.id', 'sales.branch_id').where('sales.biz_date', '>=', q.from).where('sales.biz_date', '<=', q.to).where('sales.status', '!=', 'voided');
      if (branchId) sq = sq.where('sales.branch_id', '=', branchId);
      const label = q.groupBy === 'staff' ? sql<string>`max(users.name)` : q.groupBy === 'branch' ? sql<string>`max(branches.name)` : sql<string>`max(${sql.ref(col)})`;
      const r = await sq
        .select([sql.ref<string>(col).as('key'), label.as('label'), sql<number>`sum(case when sales.type = 'sale' then 1 else 0 end)`.as('bills'), signed('sales.subtotal').as('gross'), sql<number>`sum(case when sales.type = 'refund' then 0 else sales.discount_total end)`.as('discount'), signed('sales.total').as('net'), signed('sales.vat').as('vat'), signed('sales.cost_total').as('cost')])
        .groupBy(sql.ref(col))
        .orderBy(q.groupBy === 'day' || q.groupBy === 'hour' ? 'key' : 'net', q.groupBy === 'day' || q.groupBy === 'hour' ? 'asc' : 'desc')
        .execute();
      rows = r.map((x) => ({ key: String(x.key), label: q.groupBy === 'hour' ? `${String(x.label).padStart(2, '0')}:00` : String(x.label), qty: 0, bills: num(x.bills), gross: num(x.gross), discount: num(x.discount), net: num(x.net), vat: num(x.vat), cost: num(x.cost) }));
    }
    const out = rows.map((r) => ({ ...r, cost: canProfit ? r.cost : null, profit: canProfit ? r.net - r.vat - r.cost : null }));
    const sum = out.reduce((a, r) => ({ qty: a.qty + r.qty, bills: a.bills + r.bills, gross: a.gross + r.gross, discount: a.discount + r.discount, net: a.net + r.net, vat: a.vat + r.vat, cost: a.cost + (r.cost ?? 0), profit: a.profit + (r.profit ?? 0) }), { qty: 0, bills: 0, gross: 0, discount: 0, net: 0, vat: 0, cost: 0, profit: 0 });
    if (q.format !== 'json') {
      const header = ['รายการ', 'จำนวน', 'บิล', 'ยอดก่อนส่วนลด', 'ส่วนลด', 'ยอดขายสุทธิ', 'VAT', ...(canProfit ? ['ต้นทุน', 'กำไรขั้นต้น'] : [])];
      return sendTable(reply, q.format, `sales-${q.groupBy}-${q.from}_${q.to}`, header, out.map((r) => [r.label, r.qty, r.bills, baht(r.gross), baht(r.discount), baht(r.net), baht(r.vat), ...(canProfit ? [baht(r.cost ?? 0), baht(r.profit ?? 0)] : [])]));
    }
    return { rows: out, total: { ...sum, cost: canProfit ? sum.cost : null, profit: canProfit ? sum.profit : null } };
  });

  /** Output VAT report (รายงานภาษีขาย) in document order. */
  app.get('/api/reports/vat', auth('reports.view'), async (req, reply) => {
    const q = rangeSchema.parse(req.query);
    const branchId = scopeBranch(req, q.branchId);
    let sq = ctx.db.selectFrom('sales').leftJoin('customers', 'customers.id', 'sales.customer_id').select(['sales.id', 'sales.doc_no', 'sales.tax_invoice_no', 'sales.type', 'sales.status', 'sales.created_at', 'sales.biz_date', 'sales.vatable', 'sales.vat', 'sales.exempt', 'sales.total', 'sales.tax_invoice', 'customers.name as customer_name']).where('sales.biz_date', '>=', q.from).where('sales.biz_date', '<=', q.to);
    if (branchId) sq = sq.where('sales.branch_id', '=', branchId);
    const rows = await sq.orderBy('sales.created_at').execute();
    const items = rows.map((r) => {
      const ti = parseJson<{ name: string; taxId: string; branch: string } | null>(r.tax_invoice, null);
      const sign = r.type === 'refund' ? -1 : 1;
      const voided = r.status === 'voided';
      return {
        date: r.biz_date,
        docNo: r.tax_invoice_no ?? r.doc_no,
        kind: r.type === 'refund' ? 'ใบลดหนี้' : r.tax_invoice_no ? 'ใบกำกับภาษีเต็มรูป' : 'ใบกำกับภาษีอย่างย่อ',
        customer: ti?.name ?? r.customer_name ?? 'ลูกค้าทั่วไป',
        taxId: ti?.taxId ?? '',
        branch: ti?.branch ?? '',
        base: voided ? 0 : sign * r.vatable,
        vat: voided ? 0 : sign * r.vat,
        exempt: voided ? 0 : sign * r.exempt,
        total: voided ? 0 : sign * r.total,
        status: voided ? 'ยกเลิก' : '',
      };
    });
    const sum = items.reduce((a, i) => ({ base: a.base + i.base, vat: a.vat + i.vat, exempt: a.exempt + i.exempt, total: a.total + i.total }), { base: 0, vat: 0, exempt: 0, total: 0 });
    if (q.format !== 'json') {
      return sendTable(reply, q.format, `vat-report-${q.from}_${q.to}`, ['วันที่', 'เลขที่เอกสาร', 'ประเภท', 'ชื่อผู้ซื้อ', 'เลขประจำตัวผู้เสียภาษี', 'สาขา', 'มูลค่าสินค้า/บริการ', 'ภาษีมูลค่าเพิ่ม', 'ยกเว้นภาษี', 'รวม', 'หมายเหตุ'], [
        ...items.map((i) => [i.date, i.docNo, i.kind, i.customer, i.taxId, i.branch, baht(i.base), baht(i.vat), baht(i.exempt), baht(i.total), i.status]),
        ['', '', '', 'รวม', '', '', baht(sum.base), baht(sum.vat), baht(sum.exempt), baht(sum.total), ''],
      ]);
    }
    return { items, total: sum, store: { name: ctx.settings.store.name, taxId: ctx.settings.store.taxId } };
  });

  /** Voids and refunds with reasons. */
  app.get('/api/reports/adjustments', auth('reports.view'), async (req, reply) => {
    const q = rangeSchema.parse(req.query);
    const branchId = scopeBranch(req, q.branchId);
    let sq = ctx.db.selectFrom('sales').leftJoin('users', 'users.id', 'sales.user_id').leftJoin('users as v', 'v.id', 'sales.voided_by').select(['sales.id', 'sales.doc_no', 'sales.type', 'sales.status', 'sales.total', 'sales.created_at', 'sales.voided_at', 'sales.void_reason', 'sales.note', 'users.name as user_name', 'v.name as voided_by']).where('sales.biz_date', '>=', q.from).where('sales.biz_date', '<=', q.to).where((eb) => eb.or([eb('sales.status', '=', 'voided'), eb('sales.type', '=', 'refund')]));
    if (branchId) sq = sq.where('sales.branch_id', '=', branchId);
    const rows = await sq.orderBy('sales.created_at', 'desc').execute();
    const items = rows.map((r) => ({ id: r.id, docNo: r.doc_no, kind: r.status === 'voided' ? 'ยกเลิกบิล' : 'คืนสินค้า', total: r.total, at: r.voided_at ?? r.created_at, by: r.voided_by ?? r.user_name, reason: r.void_reason ?? r.note }));
    if (q.format !== 'json') return sendTable(reply, q.format, `voids-refunds-${q.from}_${q.to}`, ['เวลา', 'เลขที่', 'ประเภท', 'ยอด', 'ผู้อนุมัติ/ผู้ทำ', 'เหตุผล'], items.map((i) => [i.at, i.docNo, i.kind, baht(i.total), i.by ?? '', i.reason ?? '']));
    return { items };
  });

  app.get('/api/reports/stock', auth('stock.view'), async (req, reply) => {
    const { format } = z.object({ format: z.enum(['csv', 'xlsx']).default('xlsx') }).parse(req.query);
    const branchId = branchOf(ctx, req);
    const canProfit = hasPerm(currentUser(req), 'reports.profit');
    const rows = await ctx.db.selectFrom('stock_levels').innerJoin('products', 'products.id', 'stock_levels.product_id').leftJoin('product_variants', 'product_variants.id', 'stock_levels.variant_id').leftJoin('categories', 'categories.id', 'products.category_id').select(['products.sku', 'products.name', 'product_variants.name as variant_name', 'categories.name as cat', 'products.unit', 'stock_levels.qty', 'stock_levels.avg_cost']).where('stock_levels.branch_id', '=', branchId).where('products.deleted_at', 'is', null).orderBy('products.name').execute();
    return sendTable(reply, format, `stock-${localDate()}`, ['SKU', 'สินค้า', 'หมวด', 'หน่วย', 'คงเหลือ', ...(canProfit ? ['ต้นทุนเฉลี่ย', 'มูลค่า'] : [])], rows.map((r) => [r.sku, r.variant_name ? `${r.name} (${r.variant_name})` : r.name, r.cat ?? '', r.unit, r.qty, ...(canProfit ? [baht(r.avg_cost), baht(Math.round(r.qty * r.avg_cost))] : [])]));
  });

}
