// Two languages: Thai (the source text in the code) and English.
// Every user-facing string is written as t('ข้อความไทย') — Thai is the key, en.ts holds the English.
// Placeholders: t('เล่น {0} ห้อง', n). The language is read once at start-up; switching reloads the window.
import { EN } from './en';

export type Lang = 'th' | 'en';
const KEY = 'drumduino.lang';

function initial(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'th' || v === 'en') return v;
  } catch {
    /* ignore */
  }
  return 'th'; // Thai until the user picks EN in the top bar
}

export const lang: Lang = initial();

export function setLang(l: Lang) {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* ignore */
  }
  location.reload();
}

export function t(th: string, ...args: unknown[]): string {
  let s = lang === 'en' ? EN[th] ?? th : th;
  if (args.length) s = s.replace(/\{(\d+)\}/g, (m: string, i: string) => (Number(i) < args.length ? String(args[Number(i)]) : m));
  return s;
}
if (typeof document !== 'undefined') document.documentElement.lang = lang;
