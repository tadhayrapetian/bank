/**
 * Deposits & Endowments: term deposits with daily interest accrual, monthly
 * capitalisation (with withholding tax recorded in the Tax Center), maturity
 * payout, optional auto-renewal, top-ups and early closure.
 */
import { db } from '../db/db';
import { BankError } from '../errors';
import { nowISO, addMonths, todayKey, daysBetween, addDays } from '../clock';
import { uid, randomDigits } from '../util/random';
import { actor } from '../context';
import { currencies } from '../currency/registry';
import { execute } from './engine';
import { availableOf, balanceOf } from './ledger';
import { canOperate, getAccountOrThrow, GL, openAccount } from './accounts';
import { createDocument } from '../docs/documents';
import { audit } from '../ops/audit';
import { notify, sendMail } from '../comms/notify';
import { getSettings } from '../settings';
import type { Deposit, DepositProduct } from '../types';

export const DEPOSIT_TERMS = [3, 6, 12, 24, 36];

const BASE_RATES: Record<number, number> = { 3: 3.2, 6: 3.8, 12: 4.5, 24: 4.9, 36: 5.2 };
const CCY_ADJ: Record<string, number> = { CRWN: 0, USD: -0.4, EUR: -1.0, GBP: -0.2, CHF: -2.2, JPY: -3.5, AMD: 2.5, RUB: 6.0 };

export function depositRate(product: DepositProduct, termMonths: number, currency: string): number {
  const def = currencies.get(currency);
  const adj = CCY_ADJ[currency] ?? (def?.kind === 'magical' ? 0.8 : def?.kind === 'metal' ? -3.6 : -0.6);
  let r = product === 'flex' ? 1.8 : BASE_RATES[termMonths] ?? 4.0;
  if (product === 'growth') r -= 0.5;
  return Math.max(0.1, Math.round((r + adj) * 100) / 100);
}

export const PRODUCT_RULES: Record<DepositProduct, { topUp: boolean; penaltyPct: number; withdraw: boolean }> = {
  fixed: { topUp: false, penaltyPct: 100, withdraw: false },
  growth: { topUp: true, penaltyPct: 60, withdraw: false },
  flex: { topUp: true, penaltyPct: 0, withdraw: true },
};

/** Projected interest with monthly capitalisation (before tax). */
export function projectDeposit(principal: number, rate: number, months: number) {
  let bal = principal;
  const schedule: { month: number; interest: number; balance: number }[] = [];
  for (let m = 1; m <= months; m++) {
    const interest = Math.round((bal * rate) / 100 / 12);
    bal += interest;
    schedule.push({ month: m, interest, balance: bal });
  }
  return { total: bal - principal, final: bal, schedule };
}

export async function getDepositOrThrow(id: string) {
  const d = await db.deposits.get(id);
  if (!d) throw new BankError('NOT_FOUND', { object: 'deposit' });
  return d;
}

export async function openDeposit(input: { sourceAccountId: string; currency: string; amount: number; product: DepositProduct; termMonths: number; autoRenew?: boolean; payoutAccountId?: string }) {
  const src = await getAccountOrThrow(input.sourceAccountId);
  if (!canOperate(src)) throw new BankError('PERMISSION_DENIED');
  if (!currencies.isTransactional(input.currency)) throw new BankError('CURRENCY_UNSUPPORTED', { currency: input.currency });
  if (!(input.amount > 0)) throw new BankError('INVALID_AMOUNT');
  if (!DEPOSIT_TERMS.includes(input.termMonths)) throw new BankError('VALIDATION', { field: 'term' });
  const avail = await availableOf(src.id, input.currency);
  if (avail < input.amount) throw new BankError('INSUFFICIENT_FUNDS', { available: avail, required: input.amount, currency: input.currency });
  const rate = depositRate(input.product, input.termMonths, input.currency);
  const acc = await openAccount({
    ownerId: src.ownerId, type: 'deposit', currency: input.currency, name: `${input.product === 'fixed' ? 'Fixed' : input.product === 'growth' ? 'Growth' : 'Flex'} deposit ${input.termMonths}m · ${input.currency}`,
    branchId: src.branchId, silent: true,
  });
  const openedAt = nowISO();
  const dep: Deposit = {
    id: uid('DEP'),
    number: `DP-${randomDigits(7)}`,
    ownerId: src.ownerId,
    accountId: acc.id,
    payoutAccountId: input.payoutAccountId ?? src.id,
    product: input.product,
    currency: input.currency,
    principal: input.amount,
    rate,
    termMonths: input.termMonths,
    openedAt,
    maturityDate: addMonths(openedAt, input.termMonths).toISOString(),
    status: 'active',
    accrued: 0,
    accruedFraction: 0,
    interestPaid: 0,
    lastAccrualDate: todayKey(),
    topUpAllowed: PRODUCT_RULES[input.product].topUp,
    earlyPenaltyPct: PRODUCT_RULES[input.product].penaltyPct,
    autoRenew: !!input.autoRenew,
  };
  const owner = await db.users.get(src.ownerId);
  await execute({
    draft: {
      type: 'deposit_open', amount: input.amount, currency: input.currency, fromAccountId: src.id, toAccountId: acc.id,
      sender: { name: owner?.name ?? 'Client', accountNumber: src.number }, recipient: { name: acc.name, accountNumber: acc.number },
      description: `Opening of deposit ${dep.number} (${rate}% p.a., ${input.termMonths} months)`, category: 'savings', channel: 'app', refPrefix: 'DEP',
      meta: { depositId: dep.id },
    },
    screen: false, notifyParties: false,
    plan: () => [{ memo: `Deposit ${dep.number}`, lines: [
      { accountId: src.id, currency: input.currency, side: 'D', amount: input.amount },
      { accountId: acc.id, currency: input.currency, side: 'C', amount: input.amount },
    ] }],
  });
  const cert = await createDocument({
    type: 'deposit_certificate', title: 'Certificate of Term Deposit', ownerId: src.ownerId, classification: 'confidential',
    data: { depositId: dep.id, number: dep.number, product: dep.product, principal: dep.principal, currency: dep.currency, rate, termMonths: dep.termMonths, openedAt, maturityDate: dep.maturityDate, holder: owner?.name, projected: projectDeposit(dep.principal, rate, dep.termMonths).total },
    links: { accountIds: [acc.id, src.id] }, authorName: 'Office of Deposits & Endowments', authorId: 'BANK', expiresAt: dep.maturityDate,
  });
  dep.certificateId = cert.id;
  await db.deposits.add(dep);
  await audit({ action: 'deposit.open', object: 'deposit', objectId: dep.id, details: `${dep.principal} ${dep.currency} ${rate}%` });
  await notify(src.ownerId, { category: 'deposits', titleKey: 'n.deposit.opened.title', bodyKey: 'n.deposit.opened.body', params: { number: dep.number, amt: dep.principal, ccy: dep.currency, rate }, link: `/deposits/${dep.id}` });
  await sendMail(src.ownerId, 'deposit_opened', { number: dep.number, amt: dep.principal, ccy: dep.currency, rate, term: dep.termMonths }, cert.id);
  return dep;
}

export async function topUpDeposit(id: string, fromAccountId: string, amount: number) {
  const d = await getDepositOrThrow(id);
  if (d.status !== 'active') throw new BankError('INVALID_STATE', { status: d.status });
  if (!d.topUpAllowed) throw new BankError('INVALID_STATE', { reason: 'top-up not allowed for this product' });
  const src = await getAccountOrThrow(fromAccountId);
  if (!canOperate(src)) throw new BankError('PERMISSION_DENIED');
  const acc = await getAccountOrThrow(d.accountId);
  const owner = await db.users.get(d.ownerId);
  const tx = await execute({
    draft: {
      type: 'deposit_topup', amount, currency: d.currency, fromAccountId: src.id, toAccountId: acc.id,
      sender: { name: owner?.name ?? 'Client', accountNumber: src.number }, recipient: { name: acc.name, accountNumber: acc.number },
      description: `Top-up of deposit ${d.number}`, category: 'savings', channel: 'app', refPrefix: 'DEP', meta: { depositId: d.id },
    },
    validate: async () => {
      const avail = await availableOf(src.id, d.currency);
      if (avail < amount) throw new BankError('INSUFFICIENT_FUNDS', { available: avail, required: amount, currency: d.currency });
    },
    screen: false,
    plan: () => [{ memo: `Top-up ${d.number}`, lines: [
      { accountId: src.id, currency: d.currency, side: 'D', amount },
      { accountId: acc.id, currency: d.currency, side: 'C', amount },
    ] }],
  });
  await db.deposits.update(id, { principal: d.principal + amount });
  return tx;
}

/** Post accrued interest to the deposit account, withholding tax to the Revenue Office. */
async function capitalize(d: Deposit): Promise<Deposit> {
  if (d.accrued <= 0) return d;
  const interest = d.accrued;
  const taxPct = getSettings().withholdingTaxPct;
  const tax = Math.round((interest * taxPct) / 100);
  const acc = await getAccountOrThrow(d.accountId);
  const owner = await db.users.get(d.ownerId);
  const tx = await execute({
    draft: {
      type: 'deposit_interest', amount: interest, currency: d.currency, toAccountId: acc.id, sender: { name: 'Office of Deposits & Endowments' },
      recipient: { name: owner?.name ?? 'Client', accountNumber: acc.number }, description: `Interest on deposit ${d.number} (${d.rate}% p.a.)`,
      category: 'income', channel: 'system', refPrefix: 'INT', meta: { depositId: d.id, tax }, partyIds: [d.ownerId],
    },
    screen: false, receipt: false, notifyParties: false,
    plan: () => [{ memo: `Interest ${d.number}`, allowOverdraft: true, ignoreFreeze: true, lines: [
      { accountId: GL.INT_EXP, currency: d.currency, side: 'D', amount: interest },
      { accountId: acc.id, currency: d.currency, side: 'C', amount: interest },
      ...(tax > 0 ? [
        { accountId: acc.id, currency: d.currency, side: 'D' as const, amount: tax, memo: 'Withholding tax' },
        { accountId: GL.TAX, currency: d.currency, side: 'C' as const, amount: tax, memo: 'Withholding tax' },
      ] : []),
    ] }],
  });
  if (tax > 0) {
    await db.taxes.add({
      id: uid('TAXR'), number: `WHT-${randomDigits(7)}`, ownerId: d.ownerId, year: new Date(nowISO()).getUTCFullYear(), kind: 'withholding',
      amount: tax, currency: d.currency, status: 'paid', dueDate: todayKey(), paidAt: nowISO(), txId: tx.id,
      description: `Withholding tax (${taxPct}%) on interest of deposit ${d.number}`,
    });
  }
  const next = { ...d, accrued: 0, interestPaid: d.interestPaid + interest - tax };
  await db.deposits.update(d.id, { accrued: 0, interestPaid: next.interestPaid });
  return next;
}

async function payout(d: Deposit, status: Deposit['status'], forfeitAccrued = false) {
  let dep = d;
  if (!forfeitAccrued) dep = await capitalize(d);
  else await db.deposits.update(d.id, { accrued: 0, accruedFraction: 0 });
  const acc = await getAccountOrThrow(dep.accountId);
  const bal = await balanceOf(acc.id, dep.currency);
  const owner = await db.users.get(dep.ownerId);
  let txId: string | undefined;
  if (bal > 0) {
    const target = await getAccountOrThrow(dep.payoutAccountId);
    const tx = await execute({
      draft: {
        type: 'deposit_payout', amount: bal, currency: dep.currency, fromAccountId: acc.id, toAccountId: target.id,
        sender: { name: acc.name, accountNumber: acc.number }, recipient: { name: owner?.name ?? 'Client', accountNumber: target.number },
        description: `${status === 'matured' ? 'Maturity payout' : 'Early closure'} of deposit ${dep.number}`, category: 'savings', channel: 'system', refPrefix: 'DEP',
        meta: { depositId: dep.id }, partyIds: [dep.ownerId],
      },
      screen: false,
      plan: () => [{ memo: `Payout ${dep.number}`, ignoreFreeze: true, lines: [
        { accountId: acc.id, currency: dep.currency, side: 'D', amount: bal },
        { accountId: target.id, currency: dep.currency, side: target.pockets.includes(dep.currency) || target.multiCurrency ? 'C' : 'C', amount: bal },
      ] }],
    });
    txId = tx.id;
  }
  await db.accounts.update(acc.id, { status: 'closed', closedAt: nowISO() });
  await db.deposits.update(dep.id, { status, closedAt: nowISO(), payoutTxId: txId });
  if (dep.certificateId) await db.documents.update(dep.certificateId, { status: 'archived' });
  await audit({ action: `deposit.${status}`, object: 'deposit', objectId: dep.id, txId, details: `${bal} ${dep.currency}` });
  await notify(dep.ownerId, { category: 'deposits', titleKey: status === 'matured' ? 'n.deposit.matured.title' : 'n.deposit.closed.title', bodyKey: status === 'matured' ? 'n.deposit.matured.body' : 'n.deposit.closed.body', params: { number: dep.number, amt: bal, ccy: dep.currency }, link: `/deposits/${dep.id}`, priority: 'high' });
  if (status === 'matured') await sendMail(dep.ownerId, 'deposit_matured', { number: dep.number, amt: bal, ccy: dep.currency }, dep.certificateId);
}

export async function closeDeposit(id: string) {
  const d = await getDepositOrThrow(id);
  if (d.ownerId !== actor().userId && !actor().system && !actor().roles.includes('teller')) throw new BankError('PERMISSION_DENIED');
  if (d.status !== 'active') throw new BankError('INVALID_STATE', { status: d.status });
  const matured = d.maturityDate <= nowISO();
  if (matured) return payout(d, 'matured');
  const rules = PRODUCT_RULES[d.product];
  // flex deposits keep their interest; others forfeit (part of) unposted interest
  if (rules.penaltyPct === 0) return payout(d, 'closed');
  const keep = Math.round(d.accrued * (1 - rules.penaltyPct / 100));
  await db.deposits.update(d.id, { accrued: keep });
  return payout({ ...d, accrued: keep }, 'closed_early', keep === 0);
}

/** End-of-day accrual for one calendar day; capitalise monthly; mature when due. */
export async function accrueDepositsFor(dayKey: string) {
  const active = await db.deposits.where('status').equals('active').toArray();
  for (const d0 of active) {
    let d = d0;
    if (d.lastAccrualDate >= dayKey) continue;
    const days = Math.max(1, daysBetween(d.lastAccrualDate, dayKey));
    const bal = await balanceOf(d.accountId, d.currency);
    const exact = (bal * d.rate) / 100 / 365 * days + d.accruedFraction;
    const whole = Math.floor(exact);
    d = { ...d, accrued: d.accrued + whole, accruedFraction: exact - whole, lastAccrualDate: dayKey };
    await db.deposits.update(d.id, { accrued: d.accrued, accruedFraction: d.accruedFraction, lastAccrualDate: dayKey });
    const opened = new Date(d.openedAt);
    const day = new Date(dayKey + 'T00:00:00Z');
    const monthly = day.getUTCDate() === opened.getUTCDate() && dayKey > d.openedAt.slice(0, 10);
    if (d.maturityDate.slice(0, 10) <= dayKey) {
      if (d.autoRenew) {
        d = await capitalize(d);
        const next = addMonths(d.maturityDate, d.termMonths).toISOString();
        await db.deposits.update(d.id, { maturityDate: next });
        await audit({ action: 'deposit.renew', object: 'deposit', objectId: d.id, details: next });
        await notify(d.ownerId, { category: 'deposits', titleKey: 'n.deposit.renewed.title', bodyKey: 'n.deposit.renewed.body', params: { number: d.number, date: next.slice(0, 10) }, link: `/deposits/${d.id}` });
      } else {
        await payout(d, 'matured');
      }
    } else if (monthly) {
      await capitalize(d);
    }
  }
}

export function daysToMaturity(d: Deposit) {
  return Math.max(0, daysBetween(nowISO(), d.maturityDate));
}

export function nextCapitalisation(d: Deposit) {
  let next = addMonths(d.openedAt, 1);
  while (next.toISOString() <= nowISO()) next = addMonths(next, 1);
  return next.toISOString() > d.maturityDate ? d.maturityDate : addDays(next, 0).toISOString();
}
