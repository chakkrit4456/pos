#!/usr/bin/env node
// Build the Windows installers for each edition and pack them with their docs:
//   delivery/out/FlexPOS-v<version>.zip       full edition (restaurants, cafés, shops)
//   delivery/out/FlexPOS-Lite-v<version>.zip  Lite edition (grocery / convenience stores, one machine)
//
//   node tools/release/package.mjs [full|lite]   (default: both)
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

const EDITIONS = {
  full: {
    name: 'FlexPOS',
    docs: 'delivery/flexpos',
    env: {
      FLEXPOS_EDITION: 'full',
      FLEXPOS_PRODUCT_NAME: 'FlexPOS',
      FLEXPOS_DESCRIPTION: 'FlexPOS ระบบขายหน้าร้าน',
      FLEXPOS_ARTIFACT: 'FlexPOS-Setup',
      FLEXPOS_APP_ID: 'app.flexpos.pos',
    },
  },
  lite: {
    name: 'FlexPOS-Lite',
    docs: 'delivery/lite',
    env: {
      FLEXPOS_EDITION: 'lite',
      FLEXPOS_PRODUCT_NAME: 'FlexPOS Lite',
      FLEXPOS_DESCRIPTION: 'FlexPOS Lite ระบบขายหน้าร้านสำหรับร้านค้าและร้านขายของชำ',
      FLEXPOS_ARTIFACT: 'FlexPOS-Lite-Setup',
      FLEXPOS_APP_ID: 'app.flexpos.lite',
      VITE_DEFAULT_BUSINESS: 'grocery',
    },
  },
};

function run(cmd, env) {
  console.log(`\n> ${cmd}`);
  const r = spawnSync(cmd, { cwd: root, stdio: 'inherit', shell: true, env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`failed (${r.status}): ${cmd}`);
}

const pick = process.argv[2];
const wanted = pick ? [pick] : ['full', 'lite'];
for (const id of wanted) {
  const ed = EDITIONS[id];
  if (!ed) throw new Error(`unknown edition "${id}" (full | lite)`);
  console.log(`\n=== ${ed.name} ${version} ===`);
  const env = { ...ed.env, VITE_DEFAULT_LANG: 'th' };
  // VITE_DEFAULT_BUSINESS must not leak from one edition into the next.
  if (!env.VITE_DEFAULT_BUSINESS) env.VITE_DEFAULT_BUSINESS = '';
  run('corepack pnpm --filter @flexpos/web build', env);
  run('corepack pnpm --filter @flexpos/server build', env);
  run('corepack pnpm --filter @flexpos/desktop dist', env);

  const exe = join(root, 'apps/desktop/release', `${ed.env.FLEXPOS_ARTIFACT}.exe`);
  if (!existsSync(exe)) throw new Error(`installer not found: ${exe}`);
  const dir = join(root, 'delivery/out', `${ed.name}-v${version}`);
  const zip = `${dir}.zip`;
  rmSync(dir, { recursive: true, force: true });
  rmSync(zip, { force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(exe, join(dir, `${ed.env.FLEXPOS_ARTIFACT}.exe`));
  cpSync(join(root, ed.docs), dir, { recursive: true });
  run(`powershell -NoProfile -Command "Compress-Archive -Path '${dir}\\*' -DestinationPath '${zip}' -CompressionLevel Optimal"`, {});
  console.log(`packed → ${zip}`);
}
