// Lists Thai keys used in t()/tn()/translate() that have no English entry.
// Run: node tools/i18n/missing.mjs [--json]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dirs = ['apps/web/src', 'apps/server/src', 'apps/cloud/src', 'apps/cloud-web/src', 'packages/shared/src', 'packages/reports/src'];
const call = /\b(?:t|tn|translate)\(\s*'((?:[^'\\]|\\.)*)'/g;
const thai = /[฀-๿]/;

function* files(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.tsx?$/.test(f) && !/\.test\./.test(f) && !/i18n-en\.ts$/.test(f)) yield p;
  }
}

const unescape = (s) => s.replace(/\\n/g, '\n').replace(/\\(.)/g, '$1');
const used = new Set();
for (const d of dirs) {
  for (const f of files(join(root, d))) {
    for (const m of readFileSync(f, 'utf8').matchAll(call)) {
      const k = unescape(m[1]).trim();
      if (thai.test(k)) used.add(k);
    }
  }
}

const en = readFileSync(join(root, 'packages/shared/src/i18n-en.ts'), 'utf8');
const have = new Set([...en.matchAll(/^\s*'((?:[^'\\]|\\.)*)':/gm)].map((m) => unescape(m[1])));
const missing = [...used].filter((k) => !have.has(k)).sort();
if (process.argv.includes('--json')) console.log(JSON.stringify(missing, null, 1));
else {
  for (const k of missing) console.log(k);
  console.error(`${missing.length} missing of ${used.size} keys`);
}
process.exitCode = missing.length ? 1 : 0;
