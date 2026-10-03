/** Checks: the check books of the client — written, received and (for tellers) the Exchequer register. */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ScrollText, Inbox, Search, PenLine } from 'lucide-react';
import { useT, useFmt } from '@/hooks/useT';
import { useLive, useMe } from '@/hooks/data';
import { useCan } from '@/state/session';
import { useUI } from '@/state/ui';
import { db } from '@/core/db/db';
import { toBase } from '@/core/currency/rates';
import { monthKey, now } from '@/core/clock';
import { Button, Empty, Input, PageHead, Select, Stat, Tabs, Pager } from '@/ui/primitives';
import { CheckStub, PresentDialog } from './parts';
import type { Check, CheckStatus } from '@/core/types';

type Tab = 'issued' | 'received' | 'all' | 'bank';
const STATUSES: CheckStatus[] = ['draft', 'issued', 'presented', 'processing', 'paid', 'cancelled', 'rejected', 'expired'];
const PAGE = 12;

export default function ChecksPage() {
  const { t, tx } = useT();
  const f = useFmt();
  const me = useMe();
  const base = useUI((s) => s.baseCurrency);
  const openAction = useUI((s) => s.openAction);
  const isTeller = useCan('teller.desk');
  const [params, setParams] = useSearchParams();
  const tab = (['issued', 'received', 'all', 'bank'].includes(params.get('tab') ?? '') ? params.get('tab') : 'issued') as Tab;
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | CheckStatus>('');
  const [page, setPage] = useState(0);
  const [present, setPresent] = useState<{ number?: string; code?: string } | null>(null);

  const issued = useLive(() => (me ? db.checks.where('issuerId').equals(me.id).toArray() : []), [me?.id], [] as Check[]);
  const received = useLive(() => (me ? db.checks.where('payeeId').equals(me.id).toArray() : []), [me?.id], [] as Check[]);
  const register = useLive(() => (isTeller ? db.checks.toArray() : []), [isTeller], [] as Check[]);

  const source = tab === 'issued' ? issued : tab === 'received' ? received : tab === 'bank' ? register : [...issued, ...received.filter((c) => c.issuerId !== me?.id)];
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return source
      .filter((c) => !status || c.status === status)
      .filter((c) => !needle || [c.number, c.payeeName, c.issuerName, c.purpose, c.verificationCode].some((v) => v?.toLowerCase().includes(needle)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [source, q, status]);

  const month = monthKey(now());
  const sum = (list: Check[]) => list.reduce((s, c) => s + toBase(c.amount, c.currency, base), 0);
  const outstanding = issued.filter((c) => c.status === 'issued');
  const toPresent = received.filter((c) => c.status === 'issued');
  const paidMonth = [...issued, ...received].filter((c) => c.status === 'paid' && (c.paidAt ?? '').startsWith(month));
  const drafts = issued.filter((c) => c.status === 'draft');

  const setTab = (v: Tab) => {
    setPage(0);
    setParams(v === 'issued' ? {} : { tab: v }, { replace: true });
  };
  const perspective = (c: Check) => (tab === 'bank' ? 'bank' : c.payeeId === me?.id && c.issuerId !== me?.id ? 'payee' : 'issuer');

  return (
    <div className="page">
      <PageHead
        eyebrow={t('dept.PAY')}
        title={t('checks.title')}
        sub={t('checks.sub')}
        actions={<>
          <Button icon={<Inbox />} onClick={() => setPresent({})}>{t('checks.presentAction')}</Button>
          <Button variant="primary" icon={<PenLine />} onClick={() => openAction('check')}>{t('checks.write')}</Button>
        </>}
      />

      <section className="chk-ledger panel" aria-label={t('checks.title')}>
        <Stat label={t('checks.stats.outstanding')} value={f.money(sum(outstanding), base)} foot={`${outstanding.length} · ${t('checks.tabs.issued')}`} />
        <Stat label={t('checks.stats.toPresent')} value={f.money(sum(toPresent), base)} foot={`${toPresent.length} · ${t('checks.tabs.received')}`} />
        <Stat label={t('checks.stats.paid')} value={f.money(sum(paidMonth), base)} foot={String(paidMonth.length)} />
        <Stat label={t('checks.stats.drafts')} value={String(drafts.length)} foot={drafts[0] ? `№ ${drafts[0].number}` : '—'} />
      </section>

      <div className="stack">
        <Tabs label={t('checks.tabsLabel')} value={tab} onChange={setTab} tabs={[
          { value: 'issued', label: t('checks.tabs.issued'), count: issued.length },
          { value: 'received', label: t('checks.tabs.received'), count: received.length },
          { value: 'all', label: t('checks.tabs.all') },
          ...(isTeller ? [{ value: 'bank' as Tab, label: t('checks.tabs.bank'), count: register.length }] : []),
        ]} />
        <div className="row chk-filters">
          <div className="dx-search grow">
            <Search aria-hidden />
            <Input aria-label={t('common.search')} placeholder={t('checks.searchPlaceholder')} value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
          </div>
          <Select aria-label={t('common.status')} value={status} onChange={(e) => { setStatus(e.target.value as CheckStatus | ''); setPage(0); }} style={{ maxWidth: 200 }}>
            <option value="">{t('checks.anyStatus')}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{tx(`status.check.${s}`)}</option>)}
          </Select>
        </div>
        {rows.length ? (
          <div className="chk-book">
            {rows.slice(page * PAGE, (page + 1) * PAGE).map((c) => (
              <CheckStub key={c.id} check={c} perspective={perspective(c)} onPresent={perspective(c) === 'payee' ? (x) => setPresent({ number: x.number, code: x.verificationCode }) : undefined} />
            ))}
            <Pager page={page} pageSize={PAGE} total={rows.length} onPage={setPage} />
          </div>
        ) : (
          <Empty title={q || status ? t('common.noResults') : tx(`checks.empty.${tab === 'bank' ? 'all' : tab}`)} icon={<ScrollText aria-hidden />}
            action={tab === 'issued' && !q && !status ? <Button variant="primary" icon={<PenLine />} onClick={() => openAction('check')}>{t('checks.write')}</Button> : undefined} />
        )}
      </div>
      {present && <PresentDialog onClose={() => setPresent(null)} number={present.number} code={present.code} />}
    </div>
  );
}
