/**
 * Cash operations: ATM network, teller desk (cashier), and cash management.
 * Physical cash in each branch vault and each ATM is a debit-normal GL account,
 * so cash inventory is always derived from the ledger.
 */
import { db } from '../db/db';
import { BankError } from '../errors';
import { nowISO } from '../clock';
import { uid } from '../util/random';
import { actor } from '../context';
import { requirePermission } from '../security/permissions';
import { quote, usdTo } from '../currency/rates';
import { fromMinor } from '../currency/format';
import { currencies } from '../currency/registry';
import { execute } from './engine';
import { availableOf, balanceOf } from './ledger';
import { getAccountOrThrow, GL } from './accounts';
import { authorizeCardUse, checkCardPin, getCardOrThrow } from './cards';
import { createDocument, saveDocumentVersion, element } from '../docs/documents';
import { archiveCode, shelfMark } from './numbers';
import { assertService } from '../ops/system';
import { audit } from '../ops/audit';
import { getSettings } from '../settings';
import { sealById } from '../docs/seals';
import type { Transaction } from '../types';

/** Cash on hand at a location (positive number), derived from the ledger. */
export async function cashOnHand(glAccountId: string, currency: string): Promise<number> {
  return -(await balanceOf(glAccountId, currency));
}

export async function cashInventory(glAccountId: string) {
  const acc = await db.accounts.get(glAccountId);
  if (!acc) return [];
  const rows = await db.balances.where('accountId').equals(glAccountId).toArray();
  return rows.map((r) => ({ currency: r.currency, amount: -r.balance })).filter((r) => r.amount !== 0);
}

/* ───────────── ATM ───────────── */

export async function atmVerifyPin(cardId: string, pin: string) {
  assertService('atm');
  const card = await getCardOrThrow(cardId);
  if (card.status === 'blocked') throw new BankError('CARD_BLOCKED', { last4: card.last4, status: 'blocked' });
  if (card.status === 'frozen') throw new BankError('CARD_BLOCKED', { last4: card.last4, status: 'frozen' });
  const ok = await checkCardPin(card, pin);
  if (!ok) {
    const fresh = await getCardOrThrow(cardId);
    throw new BankError(fresh.status === 'blocked' ? 'CARD_BLOCKED' : 'INVALID_PIN', { attemptsLeft: Math.max(0, 3 - fresh.pinAttempts), last4: card.last4, status: fresh.status });
  }
  await audit({ action: 'atm.pin_ok', object: 'card', objectId: cardId });
  return card;
}

async function atmOrThrow(atmId: string) {
  const atm = await db.atms.get(atmId);
  if (!atm) throw new BankError('NOT_FOUND', { object: 'atm' });
  if (atm.status === 'offline' || atm.status === 'maintenance') throw new BankError('NETWORK_UNAVAILABLE', { atm: atm.code });
  return atm;
}

export async function atmWithdraw(atmId: string, cardId: string, amount: number, cashCurrency?: string): Promise<Transaction> {
  assertService('atm');
  const atm = await atmOrThrow(atmId);
  const card = await getCardOrThrow(cardId);
  const acc = await getAccountOrThrow(card.accountId);
  const ccy = cashCurrency ?? card.currency;
  if (!atm.currencies.includes(ccy)) throw new BankError('CURRENCY_UNSUPPORTED', { currency: ccy });
  if (!(amount > 0)) throw new BankError('INVALID_AMOUNT');
  const conv = ccy !== card.currency;
  const q = conv ? quote(card.currency, ccy, 1_000_000) : null;
  // amount is in the cash currency; the account is debited in the card currency at the bank rate
  const debitMinor = conv
    ? Math.ceil((fromMinor(amount, ccy) / q!.bankRate) * Math.pow(10, currencies.decimals(card.currency)))
    : amount;
  const fee = conv ? usdTo(getSettings().atmForeignFeeUSD, card.currency) : 0;
  const onHand = await cashOnHand(atm.cashAccountId, ccy);
  const owner = await db.users.get(card.ownerId);
  return execute({
    service: 'atm',
    draft: {
      type: 'atm_withdrawal', amount: debitMinor, currency: card.currency, creditAmount: amount, creditCurrency: ccy, fee,
      fromAccountId: acc.id, sender: { name: owner?.name ?? card.holderName, accountNumber: acc.number },
      recipient: { name: `ATM ${atm.code}`, realm: 'ALD' }, description: `Cash withdrawal at ${atm.name}`, category: 'cash',
      channel: 'atm', cardId: card.id, realm: 'ALD',
      fx: conv ? { id: uid('FX', 10), midRate: q!.midRate, bankRate: q!.bankRate, spreadPct: q!.spreadPct, sourceCurrency: card.currency, targetCurrency: ccy, sourceAmount: debitMinor, targetAmount: amount } : undefined,
      meta: { atmId },
      refPrefix: 'ATM',
    },
    validate: async () => {
      await authorizeCardUse(card, 'atm', 'ALD', debitMinor);
      if (onHand < amount) throw new BankError('ATM_CASH_UNAVAILABLE', { available: onHand, currency: ccy });
      const avail = await availableOf(acc.id, card.currency);
      if (avail < debitMinor + fee) throw new BankError('INSUFFICIENT_FUNDS', { available: avail, required: debitMinor + fee, currency: card.currency });
    },
    screen: false,
    plan: () => [{
      memo: `ATM ${atm.code} withdrawal`,
      lines: conv
        ? [
            { accountId: acc.id, currency: card.currency, side: 'D', amount: debitMinor },
            { accountId: GL.FX, currency: card.currency, side: 'C', amount: debitMinor },
            { accountId: GL.FX, currency: ccy, side: 'D', amount },
            { accountId: atm.cashAccountId, currency: ccy, side: 'C', amount },
            ...(fee ? [{ accountId: acc.id, currency: card.currency, side: 'D' as const, amount: fee }, { accountId: GL.FEES, currency: card.currency, side: 'C' as const, amount: fee }] : []),
          ]
        : [
            { accountId: acc.id, currency: ccy, side: 'D', amount },
            { accountId: atm.cashAccountId, currency: ccy, side: 'C', amount },
          ],
    }],
  });
}

export async function atmDeposit(atmId: string, cardId: string, amount: number, currency: string): Promise<Transaction> {
  assertService('atm');
  const atm = await atmOrThrow(atmId);
  const card = await getCardOrThrow(cardId);
  const acc = await getAccountOrThrow(card.accountId);
  if (!atm.currencies.includes(currency)) throw new BankError('CURRENCY_UNSUPPORTED', { currency });
  if (!(amount > 0)) throw new BankError('INVALID_AMOUNT');
  const owner = await db.users.get(card.ownerId);
  const conv = currency !== card.currency && !acc.multiCurrency;
  const q = conv ? quote(currency, card.currency, amount) : null;
  return execute({
    service: 'atm',
    draft: {
      type: 'atm_deposit', amount, currency, creditAmount: q?.targetAmount ?? amount, creditCurrency: conv ? card.currency : currency,
      toAccountId: acc.id, sender: { name: owner?.name ?? card.holderName }, recipient: { name: owner?.name ?? card.holderName, accountNumber: acc.number },
      description: `Cash deposit at ${atm.name}`, category: 'cash', channel: 'atm', cardId: card.id, realm: 'ALD', meta: { atmId }, refPrefix: 'ATM',
      fx: q ? { id: uid('FX', 10), midRate: q.midRate, bankRate: q.bankRate, spreadPct: q.spreadPct, sourceCurrency: currency, targetCurrency: card.currency, sourceAmount: amount, targetAmount: q.targetAmount } : undefined,
    },
    validate: async () => {
      if (card.status !== 'active') throw new BankError('CARD_BLOCKED', { last4: card.last4, status: card.status });
    },
    screen: false,
    plan: () => [{
      memo: `ATM ${atm.code} deposit`,
      lines: conv
        ? [
            { accountId: atm.cashAccountId, currency, side: 'D', amount },
            { accountId: GL.FX, currency, side: 'C', amount },
            { accountId: GL.FX, currency: card.currency, side: 'D', amount: q!.targetAmount },
            { accountId: acc.id, currency: card.currency, side: 'C', amount: q!.targetAmount },
          ]
        : [
            { accountId: atm.cashAccountId, currency, side: 'D', amount },
            { accountId: acc.id, currency, side: 'C', amount },
          ],
    }],
  });
}

export async function atmCardlessWithdraw(atmId: string, code: string): Promise<Transaction> {
  assertService('atm');
  const atm = await atmOrThrow(atmId);
  const rec = await db.cardless.where('code').equals(code.trim()).first();
  if (!rec || rec.status !== 'active') throw new BankError('VERIFICATION_FAILED', { code: 'cardless' });
  if (rec.expiresAt < nowISO()) {
    await db.cardless.update(rec.id, { status: 'expired' });
    throw new BankError('DOCUMENT_EXPIRED', { code: 'cardless' });
  }
  const acc = await getAccountOrThrow(rec.accountId);
  if (!atm.currencies.includes(rec.currency)) throw new BankError('CURRENCY_UNSUPPORTED', { currency: rec.currency });
  const onHand = await cashOnHand(atm.cashAccountId, rec.currency);
  if (onHand < rec.amount) throw new BankError('ATM_CASH_UNAVAILABLE', { available: onHand, currency: rec.currency });
  const owner = await db.users.get(rec.ownerId);
  const tx = await execute({
    service: 'atm',
    draft: {
      type: 'atm_withdrawal', amount: rec.amount, currency: rec.currency, fromAccountId: acc.id,
      sender: { name: owner?.name ?? 'Client', accountNumber: acc.number }, recipient: { name: `ATM ${atm.code}` },
      description: `Cardless withdrawal at ${atm.name}`, category: 'cash', channel: 'atm', realm: 'ALD', meta: { atmId, cardless: rec.code },
      initiatorId: rec.ownerId, partyIds: [rec.ownerId], refPrefix: 'ATM',
    },
    screen: false,
    plan: () => [{ memo: 'Cardless withdrawal', captureHoldIds: [rec.holdId], lines: [
      { accountId: acc.id, currency: rec.currency, side: 'D', amount: rec.amount },
      { accountId: atm.cashAccountId, currency: rec.currency, side: 'C', amount: rec.amount },
    ] }],
  });
  await db.cardless.update(rec.id, { status: 'used', txId: tx.id });
  return tx;
}

export async function miniStatement(cardId: string) {
  const card = await getCardOrThrow(cardId);
  const txs = await db.transactions.where('partyIds').equals(card.ownerId).filter((t) => t.fromAccountId === card.accountId || t.toAccountId === card.accountId).toArray();
  return txs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);
}

export async function replenishAtm(atmId: string, currency: string, amount: number) {
  requirePermission('cash.manage');
  const atm = await db.atms.get(atmId);
  if (!atm) throw new BankError('NOT_FOUND');
  const branch = await db.branches.get(atm.branchId);
  if (!branch) throw new BankError('NOT_FOUND');
  const vault = await cashOnHand(branch.cashAccountId, currency);
  if (vault < amount) throw new BankError('ATM_CASH_UNAVAILABLE', { available: vault, currency });
  const tx = await execute({
    draft: {
      type: 'cash_transfer', amount, currency, fromAccountId: branch.cashAccountId, toAccountId: atm.cashAccountId,
      sender: { name: branch.name }, recipient: { name: `ATM ${atm.code}` }, description: `Replenishment of ATM ${atm.code}`,
      category: 'cash', channel: 'branch', refPrefix: 'CMS',
    },
    screen: false, receipt: false, notifyParties: false,
    plan: () => [{ memo: 'ATM replenishment', allowOverdraft: true, lines: [
      { accountId: atm.cashAccountId, currency, side: 'D', amount },
      { accountId: branch.cashAccountId, currency, side: 'C', amount },
    ] }],
  });
  if (atm.status === 'low_cash') await db.atms.update(atmId, { status: 'online' });
  return tx;
}

export async function moveVaultCash(fromGl: string, toGl: string, currency: string, amount: number, note: string) {
  requirePermission('cash.manage');
  const avail = await cashOnHand(fromGl, currency);
  if (avail < amount) throw new BankError('ATM_CASH_UNAVAILABLE', { available: avail, currency });
  const from = await getAccountOrThrow(fromGl);
  const to = await getAccountOrThrow(toGl);
  return execute({
    draft: { type: 'cash_transfer', amount, currency, fromAccountId: fromGl, toAccountId: toGl, sender: { name: from.name }, recipient: { name: to.name }, description: note || 'Cash movement', category: 'cash', channel: 'branch', refPrefix: 'CMS' },
    screen: false, receipt: false, notifyParties: false,
    plan: () => [{ memo: note || 'Cash movement', allowOverdraft: true, lines: [
      { accountId: toGl, currency, side: 'D', amount },
      { accountId: fromGl, currency, side: 'C', amount },
    ] }],
  });
}

/* ───────────── Teller desk ───────────── */

export async function tellerCashDeposit(branchId: string, accountId: string, currency: string, amount: number, depositor: string): Promise<Transaction> {
  requirePermission('teller.desk');
  const branch = await db.branches.get(branchId);
  if (!branch) throw new BankError('NOT_FOUND', { object: 'branch' });
  const acc = await getAccountOrThrow(accountId);
  if (!(amount > 0)) throw new BankError('INVALID_AMOUNT');
  const owner = await db.users.get(acc.ownerId);
  return execute({
    draft: {
      type: 'cash_deposit', amount, currency, toAccountId: acc.id, sender: { name: depositor || owner?.name || 'Depositor' },
      recipient: { name: owner?.name ?? 'Client', accountNumber: acc.number, clientId: owner?.clientId },
      description: `Cash deposit at ${branch.name} (teller ${actor().name})`, category: 'cash', channel: 'branch', meta: { branchId }, refPrefix: 'TLR',
      partyIds: [acc.ownerId],
    },
    validate: async () => {
      if (acc.status === 'closed') throw new BankError('INVALID_ACCOUNT');
    },
    screen: false,
    plan: () => [{ memo: `Teller cash-in ${branch.code}`, lines: [
      { accountId: branch.cashAccountId, currency, side: 'D', amount },
      { accountId: acc.id, currency, side: 'C', amount },
    ] }],
  });
}

export async function tellerCashWithdrawal(branchId: string, accountId: string, currency: string, amount: number, identityVerified: boolean): Promise<Transaction> {
  requirePermission('teller.desk');
  if (!identityVerified) throw new BankError('VERIFICATION_FAILED', { reason: 'identity' });
  const branch = await db.branches.get(branchId);
  if (!branch) throw new BankError('NOT_FOUND', { object: 'branch' });
  const acc = await getAccountOrThrow(accountId);
  if (!(amount > 0)) throw new BankError('INVALID_AMOUNT');
  const owner = await db.users.get(acc.ownerId);
  const vault = await cashOnHand(branch.cashAccountId, currency);
  return execute({
    draft: {
      type: 'cash_withdrawal', amount, currency, fromAccountId: acc.id, sender: { name: owner?.name ?? 'Client', accountNumber: acc.number, clientId: owner?.clientId },
      recipient: { name: `${branch.name} cash desk` }, description: `Cash withdrawal at ${branch.name} (teller ${actor().name})`,
      category: 'cash', channel: 'branch', meta: { branchId }, refPrefix: 'TLR', partyIds: [acc.ownerId],
    },
    validate: async () => {
      if (vault < amount) throw new BankError('ATM_CASH_UNAVAILABLE', { available: vault, currency });
      const avail = await availableOf(acc.id, currency);
      if (avail < amount) throw new BankError('INSUFFICIENT_FUNDS', { available: avail, required: amount, currency });
    },
    screen: false,
    plan: () => [{ memo: `Teller cash-out ${branch.code}`, lines: [
      { accountId: acc.id, currency, side: 'D', amount },
      { accountId: branch.cashAccountId, currency, side: 'C', amount },
    ] }],
  });
}

export interface ClientVerification {
  ok: boolean;
  kyc: string;
  matchedDocument?: string;
  reasons: string[];
}

export async function verifyClientIdentity(userId: string, presentedDocNumber: string): Promise<ClientVerification> {
  requirePermission('teller.desk');
  const user = await db.users.get(userId);
  if (!user) throw new BankError('NOT_FOUND');
  const docs = await db.kyc.where('userId').equals(userId).toArray();
  const match = docs.find((d) => d.docNumber.replace(/\s/g, '').toUpperCase() === presentedDocNumber.replace(/\s/g, '').toUpperCase());
  const reasons: string[] = [];
  if (!match) reasons.push('document_mismatch');
  if (match && match.status !== 'verified') reasons.push(`kyc_${match.status}`);
  if (match && match.expiryDate < nowISO().slice(0, 10)) reasons.push('document_expired');
  if (user.status !== 'active') reasons.push(`client_${user.status}`);
  const ok = reasons.length === 0;
  await audit({ action: 'teller.verify_client', object: 'user', objectId: userId, result: ok ? 'success' : 'failure', details: reasons.join(',') || 'match' });
  return { ok, kyc: user.kycStatus, matchedDocument: match?.docType, reasons };
}

export async function tellerAcceptDocument(clientUserId: string, title: string, description: string) {
  requirePermission('teller.desk');
  const user = await db.users.get(clientUserId);
  if (!user) throw new BankError('NOT_FOUND');
  if (!title.trim()) throw new BankError('VALIDATION', { field: 'title' });
  const doc = await createDocument({
    type: 'application', title: title.trim(), ownerId: user.id, classification: 'confidential', department: 'CSV',
    data: { kind: 'accepted', client: user.name, clientId: user.clientId, description, receivedBy: actor().name },
    body: description ? [description] : [],
    elements: [
      element('seal', 66, 10, 22, { sealId: 'received_oval', ink: sealById('received_oval')!.ink, intensity: 0.9 }, -10, 0.9),
      element('qr', 6, 84, 11, { payload: 'verify' }, 0, 1),
    ],
  });
  await db.archive.add({
    id: uid('ARR'), code: archiveCode('CSV'), kind: 'correspondence', title: `Received: ${title.trim()}`,
    summary: `${user.name} (${user.clientId}) lodged “${title.trim()}” at the teller desk. ${description}`.trim(),
    createdAt: nowISO(), ownerId: user.id, department: 'CSV', classification: 'confidential', refs: { docId: doc.id },
    tags: ['teller', 'received'], shelf: shelfMark(), status: 'filed',
  });
  await audit({ action: 'teller.accept_document', object: 'document', objectId: doc.id, details: title });
  return doc;
}

export async function tellerIssueReceipt(clientUserId: string, title: string, lines: string[], amount?: number, currency?: string) {
  requirePermission('teller.desk');
  const user = await db.users.get(clientUserId);
  if (!user) throw new BankError('NOT_FOUND');
  const doc = await createDocument({
    type: 'receipt', title: title || 'Teller Receipt', ownerId: user.id, department: 'CSV',
    data: { kind: 'teller', client: user.name, clientId: user.clientId, amount, currency, issuedBy: actor().name },
    body: lines.filter(Boolean),
  });
  await audit({ action: 'teller.receipt', object: 'document', objectId: doc.id });
  return doc;
}

export async function stampDocument(docId: string, sealId: string, place?: { x: number; y: number; w: number; rotation: number }) {
  const seal = sealById(sealId);
  if (!seal) throw new BankError('NOT_FOUND', { object: 'seal' });
  if (seal.official) requirePermission('documents.official');
  const doc = await db.documents.get(docId);
  if (!doc) throw new BankError('NOT_FOUND');
  const p = place ?? { x: 55 + Math.random() * 20, y: 60 + Math.random() * 15, w: seal.shape === 'rect' ? 18 : 20, rotation: -12 + Math.random() * 24 };
  const el = element('seal', p.x, p.y, p.w, { sealId, ink: seal.ink, intensity: 0.85, date: nowISO().slice(0, 10) }, p.rotation, 0.9);
  return saveDocumentVersion(docId, { elements: [...doc.elements, el] }, `Stamped: ${sealId}`);
}
