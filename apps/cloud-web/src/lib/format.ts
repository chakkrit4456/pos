import { formatDateTime, formatMoney, getLanguage } from '@flexpos/shared';

const era = () => (getLanguage() === 'th' ? 'BE' : 'CE');
export const money = (satang: number) => formatMoney(satang);
export const dateTime = (d: string | null | undefined) => (d ? formatDateTime(d, era()) : '-');
export const date = (d: string) => formatDateTime(d, era(), { time: false });

/** "5 นาทีที่แล้ว" style age of a timestamp. */
export function ago(d: string | null | undefined): string {
  if (!d) return '-';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(d)) / 1000));
  const th = getLanguage() === 'th';
  if (s < 60) return th ? 'เมื่อสักครู่' : 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return th ? `${m} นาทีที่แล้ว` : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return th ? `${h} ชั่วโมงที่แล้ว` : `${h} h ago`;
  return dateTime(d);
}

export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Money columns are stored in satang; edit them in baht. */
export const MONEY_COLS = new Set(['price', 'cost', 'price_delta', 'min_spend', 'credit_limit', 'credit_balance', 'max_discount', 'min_subtotal', 'total_spent', 'total', 'subtotal', 'vat', 'paid', 'amount', 'avg_cost', 'unit_price', 'unit_cost', 'net', 'gross', 'discount_total', 'cost_total']);
