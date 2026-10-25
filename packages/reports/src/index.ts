/**
 * Report queries shared by the POS server and FlexPOS Cloud. Every function takes the Kysely
 * handle to read from: the POS passes its own database, the cloud passes a tenant-scoped handle
 * (`db.withSchema('t_…')`), so both compute identical numbers from identical rows.
 */
import { sql, type Kysely, type Transaction } from 'kysely';
import type { DB } from '@flexpos/db';
import { localDate, t } from '@flexpos/shared';

export type ReportDb = Kysely<DB> | Transaction<DB>;

export const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** Refunds count as negative in every total. */
const signed = (col: string) => sql<number>`sum(case when sales.type = 'refund' then -${sql.ref(col)} else ${sql.ref(col)} end)`;

export function shiftDays(d: string, days: number): string {
  const x = new Date(d + 'T12:00:00');
  x.setDate(x.getDate() + days);
  return localDate(x);
}

/**
 * Display names for tables. When a branch has more than one zone, a table is shown as
 * "<zone> · <table>" so "1" in two zones is never ambiguous.
 */
export async function tableLabels(tx: ReportDb, branchId?: string): Promise<Map<string, string>> {
  let q = tx.selectFrom('tables').leftJoin('zones', 'zones.id', 'tables.zone_id').select(['tables.id', 'tables.name', 'tables.branch_id', 'zones.name as zone_name']);
  if (branchId) q = q.where('tables.branch_id', '=', branchId);
  const rows = await q.execute();
  const zonesPerBranch = new Map<string, Set<string>>();
  for (const r of rows) {
    const s = zonesPerBranch.get(r.branch_id) ?? new Set<string>();
    if (r.zone_name) s.add(r.zone_name);
    zonesPerBranch.set(r.branch_id, s);
  }
  return new Map(rows.map((r) => [r.id, r.zone_name && (zonesPerBranch.get(r.branch_id)?.size ?? 0) > 1 ? `${r.zone_name} · ${r.name}` : r.name]));
}

export async function salesTotals(db: ReportDb, from: string, to: string, branchId: string | null) {
  let q = db
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
}

export interface DashboardOptions {
  range: 'today' | '7d' | '30d';
  /** null = all branches */
  branchId: string | null;
  canProfit: boolean;
  modules: { stock: boolean; restaurant: boolean };
  /** branch used for low-stock when branchId is null */
  defaultBranchId: string | null;
  today?: string;
}

export async function dashboard(db: ReportDb, o: DashboardOptions) {
  const { branchId } = o;
  const today = o.today ?? localDate();
  const days = o.range === 'today' ? 1 : o.range === '7d' ? 7 : 30;
  const from = shiftDays(today, -(days - 1));
  const prevTo = shiftDays(from, -1);
  const prevFrom = shiftDays(prevTo, -(days - 1));
  const [cur, prev] = await Promise.all([salesTotals(db, from, today, branchId), salesTotals(db, prevFrom, prevTo, branchId)]);

  const bucketCol = o.range === 'today' ? 'sales.hour' : 'sales.biz_date';
  const series = async (f: string, t: string) => {
    let s = db.selectFrom('sales').select([sql.ref<string | number>(bucketCol).as('k'), signed('sales.total').as('v')]).where('sales.biz_date', '>=', f).where('sales.biz_date', '<=', t).where('sales.status', '!=', 'voided');
    if (branchId) s = s.where('sales.branch_id', '=', branchId);
    return s.groupBy(sql.ref(bucketCol)).execute();
  };
  const [curS, prevS] = await Promise.all([series(from, today), series(prevFrom, prevTo)]);
  let bars: { label: string; cur: number; prev: number }[];
  if (o.range === 'today') {
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

  let lq = db
    .selectFrom('sale_lines')
    .innerJoin('sales', 'sales.id', 'sale_lines.sale_id')
    .leftJoin('categories', 'categories.id', 'sale_lines.category_id')
    .where('sales.biz_date', '>=', from)
    .where('sales.biz_date', '<=', today)
    .where('sales.status', '!=', 'voided');
  if (branchId) lq = lq.where('sales.branch_id', '=', branchId);
  const top = await lq.select(['sale_lines.product_id', sql<string>`max(sale_lines.name)`.as('name'), signed('sale_lines.qty').as('qty'), signed('sale_lines.net').as('rev')]).groupBy('sale_lines.product_id').orderBy('rev', 'desc').limit(8).execute();
  const cats = await lq.select([sql<string>`coalesce(categories.name, ${sql.lit(t('ไม่มีหมวด'))})`.as('name'), signed('sale_lines.net').as('rev')]).groupBy(sql`coalesce(categories.name, ${sql.lit(t('ไม่มีหมวด'))})`).orderBy('rev', 'desc').execute();

  let sq = db.selectFrom('sales').innerJoin('users', 'users.id', 'sales.user_id').where('sales.biz_date', '>=', from).where('sales.biz_date', '<=', today).where('sales.status', '!=', 'voided');
  if (branchId) sq = sq.where('sales.branch_id', '=', branchId);
  const staff = await sq.select(['users.id', 'users.name', signed('sales.total').as('rev'), sql<number>`sum(case when sales.type = 'sale' then 1 else 0 end)`.as('bills')]).groupBy(['users.id', 'users.name']).orderBy('rev', 'desc').limit(6).execute();

  let aq = db.selectFrom('sales').where('sales.biz_date', '>=', from).where('sales.biz_date', '<=', today);
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

  const stockBranch = branchId ?? o.defaultBranchId ?? '';
  const low = o.modules.stock
    ? await db
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
    ? await db.selectFrom('sale_lines').innerJoin('sales', 'sales.id', 'sale_lines.sale_id').select(['sale_lines.product_id', signed('sale_lines.base_qty').as('q')]).where('sale_lines.product_id', 'in', low.map((l) => l.id)).where('sales.biz_date', '>=', shiftDays(today, -6)).where('sales.status', '!=', 'voided').groupBy('sale_lines.product_id').execute()
    : [];

  let open = { count: 0, total: 0, list: [] as { id: string; name: string; meta: string; total: number }[] };
  if (o.modules.restaurant) {
    let oq = db.selectFrom('orders').leftJoin('tables', 'tables.id', 'orders.table_id').select(['orders.id', 'orders.name', 'orders.opened_at', 'orders.guests', 'orders.table_id', 'tables.name as table_name']).where('orders.status', '=', 'open');
    if (branchId) oq = oq.where('orders.branch_id', '=', branchId);
    const orders = await oq.orderBy('orders.opened_at').execute();
    const sums = orders.length ? await db.selectFrom('order_items').select(['order_id', (eb) => eb.fn.sum<number>(eb('qty', '*', eb.ref('unit_price'))).as('t')]).where('order_id', 'in', orders.map((o) => o.id)).where('status', '!=', 'cancelled').groupBy('order_id').execute() : [];
    const labels = await tableLabels(db, branchId ?? undefined);
    const list = orders.map((o) => ({ id: o.id, name: o.table_id ? t('โต๊ะ {0}', labels.get(o.table_id) ?? o.table_name) : o.name, meta: t('{0}เปิด {1}', o.guests ? o.guests + t(' คน · ') : '', new Date(o.opened_at).toTimeString().slice(0, 5)), total: Math.round(num(sums.find((s) => s.order_id === o.id)?.t)) }));
    open = { count: list.length, total: list.reduce((a, b) => a + b.total, 0), list: list.slice(0, 6) };
  }

  const topTotal = top.reduce((a, t) => a + num(t.rev), 0) || 1;
  const catTotal = cats.reduce((a, c) => a + Math.max(0, num(c.rev)), 0) || 1;
  return {
    range: { from, to: today, prevFrom, prevTo },
    kpis: { cur, prev: { ...prev } },
    profit: o.canProfit ? { cur: cur.net - cur.vat - cur.cost, prev: prev.net - prev.vat - prev.cost } : null,
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
}

export type Dashboard = Awaited<ReturnType<typeof dashboard>>;

export type SalesGroupBy = 'day' | 'hour' | 'product' | 'category' | 'staff' | 'method' | 'branch';

export interface SalesReportRow {
  key: string;
  label: string;
  qty: number;
  bills: number;
  gross: number;
  discount: number;
  net: number;
  vat: number;
  cost: number | null;
  profit: number | null;
}

/** Sales summary grouped by a dimension. */
export async function salesReport(db: ReportDb, o: { from: string; to: string; groupBy: SalesGroupBy; branchId: string | null; canProfit: boolean }) {
  const { branchId } = o;
  let rows: { key: string; label: string; qty: number; bills: number; gross: number; discount: number; net: number; vat: number; cost: number }[];

  if (o.groupBy === 'method') {
    let pq = db.selectFrom('sale_payments').innerJoin('sales', 'sales.id', 'sale_payments.sale_id').where('sales.biz_date', '>=', o.from).where('sales.biz_date', '<=', o.to).where('sales.status', '!=', 'voided');
    if (branchId) pq = pq.where('sales.branch_id', '=', branchId);
    const r = await pq.select(['sale_payments.method_name as label', signed('sale_payments.amount').as('net'), (eb) => eb.fn.count<number>('sales.id').distinct().as('bills')]).groupBy('sale_payments.method_name').orderBy('net', 'desc').execute();
    rows = r.map((x) => ({ key: x.label, label: x.label, qty: 0, bills: num(x.bills), gross: num(x.net), discount: 0, net: num(x.net), vat: 0, cost: 0 }));
  } else if (o.groupBy === 'product' || o.groupBy === 'category') {
    let lq = db.selectFrom('sale_lines').innerJoin('sales', 'sales.id', 'sale_lines.sale_id').leftJoin('categories', 'categories.id', 'sale_lines.category_id').where('sales.biz_date', '>=', o.from).where('sales.biz_date', '<=', o.to).where('sales.status', '!=', 'voided');
    if (branchId) lq = lq.where('sales.branch_id', '=', branchId);
    const keyExpr = o.groupBy === 'product' ? sql<string>`sale_lines.product_id` : sql<string>`coalesce(sale_lines.category_id, '')`;
    const labelExpr = o.groupBy === 'product' ? sql<string>`max(sale_lines.name)` : sql<string>`coalesce(max(categories.name), ${sql.lit(t('ไม่มีหมวด'))})`;
    const r = await lq
      .select([keyExpr.as('key'), labelExpr.as('label'), signed('sale_lines.qty').as('qty'), (eb) => eb.fn.count<number>('sales.id').distinct().as('bills'), signed('sale_lines.gross').as('gross'), sql<number>`sum(case when sales.type = 'refund' then 0 else sale_lines.line_discount + sale_lines.promo_discount + sale_lines.bill_discount end)`.as('discount'), signed('sale_lines.net').as('net'), signed('sale_lines.vat').as('vat'), sql<number>`sum(case when sales.type = 'refund' then -(sale_lines.unit_cost * sale_lines.qty) else sale_lines.unit_cost * sale_lines.qty end)`.as('cost')])
      .groupBy(keyExpr)
      .orderBy('net', 'desc')
      .execute();
    rows = r.map((x) => ({ key: x.key, label: x.label, qty: num(x.qty), bills: num(x.bills), gross: num(x.gross), discount: num(x.discount), net: num(x.net), vat: num(x.vat), cost: Math.round(num(x.cost)) }));
  } else {
    const col = o.groupBy === 'day' ? 'sales.biz_date' : o.groupBy === 'hour' ? 'sales.hour' : o.groupBy === 'staff' ? 'sales.user_id' : 'sales.branch_id';
    let sq = db.selectFrom('sales').leftJoin('users', 'users.id', 'sales.user_id').leftJoin('branches', 'branches.id', 'sales.branch_id').where('sales.biz_date', '>=', o.from).where('sales.biz_date', '<=', o.to).where('sales.status', '!=', 'voided');
    if (branchId) sq = sq.where('sales.branch_id', '=', branchId);
    const label = o.groupBy === 'staff' ? sql<string>`max(users.name)` : o.groupBy === 'branch' ? sql<string>`max(branches.name)` : sql<string>`max(${sql.ref(col)})`;
    const r = await sq
      .select([sql.ref<string>(col).as('key'), label.as('label'), sql<number>`sum(case when sales.type = 'sale' then 1 else 0 end)`.as('bills'), signed('sales.subtotal').as('gross'), sql<number>`sum(case when sales.type = 'refund' then 0 else sales.discount_total end)`.as('discount'), signed('sales.total').as('net'), signed('sales.vat').as('vat'), signed('sales.cost_total').as('cost')])
      .groupBy(sql.ref(col))
      .orderBy(o.groupBy === 'day' || o.groupBy === 'hour' ? 'key' : 'net', o.groupBy === 'day' || o.groupBy === 'hour' ? 'asc' : 'desc')
      .execute();
    rows = r.map((x) => ({ key: String(x.key), label: o.groupBy === 'hour' ? `${String(x.label).padStart(2, '0')}:00` : String(x.label), qty: 0, bills: num(x.bills), gross: num(x.gross), discount: num(x.discount), net: num(x.net), vat: num(x.vat), cost: num(x.cost) }));
  }
  const out: SalesReportRow[] = rows.map((r) => ({ ...r, cost: o.canProfit ? r.cost : null, profit: o.canProfit ? r.net - r.vat - r.cost : null }));
  const sum = out.reduce((a, r) => ({ qty: a.qty + r.qty, bills: a.bills + r.bills, gross: a.gross + r.gross, discount: a.discount + r.discount, net: a.net + r.net, vat: a.vat + r.vat, cost: a.cost + (r.cost ?? 0), profit: a.profit + (r.profit ?? 0) }), { qty: 0, bills: 0, gross: 0, discount: 0, net: 0, vat: 0, cost: 0, profit: 0 });
  return { rows: out, total: { ...sum, cost: o.canProfit ? sum.cost : null, profit: o.canProfit ? sum.profit : null } };
}

/** Output VAT report (รายงานภาษีขาย) in document order. */
export async function vatReport(db: ReportDb, o: { from: string; to: string; branchId: string | null }) {
  let sq = db.selectFrom('sales').leftJoin('customers', 'customers.id', 'sales.customer_id').select(['sales.id', 'sales.doc_no', 'sales.tax_invoice_no', 'sales.type', 'sales.status', 'sales.created_at', 'sales.biz_date', 'sales.vatable', 'sales.vat', 'sales.exempt', 'sales.total', 'sales.tax_invoice', 'customers.name as customer_name']).where('sales.biz_date', '>=', o.from).where('sales.biz_date', '<=', o.to);
  if (o.branchId) sq = sq.where('sales.branch_id', '=', o.branchId);
  const rows = await sq.orderBy('sales.created_at').execute();
  const items = rows.map((r) => {
    const ti = parseJson<{ name: string; taxId: string; branch: string } | null>(r.tax_invoice, null);
    const sign = r.type === 'refund' ? -1 : 1;
    const voided = r.status === 'voided';
    return {
      date: r.biz_date,
      docNo: r.tax_invoice_no ?? r.doc_no,
      kind: r.type === 'refund' ? t('ใบลดหนี้') : r.tax_invoice_no ? t('ใบกำกับภาษีเต็มรูป') : t('ใบกำกับภาษีอย่างย่อ'),
      customer: ti?.name ?? r.customer_name ?? t('ลูกค้าทั่วไป'),
      taxId: ti?.taxId ?? '',
      branch: ti?.branch ?? '',
      base: voided ? 0 : sign * r.vatable,
      vat: voided ? 0 : sign * r.vat,
      exempt: voided ? 0 : sign * r.exempt,
      total: voided ? 0 : sign * r.total,
      status: voided ? t('ยกเลิก') : '',
    };
  });
  const total = items.reduce((a, i) => ({ base: a.base + i.base, vat: a.vat + i.vat, exempt: a.exempt + i.exempt, total: a.total + i.total }), { base: 0, vat: 0, exempt: 0, total: 0 });
  return { items, total };
}

/** Voids and refunds with reasons. */
export async function adjustmentsReport(db: ReportDb, o: { from: string; to: string; branchId: string | null }) {
  let sq = db.selectFrom('sales').leftJoin('users', 'users.id', 'sales.user_id').leftJoin('users as v', 'v.id', 'sales.voided_by').select(['sales.id', 'sales.doc_no', 'sales.type', 'sales.status', 'sales.total', 'sales.created_at', 'sales.voided_at', 'sales.void_reason', 'sales.note', 'users.name as user_name', 'v.name as voided_by']).where('sales.biz_date', '>=', o.from).where('sales.biz_date', '<=', o.to).where((eb) => eb.or([eb('sales.status', '=', 'voided'), eb('sales.type', '=', 'refund')]));
  if (o.branchId) sq = sq.where('sales.branch_id', '=', o.branchId);
  const rows = await sq.orderBy('sales.created_at', 'desc').execute();
  return { items: rows.map((r) => ({ id: r.id, docNo: r.doc_no, kind: r.status === 'voided' ? t('ยกเลิกบิล') : t('คืนสินค้า'), total: r.total, at: r.voided_at ?? r.created_at, by: r.voided_by ?? r.user_name, reason: r.void_reason ?? r.note })) };
}
