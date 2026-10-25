import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import {
  bahtToSatang,
  bulkProductSchema,
  categorySchema,
  customFieldSchema,
  formatAmount,
  generateInternalEan13,
  modifierGroupSchema,
  parseCsv,
  priceTierSchema,
  productSchema,
  toCsv,
  type ProductInput,
} from '@flexpos/shared';
import { ilike } from '@flexpos/db';
import type { AppContext } from '../context.js';
import { audit, branchOf, nextSeq, requireAuth } from '../auth.js';
import { AppError, badRequest, conflict, notFound } from '../errors.js';
import { bool, nowIso, parseJson, uuid } from '../util.js';
import { buildCatalog, bumpCatalog, getProductDetail, saveProduct } from '../services/catalog.js';

const IMPORT_COLUMNS = ['sku', 'name', 'category', 'price', 'cost', 'unit', 'barcode', 'stock', 'taxable', 'track_stock', 'low_stock', 'active'] as const;
const IMPORT_HEADERS_TH: Record<(typeof IMPORT_COLUMNS)[number], string> = {
  sku: 'รหัสสินค้า (SKU)',
  name: 'ชื่อสินค้า*',
  category: 'หมวดหมู่',
  price: 'ราคาขาย*',
  cost: 'ต้นทุน',
  unit: 'หน่วย',
  barcode: 'บาร์โค้ด (คั่นด้วย |)',
  stock: 'สต็อกเริ่มต้น',
  taxable: 'มี VAT (Y/N)',
  track_stock: 'ตัดสต็อก (Y/N)',
  low_stock: 'แจ้งเตือนเมื่อต่ำกว่า',
  active: 'เปิดขาย (Y/N)',
};

interface ImportRow {
  row: number;
  data: Record<string, string>;
  errors: string[];
  action: 'create' | 'update';
}

const yes = (v: string | undefined, dflt: boolean) => {
  if (v === undefined || v.trim() === '') return dflt;
  return /^(y|yes|1|true|ใช่|มี)$/i.test(v.trim());
};

async function readTable(buf: Buffer, filename: string): Promise<string[][]> {
  if (/\.xlsx$/i.test(filename)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (r) => {
      const vals = (r.values as unknown[]).slice(1).map((v) => {
        if (v == null) return '';
        if (typeof v === 'object' && v && 'text' in v) return String((v as { text: unknown }).text);
        if (typeof v === 'object' && v && 'result' in v) return String((v as { result: unknown }).result);
        return String(v);
      });
      rows.push(vals);
    });
    return rows;
  }
  return parseCsv(buf.toString('utf8'));
}

function mapHeaders(header: string[]): Record<number, string> {
  const map: Record<number, string> = {};
  header.forEach((h, i) => {
    const t = h.trim().toLowerCase();
    for (const c of IMPORT_COLUMNS) {
      if (t === c || t === IMPORT_HEADERS_TH[c].toLowerCase() || t === IMPORT_HEADERS_TH[c].replace('*', '').toLowerCase()) map[i] = c;
    }
  });
  return map;
}

export function catalogRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = (...p: Parameters<typeof requireAuth>[1][]) => ({ preHandler: requireAuth(ctx, ...p) });

  app.get('/api/catalog', auth(), async (req) => buildCatalog(ctx, branchOf(ctx, req)));

  /* ---------- Categories ---------- */
  app.get('/api/categories', auth(), async () => {
    const rows = await ctx.db.selectFrom('categories').selectAll().orderBy('sort').execute();
    const counts = await ctx.db
      .selectFrom('products')
      .select(['category_id', (eb) => eb.fn.countAll<number>().as('n')])
      .where('deleted_at', 'is', null)
      .groupBy('category_id')
      .execute();
    const cm = new Map(counts.map((c) => [c.category_id, Number(c.n)]));
    return rows.map((c) => ({ id: c.id, name: c.name, parentId: c.parent_id, color: c.color, sort: c.sort, station: c.station, active: c.active === 1, productCount: cm.get(c.id) ?? 0 }));
  });

  app.post('/api/categories', auth('products.manage'), async (req) => {
    const b = categorySchema.parse(req.body);
    const id = uuid();
    await ctx.db.insertInto('categories').values({ id, parent_id: b.parentId ?? null, name: b.name, color: b.color, sort: b.sort, station: b.station ?? null, active: bool(b.active) }).execute();
    bumpCatalog(ctx);
    return { id };
  });

  app.put('/api/categories/:id', auth('products.manage'), async (req) => {
    const { id } = req.params as { id: string };
    const b = categorySchema.parse(req.body);
    if (b.parentId === id) throw badRequest('หมวดหมู่เป็นหมวดแม่ของตัวเองไม่ได้');
    await ctx.db.updateTable('categories').set({ parent_id: b.parentId ?? null, name: b.name, color: b.color, sort: b.sort, station: b.station ?? null, active: bool(b.active) }).where('id', '=', id).execute();
    bumpCatalog(ctx);
    return { id };
  });

  /**
   * Delete a category. Its products move to `moveTo` (another category id) or become uncategorised ('none');
   * sub-categories move up to the parent. Products are never deleted.
   */
  app.delete('/api/categories/:id', auth('products.manage'), async (req) => {
    const { id } = req.params as { id: string };
    const { moveTo } = z.object({ moveTo: z.string().optional() }).parse(req.query);
    const cat = await ctx.db.selectFrom('categories').selectAll().where('id', '=', id).executeTakeFirst();
    if (!cat) throw notFound('หมวดหมู่');
    const count = Number((await ctx.db.selectFrom('products').select((eb) => eb.fn.countAll<number>().as('n')).where('category_id', '=', id).where('deleted_at', 'is', null).executeTakeFirst())?.n ?? 0);
    if (count > 0 && !moveTo) throw new AppError(409, 'has_products', `หมวดนี้มีสินค้า ${count} รายการ เลือกว่าจะย้ายสินค้าไปหมวดไหน`, { count });
    if (moveTo && moveTo !== 'none') {
      if (moveTo === id) throw badRequest('เลือกหมวดอื่นที่ไม่ใช่หมวดที่จะลบ');
      const target = await ctx.db.selectFrom('categories').select('id').where('id', '=', moveTo).executeTakeFirst();
      if (!target) throw badRequest('ไม่พบหมวดปลายทาง');
    }
    await ctx.db.transaction().execute(async (tx) => {
      await tx.updateTable('products').set({ category_id: moveTo && moveTo !== 'none' ? moveTo : null, updated_at: nowIso() }).where('category_id', '=', id).execute();
      await tx.updateTable('categories').set({ parent_id: cat.parent_id }).where('parent_id', '=', id).execute();
      await tx.deleteFrom('categories').where('id', '=', id).execute();
      await audit(ctx, tx, req, 'category.delete', 'category', id, { name: cat.name, movedProducts: count, moveTo: moveTo ?? null });
    });
    bumpCatalog(ctx);
    return { ok: true, movedProducts: count };
  });

  app.post('/api/categories/reorder', auth('products.manage'), async (req) => {
    const { ids } = z.object({ ids: z.array(z.string()) }).parse(req.body);
    await ctx.db.transaction().execute(async (tx) => {
      for (const [i, id] of ids.entries()) await tx.updateTable('categories').set({ sort: i }).where('id', '=', id).execute();
    });
    bumpCatalog(ctx);
    return { ok: true };
  });

  /* ---------- Products ---------- */
  app.get('/api/products', auth('products.view'), async (req) => {
    const q = z
      .object({
        q: z.string().optional(),
        categoryId: z.string().optional(),
        stock: z.enum(['all', 'low', 'out']).default('all'),
        status: z.enum(['all', 'active', 'inactive']).default('all'),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(500).default(50),
      })
      .parse(req.query);
    const branchId = branchOf(ctx, req);
    const like = ilike(ctx.dialect);
    let base = ctx.db
      .selectFrom('products')
      .leftJoin('categories', 'categories.id', 'products.category_id')
      .leftJoin(
        (eb) =>
          eb
            .selectFrom('stock_levels')
            .select(['product_id', (e) => e.fn.sum<number>('qty').as('qty')])
            .where('branch_id', '=', branchId)
            .groupBy('product_id')
            .as('sl'),
        (j) => j.onRef('sl.product_id', '=', 'products.id'),
      )
      .where('products.deleted_at', 'is', null);
    if (q.q) {
      const term = `%${q.q.trim()}%`;
      const codes = ctx.db.selectFrom('product_barcodes').select('product_id').where('code', '=', q.q.trim());
      base = base.where((eb) => eb.or([eb('products.name', like, term), eb('products.sku', like, term), eb('products.id', 'in', codes)]));
    }
    if (q.categoryId) base = base.where('products.category_id', '=', q.categoryId);
    if (q.status !== 'all') base = base.where('products.active', '=', q.status === 'active' ? 1 : 0);
    if (q.stock === 'low') base = base.where('products.track_stock', '=', 1).where((eb) => eb(eb.fn.coalesce('sl.qty', eb.lit(0)), '<=', eb.ref('products.low_stock'))).where((eb) => eb(eb.fn.coalesce('sl.qty', eb.lit(0)), '>', 0));
    if (q.stock === 'out') base = base.where('products.track_stock', '=', 1).where((eb) => eb(eb.fn.coalesce('sl.qty', eb.lit(0)), '<=', 0));
    const totalRow = await base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const rows = await base
      .select([
        'products.id',
        'products.sku',
        'products.name',
        'products.price',
        'products.cost',
        'products.unit',
        'products.kind',
        'products.color',
        'products.image',
        'products.active',
        'products.show_in_pos',
        'products.track_stock',
        'products.low_stock',
        'products.category_id',
        'products.sort',
        'categories.name as category_name',
        'sl.qty as stock',
      ])
      .orderBy('products.sort')
      .orderBy('products.name')
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .execute();
    const variantCounts = rows.length
      ? await ctx.db.selectFrom('product_variants').select(['product_id', (eb) => eb.fn.countAll<number>().as('n')]).where('product_id', 'in', rows.map((r) => r.id)).where('active', '=', 1).groupBy('product_id').execute()
      : [];
    const vc = new Map(variantCounts.map((v) => [v.product_id, Number(v.n)]));
    return {
      total: Number(totalRow?.n ?? 0),
      items: rows.map((r) => ({
        id: r.id,
        sku: r.sku,
        name: r.name,
        price: r.price,
        cost: r.cost,
        unit: r.unit,
        kind: r.kind,
        color: r.color,
        image: r.image ? true : false,
        imageUrl: r.image,
        active: r.active === 1,
        showInPos: r.show_in_pos === 1,
        trackStock: r.track_stock === 1,
        lowStock: r.low_stock,
        categoryId: r.category_id,
        categoryName: r.category_name,
        stock: r.track_stock === 1 ? Number(r.stock ?? 0) : null,
        variantCount: vc.get(r.id) ?? 0,
      })),
    };
  });

  app.get('/api/products/:id', auth('products.view'), async (req) => getProductDetail(ctx, (req.params as { id: string }).id));

  app.post('/api/products', auth('products.manage'), async (req) => {
    const input = productSchema.parse(req.body);
    const id = await ctx.db.transaction().execute(async (tx) => {
      const id = await saveProduct(ctx, tx, input, null);
      await audit(ctx, tx, req, 'product.create', 'product', id, { name: input.name, price: input.price });
      return id;
    });
    bumpCatalog(ctx);
    return { id };
  });

  app.put('/api/products/:id', auth('products.manage'), async (req) => {
    const { id } = req.params as { id: string };
    const input = productSchema.parse(req.body);
    const before = await ctx.db.selectFrom('products').select(['price', 'cost', 'name']).where('id', '=', id).executeTakeFirst();
    if (!before) throw notFound('สินค้า');
    await ctx.db.transaction().execute(async (tx) => {
      await saveProduct(ctx, tx, input, id);
      if (before.price !== input.price || before.cost !== input.cost)
        await audit(ctx, tx, req, 'product.price_change', 'product', id, { name: input.name, from: before.price, to: input.price, costFrom: before.cost, costTo: input.cost });
      else await audit(ctx, tx, req, 'product.update', 'product', id, { name: input.name });
    });
    bumpCatalog(ctx);
    return { id };
  });

  app.delete('/api/products/:id', auth('products.manage'), async (req) => {
    const { id } = req.params as { id: string };
    // Soft delete keeps sales history intact; barcodes are released for reuse.
    await ctx.db.transaction().execute(async (tx) => {
      const p = await tx.selectFrom('products').select('name').where('id', '=', id).executeTakeFirst();
      if (!p) throw notFound('สินค้า');
      await tx.updateTable('products').set({ deleted_at: nowIso(), active: 0, sku: '' }).where('id', '=', id).execute();
      await tx.deleteFrom('product_barcodes').where('product_id', '=', id).execute();
      await audit(ctx, tx, req, 'product.delete', 'product', id, { name: p.name });
    });
    bumpCatalog(ctx);
    return { ok: true };
  });

  app.patch('/api/products/:id/toggle', auth('products.manage'), async (req) => {
    const { id } = req.params as { id: string };
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    await ctx.db.updateTable('products').set({ active: bool(active), updated_at: nowIso() }).where('id', '=', id).execute();
    bumpCatalog(ctx);
    return { ok: true };
  });

  app.post('/api/products/reorder', auth('products.manage'), async (req) => {
    const { ids } = z.object({ ids: z.array(z.string()).max(5000) }).parse(req.body);
    await ctx.db.transaction().execute(async (tx) => {
      for (const [i, id] of ids.entries()) await tx.updateTable('products').set({ sort: i }).where('id', '=', id).execute();
    });
    bumpCatalog(ctx);
    return { ok: true };
  });

  app.post('/api/products/bulk', auth('products.manage'), async (req) => {
    const { ids, patch } = bulkProductSchema.parse(req.body);
    await ctx.db.transaction().execute(async (tx) => {
      const set: Record<string, unknown> = { updated_at: nowIso() };
      if (patch.categoryId !== undefined) set.category_id = patch.categoryId;
      if (patch.active !== undefined) set.active = bool(patch.active);
      if (patch.showInPos !== undefined) set.show_in_pos = bool(patch.showInPos);
      if (patch.taxable !== undefined) set.taxable = bool(patch.taxable);
      if (patch.trackStock !== undefined) set.track_stock = bool(patch.trackStock);
      if (patch.color !== undefined) set.color = patch.color;
      await tx.updateTable('products').set(set).where('id', 'in', ids).execute();
      if (patch.priceChange) {
        const rows = await tx.selectFrom('products').select(['id', 'price']).where('id', 'in', ids).execute();
        for (const r of rows) {
          const pc = patch.priceChange;
          const price = pc.mode === 'set' ? pc.value : pc.mode === 'percent' ? Math.round(r.price * (1 + pc.value / 100)) : r.price + pc.value;
          if (price < 0) throw badRequest('ราคาใหม่ติดลบ ตรวจสอบค่าที่กรอก');
          await tx.updateTable('products').set({ price }).where('id', '=', r.id).execute();
        }
      }
      await audit(ctx, tx, req, 'product.bulk_update', 'product', ids.join(',').slice(0, 60), { count: ids.length, patch });
    });
    bumpCatalog(ctx);
    return { ok: true, count: ids.length };
  });

  app.post('/api/products/generate-barcode', auth('products.manage'), async () => {
    for (let i = 0; i < 20; i++) {
      const seq = await nextSeq(ctx.db, 'barcode:internal');
      const code = generateInternalEan13(seq);
      const used = await ctx.db.selectFrom('product_barcodes').select('id').where('code', '=', code).executeTakeFirst();
      if (!used) return { code };
    }
    throw conflict('สร้างบาร์โค้ดไม่สำเร็จ กรุณาลองใหม่');
  });

  /* ---------- Import / export ---------- */
  app.get('/api/products/import-template', auth('products.view'), async (req, reply) => {
    const { format } = z.object({ format: z.enum(['csv', 'xlsx']).default('xlsx') }).parse(req.query);
    const header = IMPORT_COLUMNS.map((c) => IMPORT_HEADERS_TH[c]);
    const sample = [['C001', 'อเมริกาโน่เย็น', 'กาแฟ', '65', '18', 'แก้ว', '', '', 'Y', 'N', '', 'Y'], ['R001', 'น้ำดื่ม 600 มล.', 'เครื่องดื่ม', '7', '4.5', 'ขวด', '8850999320014', '120', 'Y', 'Y', '10', 'Y']];
    if (format === 'csv') {
      reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="flexpos-products-template.csv"');
      return toCsv([header, ...sample]);
    }
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('สินค้า');
    ws.addRow(header);
    sample.forEach((r) => ws.addRow(r));
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((c) => (c.width = 20));
    const help = wb.addWorksheet('คำอธิบาย');
    help.addRows([
      ['คอลัมน์', 'คำอธิบาย'],
      ['ชื่อสินค้า*', 'จำเป็นต้องกรอก'],
      ['ราคาขาย*', 'หน่วยเป็นบาท เช่น 65 หรือ 65.50'],
      ['รหัสสินค้า (SKU)', 'ถ้าตรงกับสินค้าเดิม ระบบจะอัปเดตสินค้านั้นแทนการสร้างใหม่'],
      ['หมวดหมู่', 'ถ้ายังไม่มี ระบบจะสร้างให้อัตโนมัติ'],
      ['บาร์โค้ด', 'ใส่ได้หลายรหัส คั่นด้วย |'],
      ['สต็อกเริ่มต้น', 'ใช้เฉพาะสินค้าใหม่ที่ตัดสต็อก'],
    ]);
    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition', 'attachment; filename="flexpos-products-template.xlsx"');
    return Buffer.from(await wb.xlsx.writeBuffer());
  });

  app.get('/api/products/export', auth('products.view'), async (req, reply) => {
    const { format } = z.object({ format: z.enum(['csv', 'xlsx']).default('xlsx') }).parse(req.query);
    const branchId = branchOf(ctx, req);
    const rows = await ctx.db
      .selectFrom('products')
      .leftJoin('categories', 'categories.id', 'products.category_id')
      .select(['products.id', 'products.sku', 'products.name', 'categories.name as cat', 'products.price', 'products.cost', 'products.unit', 'products.taxable', 'products.track_stock', 'products.low_stock', 'products.active'])
      .where('products.deleted_at', 'is', null)
      .orderBy('products.sort')
      .execute();
    const bcs = await ctx.db.selectFrom('product_barcodes').select(['product_id', 'code']).where('variant_id', 'is', null).where('unit_id', 'is', null).execute();
    const levels = await ctx.db.selectFrom('stock_levels').select(['product_id', 'qty']).where('branch_id', '=', branchId).where('variant_id', '=', '').execute();
    const lm = new Map(levels.map((l) => [l.product_id, l.qty]));
    const yn = (v: number) => (v ? 'Y' : 'N');
    const data = rows.map((r) => [
      r.sku, r.name, r.cat ?? '', formatAmount(r.price).replace(/,/g, ''), formatAmount(r.cost).replace(/,/g, ''), r.unit,
      bcs.filter((b) => b.product_id === r.id).map((b) => b.code).join('|'), r.track_stock ? String(lm.get(r.id) ?? 0) : '',
      yn(r.taxable), yn(r.track_stock), String(r.low_stock), yn(r.active),
    ]);
    const header = IMPORT_COLUMNS.map((c) => IMPORT_HEADERS_TH[c]);
    if (format === 'csv') {
      reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="flexpos-products.csv"');
      return toCsv([header, ...data]);
    }
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('สินค้า');
    ws.addRow(header);
    data.forEach((r) => ws.addRow(r));
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((c) => (c.width = 18));
    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition', 'attachment; filename="flexpos-products.xlsx"');
    return Buffer.from(await wb.xlsx.writeBuffer());
  });

  /** Parse and validate an import file; `commit=1` writes it. Nothing is saved when any row is invalid. */
  app.post('/api/products/import', auth('products.manage'), async (req) => {
    const { commit } = z.object({ commit: z.coerce.number().default(0) }).parse(req.query);
    const file = await req.file();
    if (!file) throw badRequest('กรุณาเลือกไฟล์ .xlsx หรือ .csv');
    const buf = await file.toBuffer();
    const table = await readTable(buf, file.filename);
    if (table.length < 2) throw badRequest('ไฟล์ไม่มีข้อมูล (ต้องมีหัวตารางและอย่างน้อย 1 แถว)');
    const map = mapHeaders(table[0]!);
    if (!Object.values(map).includes('name') || !Object.values(map).includes('price'))
      throw badRequest('ไม่พบคอลัมน์ “ชื่อสินค้า” หรือ “ราคาขาย” กรุณาใช้ไฟล์ template');
    const existing = await ctx.db.selectFrom('products').select(['id', 'sku']).where('deleted_at', 'is', null).where('sku', '!=', '').execute();
    const bySku = new Map(existing.map((e) => [e.sku.toLowerCase(), e.id]));
    const allCodes = new Map((await ctx.db.selectFrom('product_barcodes').select(['code', 'product_id']).execute()).map((b) => [b.code, b.product_id]));
    const seenSku = new Set<string>();
    const seenCode = new Set<string>();
    const rows: ImportRow[] = table.slice(1).map((cells, i) => {
      const data: Record<string, string> = {};
      cells.forEach((v, ci) => {
        const k = map[ci];
        if (k) data[k] = v.trim();
      });
      const errors: string[] = [];
      if (!data.name) errors.push('ไม่มีชื่อสินค้า');
      try {
        if (!data.price) errors.push('ไม่มีราคาขาย');
        else if (bahtToSatang(data.price) < 0) errors.push('ราคาติดลบ');
      } catch {
        errors.push(`ราคา “${data.price}” ไม่ใช่ตัวเลข`);
      }
      try {
        if (data.cost) bahtToSatang(data.cost);
      } catch {
        errors.push(`ต้นทุน “${data.cost}” ไม่ใช่ตัวเลข`);
      }
      if (data.stock && !Number.isFinite(Number(data.stock))) errors.push(`สต็อก “${data.stock}” ไม่ใช่ตัวเลข`);
      const sku = (data.sku ?? '').toLowerCase();
      if (sku) {
        if (seenSku.has(sku)) errors.push(`SKU ${data.sku} ซ้ำในไฟล์`);
        seenSku.add(sku);
      }
      const targetId = sku ? bySku.get(sku) : undefined;
      for (const code of (data.barcode ?? '').split('|').map((c) => c.trim()).filter(Boolean)) {
        if (seenCode.has(code)) errors.push(`บาร์โค้ด ${code} ซ้ำในไฟล์`);
        seenCode.add(code);
        const owner = allCodes.get(code);
        if (owner && owner !== targetId) errors.push(`บาร์โค้ด ${code} ถูกใช้กับสินค้าอื่นแล้ว`);
      }
      return { row: i + 2, data, errors, action: targetId ? 'update' : 'create' };
    });
    const invalid = rows.filter((r) => r.errors.length > 0);
    const summary = { total: rows.length, create: rows.filter((r) => r.action === 'create').length, update: rows.filter((r) => r.action === 'update').length, invalid: invalid.length };
    if (!commit || invalid.length > 0) return { summary, rows: rows.slice(0, 500), committed: false };

    const branchId = branchOf(ctx, req);
    const user = req.sessionUser!;
    await ctx.db.transaction().execute(async (tx) => {
      const cats = new Map((await tx.selectFrom('categories').select(['id', 'name']).execute()).map((c) => [c.name.trim().toLowerCase(), c.id]));
      const { applyMove } = await import('../services/stock.js');
      for (const r of rows) {
        const d = r.data;
        let categoryId: string | null = null;
        if (d.category) {
          const key = d.category.toLowerCase();
          categoryId = cats.get(key) ?? null;
          if (!categoryId) {
            categoryId = uuid();
            await tx.insertInto('categories').values({ id: categoryId, parent_id: null, name: d.category, color: '', sort: cats.size, station: null, active: 1 }).execute();
            cats.set(key, categoryId);
          }
        }
        const targetId = d.sku ? (bySku.get(d.sku.toLowerCase()) ?? null) : null;
        const base: ProductInput = targetId
          ? (productSchema.parse({ ...(await getProductDetail(ctx, targetId, tx)), barcodes: undefined }) as ProductInput)
          : productSchema.parse({ name: d.name, price: 0 });
        const input: ProductInput = {
          ...base,
          name: d.name!,
          sku: d.sku ?? base.sku,
          categoryId: d.category !== undefined ? categoryId : base.categoryId,
          price: bahtToSatang(d.price!),
          cost: d.cost ? bahtToSatang(d.cost) : base.cost,
          unit: d.unit || base.unit,
          taxable: yes(d.taxable, base.taxable),
          trackStock: yes(d.track_stock, targetId ? base.trackStock : !!d.stock),
          lowStock: d.low_stock ? Number(d.low_stock) : base.lowStock,
          active: yes(d.active, base.active),
          barcodes: d.barcode !== undefined ? d.barcode.split('|').map((c) => c.trim()).filter(Boolean) : targetId ? (await getProductDetail(ctx, targetId, tx)).barcodes : [],
        };
        const id = await saveProduct(ctx, tx, input, targetId);
        if (!targetId && d.stock && Number(d.stock) !== 0 && input.trackStock) {
          await applyMove(ctx, tx, { productId: id, branchId, qty: Number(d.stock), type: 'adjust', unitCost: input.cost, refType: 'import', refId: '', note: 'ยอดยกมาจากการนำเข้า', userId: user.id, allowNegative: true });
        }
      }
      await audit(ctx, tx, req, 'product.import', 'product', '', summary);
    });
    bumpCatalog(ctx);
    return { summary, rows: [], committed: true };
  });

  /* ---------- Modifiers ---------- */
  app.get('/api/modifier-groups', auth(), async () => {
    const groups = await ctx.db.selectFrom('modifier_groups').selectAll().orderBy('name').execute();
    const mods = await ctx.db.selectFrom('modifiers').selectAll().orderBy('sort').execute();
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      minSelect: g.min_select,
      maxSelect: g.max_select,
      modifiers: mods.filter((m) => m.group_id === g.id).map((m) => ({ id: m.id, name: m.name, priceDelta: m.price_delta, active: m.active === 1 })),
    }));
  });

  const saveGroup = async (id: string, b: z.infer<typeof modifierGroupSchema>, isNew: boolean) => {
    if (b.maxSelect > 0 && b.minSelect > b.maxSelect) throw badRequest('จำนวนขั้นต่ำต้องไม่มากกว่าจำนวนสูงสุด');
    await ctx.db.transaction().execute(async (tx) => {
      if (isNew) await tx.insertInto('modifier_groups').values({ id, name: b.name, min_select: b.minSelect, max_select: b.maxSelect }).execute();
      else await tx.updateTable('modifier_groups').set({ name: b.name, min_select: b.minSelect, max_select: b.maxSelect }).where('id', '=', id).execute();
      const old = await tx.selectFrom('modifiers').select('id').where('group_id', '=', id).execute();
      const keep = new Set(b.modifiers.map((m) => m.id).filter(Boolean));
      const drop = old.filter((o) => !keep.has(o.id)).map((o) => o.id);
      if (drop.length) await tx.deleteFrom('modifiers').where('id', 'in', drop).execute();
      for (const [i, m] of b.modifiers.entries()) {
        if (m.id && old.some((o) => o.id === m.id)) await tx.updateTable('modifiers').set({ name: m.name, price_delta: m.priceDelta, active: bool(m.active), sort: i }).where('id', '=', m.id).execute();
        else await tx.insertInto('modifiers').values({ id: uuid(), group_id: id, name: m.name, price_delta: m.priceDelta, active: bool(m.active), sort: i }).execute();
      }
    });
    bumpCatalog(ctx);
    return { id };
  };
  app.post('/api/modifier-groups', auth('products.manage'), async (req) => saveGroup(uuid(), modifierGroupSchema.parse(req.body), true));
  app.put('/api/modifier-groups/:id', auth('products.manage'), async (req) => saveGroup((req.params as { id: string }).id, modifierGroupSchema.parse(req.body), false));
  app.delete('/api/modifier-groups/:id', auth('products.manage'), async (req) => {
    const { id } = req.params as { id: string };
    await ctx.db.transaction().execute(async (tx) => {
      await tx.deleteFrom('product_modifier_groups').where('group_id', '=', id).execute();
      await tx.deleteFrom('modifiers').where('group_id', '=', id).execute();
      await tx.deleteFrom('modifier_groups').where('id', '=', id).execute();
    });
    bumpCatalog(ctx);
    return { ok: true };
  });

  /* ---------- Price tiers ---------- */
  app.get('/api/price-tiers', auth(), async () => ctx.db.selectFrom('price_tiers').selectAll().orderBy('name').execute());
  app.post('/api/price-tiers', auth('products.manage'), async (req) => {
    const b = priceTierSchema.parse(req.body);
    const id = uuid();
    await ctx.db.insertInto('price_tiers').values({ id, name: b.name }).execute();
    return { id };
  });
  app.put('/api/price-tiers/:id', auth('products.manage'), async (req) => {
    const b = priceTierSchema.parse(req.body);
    await ctx.db.updateTable('price_tiers').set({ name: b.name }).where('id', '=', (req.params as { id: string }).id).execute();
    return { ok: true };
  });
  app.delete('/api/price-tiers/:id', auth('products.manage'), async (req) => {
    const { id } = req.params as { id: string };
    await ctx.db.transaction().execute(async (tx) => {
      await tx.deleteFrom('product_prices').where('tier_id', '=', id).execute();
      await tx.updateTable('customer_groups').set({ price_tier_id: null }).where('price_tier_id', '=', id).execute();
      await tx.deleteFrom('price_tiers').where('id', '=', id).execute();
    });
    bumpCatalog(ctx);
    return { ok: true };
  });

  /* ---------- Custom fields ---------- */
  app.get('/api/custom-fields', auth(), async (req) => {
    const { entity } = z.object({ entity: z.enum(['product', 'customer', 'supplier']).optional() }).parse(req.query);
    let q = ctx.db.selectFrom('custom_fields').selectAll().orderBy('sort');
    if (entity) q = q.where('entity', '=', entity);
    return (await q.execute()).map((f) => ({
      id: f.id,
      entity: f.entity,
      key: f.field_key,
      label: f.label,
      type: f.type,
      options: parseJson<string[]>(f.options, []),
      required: f.required === 1,
      showInPos: f.show_in_pos === 1,
      showOnReceipt: f.show_on_receipt === 1,
      showInReport: f.show_in_report === 1,
      sort: f.sort,
    }));
  });
  const fieldRow = (b: z.infer<typeof customFieldSchema>) => ({
    entity: b.entity,
    field_key: b.key,
    label: b.label,
    type: b.type,
    options: JSON.stringify(b.options),
    required: bool(b.required),
    show_in_pos: bool(b.showInPos),
    show_on_receipt: bool(b.showOnReceipt),
    show_in_report: bool(b.showInReport),
    sort: b.sort,
  });
  app.post('/api/custom-fields', auth('settings.manage'), async (req) => {
    const b = customFieldSchema.parse(req.body);
    if (b.type === 'select' && b.options.length === 0) throw badRequest('ฟิลด์แบบตัวเลือกต้องมีตัวเลือกอย่างน้อย 1 รายการ');
    const dup = await ctx.db.selectFrom('custom_fields').select('id').where('entity', '=', b.entity).where('field_key', '=', b.key).executeTakeFirst();
    if (dup) throw conflict(`มีฟิลด์รหัส ${b.key} อยู่แล้ว`);
    const id = uuid();
    await ctx.db.insertInto('custom_fields').values({ id, ...fieldRow(b) }).execute();
    await audit(ctx, ctx.db, req, 'settings.custom_field', 'custom_field', id, { label: b.label });
    bumpCatalog(ctx);
    return { id };
  });
  app.put('/api/custom-fields/:id', auth('settings.manage'), async (req) => {
    const b = customFieldSchema.parse(req.body);
    const { id } = req.params as { id: string };
    await ctx.db.updateTable('custom_fields').set(fieldRow(b)).where('id', '=', id).execute();
    bumpCatalog(ctx);
    return { id };
  });
  app.delete('/api/custom-fields/:id', auth('settings.manage'), async (req) => {
    await ctx.db.deleteFrom('custom_fields').where('id', '=', (req.params as { id: string }).id).execute();
    bumpCatalog(ctx);
    return { ok: true };
  });
}
