/**
 * SIGIL card services: issuance, controls, limits, PIN, wallet tokens, and the
 * card payment flow — Authorization (hold) → Settlement (ledger) → Transaction.
 */
import { db, unitOfWork } from '../db/db';
import { BankError } from '../errors';
import { nowISO, nowMs, now, startOfDayISO, clock } from '../clock';
import { uid, randomCode, randomDigits } from '../util/random';
import { actor } from '../context';
import { hashSecret, newSalt, verifySecret } from '../util/crypto';
import { can } from '../security/permissions';
import { quote, usdTo, toBase } from '../currency/rates';
import { addStep, createTx, finalize, setTxStatus } from './engine';
import { availableOf, placeHold, post, releaseHold } from './ledger';
import { getAccountOrThrow, GL } from './accounts';
import { makeCardNumber } from './numbers';
import { screenTransaction } from '../security/fraud';
import { assertService } from '../ops/system';
import { audit } from '../ops/audit';
import { notify, sendMail } from '../comms/notify';
import { getSettings } from '../settings';
import type { BudgetCategory, Card, CardControls, CardType, Transaction } from '../types';

const TYPE_DIGIT: Record<CardType, number> = { debit: 1, credit: 2, virtual: 3, business: 4, premium: 5, vault: 6 };
const DESIGN: Record<CardType, Card['design']> = { debit: 'emerald', credit: 'burgundy', virtual: 'midnight', business: 'obsidian', premium: 'brass', vault: 'ivory' };

export const DEFAULT_LIMITS: Record<CardType, Card['limits']> = {
  debit: { daily: 300_000, perTx: 150_000, atmDaily: 80_000 },
  credit: { daily: 500_000, perTx: 250_000, atmDaily: 50_000 },
  virtual: { daily: 150_000, perTx: 60_000, atmDaily: 0 },
  business: { daily: 1_500_000, perTx: 700_000, atmDaily: 200_000 },
  premium: { daily: 2_000_000, perTx: 1_000_000, atmDaily: 300_000 },
  vault: { daily: 5_000_000, perTx: 5_000_000, atmDaily: 0 },
};

function canUseCard(card: Card) {
  const a = actor();
  return a.system || card.ownerId === a.userId || can('teller.desk');
}

export async function getCardOrThrow(id: string) {
  const c = await db.cards.get(id);
  if (!c) throw new BankError('NOT_FOUND', { object: 'card' });
  return c;
}

export async function issueCard(input: { accountId: string; type: CardType; holderName?: string; pin: string; ownerId?: string; companyId?: string; silent?: boolean }): Promise<Card> {
  const acc = await getAccountOrThrow(input.accountId);
  const a = actor();
  const ownerId = input.ownerId ?? acc.ownerId;
  if (!a.system && !acc.partyIds.includes(a.userId) && !can('teller.desk')) throw new BankError('PERMISSION_DENIED');
  if (acc.status !== 'active') throw new BankError('ACCOUNT_FROZEN', { account: acc.number });
  if (!/^\d{4}$/.test(input.pin)) throw new BankError('INVALID_PIN');
  if (input.type === 'credit' && acc.type !== 'credit') throw new BankError('VALIDATION', { field: 'account', reason: 'credit account required' });
  if (input.type === 'vault' && acc.type !== 'vault') throw new BankError('VALIDATION', { field: 'account', reason: 'vault account required' });
  const owner = await db.users.get(ownerId);
  const salt = newSalt();
  const n = now();
  const number = makeCardNumber(TYPE_DIGIT[input.type]);
  const card: Card = {
    id: uid('CRD'),
    type: input.type,
    number,
    last4: number.slice(-4),
    holderName: (input.holderName || owner?.name || 'CARDHOLDER').toUpperCase(),
    ownerId,
    accountId: acc.id,
    currency: acc.currency,
    expMonth: n.getUTCMonth() + 1,
    expYear: n.getUTCFullYear() + (input.type === 'virtual' ? 2 : 4),
    cvv: randomDigits(3),
    pinHash: await hashSecret(input.pin, salt),
    pinSalt: salt,
    pinAttempts: 0,
    status: 'active',
    limits: { ...DEFAULT_LIMITS[input.type] },
    controls: { online: true, contactless: input.type !== 'virtual', atm: input.type !== 'virtual' && input.type !== 'vault', international: input.type === 'premium' || input.type === 'business', magstripe: false },
    wallet: { added: false },
    createdAt: nowISO(),
    companyId: input.companyId,
    design: DESIGN[input.type],
    network: 'SIGIL',
  };
  await db.cards.add(card);
  await audit({ action: 'card.issue', object: 'card', objectId: card.id, details: `${card.type} •${card.last4}` });
  if (!input.silent) {
    await notify(ownerId, { category: 'cards', titleKey: 'n.card.issued.title', bodyKey: 'n.card.issued.body', params: { last4: card.last4, type: card.type }, link: `/cards/${card.id}` });
    await sendMail(ownerId, 'card_issued', { last4: card.last4, type: card.type });
  }
  return card;
}

async function updateCard(id: string, patch: Partial<Card>, action: string, details?: string) {
  const card = await getCardOrThrow(id);
  if (!canUseCard(card)) throw new BankError('PERMISSION_DENIED');
  await db.cards.update(id, patch);
  await audit({ action, object: 'card', objectId: id, details: details ?? `•${card.last4}` });
  return { ...card, ...patch };
}

export async function freezeCard(id: string) {
  const c = await getCardOrThrow(id);
  if (c.status !== 'active') throw new BankError('INVALID_STATE', { status: c.status });
  await updateCard(id, { status: 'frozen' }, 'card.freeze');
  await notify(c.ownerId, { category: 'cards', titleKey: 'n.card.frozen.title', bodyKey: 'n.card.frozen.body', params: { last4: c.last4 }, link: `/cards/${id}` });
}

export async function unfreezeCard(id: string) {
  const c = await getCardOrThrow(id);
  if (c.status !== 'frozen') throw new BankError('INVALID_STATE', { status: c.status });
  await updateCard(id, { status: 'active' }, 'card.unfreeze');
  await notify(c.ownerId, { category: 'cards', titleKey: 'n.card.unfrozen.title', bodyKey: 'n.card.unfrozen.body', params: { last4: c.last4 }, link: `/cards/${id}` });
}

export async function blockCard(id: string, reason: string) {
  const c = await getCardOrThrow(id);
  await updateCard(id, { status: 'blocked' }, 'card.block', reason);
  await notify(c.ownerId, { category: 'security', titleKey: 'n.card.blocked.title', bodyKey: 'n.card.blocked.body', params: { last4: c.last4, reason }, link: `/cards/${id}`, priority: 'high' });
}

/** Replace (lost/damaged/compromised): new number, old card retired. */
export async function replaceCard(id: string, reason: string, pin: string) {
  const old = await getCardOrThrow(id);
  if (!canUseCard(old)) throw new BankError('PERMISSION_DENIED');
  if (old.status === 'replaced' || old.status === 'expired') throw new BankError('INVALID_STATE', { status: old.status });
  const next = await issueCard({ accountId: old.accountId, type: old.type, holderName: old.holderName, pin, ownerId: old.ownerId, companyId: old.companyId, silent: true });
  await db.cards.update(next.id, { replacesId: old.id, limits: old.limits, controls: old.controls });
  await db.cards.update(old.id, { status: 'replaced', replacedById: next.id, wallet: { added: false } });
  await audit({ action: 'card.replace', object: 'card', objectId: old.id, details: `${reason} → •${next.last4}` });
  await notify(old.ownerId, { category: 'cards', titleKey: 'n.card.replaced.title', bodyKey: 'n.card.replaced.body', params: { old: old.last4, last4: next.last4 }, link: `/cards/${next.id}` });
  return next;
}

/** Renew: same number, new expiry and CVV. */
export async function renewCard(id: string) {
  const c = await getCardOrThrow(id);
  if (c.status === 'replaced' || c.status === 'blocked') throw new BankError('INVALID_STATE', { status: c.status });
  const n = now();
  const patch: Partial<Card> = { expMonth: n.getUTCMonth() + 1, expYear: n.getUTCFullYear() + 4, cvv: randomDigits(3), status: c.status === 'expired' ? 'active' : c.status };
  await updateCard(id, patch, 'card.renew');
  await notify(c.ownerId, { category: 'cards', titleKey: 'n.card.renewed.title', bodyKey: 'n.card.renewed.body', params: { last4: c.last4, exp: `${String(patch.expMonth).padStart(2, '0')}/${String(patch.expYear).slice(2)}` }, link: `/cards/${id}` });
}

export async function setCardLimits(id: string, limits: Card['limits']) {
  for (const v of Object.values(limits)) if (!Number.isInteger(v) || v < 0) throw new BankError('INVALID_AMOUNT');
  await updateCard(id, { limits }, 'card.limits', JSON.stringify(limits));
}

export async function setCardControls(id: string, controls: CardControls) {
  await updateCard(id, { controls }, 'card.controls', Object.entries(controls).filter(([, v]) => v).map(([k]) => k).join(','));
}

export async function changeCardPin(id: string, oldPin: string, newPin: string) {
  const c = await getCardOrThrow(id);
  if (!canUseCard(c)) throw new BankError('PERMISSION_DENIED');
  if (!/^\d{4}$/.test(newPin)) throw new BankError('INVALID_PIN');
  if (!(await verifySecret(oldPin, c.pinSalt, c.pinHash))) {
    await registerPinFailure(c);
    throw new BankError('INVALID_PIN');
  }
  const salt = newSalt();
  await updateCard(id, { pinHash: await hashSecret(newPin, salt), pinSalt: salt, pinAttempts: 0 }, 'card.pin_change');
  await notify(c.ownerId, { category: 'security', titleKey: 'n.card.pin.title', bodyKey: 'n.card.pin.body', params: { last4: c.last4 }, priority: 'high' });
}

export async function registerPinFailure(c: Card) {
  const attempts = c.pinAttempts + 1;
  const patch: Partial<Card> = { pinAttempts: attempts };
  if (attempts >= 3) patch.status = 'blocked';
  await db.cards.update(c.id, patch);
  await audit({ action: 'card.pin_failure', object: 'card', objectId: c.id, result: 'failure', details: `attempt ${attempts}` });
  if (attempts >= 3) {
    await notify(c.ownerId, { category: 'security', titleKey: 'n.card.blocked.title', bodyKey: 'n.card.blocked.body', params: { last4: c.last4, reason: 'PIN' }, priority: 'high' });
  }
}

export async function checkCardPin(c: Card, pin: string): Promise<boolean> {
  if (c.status === 'blocked') throw new BankError('CARD_BLOCKED', { last4: c.last4 });
  const ok = await verifySecret(pin, c.pinSalt, c.pinHash);
  if (!ok) {
    await registerPinFailure(c);
    return false;
  }
  if (c.pinAttempts) await db.cards.update(c.id, { pinAttempts: 0 });
  return true;
}

export async function addToWallet(id: string, device: string) {
  const c = await getCardOrThrow(id);
  if (c.status !== 'active') throw new BankError('CARD_BLOCKED', { last4: c.last4 });
  await updateCard(id, { wallet: { added: true, token: `TKN-${randomCode(12)}`, device, addedAt: nowISO() } }, 'card.wallet_add', device);
}

export async function removeFromWallet(id: string) {
  await updateCard(id, { wallet: { added: false } }, 'card.wallet_remove');
}

/* ───────────── Card payments ───────────── */

export type CardChannel = 'online' | 'contactless' | 'chip' | 'magstripe' | 'atm';

export interface CardPaymentInput {
  cardId: string;
  merchant: string;
  mcc: string;
  realm: string;
  amount: number;
  currency: string;
  channel: CardChannel;
  category: BudgetCategory;
  pin?: string;
  settleNow?: boolean;
  onCreated?: (txId: string) => void;
}

async function cardSpentToday(cardId: string, card: Card) {
  const since = startOfDayISO(now());
  const txs = (await db.transactions.where('createdAt').aboveOrEqual(since).toArray())
    .filter((t) => t.cardId === cardId && ['completed', 'processing', 'pending'].includes(t.status));
  return {
    all: txs.filter((t) => t.type === 'card_payment').reduce((s, t) => s + toBase(t.amount, t.currency, card.currency), 0),
    atm: txs.filter((t) => t.type === 'atm_withdrawal').reduce((s, t) => s + toBase(t.amount, t.currency, card.currency), 0),
  };
}

/** Validate a card for an operation; throws precise errors. */
export async function authorizeCardUse(card: Card, channel: CardChannel, realm: string, amountInCardCcy: number) {
  if (card.status === 'blocked' || card.status === 'replaced') throw new BankError('CARD_BLOCKED', { last4: card.last4, status: card.status });
  if (card.status === 'frozen') throw new BankError('CARD_BLOCKED', { last4: card.last4, status: 'frozen' });
  const n = now();
  if (card.expYear < n.getUTCFullYear() || (card.expYear === n.getUTCFullYear() && card.expMonth < n.getUTCMonth() + 1) || card.status === 'expired') {
    throw new BankError('CARD_BLOCKED', { last4: card.last4, status: 'expired' });
  }
  const c = card.controls;
  if (channel === 'online' && !c.online) throw new BankError('CARD_CONTROL_DISABLED', { control: 'online' });
  if (channel === 'contactless' && !c.contactless) throw new BankError('CARD_CONTROL_DISABLED', { control: 'contactless' });
  if (channel === 'magstripe' && !c.magstripe) throw new BankError('CARD_CONTROL_DISABLED', { control: 'magstripe' });
  if (channel === 'atm' && !c.atm) throw new BankError('CARD_CONTROL_DISABLED', { control: 'atm' });
  if (realm !== 'ALD' && !c.international) throw new BankError('CARD_CONTROL_DISABLED', { control: 'international' });
  if (card.type === 'virtual' && channel !== 'online') throw new BankError('CARD_CONTROL_DISABLED', { control: 'virtual_online_only' });
  const spent = await cardSpentToday(card.id, card);
  if (channel === 'atm') {
    if (spent.atm + amountInCardCcy > card.limits.atmDaily) throw new BankError('CARD_LIMIT_EXCEEDED', { limit: 'atmDaily', value: card.limits.atmDaily });
  } else {
    if (amountInCardCcy > card.limits.perTx) throw new BankError('CARD_LIMIT_EXCEEDED', { limit: 'perTx', value: card.limits.perTx });
    if (spent.all + amountInCardCcy > card.limits.daily) throw new BankError('CARD_LIMIT_EXCEEDED', { limit: 'daily', value: card.limits.daily });
  }
}

/**
 * Card payment at a merchant. Authorization places a hold on the account;
 * settlement (now or later by the scheduler) captures the hold and posts the journal.
 */
export async function cardPayment(input: CardPaymentInput): Promise<Transaction> {
  if (clock.isInstant() && input.pin === undefined) return unitOfWork(() => runCardPayment(input));
  return runCardPayment(input);
}

async function runCardPayment(input: CardPaymentInput): Promise<Transaction> {
  assertService('cards');
  const card = await getCardOrThrow(input.cardId);
  if (!canUseCard(card)) throw new BankError('PERMISSION_DENIED');
  const acc = await getAccountOrThrow(card.accountId);
  const conv = input.currency !== card.currency;
  const q = conv ? quote(input.currency, card.currency, input.amount) : null;
  const billed = q ? q.targetAmount : input.amount;
  const fxFee = conv ? usdTo(getSettings().atmForeignFeeUSD / 5, card.currency) : 0;
  const owner = await db.users.get(card.ownerId);
  const tx = await createTx({
    type: 'card_payment',
    amount: billed,
    currency: card.currency,
    fee: fxFee,
    feeCurrency: card.currency,
    fromAccountId: acc.id,
    sender: { name: owner?.name ?? card.holderName, accountNumber: acc.number },
    recipient: { name: input.merchant, realm: input.realm },
    description: `${input.merchant}${conv ? ` (${(input.amount / 100).toFixed(2)} ${input.currency})` : ''}`,
    category: input.category,
    channel: 'card',
    merchant: { name: input.merchant, mcc: input.mcc, realm: input.realm },
    cardId: card.id,
    realm: input.realm,
    fx: q ? { id: uid('FX', 10), midRate: q.midRate, bankRate: q.bankRate, spreadPct: q.spreadPct, sourceCurrency: input.currency, targetCurrency: card.currency, sourceAmount: input.amount, targetAmount: q.targetAmount } : undefined,
    meta: { channel: input.channel, originalAmount: input.amount, originalCurrency: input.currency },
    refPrefix: 'SIG',
  });
  input.onCreated?.(tx.id);
  try {
    if ((input.channel === 'chip' || input.channel === 'magstripe') && input.pin !== undefined) {
      if (!(await checkCardPin(card, input.pin))) throw new BankError('INVALID_PIN');
    }
    await authorizeCardUse(card, input.channel, input.realm, billed);
    await addStep(tx.id, 'validated');
    const a = actor();
    const risk = await screenTransaction({ userId: card.ownerId, userName: owner?.name ?? '', amount: billed, currency: card.currency, type: 'card_payment', realm: input.realm, deviceId: a.deviceId, recipientKey: input.merchant, txId: tx.id });
    if (risk.action === 'block') {
      await db.transactions.update(tx.id, { risk });
      throw new BankError('FRAUD_BLOCKED', { score: risk.score });
    }
    await addStep(tx.id, 'screened', true, { risk });
    const avail = await availableOf(acc.id, card.currency);
    if (avail < billed + fxFee) throw new BankError('INSUFFICIENT_FUNDS', { available: avail, required: billed + fxFee, currency: card.currency });
    const hold = await placeHold({ accountId: acc.id, currency: card.currency, amount: billed + fxFee, reason: 'card_auth', txId: tx.id, description: `Authorization ${input.merchant}` });
    await setTxStatus(tx.id, 'processing', 'authorized', true, { holdId: hold.id }, `AUTH ${randomDigits(6)}`);
    await addStep(tx.id, 'held', true);
    await audit({ action: 'card.authorize', object: 'card', objectId: card.id, txId: tx.id, details: `${billed} ${card.currency} @ ${input.merchant}` });
    if (input.settleNow ?? getSettings().processingSpeed === 'instant') await settleCardTx(tx.id);
    return (await db.transactions.get(tx.id))!;
  } catch (e) {
    const err = e instanceof BankError ? e : new BankError('TRANSACTION_FAILED');
    const cur = await db.transactions.get(tx.id);
    if (cur && cur.status !== 'completed') {
      await setTxStatus(tx.id, ['INSUFFICIENT_FUNDS', 'INVALID_PIN'].includes(err.code) ? 'failed' : 'rejected', 'rejected', false, { error: { code: err.code, params: err.params } }, err.code);
      await audit({ action: 'card.authorize', object: 'card', objectId: card.id, txId: tx.id, result: 'failure', details: err.code });
      await notify(card.ownerId, { category: 'cards', titleKey: 'n.card.declined.title', bodyKey: 'n.card.declined.body', params: { last4: card.last4, merchant: input.merchant, code: err.code, amt: billed, ccy: card.currency }, link: `/transactions/${tx.id}`, priority: 'high' });
    }
    err.params = { ...err.params, txId: tx.id };
    throw err;
  }
}

/** Settlement: capture the authorization hold and post the journal. */
export async function settleCardTx(txId: string) {
  const tx = await db.transactions.get(txId);
  if (!tx || tx.type !== 'card_payment' || tx.status !== 'processing' || !tx.holdId) return;
  const lines = [
    { accountId: tx.fromAccountId!, currency: tx.currency, side: 'D' as const, amount: tx.amount },
    { accountId: GL.CARDS, currency: tx.currency, side: 'C' as const, amount: tx.amount },
    ...(tx.fee > 0
      ? [
          { accountId: tx.fromAccountId!, currency: tx.currency, side: 'D' as const, amount: tx.fee, memo: 'Foreign transaction fee' },
          { accountId: GL.FEES, currency: tx.currency, side: 'C' as const, amount: tx.fee, memo: 'Foreign transaction fee' },
        ]
      : []),
  ];
  const journal = await post({ txId: tx.id, ref: tx.ref, memo: `Card settlement ${tx.merchant?.name ?? ''}`, lines, captureHoldIds: [tx.holdId], allowOverdraft: true, ignoreFreeze: true });
  await addStep(tx.id, 'settled', true, { journalIds: [...tx.journalIds, journal.id] });
  await setTxStatus(tx.id, 'completed', 'completed', true);
  await finalize((await db.transactions.get(tx.id))!, true, true);
}

/** Scheduler hook: settle authorizations older than the settlement window. */
export async function settleDueCardAuthorizations() {
  const cutoff = new Date(nowMs() - getSettings().cardSettlementSeconds * 1000).toISOString();
  const due = await db.transactions.where('status').equals('processing')
    .filter((t) => t.type === 'card_payment' && t.updatedAt <= cutoff).toArray();
  for (const t of due) await settleCardTx(t.id);
  return due.length;
}

/** Void an authorization before settlement (merchant reversal). */
export async function voidCardAuthorization(txId: string) {
  const tx = await db.transactions.get(txId);
  if (!tx || tx.type !== 'card_payment' || tx.status !== 'processing') throw new BankError('INVALID_STATE');
  if (tx.holdId) await releaseHold(tx.holdId);
  await setTxStatus(txId, 'cancelled', 'released', false, {}, 'authorization voided');
  await audit({ action: 'card.void', object: 'transaction', objectId: txId, txId });
}

/** An authorization that was never captured by the merchant expires and its hold is released. */
export async function expireCardAuthorization(txId: string) {
  const tx = await db.transactions.get(txId);
  if (!tx || tx.type !== 'card_payment' || tx.status !== 'processing') throw new BankError('INVALID_STATE');
  if (tx.holdId) await releaseHold(tx.holdId);
  await setTxStatus(txId, 'expired', 'expired', false, {}, 'authorization not captured');
  await audit({ action: 'card.auth_expired', object: 'transaction', objectId: txId, txId });
}

export async function expireCards() {
  const n = now();
  const y = n.getUTCFullYear(), m = n.getUTCMonth() + 1;
  let count = 0;
  const due = (await db.cards.where('status').anyOf('active', 'frozen').toArray()).filter((c) => c.expYear < y || (c.expYear === y && c.expMonth < m));
  for (const c of due) {
    await db.cards.update(c.id, { status: 'expired' });
    count++;
  }
  return count;
}
