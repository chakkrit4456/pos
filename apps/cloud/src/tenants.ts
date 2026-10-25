import { randomUUID } from 'node:crypto';
import type { CloudContext } from './context.js';
import { nowIso, uuid } from './auth.js';

export async function createTenant(ctx: CloudContext, o: { name: string; managerId?: string | null; plan?: string }) {
  const id = randomUUID();
  const schema_name = `t_${id.replace(/-/g, '')}`;
  await ctx.db.insertInto('tenants').values({ id, name: o.name, schema_name, status: 'active', plan: o.plan ?? '', note: '', created_at: nowIso(), last_sync_at: null, last_seen_at: null, pos_version: null }).execute();
  await ctx.migrateTenant(schema_name);
  if (o.managerId) await ctx.db.insertInto('memberships').values({ id: uuid(), user_id: o.managerId, tenant_id: id, role: 'manager', created_at: nowIso() }).execute();
  return { id, schema_name };
}

export async function deleteTenant(ctx: CloudContext, tenantId: string) {
  const t = await ctx.db.selectFrom('tenants').select('schema_name').where('id', '=', tenantId).executeTakeFirst();
  if (!t) return false;
  await ctx.db.deleteFrom('tenants').where('id', '=', tenantId).execute(); // memberships/devices/commands cascade
  await ctx.db.deleteFrom('ingest_log').where('tenant_id', '=', tenantId).execute();
  await ctx.dropTenantSchema(t.schema_name);
  return true;
}
