/** Money arithmetic & formatting in integer minor units, driven by the registry. */
import { currencies } from './registry';

export function pow10(n: number): number {
  return Math.pow(10, n);
}

/** Parse a user-entered decimal ("1 234,56" / "1234.56") to integer minor units. */
export function toMinor(value: number | string, code: string): number {
  const d = currencies.decimals(code);
  let num: number;
  if (typeof value === 'number') num = value;
  else {
    const cleaned = value.trim().replace(/[\s  ']/g, '');
    // treat the last ',' or '.' as decimal separator
    const lastSep = Math.max(cleaned.lastIndexOf(','), cleaned.lastIndexOf('.'));
    let normal = cleaned;
    if (lastSep >= 0) {
      const intPart = cleaned.slice(0, lastSep).replace(/[.,]/g, '');
      const frac = cleaned.slice(lastSep + 1);
      normal = `${intPart}.${frac}`;
    }
    num = Number(normal);
  }
  if (!Number.isFinite(num)) return NaN;
  const scaled = num * pow10(d);
  return Math.sign(scaled) * Math.round(Math.abs(scaled) + 1e-9);
}

export function fromMinor(minor: number, code: string): number {
  return minor / pow10(currencies.decimals(code));
}

/** Convert minor units between currencies with a given rate (target units per 1 source unit). */
export function convertMinor(minor: number, from: string, to: string, rate: number): number {
  const major = fromMinor(minor, from) * rate;
  return toMinor(Number(major.toFixed(currencies.decimals(to) + 2)), to);
}

const nfCache = new Map<string, Intl.NumberFormat>();

function nf(locale: string, digits: number, compact = false): Intl.NumberFormat {
  const key = `${locale}|${digits}|${compact}`;
  let f = nfCache.get(key);
  if (!f) {
    f = compact
      ? new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 })
      : new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    nfCache.set(key, f);
  }
  return f;
}

export interface MoneyFormatOptions {
  locale?: string;
  sign?: boolean; // always show +/−
  code?: boolean; // append ISO code instead of symbol
  compact?: boolean;
  hideSymbol?: boolean;
}

export function formatAmount(minor: number, code: string, locale = 'en-GB', compact = false): string {
  const d = currencies.decimals(code);
  return nf(locale, d, compact).format(Math.abs(minor) / pow10(d));
}

export function formatMoney(minor: number, code: string, opts: MoneyFormatOptions = {}): string {
  const locale = opts.locale ?? 'en-GB';
  const def = currencies.get(code);
  const num = formatAmount(minor, code, locale, opts.compact);
  const neg = minor < 0;
  const signStr = neg ? '−' : opts.sign && minor > 0 ? '+' : '';
  if (opts.hideSymbol) return `${signStr}${num}`;
  if (opts.code || !def) return `${signStr}${num} ${code}`;
  const sym = def.symbol;
  const tight = sym.length === 1 && def.position === 'prefix';
  return def.position === 'prefix'
    ? `${signStr}${sym}${tight ? '' : ' '}${num}`
    : `${signStr}${num} ${sym}`;
}

export function formatRate(rate: number): string {
  if (!Number.isFinite(rate) || rate === 0) return '—';
  const abs = Math.abs(rate);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 6 : 8;
  return rate.toFixed(digits);
}
