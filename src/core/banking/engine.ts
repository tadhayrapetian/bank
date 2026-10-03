/**
 * Transaction Engine — the processing pipeline every money movement goes through:
 *
 *   Created → Validated → Screened → Processing → Approved → Settled → Completed
 *
 * with error states (Failed / Rejected / Cancelled / Expired / Reversed). Each
 * step is persisted to the transaction timeline as it happens, so the UI can
 * show live progress. Settlement is always a balanced ledger journal.
 * On completion the engine issues a receipt document, notifies every party
 * and writes the audit trail — so a single operation updates balances,
 * ledger, transactions, documents, notifications, analytics and search.
 */
import { db, unitOfWork } from '../db/db';
import { nowISO, pause, startOfDayISO, now, clock } from '../clock';
import { BankError, isBankError, toBankError, type ErrorCode } from '../errors';
import { uid } from '../util/random';
import { txRef } from './numbers';
import { post, type PostingInput } from './ledger';
import { audit } from '../ops/audit';
import { notify } from '../comms/notify';
import { issueReceipt } from '../docs/documents';
import { screenTransaction } from '../security/fraud';
import { assertService, isDegraded } from '../ops/system';
import { stepDelay } from '../settings';
import { toBase } from '../currency/rates';
import { actor } from '../context';
import type {
  Account, NotificationCategory, RiskInfo, TimelineKey, TimelineStep, Transaction, TxStatus, TxType,
} from '../types';
import type { ServiceId } from '../types';

export type TxDraft = Omit<
  Transaction,
  'id' | 'ref' | 'status' | 'createdAt' | 'updatedAt' | 'timeline' | 'documentIds' | 'journalIds' | 'relatedTxIds' | 'partyIds' | 'initiatorId' | 'fee' | 'feeCurrency'
> & {
  partyIds?: string[];
  initiatorId?: string;
  relatedTxIds?: string[];
  fee?: number;
  feeCurrency?: string;
  refPrefix?: string;
};

export type PlannedJournal = Omit<PostingInput, 'txId' | 'ref'>;

export interface PipelineSpec {
  draft: TxDraft;
  service?: ServiceId;
  validate?: (tx: Transaction) => Promise<void>;
  plan: (tx: Transaction) => Promise<PlannedJournal[]> | PlannedJournal[];
  screen?: { realm?: string; recipientKey?: string } | false;
  limit?: { account: Account; amount: number; currency: string };
  receipt?: boolean;
  notifyParties?: boolean;
  /** Leave the transaction in Processing after settlement (multi-stage flows). */
  holdOpen?: boolean;
  steps?: TimelineKey[];
  onCreated?: (txId: string) => void;
  after?: (tx: Transaction) => Promise<void>;
}

const REJECT_CODES: ErrorCode[] = ['DAILY_LIMIT_EXCEEDED', 'FRAUD_BLOCKED', 'PERMISSION_DENIED', 'KYC_REQUIRED', 'CARD_BLOCKED', 'CARD_CONTROL_DISABLED', 'CARD_LIMIT_EXCEEDED', 'CURRENCY_UNSUPPORTED', 'NETWORK_UNAVAILABLE', 'ACCOUNT_FROZEN'];

export function categoryOfType(type: TxType): NotificationCategory {
  if (type === 'card_payment' || type === 'atm_withdrawal' || type === 'atm_deposit') return 'cards';
  if (type.startsWith('deposit')) return 'deposits';
  if (type.startsWith('loan')) return 'loans';
  if (type === 'opening') return 'accounts';
  return 'payments';
}

async function partiesOf(...accountIds: (string | undefined)[]): Promise<string[]> {
  const ids = new Set<string>();
  for (const id of accountIds) {
    if (!id) continue;
    const acc = await db.accounts.get(id);
    if (acc && acc.ownerId !== 'BANK') for (const p of acc.partyIds) ids.add(p);
  }
  return [...ids];
}

export async function createTx(draft: TxDraft): Promise<Transaction> {
  const a = actor();
  const at = nowISO();
  const parties = await partiesOf(draft.fromAccountId, draft.toAccountId);
  const { refPrefix, ...rest } = draft;
  const tx: Transaction = {
    ...rest,
    id: uid('TX', 12),
    ref: txRef(refPrefix ?? 'AEL'),
    status: 'pending',
    createdAt: at,
    updatedAt: at,
    initiatorId: draft.initiatorId ?? a.userId,
    partyIds: [...new Set([...(draft.partyIds ?? []), ...parties, ...(a.system || a.userId === 'BANK' ? [] : [draft.initiatorId ?? a.userId])])].filter((p) => p && p !== 'BANK' && p !== 'SYSTEM'),
    fee: draft.fee ?? 0,
    feeCurrency: draft.feeCurrency ?? draft.currency,
    relatedTxIds: draft.relatedTxIds ?? [],
    timeline: [{ step: 'created', at, ok: true, actor: a.name }],
    documentIds: [],
    journalIds: [],
    deviceId: draft.deviceId ?? a.deviceId,
  };
  await db.transactions.add(tx);
  return tx;
}

export async function addStep(txId: string, step: TimelineKey, ok = true, extra: Partial<Transaction> = {}, note?: string) {
  const tx = await db.transactions.get(txId);
  if (!tx) return;
  const entry: TimelineStep = { step, at: nowISO(), ok, note, actor: actor().name };
  await db.transactions.put({ ...tx, ...extra, timeline: [...tx.timeline, entry], updatedAt: entry.at });
}

export async function setTxStatus(txId: string, status: TxStatus, step: TimelineKey, ok: boolean, extra: Partial<Transaction> = {}, note?: string) {
  await addStep(txId, step, ok, { status, ...extra, ...(status === 'completed' ? { completedAt: nowISO() } : {}) }, note);
}

/** Outgoing volume today for limit checks (in `currency`). */
export async function outgoingToday(accountId: string, currency: string, excludeTxId?: string): Promise<number> {
  const since = startOfDayISO(now());
  const txs = (await db.transactions.where('createdAt').aboveOrEqual(since).toArray())
    .filter((t) => t.id !== excludeTxId && t.fromAccountId === accountId && ['completed', 'processing', 'pending'].includes(t.status) && t.type !== 'own_transfer' && t.type !== 'fx');
  return txs.reduce((s, t) => s + toBase(t.amount, t.currency, currency), 0);
}

export async function userOutgoingTodayUSD(userId: string, excludeTxId?: string): Promise<number> {
  const since = startOfDayISO(now());
  const txs = (await db.transactions.where('createdAt').aboveOrEqual(since).toArray())
    .filter((t) => t.id !== excludeTxId && t.initiatorId === userId && ['completed', 'processing', 'pending'].includes(t.status) && t.type !== 'own_transfer' && t.type !== 'fx' && !!t.fromAccountId);
  return txs.reduce((s, t) => s + toBase(t.amount, t.currency, 'USD'), 0);
}

async function checkLimits(limit: NonNullable<PipelineSpec['limit']>, txId: string): Promise<void> {
  const { account, amount, currency } = limit;
  if (account.dailyLimit) {
    const used = await outgoingToday(account.id, account.currency, txId);
    if (used + toBase(amount, currency, account.currency) > account.dailyLimit) {
      throw new BankError('DAILY_LIMIT_EXCEEDED', { scope: 'account', limit: account.dailyLimit, currency: account.currency, used });
    }
  }
  const a = actor();
  if (!a.system) {
    const user = await db.users.get(a.userId);
    if (user?.dailyLimitUSD) {
      const used = await userOutgoingTodayUSD(user.id, txId);
      if (used + toBase(amount, currency, 'USD') > user.dailyLimitUSD) {
        throw new BankError('DAILY_LIMIT_EXCEEDED', { scope: 'user', limit: user.dailyLimitUSD, currency: 'USD', used });
      }
    }
  }
}

async function settle(tx: Transaction, plan: PlannedJournal[]): Promise<string[]> {
  const ids: string[] = [];
  for (const j of plan) {
    const journal = await post({ ...j, txId: tx.id, ref: tx.ref });
    ids.push(journal.id);
  }
  return ids;
}

async function fail(tx: Transaction, err: BankError) {
  const status: TxStatus = REJECT_CODES.includes(err.code) ? 'rejected' : 'failed';
  await setTxStatus(tx.id, status, status === 'rejected' ? 'rejected' : 'failed', false, {
    error: { code: err.code, params: err.params },
  }, err.code);
  await audit({ action: `tx.${tx.type}`, object: 'transaction', objectId: tx.id, txId: tx.id, result: 'failure', details: err.code });
  const initiator = tx.initiatorId;
  if (initiator && initiator !== 'SYSTEM' && initiator !== 'BANK') {
    await notify(initiator, {
      category: categoryOfType(tx.type),
      titleKey: 'n.tx.failed.title',
      bodyKey: 'n.tx.failed.body',
      params: { amt: tx.amount, ccy: tx.currency, ref: tx.ref, code: err.code },
      link: `/transactions/${tx.id}`,
      priority: 'high',
    });
  }
}

/** Run the full pipeline. Throws BankError (with params.txId) on failure. */
export async function execute(spec: PipelineSpec): Promise<Transaction> {
  // Batch mode (seeding, end-of-day) runs the whole pipeline as one atomic unit of work.
  if (clock.isInstant()) return unitOfWork(() => runPipeline(spec));
  return runPipeline(spec);
}

async function runPipeline(spec: PipelineSpec): Promise<Transaction> {
  if (spec.service) assertService(spec.service);
  let tx = await createTx(spec.draft);
  spec.onCreated?.(tx.id);
  const delay = stepDelay() + (spec.service && isDegraded(spec.service) ? 1400 : 0);
  try {
    await pause(delay);
    if (spec.validate) await spec.validate(tx);
    if (spec.limit) {
      try {
        await checkLimits(spec.limit, tx.id);
      } catch (e) {
        if (isBankError(e) && e.code === 'DAILY_LIMIT_EXCEEDED') {
          // still screened so the fraud desk sees the attempt
          if (spec.screen !== false) {
            const a = actor();
            await screenTransaction({ userId: a.userId, userName: a.name, amount: tx.amount, currency: tx.currency, type: tx.type, deviceId: a.deviceId, dailyLimitExceeded: true, txId: tx.id });
          }
          throw e;
        }
        throw e;
      }
    }
    await addStep(tx.id, 'validated');

    const plan = await spec.plan(tx);
    await db.transactions.update(tx.id, { meta: { ...(tx.meta ?? {}), plan } });

    if (spec.screen !== false && spec.screen) {
      const a = actor();
      await pause(delay);
      const risk: RiskInfo = await screenTransaction({
        userId: a.userId, userName: a.name, amount: tx.amount, currency: tx.currency, type: tx.type,
        realm: spec.screen.realm, deviceId: a.deviceId, recipientKey: spec.screen.recipientKey, txId: tx.id,
      });
      if (risk.action === 'block') {
        await db.transactions.update(tx.id, { risk });
        throw new BankError('FRAUD_BLOCKED', { score: risk.score });
      }
      if (risk.action === 'review') {
        await setTxStatus(tx.id, 'pending', 'review', true, { risk, stage: 'review' }, 'fraud_review');
        await audit({ action: `tx.${tx.type}.review`, object: 'transaction', objectId: tx.id, txId: tx.id, details: `risk ${risk.score}` });
        await notify(tx.initiatorId, {
          category: 'security', titleKey: 'n.tx.review.title', bodyKey: 'n.tx.review.body',
          params: { amt: tx.amount, ccy: tx.currency, ref: tx.ref, score: risk.score }, link: `/transactions/${tx.id}`, priority: 'high',
        });
        return (await db.transactions.get(tx.id))!;
      }
      await addStep(tx.id, 'screened', true, { risk });
    }

    return await settleAndComplete(tx.id, spec, plan, delay);
  } catch (e) {
    const err = toBankError(e);
    tx = (await db.transactions.get(tx.id)) ?? tx;
    if (tx.status !== 'completed') await fail(tx, err);
    err.params = { ...err.params, txId: tx.id };
    throw err;
  }
}

async function settleAndComplete(txId: string, spec: Pick<PipelineSpec, 'holdOpen' | 'receipt' | 'notifyParties' | 'after' | 'steps'>, plan: PlannedJournal[], delay: number): Promise<Transaction> {
  let tx = (await db.transactions.get(txId))!;
  await setTxStatus(tx.id, 'processing', 'processing', true);
  await pause(delay);
  await addStep(tx.id, 'approved');
  const journalIds = await settle(tx, plan);
  await addStep(tx.id, 'settled', true, { journalIds: [...tx.journalIds, ...journalIds] });
  for (const s of spec.steps ?? []) await addStep(tx.id, s);
  if (spec.holdOpen) {
    tx = (await db.transactions.get(tx.id))!;
    await audit({ action: `tx.${tx.type}`, object: 'transaction', objectId: tx.id, txId: tx.id, details: 'settled, in progress' });
    if (spec.after) await spec.after(tx);
    return (await db.transactions.get(tx.id))!;
  }
  await pause(delay);
  await setTxStatus(tx.id, 'completed', 'completed', true);
  tx = (await db.transactions.get(tx.id))!;
  await finalize(tx, spec.receipt !== false, spec.notifyParties !== false);
  if (spec.after) await spec.after(tx);
  return (await db.transactions.get(tx.id))!;
}

/** Post-completion effects: receipt, notifications, audit. */
export async function finalize(tx: Transaction, receipt = true, notifyAll = true) {
  if (receipt) {
    const doc = await issueReceipt(tx);
    await db.transactions.update(tx.id, { documentIds: [...tx.documentIds, doc.id] });
  }
  await audit({ action: `tx.${tx.type}`, object: 'transaction', objectId: tx.id, txId: tx.id, details: `${tx.amount} ${tx.currency}` });
  if (notifyAll) await notifyParties(tx);
}

export async function notifyParties(tx: Transaction) {
  const from = tx.fromAccountId ? await db.accounts.get(tx.fromAccountId) : undefined;
  const to = tx.toAccountId ? await db.accounts.get(tx.toAccountId) : undefined;
  const fromParties = from && from.ownerId !== 'BANK' ? from.partyIds : [];
  const toParties = to && to.ownerId !== 'BANK' ? to.partyIds : [];
  const cat = categoryOfType(tx.type);
  const link = `/transactions/${tx.id}`;
  const own = fromParties.length && toParties.length && fromParties.some((p) => toParties.includes(p));
  if (own) {
    for (const p of new Set([...fromParties, ...toParties])) {
      await notify(p, { category: cat, titleKey: `n.tx.own.title`, bodyKey: `n.tx.own.body`, params: { amt: tx.amount, ccy: tx.currency, ref: tx.ref, type: tx.type }, link });
    }
    return;
  }
  for (const p of fromParties) {
    await notify(p, {
      category: cat, titleKey: 'n.tx.out.title', bodyKey: 'n.tx.out.body',
      params: { amt: tx.amount, ccy: tx.currency, name: tx.recipient.name, ref: tx.ref, type: tx.type }, link,
    });
  }
  for (const p of toParties) {
    await notify(p, {
      category: cat, titleKey: 'n.tx.in.title', bodyKey: 'n.tx.in.body',
      params: { amt: tx.creditAmount ?? tx.amount, ccy: tx.creditCurrency ?? tx.currency, name: tx.sender.name, ref: tx.ref, type: tx.type }, link,
    });
  }
}

/** Compliance decision on a transaction held for fraud review. */
export async function resolveReview(txId: string, approve: boolean, note = '') {
  const tx = await db.transactions.get(txId);
  if (!tx || tx.status !== 'pending' || tx.stage !== 'review') throw new BankError('INVALID_STATE', { txId });
  if (tx.risk?.eventId) {
    await db.fraud.update(tx.risk.eventId, { status: approve ? 'cleared' : 'confirmed', reviewedBy: actor().name, reviewedAt: nowISO() });
  }
  if (!approve) {
    await setTxStatus(txId, 'rejected', 'rejected', false, { stage: undefined, error: { code: 'FRAUD_BLOCKED' } }, note || 'compliance_rejected');
    await audit({ action: 'tx.review.reject', object: 'transaction', objectId: txId, txId });
    await notify(tx.initiatorId, { category: 'security', titleKey: 'n.tx.failed.title', bodyKey: 'n.tx.failed.body', params: { amt: tx.amount, ccy: tx.currency, ref: tx.ref, code: 'FRAUD_BLOCKED' }, link: `/transactions/${txId}`, priority: 'high' });
    return;
  }
  await addStep(txId, 'screened', true, { stage: undefined }, note || 'compliance_cleared');
  const plan = (tx.meta?.plan ?? []) as PlannedJournal[];
  try {
    await settleAndComplete(txId, { receipt: true, notifyParties: true, holdOpen: tx.type === 'international' }, plan, 0);
    if (tx.type === 'international') {
      const { startInternationalStages } = await import('./international');
      await startInternationalStages(txId);
    }
    await audit({ action: 'tx.review.approve', object: 'transaction', objectId: txId, txId });
  } catch (e) {
    const err = toBankError(e);
    await fail((await db.transactions.get(txId))!, err);
    throw err;
  }
}

/** Cancel a transaction that has not settled yet. */
export async function cancelPendingTx(txId: string) {
  const tx = await db.transactions.get(txId);
  if (!tx) throw new BankError('NOT_FOUND', { txId });
  if (tx.status !== 'pending') throw new BankError('INVALID_STATE', { status: tx.status });
  const a = actor();
  if (!a.system && tx.initiatorId !== a.userId) throw new BankError('PERMISSION_DENIED');
  if (tx.holdId) {
    const { releaseHold } = await import('./ledger');
    await releaseHold(tx.holdId);
  }
  await setTxStatus(txId, 'cancelled', 'cancelled', false, { stage: undefined });
  await audit({ action: 'tx.cancel', object: 'transaction', objectId: txId, txId });
}

/** Reverse a completed transaction by posting the mirror journal. */
export async function reverseTransaction(txId: string, reason: string): Promise<Transaction> {
  const tx = await db.transactions.get(txId);
  if (!tx) throw new BankError('NOT_FOUND', { txId });
  if (tx.status !== 'completed') throw new BankError('INVALID_STATE', { status: tx.status });
  const entries = await db.ledger.where('txId').equals(txId).toArray();
  if (!entries.length) throw new BankError('INVALID_STATE', { reason: 'no ledger entries' });
  const lines = entries.map((e) => ({ accountId: e.accountId, currency: e.currency, amount: e.amount, side: (e.side === 'D' ? 'C' : 'D') as 'D' | 'C' }));
  const rev = await execute({
    draft: {
      type: 'reversal', amount: tx.amount, currency: tx.currency, fromAccountId: tx.toAccountId, toAccountId: tx.fromAccountId,
      sender: tx.recipient, recipient: tx.sender, description: `Reversal of ${tx.ref}: ${reason}`, category: 'transfers',
      channel: 'system', relatedTxIds: [tx.id], partyIds: tx.partyIds, refPrefix: 'REV',
    },
    plan: () => [{ memo: `Reversal ${tx.ref}`, lines, allowOverdraft: true, ignoreFreeze: true }],
    receipt: true,
  });
  await db.transactions.update(txId, {
    relatedTxIds: [...tx.relatedTxIds, rev.id],
  });
  await setTxStatus(txId, 'reversed', 'reversed', true, {}, reason);
  return rev;
}
