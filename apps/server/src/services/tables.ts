import type { Tx } from '../context.js';

export { tableLabels } from '@flexpos/reports';
import { tableLabels } from '@flexpos/reports';

export async function tableLabel(tx: Tx, tableId: string | null | undefined): Promise<string | null> {
  if (!tableId) return null;
  const t = await tx.selectFrom('tables').select('branch_id').where('id', '=', tableId).executeTakeFirst();
  if (!t) return null;
  return (await tableLabels(tx, t.branch_id)).get(tableId) ?? null;
}
