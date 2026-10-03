/** SIGIL card register: every card the client holds, issuance, emergency freeze (?action=freeze) and card activity. */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CreditCard, Snowflake, Sun, Plus, ArrowRight, Smartphone, ShieldAlert, Activity } from 'lucide-react';
import { useT, useFmt } from '@/hooks/useT';
import { useAction } from '@/hooks/useAction';
import { useAccountsWithBalances, useLive, useMe, useMyAccounts } from '@/hooks/data';
import { db } from '@/core/db/db';
import { toBase } from '@/core/currency/rates';
import { freezeCard, unfreezeCard } from '@/core/banking/cards';
import { Badge, Button, Empty, PageHead, Panel, Progress, Segmented, Stat, StatusBadge } from '@/ui/primitives';
import { BankCard } from '@/ui/BankCard';
import { TxRow } from '../transactions/TxRow';
import { IssueCardDialog } from './IssueCardDialog';
import { FreezePicker } from './FreezePicker';
import { isRetired, sortCards, useCardSpend } from './cardKit';
import type { Card } from '@/core/types';

type Filter = 'all' | 'active' | 'frozen' | 'retired';

export default function CardsPage() {
  const { t, tx } = useT();
  const f = useFmt();
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const accounts = useMyAccounts({ includeHidden: true });
  const withBal = useAccountsWithBalances(accounts);
  const cards = useLive(() => (me ? db.cards.where('ownerId').equals(me.id).toArray() : []), [me?.id], [] as Card[]);
  const sorted = useMemo(() => sortCards(cards), [cards]);
  const spend = useCardSpend(cards);
  const [filter, setFilter] = useState<Filter>('all');
  const [issueOpen, setIssueOpen] = useState(false);
  const { run, busy } = useAction();
  const base = f.base;
  const freezeOpen = params.get('action') === 'freeze';
  const closeFreeze = () => {
    const next = new URLSearchParams(params);
    next.delete('action');
    setParams(next, { replace: true });
  };
  const ids = cards.map((c) => c.id).join();
  const activity = useLive(async () => {
    if (!cards.length) return [];
    const rows = await db.transactions.where('cardId').anyOf(cards.map((c) => c.id)).toArray();
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);
  }, [ids], []);
  const holds = useLive(async () => {
    if (!cards.length) return [];
    const rows = await db.transactions.where('cardId').anyOf(cards.map((c) => c.id)).filter((x) => x.type === 'card_payment' && x.status === 'processing').toArray();
    return rows;
  }, [ids], []);
  const mine = useMemo(() => new Set(accounts.map((a) => a.id)), [accounts]);

  const counts = {
    active: cards.filter((c) => c.status === 'active').length,
    frozen: cards.filter((c) => c.status === 'frozen').length,
    retired: cards.filter(isRetired).length,
    wallet: cards.filter((c) => c.wallet.added).length,
  };
  const spentToday = cards.reduce((s, c) => s + toBase((spend.get(c.id)?.all ?? 0) + (spend.get(c.id)?.atm ?? 0), c.currency, base), 0);
  const authTotal = holds.reduce((s, h) => s + toBase(h.amount + h.fee, h.currency, base), 0);
  const shown = sorted.filter((c) => (filter === 'all' ? c.status !== 'replaced' : filter === 'active' ? c.status === 'active' : filter === 'frozen' ? c.status === 'frozen' : isRetired(c)));

  return (
    <div className="page">
      <PageHead
        eyebrow={t('dept.PAY')}
        title={t('cards.title')}
        sub={t('cards.sub')}
        actions={
          <>
            <Button icon={<Snowflake />} onClick={() => setParams({ action: 'freeze' })}>{t('cards.freeze.title')}</Button>
            <Button variant="primary" icon={<Plus />} onClick={() => setIssueOpen(true)}>{t('cards.issue.title')}</Button>
          </>
        }
      />

      <section className="panel ornate sg-register" aria-label={t('cards.summary')}>
        <div className="sg-register-seal" aria-hidden>
          <svg viewBox="0 0 40 40" width="54" height="54"><path d="M20 3 L24 15 L37 15 L27 23 L31 36 L20 28 L9 36 L13 23 L3 15 L16 15 Z" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="20" cy="21" r="17.5" fill="none" stroke="currentColor" strokeWidth="0.8" strokeDasharray="2 2" /></svg>
          <span>SIGIL</span>
        </div>
        <div className="grid cols-4 sg-register-stats">
          <Stat label={t('cards.stats.active')} value={counts.active} foot={t('cards.stats.ofTotal', { n: cards.filter((c) => c.status !== 'replaced').length })} />
          <Stat label={t('cards.stats.frozen')} value={<span className={counts.frozen ? 'warn-text' : ''}>{counts.frozen}</span>} foot={t('cards.stats.retired', { n: counts.retired })} />
          <Stat label={t('cards.stats.spentToday')} value={f.money(spentToday, base, { mask: true })} foot={t('cards.stats.inBase', { ccy: base })} />
          <Stat label={t('cards.stats.authorizations')} value={f.money(authTotal, base, { mask: true })} foot={t('cards.stats.authCount', { n: holds.length })} />
        </div>
      </section>

      <div className="row-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <Segmented<Filter>
          label={t('common.filter')}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t('common.all') },
            { value: 'active', label: `${t('status.card.active')} · ${counts.active}` },
            { value: 'frozen', label: `${t('status.card.frozen')} · ${counts.frozen}` },
            { value: 'retired', label: `${t('cards.retired')} · ${counts.retired}` },
          ]}
        />
        <span className="xsmall muted row" style={{ gap: 6 }}><Smartphone size={14} aria-hidden />{t('cards.stats.wallet', { n: counts.wallet })}</span>
      </div>

      {shown.length ? (
        <div className="sg-card-grid">
          {shown.map((c) => {
            const acc = withBal.find((a) => a.id === c.accountId);
            const pocket = acc?.pocketsInfo.find((p) => p.currency === c.currency);
            const s = spend.get(c.id);
            return (
              <article key={c.id} className={`sg-card-tile${isRetired(c) ? ' retired' : ''}`}>
                <Link to={`/cards/${c.id}`} className="sg-card-face" aria-label={t('cards.openCard', { last4: c.last4 })}>
                  <BankCard card={c} compact />
                </Link>
                <div className="sg-tile-body">
                  <div className="row-between">
                    <strong>{tx(`cardType.${c.type}`)} <span className="mono muted">•{c.last4}</span></strong>
                    <StatusBadge domain="card" status={c.status} />
                  </div>
                  <div className="xsmall muted truncate">{acc ? acc.name : c.currency}{c.wallet.added && <> · <Smartphone size={11} aria-hidden /> {t('cards.inWallet')}</>}</div>
                  <div className="sg-tile-figures">
                    <div>
                      <div className="stat-label">{c.type === 'credit' ? t('cards.creditAvailable') : t('common.available')}</div>
                      <div className="tnum sg-tile-amount">{pocket ? f.money(pocket.available, c.currency, { mask: true }) : '—'}</div>
                    </div>
                    <div>
                      <div className="stat-label">{t('cards.todayOfDaily')}</div>
                      <div className="tnum small">{f.money(s?.all ?? 0, c.currency)} / {f.money(c.limits.daily, c.currency, { compact: true })}</div>
                    </div>
                  </div>
                  <Progress value={s?.all ?? 0} max={c.limits.daily} label={t('cards.todayOfDaily')} />
                  <div className="row sg-tile-actions">
                    {c.status === 'active' && (
                      <Button size="sm" icon={<Snowflake />} loading={busy} onClick={() => run(() => freezeCard(c.id), { success: t('cards.frozenToast', { last4: c.last4 }), sound: 'card' })}>{t('common.freeze')}</Button>
                    )}
                    {c.status === 'frozen' && (
                      <Button size="sm" icon={<Sun />} loading={busy} onClick={() => run(() => unfreezeCard(c.id), { success: t('cards.unfrozenToast', { last4: c.last4 }), sound: 'card' })}>{t('common.unfreeze')}</Button>
                    )}
                    {c.status === 'replaced' && c.replacedById && <Link className="btn btn-sm btn-ghost" to={`/cards/${c.replacedById}`}>{t('cards.seeReplacement')}</Link>}
                    <Link className="btn btn-sm btn-ghost" to={`/cards/${c.id}`}>{t('common.details')}<ArrowRight /></Link>
                  </div>
                </div>
              </article>
            );
          })}
          {filter !== 'retired' && (
            <button type="button" className="sg-card-new" onClick={() => setIssueOpen(true)}>
              <span className="glyph"><Plus /></span>
              <strong>{t('cards.issue.title')}</strong>
              <span className="xsmall muted">{t('cards.issue.teaser')}</span>
            </button>
          )}
        </div>
      ) : (
        <Panel>
          <Empty icon={<CreditCard aria-hidden />} title={filter === 'all' ? t('cards.empty') : t('cards.emptyFilter')} action={filter === 'all' ? <Button variant="primary" icon={<Plus />} onClick={() => setIssueOpen(true)}>{t('cards.issue.title')}</Button> : undefined} />
        </Panel>
      )}

      <div className="grid cols-main">
        <Panel title={t('cards.activity')} icon={<Activity />} flush actions={<Link className="btn btn-sm btn-ghost" to="/transactions">{t('common.seeAll')}<ArrowRight /></Link>}>
          {activity.length ? <div className="list">{activity.map((x) => <TxRow key={x.id} tx={x} mine={mine} />)}</div> : <Empty title={t('cards.noActivity')} />}
        </Panel>
        <Panel title={t('cards.safety.title')} icon={<ShieldAlert />}>
          <div className="stack-sm small ink2">
            <p>{t('cards.safety.freeze')}</p>
            <p>{t('cards.safety.block')}</p>
            <p>{t('cards.safety.pin')}</p>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <Badge tone="info">{t('cards.safety.network')}</Badge>
            <Link className="btn btn-sm" to="/atm">{t('nav.atm')}<ArrowRight /></Link>
          </div>
        </Panel>
      </div>

      {issueOpen && <IssueCardDialog onClose={() => setIssueOpen(false)} />}
      {freezeOpen && <FreezePicker cards={sorted} accounts={accounts} onClose={closeFreeze} />}
    </div>
  );
}
