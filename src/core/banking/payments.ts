/**
 * AETHERLINE — the Exchequer's payment network.
 * Own-account transfers, transfers by account number / client ID / QR / link,
 * money requests, payment links, templates, scheduled transfers, bulk batches
 * and cardless cash codes. Every movement runs through the transaction engine.
 */
import { db } from '../db/db';
import { BankError } from '../errors';
import { nowISO, addDays } from '../clock';
import { uid, randomCode, randomDigits } from '../util/random';
import { actor } from '../context';
import { currencies } from '../currency/registry';
import { quote } from '../currency/rates';
import { execute, type PlannedJournal } from './engine';
import { availableOf, placeHold, releaseHold } from './ledger';
import { canOperate, getAccountOrThrow, GL } from './accounts';
import { isValidAccountNumber, normalizeAccountNumber } from './numbers';
import { canHold } from './fx';
import { audit } from '../ops/audit';
import { notify } from '../comms/notify';
import { getSettings } from '../settings';
import type {
  Account, BudgetCategory, CardlessCode, Channel, MoneyRequest, PaymentLink, ScheduledTransfer, Transaction,
  TransferTemplate, TxType, User,
} from '../types';

export interface RecipientRef {
  accountNumber?: string;
  clientId?: string;
}

export interface ResolvedRecipient {
  account: Account;
  user: User;
}

/** Resolve an Aetherline recipient by account number or client ID. */
export async function resolveRecipient(ref: RecipientRef, currency?: string): Promise<ResolvedRecipient> {
  if (ref.accountNumber) {
    const num = normalizeAccountNumber(ref.accountNumber);
    if (!isValidAccountNumber(num)) throw new BankError('INVALID_ACCOUNT', { account: ref.accountNumber });
    const account = await db.accounts.where('number').equals(num).first();
    if (!account || account.ownerId === 'BANK') throw new BankError('INVALID_RECIPIENT', { account: num });
    if (account.status === 'closed') throw new BankError('INVALID_ACCOUNT', { account: num, reason: 'closed' });
    const user = await db.users.get(account.ownerId);
    if (!user) throw new BankError('INVALID_RECIPIENT', { account: num });
    return { account, user };
  }
  if (ref.clientId) {
    const key = ref.clientId.trim().toUpperCase();
    const user = await db.users.where('clientId').equals(key).first();
    if (!user) throw new BankError('INVALID_RECIPIENT', { clientId: key });
    const accounts = (await db.accounts.where('ownerId').equals(user.id).toArray()).filter(
      (a) => a.status === 'active' && !a.hidden && ['current', 'joint', 'business', 'savings'].includes(a.type),
    );
    const best =
      accounts.find((a) => a.type === 'current' && currency && canHold(a, currency)) ??
      accounts.find((a) => currency && canHold(a, currency)) ??
      accounts.find((a) => a.type === 'current') ??
      accounts[0];
    if (!best) throw new BankError('INVALID_RECIPIENT', { clientId: key, reason: 'no active account' });
    return { account: best, user };
  }
  throw new BankError('INVALID_RECIPIENT');
}

function assertAmount(amount: number) {
  if (!Number.isInteger(amount) || amount <= 0) throw new BankError('INVALID_AMOUNT', { amount });
}

/** Build legs debiting `from` in `currency` and crediting `to` in its currency, converting through FX if needed. */
export function transferLegs(from: Account, to: Account, currency: string, amount: number, fee = 0, toCurrency?: string): {
  journals: PlannedJournal[];
  creditAmount: number;
  creditCurrency: string;
  fx?: Transaction['fx'];
} {
  const creditCurrency = toCurrency ?? (canHold(to, currency) ? currency : to.currency);
  const lines: PlannedJournal['lines'] = [];
  let creditAmount = amount;
  let fx: Transaction['fx'];
  if (creditCurrency === currency) {
    lines.push({ accountId: from.id, currency, side: 'D', amount }, { accountId: to.id, currency, side: 'C', amount });
  } else {
    const q = quote(currency, creditCurrency, amount);
    creditAmount = q.targetAmount;
    fx = {
      id: uid('FX', 10), midRate: q.midRate, bankRate: q.bankRate, spreadPct: q.spreadPct, sourceCurrency: currency,
      targetCurrency: creditCurrency, sourceAmount: amount, targetAmount: q.targetAmount,
    };
    lines.push(
      { accountId: from.id, currency, side: 'D', amount },
      { accountId: GL.FX, currency, side: 'C', amount },
      { accountId: GL.FX, currency: creditCurrency, side: 'D', amount: q.targetAmount },
      { accountId: to.id, currency: creditCurrency, side: 'C', amount: q.targetAmount },
    );
  }
  if (fee > 0) {
    lines.push({ accountId: from.id, currency, side: 'D', amount: fee, memo: 'Fee' }, { accountId: GL.FEES, currency, side: 'C', amount: fee, memo: 'Fee' });
  }
  return { journals: [{ memo: 'Aetherline transfer', lines }], creditAmount, creditCurrency, fx };
}

export interface OwnTransferInput {
  fromAccountId: string;
  toAccountId: string;
  currency: string;
  amount: number;
  targetCurrency?: string;
  description?: string;
  allowFrozen?: boolean;
  onCreated?: (txId: string) => void;
}

export async function transferOwn(input: OwnTransferInput): Promise<Transaction> {
  assertAmount(input.amount);
  if (input.fromAccountId === input.toAccountId && (!input.targetCurrency || input.targetCurrency === input.currency)) {
    throw new BankError('SAME_ACCOUNT');
  }
  const from = await getAccountOrThrow(input.fromAccountId);
  const to = await getAccountOrThrow(input.toAccountId);
  if (!canOperate(from) || !canOperate(to)) throw new BankError('PERMISSION_DENIED');
  if (!currencies.isTransactional(input.currency)) throw new BankError('CURRENCY_UNSUPPORTED', { currency: input.currency });
  if (input.targetCurrency && !canHold(to, input.targetCurrency)) throw new BankError('CURRENCY_UNSUPPORTED', { currency: input.targetCurrency });
  const legs = transferLegs(from, to, input.currency, input.amount, 0, input.targetCurrency);
  const owner = await db.users.get(from.ownerId);
  return execute({
    service: 'transfers',
    onCreated: input.onCreated,
    draft: {
      type: legs.fx ? 'fx' : 'own_transfer',
      amount: input.amount,
      currency: input.currency,
      creditAmount: legs.creditAmount,
      creditCurrency: legs.creditCurrency,
      fromAccountId: from.id,
      toAccountId: to.id,
      sender: { name: owner?.name ?? 'Client', accountNumber: from.number },
      recipient: { name: owner?.name ?? 'Client', accountNumber: to.number },
      description: input.description || `Transfer to ${to.name}`,
      category: 'transfers',
      channel: 'app',
      fx: legs.fx,
    },
    validate: async () => {
      if (from.status === 'frozen' && !input.allowFrozen) throw new BankError('ACCOUNT_FROZEN', { account: from.number });
      const avail = await availableOf(from.id, input.currency);
      if (avail < input.amount) throw new BankError('INSUFFICIENT_FUNDS', { available: avail, required: input.amount, currency: input.currency });
    },
    plan: () => legs.journals.map((j) => ({ ...j, ignoreFreeze: input.allowFrozen })),
    screen: false,
  });
}

export interface TransferInput {
  fromAccountId: string;
  currency: string;
  amount: number;
  recipient: RecipientRef;
  recipientName?: string;
  description?: string;
  purpose?: string;
  userRef?: string;
  type?: TxType;
  channel?: Channel;
  category?: BudgetCategory;
  batchId?: string;
  parentId?: string;
  initiatorId?: string;
  onCreated?: (txId: string) => void;
  skipScreen?: boolean;
  meta?: Record<string, unknown>;
}

/** Aetherline transfer to another client (by account number or client ID). */
export async function transfer(input: TransferInput): Promise<Transaction> {
  assertAmount(input.amount);
  const from = await getAccountOrThrow(input.fromAccountId);
  if (!canOperate(from)) throw new BankError('PERMISSION_DENIED');
  if (!currencies.isTransactional(input.currency)) throw new BankError('CURRENCY_UNSUPPORTED', { currency: input.currency });
  const { account: to, user: recipient } = await resolveRecipient(input.recipient, input.currency);
  if (to.id === from.id) throw new BankError('SAME_ACCOUNT');
  const sameOwner = to.partyIds.some((p) => from.partyIds.includes(p)) && to.ownerId === from.ownerId;
  const fee = sameOwner ? 0 : getSettings().transferFee;
  const legs = transferLegs(from, to, input.currency, input.amount, fee);
  const sender = await db.users.get(from.ownerId);
  return execute({
    service: 'payments',
    onCreated: input.onCreated,
    draft: {
      type: input.type ?? (sameOwner ? 'own_transfer' : 'transfer'),
      amount: input.amount,
      currency: input.currency,
      creditAmount: legs.creditAmount,
      creditCurrency: legs.creditCurrency,
      fee,
      fromAccountId: from.id,
      toAccountId: to.id,
      sender: { name: sender?.name ?? 'Client', accountNumber: from.number, clientId: sender?.clientId },
      recipient: { name: recipient.name, accountNumber: to.number, clientId: recipient.clientId, bank: 'Exchequer of Aldermoor' },
      description: input.description || `Aetherline transfer to ${recipient.name}`,
      purpose: input.purpose,
      userRef: input.userRef,
      category: input.category ?? 'transfers',
      channel: input.channel ?? 'app',
      fx: legs.fx,
      batchId: input.batchId,
      parentId: input.parentId,
      initiatorId: input.initiatorId,
      realm: 'ALD',
      meta: input.meta,
    },
    validate: async () => {
      if (from.status === 'frozen') throw new BankError('ACCOUNT_FROZEN', { account: from.number });
      if (to.status === 'frozen') throw new BankError('INVALID_RECIPIENT', { account: to.number, reason: 'frozen' });
      const avail = await availableOf(from.id, input.currency);
      if (avail < input.amount + fee) throw new BankError('INSUFFICIENT_FUNDS', { available: avail, required: input.amount + fee, currency: input.currency });
    },
    limit: sameOwner ? undefined : { account: from, amount: input.amount, currency: input.currency },
    screen: sameOwner || input.skipScreen ? false : { realm: 'ALD', recipientKey: to.number },
    plan: () => legs.journals,
  });
}

/* ───────────── Templates ───────────── */

export async function saveTemplate(t: Omit<TransferTemplate, 'id' | 'ownerId' | 'createdAt' | 'uses'>) {
  const a = actor();
  if (!t.name.trim()) throw new BankError('VALIDATION', { field: 'name' });
  const tpl: TransferTemplate = { ...t, id: uid('TPL'), ownerId: a.userId, createdAt: nowISO(), uses: 0 };
  await db.templates.add(tpl);
  await audit({ action: 'template.create', object: 'template', objectId: tpl.id, details: t.name });
  return tpl;
}

export async function deleteTemplate(id: string) {
  const t = await db.templates.get(id);
  if (!t || t.ownerId !== actor().userId) throw new BankError('PERMISSION_DENIED');
  await db.templates.delete(id);
  await audit({ action: 'template.delete', object: 'template', objectId: id });
}

export async function markTemplateUsed(id: string) {
  const t = await db.templates.get(id);
  if (t) await db.templates.update(id, { uses: t.uses + 1 });
}

/* ───────────── Scheduled transfers ───────────── */

export async function scheduleTransfer(s: Omit<ScheduledTransfer, 'id' | 'ownerId' | 'status' | 'createdAt'>) {
  assertAmount(s.amount);
  const from = await getAccountOrThrow(s.fromAccountId);
  if (!canOperate(from)) throw new BankError('PERMISSION_DENIED');
  if (s.runAt <= nowISO()) throw new BankError('VALIDATION', { field: 'runAt' });
  await resolveRecipient({ accountNumber: s.recipientAccount }, s.currency);
  const rec: ScheduledTransfer = { ...s, id: uid('SCH'), ownerId: actor().userId, status: 'scheduled', createdAt: nowISO() };
  await db.scheduled.add(rec);
  await audit({ action: 'scheduled.create', object: 'scheduled', objectId: rec.id, details: `${s.amount} ${s.currency} @ ${s.runAt}` });
  return rec;
}

export async function cancelScheduled(id: string) {
  const s = await db.scheduled.get(id);
  if (!s) throw new BankError('NOT_FOUND');
  if (s.ownerId !== actor().userId && !actor().system) throw new BankError('PERMISSION_DENIED');
  if (s.status !== 'scheduled') throw new BankError('INVALID_STATE', { status: s.status });
  await db.scheduled.update(id, { status: 'cancelled' });
  await audit({ action: 'scheduled.cancel', object: 'scheduled', objectId: id });
}

/* ───────────── Money requests ───────────── */

export async function requestMoney(input: { toAccountId: string; payerClientId: string; amount: number; currency: string; note: string }) {
  assertAmount(input.amount);
  const a = actor();
  const acc = await getAccountOrThrow(input.toAccountId);
  if (!canOperate(acc)) throw new BankError('PERMISSION_DENIED');
  const payer = await db.users.where('clientId').equals(input.payerClientId.trim().toUpperCase()).first();
  if (!payer) throw new BankError('INVALID_RECIPIENT', { clientId: input.payerClientId });
  if (payer.id === a.userId) throw new BankError('SAME_ACCOUNT');
  const me = await db.users.get(acc.ownerId);
  const req: MoneyRequest = {
    id: uid('REQ'),
    number: `RQ-${randomCode(6)}`,
    requesterId: acc.ownerId,
    requesterName: me?.name ?? a.name,
    toAccountId: acc.id,
    payerId: payer.id,
    payerName: payer.name,
    amount: input.amount,
    currency: input.currency,
    note: input.note,
    status: 'pending',
    createdAt: nowISO(),
  };
  await db.requests.add(req);
  await audit({ action: 'request.create', object: 'request', objectId: req.id, details: `${input.amount} ${input.currency} from ${payer.clientId}` });
  await notify(payer.id, { category: 'payments', titleKey: 'n.request.in.title', bodyKey: 'n.request.in.body', params: { name: req.requesterName, amt: req.amount, ccy: req.currency, note: req.note }, link: '/payments?tab=requests', priority: 'high' });
  return req;
}

export async function payRequest(id: string, fromAccountId: string, onCreated?: (txId: string) => void) {
  const req = await db.requests.get(id);
  if (!req) throw new BankError('NOT_FOUND');
  if (req.status !== 'pending') throw new BankError('INVALID_STATE', { status: req.status });
  if (req.payerId && req.payerId !== actor().userId) throw new BankError('PERMISSION_DENIED');
  const target = await getAccountOrThrow(req.toAccountId);
  const tx = await transfer({
    fromAccountId, currency: req.currency, amount: req.amount, recipient: { accountNumber: target.number },
    description: `Payment of request ${req.number}: ${req.note}`, type: 'request', onCreated,
  });
  await db.requests.update(id, { status: 'paid', paidAt: nowISO(), txId: tx.id });
  await notify(req.requesterId, { category: 'payments', titleKey: 'n.request.paid.title', bodyKey: 'n.request.paid.body', params: { name: req.payerName, amt: req.amount, ccy: req.currency }, link: `/transactions/${tx.id}` });
  return tx;
}

export async function declineRequest(id: string) {
  const req = await db.requests.get(id);
  if (!req || req.status !== 'pending') throw new BankError('INVALID_STATE');
  const a = actor();
  const isPayer = req.payerId === a.userId;
  const isRequester = req.requesterId === a.userId;
  if (!isPayer && !isRequester) throw new BankError('PERMISSION_DENIED');
  await db.requests.update(id, { status: isPayer ? 'declined' : 'cancelled' });
  await audit({ action: isPayer ? 'request.decline' : 'request.cancel', object: 'request', objectId: id });
  if (isPayer) await notify(req.requesterId, { category: 'payments', titleKey: 'n.request.declined.title', bodyKey: 'n.request.declined.body', params: { name: req.payerName, amt: req.amount, ccy: req.currency } });
}

/* ───────────── Payment links ───────────── */

export async function createPaymentLink(input: { accountId: string; amount?: number; currency: string; description: string; multiUse: boolean; days: number; invoiceId?: string }) {
  const acc = await getAccountOrThrow(input.accountId);
  if (!canOperate(acc)) throw new BankError('PERMISSION_DENIED');
  if (input.amount !== undefined) assertAmount(input.amount);
  const owner = await db.users.get(acc.ownerId);
  const link: PaymentLink = {
    id: uid('LNK'),
    code: `PL-${randomCode(8)}`,
    ownerId: acc.ownerId,
    ownerName: owner?.name ?? 'Client',
    accountId: acc.id,
    amount: input.amount,
    currency: input.currency,
    description: input.description,
    status: 'active',
    multiUse: input.multiUse,
    createdAt: nowISO(),
    expiresAt: addDays(nowISO(), input.days).toISOString(),
    payments: [],
    invoiceId: input.invoiceId,
  };
  await db.links.add(link);
  await audit({ action: 'link.create', object: 'link', objectId: link.id, details: link.code });
  return link;
}

export async function getLink(code: string) {
  return db.links.where('code').equals(code.trim().toUpperCase()).first();
}

export async function payLink(code: string, fromAccountId: string, amountOverride?: number, onCreated?: (txId: string) => void) {
  const link = await getLink(code);
  if (!link) throw new BankError('NOT_FOUND', { link: code });
  if (link.status !== 'active') throw new BankError('INVALID_STATE', { status: link.status });
  if (link.expiresAt < nowISO()) {
    await db.links.update(link.id, { status: 'expired' });
    throw new BankError('DOCUMENT_EXPIRED', { link: code });
  }
  const amount = link.amount ?? amountOverride;
  if (!amount) throw new BankError('INVALID_AMOUNT');
  const target = await getAccountOrThrow(link.accountId);
  if (link.invoiceId) {
    const { payInvoice } = await import('./invoices');
    return payInvoice(link.invoiceId, fromAccountId, onCreated);
  }
  const tx = await transfer({
    fromAccountId, currency: link.currency, amount, recipient: { accountNumber: target.number },
    description: `Payment link ${link.code}: ${link.description}`, type: 'link', channel: 'link', onCreated,
  });
  const payer = await db.users.get(actor().userId);
  await db.links.update(link.id, {
    payments: [...link.payments, { at: nowISO(), txId: tx.id, payerName: payer?.name ?? 'Client', amount }],
    status: link.multiUse ? 'active' : 'paid',
  });
  return tx;
}

export async function cancelLink(id: string) {
  const l = await db.links.get(id);
  if (!l || (l.ownerId !== actor().userId && !actor().system)) throw new BankError('PERMISSION_DENIED');
  await db.links.update(id, { status: 'cancelled' });
  await audit({ action: 'link.cancel', object: 'link', objectId: id });
}

/* ───────────── Bulk payments ───────────── */

export interface BulkRow {
  accountNumber: string;
  name: string;
  amount: number;
  description: string;
}

export async function bulkPay(fromAccountId: string, currency: string, rows: BulkRow[], label = 'Bulk payment', category: BudgetCategory = 'transfers') {
  if (!rows.length) throw new BankError('VALIDATION', { field: 'rows' });
  const from = await getAccountOrThrow(fromAccountId);
  if (!canOperate(from)) throw new BankError('PERMISSION_DENIED');
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const avail = await availableOf(from.id, currency);
  if (avail < total) throw new BankError('INSUFFICIENT_FUNDS', { available: avail, required: total, currency });
  const batchId = uid('BATCH', 8);
  const results: { row: BulkRow; tx?: Transaction; error?: string }[] = [];
  for (const row of rows) {
    try {
      const tx = await transfer({
        fromAccountId, currency, amount: row.amount, recipient: { accountNumber: row.accountNumber },
        description: row.description || label, batchId, type: 'bulk', category, skipScreen: true,
      });
      results.push({ row, tx });
    } catch (e) {
      results.push({ row, error: e instanceof BankError ? e.code : 'TRANSACTION_FAILED' });
    }
  }
  await audit({ action: 'bulk.execute', object: 'batch', objectId: batchId, details: `${results.filter((r) => r.tx).length}/${rows.length} ok` });
  return { batchId, results };
}

/* ───────────── Cardless cash codes ───────────── */

export async function createCardlessCode(accountId: string, currency: string, amount: number) {
  assertAmount(amount);
  const acc = await getAccountOrThrow(accountId);
  if (!canOperate(acc)) throw new BankError('PERMISSION_DENIED');
  const hold = await placeHold({ accountId, currency, amount, reason: 'cardless', description: 'Cardless withdrawal code', expiresAt: addDays(nowISO(), 1).toISOString() });
  const rec: CardlessCode = {
    id: uid('CLS'), code: randomDigits(8), ownerId: acc.ownerId, accountId, currency, amount, holdId: hold.id, status: 'active',
    createdAt: nowISO(), expiresAt: addDays(nowISO(), 1).toISOString(),
  };
  await db.cardless.add(rec);
  await audit({ action: 'cardless.create', object: 'cardless', objectId: rec.id, details: `${amount} ${currency}` });
  return rec;
}

export async function cancelCardless(id: string) {
  const c = await db.cardless.get(id);
  if (!c || c.status !== 'active') throw new BankError('INVALID_STATE');
  if (c.ownerId !== actor().userId && !actor().system) throw new BankError('PERMISSION_DENIED');
  await releaseHold(c.holdId);
  await db.cardless.update(id, { status: 'cancelled' });
  await audit({ action: 'cardless.cancel', object: 'cardless', objectId: id });
}
