// Bundle the server (incl. workspace packages) into dist/main.js; native modules stay external.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: false,
  define: { __FLEXPOS_EDITION__: JSON.stringify(process.env.FLEXPOS_EDITION ?? 'full') },
  external: ['better-sqlite3', 'pg', 'mysql2', '@napi-rs/canvas', '@node-rs/argon2', 'bonjour-service', 'exceljs', 'qrcode'],
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
});

// Thai fonts for bitmap receipt printing
const fontSrc = join(dirname(require.resolve('@fontsource/ibm-plex-sans-thai/package.json')), 'files');
mkdirSync('dist/fonts', { recursive: true });
for (const f of readdirSync(fontSrc)) if (/(thai|latin)-(400|700)-normal\.woff2$/.test(f) && !f.includes('latin-ext')) cpSync(join(fontSrc, f), join('dist/fonts', f));
console.log('server built → dist/main.js');
