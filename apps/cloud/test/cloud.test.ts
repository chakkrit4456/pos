import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localDate } from '@flexpos/shared';
import { addSuperadmin, createCloud, ids, storeRows, type Caller } from './helpers.js';

type Reg = { deviceToken: string; tenantId: string; tenantName: string };
type Login = { accessToken: string; user: { isSuperadmin: boolean } };

describe('FlexPOS Cloud', () => {
  let cloud: Awaited<ReturnType<typeof createCloud>>;
  let call: Caller;
  const today = localDate();
  let a: Reg;
  let b: Reg;
  let mgrA = '';
  let mgrB = '';
  let viewer = '';
  let root = '';

  const login = async (email: string, password: string) => {
    const r = await call<Login>('POST', '/api/auth/login', { email, password });
    expect(r.status).toBe(200);
    return r.body.accessToken;
  };

  beforeAll(async () => {
    cloud = await createCloud();
    call = cloud.call;
  }, 120_000);
  afterAll(async () => cloud?.close());

  it('pairs a POS and creates the store with its manager account', async () => {
    const r = await call<Reg>('POST', '/api/sync/register', { email: 'A@Shop.test', password: 'password-a', createAccount: { name: 'Manager A' }, storeName: 'ร้าน A', deviceName: 'POS-1' });
    expect(r.status).toBe(200);
    a = r.body;
    expect(a.deviceToken.length).toBeGreaterThan(20);
    const dup = await call('POST', '/api/sync/register', { email: 'a@shop.test', password: 'password-a', createAccount: { name: 'x' }, storeName: 'x', deviceName: 'x' });
    expect(dup.status).toBe(409);
    const bad = await call('POST', '/api/sync/register', { email: 'a@shop.test', password: 'wrong-pass', storeName: 'x', deviceName: 'x' });
    expect(bad.status).toBe(401);
    // Existing manager with one store: a second machine joins the same store.
    const second = await call<Reg>('POST', '/api/sync/register', { email: 'a@shop.test', password: 'password-a', storeName: 'ignored', deviceName: 'POS-2' });
    expect(second.body.tenantId).toBe(a.tenantId);
    b = (await call<Reg>('POST', '/api/sync/register', { email: 'b@shop.test', password: 'password-b', createAccount: { name: 'Manager B' }, storeName: 'ร้าน B', deviceName: 'POS-B' })).body;
    expect(b.tenantId).not.toBe(a.tenantId);
  });

  it('ingests pushed rows idempotently and never stores POS secrets', async () => {
    const tables = storeRows('ร้าน A จริง', today);
    for (let i = 0; i < 2; i++) {
      const r = await call<{ rows: number }>('POST', '/api/sync/push', { tables, pending: 0, appVersion: '1.0.0' }, a.deviceToken);
      expect(r.status).toBe(200);
      expect(r.body.rows).toBe(9);
    }
    const unknown = await call('POST', '/api/sync/push', { tables: { refresh_tokens: { rows: [], deleted: [] } } }, a.deviceToken);
    expect(unknown.status).toBe(400);
    const noAuth = await call('POST', '/api/sync/push', { tables: {} }, 'nope');
    expect(noAuth.status).toBe(401);
    const schema = (await cloud.server.ctx.db.selectFrom('tenants').select('schema_name').where('id', '=', a.tenantId).executeTakeFirstOrThrow()).schema_name;
    const u = await cloud.server.ctx.tenantDb(schema).selectFrom('users').select(['password_hash', 'pin_hash']).executeTakeFirstOrThrow();
    expect(u).toEqual({ password_hash: '', pin_hash: '' });
    const n = await cloud.server.ctx.tenantDb(schema).selectFrom('sales').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    expect(Number(n?.n)).toBe(2);
  });

  it('shows the dashboard to the store manager with the same numbers as the POS', async () => {
    mgrA = await login('a@shop.test', 'password-a');
    const stores = await call<{ stores: { id: string; name: string; online: boolean }[] }>('GET', '/api/stores', undefined, mgrA);
    expect(stores.body.stores).toHaveLength(1);
    expect(stores.body.stores[0]).toMatchObject({ id: a.tenantId, name: 'ร้าน A จริง', online: true });
    const d = await call<{ kpis: { cur: { net: number; bills: number; avg: number } }; top: { name: string }[] }>('GET', `/api/stores/${a.tenantId}/dashboard?range=today`, undefined, mgrA);
    expect(d.status).toBe(200);
    expect(d.body.kpis.cur).toMatchObject({ net: 18000, bills: 2, avg: 9000 });
    expect(d.body.top[0]?.name).toBe('ลาเต้');
    const rep = await call<{ rows: { net: number }[] }>('GET', `/api/stores/${a.tenantId}/reports/sales?from=${today}&to=${today}&groupBy=day`, undefined, mgrA);
    expect(rep.body.rows[0]?.net).toBe(18000);
  });

  it('isolates stores: manager B cannot see or touch store A', async () => {
    mgrB = await login('b@shop.test', 'password-b');
    expect((await call('GET', `/api/stores/${a.tenantId}/dashboard`, undefined, mgrB)).status).toBe(404);
    expect((await call('GET', `/api/stores/${a.tenantId}/data/products`, undefined, mgrB)).status).toBe(404);
    expect((await call('POST', `/api/stores/${a.tenantId}/data/products`, { row: { name: 'hack' } }, mgrB)).status).toBe(404);
    expect((await call('GET', `/api/stores/${a.tenantId}/members`, undefined, mgrB)).status).toBe(404);
    const own = await call<{ kpis: { cur: { net: number } } }>('GET', `/api/stores/${b.tenantId}/dashboard`, undefined, mgrB);
    expect(own.body.kpis.cur.net).toBe(0);
    expect((await call('GET', '/api/admin/tenants', undefined, mgrB)).status).toBe(403);
  });

  it('lets a manager add a read-only viewer', async () => {
    const r = await call('POST', `/api/stores/${a.tenantId}/members`, { email: 'viewer@shop.test', name: 'Viewer', password: 'password-v', role: 'viewer' }, mgrA);
    expect(r.status).toBe(200);
    viewer = await login('viewer@shop.test', 'password-v');
    expect((await call('GET', `/api/stores/${a.tenantId}/dashboard`, undefined, viewer)).status).toBe(200);
    expect((await call('POST', `/api/stores/${a.tenantId}/data/products`, { row: { name: 'x' } }, viewer)).status).toBe(403);
    expect((await call('GET', `/api/stores/${a.tenantId}/members`, undefined, viewer)).status).toBe(403);
    expect((await call('GET', `/api/stores/${b.tenantId}/dashboard`, undefined, viewer)).status).toBe(404);
    // the last manager cannot be removed
    const me = (await call<{ members: { id: string; role: string }[] }>('GET', `/api/stores/${a.tenantId}/members`, undefined, mgrA)).body.members.find((m) => m.role === 'manager')!;
    expect((await call('DELETE', `/api/stores/${a.tenantId}/members/${me.id}`, undefined, mgrA)).status).toBe(400);
  });

  it('queues web edits of master data for the POS and tracks acknowledgements', async () => {
    const edit = await call<{ row: { price: number; name: string } }>('POST', `/api/stores/${a.tenantId}/data/products`, { row: { id: ids.product, price: 6500 } }, mgrA);
    expect(edit.status).toBe(200);
    expect(edit.body.row).toMatchObject({ price: 6500, name: 'ลาเต้' });
    expect((await call('POST', `/api/stores/${a.tenantId}/data/sales`, { row: { id: 'x' } }, mgrA)).status).toBe(403);
    // new rows take the POS column defaults (active = 1, show_in_pos = 1)
    const created = await call<{ row: { active: number; show_in_pos: number; id: string } }>('POST', `/api/stores/${a.tenantId}/data/categories`, { row: { name: 'ใหม่' } }, mgrA);
    expect(created.body.row).toMatchObject({ active: 1 });
    await call('DELETE', `/api/stores/${a.tenantId}/data/categories/${created.body.row.id}`, undefined, mgrA);
    const cmds = await call<{ commands: { id: string; seq: number; tbl: string; payload: { price: number } }[] }>('GET', '/api/sync/commands?after=0', undefined, a.deviceToken);
    expect(cmds.body.commands).toHaveLength(3);
    expect(cmds.body.commands[0]).toMatchObject({ tbl: 'products', payload: { price: 6500 } });
    expect((await call<{ commands: unknown[] }>('GET', '/api/sync/commands?after=0', undefined, b.deviceToken)).body.commands).toHaveLength(0);
    await call('POST', '/api/sync/commands/ack', { results: cmds.body.commands.map((c) => ({ id: c.id, ok: true })) }, a.deviceToken);
    expect((await call<{ commands: unknown[] }>('GET', '/api/sync/commands?after=0', undefined, a.deviceToken)).body.commands).toHaveLength(0);
    const list = await call<{ commands: { status: string }[] }>('GET', `/api/stores/${a.tenantId}/commands`, undefined, mgrA);
    expect(list.body.commands.every((c) => c.status === 'applied')).toBe(true);
  });

  it('gives the superadmin every store, the database and the logs', async () => {
    await addSuperadmin(cloud.server, 'root@cloud.test', 'password-root');
    root = await login('root@cloud.test', 'password-root');
    const tenants = await call<{ tenants: { id: string; managers: string[] }[] }>('GET', '/api/admin/tenants', undefined, root);
    expect(tenants.body.tenants).toHaveLength(2);
    expect((await call('GET', `/api/stores/${b.tenantId}/dashboard`, undefined, root)).status).toBe(200);
    const schemas = await call<{ schemas: { name: string }[] }>('GET', '/api/admin/db/schemas', undefined, root);
    expect(schemas.body.schemas).toHaveLength(3);
    const users = await call<{ rows: { password_hash: string }[] }>('GET', '/api/admin/db/rows?schema=public&table=cloud_users', undefined, root);
    expect(users.body.rows.every((r) => r.password_hash === '••••••')).toBe(true);
    const q = await call<{ rows: { n: number }[] }>('POST', '/api/admin/db/query', { sql: 'select count(*)::int as n from tenants' }, root);
    expect(q.body.rows[0]?.n).toBe(2);
    expect((await call('POST', '/api/admin/db/query', { sql: 'delete from tenants' }, root)).status).toBe(400);
    expect((await call('POST', '/api/admin/db/query', { sql: 'commit; delete from tenants' }, root)).status).toBe(400);
    const audit = await call<{ items: { action: string }[] }>('GET', '/api/admin/logs/audit', undefined, root);
    expect(audit.body.items.some((i) => i.action === 'data.upsert')).toBe(true);
    const ingest = await call<{ items: unknown[] }>('GET', '/api/admin/logs/ingest', undefined, root);
    expect(ingest.body.items.length).toBeGreaterThan(0);
  });

  it('suspends and deletes stores', async () => {
    await call('PATCH', `/api/admin/tenants/${b.tenantId}`, { status: 'suspended' }, root);
    expect((await call('POST', '/api/sync/push', { tables: {} }, b.deviceToken)).status).toBe(403);
    expect((await call('GET', `/api/stores/${b.tenantId}/dashboard`, undefined, mgrB)).status).toBe(403);
    expect((await call('DELETE', `/api/admin/tenants/${b.tenantId}`, undefined, root)).status).toBe(200);
    expect((await call('POST', '/api/sync/push', { tables: {} }, b.deviceToken)).status).toBe(401);
    expect((await call<{ stores: unknown[] }>('GET', '/api/stores', undefined, mgrB)).body.stores).toHaveLength(0);
  });
});
