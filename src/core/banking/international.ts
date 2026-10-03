/**
 * International Payments Center — Aetherline Cross-Realm Settlement (simulation).
 * Funds move to the Cross-Realm Clearing account at submission, then the
 * transfer travels through Compliance Review → Processing → Intermediary Bank →
 * Receiving Bank, and finally settles to the Nostro (correspondent) account.
 */
import { db } from '../db/db';
import { BankError } from '../errors';
import { nowISO, nowMs } from '../clock';
import { uid } from '../util/random';
import { actor } from '../context';
import { currencies } from '../currency/registry';
import { quote, usdTo } from '../currency/rates';
import { execute, addStep, setTxStatus, finalize, type PlannedJournal } from './engine';
import { post, availableOf } from './ledger';
import { canOperate, getAccountOrThrow, GL } from './accounts';
import { FOREIGN_BANKS, INTERMEDIARIES, REALMS } from '../institution';
import { getSettings } from '../settings';
import { audit } from '../ops/audit';
import { notify, sendMail } from '../comms/notify';
import type { TimelineKey, Transaction } from '../types';

export const INTL_STAGES: TimelineKey[] = ['submitted', 'compliance_review', 'processing', 'intermediary_bank', 'receiving_bank', 'completed'];

export interface IntlInput {
  fromAccountId: string;
  fromCurrency: string;
  currency: string;
  amount: number; // in `currency` — what the beneficiary receives
  recipientName: string;
  recipientAccount: string;
  bankCode: string;
  purpose: string;
  reference?: string;
  onCreated?: (txId: string) => void;
}

export interface IntlQuote {
  sourceAmount: number;
  fee: number;
  rate: number;
  midRate: number;
  totalDebit: number;
  estimatedHours: number;
  bank: (typeof FOREIGN_BANKS)[number];
}

export function intlQuote(input: Pick<IntlInput, 'fromCurrency' | 'currency' | 'amount' | 'bankCode'>): IntlQuote {
  const bank = FOREIGN_BANKS.find((b) => b.code === input.bankCode);
  if (!bank) throw new BankError('INVALID_RECIPIENT', { bank: input.bankCode });
  if (!currencies.isTransactional(input.currency)) throw new BankError('CURRENCY_UNSUPPORTED', { currency: input.currency });
  if (!currencies.isTransactional(input.fromCurrency)) throw new BankError('CURRENCY_UNSUPPORTED', { currency: input.fromCurrency });
  let sourceAmount = input.amount;
  let rate = 1;
  let mid = 1;
  if (input.fromCurrency !== input.currency) {
    // amount the client must sell so that the beneficiary receives `amount`
    const probe = quote(input.fromCurrency, input.currency, 10_000_00);
    rate = probe.bankRate;
    mid = probe.midRate;
    const dFrom = currencies.decimals(input.fromCurrency);
    const dTo = currencies.decimals(input.currency);
    sourceAmount = Math.ceil(((input.amount / Math.pow(10, dTo)) / rate) * Math.pow(10, dFrom));
  }
  const s = getSettings();
  const pctFee = Math.round((sourceAmount * s.intlFeePct) / 100);
  const minFee = usdTo(s.intlFeeMinUSD, input.fromCurrency);
  const fee = Math.max(pctFee, minFee);
  return { sourceAmount, fee, rate, midRate: mid, totalDebit: sourceAmount + fee, estimatedHours: bank.hours, bank };
}

export async function submitInternational(input: IntlInput): Promise<Transaction> {
  if (!(input.amount > 0)) throw new BankError('INVALID_AMOUNT');
  if (!input.recipientName.trim()) throw new BankError('INVALID_RECIPIENT', { field: 'name' });
  if (!/^[A-Z0-9 -]{6,34}$/i.test(input.recipientAccount.trim())) throw new BankError('INVALID_ACCOUNT', { account: input.recipientAccount });
  const from = await getAccountOrThrow(input.fromAccountId);
  if (!canOperate(from)) throw new BankError('PERMISSION_DENIED');
  const a = actor();
  const user = await db.users.get(from.ownerId);
  if (!a.system && user?.kycStatus !== 'verified') throw new BankError('KYC_REQUIRED');
  const q = intlQuote(input);
  const realm = REALMS.find((r) => r.code === q.bank.realm);
  const conv = input.fromCurrency !== input.currency;
  const fxId = conv ? uid('FX', 10) : undefined;
  const plan: PlannedJournal[] = [
    {
      memo: `Cross-realm transfer to ${q.bank.name}`,
      lines: conv
        ? [
            { accountId: from.id, currency: input.fromCurrency, side: 'D', amount: q.sourceAmount },
            { accountId: GL.FX, currency: input.fromCurrency, side: 'C', amount: q.sourceAmount },
            { accountId: GL.FX, currency: input.currency, side: 'D', amount: input.amount },
            { accountId: GL.CLEARING, currency: input.currency, side: 'C', amount: input.amount },
            { accountId: from.id, currency: input.fromCurrency, side: 'D', amount: q.fee, memo: 'International fee' },
            { accountId: GL.FEES, currency: input.fromCurrency, side: 'C', amount: q.fee, memo: 'International fee' },
          ]
        : [
            { accountId: from.id, currency: input.currency, side: 'D', amount: input.amount },
            { accountId: GL.CLEARING, currency: input.currency, side: 'C', amount: input.amount },
            { accountId: from.id, currency: input.currency, side: 'D', amount: q.fee, memo: 'International fee' },
            { accountId: GL.FEES, currency: input.currency, side: 'C', amount: q.fee, memo: 'International fee' },
          ],
    },
  ];
  const tx = await execute({
    service: 'payments',
    onCreated: input.onCreated,
    draft: {
      type: 'international',
      amount: q.sourceAmount,
      currency: input.fromCurrency,
      creditAmount: input.amount,
      creditCurrency: input.currency,
      fee: q.fee,
      feeCurrency: input.fromCurrency,
      fromAccountId: from.id,
      sender: { name: user?.name ?? a.name, accountNumber: from.number, clientId: user?.clientId, bank: 'Exchequer of Aldermoor', realm: 'ALD' },
      recipient: { name: input.recipientName.trim(), accountNumber: input.recipientAccount.trim().toUpperCase(), bank: q.bank.name, bankCode: q.bank.code, realm: q.bank.realm },
      description: `International transfer to ${input.recipientName.trim()} (${q.bank.name})`,
      purpose: input.purpose,
      userRef: input.reference,
      category: 'transfers',
      channel: 'network',
      realm: q.bank.realm,
      fx: conv
        ? { id: fxId!, midRate: q.midRate, bankRate: q.rate, spreadPct: 0, sourceCurrency: input.fromCurrency, targetCurrency: input.currency, sourceAmount: q.sourceAmount, targetAmount: input.amount }
        : undefined,
      intl: {
        bankName: q.bank.name, bankCode: q.bank.code, realm: q.bank.realm, recipientAccount: input.recipientAccount.trim().toUpperCase(),
        estimatedHours: q.estimatedHours, correspondent: INTERMEDIARIES[Math.floor(Math.random() * INTERMEDIARIES.length)], stageTimes: {},
      },
      refPrefix: 'XRS',
    },
    validate: async () => {
      if (from.status === 'frozen') throw new BankError('ACCOUNT_FROZEN', { account: from.number });
      if (realm?.code === 'MIR') throw new BankError('INVALID_RECIPIENT', { reason: 'sanctioned realm' });
      const avail = await availableOf(from.id, input.fromCurrency);
      if (avail < q.totalDebit) throw new BankError('INSUFFICIENT_FUNDS', { available: avail, required: q.totalDebit, currency: input.fromCurrency });
    },
    limit: { account: from, amount: q.sourceAmount, currency: input.fromCurrency },
    screen: { realm: q.bank.realm, recipientKey: input.recipientAccount },
    plan: () => plan,
    holdOpen: true,
    receipt: false,
    notifyParties: false,
  });
  if (tx.status === 'processing') await startInternationalStages(tx.id);
  return (await db.transactions.get(tx.id))!;
}

function stageDelayMs() {
  const s = getSettings();
  return Math.max(2, s.intlStageSeconds) * 1000;
}

export async function startInternationalStages(txId: string) {
  const tx = await db.transactions.get(txId);
  if (!tx?.intl) return;
  const at = nowISO();
  await addStep(txId, 'submitted', true, {
    stage: 'submitted',
    intl: { ...tx.intl, stageTimes: { submitted: at }, nextStageAt: new Date(nowMs() + stageDelayMs()).toISOString() },
  });
}

/** Move one international transfer to its next stage. */
export async function advanceInternational(txId: string): Promise<Transaction | undefined> {
  const tx = await db.transactions.get(txId);
  if (!tx || tx.type !== 'international' || tx.status !== 'processing' || !tx.intl || !tx.stage) return tx;
  const idx = INTL_STAGES.indexOf(tx.stage);
  const next = INTL_STAGES[idx + 1];
  if (!next) return tx;
  const at = nowISO();
  if (next === 'completed') {
    await post({
      txId: tx.id, ref: tx.ref, memo: `Settlement to ${tx.intl.bankName}`,
      lines: [
        { accountId: GL.CLEARING, currency: tx.creditCurrency!, side: 'D', amount: tx.creditAmount! },
        { accountId: GL.NOSTRO, currency: tx.creditCurrency!, side: 'C', amount: tx.creditAmount! },
      ],
      allowOverdraft: true,
    });
    await setTxStatus(tx.id, 'completed', 'completed', true, {
      stage: 'completed',
      intl: { ...tx.intl, stageTimes: { ...tx.intl.stageTimes, completed: at }, nextStageAt: undefined },
    });
    const done = (await db.transactions.get(tx.id))!;
    await finalize(done, true, true);
    await sendMail(done.initiatorId, 'international_completed', { ref: done.ref, amt: done.creditAmount ?? 0, ccy: done.creditCurrency ?? '', name: done.recipient.name, bank: tx.intl.bankName }, done.documentIds[0]);
    return done;
  }
  await addStep(tx.id, next, true, {
    stage: next,
    intl: { ...tx.intl, stageTimes: { ...tx.intl.stageTimes, [next]: at }, nextStageAt: new Date(nowMs() + stageDelayMs()).toISOString() },
  }, next === 'intermediary_bank' ? tx.intl.correspondent : next === 'receiving_bank' ? tx.intl.bankName : undefined);
  if (next === 'compliance_review') {
    await notify(tx.initiatorId, { category: 'payments', titleKey: 'n.intl.stage.title', bodyKey: 'n.intl.stage.body', params: { ref: tx.ref, stage: next }, link: `/international?track=${tx.id}` });
  }
  return db.transactions.get(tx.id);
}

/** Scheduler hook: advance every international transfer whose stage time has come. */
export async function processInternationalQueue() {
  const now = nowISO();
  const due = await db.transactions.where('status').equals('processing')
    .filter((t) => t.type === 'international' && !!t.intl?.nextStageAt && t.intl.nextStageAt <= now)
    .toArray();
  for (const t of due) await advanceInternational(t.id);
  return due.length;
}

/** Cancel while still in Submitted / Compliance Review: principal returns to the client. */
export async function cancelInternational(txId: string) {
  const tx = await db.transactions.get(txId);
  if (!tx || tx.type !== 'international') throw new BankError('NOT_FOUND');
  const a = actor();
  if (!a.system && tx.initiatorId !== a.userId && !a.roles.includes('admin')) throw new BankError('PERMISSION_DENIED');
  if (tx.status !== 'processing' || !['submitted', 'compliance_review'].includes(tx.stage ?? '')) {
    throw new BankError('INVALID_STATE', { stage: tx.stage ?? tx.status });
  }
  const conv = tx.currency !== tx.creditCurrency;
  await post({
    txId: tx.id, ref: tx.ref, memo: 'Cancellation refund',
    lines: conv
      ? [
          { accountId: GL.CLEARING, currency: tx.creditCurrency!, side: 'D', amount: tx.creditAmount! },
          { accountId: GL.FX, currency: tx.creditCurrency!, side: 'C', amount: tx.creditAmount! },
          { accountId: GL.FX, currency: tx.currency, side: 'D', amount: tx.amount },
          { accountId: tx.fromAccountId!, currency: tx.currency, side: 'C', amount: tx.amount },
        ]
      : [
          { accountId: GL.CLEARING, currency: tx.currency, side: 'D', amount: tx.amount },
          { accountId: tx.fromAccountId!, currency: tx.currency, side: 'C', amount: tx.amount },
        ],
    allowOverdraft: true,
  });
  await setTxStatus(tx.id, 'cancelled', 'cancelled', false, { stage: undefined, intl: { ...tx.intl!, nextStageAt: undefined } }, 'refund_principal');
  await audit({ action: 'tx.international.cancel', object: 'transaction', objectId: tx.id, txId: tx.id });
  await notify(tx.initiatorId, { category: 'payments', titleKey: 'n.intl.cancelled.title', bodyKey: 'n.intl.cancelled.body', params: { ref: tx.ref, amt: tx.amount, ccy: tx.currency }, link: `/transactions/${tx.id}` });
}
