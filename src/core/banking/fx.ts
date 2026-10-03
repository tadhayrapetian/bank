/**
 * Currency Exchange — each exchange is a transaction with its own FX ID and a
 * four-leg journal through the FX position account plus a fee entry:
 *   D client[src]  C FX[src]    (sold amount)
 *   D FX[dst]      C client[dst] (bought amount)
 *   D client[src]  C FEES[src]   (commission)
 */
import { db } from '../db/db';
import { BankError } from '../errors';
import { uid } from '../util/random';
import { currencies } from '../currency/registry';
import { hasRate, quote, type FxQuote } from '../currency/rates';
import { execute, type PipelineSpec } from './engine';
import { canOperate, getAccountOrThrow, GL } from './accounts';
import { availableOf } from './ledger';
import { actor } from '../context';
import type { Account, Transaction } from '../types';

export interface ExchangeInput {
  fromAccountId: string;
  fromCurrency: string;
  toAccountId: string;
  toCurrency: string;
  amount: number; // minor units of fromCurrency
  onCreated?: (txId: string) => void;
}

export function assertExchangeable(from: string, to: string) {
  for (const c of [from, to]) {
    if (!currencies.isTransactional(c)) throw new BankError('CURRENCY_UNSUPPORTED', { currency: c });
    if (!hasRate(c)) throw new BankError('EXCHANGE_FAILED', { currency: c, reason: 'no rate' });
  }
  if (from === to) throw new BankError('EXCHANGE_FAILED', { reason: 'same currency' });
}

export function canHold(acc: Account, ccy: string) {
  return acc.pockets.includes(ccy) || acc.multiCurrency;
}

export async function exchangeQuote(input: ExchangeInput): Promise<FxQuote> {
  assertExchangeable(input.fromCurrency, input.toCurrency);
  return quote(input.fromCurrency, input.toCurrency, input.amount);
}

export async function exchange(input: ExchangeInput): Promise<Transaction> {
  const from = await getAccountOrThrow(input.fromAccountId);
  const to = await getAccountOrThrow(input.toAccountId);
  if (!canOperate(from) || !canOperate(to)) throw new BankError('PERMISSION_DENIED');
  assertExchangeable(input.fromCurrency, input.toCurrency);
  if (!(input.amount > 0)) throw new BankError('INVALID_AMOUNT');
  if (!canHold(from, input.fromCurrency) || !canHold(to, input.toCurrency)) {
    throw new BankError('CURRENCY_UNSUPPORTED', { currency: !canHold(from, input.fromCurrency) ? input.fromCurrency : input.toCurrency });
  }
  const q = quote(input.fromCurrency, input.toCurrency, input.amount);
  if (!(q.targetAmount > 0)) throw new BankError('EXCHANGE_FAILED', { reason: 'amount too small' });
  const fxId = uid('FX', 10);
  const a = actor();
  const owner = await db.users.get(from.ownerId);
  const spec: PipelineSpec = {
    service: 'exchange',
    onCreated: input.onCreated,
    draft: {
      type: 'fx',
      amount: input.amount,
      currency: input.fromCurrency,
      creditAmount: q.targetAmount,
      creditCurrency: input.toCurrency,
      fee: q.fee,
      feeCurrency: q.feeCurrency,
      fromAccountId: from.id,
      toAccountId: to.id,
      sender: { name: owner?.name ?? a.name, accountNumber: from.number },
      recipient: { name: owner?.name ?? a.name, accountNumber: to.number },
      description: `Exchange ${input.fromCurrency} → ${input.toCurrency}`,
      category: 'transfers',
      channel: 'app',
      fx: {
        id: fxId, midRate: q.midRate, bankRate: q.bankRate, spreadPct: q.spreadPct, sourceCurrency: q.from,
        targetCurrency: q.to, sourceAmount: q.sourceAmount, targetAmount: q.targetAmount,
      },
      refPrefix: 'FXT',
    },
    validate: async () => {
      const avail = await availableOf(from.id, input.fromCurrency);
      if (avail < q.totalDebit) throw new BankError('INSUFFICIENT_FUNDS', { available: avail, required: q.totalDebit, currency: input.fromCurrency });
    },
    plan: () => [
      {
        memo: `FX ${fxId} ${q.from}/${q.to} @ ${q.bankRate.toFixed(6)}`,
        lines: [
          { accountId: from.id, currency: q.from, side: 'D', amount: q.sourceAmount, memo: `FX sell ${q.from}` },
          { accountId: GL.FX, currency: q.from, side: 'C', amount: q.sourceAmount },
          { accountId: GL.FX, currency: q.to, side: 'D', amount: q.targetAmount },
          { accountId: to.id, currency: q.to, side: 'C', amount: q.targetAmount, memo: `FX buy ${q.to}` },
          ...(q.fee > 0
            ? [
                { accountId: from.id, currency: q.from, side: 'D' as const, amount: q.fee, memo: 'FX commission' },
                { accountId: GL.FEES, currency: q.from, side: 'C' as const, amount: q.fee, memo: 'FX commission' },
              ]
            : []),
        ],
      },
    ],
    screen: false,
  };
  return execute(spec);
}
