import { createHash, createPublicKey, verify } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { LICENSE_PUBLIC_KEY, type LicensePayload, type LicenseStatus } from '@flexpos/shared';
import { t } from '@flexpos/shared';

/**
 * Offline licensing: a license key is `base64url(payload).base64url(ed25519 signature)`.
 * The vendor signs keys with the private key (tools/license/issue.mjs); the app only holds the public key.
 * Swap this module to change the licensing method.
 */
export { LICENSE_PUBLIC_KEY, type LicensePayload };

const TRIAL_DAYS = 14;

export function machineId(): string {
  const macs = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && !i.internal && i.mac && i.mac !== '00:00:00:00:00:00')
    .map((i) => i!.mac)
    .sort();
  const raw = `${hostname()}|${cpus()[0]?.model ?? ''}|${macs[0] ?? ''}`;
  const h = createHash('sha256').update(raw).digest('hex').toUpperCase();
  return `${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}`;
}

export function decodeLicense(key: string, publicKeyPem = LICENSE_PUBLIC_KEY): LicensePayload | null {
  const [p, s] = key.trim().split('.');
  if (!p || !s) return null;
  try {
    const ok = verify(null, Buffer.from(p, 'base64url'), createPublicKey(publicKeyPem), Buffer.from(s, 'base64url'));
    if (!ok) return null;
    return JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as LicensePayload;
  } catch {
    return null;
  }
}

export class LicenseService {
  private readonly keyFile: string;
  private readonly trialFile: string;
  constructor(
    dataDir: string,
    private readonly publicKeyPem = process.env.FLEXPOS_LICENSE_PUBKEY ?? LICENSE_PUBLIC_KEY,
  ) {
    this.keyFile = join(dataDir, 'license.key');
    this.trialFile = join(dataDir, '.trial');
    if (!existsSync(this.trialFile)) writeFileSync(this.trialFile, new Date().toISOString());
  }

  status(): LicenseStatus {
    const mid = machineId();
    if (existsSync(this.keyFile)) {
      const payload = decodeLicense(readFileSync(this.keyFile, 'utf8'), this.publicKeyPem);
      if (!payload || (payload.machineId !== '*' && payload.machineId !== mid)) {
        return { state: 'invalid', plan: '', maxDevices: 0, maxBranches: 0, daysLeft: null, licensee: null, machineId: mid };
      }
      const daysLeft = payload.expiresAt ? Math.ceil((new Date(payload.expiresAt).getTime() - Date.now()) / 86400_000) : null;
      return {
        state: daysLeft !== null && daysLeft < 0 ? 'expired' : 'active',
        plan: payload.plan,
        maxDevices: payload.maxDevices,
        maxBranches: payload.maxBranches,
        daysLeft,
        licensee: payload.licensee,
        machineId: mid,
      };
    }
    const started = new Date(readFileSync(this.trialFile, 'utf8').trim()).getTime() || Date.now();
    const daysLeft = TRIAL_DAYS - Math.floor((Date.now() - started) / 86400_000);
    return {
      state: daysLeft >= 0 ? 'trial' : 'expired',
      plan: 'trial',
      maxDevices: 3,
      maxBranches: 1,
      daysLeft: Math.max(daysLeft, 0),
      licensee: null,
      machineId: mid,
    };
  }

  activate(key: string): LicenseStatus {
    const payload = decodeLicense(key, this.publicKeyPem);
    if (!payload) throw new Error(t('License key ไม่ถูกต้อง'));
    if (payload.machineId !== '*' && payload.machineId !== machineId())
      throw new Error(t('License key นี้ออกให้เครื่องอื่น กรุณาส่ง Machine ID ของเครื่องนี้ให้ผู้ขาย'));
    writeFileSync(this.keyFile, key.trim());
    return this.status();
  }

  /** The installed key as entered, or null on trial. */
  key(): string | null {
    return existsSync(this.keyFile) ? readFileSync(this.keyFile, 'utf8').trim() : null;
  }

  canSell(): boolean {
    const s = this.status().state;
    return s === 'trial' || s === 'active';
  }
}
