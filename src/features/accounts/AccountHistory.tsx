/** Operations that touched this account (as source or destination), filterable, paginated. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { History, ArrowRight } from 'lucide-react';
import { useT } from '@/hooks/useT';
import { useLive } from '@/hooks/data';
import { db } from '@/core/db/db';
import { directionFor } from '@/core/ops/analytics';
import { Empty, Field, Input, Pager, Panel, Select } from '@/ui/primitives';
import { TxRow } from '../transactions/TxRow';
import type { Account, Transaction, TxStatus } from '@/core/types';

const PAGE = 15;

export function useAccountTransactions(accountId: string): Transaction[] {
  return useLive(async () => {
    const [out, inn] = await Promise.all([
      db.transactions.where('fromAccountId').equals(accountId).toArray(),
      db.transactions.where('toAccountId').equals(accountId).toArray(),
    ]);
    const map = new Map<string, Transaction>();
    for (const x of [...out, ...inn]) map.set(x.id, x);
    return [...map.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [accountId], []);
}

export function AccountHistory({ acc }: { acc: Account }) {
  const { t, tx } = useT();
  const txs = useAccountTransactions(acc.id);
  const mine = useMemo(() => new Set([acc.id]), [acc.id]);
  const [q, setQ] = useState('');
  const [dir, setDir] = useState<'' | 'in' | 'out' | 'internal'>('');
  const [status, setStatus] = useState<'' | TxStatus>('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(0);
  const types = useMemo(() => [...new Set(txs.map((x) => x.type))].sort(), [txs]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return txs.filter((x) => {
      if (dir && directionFor(x, mine) !== dir) return false;
      if (status && x.status !== status) return false;
      if (type && x.type !== type) return false;
      if (needle && ![x.ref, x.id, x.description, x.sender.name, x.recipient.name, x.merchant?.name ?? ''].some((s) => s.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [txs, q, dir, status, type, mine]);
  const cur = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE) - 1));
  const shown = filtered.slice(cur * PAGE, (cur + 1) * PAGE);
  const reset = () => setPage(0);

  return (
    <Panel title={t('accounts.history.title')} icon={<History />} sub={t('accounts.history.sub', { n: txs.length })} flush
      actions={<Link className="btn btn-sm btn-ghost" to={`/transactions?account=${acc.id}`}>{t('accounts.history.openJournal')}<ArrowRight /></Link>}>
      <div className="acc-filterbar acc-filterbar-flat">
        <Field label={t('common.search')} htmlFor="ah-q" className="acc-filter-search">
          <Input id="ah-q" type="search" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} placeholder={t('accounts.history.searchPh')} />
        </Field>
        <Field label={t('transactions.direction')} htmlFor="ah-dir">
          <Select id="ah-dir" value={dir} onChange={(e) => { setDir(e.target.value as typeof dir); reset(); }}>
            <option value="">{t('common.all')}</option>
            <option value="in">{t('transactions.dir.in')}</option>
            <option value="out">{t('transactions.dir.out')}</option>
            <option value="internal">{t('transactions.dir.internal')}</option>
          </Select>
        </Field>
        <Field label={t('common.status')} htmlFor="ah-st">
          <Select id="ah-st" value={status} onChange={(e) => { setStatus(e.target.value as TxStatus | ''); reset(); }}>
            <option value="">{t('common.all')}</option>
            {(['completed', 'pending', 'processing', 'failed', 'rejected', 'cancelled', 'expired', 'reversed'] as TxStatus[]).map((s) => <option key={s} value={s}>{tx(`status.tx.${s}`)}</option>)}
          </Select>
        </Field>
        <Field label={t('common.type')} htmlFor="ah-type">
          <Select id="ah-type" value={type} onChange={(e) => { setType(e.target.value); reset(); }}>
            <option value="">{t('common.all')}</option>
            {types.map((ty) => <option key={ty} value={ty}>{tx(`txType.${ty}`)}</option>)}
          </Select>
        </Field>
      </div>
      <div className="list">
        {shown.map((x) => <TxRow key={x.id} tx={x} mine={mine} />)}
        {!shown.length && <Empty title={txs.length ? t('accounts.filters.none') : t('accounts.history.empty')}>{txs.length ? t('accounts.filters.noneHint') : undefined}</Empty>}
      </div>
      <Pager page={cur} pageSize={PAGE} total={filtered.length} onPage={setPage} />
    </Panel>
  );
}
