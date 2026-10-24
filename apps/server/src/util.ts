import { randomUUID } from 'node:crypto';
import { localDate } from '@flexpos/shared';

export const uuid = (): string => randomUUID();
export const nowIso = (): string => new Date().toISOString();
export const bool = (v: boolean | undefined | null): number => (v ? 1 : 0);
export const isTrue = (v: number | boolean | null | undefined): boolean => v === 1 || v === true;

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export function bizStamp(d: Date): { biz_date: string; hour: number; created_at: string } {
  return { biz_date: localDate(d), hour: d.getHours(), created_at: d.toISOString() };
}

/** Coerce DB aggregate results (string from some drivers) to number. */
export const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const localDateStr = (d: Date): string => localDate(d);

export const roundCost = (v: number): number => Math.round(v);

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
