/**
 * License keys issued from FlexPOS Cloud. A key is floating (machineId "*"), never expires and
 * carries a licenseId: the cloud maps that id to exactly one store and enforces the device limit.
 * Changing the limits re-signs the key; POS machines pick up the new key on their next sync.
 */
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { LITE_PLAN, t, type LicensePayload } from '@flexpos/shared';
import type { CloudContext } from './context.js';
import type { LicensesTable } from './schema.js';
import { nowIso, uuid } from './auth.js';
import { AppError, badRequest } from './errors.js';

export function signLicense(privateKeyPem: string, payload: LicensePayload): string {
  const body = Buffer.from(JSON.stringify(payload));
  return `${body.toString('base64url')}.${sign(null, body, createPrivateKey(privateKeyPem)).toString('base64url')}`;
}

export function decodeLicense(publicKeyPem: string, key: string): LicensePayload | null {
  const [p, s] = key.trim().split('.');
  if (!p || !s) return null;
  try {
    if (!verify(null, Buffer.from(p, 'base64url'), createPublicKey(publicKeyPem), Buffer.from(s, 'base64url'))) return null;
    return JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as LicensePayload;
  } catch {
    return null;
  }
}

function privateKey(ctx: CloudContext): string {
  if (!ctx.config.licensePrivateKey) throw new AppError(400, 'no_license_key', t('เซิร์ฟเวอร์นี้ไม่ได้ตั้งค่ากุญแจออก License (LICENSE_PRIVATE_KEY_FILE)'));
  return ctx.config.licensePrivateKey;
}

/** FlexPOS Lite is sold for a single machine and a single branch. */
const liteLimits = <T extends { plan: string; max_devices: number; max_branches: number }>(row: T): T =>
  row.plan === LITE_PLAN ? { ...row, max_devices: 1, max_branches: 1 } : row;

const payloadOf = (row: Pick<LicensesTable, 'id' | 'licensee' | 'plan' | 'max_devices' | 'max_branches'>): LicensePayload => ({
  licensee: row.licensee,
  plan: row.plan || 'standard',
  maxDevices: row.max_devices,
  maxBranches: row.max_branches,
  machineId: '*',
  issuedAt: nowIso(),
  expiresAt: null,
  licenseId: row.id,
});

export async function issueLicense(ctx: CloudContext, o: { licensee: string; plan: string; maxDevices: number; maxBranches: number; note?: string }) {
  const pem = privateKey(ctx);
  const row = liteLimits({ id: uuid(), tenant_id: null, licensee: o.licensee, plan: o.plan, max_devices: o.maxDevices, max_branches: o.maxBranches, note: o.note ?? '', revoked: 0, created_at: nowIso(), updated_at: nowIso() });
  const key = signLicense(pem, payloadOf(row));
  await ctx.db.insertInto('licenses').values({ ...row, key }).execute();
  return { ...row, key };
}

/** Apply new limits and re-sign. */
export async function updateLicense(ctx: CloudContext, id: string, patch: Partial<{ licensee: string; plan: string; maxDevices: number; maxBranches: number; note: string; revoked: boolean }>) {
  const cur = await ctx.db.selectFrom('licenses').selectAll().where('id', '=', id).executeTakeFirst();
  if (!cur) return null;
  const next = liteLimits({
    ...cur,
    licensee: patch.licensee ?? cur.licensee,
    plan: patch.plan ?? cur.plan,
    max_devices: patch.maxDevices ?? cur.max_devices,
    max_branches: patch.maxBranches ?? cur.max_branches,
    note: patch.note ?? cur.note,
    revoked: patch.revoked === undefined ? cur.revoked : patch.revoked ? 1 : 0,
    updated_at: nowIso(),
  });
  const limitsChanged = next.licensee !== cur.licensee || next.plan !== cur.plan || next.max_devices !== cur.max_devices || next.max_branches !== cur.max_branches;
  if (limitsChanged) next.key = signLicense(privateKey(ctx), payloadOf(next));
  await ctx.db.updateTable('licenses').set(next).where('id', '=', id).execute();
  return next;
}

/** Validate a key a POS presents. Returns its license row. */
export async function licenseForKey(ctx: CloudContext, key: string) {
  const p = decodeLicense(ctx.config.licensePublicKey, key);
  if (!p) throw badRequest(t('License key ไม่ถูกต้อง'));
  if (!p.licenseId) throw badRequest(t('License key นี้ไม่ได้ออกจาก FlexPOS Cloud กรุณาขอ key ใหม่จากผู้ให้บริการ'));
  const row = await ctx.db.selectFrom('licenses').selectAll().where('id', '=', p.licenseId).executeTakeFirst();
  if (!row || row.revoked === 1) throw new AppError(403, 'license_revoked', t('License key นี้ถูกยกเลิกแล้ว กรุณาติดต่อผู้ให้บริการ'));
  return row;
}
