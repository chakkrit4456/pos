// Prepare a self-contained folder for electron-builder (pnpm workspaces and native modules
// do not mix well, so the app is packaged from a plain npm folder).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const stage = join(import.meta.dirname, 'stage');
const need = [join(root, 'apps/server/dist/main.js'), join(root, 'apps/web/dist/index.html')];
for (const f of need) if (!existsSync(f)) throw new Error(`Missing ${f} — run "pnpm build" first`);

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, 'src'), { recursive: true });
cpSync(join(import.meta.dirname, 'src'), join(stage, 'src'), { recursive: true });
cpSync(join(root, 'apps/web/public/icon-512.png'), join(stage, 'icon.png'));
// Server bundle lives next to node_modules so its native modules resolve.
cpSync(join(root, 'apps/server/dist'), join(stage, 'server'), { recursive: true });
cpSync(join(root, 'apps/web/dist'), join(stage, 'web'), { recursive: true });

const electronVersion = JSON.parse(readFileSync(join(import.meta.dirname, 'package.json'), 'utf8')).devDependencies.electron.replace('^', '');
// Editions (e.g. FlexPOS Dine, FlexPOS Lite) override the name, app id, installer file and installer language.
// A different appId lets FlexPOS Lite install next to FlexPOS; productName keeps their data folders apart.
const edition = {
  id: process.env.FLEXPOS_EDITION === 'lite' ? 'lite' : 'full',
  appId: process.env.FLEXPOS_APP_ID ?? 'app.flexpos.pos',
  productName: process.env.FLEXPOS_PRODUCT_NAME ?? 'FlexPOS',
  description: process.env.FLEXPOS_DESCRIPTION ?? 'FlexPOS ระบบขายหน้าร้าน',
  artifact: process.env.FLEXPOS_ARTIFACT ?? 'FlexPOS-Setup',
  nsisLanguage: process.env.FLEXPOS_NSIS_LANG ?? '1054',
};
const pkg = {
  name: 'flexpos',
  productName: edition.productName,
  version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
  description: edition.description,
  author: 'FlexPOS',
  type: 'module',
  main: 'src/main.mjs',
  flexposEdition: edition.id,
  // Native/runtime modules the bundled server loads.
  dependencies: {
    'better-sqlite3': '^12.2.0',
    pg: '^8.16.0',
    mysql2: '^3.14.1',
    '@napi-rs/canvas': '^0.1.71',
    '@node-rs/argon2': '^2.0.2',
    'bonjour-service': '^1.3.0',
    exceljs: '^4.4.0',
    qrcode: '^1.5.4',
  },
  devDependencies: { electron: electronVersion, 'electron-builder': '^26.0.12' },
  build: {
    appId: edition.appId,
    productName: edition.productName,
    directories: { output: '../release' },
    files: ['src/**', 'server/**', 'web/**', 'package.json', 'node_modules/**'],
    asar: false,
    npmRebuild: true,
    win: { target: 'nsis', icon: 'icon.png', artifactName: `${edition.artifact}.\${ext}` },
    nsis: { oneClick: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, shortcutName: edition.productName, language: edition.nsisLanguage },
  },
};
writeFileSync(join(stage, 'package.json'), JSON.stringify(pkg, null, 2));
console.log('staged →', stage);
