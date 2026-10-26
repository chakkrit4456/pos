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

  const login = async (username: string, password: string) => {
    const r = await call<Login>('POST', '/api/auth/login', { username, password });
    expect(r.status).toBe(200);
    return r.body.accessToken;
  };
  const issue = async (licensee: string, maxDevices: number) => (await call<{ id: string; key: string }>('POST', '/api/admin/licenses', { licensee, maxDevices }, root)).body;
  const reg = (licenseKey: string, machineId: string, storeName = 'x') => call<Reg>('POST', '/api/sync/register', { licenseKey, storeName, deviceName: machineId, machineId });
  let licA = { id: '', key: '' };

  beforeAll(async () => {
    cloud = await createCloud();
    call = cloud.call;
    await addSuperadmin(cloud.server, 'root@cloud.test', 'password-root');
    root = await login('root@cloud.test', 'password-root');
  }, 120_000);
  afterAll(async () => cloud?.close());

  it('creates a store only the first time a license key connects, then enforces its device limit', async () => {
    expect((await call('POST', '/api/admin/licenses', { licensee: 'x', maxDevices: 1 }, undefined)).status).toBe(401);
    licA = await issue('ร้าน A', 2);
    const r = await reg(licA.key, 'M-1', 'ร้าน A');
    expect(r.status).toBe(200);
    a = r.body;
    expect(a.deviceToken.length).toBeGreaterThan(20);
    // second machine with the same key joins the same store
    expect((await reg(licA.key, 'M-2')).body.tenantId).toBe(a.tenantId);
    // a reinstall on M-1 replaces its old slot instead of taking a new one
    const again = await reg(licA.key, 'M-1');
    expect(again.body.tenantId).toBe(a.tenantId);
    a = again.body;
    const full = await reg(licA.key, 'M-3');
    expect(full.status).toBe(403);
    // the limit can be raised later; the re-signed key reaches the POS on its next heartbeat
    await call('PATCH', `/api/admin/licenses/${licA.id}`, { maxDevices: 3 }, root);
    const hb = await call<{ licenseKey: string }>('POST', '/api/sync/heartbeat', {}, a.deviceToken);
    expect(hb.body.licenseKey).not.toBe(licA.key);
    expect(JSON.parse(Buffer.from(hb.body.licenseKey.split('.')[0]!, 'base64url').toString()).maxDevices).toBe(3);
    expect((await reg(licA.key, 'M-3')).status).toBe(200); // older keys of the same license still identify the store
    // keys must be signed by the cloud and carry a license id
    expect((await reg('garbage.key.value-0123456789', 'M-9')).status).toBe(400);
    const { signLicense } = await import('../src/licenses.js');
    const foreign = signLicense(cloud.keys.privateKey, { licensee: 'x', plan: 'pro', maxDevices: 9, maxBranches: 1, machineId: '*', issuedAt: '', expiresAt: null });
    expect((await reg(foreign, 'M-9')).status).toBe(400);
    // no accounts are ever created from a POS
    expect((await call('POST', '/api/sync/register', { email: 'a@shop.test', password: 'password-a', createAccount: { name: 'x' }, storeName: 'x', deviceName: 'x' })).status).toBe(400);
    const licB = await issue('ร้าน B', 1);
    b = (await reg(licB.key, 'B-1', 'ร้าน B')).body;
    expect(b.tenantId).not.toBe(a.tenantId);
    // revoking a license blocks new machines
    await call('PATCH', `/api/admin/licenses/${licB.id}`, { revoked: true }, root);
    expect((await reg(licB.key, 'B-2')).status).toBe(403);
  });

  it('only the superadmin creates manager accounts', async () => {
    for (const [tid, user, pw] of [[a.tenantId, 'mgr-a', 'password-a'], [b.tenantId, 'mgr-b', 'password-b']] as const) {
      const u = await call<{ id: string }>('POST', '/api/admin/users', { username: user, name: user, password: pw }, root);
      expect(u.status).toBe(200);
      expect((await call('PUT', `/api/admin/users/${u.body.id}/memberships`, { tenantId: tid, role: 'manager' }, root)).status).toBe(200);
    }
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
    mgrA = await login('mgr-a', 'password-a');
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
    mgrB = await login('mgr-b', 'password-b');
    expect((await call('GET', `/api/stores/${a.tenantId}/dashboard`, undefined, mgrB)).status).toBe(404);
    expect((await call('GET', `/api/stores/${a.tenantId}/data/products`, undefined, mgrB)).status).toBe(404);
    expect((await call('POST', `/api/stores/${a.tenantId}/data/products`, { row: { name: 'hack' } }, mgrB)).status).toBe(404);
    expect((await call('GET', `/api/stores/${a.tenantId}/members`, undefined, mgrB)).status).toBe(404);
    const own = await call<{ kpis: { cur: { net: number } } }>('GET', `/api/stores/${b.tenantId}/dashboard`, undefined, mgrB);
    expect(own.body.kpis.cur.net).toBe(0);
    expect((await call('GET', '/api/admin/tenants', undefined, mgrB)).status).toBe(403);
  });

  it('lets a manager manage view-only staff of their own store, and nothing more', async () => {
    const r = await call<{ userId: string }>('POST', `/api/stores/${a.tenantId}/members`, { username: 'cashier1', name: 'แคชเชียร์', password: 'password-v' }, mgrA);
    expect(r.status).toBe(200);
    viewer = await login('cashier1', 'password-v');
    expect((await call('GET', `/api/stores/${a.tenantId}/dashboard`, undefined, viewer)).status).toBe(200);
    expect((await call('POST', `/api/stores/${a.tenantId}/data/products`, { row: { name: 'x' } }, viewer)).status).toBe(403);
    expect((await call('GET', `/api/stores/${a.tenantId}/members`, undefined, viewer)).status).toBe(403);
    expect((await call('GET', `/api/stores/${b.tenantId}/dashboard`, undefined, viewer)).status).toBe(404);
    // managers cannot add or promote managers, nor touch accounts they don't own
    expect((await call('POST', `/api/stores/${a.tenantId}/members`, { username: 'boss2', name: 'x', password: 'password-x', role: 'manager' }, mgrA)).status).toBe(403);
    expect((await call('PATCH', `/api/stores/${a.tenantId}/members/${r.body.userId}`, { role: 'manager' }, mgrA)).status).toBe(403);
    expect((await call('POST', `/api/stores/${a.tenantId}/members`, { username: 'mgr-b', name: 'x' }, mgrA)).status).toBe(409);
    const me = (await call<{ members: { id: string; role: string }[] }>('GET', `/api/stores/${a.tenantId}/members`, undefined, mgrA)).body.members.find((m) => m.role === 'manager')!;
    expect((await call('PATCH', `/api/stores/${a.tenantId}/members/${me.id}`, { name: 'x' }, mgrA)).status).toBe(403);
    expect((await call('DELETE', `/api/stores/${a.tenantId}/members/${me.id}`, undefined, mgrA)).status).toBe(403);
    // edit staff: rename, new password
    expect((await call('PATCH', `/api/stores/${a.tenantId}/members/${r.body.userId}`, { username: 'cashier-a', password: 'password-v2' }, mgrA)).status).toBe(200);
    viewer = await login('cashier-a', 'password-v2');
    // a manager changes their own username and password
    expect((await call('PUT', '/api/auth/username', { username: 'boss-a', password: 'wrong' }, mgrA)).status).toBe(400);
    expect((await call('PUT', '/api/auth/username', { username: 'boss-a', password: 'password-a' }, mgrA)).status).toBe(200);
    mgrA = await login('boss-a', 'password-a');
    // deleting staff removes their account
    const tmp = await call<{ userId: string }>('POST', `/api/stores/${a.tenantId}/members`, { username: 'temp-staff', name: 't', password: 'password-t' }, mgrA);
    expect((await call('DELETE', `/api/stores/${a.tenantId}/members/${tmp.body.userId}`, undefined, mgrA)).status).toBe(200);
    expect((await call('POST', '/api/auth/login', { username: 'temp-staff', password: 'password-t' })).status).toBe(401);
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

describe('FlexPOS Cloud on a store\'s own server (no license signing key)', () => {
  it('pairs with a manager account the superadmin created; the store is created once', async () => {
    const cloud = await createCloud({ licenses: false });
    try {
      await addSuperadmin(cloud.server, 'root', 'password-root');
      const root = (await cloud.call<{ accessToken: string }>('POST', '/api/auth/login', { username: 'root', password: 'password-root' })).body.accessToken;
      await cloud.call('POST', '/api/admin/users', { username: 'owner', name: 'Owner', password: 'password-o' }, root);
      const reg = (password: string) => cloud.call<{ tenantId: string }>('POST', '/api/sync/register', { username: 'owner', password, storeName: 'ร้านของฉัน', deviceName: 'POS' });
      expect((await reg('wrong-pass')).status).toBe(401);
      const first = await reg('password-o');
      expect(first.status).toBe(200);
      expect((await reg('password-o')).body.tenantId).toBe(first.body.tenantId);
      expect((await cloud.call<{ tenants: unknown[] }>('GET', '/api/admin/tenants', undefined, root)).body.tenants).toHaveLength(1);
      expect((await cloud.call('POST', '/api/admin/licenses', { licensee: 'x', maxDevices: 1 }, root)).status).toBe(400);
    } finally {
      await cloud.close();
    }
  });
});
