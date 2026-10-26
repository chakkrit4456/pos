import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LicenseService, machineId } from '../src/services/license.js';

function issue(privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'], payload: object) {
  const body = Buffer.from(JSON.stringify(payload));
  return `${body.toString('base64url')}.${sign(null, body, privateKey).toString('base64url')}`;
}

describe('license', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const base = { licensee: 'ร้านทดสอบ', plan: 'pro', maxDevices: 5, maxBranches: 3, issuedAt: new Date().toISOString(), expiresAt: null };

  it('starts in a 14-day trial', () => {
    const s = new LicenseService(mkdtempSync(join(tmpdir(), 'lic-')), pem).status();
    expect(s.state).toBe('trial');
    expect(s.daysLeft).toBe(14);
  });
  it('activates a key for this machine and rejects others or tampering', () => {
    const svc = new LicenseService(mkdtempSync(join(tmpdir(), 'lic-')), pem);
    expect(() => svc.activate(issue(privateKey, { ...base, machineId: 'AAAA-BBBB-CCCC-DDDD' }))).toThrow();
    const good = issue(privateKey, { ...base, machineId: machineId() });
    const [p, s] = good.split('.');
    const forged = Buffer.from(JSON.stringify({ ...base, machineId: '*', maxBranches: 99 })).toString('base64url') + '.' + s;
    expect(() => svc.activate(forged)).toThrow();
    expect(p).toBeTruthy();
    const st = svc.activate(good);
    expect(st.state).toBe('active');
    expect(st.maxBranches).toBe(3);
    expect(svc.canSell()).toBe(true);
  });
  it('full edition refuses FlexPOS Lite keys', () => {
    const svc = new LicenseService(mkdtempSync(join(tmpdir(), 'lic-')), pem);
    expect(() => svc.activate(issue(privateKey, { ...base, plan: 'lite', machineId: machineId() }))).toThrow(/Lite/);
  });
  it('expired keys block selling', () => {
    const svc = new LicenseService(mkdtempSync(join(tmpdir(), 'lic-')), pem);
    svc.activate(issue(privateKey, { ...base, machineId: '*', expiresAt: new Date(Date.now() - 86400_000).toISOString() }));
    expect(svc.status().state).toBe('expired');
    expect(svc.canSell()).toBe(false);
  });
});
