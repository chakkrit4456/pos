import { Fragment, createElement, type ReactNode } from 'react';
import { getLanguage, setLanguage, tParts, type Language } from '@flexpos/shared';

// Imported first by main.tsx so module-level t() calls already see the right language.
const KEY = 'flexpos.lang';

function stored(): Language {
  try {
    return localStorage.getItem(KEY) === 'en' ? 'en' : 'th';
  } catch {
    return 'th';
  }
}

setLanguage(stored());
document.documentElement.lang = getLanguage();

/** Switch the UI language. Strings are resolved at load time, so the page reloads. */
export function switchLanguage(lang: Language): void {
  if (lang === getLanguage()) return;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // private mode: the switch lasts for this load only
  }
  location.reload();
}

/** Translate a sentence whose placeholders may be React nodes. */
export function tn(key: string, ...args: ReactNode[]): ReactNode {
  const parts = tParts(key, args);
  if (parts.every((p) => typeof p === 'string' || typeof p === 'number')) return parts.join('');
  return parts.map((p, i) => createElement(Fragment, { key: i }, p));
}
