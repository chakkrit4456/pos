import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { orderItemsSchema, resolveBasePrice, tableSchema, validateModifiers, zoneSchema } from '@flexpos/shared';
import type { AppContext, Tx } from '../context.js';
import { audit, authorizeWithPin, branchOf, currentUser, nextSeq, requireAuth } from '../auth.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { nowIso, num, parseJson, uuid } from '../util.js';
import { cachedCatalog } from '../services/sales.js';
import type { PrintService } from '../services/printing.js';

const ITEM_STATUSES = ['pending', 'sent', 'preparing', 'ready', 'served', 'cancelled'] as const;

export function restaurantRoutes(app: FastifyInstance, ctx: AppContext, printer: PrintService) {
  const auth = (...p: Parameters<typeof requireAuth>[1][]) => ({ preHandler: requireAuth(ctx, ...p) });

  /* ---------- Zones & tables ---------- */
  app.get('/api/zones', auth(), async (req) => ctx.db.selectFrom('zones').selectAll().where('branch_id', '=', branchOf(ctx, req)).orderBy('sort').execute());
  app.post('/api/zones', auth('settings.manage'), async (req) => {
    const b = zoneSchema.parse(req.body);
    const id = uuid();
    await ctx.db.insertInto('zones').values({ id, branch_id: branchOf(ctx, req), name: b.name, sort: b.sort }).execute();
    return { id };
  });
  app.put('/api/zones/:id', auth('settings.manage'), async (req) => {
    const b = zoneSchema.parse(req.body);
    await ctx.db.updateTable('zones').set({ name: b.name, sort: b.sort }).where('id', '=', (req.params as { id: string }).id).execute();
    return { ok: true };
  });
  app.delete('/api/zones/:id', auth('settings.manage'), async (req) => {
    const { id } = req.params as { id: string };
    await ctx.db.updateTable('tables').set({ zone_id: null }).where('zone_id', '=', id).execute();
    await ctx.db.deleteFrom('zones').where('id', '=', id).execute();
    return { ok: true };
  });
  app.post('/api/tables', auth('settings.manage'), async (req) => {
    const b = tableSchema.parse(req.body);
    const branchId = branchOf(ctx, req);
    const dup = await ctx.db.selectFrom('tables').select('id').where('branch_id', '=', branchId).where('name', '=', b.name).executeTakeFirst();
    if (dup) throw conflict(`มีโต๊ะชื่อ ${b.name} แล้ว`);
    const id = uuid();
    await ctx.db.insertInto('tables').values({ id, branch_id: branchId, zone_id: b.zoneId ?? null, name: b.name, seats: b.seats, sort: b.sort }).execute();
    return { id };
  });
  app.put('/api/tables/:id', auth('settings.manage'), async (req) => {
    const b = tableSchema.parse(req.body);
    await ctx.db.updateTable('tables').set({ zone_id: b.zoneId ?? null, name: b.name, seats: b.seats, sort: b.sort }).where('id', '=', (req.params as { id: string }).id).execute();
    return { ok: true };
  });
  app.delete('/api/tables/:id', auth('settings.manage'), async (req) => {
    const { id } = req.params as { id: string };
    const open = await ctx.db.selectFrom('orders').select('id').where('table_id', '=', id).where('status', '=', 'open').executeTakeFirst();
    if (open) throw conflict('โต๊ะนี้ยังมีบิลเปิดอยู่');
    await ctx.db.deleteFrom('tables').where('id', '=', id).execute();
    return { ok: true };
  });

  /** Floor plan with live status for each table. */
  app.get('/api/floor', auth('tables.manage'), async (req) => {
    const branchId = branchOf(ctx, req);
    const [zones, tables, orders] = await Promise.all([
      ctx.db.selectFrom('zones').selectAll().where('branch_id', '=', branchId).orderBy('sort').execute(),
      ctx.db.selectFrom('tables').selectAll().where('branch_id', '=', branchId).orderBy('sort').execute(),
      ctx.db.selectFrom('orders').selectAll().where('branch_id', '=', branchId).where('status', '=', 'open').execute(),
    ]);
    const totals = orders.length
      ? await ctx.db
          .selectFrom('order_items')
          .select(['order_id', (eb) => eb.fn.sum<number>(eb('qty', '*', eb.ref('unit_price'))).as('total'), (eb) => eb.fn.countAll<number>().as('n')])
          .where('order_id', 'in', orders.map((o) => o.id))
          .where('status', '!=', 'cancelled')
          .groupBy('order_id')
          .execute()
      : [];
    const ready = orders.length
      ? await ctx.db.selectFrom('order_items').select(['order_id', 'status']).where('order_id', 'in', orders.map((o) => o.id)).where('status', 'in', ['sent', 'preparing', 'ready']).execute()
      : [];
    const tm = new Map(totals.map((t) => [t.order_id, t]));
    const orderView = (o: (typeof orders)[number]) => ({
      id: o.id,
      name: o.name,
      guests: o.guests,
      openedAt: o.opened_at,
      billRequested: o.bill_requested === 1,
      total: Math.round(num(tm.get(o.id)?.total)),
      items: num(tm.get(o.id)?.n),
      readyCount: ready.filter((r) => r.order_id === o.id && r.status === 'ready').length,
      waitingCount: ready.filter((r) => r.order_id === o.id && r.status !== 'ready').length,
    });
    return {
      zones,
      tables: tables.map((t) => {
        const o = orders.find((x) => x.table_id === t.id);
        return { id: t.id, name: t.name, zoneId: t.zone_id, seats: t.seats, order: o ? orderView(o) : null };
      }),
      takeaway: orders.filter((o) => !o.table_id).map(orderView),
    };
  });

  const loadOrder = async (id: string) => {
    const o = await ctx.db.selectFrom('orders').selectAll().where('id', '=', id).executeTakeFirst();
    if (!o) throw notFound('ออเดอร์');
    const items = await ctx.db.selectFrom('order_items').leftJoin('users', 'users.id', 'order_items.created_by').select(['order_items.id', 'order_items.round_no', 'order_items.product_id', 'order_items.variant_id', 'order_items.name', 'order_items.qty', 'order_items.unit_price', 'order_items.modifiers', 'order_items.note', 'order_items.status', 'order_items.station', 'order_items.source', 'order_items.created_at', 'order_items.sent_at', 'order_items.ready_at', 'users.name as by']).where('order_id', '=', id).orderBy('round_no').orderBy('order_items.created_at').execute();
    const table = o.table_id ? await ctx.db.selectFrom('tables').select('name').where('id', '=', o.table_id).executeTakeFirst() : undefined;
    const opener = await ctx.db.selectFrom('users').select('name').where('id', '=', o.opened_by).executeTakeFirst();
    const live = items.filter((i) => i.status !== 'cancelled');
    return {
      id: o.id,
      tableId: o.table_id,
      tableName: table?.name ?? null,
      name: o.name || table?.name || 'กลับบ้าน',
      status: o.status,
      guests: o.guests,
      openedAt: o.opened_at,
      openedBy: opener?.name ?? '',
      billRequested: o.bill_requested === 1,
      note: o.note,
      total: live.reduce((a, i) => a + Math.round(i.qty * i.unit_price), 0),
      items: items.map((i) => ({ ...i, modifiers: parseJson<{ id: string; name: string; priceDelta: number }[]>(i.modifiers, []), total: Math.round(i.qty * i.unit_price) })),
    };
  };

  app.get('/api/orders', auth('tables.manage'), async (req) => {
    const q = z.object({ status: z.enum(['open', 'paid', 'cancelled', 'all']).default('open'), date: z.string().optional() }).parse(req.query);
    let base = ctx.db.selectFrom('orders').leftJoin('tables', 'tables.id', 'orders.table_id').leftJoin('users', 'users.id', 'orders.opened_by').select(['orders.id', 'orders.name', 'orders.status', 'orders.guests', 'orders.opened_at', 'orders.closed_at', 'orders.bill_requested', 'orders.sale_id', 'tables.name as table_name', 'users.name as opened_by']).where('orders.branch_id', '=', branchOf(ctx, req));
    if (q.status !== 'all') base = base.where('orders.status', '=', q.status);
    if (q.date) base = base.where('orders.opened_at', '>=', new Date(q.date + 'T00:00:00').toISOString()).where('orders.opened_at', '<=', new Date(q.date + 'T23:59:59.999').toISOString());
    const rows = await base.orderBy('orders.opened_at', 'desc').limit(300).execute();
    const ids = rows.map((r) => r.id);
    const items = ids.length ? await ctx.db.selectFrom('order_items').select(['order_id', 'qty', 'unit_price', 'status', 'source', 'round_no']).where('order_id', 'in', ids).execute() : [];
    return rows.map((r) => {
      const its = items.filter((i) => i.order_id === r.id && i.status !== 'cancelled');
      return {
        ...r,
        name: r.name || r.table_name || 'กลับบ้าน',
        total: its.reduce((a, i) => a + Math.round(i.qty * i.unit_price), 0),
        itemCount: its.reduce((a, i) => a + i.qty, 0),
        rounds: new Set(its.map((i) => i.round_no)).size,
        fromApp: its.some((i) => i.source === 'app'),
        pending: its.filter((i) => ['sent', 'preparing'].includes(i.status)).length,
        ready: its.filter((i) => i.status === 'ready').length,
      };
    });
  });

  app.get('/api/orders/:id', auth('tables.manage'), async (req) => loadOrder((req.params as { id: string }).id));

  app.post('/api/orders', auth('tables.manage'), async (req) => {
    const b = z.object({ tableId: z.string().nullable().optional(), name: z.string().max(60).default(''), guests: z.number().int().min(0).max(200).default(0) }).parse(req.body);
    const branchId = branchOf(ctx, req);
    const id = await ctx.db.transaction().execute(async (tx) => {
      if (b.tableId) {
        const t = await tx.selectFrom('tables').select('id').where('id', '=', b.tableId).where('branch_id', '=', branchId).executeTakeFirst();
        if (!t) throw notFound('โต๊ะ');
        const open = await tx.selectFrom('orders').select('id').where('table_id', '=', b.tableId).where('status', '=', 'open').executeTakeFirst();
        if (open) return open.id; // already open: just return it
      }
      const id = uuid();
      let name = b.name;
      if (!b.tableId && !name) name = `กลับบ้าน #${await nextSeq(tx, `takeaway:${branchId}:${nowIso().slice(0, 10)}`)}`;
      await tx.insertInto('orders').values({ id, branch_id: branchId, table_id: b.tableId ?? null, name, status: 'open', guests: b.guests, opened_by: currentUser(req).id, opened_at: nowIso(), closed_at: null, sale_id: null, bill_requested: 0, note: '' }).execute();
      return id;
    });
    ctx.emit({ type: 'orders.changed', tableId: b.tableId ?? null, orderId: id });
    return loadOrder(id);
  });

  /** Add a round of items and send it to the kitchen. Idempotent by requestId (order app retries). */
  app.post('/api/orders/:id/items', auth('tables.manage'), async (req) => {
    const { id } = req.params as { id: string };
    const b = orderItemsSchema.parse(req.body);
    const done = await ctx.db.selectFrom('idempotency').select('id').where('id', '=', `order-items:${b.requestId}`).executeTakeFirst();
    if (done) return loadOrder(id);
    const user = currentUser(req);
    const branchId = branchOf(ctx, req);
    const catalog = await cachedCatalog(ctx, branchId);
    const products = new Map(catalog.products.map((p) => [p.id, p]));
    const cats = await ctx.db.selectFrom('categories').select(['id', 'station']).execute();
    const stationOf = new Map(cats.map((c) => [c.id, c.station ?? '']));
    let printed = 0;
    await ctx.db.transaction().execute(async (tx) => {
      const o = await tx.selectFrom('orders').selectAll().where('id', '=', id).executeTakeFirst();
      if (!o || o.status !== 'open') throw badRequest('บิลนี้ปิดไปแล้ว');
      const last = await tx.selectFrom('order_items').select((eb) => eb.fn.max('round_no').as('r')).where('order_id', '=', id).executeTakeFirst();
      const round = num(last?.r) + 1;
      const now = nowIso();
      const ticketItems: { categoryId: string | null; qty: number; name: string; modifiers: string[]; note: string }[] = [];
      for (const it of b.items) {
        const p = products.get(it.productId);
        if (!p) throw badRequest('มีสินค้าที่ปิดการขายแล้ว กรุณารีเฟรชเมนู');
        if (p.variants.length > 0 && !it.variantId) throw badRequest(`กรุณาเลือกตัวเลือกของ ${p.name}`);
        const mods = validateModifiers(p, catalog.modifierGroups, it.modifiers);
        if (!mods.ok) throw badRequest(mods.message);
        const v = p.variants.find((x) => x.id === it.variantId);
        const name = v ? `${p.name} (${v.name})` : p.name;
        const unitPrice = resolveBasePrice(p, { variantId: it.variantId }) + mods.priceDelta;
        await tx.insertInto('order_items').values({ id: uuid(), order_id: id, round_no: round, product_id: p.id, variant_id: it.variantId ?? null, name, qty: it.qty, unit_price: unitPrice, modifiers: JSON.stringify(mods.names), note: it.note, status: 'sent', station: (p.categoryId && stationOf.get(p.categoryId)) || 'kitchen', source: b.source, created_by: user.id, created_at: now, sent_at: now, ready_at: null }).execute();
        ticketItems.push({ categoryId: p.categoryId, qty: it.qty, name, modifiers: mods.names.map((m) => m.name), note: it.note });
      }
      const table = o.table_id ? await tx.selectFrom('tables').select('name').where('id', '=', o.table_id).executeTakeFirst() : undefined;
      const ticketNo = String(await nextSeq(tx, `kitchen:${branchId}`));
      printed = await printer.printKitchen(tx, branchId, { title: table ? `โต๊ะ ${table.name}` : o.name || 'กลับบ้าน', ticketNo: `K-${ticketNo}`, by: user.name, createdAt: now }, ticketItems);
      await tx.insertInto('idempotency').values({ id: `order-items:${b.requestId}`, response: '{}', created_at: now }).execute();
    });
    ctx.emit({ type: 'orders.changed', tableId: null, orderId: id });
    ctx.emit({ type: 'kitchen.changed', orderId: id });
    return { ...(await loadOrder(id)), printedTo: printed };
  });

  app.post('/api/orders/:id/items/:itemId/cancel', auth('tables.manage'), async (req) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    const b = z.object({ reason: z.string().trim().min(1).max(200), managerPin: z.string().optional() }).parse(req.body);
    const user = currentUser(req);
    const item = await ctx.db.selectFrom('order_items').selectAll().where('id', '=', itemId).where('order_id', '=', id).executeTakeFirst();
    if (!item) throw notFound('รายการ');
    // Items already being cooked need a manager.
    const approver = ['preparing', 'ready', 'served'].includes(item.status) ? await authorizeWithPin(ctx, user, 'pos.void', b.managerPin) : user;
    await ctx.db.updateTable('order_items').set({ status: 'cancelled' }).where('id', '=', itemId).execute();
    await audit(ctx, ctx.db, req, 'order.item_cancel', 'order', id, { item: item.name, qty: item.qty, reason: b.reason, approvedBy: approver.name });
    ctx.emit({ type: 'orders.changed', tableId: null, orderId: id });
    ctx.emit({ type: 'kitchen.changed', orderId: id });
    return loadOrder(id);
  });

  app.post('/api/orders/:id/move', auth('tables.manage'), async (req) => {
    const { id } = req.params as { id: string };
    const { tableId } = z.object({ tableId: z.string() }).parse(req.body);
    await ctx.db.transaction().execute(async (tx) => {
      const busy = await tx.selectFrom('orders').select('id').where('table_id', '=', tableId).where('status', '=', 'open').executeTakeFirst();
      if (busy) throw conflict('โต๊ะปลายทางมีบิลเปิดอยู่ ใช้ “รวมโต๊ะ” แทน');
      await tx.updateTable('orders').set({ table_id: tableId, name: '' }).where('id', '=', id).where('status', '=', 'open').execute();
    });
    await audit(ctx, ctx.db, req, 'order.move', 'order', id, { tableId });
    ctx.emit({ type: 'orders.changed', tableId, orderId: id });
    return loadOrder(id);
  });

  /** Merge `fromId` into this order (items move, source order is cancelled). */
  app.post('/api/orders/:id/merge', auth('tables.manage'), async (req) => {
    const { id } = req.params as { id: string };
    const { fromId } = z.object({ fromId: z.string() }).parse(req.body);
    if (fromId === id) throw badRequest('เลือกบิลอื่นเพื่อรวม');
    await ctx.db.transaction().execute(async (tx) => mergeInto(tx, id, fromId));
    await audit(ctx, ctx.db, req, 'order.merge', 'order', id, { fromId });
    ctx.emit({ type: 'orders.changed', tableId: null, orderId: id });
    return loadOrder(id);
  });

  /** Split: move selected items to a new order (e.g. separate checks). */
  app.post('/api/orders/:id/split', auth('tables.manage'), async (req) => {
    const { id } = req.params as { id: string };
    const { itemIds, name } = z.object({ itemIds: z.array(z.string()).min(1), name: z.string().max(60).default('') }).parse(req.body);
    const newId = uuid();
    await ctx.db.transaction().execute(async (tx) => {
      const o = await tx.selectFrom('orders').selectAll().where('id', '=', id).executeTakeFirst();
      if (!o || o.status !== 'open') throw badRequest('บิลนี้ปิดแล้ว');
      const table = o.table_id ? await tx.selectFrom('tables').select('name').where('id', '=', o.table_id).executeTakeFirst() : undefined;
      await tx.insertInto('orders').values({ id: newId, branch_id: o.branch_id, table_id: null, name: name || `${table?.name ?? o.name} (แยก)`, status: 'open', guests: 0, opened_by: currentUser(req).id, opened_at: nowIso(), closed_at: null, sale_id: null, bill_requested: 0, note: '' }).execute();
      await tx.updateTable('order_items').set({ order_id: newId }).where('order_id', '=', id).where('id', 'in', itemIds).execute();
    });
    ctx.emit({ type: 'orders.changed', tableId: null, orderId: id });
    return loadOrder(newId);
  });

  app.post('/api/orders/:id/request-bill', auth('tables.manage'), async (req) => {
    const { id } = req.params as { id: string };
    const { value } = z.object({ value: z.boolean().default(true) }).parse(req.body ?? {});
    await ctx.db.updateTable('orders').set({ bill_requested: value ? 1 : 0 }).where('id', '=', id).execute();
    const o = await loadOrder(id);
    if (value) await notify(ctx, branchOf(ctx, req), null, 'bill', `เช็คบิล ${o.name}`, `ยอด ฿${(o.total / 100).toFixed(2)}`, id);
    ctx.emit({ type: 'orders.changed', tableId: o.tableId, orderId: id });
    return o;
  });

  app.post('/api/orders/:id/cancel', auth('tables.manage'), async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ reason: z.string().trim().min(1).max(200), managerPin: z.string().optional() }).parse(req.body);
    const o = await loadOrder(id);
    const approver = o.items.some((i) => i.status !== 'cancelled') ? await authorizeWithPin(ctx, currentUser(req), 'pos.void', b.managerPin) : currentUser(req);
    await ctx.db.transaction().execute(async (tx) => {
      await tx.updateTable('order_items').set({ status: 'cancelled' }).where('order_id', '=', id).execute();
      await tx.updateTable('orders').set({ status: 'cancelled', closed_at: nowIso() }).where('id', '=', id).execute();
      await audit(ctx, tx, req, 'order.cancel', 'order', id, { name: o.name, total: o.total, reason: b.reason, approvedBy: approver.name });
    });
    ctx.emit({ type: 'orders.changed', tableId: o.tableId, orderId: id });
    return { ok: true };
  });

  app.post('/api/orders/:id/reprint', auth('tables.manage'), async (req) => {
    const { id } = req.params as { id: string };
    const { round } = z.object({ round: z.number().int().min(1) }).parse(req.body);
    const o = await loadOrder(id);
    const items = o.items.filter((i) => i.round_no === round && i.status !== 'cancelled');
    if (!items.length) throw badRequest('ไม่มีรายการในรอบนี้');
    const products = await ctx.db.selectFrom('products').select(['id', 'category_id']).where('id', 'in', items.map((i) => i.product_id)).execute();
    const catOf = new Map(products.map((p) => [p.id, p.category_id]));
    const n = await printer.printKitchen(ctx.db, branchOf(ctx, req), { title: o.tableName ? `โต๊ะ ${o.tableName}` : o.name, ticketNo: `R${round}`, by: currentUser(req).name, createdAt: nowIso() }, items.map((i) => ({ categoryId: catOf.get(i.product_id) ?? null, qty: i.qty, name: i.name, modifiers: i.modifiers.map((m) => m.name), note: i.note })), true);
    if (n === 0) throw badRequest('ยังไม่ได้ตั้งค่าเครื่องพิมพ์ครัวแบบเครือข่าย');
    return { ok: true, printers: n };
  });

  /* ---------- Kitchen display ---------- */
  app.get('/api/kitchen', auth('kitchen.view'), async (req) => {
    const { station } = z.object({ station: z.string().optional() }).parse(req.query);
    let q = ctx.db
      .selectFrom('order_items')
      .innerJoin('orders', 'orders.id', 'order_items.order_id')
      .leftJoin('tables', 'tables.id', 'orders.table_id')
      .leftJoin('users', 'users.id', 'order_items.created_by')
      .select(['order_items.id', 'order_items.order_id', 'order_items.round_no', 'order_items.name', 'order_items.qty', 'order_items.modifiers', 'order_items.note', 'order_items.status', 'order_items.station', 'order_items.sent_at', 'order_items.ready_at', 'orders.name as order_name', 'tables.name as table_name', 'users.name as by'])
      .where('orders.branch_id', '=', branchOf(ctx, req))
      .where('order_items.status', 'in', ['sent', 'preparing', 'ready'])
      .where('orders.status', '=', 'open');
    if (station) q = q.where('order_items.station', '=', station);
    const rows = await q.orderBy('order_items.sent_at').execute();
    return rows.map((r) => ({ ...r, modifiers: parseJson<{ name: string }[]>(r.modifiers, []).map((m) => m.name), title: r.table_name ? `โต๊ะ ${r.table_name}` : r.order_name }));
  });

  app.post('/api/kitchen/items/status', auth('kitchen.view'), async (req) => {
    const b = z.object({ ids: z.array(z.string()).min(1), status: z.enum(ITEM_STATUSES) }).parse(req.body);
    const now = nowIso();
    const items = await ctx.db.selectFrom('order_items').innerJoin('orders', 'orders.id', 'order_items.order_id').select(['order_items.id', 'order_items.order_id', 'order_items.name', 'order_items.created_by', 'orders.branch_id', 'orders.table_id', 'orders.name as order_name']).where('order_items.id', 'in', b.ids).execute();
    await ctx.db.updateTable('order_items').set({ status: b.status, ...(b.status === 'ready' ? { ready_at: now } : {}) }).where('id', 'in', b.ids).execute();
    if (b.status === 'ready') {
      const byOrder = new Map<string, typeof items>();
      for (const i of items) byOrder.set(i.order_id, [...(byOrder.get(i.order_id) ?? []), i]);
      for (const [orderId, list] of byOrder) {
        const first = list[0]!;
        const t = first.table_id ? await ctx.db.selectFrom('tables').select('name').where('id', '=', first.table_id).executeTakeFirst() : undefined;
        await notify(ctx, first.branch_id, first.created_by, 'ready', `${t ? 'โต๊ะ ' + t.name : first.order_name} อาหารพร้อมเสิร์ฟ`, list.map((x) => x.name).join(', '), orderId);
      }
    }
    for (const oid of new Set(items.map((i) => i.order_id))) {
      ctx.emit({ type: 'kitchen.changed', orderId: oid });
      ctx.emit({ type: 'orders.changed', tableId: null, orderId: oid });
    }
    return { ok: true };
  });

  /* ---------- Notifications (order app) ---------- */
  app.get('/api/notifications', auth(), async (req) => {
    const user = currentUser(req);
    return ctx.db.selectFrom('notifications').selectAll().where('branch_id', '=', branchOf(ctx, req)).where((eb) => eb.or([eb('user_id', 'is', null), eb('user_id', '=', user.id)])).orderBy('created_at', 'desc').limit(50).execute();
  });
  app.post('/api/notifications/read', auth(), async (req) => {
    const { ids } = z.object({ ids: z.array(z.string()) }).parse(req.body);
    if (ids.length) await ctx.db.updateTable('notifications').set({ read_at: nowIso() }).where('id', 'in', ids).execute();
    return { ok: true };
  });

  /* ---------- Printer queue status for the order app (2f) ---------- */
  app.get('/api/print-queue', auth(), async (req) => {
    const printers = await ctx.db.selectFrom('printers').select(['id', 'name', 'role', 'online', 'last_error', 'kind']).where('branch_id', '=', branchOf(ctx, req)).where('active', '=', 1).execute();
    const jobs = await ctx.db.selectFrom('print_jobs').select(['id', 'printer_id', 'title', 'created_at', 'attempts', 'error']).where('status', '=', 'queued').orderBy('created_at').execute();
    return printers.map((p) => ({ ...p, online: p.online === 1 || p.kind !== 'network', queued: jobs.filter((j) => j.printer_id === p.id) }));
  });
}

async function mergeInto(tx: Tx, intoId: string, fromId: string) {
  const [a, b] = await Promise.all([
    tx.selectFrom('orders').selectAll().where('id', '=', intoId).executeTakeFirst(),
    tx.selectFrom('orders').selectAll().where('id', '=', fromId).executeTakeFirst(),
  ]);
  if (!a || !b || a.status !== 'open' || b.status !== 'open') throw badRequest('บิลที่จะรวมต้องยังเปิดอยู่ทั้งคู่');
  const last = await tx.selectFrom('order_items').select((eb) => eb.fn.max('round_no').as('r')).where('order_id', '=', intoId).executeTakeFirst();
  const offset = num(last?.r);
  const items = await tx.selectFrom('order_items').select(['id', 'round_no']).where('order_id', '=', fromId).execute();
  for (const i of items) await tx.updateTable('order_items').set({ order_id: intoId, round_no: i.round_no + offset }).where('id', '=', i.id).execute();
  await tx.updateTable('orders').set({ status: 'cancelled', closed_at: nowIso(), note: `รวมเข้ากับบิล ${intoId}`, guests: 0 }).where('id', '=', fromId).execute();
  await tx.updateTable('orders').set({ guests: a.guests + b.guests }).where('id', '=', intoId).execute();
}

export async function notify(ctx: AppContext, branchId: string, userId: string | null, type: string, title: string, body: string, refId: string) {
  const id = uuid();
  await ctx.db.insertInto('notifications').values({ id, branch_id: branchId, user_id: userId, type, title, body, ref_id: refId, created_at: nowIso(), read_at: null }).execute();
  ctx.emit({ type: 'notification', id, title, body, userId });
}
