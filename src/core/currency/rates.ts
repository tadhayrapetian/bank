/**
 * FX rate engine (DEMONSTRATION DATA).
 * Each currency has an anchor rate (units per 1 USD) stored in the database.
 * Effective rates drift deterministically with bank time using a sum of
 * seeded sinusoids + hashed noise, so quotes, charts and history agree, and
 * advancing the Exchequer clock moves the market. No real market feed.
 */
import { currencies } from './registry';
import { hashSeed, prng } from '../util/random';
import { getSettings } from '../settings';
import { nowMs } from '../clock';
import { convertMinor, toMinor } from './format';
import type { RateRecord } from '../types';

const PEGGED = new Set([
  'USD', 'AED', 'SAR', 'BHD', 'OMR', 'QAR', 'JOD', 'BMD', 'BSD', 'PAB', 'XCD', 'BBD', 'BZD', 'AWG', 'XCG', 'DJF',
  'ERN', 'HKD', 'KYD', 'USN', 'CUC', 'ANG', 'BAM', 'XAF', 'XOF', 'KMF', 'XPF', 'CHE', 'NAD', 'LSL', 'SZL', 'BTN', 'MOP',
  'FKP', 'GIP', 'SHP', 'CUP', 'TMT',
]);
const MAJORS = new Set(['USD', 'EUR', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK', 'CNY', 'SGD', 'HKD', 'CRWN']);
// Currencies pegged to EUR (move with EUR)
const EUR_PEG: Record<string, number> = { BAM: 1.95583, XAF: 655.957, XOF: 655.957, KMF: 491.96775, XPF: 119.33174, CHE: 1 };

let anchors = new Map<string, { perUSD: number; at: number; source: RateRecord['source'] }>();

export function loadAnchors(rows: RateRecord[]) {
  const m = new Map<string, { perUSD: number; at: number; source: RateRecord['source'] }>();
  for (const c of currencies.all()) {
    if (c.defaultPerUSD != null) m.set(c.code, { perUSD: c.defaultPerUSD, at: 0, source: 'demo' });
  }
  for (const r of rows) m.set(r.code, { perUSD: r.perUSD, at: Date.parse(r.updatedAt), source: r.source });
  anchors = m;
}

export function anchorOf(code: string) {
  return anchors.get(code);
}

function volatility(code: string): number {
  const def = currencies.get(code);
  if (!def) return 0;
  if (code === 'USD') return 0;
  if (PEGGED.has(code)) return 0.0015;
  if (def.kind === 'magical') return 0.11;
  if (def.kind === 'metal') return 0.13;
  if (MAJORS.has(code)) return 0.045;
  if (def.kind === 'fund') return 0.02;
  return 0.075;
}

const HOUR = 3_600_000;
const COMPONENTS = [
  { period: 2.1 * 365 * 24, weight: 1.0 },
  { period: 0.7 * 365 * 24, weight: 0.65 },
  { period: 70 * 24, weight: 0.4 },
  { period: 19 * 24, weight: 0.26 },
  { period: 5.3 * 24, weight: 0.15 },
  { period: 26, weight: 0.08 },
  { period: 7.5, weight: 0.045 },
];

const phaseCache = new Map<string, number[]>();
function phases(code: string): number[] {
  let p = phaseCache.get(code);
  if (!p) {
    const r = prng(hashSeed(code));
    p = COMPONENTS.map(() => r() * Math.PI * 2);
    phaseCache.set(code, p);
  }
  return p;
}

/** Log-deviation of the currency at time t (ms). Deterministic. */
function logDrift(code: string, t: number): number {
  if (code === 'USD') return 0;
  const vol = volatility(code);
  if (!vol) return 0;
  const h = t / HOUR;
  const ph = phases(code);
  let s = 0;
  for (let i = 0; i < COMPONENTS.length; i++) {
    const c = COMPONENTS[i];
    s += c.weight * Math.sin((2 * Math.PI * h) / c.period + ph[i]);
  }
  // hashed hourly noise for texture
  const noise = (prng(hashSeed(code + ':' + Math.floor(h)))() - 0.5) * 0.06;
  return vol * 0.55 * (s + noise);
}

/** Units of `code` per 1 USD at time t. */
export function perUSDAt(code: string, t: number = nowMs()): number {
  if (code === 'USD') return 1;
  const pegBase = EUR_PEG[code];
  if (pegBase) return perUSDAt('EUR', t) * pegBase;
  const a = anchors.get(code);
  if (!a) return NaN;
  if (a.source === 'manual' || a.source === 'live') {
    // manual/live anchors drift only from their set time
    return a.perUSD * Math.exp(logDrift(code, t) - logDrift(code, a.at));
  }
  return a.perUSD * Math.exp(logDrift(code, t) - logDrift(code, nowAnchor()));
}

// Demo anchors are calibrated to "today" so default rates stay realistic at the current date.
let anchorEpoch = Date.UTC(2026, 9, 1);
function nowAnchor() {
  return anchorEpoch;
}
export function setAnchorEpoch(ms: number) {
  anchorEpoch = ms;
}

export function hasRate(code: string): boolean {
  return Number.isFinite(perUSDAt(code));
}

/** Mid-market rate: units of `to` per 1 unit of `from`. */
export function midRate(from: string, to: string, t: number = nowMs()): number {
  if (from === to) return 1;
  return perUSDAt(to, t) / perUSDAt(from, t);
}

export function spreadPct(from: string, to: string): number {
  const s = getSettings();
  const kindSpread = (code: string) => {
    const def = currencies.get(code);
    if (code === 'USD') return 0;
    if (def?.kind === 'magical') return s.fxSpreadMagicalPct;
    if (MAJORS.has(code)) return s.fxSpreadMajorPct;
    return s.fxSpreadMinorPct;
  };
  return Math.max(kindSpread(from), kindSpread(to));
}

export interface FxQuote {
  from: string;
  to: string;
  sourceAmount: number;
  midRate: number;
  bankRate: number;
  spreadPct: number;
  fee: number;
  feeCurrency: string;
  targetAmount: number;
  totalDebit: number;
  at: number;
}

export function quote(from: string, to: string, sourceAmount: number, t: number = nowMs()): FxQuote {
  const mid = midRate(from, to, t);
  const spread = from === to ? 0 : spreadPct(from, to);
  const bankRate = mid * (1 - spread / 100);
  const fee = from === to ? 0 : Math.round((sourceAmount * getSettings().fxFeePct) / 100);
  const targetAmount = convertMinor(sourceAmount, from, to, bankRate);
  return {
    from, to, sourceAmount, midRate: mid, bankRate, spreadPct: spread, fee, feeCurrency: from,
    targetAmount, totalDebit: sourceAmount + fee, at: t,
  };
}

/** Convert at mid-market (used for analytics/base-currency totals). */
export function toBase(minor: number, from: string, base: string, t?: number): number {
  if (from === base) return minor;
  const r = midRate(from, base, t);
  if (!Number.isFinite(r)) return 0;
  return convertMinor(minor, from, base, r);
}

/** Convert a USD-denominated minor amount into another currency (for fee schedules). */
export function usdTo(minorUSD: number, code: string): number {
  if (code === 'USD') return minorUSD;
  const r = midRate('USD', code);
  return Number.isFinite(r) ? convertMinor(minorUSD, 'USD', code, r) : toMinor(minorUSD / 100, code);
}

export type RatePeriod = '1D' | '7D' | '1M' | '3M' | '6M' | '1Y' | '5Y';

export const PERIODS: Record<RatePeriod, { span: number; points: number }> = {
  '1D': { span: 24 * HOUR, points: 48 },
  '7D': { span: 7 * 24 * HOUR, points: 84 },
  '1M': { span: 30 * 24 * HOUR, points: 90 },
  '3M': { span: 91 * 24 * HOUR, points: 91 },
  '6M': { span: 182 * 24 * HOUR, points: 91 },
  '1Y': { span: 365 * 24 * HOUR, points: 104 },
  '5Y': { span: 5 * 365 * 24 * HOUR, points: 130 },
};

export function rateHistory(from: string, to: string, period: RatePeriod, end: number = nowMs()) {
  const { span, points } = PERIODS[period];
  const out: { t: number; v: number }[] = [];
  for (let i = 0; i <= points; i++) {
    const t = end - span + (span * i) / points;
    out.push({ t, v: midRate(from, to, t) });
  }
  return out;
}
