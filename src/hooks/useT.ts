import { useCallback } from 'react';
import { useUI } from '@/state/ui';
import { translate, localeOf, type TKey, type Params } from '@/i18n';
import { formatMoney, formatRate } from '@/core/currency/format';
import { toBase } from '@/core/currency/rates';

export function useT() {
  const lang = useUI((s) => s.lang);
  const t = useCallback((key: TKey, params?: Params) => translate(lang, key, params), [lang]);
  /** Dynamic key (status/enum lookups). Falls back to `fallback` or the raw key. */
  const tx = useCallback((key: string, params?: Params, fallback?: string) => translate(lang, key, params, fallback), [lang]);
  return { t, tx, lang };
}

export function useFmt() {
  const lang = useUI((s) => s.lang);
  const base = useUI((s) => s.baseCurrency);
  const hidden = useUI((s) => s.balancesHidden);
  const locale = localeOf(lang);
  return {
    locale,
    base,
    hidden,
    money: (minor: number, ccy: string, opts: { sign?: boolean; code?: boolean; compact?: boolean; mask?: boolean } = {}) =>
      opts.mask && hidden ? '••••••' : formatMoney(minor, ccy, { locale, sign: opts.sign, code: opts.code, compact: opts.compact }),
    inBase: (minor: number, ccy: string) => toBase(minor, ccy, base),
    num: (n: number, digits = 0) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n),
    pct: (n: number, digits = 2) => `${new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n)}%`,
    rate: (r: number) => formatRate(r),
    date: (iso?: string) => (iso ? new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso)) : '—'),
    dateLong: (iso?: string) => (iso ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso)) : '—'),
    dateTime: (iso?: string) => (iso ? new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(iso)) : '—'),
    time: (iso?: string) => (iso ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' }).format(new Date(iso)) : '—'),
    month: (key: string) => new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(key + '-01T00:00:00Z')),
    rel: (iso: string, nowMs: number) => {
      const diff = (Date.parse(iso) - nowMs) / 1000;
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
      const abs = Math.abs(diff);
      if (abs < 60) return rtf.format(Math.round(diff), 'second');
      if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
      if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
      if (abs < 86400 * 45) return rtf.format(Math.round(diff / 86400), 'day');
      return rtf.format(Math.round(diff / (86400 * 30)), 'month');
    },
  };
}
