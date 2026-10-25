import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { localDate, toCsv, t } from '@flexpos/shared';
import type { AppContext } from '../context.js';
import { branchOf, currentUser, hasPerm, requireAuth } from '../auth.js';
import { adjustmentsReport, dashboard, salesReport, vatReport } from '@flexpos/reports';

const rangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  branchId: z.string().optional(),
  format: z.enum(['json', 'csv', 'xlsx']).default('json'),
});

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

  app.get('/api/reports/dashboard', auth('reports.view'), async (req) => {
    const q = z.object({ range: z.enum(['today', '7d', '30d']).default('today'), branchId: z.string().optional() }).parse(req.query);
    return dashboard(ctx.db, {
      range: q.range,
      branchId: scopeBranch(req, q.branchId),
      canProfit: hasPerm(currentUser(req), 'reports.profit'),
      modules: { stock: ctx.settings.modules.stock, restaurant: ctx.settings.modules.restaurant },
      defaultBranchId: ctx.defaultBranchId,
    });
  });

  /** Sales summary grouped by a dimension. */
  app.get('/api/reports/sales', auth('reports.view'), async (req, reply) => {
    const q = rangeSchema.extend({ groupBy: z.enum(['day', 'hour', 'product', 'category', 'staff', 'method', 'branch']).default('day') }).parse(req.query);
    const branchId = scopeBranch(req, q.branchId);
    const canProfit = hasPerm(currentUser(req), 'reports.profit');
    const { rows: out, total } = await salesReport(ctx.db, { from: q.from, to: q.to, groupBy: q.groupBy, branchId, canProfit });
    if (q.format !== 'json') {
      const header = [t('รายการ'), t('จำนวน'), t('บิล'), t('ยอดก่อนส่วนลด'), t('ส่วนลด'), t('ยอดขายสุทธิ'), 'VAT', ...(canProfit ? [t('ต้นทุน'), t('กำไรขั้นต้น')] : [])];
      return sendTable(reply, q.format, `sales-${q.groupBy}-${q.from}_${q.to}`, header, out.map((r) => [r.label, r.qty, r.bills, baht(r.gross), baht(r.discount), baht(r.net), baht(r.vat), ...(canProfit ? [baht(r.cost ?? 0), baht(r.profit ?? 0)] : [])]));
    }
    return { rows: out, total };
  });

  /** Output VAT report (รายงานภาษีขาย) in document order. */
  app.get('/api/reports/vat', auth('reports.view'), async (req, reply) => {
    const q = rangeSchema.parse(req.query);
    const branchId = scopeBranch(req, q.branchId);
    const { items, total: sum } = await vatReport(ctx.db, { from: q.from, to: q.to, branchId });
    if (q.format !== 'json') {
      return sendTable(reply, q.format, `vat-report-${q.from}_${q.to}`, [t('วันที่'), t('เลขที่เอกสาร'), t('ประเภท'), t('ชื่อผู้ซื้อ'), t('เลขประจำตัวผู้เสียภาษี'), t('สาขา'), t('มูลค่าสินค้า/บริการ'), t('ภาษีมูลค่าเพิ่ม'), t('ยกเว้นภาษี'), t('รวม'), t('หมายเหตุ')], [
        ...items.map((i) => [i.date, i.docNo, i.kind, i.customer, i.taxId, i.branch, baht(i.base), baht(i.vat), baht(i.exempt), baht(i.total), i.status]),
        ['', '', '', t('รวม'), '', '', baht(sum.base), baht(sum.vat), baht(sum.exempt), baht(sum.total), ''],
      ]);
    }
    return { items, total: sum, store: { name: ctx.settings.store.name, taxId: ctx.settings.store.taxId } };
  });

  /** Voids and refunds with reasons. */
  app.get('/api/reports/adjustments', auth('reports.view'), async (req, reply) => {
    const q = rangeSchema.parse(req.query);
    const branchId = scopeBranch(req, q.branchId);
    const { items } = await adjustmentsReport(ctx.db, { from: q.from, to: q.to, branchId });
    if (q.format !== 'json') return sendTable(reply, q.format, `voids-refunds-${q.from}_${q.to}`, [t('เวลา'), t('เลขที่'), t('ประเภท'), t('ยอด'), t('ผู้อนุมัติ/ผู้ทำ'), t('เหตุผล')], items.map((i) => [i.at, i.docNo, i.kind, baht(i.total), i.by ?? '', i.reason ?? '']));
    return { items };
  });

  app.get('/api/reports/stock', auth('stock.view'), async (req, reply) => {
    const { format } = z.object({ format: z.enum(['csv', 'xlsx']).default('xlsx') }).parse(req.query);
    const branchId = branchOf(ctx, req);
    const canProfit = hasPerm(currentUser(req), 'reports.profit');
    const rows = await ctx.db.selectFrom('stock_levels').innerJoin('products', 'products.id', 'stock_levels.product_id').leftJoin('product_variants', 'product_variants.id', 'stock_levels.variant_id').leftJoin('categories', 'categories.id', 'products.category_id').select(['products.sku', 'products.name', 'product_variants.name as variant_name', 'categories.name as cat', 'products.unit', 'stock_levels.qty', 'stock_levels.avg_cost']).where('stock_levels.branch_id', '=', branchId).where('products.deleted_at', 'is', null).orderBy('products.name').execute();
    return sendTable(reply, format, `stock-${localDate()}`, ['SKU', t('สินค้า'), t('หมวด'), t('หน่วย'), t('คงเหลือ'), ...(canProfit ? [t('ต้นทุนเฉลี่ย'), t('มูลค่า')] : [])], rows.map((r) => [r.sku, r.variant_name ? `${r.name} (${r.variant_name})` : r.name, r.cat ?? '', r.unit, r.qty, ...(canProfit ? [baht(r.avg_cost), baht(Math.round(r.qty * r.avg_cost))] : [])]));
  });

}
