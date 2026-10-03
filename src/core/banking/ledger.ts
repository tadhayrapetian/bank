/**
 * General Ledger — strict double-entry bookkeeping.
 *
 * Money only moves through `post()`: a balanced journal (Σdebit = Σcredit in
 * every currency). Account balances are a projection of ledger entries kept in
 * the `balances` table, updated atomically in the same IndexedDB transaction as
 * the entries. `reconcileBalances()` rebuilds the projection from the raw ledger
 * and reports any drift — nothing ever writes a balance directly.
 *
 * Sign convention: balance = Σcredit − Σdebit (customer deposits are bank
 * liabilities, so credits increase them). Debit-normal internal accounts (cash,
 * loans receivable, nostro) are displayed with the sign flipped.
 */
import { db, inTx } from '../db/db';
import { BankError } from '../errors';
import { nowISO } from '../clock';
import { uid } from '../util/random';
import { canonical, sha256 } from '../util/sha256';
import { currencies } from '../currency/registry';
import type { Account, BalanceRow, Hold, HoldReason, Journal, LedgerEntry } from '../types';

export interface PostingLine {
  accountId: string;
  currency: string;
  side: 'D' | 'C';
  amount: number;
  memo?: string;
}

export interface PostingInput {
  txId: string;
  ref: string;
  memo: string;
  lines: PostingLine[];
  /** Holds released atomically when this journal posts (e.g. card authorisation capture). */
  captureHoldIds?: string[];
  /** Skip available-balance checks (system corrections, opening balances, internal moves). */
  allowOverdraft?: boolean;
  /** Allow debiting frozen accounts (compliance / closure). */
  ignoreFreeze?: boolean;
}

const LEDGER_TABLES = () => [db.accounts, db.balances, db.ledger, db.journals, db.holds];

export function validateBalanced(lines: PostingLine[]) {
  if (!lines.length) throw new BankError('TRANSACTION_FAILED', { detail: 'empty journal' });
  const sums = new Map<string, number>();
  for (const l of lines) {
    if (!Number.isInteger(l.amount) || l.amount <= 0) {
      throw new BankError('INVALID_AMOUNT', { amount: l.amount });
    }
    sums.set(l.currency, (sums.get(l.currency) ?? 0) + (l.side === 'D' ? l.amount : -l.amount));
  }
  for (const [ccy, s] of sums) {
    if (s !== 0) throw new BankError('TRANSACTION_FAILED', { detail: `unbalanced journal in ${ccy}` });
  }
}

/** Post one balanced journal atomically. Returns the journal. */
export async function post(input: PostingInput): Promise<Journal> {
  validateBalanced(input.lines);
  return inTx(LEDGER_TABLES(), async () => postInTx(input));
}

/** Post several journals in one atomic transaction (all-or-nothing). */
export async function postMany(inputs: PostingInput[]): Promise<Journal[]> {
  for (const i of inputs) validateBalanced(i.lines);
  return inTx(LEDGER_TABLES(), async () => {
    const out: Journal[] = [];
    for (const i of inputs) out.push(await postInTx(i));
    return out;
  });
}

async function postInTx(input: PostingInput): Promise<Journal> {
  const at = nowISO();
  const journalId = uid('JNL', 12);
  const accountCache = new Map<string, Account>();
  const capture = new Set(input.captureHoldIds ?? []);

  for (const l of input.lines) {
    let acc = accountCache.get(l.accountId);
    if (!acc) {
      acc = await db.accounts.get(l.accountId);
      if (!acc) throw new BankError('INVALID_ACCOUNT', { account: l.accountId });
      accountCache.set(acc.id, acc);
    }
    if (acc.status === 'closed') throw new BankError('INVALID_ACCOUNT', { account: acc.number, reason: 'closed' });
    if (!currencies.has(l.currency)) throw new BankError('CURRENCY_UNSUPPORTED', { currency: l.currency });
    if (!acc.pockets.includes(l.currency)) {
      if (acc.type === 'internal' || acc.multiCurrency) {
        acc.pockets = [...acc.pockets, l.currency];
        await db.accounts.update(acc.id, { pockets: acc.pockets });
      } else {
        throw new BankError('CURRENCY_UNSUPPORTED', { currency: l.currency, account: acc.number });
      }
    }
    if (l.side === 'D' && acc.status === 'frozen' && !input.ignoreFreeze) {
      throw new BankError('ACCOUNT_FROZEN', { account: acc.number });
    }
  }

  // Available-balance check for debited customer (credit-normal) accounts.
  if (!input.allowOverdraft) {
    const debits = new Map<string, number>();
    for (const l of input.lines) {
      const k = `${l.accountId}|${l.currency}`;
      debits.set(k, (debits.get(k) ?? 0) + (l.side === 'D' ? l.amount : -l.amount));
    }
    for (const [k, net] of debits) {
      if (net <= 0) continue;
      const [accountId, currency] = k.split('|');
      const acc = accountCache.get(accountId)!;
      if (acc.type === 'internal' || acc.normal === 'debit' || acc.type === 'loan') continue;
      const bal = (await db.balances.get([accountId, currency]))?.balance ?? 0;
      const holds = (await db.holds.where('accountId').equals(accountId).toArray()).filter(
        (h) => h.status === 'active' && h.currency === currency && !capture.has(h.id),
      );
      const held = holds.reduce((s, h) => s + h.amount, 0);
      const overdraft = currency === acc.currency ? acc.overdraftLimit : 0;
      const available = bal + overdraft - held;
      if (available < net) {
        throw new BankError('INSUFFICIENT_FUNDS', { account: acc.number, currency, available, required: net });
      }
    }
  }

  const entries: LedgerEntry[] = input.lines.map((l) => ({
    id: uid('LE', 14),
    journalId,
    txId: input.txId,
    accountId: l.accountId,
    currency: l.currency,
    side: l.side,
    amount: l.amount,
    at,
    ref: input.ref,
    memo: l.memo ?? input.memo,
  }));
  await db.ledger.bulkAdd(entries);

  // Update the balance projection.
  const deltas = new Map<string, { accountId: string; currency: string; delta: number; n: number }>();
  for (const e of entries) {
    const k = `${e.accountId}|${e.currency}`;
    const d = deltas.get(k) ?? { accountId: e.accountId, currency: e.currency, delta: 0, n: 0 };
    d.delta += e.side === 'C' ? e.amount : -e.amount;
    d.n += 1;
    deltas.set(k, d);
  }
  for (const d of deltas.values()) {
    const row = await db.balances.get([d.accountId, d.currency]);
    const next: BalanceRow = {
      accountId: d.accountId,
      currency: d.currency,
      balance: (row?.balance ?? 0) + d.delta,
      entries: (row?.entries ?? 0) + d.n,
      updatedAt: at,
    };
    await db.balances.put(next);
  }

  for (const hid of capture) {
    await db.holds.update(hid, { status: 'captured' });
  }

  const journal: Journal = {
    id: journalId,
    txId: input.txId,
    ref: input.ref,
    at,
    memo: input.memo,
    lineCount: entries.length,
    hash: sha256(canonical(entries.map(({ accountId, currency, side, amount }) => ({ accountId, currency, side, amount })))),
  };
  await db.journals.add(journal);
  return journal;
}

/* ───────────── Holds (blocked funds) ───────────── */

export async function placeHold(h: {
  accountId: string;
  currency: string;
  amount: number;
  reason: HoldReason;
  description: string;
  txId?: string;
  expiresAt?: string;
}): Promise<Hold> {
  return inTx([db.accounts, db.balances, db.holds], async () => {
    const acc = await db.accounts.get(h.accountId);
    if (!acc) throw new BankError('INVALID_ACCOUNT', { account: h.accountId });
    if (acc.status === 'frozen') throw new BankError('ACCOUNT_FROZEN', { account: acc.number });
    if (acc.status === 'closed') throw new BankError('INVALID_ACCOUNT', { account: acc.number });
    const avail = await availableInTx(acc, h.currency);
    if (avail < h.amount) {
      throw new BankError('INSUFFICIENT_FUNDS', { account: acc.number, currency: h.currency, available: avail, required: h.amount });
    }
    const hold: Hold = { id: uid('HLD'), status: 'active', createdAt: nowISO(), ...h };
    await db.holds.add(hold);
    return hold;
  });
}

export async function releaseHold(id: string) {
  const h = await db.holds.get(id);
  if (h && h.status === 'active') await db.holds.update(id, { status: 'released' });
}

async function availableInTx(acc: Account, currency: string): Promise<number> {
  const bal = (await db.balances.get([acc.id, currency]))?.balance ?? 0;
  const held = (await db.holds.where('accountId').equals(acc.id).toArray())
    .filter((x) => x.status === 'active' && x.currency === currency)
    .reduce((s, x) => s + x.amount, 0);
  return bal + (currency === acc.currency ? acc.overdraftLimit : 0) - held;
}

/* ───────────── Balance queries ───────────── */

export interface PocketBalance {
  currency: string;
  balance: number; // display sign (debit-normal accounts flipped)
  held: number;
  available: number;
}

export async function balanceOf(accountId: string, currency: string): Promise<number> {
  return (await db.balances.get([accountId, currency]))?.balance ?? 0;
}

export async function pocketBalances(acc: Account): Promise<PocketBalance[]> {
  const rows = await db.balances.where('accountId').equals(acc.id).toArray();
  const holds = (await db.holds.where('accountId').equals(acc.id).toArray()).filter((h) => h.status === 'active');
  return acc.pockets.map((ccy) => {
    const raw = rows.find((r) => r.currency === ccy)?.balance ?? 0;
    const balance = acc.normal === 'debit' ? -raw : raw;
    const held = holds.filter((h) => h.currency === ccy).reduce((s, h) => s + h.amount, 0);
    const available = raw + (ccy === acc.currency ? acc.overdraftLimit : 0) - held;
    return { currency: ccy, balance, held, available };
  });
}

export async function availableOf(accountId: string, currency: string): Promise<number> {
  const acc = await db.accounts.get(accountId);
  if (!acc) return 0;
  return availableInTx(acc, currency);
}

/** Rebuild the balance projection from raw ledger entries; returns drift found. */
export async function reconcileBalances(fix = false) {
  const computed = new Map<string, { accountId: string; currency: string; balance: number; entries: number }>();
  await db.ledger.each((e) => {
    const k = `${e.accountId}|${e.currency}`;
    const c = computed.get(k) ?? { accountId: e.accountId, currency: e.currency, balance: 0, entries: 0 };
    c.balance += e.side === 'C' ? e.amount : -e.amount;
    c.entries++;
    computed.set(k, c);
  });
  const stored = await db.balances.toArray();
  const drift: { accountId: string; currency: string; stored: number; ledger: number }[] = [];
  const seen = new Set<string>();
  for (const s of stored) {
    const k = `${s.accountId}|${s.currency}`;
    seen.add(k);
    const c = computed.get(k);
    if ((c?.balance ?? 0) !== s.balance) drift.push({ accountId: s.accountId, currency: s.currency, stored: s.balance, ledger: c?.balance ?? 0 });
  }
  for (const [k, c] of computed) {
    if (!seen.has(k) && c.balance !== 0) drift.push({ accountId: c.accountId, currency: c.currency, stored: 0, ledger: c.balance });
  }
  if (fix && drift.length) {
    await db.transaction('rw', db.balances, async () => {
      await db.balances.clear();
      await db.balances.bulkPut([...computed.values()].map((c) => ({ ...c, updatedAt: nowISO() })));
    });
  }
  return { accounts: computed.size, drift };
}

/** Σdebits and Σcredits per currency across the whole ledger — must be equal. */
export async function trialBalance() {
  const t = new Map<string, { currency: string; debit: number; credit: number; entries: number }>();
  await db.ledger.each((e) => {
    const r = t.get(e.currency) ?? { currency: e.currency, debit: 0, credit: 0, entries: 0 };
    if (e.side === 'D') r.debit += e.amount;
    else r.credit += e.amount;
    r.entries++;
    t.set(e.currency, r);
  });
  return [...t.values()].sort((a, b) => b.entries - a.entries);
}

/** Running balance history for one pocket (for statements & charts). */
export async function ledgerHistory(accountId: string, currency: string) {
  const entries = await db.ledger.where('[accountId+currency]').equals([accountId, currency]).sortBy('at');
  let running = 0;
  return entries.map((e) => {
    running += e.side === 'C' ? e.amount : -e.amount;
    return { ...e, running };
  });
}
