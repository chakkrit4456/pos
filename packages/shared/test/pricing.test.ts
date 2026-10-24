import { describe, expect, it } from 'vitest';
import {
  allocate,
  bahtToSatang,
  computeTender,
  crc16ccitt,
  DEFAULT_PRICING,
  effectiveBillDiscount,
  formatDocNo,
  formatMoney,
  isValidThaiTaxId,
  parseCsv,
  pointsEarned,
  priceCart,
  promptPayPayload,
  toCsv,
  type CartLine,
  type PromotionRule,
} from '../src/index.js';

const line = (id: string, unitPrice: number, qty = 1, extra: Partial<CartLine> = {}): CartLine => ({ id, productId: id, name: id, qty, unitPrice, taxable: true, ...extra });
const promo = (p: Partial<PromotionRule>): PromotionRule => ({
  id: p.id ?? 'p', name: 'promo', type: 'percent', priority: 0, exclusive: false, value: 0, scope: 'items', productIds: [], categoryIds: [], customerGroupIds: [], branchIds: [],
  buyQty: 0, getQty: 0, getDiscountPercent: 100, minSubtotal: 0, maxDiscount: 0, couponCode: null, startsAt: null, endsAt: null, daysOfWeek: [], timeFrom: null, timeTo: null, active: true, ...p,
});
const ctx = { now: new Date('2026-10-25T12:00:00'), branchId: 'b1', customerGroupId: null, couponCodes: [] as string[] };

describe('money', () => {
  it('parses baht to satang without float errors', () => {
    expect(bahtToSatang('0.1')).toBe(10);
    expect(bahtToSatang('19.99')).toBe(1999);
    expect(bahtToSatang('1,234.505')).toBe(123451);
    expect(bahtToSatang(0.3)).toBe(30);
    expect(() => bahtToSatang('abc')).toThrow();
  });
  it('formats', () => {
    expect(formatMoney(123450)).toBe('฿1,234.50');
    expect(formatMoney(-500)).toBe('-฿5.00');
  });
  it('allocates exactly', () => {
    const a = allocate(100, [1, 1, 1]);
    expect(a.reduce((x, y) => x + y, 0)).toBe(100);
    expect(allocate(-7, [3, 4]).reduce((x, y) => x + y, 0)).toBe(-7);
  });
});

describe('VAT', () => {
  it('extracts included VAT at bill level', () => {
    const r = priceCart({ lines: [line('a', 10700)], config: DEFAULT_PRICING });
    expect(r.vat).toBe(700);
    expect(r.vatableBase).toBe(10000);
    expect(r.total).toBe(10700);
  });
  it('adds VAT when prices exclude it', () => {
    const r = priceCart({ lines: [line('a', 10000, 3)], config: { ...DEFAULT_PRICING, pricesIncludeVat: false } });
    expect(r.vat).toBe(2100);
    expect(r.total).toBe(32100);
  });
  it('excludes exempt items and sums line VAT to bill VAT', () => {
    const r = priceCart({ lines: [line('a', 10700), line('b', 5000, 1, { taxable: false }), line('c', 333, 3)], config: DEFAULT_PRICING });
    expect(r.exemptAmount).toBe(5000);
    expect(r.lines.reduce((a, l) => a + l.vat, 0)).toBe(r.vat);
  });
  it('service charge is taxable', () => {
    const r = priceCart({ lines: [line('a', 10000)], config: { ...DEFAULT_PRICING, pricesIncludeVat: false, serviceChargeRate: 10 } });
    expect(r.serviceCharge).toBe(1000);
    expect(r.vat).toBe(770);
    expect(r.total).toBe(11770);
  });
  it('rounds the total to a cash step', () => {
    const r = priceCart({ lines: [line('a', 1013)], config: { ...DEFAULT_PRICING, vatEnabled: false, roundingStep: 25 } });
    expect(r.total).toBe(1025);
    expect(r.rounding).toBe(12);
  });
});

describe('discounts', () => {
  it('line % and bill amount, never below zero', () => {
    const r = priceCart({ lines: [line('a', 10000, 1, { discount: { kind: 'percent', value: 10 } }), line('b', 5000)], billDiscount: { kind: 'amount', value: 1000 }, config: DEFAULT_PRICING });
    expect(r.lineDiscountTotal).toBe(1000);
    expect(r.billDiscountTotal).toBe(1000);
    expect(r.total).toBe(13000);
    const big = priceCart({ lines: [line('a', 100)], billDiscount: { kind: 'amount', value: 99999 }, config: DEFAULT_PRICING });
    expect(big.total).toBe(0);
  });
  it('member group discount applies only without explicit discount', () => {
    expect(effectiveBillDiscount(null, 5)).toEqual({ kind: 'percent', value: 5 });
    expect(effectiveBillDiscount({ kind: 'amount', value: 100 }, 5)).toEqual({ kind: 'amount', value: 100 });
  });
});

describe('promotions', () => {
  it('buy 2 get 1 frees the cheapest unit', () => {
    const r = priceCart({ lines: [line('a', 5000, 2), line('b', 3000, 1)], config: DEFAULT_PRICING, promotions: [promo({ type: 'bxgy', buyQty: 2, getQty: 1 })], promoContext: ctx });
    expect(r.promoDiscountTotal).toBe(3000);
  });
  it('threshold needs the minimum subtotal', () => {
    const p = promo({ type: 'threshold', value: 5000, minSubtotal: 50000 });
    expect(priceCart({ lines: [line('a', 40000)], config: DEFAULT_PRICING, promotions: [p], promoContext: ctx }).promoDiscountTotal).toBe(0);
    expect(priceCart({ lines: [line('a', 60000)], config: DEFAULT_PRICING, promotions: [p], promoContext: ctx }).promoDiscountTotal).toBe(5000);
  });
  it('exclusive higher-priority promo blocks the rest', () => {
    const r = priceCart({ lines: [line('a', 10000)], config: DEFAULT_PRICING, promotions: [promo({ id: 'x', value: 20, priority: 10, exclusive: true }), promo({ id: 'y', value: 10 })], promoContext: ctx });
    expect(r.appliedPromotions.map((p) => p.id)).toEqual(['x']);
    expect(r.promoDiscountTotal).toBe(2000);
  });
  it('respects coupon, time window, weekdays, dates, product scope and cap', () => {
    const base = { lines: [line('a', 10000), line('b', 10000)], config: DEFAULT_PRICING };
    expect(priceCart({ ...base, promotions: [promo({ value: 10, couponCode: 'SAVE' })], promoContext: ctx }).promoDiscountTotal).toBe(0);
    expect(priceCart({ ...base, promotions: [promo({ value: 10, couponCode: 'SAVE' })], promoContext: { ...ctx, couponCodes: ['save'] } }).promoDiscountTotal).toBe(2000);
    expect(priceCart({ ...base, promotions: [promo({ value: 10, timeFrom: '15:00', timeTo: '17:00' })], promoContext: ctx }).promoDiscountTotal).toBe(0);
    expect(priceCart({ ...base, promotions: [promo({ value: 10, daysOfWeek: [ctx.now.getDay()] })], promoContext: ctx }).promoDiscountTotal).toBe(2000);
    expect(priceCart({ ...base, promotions: [promo({ value: 10, endsAt: '2026-01-01T00:00:00Z' })], promoContext: ctx }).promoDiscountTotal).toBe(0);
    expect(priceCart({ ...base, promotions: [promo({ value: 10, productIds: ['a'] })], promoContext: ctx }).promoDiscountTotal).toBe(1000);
    expect(priceCart({ ...base, promotions: [promo({ value: 50, maxDiscount: 3000 })], promoContext: ctx }).promoDiscountTotal).toBe(3000);
  });
  it('amount promotions per item and per bill, with caps', () => {
    const lines = [line('a', 10000, 2), line('b', 5000)];
    expect(priceCart({ lines, config: DEFAULT_PRICING, promotions: [promo({ type: 'amount', value: 500 })], promoContext: ctx }).promoDiscountTotal).toBe(1500);
    expect(priceCart({ lines, config: DEFAULT_PRICING, promotions: [promo({ type: 'amount', value: 500, maxDiscount: 800 })], promoContext: ctx }).promoDiscountTotal).toBe(800);
    expect(priceCart({ lines, config: DEFAULT_PRICING, promotions: [promo({ type: 'amount', scope: 'bill', value: 2000 })], promoContext: ctx }).promoDiscountTotal).toBe(2000);
    expect(priceCart({ lines, config: DEFAULT_PRICING, promotions: [promo({ type: 'bxgy', buyQty: 1, getQty: 1, maxDiscount: 1000 })], promoContext: ctx }).promoDiscountTotal).toBe(1000);
    expect(priceCart({ lines, config: DEFAULT_PRICING, promotions: [promo({ type: 'fixed_price', value: 1000, maxDiscount: 500 })], promoContext: ctx }).promoDiscountTotal).toBe(500);
  });
  it('ignores inactive, wrong branch and wrong customer group promotions', () => {
    const lines = [line('a', 10000)];
    for (const p of [promo({ value: 10, active: false }), promo({ value: 10, branchIds: ['other'] }), promo({ value: 10, customerGroupIds: ['vip'] }), promo({ value: 10, startsAt: '2027-01-01T00:00:00Z' })]) {
      expect(priceCart({ lines, config: DEFAULT_PRICING, promotions: [p], promoContext: ctx }).promoDiscountTotal).toBe(0);
    }
    expect(priceCart({ lines, config: DEFAULT_PRICING, promotions: [promo({ value: 10, timeFrom: '22:00', timeTo: '13:00' })], promoContext: ctx }).promoDiscountTotal).toBe(1000);
  });
  it('fixed price sets the unit price', () => {
    const r = priceCart({ lines: [line('a', 8000, 3)], config: DEFAULT_PRICING, promotions: [promo({ type: 'fixed_price', value: 6000 })], promoContext: ctx });
    expect(r.total).toBe(18000);
  });
});

describe('tender & points', () => {
  it('gives change only from cash', () => {
    expect(computeTender(14500, [{ method: 'cash', amount: 50000, allowsChange: true }])).toEqual({ paid: 50000, change: 35500, due: 0, ok: true });
    expect(computeTender(14500, [{ method: 'card', amount: 20000, allowsChange: false }]).ok).toBe(false);
    expect(computeTender(14500, [{ method: 'card', amount: 10000, allowsChange: false }, { method: 'cash', amount: 5000, allowsChange: true }]).change).toBe(500);
  });
  it('earns points per spend', () => {
    expect(pointsEarned(10000, { enabled: true, earnPerSatang: 2500, pointValue: 100 })).toBe(4);
    expect(pointsEarned(10000, { enabled: false, earnPerSatang: 2500, pointValue: 100 })).toBe(0);
  });
});

describe('PromptPay', () => {
  it('builds a valid EMVCo payload with CRC', () => {
    const p = promptPayPayload('081-234-5678', 14500);
    expect(p).toContain('0016A000000677010111');
    expect(p).toContain('01130066812345678');
    expect(p).toContain('5406145.00');
    expect(crc16ccitt(p.slice(0, -4))).toBe(p.slice(-4));
    expect(promptPayPayload('0105561234560')).toContain('02130105561234560');
  });
  it('validates Thai tax ids', () => {
    expect(isValidThaiTaxId('0105561234560')).toBe(true);
    expect(isValidThaiTaxId('0105561234561')).toBe(false);
  });
});

describe('formatting', () => {
  it('document numbers', () => {
    expect(formatDocNo('{prefix}{yy}{mm}-{seq:5}', { prefix: 'R01', branch: '01', seq: 42, date: new Date('2026-10-25') })).toBe('R012610-00042');
    expect(formatDocNo('{prefix}-{be}-{seq:4}', { prefix: 'INV', branch: '', seq: 7, date: new Date('2026-01-02') })).toBe('INV-2569-0007');
  });
  it('csv round-trip with quotes and Thai', () => {
    const csv = toCsv([['ชื่อ', 'ราคา'], ['ชา "เย็น", หวาน', 60]]);
    expect(parseCsv(csv)).toEqual([['ชื่อ', 'ราคา'], ['ชา "เย็น", หวาน', '60']]);
  });
});
