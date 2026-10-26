import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The edition is fixed when @flexpos/shared loads, so switch it before importing the server.
process.env.FLEXPOS_EDITION = 'lite';
const { createTestApp } = await import('./helpers.js');
const { LicenseService, machineId } = await import('../src/services/license.js');
type TestApp = Awaited<ReturnType<typeof createTestApp>>;

function issue(privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'], payload: object) {
  const body = Buffer.from(JSON.stringify(payload));
  return `${body.toString('base64url')}.${sign(null, body, privateKey).toString('base64url')}`;
}

describe('FlexPOS Lite', () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await createTestApp({ kind: 'sqlite' }, 'grocery');
  });
  afterAll(async () => {
    await app.close();
  });

  it('has no restaurant API', async () => {
    expect((await app.call('GET', '/api/zones')).status).toBe(404);
    expect((await app.call('GET', '/api/floor')).status).toBe(404);
  });
  it('keeps locked modules off even when saved on', async () => {
    const r = await app.call<{ modules: Record<string, boolean> }>('PUT', '/api/settings', { modules: { restaurant: true, kitchenDisplay: true, promotions: true, stock: true } });
    expect(r.status).toBe(200);
    expect(r.body.modules).toMatchObject({ restaurant: false, kitchenDisplay: false, promotions: false, stock: true });
  });
  it('answers empty for promotions, modifiers and custom fields and refuses writes', async () => {
    for (const url of ['/api/promotions', '/api/modifier-groups', '/api/custom-fields']) expect((await app.call('GET', url)).body).toEqual([]);
    expect((await app.call('POST', '/api/promotions', { name: 'x' })).status).toBe(404);
    expect((await app.call('POST', '/api/roles', { code: 'x', name: 'x', permissions: [] })).status).toBe(404);
    expect((await app.call('POST', '/api/setup/client', { hostUrl: 'http://1.2.3.4:4100' })).status).toBe(404);
  });
  it('seeds grocery items with scale codes and uses the list checkout', async () => {
    const cat = await app.call<{ products: { sku: string; kind: string }[] }>('GET', '/api/catalog');
    expect(cat.body.products.find((p) => p.sku === '00123')?.kind).toBe('weighted');
    const s = await app.call<{ pos: { layout: string }; brand: { appName: string } }>('GET', '/api/settings');
    expect(s.body.pos.layout).toBe('list');
    expect(s.body.brand.appName).toBe('FlexPOS Lite');
  });
});

describe('FlexPOS Lite license', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const base = { licensee: 'ร้านชำ', maxDevices: 5, maxBranches: 3, issuedAt: new Date().toISOString(), expiresAt: null };
  const svc = () => new LicenseService(mkdtempSync(join(tmpdir(), 'lic-')), pem);

  it('trial allows one machine', () => {
    expect(svc().status().maxDevices).toBe(1);
  });
  it('accepts a lite key bound to this machine, capped at one device and branch', () => {
    const st = svc().activate(issue(privateKey, { ...base, plan: 'lite', machineId: machineId() }));
    expect(st.state).toBe('active');
    expect(st.maxDevices).toBe(1);
    expect(st.maxBranches).toBe(1);
  });
  it('refuses floating lite keys and full-edition keys', () => {
    expect(() => svc().activate(issue(privateKey, { ...base, plan: 'lite', machineId: '*' }))).toThrow();
    expect(() => svc().activate(issue(privateKey, { ...base, plan: 'pro', machineId: machineId() }))).toThrow();
  });
  it('accepts a cloud-issued lite key (the cloud allows one paired device)', () => {
    expect(svc().activate(issue(privateKey, { ...base, plan: 'lite', machineId: '*', licenseId: 'lic-1' })).state).toBe('active');
  });
});
