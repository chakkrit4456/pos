import { allocate, roundHalfUp } from './money.js';

export type DiscountKind = 'amount' | 'percent';

/** amount: satang. percent: value in percent (e.g. 10 = 10%, 12.5 allowed). */
export interface Discount {
  kind: DiscountKind;
  value: number;
}

export interface CartLine {
  id: string;
  productId: string;
  categoryId?: string | null;
  name: string;
  /** Quantity, may be fractional for weighed goods (kg). */
  qty: number;
  /** Unit price in satang including modifiers. */
  unitPrice: number;
  taxable: boolean;
  discount?: Discount | null;
}

export interface PricingConfig {
  vatEnabled: boolean;
  /** e.g. 7 for 7% */
  vatRate: number;
  pricesIncludeVat: boolean;
  /** e.g. 10 for 10%. 0 disables. */
  serviceChargeRate: number;
  /** Round grand total to this step in satang (0/1 = none, 25, 50, 100). */
  roundingStep: number;
}

export type PromotionType = 'percent' | 'amount' | 'bxgy' | 'threshold' | 'fixed_price';

export interface PromotionRule {
  id: string;
  name: string;
  type: PromotionType;
  priority: number;
  /** When true, this promotion is not combined with others. */
  exclusive: boolean;
  /** percent: %, amount: satang off per matching unit or bill, fixed_price: satang per unit. */
  value: number;
  /** percent/amount scope: 'items' applies to matching lines, 'bill' to whole bill. */
  scope: 'items' | 'bill';
  productIds: string[];
  categoryIds: string[];
  customerGroupIds: string[];
  branchIds: string[];
  /** bxgy: buy X ... */
  buyQty: number;
  /** bxgy: ... get Y */
  getQty: number;
  /** bxgy: discount percent applied to the Y items (100 = free). */
  getDiscountPercent: number;
  /** threshold: minimum subtotal in satang. Also usable as a precondition for any type. */
  minSubtotal: number;
  /** Max discount satang; 0 = unlimited. */
  maxDiscount: number;
  couponCode: string | null;
  startsAt: string | null;
  endsAt: string | null;
  /** 0=Sunday ... 6=Saturday; empty = all days. */
  daysOfWeek: number[];
  /** "HH:MM" local time; null = all day. */
  timeFrom: string | null;
  timeTo: string | null;
  active: boolean;
}

export interface PromotionContext {
  now: Date;
  branchId: string | null;
  customerGroupId: string | null;
  couponCodes: string[];
}

export interface PricedLine {
  id: string;
  gross: number;
  lineDiscount: number;
  promoDiscount: number;
  billDiscount: number;
  net: number;
  vat: number;
}

export interface AppliedPromotion {
  id: string;
  name: string;
  amount: number;
}

export interface PricingResult {
  lines: PricedLine[];
  subtotal: number;
  lineDiscountTotal: number;
  promoDiscountTotal: number;
  billDiscountTotal: number;
  discountTotal: number;
  netSubtotal: number;
  serviceCharge: number;
  /** Taxable amount excluding VAT. */
  vatableBase: number;
  vat: number;
  exemptAmount: number;
  rounding: number;
  total: number;
  appliedPromotions: AppliedPromotion[];
}

export const DEFAULT_PRICING: PricingConfig = {
  vatEnabled: true,
  vatRate: 7,
  pricesIncludeVat: true,
  serviceChargeRate: 0,
  roundingStep: 0,
};

function discountAmount(base: number, d: Discount | null | undefined): number {
  if (!d || d.value <= 0 || base <= 0) return 0;
  const amt = d.kind === 'percent' ? roundHalfUp((base * Math.min(d.value, 100)) / 100) : roundHalfUp(d.value);
  return Math.min(Math.max(amt, 0), base);
}

function minutesOf(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

export function promotionIsLive(p: PromotionRule, ctx: PromotionContext): boolean {
  if (!p.active) return false;
  const t = ctx.now.getTime();
  if (p.startsAt && t < new Date(p.startsAt).getTime()) return false;
  if (p.endsAt && t > new Date(p.endsAt).getTime()) return false;
  if (p.daysOfWeek.length > 0 && !p.daysOfWeek.includes(ctx.now.getDay())) return false;
  if (p.timeFrom && p.timeTo) {
    const m = ctx.now.getHours() * 60 + ctx.now.getMinutes();
    const from = minutesOf(p.timeFrom);
    const to = minutesOf(p.timeTo);
    const inside = from <= to ? m >= from && m <= to : m >= from || m <= to;
    if (!inside) return false;
  }
  if (p.branchIds.length > 0 && (!ctx.branchId || !p.branchIds.includes(ctx.branchId))) return false;
  if (p.customerGroupIds.length > 0 && (!ctx.customerGroupId || !p.customerGroupIds.includes(ctx.customerGroupId)))
    return false;
  if (p.couponCode) {
    const code = p.couponCode.trim().toLowerCase();
    if (!ctx.couponCodes.some((c) => c.trim().toLowerCase() === code)) return false;
  }
  return true;
}

function lineMatches(p: PromotionRule, l: CartLine): boolean {
  if (p.productIds.length === 0 && p.categoryIds.length === 0) return true;
  if (p.productIds.includes(l.productId)) return true;
  return !!l.categoryId && p.categoryIds.includes(l.categoryId);
}

/**
 * Compute discount per line for one promotion. `remaining` is each line's amount still discountable.
 * Returns per-line discount array (same order as lines).
 */
function evaluatePromotion(p: PromotionRule, lines: CartLine[], remaining: number[]): number[] {
  const out = lines.map(() => 0);
  const matchIdx = lines.map((l, i) => (lineMatches(p, l) && remaining[i]! > 0 ? i : -1)).filter((i) => i >= 0);
  if (matchIdx.length === 0) return out;
  const matchedBase = matchIdx.reduce((a, i) => a + remaining[i]!, 0);
  const allBase = remaining.reduce((a, b) => a + b, 0);
  if (p.minSubtotal > 0 && allBase < p.minSubtotal) return out;

  const cap = (n: number) => (p.maxDiscount > 0 ? Math.min(n, p.maxDiscount) : n);
  const spread = (amount: number, idx: number[]) => {
    const a = allocate(amount, idx.map((i) => remaining[i]!));
    idx.forEach((i, k) => (out[i] = Math.min(a[k]!, remaining[i]!)));
  };

  switch (p.type) {
    case 'percent': {
      const base = p.scope === 'bill' ? allBase : matchedBase;
      const idx = p.scope === 'bill' ? lines.map((_, i) => i).filter((i) => remaining[i]! > 0) : matchIdx;
      spread(cap(roundHalfUp((base * Math.min(p.value, 100)) / 100)), idx);
      break;
    }
    case 'amount': {
      if (p.scope === 'bill') {
        const idx = lines.map((_, i) => i).filter((i) => remaining[i]! > 0);
        spread(cap(Math.min(p.value, allBase)), idx);
      } else {
        // amount off per unit of each matching line
        let total = 0;
        for (const i of matchIdx) {
          const d = Math.min(roundHalfUp(p.value * lines[i]!.qty), remaining[i]!);
          out[i] = d;
          total += d;
        }
        if (p.maxDiscount > 0 && total > p.maxDiscount) {
          out.fill(0);
          spread(p.maxDiscount, matchIdx);
        }
      }
      break;
    }
    case 'threshold': {
      // Spend >= minSubtotal (checked above) → fixed amount off the bill.
      // (Percent off above a threshold = type 'percent', scope 'bill' with minSubtotal.)
      const idx = lines.map((_, i) => i).filter((i) => remaining[i]! > 0);
      spread(cap(Math.min(p.value, allBase)), idx);
      break;
    }
    case 'fixed_price': {
      let total = 0;
      for (const i of matchIdx) {
        const l = lines[i]!;
        const target = roundHalfUp(p.value * l.qty);
        const d = Math.max(0, Math.min(remaining[i]! - target, remaining[i]!));
        out[i] = d;
        total += d;
      }
      if (p.maxDiscount > 0 && total > p.maxDiscount) {
        out.fill(0);
        spread(p.maxDiscount, matchIdx);
      }
      break;
    }
    case 'bxgy': {
      const buy = Math.max(1, Math.floor(p.buyQty));
      const get = Math.max(1, Math.floor(p.getQty));
      // Expand matching units, cheapest units become the "get" items.
      const units: { i: number; price: number }[] = [];
      for (const i of matchIdx) {
        const l = lines[i]!;
        const whole = Math.floor(l.qty);
        if (whole <= 0) continue;
        const unitNet = remaining[i]! / l.qty;
        for (let u = 0; u < whole; u++) units.push({ i, price: unitNet });
      }
      const groups = Math.floor(units.length / (buy + get));
      if (groups === 0) break;
      units.sort((a, b) => a.price - b.price);
      const free = units.slice(0, groups * get);
      const pct = Math.min(Math.max(p.getDiscountPercent, 0), 100);
      const perLine = new Map<number, number>();
      for (const u of free) perLine.set(u.i, (perLine.get(u.i) ?? 0) + (u.price * pct) / 100);
      let total = 0;
      for (const [i, v] of perLine) {
        const d = Math.min(roundHalfUp(v), remaining[i]!);
        out[i] = d;
        total += d;
      }
      if (p.maxDiscount > 0 && total > p.maxDiscount) {
        const idx = [...perLine.keys()];
        out.fill(0);
        spread(p.maxDiscount, idx);
      }
      break;
    }
  }
  return out;
}

export interface PriceCartInput {
  lines: CartLine[];
  billDiscount?: Discount | null;
  config: PricingConfig;
  promotions?: PromotionRule[];
  promoContext?: PromotionContext;
}

export function priceCart(input: PriceCartInput): PricingResult {
  const { lines, config } = input;
  const gross = lines.map((l) => roundHalfUp(l.unitPrice * l.qty));
  const lineDisc = lines.map((l, i) => discountAmount(gross[i]!, l.discount));
  const remaining = gross.map((g, i) => g - lineDisc[i]!);

  // Promotions, highest priority first.
  const promoDisc = lines.map(() => 0);
  const applied: AppliedPromotion[] = [];
  if (input.promotions && input.promoContext && lines.length > 0) {
    const ctx = input.promoContext;
    const live = input.promotions
      .filter((p) => promotionIsLive(p, ctx))
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    for (const p of live) {
      if (p.exclusive && applied.length > 0) continue;
      const d = evaluatePromotion(p, lines, remaining);
      const sum = d.reduce((a, b) => a + b, 0);
      if (sum <= 0) continue;
      d.forEach((v, i) => {
        promoDisc[i]! += v;
        remaining[i]! -= v;
      });
      applied.push({ id: p.id, name: p.name, amount: sum });
      if (p.exclusive) break;
    }
  }

  // Bill discount spread proportionally over remaining amounts.
  const remainingSum = remaining.reduce((a, b) => a + b, 0);
  const billAmt = discountAmount(remainingSum, input.billDiscount);
  const billDisc = allocate(billAmt, remaining);
  const net = remaining.map((r, i) => r - (billDisc[i] ?? 0));

  const netSubtotal = net.reduce((a, b) => a + b, 0);
  const serviceCharge =
    config.serviceChargeRate > 0 ? roundHalfUp((netSubtotal * config.serviceChargeRate) / 100) : 0;

  // VAT at bill level, then allocated to lines for reporting.
  const taxableNet = net.reduce((a, n, i) => a + (lines[i]!.taxable ? n : 0), 0);
  const exemptAmount = netSubtotal - taxableNet;
  // Service charge is taxable in proportion of taxable sales.
  const serviceTaxable = netSubtotal > 0 ? roundHalfUp((serviceCharge * taxableNet) / netSubtotal) : 0;
  const taxableWithService = taxableNet + serviceTaxable;
  let vat = 0;
  let vatableBase = 0;
  if (config.vatEnabled && config.vatRate > 0) {
    if (config.pricesIncludeVat) {
      vat = roundHalfUp((taxableWithService * config.vatRate) / (100 + config.vatRate));
      vatableBase = taxableWithService - vat;
    } else {
      vat = roundHalfUp((taxableWithService * config.vatRate) / 100);
      vatableBase = taxableWithService;
    }
  }
  const lineVat = allocate(
    vat,
    net.map((n, i) => (lines[i]!.taxable ? n : 0)),
  );

  const beforeRounding =
    netSubtotal + serviceCharge + (config.vatEnabled && !config.pricesIncludeVat ? vat : 0);
  let rounding = 0;
  if (config.roundingStep > 1) {
    const step = config.roundingStep;
    const rounded = Math.round(beforeRounding / step) * step;
    rounding = rounded - beforeRounding;
  }

  const lineDiscountTotal = lineDisc.reduce((a, b) => a + b, 0);
  const promoDiscountTotal = promoDisc.reduce((a, b) => a + b, 0);
  return {
    lines: lines.map((l, i) => ({
      id: l.id,
      gross: gross[i]!,
      lineDiscount: lineDisc[i]!,
      promoDiscount: promoDisc[i]!,
      billDiscount: billDisc[i] ?? 0,
      net: net[i]!,
      vat: lineVat[i] ?? 0,
    })),
    subtotal: gross.reduce((a, b) => a + b, 0),
    lineDiscountTotal,
    promoDiscountTotal,
    billDiscountTotal: billAmt,
    discountTotal: lineDiscountTotal + promoDiscountTotal + billAmt,
    netSubtotal,
    serviceCharge,
    vatableBase,
    vat,
    exemptAmount,
    rounding,
    total: beforeRounding + rounding,
    appliedPromotions: applied,
  };
}

export interface PaymentInput {
  method: string;
  amount: number;
  /** Methods that allow over-tender (cash) and give change. */
  allowsChange: boolean;
}

export interface TenderResult {
  paid: number;
  change: number;
  due: number;
  ok: boolean;
}

/** Compute change; only change-giving methods may exceed what is due. */
export function computeTender(total: number, payments: PaymentInput[]): TenderResult {
  const nonCash = payments.filter((p) => !p.allowsChange).reduce((a, p) => a + p.amount, 0);
  const cash = payments.filter((p) => p.allowsChange).reduce((a, p) => a + p.amount, 0);
  const paid = nonCash + cash;
  if (nonCash > total) return { paid, change: 0, due: 0, ok: false };
  const change = Math.max(0, paid - total);
  const due = Math.max(0, total - paid);
  return { paid, change, due, ok: due === 0 && change <= cash };
}

export interface PointsConfig {
  enabled: boolean;
  /** Earn 1 point per this many satang spent. */
  earnPerSatang: number;
  /** Satang value of one point when redeemed. */
  pointValue: number;
}

export function pointsEarned(total: number, cfg: PointsConfig): number {
  if (!cfg.enabled || cfg.earnPerSatang <= 0 || total <= 0) return 0;
  return Math.floor(total / cfg.earnPerSatang);
}

export function pointsValue(points: number, cfg: PointsConfig): number {
  return Math.max(0, Math.floor(points)) * Math.max(0, cfg.pointValue);
}
