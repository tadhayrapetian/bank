/** Staff view (accounts.manage_any): every client account of the Exchequer, searchable. */
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useT, useFmt } from '@/hooks/useT';
import { useLive } from '@/hooks/data';
import { db } from '@/core/db/db';
import { toBase } from '@/core/currency/rates';
import { formatAccountNumber } from '@/core/banking/numbers';
import { DataTable } from '@/ui/DataTable';
import { Empty, Field, Input, Panel, Select, StatusBadge, Stat } from '@/ui/primitives';
import type { Account, AccountStatus, AccountType } from '@/core/types';
import { ACCOUNT_TYPE_ORDER, TypeIcon } from './shared';

interface Row {
  acc: Account;
  holder: string;
  clientId: string;
  balance: number;
  held: number;
  base: number;
}

export function StaffRegistry() {
  const { t, tx } = useT();
  const f = useFmt();
  const [q, setQ] = useState('');
  const [type, setType] = useState<'' | AccountType>('');
  const [status, setStatus] = useState<'' | AccountStatus>('');
  const data = useLive(async () => {
    const [accounts, balances, holds, users] = await Promise.all([
      db.accounts.filter((a) => a.ownerId !== 'BANK' && a.type !== 'internal').toArray(),
      db.balances.toArray(),
      db.holds.where('status').equals('active').toArray(),
      db.users.toArray(),
    ]);
    const bal = new Map(balances.map((b) => [`${b.accountId}|${b.currency}`, b.balance]));
    const um = new Map(users.map((u) => [u.id, u]));
    return accounts.map((acc): Row => {
      const raw = bal.get(`${acc.id}|${acc.currency}`) ?? 0;
      const balance = acc.normal === 'debit' ? -raw : raw;
      const held = holds.filter((h) => h.accountId === acc.id && h.currency === acc.currency).reduce((s, h) => s + h.amount, 0);
      const base = acc.pockets.reduce((s, c) => {
        const r = bal.get(`${acc.id}|${c}`) ?? 0;
        return s + toBase(acc.normal === 'debit' ? -r : r, c, f.base);
      }, 0);
      const owner = um.get(acc.ownerId);
      return { acc, holder: owner?.name ?? acc.ownerId, clientId: owner?.clientId ?? '', balance, held, base };
    });
  }, [f.base], [] as Row[]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/\s+/g, '');
    return data
      .filter((r) => (!type || r.acc.type === type) && (!status || r.acc.status === status))
      .filter((r) => !needle || [r.acc.name, r.acc.number, r.holder, r.clientId, r.acc.id].some((s) => s.toLowerCase().replace(/\s+/g, '').includes(needle)))
      .sort((a, b) => a.holder.localeCompare(b.holder) || a.acc.createdAt.localeCompare(b.acc.createdAt));
  }, [data, q, type, status]);

  const totals = useMemo(() => ({
    deposits: rows.filter((r) => r.acc.type !== 'loan' && r.acc.type !== 'credit').reduce((s, r) => s + r.base, 0),
    frozen: rows.filter((r) => r.acc.status === 'frozen').length,
    clients: new Set(rows.map((r) => r.acc.ownerId)).size,
  }), [rows]);

  return (
    <Panel title={t('accounts.staff.title')} sub={t('accounts.staff.sub')} icon={<Search />} flush>
      <div className="acc-filterbar">
        <Field label={t('common.search')} htmlFor="sr-q" className="acc-filter-search">
          <Input id="sr-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('accounts.staff.searchPh')} />
        </Field>
        <Field label={t('common.type')} htmlFor="sr-type">
          <Select id="sr-type" value={type} onChange={(e) => setType(e.target.value as AccountType | '')}>
            <option value="">{t('common.all')}</option>
            {ACCOUNT_TYPE_ORDER.map((x) => <option key={x} value={x}>{tx(`accountType.${x}`)}</option>)}
          </Select>
        </Field>
        <Field label={t('common.status')} htmlFor="sr-status">
          <Select id="sr-status" value={status} onChange={(e) => setStatus(e.target.value as AccountStatus | '')}>
            <option value="">{t('common.all')}</option>
            {(['active', 'frozen', 'pending', 'closed'] as AccountStatus[]).map((s) => <option key={s} value={s}>{tx(`status.account.${s}`)}</option>)}
          </Select>
        </Field>
      </div>
      <div className="acc-staff-stats">
        <Stat label={t('accounts.staff.accounts')} value={f.num(rows.length)} />
        <Stat label={t('accounts.staff.clients')} value={f.num(totals.clients)} />
        <Stat label={t('accounts.staff.deposits', { base: f.base })} value={f.money(totals.deposits, f.base, { compact: true })} />
        <Stat label={t('accounts.staff.frozen')} value={f.num(totals.frozen)} />
      </div>
      <DataTable
        rows={rows}
        rowKey={(r) => r.acc.id}
        rowLink={(r) => `/accounts/${r.acc.id}`}
        pageSize={20}
        csvName="ledgerhall-account-register"
        empty={<Empty title={t('accounts.staff.none')}>{t('accounts.filters.noneHint')}</Empty>}
        columns={[
          { key: 'name', header: t('common.account'), value: (r) => r.acc.name, render: (r) => (
            <div className="row-nowrap"><span className="glyph acc-glyph-sm" aria-hidden><TypeIcon type={r.acc.type} /></span><div style={{ minWidth: 0 }}><div className="truncate" style={{ fontWeight: 600 }}>{r.acc.name}</div><div className="xsmall mono muted">{formatAccountNumber(r.acc.number)}</div></div></div>
          ) },
          { key: 'holder', header: t('common.holder'), value: (r) => r.holder, render: (r) => <div><div>{r.holder}</div><div className="xsmall muted mono">{r.clientId}</div></div>, hideMobile: true },
          { key: 'type', header: t('common.type'), value: (r) => tx(`accountType.${r.acc.type}`), render: (r) => <span className="small">{tx(`accountType.${r.acc.type}`)}</span>, hideMobile: true },
          { key: 'status', header: t('common.status'), value: (r) => r.acc.status, render: (r) => <StatusBadge domain="account" status={r.acc.status} />, hideMobile: true },
          { key: 'opened', header: t('accounts.opened'), value: (r) => r.acc.createdAt, render: (r) => <span className="small">{f.date(r.acc.createdAt)}</span>, hideMobile: true },
          { key: 'balance', header: t('common.balance'), align: 'right', value: (r) => r.base, render: (r) => <span className={r.balance < 0 ? 'neg' : ''}>{f.money(r.balance, r.acc.currency)}</span> },
        ]}
      />
    </Panel>
  );
}
