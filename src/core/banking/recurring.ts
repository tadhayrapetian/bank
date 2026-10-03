/** Recurring payments, subscriptions, scheduled transfers and budgets — everything that happens over time. */
import { db } from '../db/db';
import { BankError } from '../errors';
import { nowISO, addDays, addMonths, addYears, todayKey } from '../clock';
import { uid } from '../util/random';
import { actor } from '../context';
import { canOperate, getAccountOrThrow, GL } from './accounts';
import { transfer, resolveRecipient } from './payments';
import { execute } from './engine';
import { availableOf } from './ledger';
import { audit } from '../ops/audit';
import { notify } from '../comms/notify';
import { quote } from '../currency/rates';
import type { BudgetCategory, Frequency, RecurringPayment, Subscription } from '../types';

export function advanceDate(dateKey: string, f: Frequency | Subscription['period']): string {
  const d = new Date(dateKey + 'T00:00:00Z');
  switch (f) {
    case 'daily':
      return addDays(d, 1).toISOString().slice(0, 10);
    case 'weekly':
      return addDays(d, 7).toISOString().slice(0, 10);
    case 'monthly':
      return addMonths(d, 1).toISOString().slice(0, 10);
    case 'yearly':
      return addYears(d, 1).toISOString().slice(0, 10);
  }
}

/** Upcoming occurrences (for previews and the calendar). */
export function occurrences(start: string, f: Frequency | Subscription['period'], count: number, endDate?: string): string[] {
  const out: string[] = [];
  let d = start;
  while (out.length < count && (!endDate || d <= endDate)) {
    out.push(d);
    d = advanceDate(d, f);
  }
  return out;
}

export async function createRecurring(input: Omit<RecurringPayment, 'id' | 'ownerId' | 'nextRun' | 'status' | 'runs' | 'createdAt'>) {
  const from = await getAccountOrThrow(input.fromAccountId);
  if (!canOperate(from)) throw new BankError('PERMISSION_DENIED');
  if (!(input.amount > 0)) throw new BankError('INVALID_AMOUNT');
  if (input.endDate && input.endDate < input.startDate) throw new BankError('VALIDATION', { field: 'endDate' });
  if (input.startDate < todayKey()) throw new BankError('VALIDATION', { field: 'startDate' });
  await resolveRecipient({ accountNumber: input.recipientAccount }, input.currency);
  const rec: RecurringPayment = { ...input, id: uid('RCR'), ownerId: actor().userId, nextRun: input.startDate, status: 'active', runs: [], createdAt: nowISO() };
  await db.recurring.add(rec);
  await audit({ action: 'recurring.create', object: 'recurring', objectId: rec.id, details: `${rec.amount} ${rec.currency} ${rec.frequency}` });
  return rec;
}

async function ownRecurring(id: string) {
  const r = await db.recurring.get(id);
  if (!r) throw new BankError('NOT_FOUND');
  if (r.ownerId !== actor().userId && !actor().system) throw new BankError('PERMISSION_DENIED');
  return r;
}

export async function setRecurringStatus(id: string, status: 'active' | 'paused' | 'cancelled') {
  const r = await ownRecurring(id);
  if (r.status === 'cancelled' || r.status === 'completed') throw new BankError('INVALID_STATE', { status: r.status });
  let nextRun = r.nextRun;
  if (status === 'active') while (nextRun < todayKey()) nextRun = advanceDate(nextRun, r.frequency);
  await db.recurring.update(id, { status, nextRun });
  await audit({ action: `recurring.${status}`, object: 'recurring', objectId: id });
}

export async function runRecurringNow(id: string) {
  const r = await ownRecurring(id);
  return executeRecurring(r, true);
}

async function executeRecurring(r: RecurringPayment, manual = false) {
  let txId: string | undefined;
  let status: RecurringPayment['runs'][number]['status'] = 'completed';
  let error: string | undefined;
  try {
    const tx = await transfer({
      fromAccountId: r.fromAccountId, currency: r.currency, amount: r.amount, recipient: { accountNumber: r.recipientAccount },
      description: `${r.description} (recurring ${r.frequency})`, type: 'recurring', channel: 'scheduler', category: r.category,
      initiatorId: r.ownerId, skipScreen: true,
    });
    txId = tx.id;
  } catch (e) {
    status = 'failed';
    error = e instanceof BankError ? e.code : 'TRANSACTION_FAILED';
    txId = e instanceof BankError ? String(e.params.txId ?? '') || undefined : undefined;
    await notify(r.ownerId, { category: 'payments', titleKey: 'n.recurring.failed.title', bodyKey: 'n.recurring.failed.body', params: { name: r.recipientName, amt: r.amount, ccy: r.currency, code: error }, link: '/recurring', priority: 'high' });
  }
  const next = manual ? r.nextRun : advanceDate(r.nextRun, r.frequency);
  const done = !!r.endDate && next > r.endDate;
  await db.recurring.update(r.id, { runs: [...r.runs, { at: nowISO(), txId, status, error }], nextRun: next, status: done ? 'completed' : r.status });
  return { txId, status, error };
}

/** Scheduler hook: execute every due recurring payment. */
export async function processRecurring(dayKey = todayKey()) {
  const due = (await db.recurring.where('status').equals('active').toArray()).filter((r) => r.nextRun <= dayKey);
  for (const r0 of due) {
    let r = r0;
    // catch up missed runs (bounded) when the clock jumped forward
    let guard = 0;
    while (r.status === 'active' && r.nextRun <= dayKey && guard++ < 40) {
      await executeRecurring(r);
      r = (await db.recurring.get(r.id))!;
    }
  }
  return due.length;
}

export async function processScheduledTransfers() {
  const now = nowISO();
  const due = (await db.scheduled.where('status').equals('scheduled').toArray()).filter((s) => s.runAt <= now);
  for (const s of due) {
    try {
      const tx = await transfer({ fromAccountId: s.fromAccountId, currency: s.currency, amount: s.amount, recipient: { accountNumber: s.recipientAccount }, description: s.description, channel: 'scheduler', initiatorId: s.ownerId, skipScreen: true });
      await db.scheduled.update(s.id, { status: 'executed', txId: tx.id });
    } catch (e) {
      await db.scheduled.update(s.id, { status: 'failed', error: e instanceof BankError ? e.code : 'TRANSACTION_FAILED' });
      await notify(s.ownerId, { category: 'payments', titleKey: 'n.recurring.failed.title', bodyKey: 'n.recurring.failed.body', params: { name: s.recipientName, amt: s.amount, ccy: s.currency, code: e instanceof BankError ? e.code : 'TRANSACTION_FAILED' }, link: '/payments?tab=scheduled' });
    }
  }
  return due.length;
}

/* ───────────── Subscriptions ───────────── */

export async function addSubscription(input: { service: string; plan: string; amount: number; currency: string; accountId: string; cardId?: string; period: Subscription['period']; startDate: string; category?: BudgetCategory; hue?: number }) {
  const acc = await getAccountOrThrow(input.accountId);
  if (!canOperate(acc)) throw new BankError('PERMISSION_DENIED');
  if (!(input.amount > 0)) throw new BankError('INVALID_AMOUNT');
  if (!input.service.trim()) throw new BankError('VALIDATION', { field: 'service' });
  const sub: Subscription = {
    id: uid('SUB'), ownerId: acc.ownerId, service: input.service.trim(), plan: input.plan, amount: input.amount, currency: input.currency,
    accountId: acc.id, cardId: input.cardId, period: input.period, nextCharge: input.startDate, status: 'active', startedAt: nowISO(),
    category: input.category ?? 'subscriptions', charges: [], hue: input.hue ?? Math.floor(Math.random() * 360),
  };
  await db.subscriptions.add(sub);
  await audit({ action: 'subscription.add', object: 'subscription', objectId: sub.id, details: sub.service });
  return sub;
}

export async function setSubscriptionStatus(id: string, status: Subscription['status']) {
  const s = await db.subscriptions.get(id);
  if (!s) throw new BankError('NOT_FOUND');
  if (s.ownerId !== actor().userId && !actor().system) throw new BankError('PERMISSION_DENIED');
  if (s.status === 'cancelled') throw new BankError('INVALID_STATE', { status: s.status });
  let nextCharge = s.nextCharge;
  if (status === 'active') while (nextCharge < todayKey()) nextCharge = advanceDate(nextCharge, s.period);
  await db.subscriptions.update(id, { status, nextCharge });
  await audit({ action: `subscription.${status}`, object: 'subscription', objectId: id, details: s.service });
}

async function chargeSubscription(s: Subscription) {
  const acc = await getAccountOrThrow(s.accountId);
  const owner = await db.users.get(s.ownerId);
  const ccy = acc.pockets.includes(s.currency) ? s.currency : acc.currency;
  const amount = ccy === s.currency ? s.amount : quote(s.currency, ccy, s.amount).targetAmount;
  let status: Subscription['charges'][number]['status'] = 'completed';
  let txId: string | undefined;
  try {
    const tx = await execute({
      draft: {
        type: 'subscription', amount, currency: ccy, fromAccountId: acc.id, sender: { name: owner?.name ?? 'Client', accountNumber: acc.number },
        recipient: { name: s.service }, description: `${s.service} — ${s.plan}`, category: s.category, channel: 'scheduler', cardId: s.cardId,
        merchant: { name: s.service, mcc: '5968', realm: 'ALD' }, refPrefix: 'SUB', initiatorId: s.ownerId,
      },
      validate: async () => {
        if (acc.status !== 'active') throw new BankError('ACCOUNT_FROZEN', { account: acc.number });
        const avail = await availableOf(acc.id, ccy);
        if (avail < amount) throw new BankError('INSUFFICIENT_FUNDS', { available: avail, required: amount, currency: ccy });
      },
      screen: false,
      plan: () => [{ memo: `Subscription ${s.service}`, lines: [{ accountId: acc.id, currency: ccy, side: 'D', amount }, { accountId: GL.CARDS, currency: ccy, side: 'C', amount }] }],
    });
    txId = tx.id;
  } catch (e) {
    status = 'failed';
    txId = e instanceof BankError ? (e.params.txId as string) : undefined;
  }
  await db.subscriptions.update(s.id, { charges: [...s.charges, { at: nowISO(), txId, status }], nextCharge: advanceDate(s.nextCharge, s.period) });
}

export async function processSubscriptions(dayKey = todayKey()) {
  const due = (await db.subscriptions.where('status').equals('active').toArray()).filter((s) => s.nextCharge <= dayKey);
  for (const s0 of due) {
    let s = s0;
    let guard = 0;
    while (s.status === 'active' && s.nextCharge <= dayKey && guard++ < 30) {
      await chargeSubscription(s);
      s = (await db.subscriptions.get(s.id))!;
    }
  }
  return due.length;
}

/* ───────────── Budgets ───────────── */

export async function setBudget(category: BudgetCategory, monthlyLimit: number, currency: string) {
  const a = actor();
  if (!(monthlyLimit >= 0)) throw new BankError('INVALID_AMOUNT');
  const existing = await db.budgets.where('ownerId').equals(a.userId).filter((b) => b.category === category).first();
  if (existing) await db.budgets.update(existing.id, { monthlyLimit, currency });
  else await db.budgets.add({ id: uid('BGT'), ownerId: a.userId, category, monthlyLimit, currency });
  await audit({ action: 'budget.set', object: 'budget', objectId: category, details: `${monthlyLimit} ${currency}` });
}

export async function removeBudget(id: string) {
  const b = await db.budgets.get(id);
  if (!b || b.ownerId !== actor().userId) throw new BankError('PERMISSION_DENIED');
  await db.budgets.delete(id);
  await audit({ action: 'budget.remove', object: 'budget', objectId: b.category });
}
