import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Catalog, SaleView } from '@flexpos/shared';
import { createTestApp, newId, type DbTarget, type TestApp } from './helpers.js';

const targets: [string, DbTarget | null][] = [
  ['sqlite', { kind: 'sqlite' }],
  ['postgres', process.env.TEST_PG ? { kind: 'postgres', host: '127.0.0.1', port: 54329, user: 'flexpos', password: 'flexpos', database: 'flexpos', ssl: false } : null],
  ['mysql', process.env.TEST_MYSQL ? { kind: 'mysql', host: '127.0.0.1', port: 33069, user: 'flexpos', password: 'flexpos', database: 'flexpos', ssl: false } : null],
];

for (const [name, target] of targets) {
  describe.skipIf(!target)(`POS flow on ${name}`, () => {
    let t: TestApp;
    let catalog: Catalog;

    beforeAll(async () => {
      t = await createTestApp(target!);
      catalog = (await t.call<Catalog>('GET', '/api/catalog')).body;
    }, 120_000);
    afterAll(async () => t?.close());

    const product = (n: string) => {
      const p = catalog.products.find((x) => x.name === n);
      if (!p) throw new Error(`no product ${n}`);
      return p;
    };

    it('rejects selling before a shift is opened', async () => {
      const p = product('ครัวซองต์เนยสด');
      const r = await t.call<{ message: string }>('POST', '/api/sales', {
        id: newId(),
        lines: [{ id: 'l1', productId: p.id, name: p.name, qty: 1, unitPrice: p.price }],
        payments: [{ methodCode: 'cash', amount: 10000 }],
      });
      expect(r.status).toBe(400);
      expect(r.body.message).toContain('เปิดกะ');
    });

    it('opens a shift', async () => {
      const r = await t.call<{ status: string; openingCash: number }>('POST', '/api/shifts/open', { openingCash: 100000 });
      expect(r.status).toBe(200);
      expect(r.body.status).toBe('open');
    });

    let saleId = '';
    it('sells with modifiers, cash change, VAT included, and deducts stock', async () => {
      const latte = product('ลาเต้ร้อน');
      const croissant = product('ครัวซองต์เนยสด');
      const groups = catalog.modifierGroups.filter((g) => latte.modifierGroupIds.includes(g.id));
      const size = groups.find((g) => g.name === 'ขนาด')!;
      const big = size.modifiers.find((m) => m.name === 'ใหญ่')!;
      saleId = newId();
      // Client sends a wrong price on purpose: the server must use catalog prices.
      const r = await t.call<SaleView>('POST', '/api/sales', {
        id: saleId,
        lines: [
          { id: 'a', productId: latte.id, name: latte.name, qty: 2, unitPrice: 1, modifiers: [{ id: big.id, name: big.name, priceDelta: big.priceDelta }] },
          { id: 'b', productId: croissant.id, name: croissant.name, qty: 1, unitPrice: croissant.price },
        ],
        payments: [{ methodCode: 'cash', amount: 50000 }],
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const s = r.body;
      expect(s.total).toBe(2 * (7500 + 1500) + 7500); // 25,500
      expect(s.change).toBe(50000 - 25500);
      expect(s.vat).toBe(Math.round((25500 * 7) / 107));
      expect(s.vat + s.vatableBase).toBe(25500);
      expect(s.docNo).toMatch(/^R01\d{4}-00001$/);
      const stock = await t.call<{ items: { name: string; qty: number }[] }>('GET', '/api/stock?q=ครัวซองต์');
      expect(stock.body.items[0]!.qty).toBe(23);
    });

    it('is idempotent on retried sale ids', async () => {
      const croissant = product('ครัวซองต์เนยสด');
      const r = await t.call<SaleView>('POST', '/api/sales', {
        id: saleId,
        lines: [{ id: 'x', productId: croissant.id, name: croissant.name, qty: 5, unitPrice: croissant.price }],
        payments: [{ methodCode: 'cash', amount: 100000 }],
      });
      expect(r.status).toBe(200);
      expect(r.body.total).toBe(25500);
      const stock = await t.call<{ items: { qty: number }[] }>('GET', '/api/stock?q=ครัวซองต์');
      expect(stock.body.items[0]!.qty).toBe(23);
    });

    it('refuses underpayment and non-cash overpayment', async () => {
      const p = product('บราวนี่');
      const under = await t.call<{ message: string }>('POST', '/api/sales', { id: newId(), lines: [{ id: 'a', productId: p.id, name: p.name, qty: 1, unitPrice: p.price }], payments: [{ methodCode: 'cash', amount: 100 }] });
      expect(under.status).toBe(400);
      const over = await t.call('POST', '/api/sales', { id: newId(), lines: [{ id: 'a', productId: p.id, name: p.name, qty: 1, unitPrice: p.price }], payments: [{ methodCode: 'transfer', amount: 99999 }] });
      expect(over.status).toBe(400);
    });

    it('applies a member group discount and earns points', async () => {
      await t.call('PUT', '/api/settings', { points: { enabled: true, earnPerSatang: 2500, pointValue: 100 } });
      const cust = (await t.call<{ items: { id: string; points: number }[] }>('GET', '/api/customers?q=สมใจ')).body.items[0]!;
      const p = product('ชีสเค้กบลูเบอร์รี่');
      const r = await t.call<SaleView>('POST', '/api/sales', { id: newId(), customerId: cust.id, lines: [{ id: 'a', productId: p.id, name: p.name, qty: 2, unitPrice: p.price }], payments: [{ methodCode: 'cash', amount: 22000 }] });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.billDiscount).toBe(1100); // 5% group discount
      expect(r.body.total).toBe(20900);
      expect(r.body.pointsEarned).toBe(8);
      const after = (await t.call<{ points: number }>('GET', `/api/customers/${cust.id}`)).body;
      expect(after.points).toBe(cust.points + 8);
    });

    it('requires a manager PIN for discounts by a cashier', async () => {
      const roles = (await t.call<{ id: string; code: string }[]>('GET', '/api/roles')).body;
      const cashier = roles.find((r) => r.code === 'cashier')!;
      const u = await t.call('POST', '/api/users', { name: 'แคชเชียร์', username: 'cash1', password: 'password123', pin: '5678', roleId: cashier.id });
      expect(u.status).toBe(200);
      const login = await t.server.app.inject({ method: 'POST', url: '/api/auth/pin', payload: { pin: '5678' } });
      const ctoken = (JSON.parse(login.body) as { accessToken: string }).accessToken;
      const p = product('บราวนี่');
      const body = { id: newId(), billDiscount: { kind: 'amount', value: 500 }, lines: [{ id: 'a', productId: p.id, name: p.name, qty: 1, unitPrice: p.price }], payments: [{ methodCode: 'cash', amount: 6000 }] };
      const denied = await t.call('POST', '/api/sales', body, { authorization: `Bearer ${ctoken}` });
      expect(denied.status).toBe(403);
      const ok = await t.call<SaleView>('POST', '/api/sales', { ...body, managerPin: '1234' }, { authorization: `Bearer ${ctoken}` });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.total).toBe(6000);
      const audit = (await t.call<{ items: { action: string }[] }>('GET', '/api/audit?action=sale.discount')).body;
      expect(audit.items.length).toBeGreaterThan(0);
    });

    it('applies buy-2-get-1 promotion', async () => {
      const p = product('เอสเพรสโซ่');
      const pr = await t.call('POST', '/api/promotions', { name: 'ซื้อ 2 แถม 1 เอสเพรสโซ่', type: 'bxgy', value: 0, buyQty: 2, getQty: 1, productIds: [p.id] });
      expect(pr.status).toBe(200);
      const r = await t.call<SaleView>('POST', '/api/sales', { id: newId(), lines: [{ id: 'a', productId: p.id, name: p.name, qty: 3, unitPrice: p.price }], payments: [{ methodCode: 'cash', amount: 20000 }] });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.total).toBe(2 * 5500);
      expect(r.body.promotions[0]!.name).toContain('ซื้อ 2');
    });

    it('refunds part of a bill and restocks', async () => {
      const detail = (await t.call<SaleView & { refundable: { lineId: string; qty: number }[] }>('GET', `/api/sales/${saleId}`)).body;
      const croissantLine = detail.lines.find((l) => l.name === 'ครัวซองต์เนยสด')!;
      const r = await t.call<SaleView>('POST', `/api/sales/${saleId}/refund`, { id: newId(), lines: [{ lineId: croissantLine.id, qty: 1 }], reason: 'ลูกค้าเปลี่ยนใจ', methodCode: 'cash' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.type).toBe('refund');
      expect(r.body.total).toBe(7500);
      const stock = await t.call<{ items: { qty: number }[] }>('GET', '/api/stock?q=ครัวซองต์');
      expect(stock.body.items[0]!.qty).toBe(24);
      const again = await t.call('POST', `/api/sales/${saleId}/refund`, { id: newId(), lines: [{ lineId: croissantLine.id, qty: 1 }], reason: 'x', methodCode: 'cash' });
      expect(again.status).toBe(400);
    });

    it('voids a bill and reverses stock', async () => {
      const p = product('บานอฟฟี่พาย');
      const id = newId();
      await t.call('POST', '/api/sales', { id, lines: [{ id: 'a', productId: p.id, name: p.name, qty: 2, unitPrice: p.price }], payments: [{ methodCode: 'promptpay', amount: 19000 }] });
      const before = (await t.call<{ items: { qty: number }[] }>('GET', '/api/stock?q=บานอฟฟี่')).body.items[0]!.qty;
      const v = await t.call<SaleView>('POST', `/api/sales/${id}/void`, { reason: 'กดผิด' });
      expect(v.status).toBe(200);
      expect(v.body.status).toBe('voided');
      const after = (await t.call<{ items: { qty: number }[] }>('GET', '/api/stock?q=บานอฟฟี่')).body.items[0]!.qty;
      expect(after).toBe(before + 2);
    });

    it('receives stock with moving-average cost', async () => {
      const p = product('น้ำดื่ม');
      const r = await t.call('POST', '/api/stock/docs', { type: 'receive', lines: [{ productId: p.id, qty: 48, unitCost: 700 }] });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const s = (await t.call<{ items: { qty: number; avgCost: number }[] }>('GET', '/api/stock?q=น้ำดื่ม')).body.items[0]!;
      expect(s.qty).toBe(96);
      expect(s.avgCost).toBe(600); // (48*500 + 48*700) / 96
    });

    it('runs a table order: rounds, kitchen, pay with orderId', async () => {
      const floor = (await t.call<{ tables: { id: string; name: string }[] }>('GET', '/api/floor')).body;
      const table = floor.tables[0]!;
      const o = (await t.call<{ id: string }>('POST', '/api/orders', { tableId: table.id, guests: 2 })).body;
      const latte = product('ลาเต้ร้อน');
      const size = catalog.modifierGroups.find((g) => g.name === 'ขนาด')!;
      const reqId = newId();
      const add = await t.call<{ total: number }>('POST', `/api/orders/${o.id}/items`, { requestId: reqId, source: 'app', items: [{ productId: latte.id, qty: 2, modifiers: [{ id: size.modifiers[0]!.id, name: 'ปกติ', priceDelta: 0 }] }] });
      expect(add.status, JSON.stringify(add.body)).toBe(200);
      expect(add.body.total).toBe(15000);
      const dup = await t.call<{ total: number }>('POST', `/api/orders/${o.id}/items`, { requestId: reqId, source: 'app', items: [{ productId: latte.id, qty: 2, modifiers: [] }] });
      expect(dup.body.total).toBe(15000);
      const k = (await t.call<{ id: string }[]>('GET', '/api/kitchen')).body;
      expect(k.length).toBe(1);
      await t.call('POST', '/api/kitchen/items/status', { ids: [k[0]!.id], status: 'ready' });
      const order = (await t.call<{ items: { product_id: string; qty: number; unit_price: number; modifiers: { id: string; name: string; priceDelta: number }[] }[] }>('GET', `/api/orders/${o.id}`)).body;
      const pay = await t.call<SaleView>('POST', '/api/sales', {
        id: newId(),
        orderId: o.id,
        lines: order.items.map((i, n) => ({ id: `o${n}`, productId: i.product_id, name: 'x', qty: i.qty, unitPrice: i.unit_price, modifiers: i.modifiers })),
        payments: [{ methodCode: 'cash', amount: 15000 }],
      });
      expect(pay.status, JSON.stringify(pay.body)).toBe(200);
      expect(pay.body.tableName).toBe(table.name);
      const floor2 = (await t.call<{ tables: { id: string; order: unknown }[] }>('GET', '/api/floor')).body;
      expect(floor2.tables.find((x) => x.id === table.id)!.order).toBeNull();
    });

    it('closes the shift with expected cash and reports', async () => {
      const cur = (await t.call<{ id: string; expectedCash: number }>('GET', '/api/shifts/current')).body;
      // opening 1000 + cash sales - cash refund(75)
      expect(cur.expectedCash).toBeGreaterThan(100000);
      const closed = await t.call<{ status: string; difference: number }>('POST', `/api/shifts/${cur.id}/close`, { countedCash: cur.expectedCash - 100 });
      expect(closed.body.status).toBe('closed');
      expect(closed.body.difference).toBe(-100);
      const dash = await t.call<{ kpis: { cur: { net: number; bills: number } } }>('GET', '/api/reports/dashboard?range=today');
      expect(dash.status, JSON.stringify(dash.body)).toBe(200);
      expect(dash.body.kpis.cur.bills).toBeGreaterThan(3);
      const today = new Date();
      const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      for (const g of ['day', 'hour', 'product', 'category', 'staff', 'method', 'branch']) {
        const r = await t.call<{ rows: unknown[] }>('GET', `/api/reports/sales?from=${d}&to=${d}&groupBy=${g}`);
        expect(r.status, `${g}: ${JSON.stringify(r.body)}`).toBe(200);
      }
      const vat = await t.call<{ total: { vat: number } }>('GET', `/api/reports/vat?from=${d}&to=${d}`);
      expect(vat.status).toBe(200);
      expect(vat.body.total.vat).toBeGreaterThan(0);
      const xlsx = await t.server.app.inject({ method: 'GET', url: `/api/reports/sales?from=${d}&to=${d}&groupBy=product&format=xlsx`, headers: { authorization: `Bearer ${t.token}` } });
      expect(xlsx.statusCode).toBe(200);
      expect(xlsx.rawPayload.subarray(0, 2).toString()).toBe('PK');
    });

    it('backs up and restores', async () => {
      const b = await t.call<{ size: number }>('POST', '/api/backups');
      expect(b.status).toBe(200);
      const list = (await t.call<{ items: { name: string }[] }>('GET', '/api/backups')).body.items;
      const before = (await t.call<{ total: number }>('GET', '/api/sales')).body.total;
      const r = await t.call<{ rows: number }>('POST', `/api/backups/restore?name=${encodeURIComponent(list[0]!.name)}`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const after = (await t.call<{ total: number }>('GET', '/api/sales')).body.total;
      expect(after).toBe(before);
    });
  });
}
