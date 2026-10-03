/**
 * Currency Registry — the single source of truth for every currency the
 * Exchequer knows. Banking logic never hard-codes currencies: it asks the
 * registry for decimals, status and formatting. New currencies (custom or
 * magical) are added with `register()` and immediately work everywhere.
 */
import type { CurrencyDef } from './types';
import { ISO_CURRENCIES } from './iso4217';
import { MAGICAL_CURRENCIES } from './magical';

type Listener = () => void;

class CurrencyRegistry {
  private map = new Map<string, CurrencyDef>();
  private disabled = new Set<string>();
  private customCodes = new Set<string>();
  private listeners = new Set<Listener>();
  private version = 0;

  constructor() {
    for (const c of ISO_CURRENCIES) this.map.set(c.code, c);
    for (const c of MAGICAL_CURRENCIES) this.map.set(c.code, c);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getVersion() {
    return this.version;
  }

  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** Add or replace a currency definition at runtime. */
  register(def: CurrencyDef, custom = true) {
    if (!/^[A-Z]{3,4}$/.test(def.code)) throw new Error('Currency code must be 3–4 capital letters');
    this.map.set(def.code, { ...def });
    if (custom) this.customCodes.add(def.code);
    this.emit();
  }

  setEnabled(code: string, enabled: boolean) {
    if (enabled) this.disabled.delete(code);
    else this.disabled.add(code);
    this.emit();
  }

  applyOverrides(rows: { code: string; enabled: boolean; custom?: CurrencyDef }[]) {
    for (const r of rows) {
      if (r.custom) {
        this.map.set(r.custom.code, { ...r.custom });
        this.customCodes.add(r.custom.code);
      }
      if (r.enabled) this.disabled.delete(r.code);
      else this.disabled.add(r.code);
    }
    this.emit();
  }

  get(code: string): CurrencyDef | undefined {
    return this.map.get(code);
  }

  has(code: string) {
    return this.map.has(code);
  }

  isCustom(code: string) {
    return this.customCodes.has(code);
  }

  isEnabled(code: string) {
    return !this.disabled.has(code);
  }

  decimals(code: string): number {
    return this.map.get(code)?.decimals ?? 2;
  }

  symbol(code: string): string {
    return this.map.get(code)?.symbol ?? code;
  }

  all(): CurrencyDef[] {
    return [...this.map.values()].sort((a, b) => a.code.localeCompare(b.code));
  }

  /** Currencies that can hold balances and move between accounts. */
  isTransactional(code: string): boolean {
    const c = this.map.get(code);
    if (!c) return false;
    if (this.disabled.has(code)) return false;
    return c.status === 'active' && c.kind !== 'fund' && c.kind !== 'special';
  }

  transactional(): CurrencyDef[] {
    return this.all().filter((c) => this.isTransactional(c.code));
  }

  magical(): CurrencyDef[] {
    return this.all().filter((c) => c.kind === 'magical');
  }

  iso(): CurrencyDef[] {
    return this.all().filter((c) => c.kind !== 'magical' && !this.customCodes.has(c.code));
  }
}

export const currencies = new CurrencyRegistry();

/** Currencies offered first in pickers. */
export const MAJOR_CODES = ['CRWN', 'USD', 'EUR', 'GBP', 'CHF', 'JPY', 'CNY', 'AMD', 'RUB', 'XAU', 'MSLV', 'EMBR'];
