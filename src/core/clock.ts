/**
 * The Exchequer Chronometer — bank time.
 * Bank time = real time + a simulation offset (admins can advance the clock to
 * demonstrate interest accrual, maturities, overdue invoices, etc.).
 * Seeding can freeze time to back-date historic operations.
 */

let offsetMs = 0;
let frozenAt: number | null = null;
let instant = false;

export const clock = {
  setOffset(ms: number) {
    offsetMs = ms;
  },
  getOffset() {
    return offsetMs;
  },
  freeze(iso: string | number) {
    frozenAt = typeof iso === 'number' ? iso : Date.parse(iso);
  },
  unfreeze() {
    frozenAt = null;
  },
  isFrozen() {
    return frozenAt !== null;
  },
  /** When instant mode is on, processing pauses are skipped (seeding, tests, batch runs). */
  setInstant(v: boolean) {
    instant = v;
  },
  isInstant() {
    return instant;
  },
};

export function nowMs(): number {
  return frozenAt ?? Date.now() + offsetMs;
}

export function now(): Date {
  return new Date(nowMs());
}

export function nowISO(): string {
  return new Date(nowMs()).toISOString();
}

export function todayKey(d: Date = now()): string {
  return d.toISOString().slice(0, 10);
}

export async function pause(ms: number): Promise<void> {
  if (instant || frozenAt !== null || ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

/* ── date arithmetic (UTC based, calendar aware) ── */

export function addDays(iso: string | Date, days: number): Date {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function addMonths(iso: string | Date, months: number): Date {
  const d = new Date(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

export function addYears(iso: string | Date, years: number): Date {
  return addMonths(iso, years * 12);
}

export function daysBetween(a: string | Date, b: string | Date): number {
  const da = Date.UTC(new Date(a).getUTCFullYear(), new Date(a).getUTCMonth(), new Date(a).getUTCDate());
  const db = Date.UTC(new Date(b).getUTCFullYear(), new Date(b).getUTCMonth(), new Date(b).getUTCDate());
  return Math.round((db - da) / 86_400_000);
}

export function startOfDayISO(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

export function monthKey(iso: string | Date): string {
  return new Date(iso).toISOString().slice(0, 7);
}
