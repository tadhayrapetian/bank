/**
 * The Exchequer's clockwork: real-time jobs (international stages, card
 * settlement, scheduled transfers, limit orders) and the End-of-Day batch
 * (interest accrual, maturities, loan dues, recurring payments, subscriptions,
 * premiums, overdue invoices, expiries). Advancing the bank clock replays
 * End-of-Day for every day crossed.
 */
import { db, getMeta, setMeta, unitOfWork } from '../db/db';
import { clock, nowISO, todayKey, addDays, nowMs } from '../clock';
import { asActor, SYSTEM_ACTOR } from '../context';
import { requirePermission } from '../security/permissions';
import { audit, syslog } from './audit';
import { processInternationalQueue } from '../banking/international';
import { settleDueCardAuthorizations, expireCards } from '../banking/cards';
import { processScheduledTransfers, processRecurring, processSubscriptions } from '../banking/recurring';
import { processLimitOrders, payDividends } from '../banking/investments';
import { accrueDepositsFor } from '../banking/deposits';
import { processLoanDues } from '../banking/loans';
import { markOverdueInvoices } from '../banking/invoices';
import { expireChecks } from '../banking/checks';
import { expireKyc, processPolicies } from '../banking/services';
import { releaseHold } from '../banking/ledger';
import { cashOnHand } from '../banking/cash';

let running = false;
const listeners = new Set<(r: TickReport) => void>();

export interface TickReport {
  at: string;
  intl: number;
  cards: number;
  scheduled: number;
  orders: number;
  eodDays: string[];
}

export function onTick(fn: (r: TickReport) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function runEndOfDay(dayKey: string) {
  if (clock.isInstant()) return unitOfWork(() => endOfDay(dayKey));
  return endOfDay(dayKey);
}

async function endOfDay(dayKey: string) {
  await accrueDepositsFor(dayKey);
  await processLoanDues(dayKey);
  await processRecurring(dayKey);
  await processSubscriptions(dayKey);
  await processPolicies(dayKey);
  await payDividends(dayKey);
  await markOverdueInvoices();
  await expireChecks();
  await expireKyc(dayKey);
  await expireCards();
  // temporary accounts and stale holds / codes / links
  const now = nowISO();
  for (const a of (await db.accounts.where('type').equals('temporary').toArray()).filter((a) => a.status === 'active' && !!a.expiresAt && a.expiresAt < now)) {
    await db.accounts.update(a.id, { status: 'frozen', frozenReason: 'temporary account expired' });
  }
  const staleCodes = (await db.cardless.where('status').equals('active').toArray()).filter((c) => c.expiresAt < now);
  for (const c of staleCodes) {
    await releaseHold(c.holdId);
    await db.cardless.update(c.id, { status: 'expired' });
  }
  for (const l of (await db.links.where('status').equals('active').toArray()).filter((l) => l.expiresAt < now)) await db.links.update(l.id, { status: 'expired' });
  const reqCutoff = addDays(now, -30).toISOString();
  for (const r of (await db.requests.where('status').equals('pending').toArray()).filter((r) => r.createdAt < reqCutoff)) await db.requests.update(r.id, { status: 'expired' });
  // ATM low-cash flags
  for (const atm of await db.atms.toArray()) {
    if (atm.status === 'offline' || atm.status === 'maintenance') continue;
    const cash = await cashOnHand(atm.cashAccountId, 'CRWN');
    const low = cash < 2_000_00;
    if (low && atm.status !== 'low_cash') await db.atms.update(atm.id, { status: 'low_cash' });
    if (!low && atm.status === 'low_cash') await db.atms.update(atm.id, { status: 'online' });
  }
  await syslog('info', 'eod', `End-of-day batch completed for ${dayKey}`);
}

/** One scheduler pass. Safe to call often; never runs concurrently. */
export async function tick(): Promise<TickReport | null> {
  if (running) return null;
  running = true;
  try {
    return await asActor(SYSTEM_ACTOR, async () => {
      const report: TickReport = { at: nowISO(), intl: 0, cards: 0, scheduled: 0, orders: 0, eodDays: [] };
      report.intl = await processInternationalQueue();
      report.cards = await settleDueCardAuthorizations();
      report.scheduled = await processScheduledTransfers();
      report.orders = await processLimitOrders();
      const today = todayKey();
      let last = await getMeta<string | null>('lastEOD', null);
      if (!last) {
        await setMeta('lastEOD', today);
        last = today;
      }
      let day = last;
      let guard = 0;
      while (day < today && guard++ < 800) {
        day = addDays(day + 'T00:00:00Z', 1).toISOString().slice(0, 10);
        await runEndOfDay(day);
        report.eodDays.push(day);
        await setMeta('lastEOD', day);
      }
      for (const l of listeners) l(report);
      return report;
    });
  } catch (e) {
    await syslog('error', 'scheduler', e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    running = false;
  }
}

/** Advance bank time (admin). Each crossed day runs the End-of-Day batch. */
export async function advanceClock(hours: number) {
  requirePermission('clock.manage');
  const offset = clock.getOffset() + hours * 3_600_000;
  clock.setOffset(offset);
  await setMeta('clockOffset', offset);
  await audit({ action: 'system.clock_advance', object: 'clock', objectId: 'chronometer', details: `+${hours}h → ${new Date(nowMs()).toISOString()}` });
  await syslog('warn', 'clock', `Bank clock advanced by ${hours}h`);
  // wait for any running pass, then run
  let report = await tick();
  let guard = 0;
  while (!report && guard++ < 50) {
    await new Promise((r) => setTimeout(r, 100));
    report = await tick();
  }
  return report;
}

export async function resetClock() {
  requirePermission('clock.manage');
  clock.setOffset(0);
  await setMeta('clockOffset', 0);
  await audit({ action: 'system.clock_reset', object: 'clock', objectId: 'chronometer' });
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startScheduler(intervalMs = 5000) {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, intervalMs);
  void tick();
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
