#!/usr/bin/env node
// Issue a FlexPOS license key (vendor only). Keep the private key secret and outside the repo.
//
//   node tools/license/issue.mjs --licensee "ร้านตัวอย่าง" --machine 8396-034B-E046-ED8E \
//        --plan pro --devices 5 --branches 3 --days 365 [--key .license-keys/private.pem]
//
// --machine "*" issues a floating key (any machine). Omit --days for a perpetual license.
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
if (!args.licensee || !args.machine) {
  console.error('ต้องระบุ --licensee และ --machine (ดู Machine ID ได้ที่ ตั้งค่า → License)');
  process.exit(1);
}
const keyFile = args.key ?? process.env.FLEXPOS_LICENSE_PRIVATE_KEY ?? '.license-keys/private.pem';
const payload = {
  licensee: args.licensee,
  plan: args.plan ?? 'standard',
  maxDevices: Number(args.devices ?? 3),
  maxBranches: Number(args.branches ?? 1),
  machineId: args.machine,
  issuedAt: new Date().toISOString(),
  expiresAt: args.days ? new Date(Date.now() + Number(args.days) * 86400_000).toISOString() : null,
};
const body = Buffer.from(JSON.stringify(payload));
const sig = sign(null, body, createPrivateKey(readFileSync(keyFile)));
console.log(`${body.toString('base64url')}.${sig.toString('base64url')}`);
