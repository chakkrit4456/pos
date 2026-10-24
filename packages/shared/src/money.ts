/** All money values are integers in satang (1 baht = 100 satang). Never use floats for stored amounts. */

/** Round half away from zero to an integer. */
export function roundHalfUp(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

/** Convert a user-entered baht value ("12.5", 12.5) to satang. */
export function bahtToSatang(v: string | number): number {
  const s = typeof v === 'number' ? v.toString() : v.replace(/[,\s฿]/g, '');
  if (s === '' || s === '-') return 0;
  if (!/^-?\d*(\.\d*)?$/.test(s)) throw new Error(`Invalid amount: ${v}`);
  const neg = s.startsWith('-');
  const [i = '0', f = ''] = s.replace('-', '').split('.');
  const frac = (f + '00').slice(0, 2);
  const third = f.length > 2 ? Number(f[2]) : 0;
  let out = Number(i || '0') * 100 + Number(frac);
  if (third >= 5) out += 1;
  return neg ? -out : out;
}

export function satangToBaht(s: number): number {
  return s / 100;
}

export interface MoneyFormatOptions {
  symbol?: string;
  decimals?: boolean;
}

/** ฿1,234.50 */
export function formatMoney(satang: number, opts: MoneyFormatOptions = {}): string {
  const { symbol = '฿', decimals = true } = opts;
  const neg = satang < 0;
  const abs = Math.abs(satang);
  const baht = Math.floor(abs / 100);
  const st = abs % 100;
  const int = baht.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = decimals ? `${int}.${st.toString().padStart(2, '0')}` : int;
  return `${neg ? '-' : ''}${symbol}${body}`;
}

/** Plain "1,234.50" without symbol. */
export function formatAmount(satang: number): string {
  return formatMoney(satang, { symbol: '' });
}

/** Split `total` into integer parts proportional to `weights` (largest remainder), sum is exact. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (sum === 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const raw = weights.map((w) => (abs * w) / sum);
  const floors = raw.map(Math.floor);
  let rest = abs - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const o of order) {
    if (rest <= 0) break;
    floors[o.i]! += 1;
    rest -= 1;
  }
  return floors.map((f) => f * sign);
}
