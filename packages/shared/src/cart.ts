import type { Discount } from './pricing.js';
import type { CatalogModifierGroup, CatalogProduct } from './types.js';
import { ean13CheckDigit } from './format.js';
import { t } from './i18n.js';

/** Base unit price (satang) for a product/variant/unit at the customer's price tier, before modifiers. */
export function resolveBasePrice(
  p: CatalogProduct,
  opts: { variantId?: string | null; unitId?: string | null; tierId?: string | null },
): number {
  if (opts.unitId) {
    const u = p.units.find((x) => x.id === opts.unitId);
    if (u) return u.price;
  }
  if (opts.variantId) {
    const v = p.variants.find((x) => x.id === opts.variantId);
    if (v) return v.price;
  }
  if (opts.tierId && p.tierPrices[opts.tierId] !== undefined) return p.tierPrices[opts.tierId]!;
  return p.price;
}

/** Base-unit quantity for stock (unit factor applied). */
export function baseQty(p: CatalogProduct, unitId: string | null | undefined, qty: number): number {
  const u = unitId ? p.units.find((x) => x.id === unitId) : undefined;
  return u ? qty * u.factor : qty;
}

export function validateModifiers(
  p: CatalogProduct,
  groups: CatalogModifierGroup[],
  chosen: { id: string }[],
): { ok: true; priceDelta: number; names: { id: string; name: string; priceDelta: number }[] } | { ok: false; message: string } {
  const own = groups.filter((g) => p.modifierGroupIds.includes(g.id));
  const names: { id: string; name: string; priceDelta: number }[] = [];
  let delta = 0;
  for (const c of chosen) {
    const g = own.find((gg) => gg.modifiers.some((m) => m.id === c.id));
    const m = g?.modifiers.find((mm) => mm.id === c.id);
    if (!g || !m) return { ok: false, message: t('ตัวเลือกไม่ถูกต้องสำหรับ {0}', p.name) };
    names.push({ id: m.id, name: m.name, priceDelta: m.priceDelta });
    delta += m.priceDelta;
  }
  for (const g of own) {
    const n = chosen.filter((c) => g.modifiers.some((m) => m.id === c.id)).length;
    if (n < g.minSelect) return { ok: false, message: t('กรุณาเลือก “{0}” สำหรับ {1}', g.name, p.name) };
    if (g.maxSelect > 0 && n > g.maxSelect) return { ok: false, message: t('“{0}” เลือกได้ไม่เกิน {1}', g.name, g.maxSelect) };
  }
  return { ok: true, priceDelta: delta, names };
}

/** Bill discount: an explicit one wins, otherwise the customer group's automatic percent. */
export function effectiveBillDiscount(explicit: Discount | null | undefined, groupPercent: number): Discount | null {
  if (explicit && explicit.value > 0) return explicit;
  return groupPercent > 0 ? { kind: 'percent', value: groupPercent } : null;
}

export function findByCode(products: CatalogProduct[], code: string) {
  const c = code.trim();
  if (!c) return null;
  for (const p of products) {
    if (p.barcodes.includes(c) || (p.sku && p.sku.toLowerCase() === c.toLowerCase())) return { product: p, variantId: null, unitId: null };
    for (const v of p.variants) if (v.barcodes.includes(c) || (v.sku && v.sku === c)) return { product: p, variantId: v.id, unitId: null };
    for (const u of p.units) if (u.barcodes.includes(c)) return { product: p, variantId: null, unitId: u.id };
  }
  return null;
}

export interface ScaleBarcodeConfig {
  enabled: boolean;
  prefixes: string[];
  /** what the 5-digit value carries: weight in grams, or price in satang */
  value: 'weight' | 'price';
}

/**
 * Label-scale barcodes: EAN-13 `PP IIIII VVVVV C` — a 2-digit prefix (21–29; 20 is used for in-store codes), the 5-digit item code
 * (matched to a weighted product's SKU or barcode), then the weight in grams or the price in satang.
 * Returns the product and the quantity in the product's unit (kg), or null when the code is not one.
 */
export function parseScaleBarcode(products: CatalogProduct[], code: string, cfg: ScaleBarcodeConfig) {
  const c = code.trim();
  if (!cfg.enabled || !/^\d{13}$/.test(c) || !cfg.prefixes.includes(c.slice(0, 2))) return null;
  if (ean13CheckDigit(c) !== Number(c[12])) return null;
  const item = c.slice(2, 7);
  const value = Number(c.slice(7, 12));
  const product = products.find((p) => p.kind === 'weighted' && (p.sku === item || p.barcodes.includes(item) || (/^\d+$/.test(p.sku) && Number(p.sku) === Number(item))));
  if (!product || value <= 0) return null;
  const qty = cfg.value === 'weight' ? value / 1000 : product.price > 0 ? Math.round((value / product.price) * 1000) / 1000 : 0;
  return qty > 0 ? { product, qty } : null;
}
