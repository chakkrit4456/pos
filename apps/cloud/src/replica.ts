/**
 * Replicated store data. Each tenant has its own PostgreSQL schema with exactly the POS tables,
 * so rows are copied as-is and the shared report queries run unchanged.
 */
import type { Kysely, Transaction } from 'kysely';
import { SYNC_EDITABLE, SYNC_REDACT, SYNC_TABLES, TABLE_COLUMNS, type DB } from '@flexpos/db';
import { t } from '@flexpos/shared';
import { badRequest } from './errors.js';

type Row = Record<string, unknown>;
type TDb = Kysely<DB> | Transaction<DB>;

export const EDITABLE_TABLES = SYNC_EDITABLE;

export const isSyncTable = (tbl: string) => SYNC_TABLES.includes(tbl);
export const isEditable = (tbl: string) => EDITABLE_TABLES.includes(tbl);

/** Keep known columns only, coerce kinds, fill defaults for missing NOT NULL columns. */
export function cleanRow(tbl: string, input: Row, opts: { fillDefaults: boolean }): Row {
  const cols = TABLE_COLUMNS[tbl];
  if (!cols) throw badRequest(t('ไม่รู้จักตาราง {0}', tbl));
  const redact = new Set(SYNC_REDACT[tbl] ?? []);
  const out: Row = {};
  for (const c of cols) {
    let v = input[c.name];
    if (v === undefined) {
      if (!opts.fillDefaults) continue;
      v = c.nullable ? null : undefined;
    }
    if (redact.has(c.name)) v = ''; // secrets never leave the POS
    if (v === undefined || v === null) {
      if (c.nullable) out[c.name] = null;
      else if (opts.fillDefaults || v === null) out[c.name] = c.default ?? (['big', 'int', 'real', 'bool'].includes(c.kind) ? 0 : '');
      continue;
    }
    switch (c.kind) {
      case 'big':
      case 'int':
      case 'bool': {
        const n = typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
        if (!Number.isFinite(n)) throw badRequest(t('ค่า {0} ต้องเป็นตัวเลข', c.name));
        out[c.name] = Math.round(n);
        break;
      }
      case 'real': {
        const n = Number(v);
        if (!Number.isFinite(n)) throw badRequest(t('ค่า {0} ต้องเป็นตัวเลข', c.name));
        out[c.name] = n;
        break;
      }
      default:
        out[c.name] = typeof v === 'string' ? v : JSON.stringify(v);
    }
  }
  const pk = cols[0]!.name;
  if (typeof out[pk] !== 'string' || !out[pk]) throw badRequest(t('ข้อมูลต้องมีรหัส ({0})', pk));
  return out;
}

export const pkOf = (tbl: string) => TABLE_COLUMNS[tbl]?.[0]?.name ?? 'id';

export async function upsertRows(db: TDb, tbl: string, rows: Row[]): Promise<void> {
  if (!rows.length) return;
  const pk = pkOf(tbl);
  // Postgres caps bind parameters at 65535; 200 rows × ~45 columns stays far below.
  for (let i = 0; i < rows.length; i += 200) {
    const part = rows.slice(i, i + 200);
    const cols = Object.keys(part[0]!).filter((c) => c !== pk);
    await db
      .insertInto(tbl as never)
      .values(part as never)
      .onConflict((oc) => {
        const b = oc.column(pk as never);
        return cols.length ? b.doUpdateSet(Object.fromEntries(cols.map((c) => [c, (eb: { ref(s: string): unknown }) => eb.ref(`excluded.${c}`)])) as never) : b.doNothing();
      })
      .execute();
  }
}

export async function deleteRows(db: TDb, tbl: string, ids: string[]): Promise<void> {
  const pk = pkOf(tbl);
  for (let i = 0; i < ids.length; i += 1000) await db.deleteFrom(tbl as never).where(pk as never, 'in', ids.slice(i, i + 1000) as never).execute();
}
