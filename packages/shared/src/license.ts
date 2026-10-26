/**
 * License keys are `base64url(payload).base64url(ed25519 signature)`. The vendor signs them
 * (FlexPOS Cloud admin or tools/license/issue.mjs); the POS and the cloud verify with this key.
 */
export const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA9k0NAwHSPaHeJ3o9W6GawY3qAWEjNxVrjjHSUAXNfOE=
-----END PUBLIC KEY-----`;

export interface LicensePayload {
  licensee: string;
  plan: string;
  maxDevices: number;
  maxBranches: number;
  /** machine id or "*" for floating licenses */
  machineId: string;
  issuedAt: string;
  expiresAt: string | null;
  /** set on keys issued from FlexPOS Cloud: the store this key belongs to on the cloud */
  licenseId?: string;
}
