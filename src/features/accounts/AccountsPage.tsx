/** Register of Accounts: every account of the client grouped by type, totals in base currency, filters; staff can browse all clients. */
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, ArrowLeftRight, BookOpen, RotateCcw } from 'lucide-react';
import { useT, useFmt } from '@/hooks/useT';
import { useAccountsWithBalances, useLive, useMe, useMyAccounts, useUserMap, totalIn } from '@/hooks/data';
import { useUI } from '@/state/ui';
import { useCan } from '@/state/session';
import { db } from '@/core/db/db';
import { toBase } from '@/core/currency/rates';
import { currencies } from '@/core/currency/registry';
import { Button, Empty, Field, Input, PageHead, Segmented, Select, Stat, Switch } from '@/ui/primitives';
import type { AccountStatus, AccountType } from '@/core/types';
import { AccountFolio } from './AccountFolio';
import { StaffRegistry } from './StaffRegistry';
import { ACCOUNT_TYPE_ORDER, TypeIcon } from './shared';

export default function AccountsPage() {
  const { t, tx } = useT();
  const f = useFmt();
  const me = useMe();
  const ui = useUI();
  const base = ui.baseCurrency;
  const staff = useCan('accounts.manage_any');
  const [sp, setSp] = useSearchParams();
  const scope = staff && sp.get('scope') === 'all' ? 'all' : 'mine';
  const type = (sp.get('type') ?? '') as '' | AccountType;
  const status = (sp.get('status') ?? '') as '' | AccountStatus;
  const ccy = sp.get('ccy') ?? '';
  const q = sp.get('q') ?? '';
  const showClosed = sp.get('closed') === '1';
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v);
    else next.delete(k);
    setSp(next, { replace: true });
  };

  const all = useMyAccounts({ includeClosed: true, includeHidden: true });
  const withBal = useAccountsWithBalances(all);
  const users = useUserMap();
  const holds = useLive(async () => {
    const ids = all.map((a) => a.id);
    if (!ids.length) return [];
    return db.holds.where('accountId').anyOf(ids).filter((h) => h.status === 'active').toArray();
  }, [all.map((a) => a.id).join()], []);

  const open = withBal.filter((a) => a.status !== 'closed');
  const total = totalIn(open, base, 'balance', (a) => a.type !== 'credit' && a.type !== 'loan');
  const available = totalIn(open, base, 'available', (a) => a.type !== 'credit' && a.type !== 'loan');
  const blocked = holds.reduce((s, h) => s + toBase(h.amount, h.currency, base), 0);
  const creditUsed = open.filter((a) => a.type === 'credit').reduce((s, a) => s + a.pocketsInfo.reduce((x, p) => x + toBase(Math.min(0, p.balance), p.currency, base), 0), 0);
  const loans = open.filter((a) => a.type === 'loan').reduce((s, a) => s + a.pocketsInfo.reduce((x, p) => x + toBase(p.balance, p.currency, base), 0), 0);
  const pocketCount = open.reduce((s, a) => s + a.pockets.length, 0);
  const ccyOptions = useMemo(() => [...new Set(all.flatMap((a) => a.pockets))].sort(), [all]);

  const filtered = withBal.filter((a) => {
    if (!showClosed && a.status === 'closed' && status !== 'closed') return false;
    if (type && a.type !== type) return false;
    if (status && a.status !== status) return false;
    if (ccy && !a.pockets.includes(ccy)) return false;
    if (q) {
      const needle = q.toLowerCase().replace(/\s+/g, '');
      if (![a.name, a.number, a.id].some((s) => s.toLowerCase().replace(/\s+/g, '').includes(needle))) return false;
    }
    return true;
  });
  const groups = ACCOUNT_TYPE_ORDER.map((ty) => ({ type: ty, items: filtered.filter((a) => a.type === ty) })).filter((g) => g.items.length);
  const closedCount = all.filter((a) => a.status === 'closed').length;
  const activeFilters = [type, status, ccy, q].filter(Boolean).length;

  return (
    <div className="page acc-page">
      <PageHead
        eyebrow={<>{t('dept.DEP')}<span className="acc-eyebrow-sep" aria-hidden>·</span>{t('accounts.registerCode')}</>}
        title={t('accounts.title')}
        sub={t('accounts.sub')}
        actions={
          <>
            {staff && (
              <Segmented label={t('accounts.scope')} value={scope} onChange={(v) => setParam('scope', v === 'all' ? 'all' : '')} options={[{ value: 'mine', label: t('accounts.scopeMine') }, { value: 'all', label: t('accounts.scopeAll') }]} />
            )}
            <Button icon={<ArrowLeftRight />} onClick={() => ui.openAction('transfer', { mode: 'own' })}>{t('accounts.transferOwn')}</Button>
            <Button variant="primary" icon={<Plus />} onClick={() => ui.openAction('openAccount')}>{t('quick.openAccount')}</Button>
          </>
        }
      />

      {scope === 'all' ? (
        <StaffRegistry />
      ) : (
        <>
          <section className="panel ornate acc-ledger-summary" aria-label={t('accounts.summary')}>
            <div className="acc-summary-lead">
              <div className="eyebrow">{t('accounts.summaryEyebrow', { client: me?.clientId ?? '' })}</div>
              <div className="stat-label">{t('accounts.totalIn', { base })}</div>
              <div className="hero-figure tnum">{f.money(total, base, { mask: true })}</div>
              <div className="xsmall muted">{t('accounts.totalNote', { name: currencies.get(base)?.name ?? base })}</div>
            </div>
            <div className="acc-summary-grid">
              <Stat label={t('common.available')} value={f.money(available, base, { mask: true })} />
              <Stat label={t('common.blocked')} value={f.money(blocked, base, { mask: true })} foot={t('accounts.holdsCount', { n: holds.length })} />
              <Stat label={t('accounts.creditUsed')} value={f.money(-creditUsed, base, { mask: true })} />
              <Stat label={t('accounts.loansOutstanding')} value={f.money(loans, base, { mask: true })} />
              <Stat label={t('accounts.folios')} value={<span className="mono">{f.num(open.length)}</span>} foot={t('accounts.pocketsCount', { n: pocketCount })} />
            </div>
          </section>

          <section className="panel acc-filterbar" aria-label={t('common.filter')}>
            <Field label={t('common.search')} htmlFor="ac-q" className="acc-filter-search">
              <Input id="ac-q" type="search" value={q} onChange={(e) => setParam('q', e.target.value)} placeholder={t('accounts.filters.searchPh')} />
            </Field>
            <Field label={t('common.type')} htmlFor="ac-type">
              <Select id="ac-type" value={type} onChange={(e) => setParam('type', e.target.value)}>
                <option value="">{t('common.all')}</option>
                {ACCOUNT_TYPE_ORDER.map((x) => <option key={x} value={x}>{tx(`accountType.${x}`)}</option>)}
              </Select>
            </Field>
            <Field label={t('common.status')} htmlFor="ac-status">
              <Select id="ac-status" value={status} onChange={(e) => setParam('status', e.target.value)}>
                <option value="">{t('common.all')}</option>
                {(['active', 'frozen', 'pending', 'closed'] as AccountStatus[]).map((s) => <option key={s} value={s}>{tx(`status.account.${s}`)}</option>)}
              </Select>
            </Field>
            <Field label={t('common.currency')} htmlFor="ac-ccy">
              <Select id="ac-ccy" value={ccy} onChange={(e) => setParam('ccy', e.target.value)}>
                <option value="">{t('common.all')}</option>
                {ccyOptions.map((c) => <option key={c} value={c}>{c} · {currencies.get(c)?.name ?? c}</option>)}
              </Select>
            </Field>
            <div className="field acc-filter-switch">
              <Switch checked={showClosed} onChange={(v) => setParam('closed', v ? '1' : '')} label={t('accounts.filters.showClosed', { n: closedCount })} />
            </div>
            {activeFilters > 0 && (
              <div className="field acc-filter-reset">
                <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => setSp(new URLSearchParams(showClosed ? { closed: '1' } : {}), { replace: true })}>{t('common.reset')}</Button>
              </div>
            )}
          </section>

          {groups.map((g) => {
            const sub = g.items.filter((a) => a.status !== 'closed').reduce((s, a) => s + a.pocketsInfo.reduce((x, p) => x + toBase(p.balance, p.currency, base), 0), 0);
            return (
              <section key={g.type} className="acc-group" aria-labelledby={`acc-g-${g.type}`}>
                <header className="acc-group-head">
                  <span className="acc-group-icon" aria-hidden><TypeIcon type={g.type} /></span>
                  <h2 id={`acc-g-${g.type}`} className="acc-group-title">{tx(`accountType.${g.type}`)}</h2>
                  <span className="acc-group-count mono">{t('accounts.groupCount', { n: g.items.length })}</span>
                  <span className="acc-group-rule" aria-hidden />
                  <span className="acc-group-total tnum">{f.money(sub, base, { mask: true })}</span>
                </header>
                <div className="acc-folio-grid-wrap">
                  {g.items.map((a) => <AccountFolio key={a.id} a={a} users={users} meId={me?.id} />)}
                </div>
              </section>
            );
          })}
          {!groups.length && (
            <Empty icon={<BookOpen aria-hidden />} title={all.length ? t('accounts.filters.none') : t('accounts.empty')} action={
              all.length
                ? <Button size="sm" onClick={() => setSp(new URLSearchParams(), { replace: true })}>{t('common.reset')}</Button>
                : <Button size="sm" variant="primary" icon={<Plus />} onClick={() => ui.openAction('openAccount')}>{t('quick.openAccount')}</Button>
            }>{all.length ? t('accounts.filters.noneHint') : t('accounts.emptyHint')}</Empty>
          )}
        </>
      )}
    </div>
  );
}
