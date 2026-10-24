export type DateEra = 'BE' | 'CE';

const pad = (n: number) => n.toString().padStart(2, '0');

/** dd/mm/yy(yy) hh:mm in the given era. */
export function formatDateTime(
  d: Date | string,
  era: DateEra = 'BE',
  opts: { time?: boolean; shortYear?: boolean } = {},
): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const { time = true, shortYear = false } = opts;
  const y = date.getFullYear() + (era === 'BE' ? 543 : 0);
  const yy = shortYear ? pad(y % 100) : String(y);
  const s = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${yy}`;
  return time ? `${s} ${pad(date.getHours())}:${pad(date.getMinutes())}` : s;
}

export function formatTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Local business date YYYY-MM-DD. */
export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Render a document number. Tokens: {prefix} {branch} {yyyy} {yy} {be} {mm} {seq:N} {seq} */
export function formatDocNo(
  pattern: string,
  v: { prefix: string; branch: string; seq: number; date: Date },
): string {
  const y = v.date.getFullYear();
  return pattern
    .replace('{prefix}', v.prefix)
    .replace('{branch}', v.branch)
    .replace('{yyyy}', String(y))
    .replace('{be}', String(y + 543))
    .replace('{yy}', pad(y % 100))
    .replace('{mm}', pad(v.date.getMonth() + 1))
    .replace(/\{seq:(\d+)\}/, (_, n: string) => String(v.seq).padStart(Number(n), '0'))
    .replace('{seq}', String(v.seq));
}

export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/** In-store EAN-13 using prefix 20 (reserved for internal use). */
export function generateInternalEan13(seq: number): string {
  const body = '20' + String(seq % 1e10).padStart(10, '0');
  return body + ean13CheckDigit(body);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? '';
  if (/[฀-๿]/.test(first)) {
    // Thai: first two consonants
    return [...first].filter((c) => /[ก-ฮ]/.test(c)).slice(0, 2).join('');
  }
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/** RFC4180 CSV parser (quotes, escaped quotes, CRLF, BOM). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}
