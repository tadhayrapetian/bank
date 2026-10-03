/**
 * Internationalisation. Every interface string comes from a dictionary key.
 * English is the master dictionary (typed); Russian and Armenian mirror it.
 * New languages: add a dictionary to LANGUAGES — nothing else changes.
 */
import { en } from './en';
import { ru } from './ru';
import { hy } from './hy';
import { formatMoney } from '@/core/currency/format';
import type { Lang } from '@/core/types';

type Dict = typeof en;
type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never;
type Leaves<T> = T extends string ? '' : { [K in keyof T & string]: T[K] extends string ? K : Join<K, Leaves<T[K]>> }[keyof T & string];
export type TKey = Leaves<Dict>;

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends string ? string : DeepPartial<T[K]> };

export interface LanguageDef {
  code: Lang;
  name: string;
  nativeName: string;
  locale: string;
  dict: DeepPartial<Dict>;
}

export const LANGUAGES: LanguageDef[] = [
  { code: 'en', name: 'English', nativeName: 'English', locale: 'en-GB', dict: en },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', locale: 'ru-RU', dict: ru },
  { code: 'hy', name: 'Armenian', nativeName: 'Հայերեն', locale: 'hy-AM', dict: hy },
];

const flatCache = new Map<Lang, Map<string, string>>();

function flatten(obj: unknown, prefix = '', out = new Map<string, string>()) {
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'string') out.set(key, v);
      else flatten(v, key, out);
    }
  }
  return out;
}

function table(lang: Lang): Map<string, string> {
  let m = flatCache.get(lang);
  if (!m) {
    m = flatten(LANGUAGES.find((l) => l.code === lang)?.dict ?? en);
    flatCache.set(lang, m);
  }
  return m;
}

export function localeOf(lang: Lang): string {
  return LANGUAGES.find((l) => l.code === lang)?.locale ?? 'en-GB';
}

export function hasKey(key: string, lang: Lang = 'en') {
  return table(lang).has(key) || table('en').has(key);
}

export type Params = Record<string, string | number | undefined | null>;

export function translate(lang: Lang, key: string, params?: Params, fallback?: string): string {
  const raw = table(lang).get(key) ?? table('en').get(key) ?? fallback ?? key;
  if (!params) return raw;
  const locale = localeOf(lang);
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => {
    if (name === 'amount' && params.amt !== undefined && params.ccy) {
      return formatMoney(Number(params.amt), String(params.ccy), { locale });
    }
    const v = params[name];
    if (v === undefined || v === null) return m;
    if (typeof v === 'number') return new Intl.NumberFormat(locale).format(v);
    return String(v);
  });
}

/** Keys present in English but missing in another language (for the i18n audit). */
export function missingKeys(lang: Lang): string[] {
  const base = table('en');
  const other = flatten(LANGUAGES.find((l) => l.code === lang)?.dict ?? {});
  return [...base.keys()].filter((k) => !other.has(k));
}

export function allKeys(): string[] {
  return [...table('en').keys()];
}
