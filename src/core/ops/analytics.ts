/** Analytics & reporting — derived from transactions and the ledger (never stored separately). */
import { db } from '../db/db';
import { toBase } from '../currency/rates';
import { monthKey, now, addMonths } from '../clock';
import { pocketBalances } from '../banking/ledger';
import type { Account, BudgetCategory, Transaction } from '../types';

export type Direction = 'in' | 'out' | 'internal' | 'none';

export function directionFor(tx: Transaction, myAccountIds: Set<string>): Direction {
  const fromMine = !!tx.fromAccountId && myAccountIds.has(tx.fromAccountId);
  const toMine = !!tx.toAccountId && myAccountIds.has(tx.toAccountId);
  if (fromMine && toMine) return 'internal';
  if (fromMine) return 'out';
  if (toMine) return 'in';
  return 'none';
}

/** Signed amount as seen by this user, in the transaction's own currency. */
export function signedAmount(tx: Transaction, dir: Direction): { amount: number; currency: string } {
  if (dir === 'in') return { amount: tx.creditAmount ?? tx.amount, currency: tx.creditCurrency ?? tx.currency };
  if (dir === 'out') return { amount: -(tx.amount + (tx.feeCurrency === tx.currency ? tx.fee : 0)), currency: tx.currency };
  return { amount: tx.amount, currency: tx.currency };
}

export interface MonthFlow {
  month: string;
  income: number;
  expenses: number;
  transfers: number;
  fees: number;
  net: number;
}

export interface UserAnalytics {
  months: MonthFlow[];
  byCategory: { category: BudgetCategory; amount: number }[];
  incomeByCategory: { category: BudgetCategory; amount: number }[];
  feesTotal: number;
  incomeTotal: number;
  expenseTotal: number;
  transfersTotal: number;
  exposure: { currency: string; amount: number; base: number }[];
  topCounterparties: { name: string; amount: number; count: number }[];
  txCount: number;
}

export async function userAccounts(userId: string): Promise<Account[]> {
  return db.accounts.where('partyIds').equals(userId).toArray();
}

export async function computeUserAnalytics(userId: string, base: string, monthsBack = 12): Promise<UserAnalytics> {
  const accounts = await userAccounts(userId);
  const mine = new Set(accounts.map((a) => a.id));
  const start = addMonths(now(), -(monthsBack - 1));
  start.setUTCDate(1);
  const startISO = start.toISOString().slice(0, 7);
  const txs = await db.transactions.where('partyIds').equals(userId).filter((t) => t.status === 'completed' || t.status === 'reversed').toArray();
  const months = new Map<string, MonthFlow>();
  for (let i = 0; i < monthsBack; i++) {
    const m = monthKey(addMonths(start, i));
    months.set(m, { month: m, income: 0, expenses: 0, transfers: 0, fees: 0, net: 0 });
  }
  const cat = new Map<BudgetCategory, number>();
  const incCat = new Map<BudgetCategory, number>();
  const cps = new Map<string, { amount: number; count: number }>();
  let fees = 0, income = 0, expenses = 0, transfers = 0, count = 0;
  for (const tx of txs) {
    const m = monthKey(tx.createdAt);
    if (m < startISO) continue;
    const dir = directionFor(tx, mine);
    if (dir === 'none') continue;
    count++;
    const t = Date.parse(tx.createdAt);
    const row = months.get(m);
    const feeBase = tx.fee && dir !== 'in' ? toBase(tx.fee, tx.feeCurrency, base, t) : 0;
    if (dir === 'internal') {
      const v = toBase(tx.amount, tx.currency, base, t);
      transfers += v;
      if (row) row.transfers += v;
    } else if (dir === 'in') {
      const v = toBase(tx.creditAmount ?? tx.amount, tx.creditCurrency ?? tx.currency, base, t);
      income += v;
      if (row) row.income += v;
      incCat.set(tx.category, (incCat.get(tx.category) ?? 0) + v);
      const k = tx.sender.name;
      const c = cps.get(k) ?? { amount: 0, count: 0 };
      cps.set(k, { amount: c.amount + v, count: c.count + 1 });
    } else {
      const v = toBase(tx.amount, tx.currency, base, t);
      expenses += v;
      if (row) row.expenses += v;
      const category = tx.type === 'fee' ? 'fees' : tx.category;
      cat.set(category, (cat.get(category) ?? 0) + v);
      const k = tx.merchant?.name ?? tx.recipient.name;
      const c = cps.get(k) ?? { amount: 0, count: 0 };
      cps.set(k, { amount: c.amount - v, count: c.count + 1 });
    }
    if (feeBase) {
      fees += feeBase;
      if (row) row.fees += feeBase;
    }
  }
  for (const r of months.values()) r.net = r.income - r.expenses - r.fees;
  const exposureMap = new Map<string, number>();
  for (const acc of accounts.filter((a) => a.status !== 'closed')) {
    const pockets = await pocketBalances(acc);
    for (const p of pockets) {
      const v = acc.type === 'loan' ? -p.balance : p.balance;
      exposureMap.set(p.currency, (exposureMap.get(p.currency) ?? 0) + v);
    }
  }
  const exposure = [...exposureMap.entries()].filter(([, v]) => v !== 0).map(([currency, amount]) => ({ currency, amount, base: toBase(amount, currency, base) })).sort((a, b) => Math.abs(b.base) - Math.abs(a.base));
  return {
    months: [...months.values()],
    byCategory: [...cat.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    incomeByCategory: [...incCat.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    feesTotal: fees,
    incomeTotal: income,
    expenseTotal: expenses,
    transfersTotal: transfers,
    exposure,
    topCounterparties: [...cps.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 8),
    txCount: count,
  };
}

/** Month-end balance series for one account pocket (from the ledger). */
export async function balanceSeries(accountId: string, currency: string, monthsBack = 12) {
  const entries = await db.ledger.where('[accountId+currency]').equals([accountId, currency]).sortBy('at');
  const acc = await db.accounts.get(accountId);
  const sign = acc?.normal === 'debit' ? -1 : 1;
  const out: { t: number; v: number }[] = [];
  const start = addMonths(now(), -monthsBack);
  let running = 0, i = 0;
  for (let m = 0; m <= monthsBack; m++) {
    const end = m === monthsBack ? now() : addMonths(start, m + 1);
    const endISO = end.toISOString();
    while (i < entries.length && entries[i].at <= endISO) {
      running += entries[i].side === 'C' ? entries[i].amount : -entries[i].amount;
      i++;
    }
    out.push({ t: end.getTime(), v: running * sign });
  }
  return out;
}

/** Bank-wide totals for the admin overview. */
export async function institutionStats() {
  const [users, accounts, cards, txs, docs, openFraud, pendingKyc, reviewLoans, openDisputes] = await Promise.all([
    db.users.count(), db.accounts.filter((a) => a.ownerId !== 'BANK').count(), db.cards.count(), db.transactions.count(), db.documents.count(),
    db.fraud.where('status').equals('open').count(), db.kyc.where('status').equals('pending').count(), db.loans.where('status').equals('under_review').count(),
    db.disputes.filter((d) => ['opened', 'under_review', 'evidence_required'].includes(d.status)).count(),
  ]);
  return { users, accounts, cards, txs, docs, openFraud, pendingKyc, reviewLoans, openDisputes };
}
