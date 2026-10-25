import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Catalog } from '@flexpos/shared';
import { buildCloud, type CloudServer } from '../../cloud/src/app.js';
import { createTestApp, newId, type TestApp } from './helpers.js';

/** A POS and a FlexPOS Cloud server talking over real HTTP. */
describe('cloud sync end to end', () => {
  let pos: TestApp;
  let cloud: CloudServer;
  let cloudUrl = '';
  let catalog: Catalog;
  const dir = mkdtempSync(join(tmpdir(), 'flexpos-cloud-e2e-'));

  const startCloud = async () => {
    cloud = await buildCloud({ port: 0, host: '127.0.0.1', databaseUrl: `pglite:${join(dir, 'pg')}`, jwtSecret: 'y'.repeat(40), webDir: null, logFile: null, allowSignup: true, dataDir: dir }, { watchers: false });
    await cloud.app.listen({ port: 0, host: '127.0.0.1' });
    cloudUrl = `http://127.0.0.1:${(cloud.app.server.address() as AddressInfo).port}`;
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
    await startCloud();
    pos = await createTestApp();
    catalog = (await pos.call<Catalog>('GET', '/api/catalog')).body;
    await pos.call('POST', '/api/shifts/open', { openingCash: 100000 });
  }, 180_000);
  afterAll(async () => {
    await pos?.close();
    await cloud?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  let tenantId = '';
  let manager = '';

  it('connects from the POS settings and uploads the history', async () => {
    await sell('ครัวซองต์เนยสด');
    const r = await pos.call<{ tenantId: string; tenantName: string }>('POST', '/api/cloud/connect', { mode: 'self', url: cloudUrl, email: 'owner@shop.test', password: 'password123', createAccount: { name: 'เจ้าของ' } });
    expect(r.status).toBe(200);
    expect(r.body.tenantName).toBe('ร้านทดสอบ');
    tenantId = r.body.tenantId;
    const s = await pos.call<Status>('POST', '/api/cloud/sync-now');
    expect(s.body).toMatchObject({ connected: true, pending: 0, lastError: null });
  });

  it('shows the same dashboard on the web as on the POS', async () => {
    await sell('ครัวซองต์เนยสด');
    await pos.call('POST', '/api/cloud/sync-now');
    manager = (await web<{ accessToken: string }>('POST', '/api/auth/login', { email: 'owner@shop.test', password: 'password123' })).body.accessToken;
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
    manager = (await web<{ accessToken: string }>('POST', '/api/auth/login', { email: 'owner@shop.test', password: 'password123' })).body.accessToken;
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
