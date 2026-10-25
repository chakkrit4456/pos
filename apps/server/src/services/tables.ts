import type { Tx } from '../context.js';

/**
 * Display names for tables. When a branch has more than one zone, a table is shown as
 * "<zone> · <table>" so "1" in two zones is never ambiguous.
 */
export async function tableLabels(tx: Tx, branchId?: string): Promise<Map<string, string>> {
  let q = tx.selectFrom('tables').leftJoin('zones', 'zones.id', 'tables.zone_id').select(['tables.id', 'tables.name', 'tables.branch_id', 'zones.name as zone_name']);
  if (branchId) q = q.where('tables.branch_id', '=', branchId);
  const rows = await q.execute();
  const zonesPerBranch = new Map<string, Set<string>>();
  for (const r of rows) {
    const s = zonesPerBranch.get(r.branch_id) ?? new Set<string>();
    if (r.zone_name) s.add(r.zone_name);
    zonesPerBranch.set(r.branch_id, s);
  }
  return new Map(rows.map((r) => [r.id, r.zone_name && (zonesPerBranch.get(r.branch_id)?.size ?? 0) > 1 ? `${r.zone_name} · ${r.name}` : r.name]));
}

export async function tableLabel(tx: Tx, tableId: string | null | undefined): Promise<string | null> {
  if (!tableId) return null;
  const t = await tx.selectFrom('tables').select('branch_id').where('id', '=', tableId).executeTakeFirst();
  if (!t) return null;
  return (await tableLabels(tx, t.branch_id)).get(tableId) ?? null;
}
