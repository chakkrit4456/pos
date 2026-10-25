import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  buildReceiptDoc,
  cashMoveSchema,
  closeShiftSchema,
  holdSchema,
  openShiftSchema,
  promptPayAccount,
  promptPayPayload,
  quoteSchema,
  refundSchema,
  saleSchema,
  taxInvoiceSchema,
  voidSchema,
} from '@flexpos/shared';
import type { AppContext } from '../context.js';
import { audit, authorizeWithPin, branchOf, currentUser, hasPerm, nextSeq, requireAuth } from '../auth.js';
import { badRequest, notFound } from '../errors.js';
import { bizStamp, nowIso, num, parseJson, uuid } from '../util.js';
import { createSale, getSaleView, quote, refundSale, voidSale } from '../services/sales.js';
import type { LicenseService } from '../services/license.js';
import type { PrintService } from '../services/printing.js';
import { ilike } from '@flexpos/db';

export const registerOf = (req: FastifyRequest): string => {
  const h = req.headers['x-register'];
  return typeof h === 'string' && h.trim() ? h.trim().slice(0, 60) : 'POS-1';
};

export function salesRoutes(app: FastifyInstance, ctx: AppContext, license: LicenseService, printer: PrintService) {
  const auth = (...p: Parameters<typeof requireAuth>[1][]) => ({ preHandler: requireAuth(ctx, ...p) });

  app.post('/api/sales/quote', auth('pos.sell'), async (req) => quote(ctx, branchOf(ctx, req), quoteSchema.parse(req.body)));

  app.post('/api/sales', auth('pos.sell'), async (req) => {
    const input = saleSchema.parse(req.body);
    return createSale(ctx, req, currentUser(req), branchOf(ctx, req), registerOf(req), input, license);
  });

  app.get('/api/sales', auth(), async (req) => {
    const q = z
      .object({
        q: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        status: z.string().optional(),
        type: z.enum(['sale', 'refund']).optional(),
        customerId: z.string().optional(),
        shiftId: z.string().optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query);
    const user = currentUser(req);
    let base = ctx.db
      .selectFrom('sales')
      .leftJoin('users', 'users.id', 'sales.user_id')
      .leftJoin('customers', 'customers.id', 'sales.customer_id')
      .where('sales.branch_id', '=', branchOf(ctx, req));
    // Cashiers without report access only see their own bills.
    if (!hasPerm(user, 'reports.view')) base = base.where('sales.user_id', '=', user.id);
    if (q.from) base = base.where('sales.biz_date', '>=', q.from);
    if (q.to) base = base.where('sales.biz_date', '<=', q.to);
    if (q.status) base = base.where('sales.status', '=', q.status);
    if (q.type) base = base.where('sales.type', '=', q.type);
    if (q.customerId) base = base.where('sales.customer_id', '=', q.customerId);
    if (q.shiftId) base = base.where('sales.shift_id', '=', q.shiftId);
    if (q.q) {
      const t = `%${q.q.trim()}%`;
      const like = ilike(ctx.dialect);
      base = base.where((eb) => eb.or([eb('sales.doc_no', like, t), eb('sales.tax_invoice_no', like, t), eb('customers.name', like, t), eb('customers.phone', like, t)]));
    }
    const total = await base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const items = await base
      .select([
        'sales.id', 'sales.doc_no', 'sales.tax_invoice_no', 'sales.type', 'sales.status', 'sales.total', 'sales.created_at',
        'sales.table_name', 'users.name as user_name', 'customers.name as customer_name',
      ])
      .orderBy('sales.created_at', 'desc')
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .execute();
    return { total: num(total?.n), items };
  });

  app.get('/api/sales/:id', auth(), async (req) => {
    const { id } = req.params as { id: string };
    const sale = await getSaleView(ctx, id);
    const lines = await ctx.db.selectFrom('sale_lines').select(['id', 'qty', 'refunded_qty']).where('sale_id', '=', id).execute();
    return { ...sale, refundable: lines.map((l) => ({ lineId: l.id, qty: l.qty - l.refunded_qty })) };
  });

  app.get('/api/sales/:id/receipt', auth(), async (req) => {
    const { id } = req.params as { id: string };
    const { reprint, paper } = z.object({ reprint: z.coerce.boolean().default(false), paper: z.enum(['58', '80', 'A4']).optional() }).parse(req.query);
    const sale = await getSaleView(ctx, id);
    const credit = sale.payments.find((p) => p.kind === 'credit');
    const acct = promptPayAccount(ctx.settings);
    const pp = credit && acct ? promptPayPayload(acct.promptPayId, credit.amount) : null;
    return buildReceiptDoc(sale, ctx.settings, { reprint, paper, promptPayPayload: pp });
  });

  /** Print a receipt on a network printer. Reprints need permission and are audited. */
  app.post('/api/sales/:id/print', auth(), async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ printerId: z.string().optional(), reprint: z.boolean().default(false), openDrawer: z.boolean().default(false) }).parse(req.body ?? {});
    const user = currentUser(req);
    if (b.reprint && !hasPerm(user, 'pos.reprint')) throw badRequest('ไม่มีสิทธิ์พิมพ์ซ้ำ');
    const branchId = branchOf(ctx, req);
    let pq = ctx.db.selectFrom('printers').selectAll().where('active', '=', 1).where('role', '=', 'receipt').where('kind', '=', 'network').where('branch_id', '=', branchId);
    if (b.printerId) pq = pq.where('id', '=', b.printerId);
    const p = await pq.executeTakeFirst();
    if (!p) throw badRequest('ยังไม่ได้ตั้งค่าเครื่องพิมพ์ใบเสร็จแบบเครือข่าย');
    const sale = await getSaleView(ctx, id);
    const doc = buildReceiptDoc(sale, ctx.settings, { reprint: b.reprint, paper: p.paper === '58' ? '58' : '80' });
    doc.openDrawer = b.openDrawer || (p.open_drawer === 1 && sale.payments.some((x) => x.kind === 'cash') && ctx.settings.receipt.openDrawerOnCash && !b.reprint);
    for (let i = 0; i < (b.reprint ? 1 : ctx.settings.receipt.copies); i++) await printer.enqueue(ctx.db, p.id, 'receipt', sale.docNo, doc);
    if (b.reprint) await audit(ctx, ctx.db, req, 'sale.reprint', 'sale', id, { docNo: sale.docNo });
    return { ok: true };
  });

  app.post('/api/drawer/open', auth(), async (req) => {
    const user = currentUser(req);
    const { managerPin } = z.object({ managerPin: z.string().optional() }).parse(req.body ?? {});
    const by = await authorizeWithPin(ctx, user, 'pos.open_drawer', managerPin);
    const p = await ctx.db.selectFrom('printers').selectAll().where('active', '=', 1).where('role', '=', 'receipt').where('kind', '=', 'network').where('branch_id', '=', branchOf(ctx, req)).executeTakeFirst();
    if (!p) throw badRequest('ต้องมีเครื่องพิมพ์ใบเสร็จแบบเครือข่ายที่ต่อกับลิ้นชัก');
    await printer.send(p, { paper: '80', blocks: [], cut: false, openDrawer: true });
    await audit(ctx, ctx.db, req, 'drawer.open', 'printer', p.id, { approvedBy: by.name });
    return { ok: true };
  });

  app.post('/api/sales/:id/void', auth(), async (req) => {
    const { id } = req.params as { id: string };
    const b = voidSchema.parse(req.body);
    return voidSale(ctx, req, currentUser(req), id, b.reason, b.managerPin);
  });

  app.post('/api/sales/:id/refund', auth(), async (req) => {
    const { id } = req.params as { id: string };
    return refundSale(ctx, req, currentUser(req), id, refundSchema.parse(req.body), registerOf(req));
  });

  /** Issue a full tax invoice for an existing abbreviated receipt. */
  app.post('/api/sales/:id/tax-invoice', auth('pos.sell'), async (req) => {
    const { id } = req.params as { id: string };
    const ti = taxInvoiceSchema.parse(req.body);
    if (!ctx.settings.tax.vatEnabled) throw badRequest('ร้านยังไม่ได้เปิดใช้ VAT');
    await ctx.db.transaction().execute(async (tx) => {
      const s = await tx.selectFrom('sales').selectAll().where('id', '=', id).executeTakeFirst();
      if (!s) throw notFound('บิล');
      if (s.status === 'voided') throw badRequest('บิลถูกยกเลิกแล้ว');
      if (s.tax_invoice_no) throw badRequest(`ออกใบกำกับภาษีเต็มรูปแล้ว เลขที่ ${s.tax_invoice_no}`);
      const created = new Date();
      const branch = await tx.selectFrom('branches').select('code').where('id', '=', s.branch_id).executeTakeFirstOrThrow();
      const r = ctx.settings.receipt;
      const seq = await nextSeq(tx, `taxinv:${s.branch_id}:${created.getFullYear()}`);
      const { formatDocNo } = await import('@flexpos/shared');
      const no = formatDocNo(r.taxInvoicePattern, { prefix: r.taxInvoicePrefix, branch: branch.code, seq, date: created });
      await tx.updateTable('sales').set({ tax_invoice_no: no, tax_invoice: JSON.stringify(ti) }).where('id', '=', id).execute();
      await audit(ctx, tx, req, 'sale.tax_invoice', 'sale', id, { docNo: s.doc_no, taxInvoiceNo: no });
    });
    return getSaleView(ctx, id);
  });

  /** Exact-amount PromptPay QR for the chosen (or default) company account. Works with every Thai bank/e-wallet app. */
  app.get('/api/promptpay', auth(), async (req) => {
    const { amount, accountId } = z.object({ amount: z.coerce.number().int().min(0), accountId: z.string().optional() }).parse(req.query);
    const pp = promptPayAccount(ctx.settings, accountId);
    if (!pp) throw badRequest('ยังไม่ได้ตั้งค่าบัญชีรับเงิน PromptPay (ตั้งค่า → บัญชีรับเงิน)');
    try {
      return { payload: promptPayPayload(pp.promptPayId, amount), account: pp.account, amount };
    } catch (e) {
      throw badRequest(e instanceof Error ? e.message : 'หมายเลข PromptPay ไม่ถูกต้อง');
    }
  });

  /* ---------- Held bills ---------- */
  app.get('/api/held', auth('pos.sell'), async (req) => {
    const rows = await ctx.db.selectFrom('held_bills').leftJoin('users', 'users.id', 'held_bills.user_id').select(['held_bills.id', 'held_bills.name', 'held_bills.data', 'held_bills.created_at', 'users.name as user_name']).where('held_bills.branch_id', '=', branchOf(ctx, req)).orderBy('held_bills.created_at', 'desc').execute();
    return rows.map((r) => ({ id: r.id, name: r.name, userName: r.user_name, createdAt: r.created_at, data: parseJson(r.data, {}) }));
  });
  app.post('/api/held', auth('pos.sell'), async (req) => {
    const b = holdSchema.parse(req.body);
    const exists = await ctx.db.selectFrom('held_bills').select('id').where('id', '=', b.id).executeTakeFirst();
    const row = { name: b.name, data: JSON.stringify(b.data) };
    if (exists) await ctx.db.updateTable('held_bills').set(row).where('id', '=', b.id).execute();
    else await ctx.db.insertInto('held_bills').values({ id: b.id, branch_id: branchOf(ctx, req), user_id: currentUser(req).id, created_at: nowIso(), ...row }).execute();
    return { id: b.id };
  });
  app.delete('/api/held/:id', auth('pos.sell'), async (req) => {
    await ctx.db.deleteFrom('held_bills').where('id', '=', (req.params as { id: string }).id).execute();
    return { ok: true };
  });

  /* ---------- Shifts ---------- */
  const shiftSummary = async (shiftId: string) => {
    const s = await ctx.db.selectFrom('shifts').selectAll().where('id', '=', shiftId).executeTakeFirst();
    if (!s) throw notFound('กะ');
    const pays = await ctx.db
      .selectFrom('sale_payments')
      .innerJoin('sales', 'sales.id', 'sale_payments.sale_id')
      .select(['sale_payments.method_name', 'sale_payments.kind', 'sales.type', (eb) => eb.fn.sum<number>('sale_payments.amount').as('amount'), (eb) => eb.fn.countAll<number>().as('n')])
      .where('sale_payments.shift_id', '=', shiftId)
      .where('sales.status', '!=', 'voided')
      .groupBy(['sale_payments.method_name', 'sale_payments.kind', 'sales.type'])
      .execute();
    const sales = await ctx.db
      .selectFrom('sales')
      .select(['type', 'status', (eb) => eb.fn.sum<number>('total').as('total'), (eb) => eb.fn.sum<number>('discount_total').as('disc'), (eb) => eb.fn.sum<number>('vat').as('vat'), (eb) => eb.fn.countAll<number>().as('n')])
      .where('shift_id', '=', shiftId)
      .groupBy(['type', 'status'])
      .execute();
    const moves = await ctx.db.selectFrom('cash_moves').leftJoin('users', 'users.id', 'cash_moves.user_id').select(['cash_moves.id', 'cash_moves.type', 'cash_moves.amount', 'cash_moves.reason', 'cash_moves.created_at', 'users.name as user_name']).where('shift_id', '=', shiftId).orderBy('cash_moves.created_at').execute();
    const sum = (f: (r: (typeof sales)[number]) => boolean, k: 'total' | 'disc' | 'vat' | 'n') => sales.filter(f).reduce((a, r) => a + num(r[k]), 0);
    const cashSales = pays.filter((p) => p.kind === 'cash' && p.type === 'sale').reduce((a, p) => a + num(p.amount), 0);
    const cashRefunds = pays.filter((p) => p.kind === 'cash' && p.type === 'refund').reduce((a, p) => a + num(p.amount), 0);
    const cashIn = moves.filter((m) => m.type === 'in').reduce((a, m) => a + m.amount, 0);
    const cashOut = moves.filter((m) => m.type === 'out').reduce((a, m) => a + m.amount, 0);
    const expected = s.opening_cash + cashSales - cashRefunds + cashIn - cashOut;
    const [openedBy, closedBy] = await Promise.all([
      ctx.db.selectFrom('users').select('name').where('id', '=', s.opened_by).executeTakeFirst(),
      s.closed_by ? ctx.db.selectFrom('users').select('name').where('id', '=', s.closed_by).executeTakeFirst() : undefined,
    ]);
    const methods = new Map<string, { name: string; sales: number; refunds: number; count: number }>();
    for (const p of pays) {
      const m = methods.get(p.method_name) ?? { name: p.method_name, sales: 0, refunds: 0, count: 0 };
      if (p.type === 'sale') {
        m.sales += num(p.amount);
        m.count += num(p.n);
      } else m.refunds += num(p.amount);
      methods.set(p.method_name, m);
    }
    return {
      id: s.id,
      number: s.number,
      register: s.register,
      status: s.status,
      openedAt: s.opened_at,
      closedAt: s.closed_at,
      openedBy: openedBy?.name ?? '',
      closedBy: closedBy?.name ?? null,
      openingCash: s.opening_cash,
      countedCash: s.counted_cash,
      expectedCash: s.status === 'closed' ? s.expected_cash : expected,
      difference: s.status === 'closed' && s.counted_cash !== null && s.expected_cash !== null ? s.counted_cash - s.expected_cash : null,
      cashSales,
      cashRefunds,
      cashIn,
      cashOut,
      salesTotal: sum((r) => r.type === 'sale' && r.status !== 'voided', 'total'),
      salesCount: sum((r) => r.type === 'sale' && r.status !== 'voided', 'n'),
      refundTotal: sum((r) => r.type === 'refund', 'total'),
      voidTotal: sum((r) => r.status === 'voided', 'total'),
      voidCount: sum((r) => r.status === 'voided', 'n'),
      discountTotal: sum((r) => r.type === 'sale' && r.status !== 'voided', 'disc'),
      vatTotal: sum((r) => r.type === 'sale' && r.status !== 'voided', 'vat') - sum((r) => r.type === 'refund', 'vat'),
      methods: [...methods.values()],
      moves: moves.map((m) => ({ id: m.id, type: m.type, amount: m.amount, reason: m.reason, at: m.created_at, by: m.user_name })),
      note: s.note,
    };
  };

  app.get('/api/shifts/current', auth(), async (req) => {
    const s = await ctx.db.selectFrom('shifts').select('id').where('branch_id', '=', branchOf(ctx, req)).where('register', '=', registerOf(req)).where('status', '=', 'open').executeTakeFirst();
    return s ? shiftSummary(s.id) : null;
  });

  app.get('/api/shifts', auth('shift.manage'), async (req) => {
    const rows = await ctx.db.selectFrom('shifts').leftJoin('users', 'users.id', 'shifts.opened_by').select(['shifts.id', 'shifts.number', 'shifts.register', 'shifts.status', 'shifts.opened_at', 'shifts.closed_at', 'shifts.opening_cash', 'shifts.counted_cash', 'shifts.expected_cash', 'users.name as opened_by']).where('shifts.branch_id', '=', branchOf(ctx, req)).orderBy('shifts.opened_at', 'desc').limit(100).execute();
    return rows;
  });

  app.get('/api/shifts/:id', auth('shift.manage'), async (req) => shiftSummary((req.params as { id: string }).id));

  app.post('/api/shifts/open', auth('shift.manage'), async (req) => {
    const b = openShiftSchema.parse(req.body);
    const register = req.headers['x-register'] ? registerOf(req) : b.register;
    const branchId = branchOf(ctx, req);
    const user = currentUser(req);
    const id = await ctx.db.transaction().execute(async (tx) => {
      const open = await tx.selectFrom('shifts').select('id').where('branch_id', '=', branchId).where('register', '=', register).where('status', '=', 'open').executeTakeFirst();
      if (open) throw badRequest('เครื่องนี้มีกะที่เปิดอยู่แล้ว');
      const n = await nextSeq(tx, `shift:${branchId}`);
      const id = uuid();
      await tx.insertInto('shifts').values({ id, number: n, branch_id: branchId, register, opened_by: user.id, opened_at: nowIso(), opening_cash: b.openingCash, closed_by: null, closed_at: null, counted_cash: null, expected_cash: null, status: 'open', note: '' }).execute();
      await audit(ctx, tx, req, 'shift.open', 'shift', id, { number: n, openingCash: b.openingCash, register });
      return id;
    });
    return shiftSummary(id);
  });

  app.post('/api/shifts/:id/cash', auth('shift.manage'), async (req) => {
    const { id } = req.params as { id: string };
    const b = cashMoveSchema.parse(req.body);
    const s = await ctx.db.selectFrom('shifts').select('status').where('id', '=', id).executeTakeFirst();
    if (!s || s.status !== 'open') throw badRequest('กะนี้ปิดแล้ว');
    await ctx.db.insertInto('cash_moves').values({ id: uuid(), shift_id: id, type: b.type, amount: b.amount, reason: b.reason, user_id: currentUser(req).id, created_at: nowIso() }).execute();
    await audit(ctx, ctx.db, req, b.type === 'in' ? 'shift.cash_in' : 'shift.cash_out', 'shift', id, { amount: b.amount, reason: b.reason });
    return shiftSummary(id);
  });

  app.post('/api/shifts/:id/close', auth('shift.manage'), async (req) => {
    const { id } = req.params as { id: string };
    const b = closeShiftSchema.parse(req.body);
    const sum = await shiftSummary(id);
    if (sum.status !== 'open') throw badRequest('กะนี้ปิดไปแล้ว');
    await ctx.db.transaction().execute(async (tx) => {
      await tx.updateTable('shifts').set({ status: 'closed', closed_at: nowIso(), closed_by: currentUser(req).id, counted_cash: b.countedCash, expected_cash: sum.expectedCash, note: b.note }).where('id', '=', id).execute();
      await audit(ctx, tx, req, 'shift.close', 'shift', id, { expected: sum.expectedCash, counted: b.countedCash, diff: b.countedCash - (sum.expectedCash ?? 0) });
    });
    return shiftSummary(id);
  });

  /** X (mid-shift) / Z (closing) report as a printable document. */
  app.get('/api/shifts/:id/report', auth('shift.manage'), async (req) => {
    const s = await shiftSummary((req.params as { id: string }).id);
    const { formatAmount, formatDateTime } = await import('@flexpos/shared');
    const era = ctx.settings.locale.era;
    const row = (left: string, v: number | null) => ({ t: 'row' as const, left, right: v === null ? '-' : formatAmount(v) });
    return {
      paper: ctx.settings.receipt.paper === 'A4' ? '80' : ctx.settings.receipt.paper,
      cut: true,
      blocks: [
        { t: 'text', text: ctx.settings.store.name, align: 'center', bold: true, size: 2 },
        { t: 'text', text: s.status === 'closed' ? 'Z REPORT · สรุปปิดกะ' : 'X REPORT · สรุประหว่างกะ', align: 'center', bold: true },
        { t: 'text', text: `กะ #${s.number} · ${s.register}`, align: 'center' },
        { t: 'text', text: `เปิด ${formatDateTime(s.openedAt, era)} โดย ${s.openedBy}` },
        ...(s.closedAt ? [{ t: 'text' as const, text: `ปิด ${formatDateTime(s.closedAt, era)} โดย ${s.closedBy ?? ''}` }] : []),
        { t: 'line', dashed: true },
        row(`ยอดขาย (${s.salesCount} บิล)`, s.salesTotal),
        row('ส่วนลด', s.discountTotal),
        row('ภาษีขาย', s.vatTotal),
        row('คืนสินค้า', s.refundTotal),
        row(`ยกเลิก (${s.voidCount} บิล)`, s.voidTotal),
        { t: 'line', dashed: true },
        ...s.methods.map((m) => row(`${m.name} (${m.count})`, m.sales - m.refunds)),
        { t: 'line', dashed: true },
        row('เงินทอนตั้งต้น', s.openingCash),
        row('รับเงินสด', s.cashSales),
        row('คืนเงินสด', -s.cashRefunds),
        row('นำเงินเข้า', s.cashIn),
        row('นำเงินออก', -s.cashOut),
        { t: 'row', left: 'เงินสดที่ควรมี', right: formatAmount(s.expectedCash ?? 0), bold: true },
        ...(s.countedCash !== null ? [row('นับได้จริง', s.countedCash), { t: 'row' as const, left: 'ส่วนต่าง', right: formatAmount(s.difference ?? 0), bold: true }] : []),
        { t: 'feed', lines: 1 },
        { t: 'text', text: `พิมพ์เมื่อ ${formatDateTime(new Date(), era)}`, align: 'center' },
      ],
    };
  });

  /* ---------- Customer credit payments ---------- */
  app.post('/api/customers/:id/pay-credit', auth('customers.manage'), async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ amount: z.number().int().positive(), methodCode: z.string(), note: z.string().max(200).default('') }).parse(req.body);
    const user = currentUser(req);
    const branchId = branchOf(ctx, req);
    await ctx.db.transaction().execute(async (tx) => {
      const c = await tx.selectFrom('customers').select(['credit_balance', 'name']).where('id', '=', id).executeTakeFirst();
      if (!c) throw notFound('ลูกค้า');
      if (b.amount > c.credit_balance) throw badRequest(`ยอดชำระเกินยอดค้าง (${(c.credit_balance / 100).toFixed(2)} บาท)`);
      const m = await tx.selectFrom('payment_methods').selectAll().where('code', '=', b.methodCode).executeTakeFirst();
      if (!m || m.kind === 'credit') throw badRequest('วิธีชำระไม่ถูกต้อง');
      const shift = await tx.selectFrom('shifts').select('id').where('branch_id', '=', branchId).where('register', '=', registerOf(req)).where('status', '=', 'open').executeTakeFirst();
      await tx.updateTable('customers').set((eb) => ({ credit_balance: eb('credit_balance', '-', b.amount) })).where('id', '=', id).execute();
      await tx.insertInto('credit_moves').values({ id: uuid(), customer_id: id, sale_id: null, amount: -b.amount, type: 'payment', method: m.code, note: b.note, user_id: user.id, created_at: nowIso() }).execute();
      if (m.kind === 'cash' && shift)
        await tx.insertInto('cash_moves').values({ id: uuid(), shift_id: shift.id, type: 'in', amount: b.amount, reason: `รับชำระหนี้ ${c.name}`, user_id: user.id, created_at: nowIso() }).execute();
      await audit(ctx, tx, req, 'customer.credit_payment', 'customer', id, { amount: b.amount, method: m.code });
    });
    return { ok: true };
  });

  /* ---------- Offline sync: replay queued sales in order ---------- */
  app.post('/api/sync/sales', auth('pos.sell'), async (req) => {
    const { sales } = z.object({ sales: z.array(z.unknown()).max(500) }).parse(req.body);
    const results: { id: string; ok: boolean; docNo?: string; error?: string }[] = [];
    for (const raw of sales) {
      const parsed = saleSchema.safeParse(raw);
      if (!parsed.success) {
        results.push({ id: String((raw as { id?: unknown })?.id ?? ''), ok: false, error: parsed.error.issues[0]?.message });
        continue;
      }
      try {
        const v = await createSale(ctx, req, currentUser(req), branchOf(ctx, req), registerOf(req), parsed.data, license, { offline: true });
        results.push({ id: parsed.data.id, ok: true, docNo: v.docNo });
      } catch (e) {
        results.push({ id: parsed.data.id, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return { results, at: bizStamp(new Date()).created_at };
  });
}
