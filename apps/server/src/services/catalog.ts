import type {
  Catalog,
  CatalogCategory,
  CatalogModifierGroup,
  CatalogProduct,
  ProductInput,
  ProductKind,
  PaymentMethodView,
  PaymentKind,
} from '@flexpos/shared';
import type { AppContext, Tx } from '../context.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { bool, isTrue, nowIso, parseJson, uuid } from '../util.js';

let catalogVersion = Date.now().toString(36);
export const bumpCatalog = (ctx: AppContext) => {
  catalogVersion = Date.now().toString(36);
  ctx.emit({ type: 'catalog.changed' });
};
export const getCatalogVersion = () => catalogVersion;

export async function buildCatalog(ctx: AppContext, branchId: string): Promise<Catalog> {
  const db = ctx.db;
  const [products, barcodes, variants, units, pmg, prices, levels, cats, groups, mods, fields, methods] = await Promise.all([
    db.selectFrom('products').selectAll().where('deleted_at', 'is', null).where('active', '=', 1).execute(),
    db.selectFrom('product_barcodes').selectAll().execute(),
    db.selectFrom('product_variants').selectAll().where('active', '=', 1).orderBy('sort').execute(),
    db.selectFrom('product_units').selectAll().execute(),
    db.selectFrom('product_modifier_groups').selectAll().orderBy('sort').execute(),
    db.selectFrom('product_prices').selectAll().execute(),
    db.selectFrom('stock_levels').select(['product_id', 'variant_id', 'qty']).where('branch_id', '=', branchId).execute(),
    db.selectFrom('categories').selectAll().where('active', '=', 1).orderBy('sort').execute(),
    db.selectFrom('modifier_groups').selectAll().execute(),
    db.selectFrom('modifiers').selectAll().where('active', '=', 1).orderBy('sort').execute(),
    db.selectFrom('custom_fields').selectAll().where('entity', '=', 'product').where('show_in_pos', '=', 1).execute(),
    db.selectFrom('payment_methods').selectAll().orderBy('sort').execute(),
  ]);
  const group = <T, K extends string>(rows: T[], key: (r: T) => K) => {
    const m = new Map<K, T[]>();
    for (const r of rows) {
      const k = key(r);
      const arr = m.get(k);
      if (arr) arr.push(r);
      else m.set(k, [r]);
    }
    return m;
  };
  const bcByProduct = group(barcodes, (b) => b.product_id);
  const varByProduct = group(variants, (v) => v.product_id);
  const unitByProduct = group(units, (u) => u.product_id);
  const pmgByProduct = group(pmg, (x) => x.product_id);
  const priceByProduct = group(prices, (x) => x.product_id);
  const stock = new Map(levels.map((l) => [`${l.product_id}|${l.variant_id}`, l.qty]));

  const catalogProducts: CatalogProduct[] = products
    .map((p) => {
      const bcs = bcByProduct.get(p.id) ?? [];
      const vs = varByProduct.get(p.id) ?? [];
      const track = p.track_stock === 1 && ctx.settings.modules.stock;
      const custom = parseJson<Record<string, unknown>>(p.custom, {});
      const posFields: Record<string, string> = {};
      for (const f of fields) {
        const v = custom[f.field_key];
        if (v !== undefined && v !== null && v !== '') posFields[f.label] = String(v);
      }
      return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        categoryId: p.category_id,
        kind: p.kind as ProductKind,
        unit: p.unit,
        price: p.price,
        taxable: p.taxable === 1,
        color: p.color,
        image: p.image,
        barcodes: bcs.filter((b) => !b.variant_id && !b.unit_id).map((b) => b.code),
        variants: vs.map((v) => ({
          id: v.id,
          name: v.name,
          sku: v.sku,
          price: v.price,
          barcodes: bcs.filter((b) => b.variant_id === v.id).map((b) => b.code),
          stock: track ? (stock.get(`${p.id}|${v.id}`) ?? 0) : null,
        })),
        units: (unitByProduct.get(p.id) ?? []).map((u) => ({
          id: u.id,
          name: u.name,
          factor: u.factor,
          price: u.price,
          barcodes: bcs.filter((b) => b.unit_id === u.id).map((b) => b.code),
        })),
        modifierGroupIds: (pmgByProduct.get(p.id) ?? []).map((x) => x.group_id),
        tierPrices: Object.fromEntries((priceByProduct.get(p.id) ?? []).map((x) => [x.tier_id, x.price])),
        stock: track && vs.length === 0 ? (stock.get(`${p.id}|`) ?? 0) : null,
        trackStock: track,
        lowStock: p.low_stock,
        posFields,
        sort: p.sort,
        showInPos: p.show_in_pos === 1,
      };
    })
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'th'));

  const modsByGroup = group(mods, (m) => m.group_id);
  const modifierGroups: CatalogModifierGroup[] = groups.map((g) => ({
    id: g.id,
    name: g.name,
    minSelect: g.min_select,
    maxSelect: g.max_select,
    modifiers: (modsByGroup.get(g.id) ?? []).map((m) => ({ id: m.id, name: m.name, priceDelta: m.price_delta })),
  }));
  const categories: CatalogCategory[] = cats.map((c) => ({
    id: c.id,
    name: c.name,
    parentId: c.parent_id,
    color: c.color,
    sort: c.sort,
  }));
  const paymentMethods: PaymentMethodView[] = methods.map((m) => ({
    id: m.id,
    code: m.code,
    name: m.name,
    kind: m.kind as PaymentKind,
    active: m.active === 1,
    sort: m.sort,
  }));
  return { products: catalogProducts, categories, modifierGroups, paymentMethods, version: catalogVersion };
}

/** Pass the transaction when called inside one (SQLite has a single connection). */
export async function getProductDetail(ctx: AppContext, id: string, db: Tx = ctx.db) {
  const p = await db.selectFrom('products').selectAll().where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
  if (!p) throw notFound('สินค้า');
  const [barcodes, variants, units, pmg, bundle, prices, levels] = await Promise.all([
    db.selectFrom('product_barcodes').selectAll().where('product_id', '=', id).execute(),
    db.selectFrom('product_variants').selectAll().where('product_id', '=', id).orderBy('sort').execute(),
    db.selectFrom('product_units').selectAll().where('product_id', '=', id).execute(),
    db.selectFrom('product_modifier_groups').selectAll().where('product_id', '=', id).orderBy('sort').execute(),
    db.selectFrom('bundle_items').selectAll().where('bundle_id', '=', id).execute(),
    db.selectFrom('product_prices').selectAll().where('product_id', '=', id).execute(),
    db.selectFrom('stock_levels').selectAll().where('product_id', '=', id).execute(),
  ]);
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    categoryId: p.category_id,
    kind: p.kind,
    unit: p.unit,
    price: p.price,
    cost: p.cost,
    taxable: isTrue(p.taxable),
    trackStock: isTrue(p.track_stock),
    lowStock: p.low_stock,
    color: p.color,
    image: p.image,
    active: isTrue(p.active),
    showInPos: isTrue(p.show_in_pos),
    barcodes: barcodes.filter((b) => !b.variant_id && !b.unit_id).map((b) => b.code),
    variants: variants.map((v) => ({
      id: v.id,
      name: v.name,
      options: parseJson<Record<string, string>>(v.options, {}),
      sku: v.sku,
      barcode: barcodes.find((b) => b.variant_id === v.id)?.code ?? '',
      price: v.price,
      cost: v.cost,
      active: isTrue(v.active),
    })),
    units: units.map((u) => ({
      id: u.id,
      name: u.name,
      factor: u.factor,
      price: u.price,
      barcode: barcodes.find((b) => b.unit_id === u.id)?.code ?? '',
    })),
    modifierGroupIds: pmg.map((x) => x.group_id),
    bundleItems: bundle.map((b) => ({ productId: b.product_id, variantId: b.variant_id, qty: b.qty })),
    tierPrices: prices.map((x) => ({ tierId: x.tier_id, price: x.price })),
    custom: parseJson<Record<string, unknown>>(p.custom, {}),
    stock: levels.map((l) => ({ branchId: l.branch_id, variantId: l.variant_id, qty: l.qty, avgCost: l.avg_cost })),
  };
}

async function assertBarcodesFree(tx: Tx, codes: string[], productId: string | null) {
  const clean = codes.filter(Boolean);
  if (new Set(clean).size !== clean.length) throw badRequest('มีบาร์โค้ดซ้ำกันในสินค้านี้');
  if (clean.length === 0) return;
  let q = tx.selectFrom('product_barcodes').innerJoin('products', 'products.id', 'product_barcodes.product_id').select(['product_barcodes.code', 'products.name']).where('product_barcodes.code', 'in', clean).where('products.deleted_at', 'is', null);
  if (productId) q = q.where('product_barcodes.product_id', '!=', productId);
  const taken = await q.executeTakeFirst();
  if (taken) throw conflict(`บาร์โค้ด ${taken.code} ถูกใช้แล้วกับสินค้า “${taken.name}”`);
}

async function assertSkuFree(tx: Tx, sku: string, productId: string | null) {
  if (!sku) return;
  let q = tx.selectFrom('products').select(['id', 'name']).where('sku', '=', sku).where('deleted_at', 'is', null);
  if (productId) q = q.where('id', '!=', productId);
  const taken = await q.executeTakeFirst();
  if (taken) throw conflict(`SKU ${sku} ซ้ำกับสินค้า “${taken.name}”`);
}

export async function validateCustom(ctx: AppContext, entity: 'product' | 'customer' | 'supplier', custom: Record<string, unknown>, db: Tx = ctx.db) {
  const fields = await db.selectFrom('custom_fields').selectAll().where('entity', '=', entity).execute();
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = custom[f.field_key];
    const empty = v === undefined || v === null || v === '';
    if (empty) {
      if (f.required === 1) throw badRequest(`กรุณากรอก “${f.label}”`);
      continue;
    }
    if (f.type === 'number' && !Number.isFinite(Number(v))) throw badRequest(`“${f.label}” ต้องเป็นตัวเลข`);
    if (f.type === 'select') {
      const opts = parseJson<string[]>(f.options, []);
      if (!opts.includes(String(v))) throw badRequest(`“${f.label}” ต้องเป็นหนึ่งในตัวเลือกที่กำหนด`);
    }
    out[f.field_key] = f.type === 'number' ? Number(v) : f.type === 'checkbox' ? !!v : v;
  }
  return out;
}

/** Create or replace a product with all its children, in one transaction. */
export async function saveProduct(ctx: AppContext, tx: Tx, input: ProductInput, existingId: string | null): Promise<string> {
  const id = existingId ?? uuid();
  const now = nowIso();
  await assertSkuFree(tx, input.sku, existingId);
  const allCodes = [...input.barcodes, ...input.variants.map((v) => v.barcode), ...input.units.map((u) => u.barcode)];
  await assertBarcodesFree(tx, allCodes, existingId);
  if (input.kind === 'bundle' && input.bundleItems.length === 0) throw badRequest('สินค้าชุดต้องมีส่วนประกอบอย่างน้อย 1 รายการ');
  if (input.bundleItems.some((b) => b.productId === id)) throw badRequest('สินค้าชุดใส่ตัวเองเป็นส่วนประกอบไม่ได้');
  const custom = await validateCustom(ctx, 'product', input.custom, tx);

  const row = {
    sku: input.sku,
    name: input.name,
    category_id: input.categoryId ?? null,
    kind: input.kind,
    unit: input.unit,
    price: input.price,
    cost: input.cost,
    taxable: bool(input.taxable),
    track_stock: bool(input.trackStock && input.kind !== 'service' && input.kind !== 'bundle'),
    low_stock: input.lowStock,
    color: input.color,
    image: input.image,
    active: bool(input.active),
    show_in_pos: bool(input.showInPos),
    custom: JSON.stringify(custom),
    updated_at: now,
  };
  if (existingId) {
    const r = await tx.updateTable('products').set(row).where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw notFound('สินค้า');
  } else {
    const max = await tx.selectFrom('products').select((eb) => eb.fn.max('sort').as('m')).executeTakeFirst();
    await tx
      .insertInto('products')
      .values({ id, ...row, sort: Number(max?.m ?? 0) + 1, created_at: now, deleted_at: null })
      .execute();
  }

  // Variants: keep ids so stock levels stay attached.
  const oldVariants = await tx.selectFrom('product_variants').select('id').where('product_id', '=', id).execute();
  const keep = new Set(input.variants.map((v) => v.id).filter(Boolean));
  const removed = oldVariants.filter((v) => !keep.has(v.id)).map((v) => v.id);
  if (removed.length) await tx.updateTable('product_variants').set({ active: 0 }).where('id', 'in', removed).execute();
  await tx.deleteFrom('product_barcodes').where('product_id', '=', id).execute();
  let vs = 0;
  for (const v of input.variants) {
    const vid = v.id && oldVariants.some((o) => o.id === v.id) ? v.id : uuid();
    const vrow = { name: v.name, options: JSON.stringify(v.options), sku: v.sku, price: v.price, cost: v.cost, active: bool(v.active), sort: vs++ };
    if (vid === v.id) await tx.updateTable('product_variants').set(vrow).where('id', '=', vid).execute();
    else await tx.insertInto('product_variants').values({ id: vid, product_id: id, ...vrow }).execute();
    if (v.barcode) await tx.insertInto('product_barcodes').values({ id: uuid(), product_id: id, variant_id: vid, unit_id: null, code: v.barcode }).execute();
  }
  for (const code of input.barcodes) {
    await tx.insertInto('product_barcodes').values({ id: uuid(), product_id: id, variant_id: null, unit_id: null, code }).execute();
  }
  await tx.deleteFrom('product_units').where('product_id', '=', id).execute();
  for (const u of input.units) {
    const uid = u.id ?? uuid();
    await tx.insertInto('product_units').values({ id: uid, product_id: id, name: u.name, factor: u.factor, price: u.price }).execute();
    if (u.barcode) await tx.insertInto('product_barcodes').values({ id: uuid(), product_id: id, variant_id: null, unit_id: uid, code: u.barcode }).execute();
  }
  await tx.deleteFrom('product_modifier_groups').where('product_id', '=', id).execute();
  let ms = 0;
  for (const gid of input.modifierGroupIds) {
    await tx.insertInto('product_modifier_groups').values({ id: uuid(), product_id: id, group_id: gid, sort: ms++ }).execute();
  }
  await tx.deleteFrom('bundle_items').where('bundle_id', '=', id).execute();
  for (const b of input.bundleItems) {
    await tx.insertInto('bundle_items').values({ id: uuid(), bundle_id: id, product_id: b.productId, variant_id: b.variantId ?? null, qty: b.qty }).execute();
  }
  await tx.deleteFrom('product_prices').where('product_id', '=', id).execute();
  for (const tp of input.tierPrices) {
    await tx.insertInto('product_prices').values({ id: uuid(), product_id: id, tier_id: tp.tierId, price: tp.price }).execute();
  }
  return id;
}
