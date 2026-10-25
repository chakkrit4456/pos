import { EN } from './i18n-en.js';

export type Language = 'th' | 'en';

// Thai source text is the key; other languages map it. One language per process/tab.
// In a browser the saved choice is read here, before any module-level t() runs.
let current: Language = (() => {
  try {
    return globalThis.localStorage?.getItem('flexpos.lang') === 'en' ? 'en' : 'th';
  } catch {
    return 'th';
  }
})();

export function setLanguage(lang: Language): void {
  current = lang;
}

export function getLanguage(): Language {
  return current;
}

/** Look up the translation of a Thai key (surrounding whitespace is kept as-is). */
export function translate(key: string, lang: Language = current): string {
  if (lang === 'th') return key;
  const core = key.trim();
  const hit = EN[core];
  if (hit === undefined) return key;
  if (core === key) return hit;
  const lead = key.slice(0, key.indexOf(core));
  return lead + hit + key.slice(lead.length + core.length);
}

/** Translate and fill {0}, {1}… placeholders. */
export function t(key: string, ...args: unknown[]): string {
  const s = translate(key);
  return args.length ? s.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)] ?? '')) : s;
}

/** Translate into a list of parts, keeping non-string args (e.g. React nodes) as-is. */
export function tParts<T>(key: string, args: T[]): (string | T)[] {
  const out: (string | T)[] = [];
  const re = /\{(\d+)\}/g;
  const s = translate(key);
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push(args[Number(m[1])] as T);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

/** Translate every string inside a plain object (used for stored defaults such as settings). */
export function translateDeep<T>(value: T, lang: Language = current): T {
  if (lang === 'th') return value;
  if (typeof value === 'string') return translate(value, lang) as T;
  if (Array.isArray(value)) return value.map((v) => translateDeep(v, lang)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, translateDeep(v, lang)])) as T;
  }
  return value;
}
