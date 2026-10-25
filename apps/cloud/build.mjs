// Bundle FlexPOS Cloud (incl. workspace packages) into dist/main.js; native/wasm modules stay external.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync } from 'node:fs';

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: false,
  external: ['better-sqlite3', 'pg', 'mysql2', '@node-rs/argon2', '@electric-sql/pglite'],
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
});

// Ship the web dashboard next to the server when it has been built.
if (existsSync('../cloud-web/dist/index.html')) {
  mkdirSync('dist/web', { recursive: true });
  cpSync('../cloud-web/dist', 'dist/web', { recursive: true });
}
console.log('cloud built → dist/main.js');
