import { sql } from 'kysely';
import type { Database } from './dialect.js';
import { TABLE_NAMES } from './migrations.js';

/** Tables that never leave the machine: secrets, queues and per-device scratch data. */
const LOCAL_ONLY = new Set(['meta', 'refresh_tokens', 'idempotency', 'sequences', 'print_jobs', 'held_bills', 'notifications']);

/** Tables replicated to the cloud, in dependency-friendly order. */
export const SYNC_TABLES = TABLE_NAMES.filter((t) => !LOCAL_ONLY.has(t));

/** Columns stripped before rows leave the machine. */
export const SYNC_REDACT: Record<string, string[]> = { users: ['password_hash', 'pin_hash'] };

/** Master data the web may edit; changes travel back to the POS as commands. Sales data never does. */
export const SYNC_EDITABLE = [
  'products', 'categories', 'product_barcodes', 'product_variants', 'product_units', 'product_prices', 'price_tiers',
  'modifier_groups', 'modifiers', 'product_modifier_groups', 'bundle_items', 'customers', 'customer_groups', 'member_tiers',
  'promotions', 'payment_methods', 'suppliers', 'settings',
];

const trig = (t: string, op: string) => `fx_sync_${t}_${op}`.slice(0, 60);

/** Install row-level triggers that append every insert/update/delete to sync_outbox. Idempotent. */
export async function installSyncTriggers(conn: Database): Promise<void> {
  const { db, dialect } = conn;
  if (dialect === 'postgres') {
    await sql`create or replace function fx_sync_capture() returns trigger as $$
      begin
        if tg_op = 'DELETE' then
          insert into sync_outbox(tbl, row_id) values (tg_table_name, old.id);
          return old;
        end if;
        insert into sync_outbox(tbl, row_id) values (tg_table_name, new.id);
        return new;
      end $$ language plpgsql`.execute(db);
    for (const t of SYNC_TABLES) {
      await sql.raw(`drop trigger if exists ${trig(t, 'all')} on "${t}"`).execute(db);
      await sql.raw(`create trigger ${trig(t, 'all')} after insert or update or delete on "${t}" for each row execute function fx_sync_capture()`).execute(db);
    }
    return;
  }
  for (const t of SYNC_TABLES) {
    for (const [op, ev, ref] of [['i', 'insert', 'new'], ['u', 'update', 'new'], ['d', 'delete', 'old']] as const) {
      if (dialect === 'mysql') {
        await sql.raw(`drop trigger if exists ${trig(t, op)}`).execute(db);
        await sql.raw(`create trigger ${trig(t, op)} after ${ev} on \`${t}\` for each row insert into sync_outbox(tbl, row_id) values ('${t}', ${ref}.id)`).execute(db);
      } else {
        await sql.raw(`create trigger if not exists ${trig(t, op)} after ${ev} on "${t}" begin insert into sync_outbox(tbl, row_id) values ('${t}', ${ref}.id); end`).execute(db);
      }
    }
  }
}

export async function dropSyncTriggers(conn: Database): Promise<void> {
  const { db, dialect } = conn;
  for (const t of SYNC_TABLES) {
    if (dialect === 'postgres') await sql.raw(`drop trigger if exists ${trig(t, 'all')} on "${t}"`).execute(db);
    else for (const op of ['i', 'u', 'd']) await sql.raw(`drop trigger if exists ${trig(t, op)}`).execute(db);
  }
}

/** Queue every existing row once, so a newly connected cloud receives the full history. */
export async function enqueueAll(conn: Database): Promise<void> {
  for (const t of SYNC_TABLES) {
    const q = conn.dialect === 'mysql' ? `insert into sync_outbox(tbl, row_id) select '${t}', id from \`${t}\`` : `insert into sync_outbox(tbl, row_id) select '${t}', id from "${t}"`;
    await sql.raw(q).execute(conn.db);
  }
}
