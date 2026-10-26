import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Catalog } from '@flexpos/shared';
import { buildCloud, type CloudServer } from '../../cloud/src/app.js';
import { licenseKeys } from '../../cloud/test/helpers.js';
import { createTestApp, newId, type TestApp } from './helpers.js';

/** A POS and a FlexPOS Cloud server talking over real HTTP. */
describe('cloud sync end to end', () => {
  let pos: TestApp;
  let cloud: CloudServer;
  let cloudUrl = '';
  let catalog: Catalog;
  const dir = mkdtempSync(join(tmpdir(), 'flexpos-cloud-e2e-'));
  const keys = licenseKeys();
  let root = '';

  const startCloud = async () => {
    cloud = await buildCloud({ port: 0, host: '127.0.0.1', databaseUrl: `pglite:${join(dir, 'pg')}`, jwtSecret: 'y'.repeat(40), webDir: null, logFile: null, licensePrivateKey: keys.privateKey, licensePublicKey: keys.publicKey, dataDir: dir }, { watchers: false });
    await cloud.app.listen({ port: 0, host: '127.0.0.1' });
    cloudUrl = `http://127.0.0.1:${(cloud.app.server.address() as AddressInfo).port}`;
    process.env.FLEXPOS_CLOUD_URL = cloudUrl;
  };
  const web = async <T>(method: string, path: string, body?: unknown, token?: string) => {
    const r = await fetch(cloudUrl + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: (await r.json()) as T };
  };
  const sell = async (name: string) => {
    const p = catalog.products.find((x) => x.name === name)!;
    const r = await pos.call('POST', '/api/sales', { id: newId(), lines: [{ id: 'a', productId: p.id, name: p.name, qty: 1, unitPrice: p.price }], payments: [{ methodCode: 'cash', amount: 100000 }] });
    expect(r.status).toBe(200);
  };
  type Status = { pending: number; connected: boolean; lastError: string | null; tenantId: string };

  beforeAll(async () => {
    process.env.FLEXPOS_LICENSE_PUBKEY = keys.publicKey;
    await startCloud();
    const { addSuperadmin } = await import('../../cloud/test/helpers.js');
    await addSuperadmin(cloud, 'root', 'password-root');
    root = (await web<{ accessToken: string }>('POST', '/api/auth/login', { username: 'root', password: 'password-root' })).body.accessToken;
    pos = await createTestApp();
    catalog = (await pos.call<Catalog>('GET', '/api/catalog')).body;
    await pos.call('POST', '/api/shifts/open', { openingCash: 100000 });
  }, 180_000);
  afterAll(async () => {
    await pos?.close();
    await cloud?.close();
    rmSync(dir, { recursive: true, force: true });
    delete process.env.FLEXPOS_LICENSE_PUBKEY;
    delete process.env.FLEXPOS_CLOUD_URL;
  });

  let tenantId = '';
  let manager = '';

  it('connects to FlexPOS Cloud with the license key the superadmin issued, and uploads the history', async () => {
    await sell('ครัวซองต์เนยสด');
    expect((await pos.call('POST', '/api/cloud/connect', { mode: 'cloud' })).status).toBe(400); // trial: no key yet
    const lic = (await web<{ id: string; key: string }>('POST', '/api/admin/licenses', { licensee: 'ร้านทดสอบ', maxDevices: 2 }, root)).body;
    const r = await pos.call<{ tenantId: string; tenantName: string }>('POST', '/api/cloud/connect', { mode: 'cloud', licenseKey: lic.key });
    expect(r.status).toBe(200);
    expect(r.body.tenantName).toBe('ร้านทดสอบ');
    tenantId = r.body.tenantId;
    expect((await pos.call<{ state: string; maxDevices: number }>('GET', '/api/license')).body).toMatchObject({ state: 'active', maxDevices: 2 });
    // the manager account comes from the superadmin
    const u = (await web<{ id: string }>('POST', '/api/admin/users', { username: 'owner@shop.test', name: 'เจ้าของ', password: 'password123' }, root)).body;
    await web('PUT', `/api/admin/users/${u.id}/memberships`, { tenantId, role: 'manager' }, root);
    // raising the device limit on the web reaches the POS license on the next sync
    await web('PATCH', `/api/admin/licenses/${lic.id}`, { maxDevices: 4 }, root);
    const s = await pos.call<Status>('POST', '/api/cloud/sync-now');
    expect(s.body).toMatchObject({ connected: true, pending: 0, lastError: null });
    expect((await pos.call<{ maxDevices: number }>('GET', '/api/license')).body.maxDevices).toBe(4);
  });

  it('shows the same dashboard on the web as on the POS', async () => {
    await sell('ครัวซองต์เนยสด');
    await pos.call('POST', '/api/cloud/sync-now');
    manager = (await web<{ accessToken: string }>('POST', '/api/auth/login', { username: 'owner@shop.test', password: 'password123' })).body.accessToken;
    type Dash = { kpis: { cur: { net: number; bills: number } }; top: { name: string }[] };
    const local = (await pos.call<Dash>('GET', '/api/reports/dashboard?range=today')).body;
    const remote = (await web<Dash>('GET', `/api/stores/${tenantId}/dashboard?range=today`, undefined, manager)).body;
    expect(local.kpis.cur.bills).toBe(2);
    expect(remote.kpis).toEqual(local.kpis);
    expect(remote.top).toEqual(local.top);
  });

  it('never uploads password or PIN hashes', async () => {
    const schema = (await cloud.ctx.db.selectFrom('tenants').select('schema_name').where('id', '=', tenantId).executeTakeFirstOrThrow()).schema_name;
    const users = await cloud.ctx.tenantDb(schema).selectFrom('users').select(['password_hash', 'pin_hash']).execute();
    expect(users.length).toBeGreaterThan(0);
    for (const u of users) expect(u).toEqual({ password_hash: '', pin_hash: '' });
  });

  it('applies a price change made on the web to the POS', async () => {
    const p = catalog.products.find((x) => x.name === 'ครัวซองต์เนยสด')!;
    const r = await web('POST', `/api/stores/${tenantId}/data/products`, { row: { id: p.id, price: p.price + 500 } }, manager);
    expect(r.status).toBe(200);
    await pos.call('POST', '/api/cloud/sync-now');
    const after = (await pos.call<Catalog>('GET', '/api/catalog')).body.products.find((x) => x.id === p.id)!;
    expect(after.price).toBe(p.price + 500);
    const cmds = (await web<{ commands: { status: string }[] }>('GET', `/api/stores/${tenantId}/commands`, undefined, manager)).body.commands;
    expect(cmds[0]?.status).toBe('applied');
  });

  it('keeps selling while the cloud is down and catches up afterwards', async () => {
    await cloud.close();
    await sell('ครัวซองต์เนยสด');
    const down = await pos.call<Status>('POST', '/api/cloud/sync-now');
    expect(down.body.pending).toBeGreaterThan(0);
    expect(down.body.lastError).toBeTruthy();
    await startCloud(); // same data directory, new port
    pos.server.ctx.config.cloud!.url = cloudUrl;
    const up = await pos.call<Status>('POST', '/api/cloud/sync-now');
    expect(up.body).toMatchObject({ pending: 0, lastError: null });
    manager = (await web<{ accessToken: string }>('POST', '/api/auth/login', { username: 'owner@shop.test', password: 'password123' })).body.accessToken;
    const remote = (await web<{ kpis: { cur: { bills: number } } }>('GET', `/api/stores/${tenantId}/dashboard?range=today`, undefined, manager)).body;
    expect(remote.kpis.cur.bills).toBe(3);
  });

  it('stops capturing changes when switched to local only', async () => {
    expect((await pos.call('POST', '/api/cloud/local')).status).toBe(200);
    await sell('ครัวซองต์เนยสด');
    const s = await pos.call<Status>('GET', '/api/cloud/status');
    expect(s.body).toMatchObject({ connected: false, pending: 0 });
  });
});
