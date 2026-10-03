/** Reactive data access: components subscribe to IndexedDB queries and re-render on change. */
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/core/db/db';
import { pocketBalances, type PocketBalance } from '@/core/banking/ledger';
import { toBase } from '@/core/currency/rates';
import { nowMs } from '@/core/clock';
import { useSession } from '@/state/session';
import type { Account, Transaction, User } from '@/core/types';

export function useLive<T>(fn: () => Promise<T> | T, deps: unknown[], fallback: T): T {
  return useLiveQuery(fn, deps, fallback) as T;
}

export function useMe(): User | null {
  const id = useSession((s) => s.user?.id);
  const fallback = useSession((s) => s.user);
  return useLive(() => (id ? db.users.get(id).then((u) => u ?? null) : null), [id], fallback);
}

export function useMyAccounts(opts: { includeClosed?: boolean; includeHidden?: boolean } = {}): Account[] {
  const id = useSession((s) => s.user?.id);
  return useLive(
    async () => {
      if (!id) return [];
      const rows = await db.accounts.where('partyIds').equals(id).toArray();
      return rows
        .filter((a) => (opts.includeClosed || a.status !== 'closed') && (opts.includeHidden || !a.hidden))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    [id, opts.includeClosed, opts.includeHidden],
    [],
  );
}

export interface AccountWithBalances extends Account {
  pocketsInfo: PocketBalance[];
}

export function useAccountsWithBalances(accounts: Account[]): AccountWithBalances[] {
  const key = accounts.map((a) => a.id + a.status + a.pockets.join()).join('|');
  return useLive(
    async () => {
      await db.balances.count(); // subscribe to balance changes
      await db.holds.count();
      const out: AccountWithBalances[] = [];
      for (const a of accounts) out.push({ ...a, pocketsInfo: await pocketBalances(a) });
      return out;
    },
    [key],
    accounts.map((a) => ({ ...a, pocketsInfo: a.pockets.map((c) => ({ currency: c, balance: 0, held: 0, available: 0 })) })),
  );
}

export function totalIn(accs: AccountWithBalances[], base: string, field: 'balance' | 'available' | 'held' = 'balance', filter?: (a: Account) => boolean) {
  let s = 0;
  for (const a of accs) {
    if (filter && !filter(a)) continue;
    for (const p of a.pocketsInfo) {
      const v = field === 'available' ? Math.max(0, p.available) : p[field];
      s += a.type === 'loan' || a.type === 'credit' ? 0 : toBase(v, p.currency, base);
    }
  }
  return s;
}

export function useMyTransactions(limit = 0, filter?: (t: Transaction) => boolean, deps: unknown[] = []): Transaction[] {
  const id = useSession((s) => s.user?.id);
  return useLive(
    async () => {
      if (!id) return [];
      let rows = await db.transactions.where('partyIds').equals(id).toArray();
      if (filter) rows = rows.filter(filter);
      rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return limit ? rows.slice(0, limit) : rows;
    },
    [id, limit, ...deps],
    [],
  );
}

/** Bank time, ticking. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => nowMs());
  useEffect(() => {
    const t = setInterval(() => setNow(nowMs()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useUserMap(): Map<string, User> {
  return useLive(async () => new Map((await db.users.toArray()).map((u) => [u.id, u])), [], new Map());
}
