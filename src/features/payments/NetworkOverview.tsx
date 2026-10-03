/** Aetherline hub: network status, today's flows, limit usage, quick transfer and recent network payments. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowRight, Send, Radio, Gauge, Clock, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { useT, useFmt } from '@/hooks/useT';
import { useLive, useMe, useMyTransactions, useNow } from '@/hooks/data';
import { useUI } from '@/state/ui';
import { db } from '@/core/db/db';
import { startOfDayISO } from '@/core/clock';
import { toBase } from '@/core/currency/rates';
import { userOutgoingTodayUSD } from '@/core/banking/engine';
import { directionFor } from '@/core/ops/analytics';
import { Badge, Button, Field, Input, Panel, Progress, Select, StatusBadge, Stat, CodeTag } from '@/ui/primitives';
import { DataTable } from '@/ui/DataTable';
import { RuneSigil } from '@/ui/heraldry';
import { NETWORK_TYPES, TX_STATUSES, useMyAccountIds } from './shared';
import type { Transaction } from '@/core/types';

export function NetworkHero() {
  const { t, tx } = useT();
  const f = useFmt();
  const me = useMe();
  const base = useUI((s) => s.baseCurrency);
  const nowMs = useNow(30_000);
  const mine = useMyAccountIds();
  const services = useLive(() => db.services.toArray(), [], []);
  const net = services.filter((s) => s.service === 'payments' || s.service === 'transfers' || s.service === 'exchange');
  const impaired = net.some((s) => s.status !== 'operational');
  const since = startOfDayISO(new Date(nowMs));
  const today = useMyTransactions(0, (x) => x.createdAt >= since, [since]);
  const flows = useMemo(() => {
    let sent = 0, received = 0, nSent = 0, nIn = 0, flight = 0;
    for (const x of today) {
      if (x.status === 'pending' || x.status === 'processing') flight++;
      if (x.status !== 'completed') continue;
      const d = directionFor(x, mine);
      if (d === 'out') { sent += toBase(x.amount, x.currency, base); nSent++; }
      if (d === 'in') { received += toBase(x.creditAmount ?? x.amount, x.creditCurrency ?? x.currency, base); nIn++; }
    }
    return { sent, received, nSent, nIn, flight };
  }, [today, mine, base]);
  const used = useLive(() => (me ? userOutgoingTodayUSD(me.id) : 0), [me?.id, today.length], 0);
  const limit = me?.dailyLimitUSD ?? 0;

  return (
    <section className="panel ornate pay-hero" aria-label={t('payments.hero.network')}>
      <div className="pay-hero-net">
        <div className="row" style={{ gap: 12 }}>
          <span className={`pay-beacon${impaired ? ' warn' : ''}`} aria-hidden><Radio /></span>
          <div className="stack-sm" style={{ gap: 2 }}>
            <div className="eyebrow">{t('payments.hero.network')}</div>
            <strong className="pay-hero-state">{impaired ? t('payments.hero.impaired') : t('payments.hero.operational')}</strong>
          </div>
        </div>
        <div className="row pay-services">
          {net.map((s) => (
            <span key={s.service} className="chip" title={s.message || undefined}>
              {tx(`service.${s.service}`)} <StatusBadge domain="service" status={s.status} />
            </span>
          ))}
          <Link className="btn btn-sm btn-ghost" to="/status">{t('nav.status')}<ArrowRight /></Link>
        </div>
        <div className="pay-rune" aria-hidden><RuneSigil size={96} /></div>
      </div>
      <div className="pay-hero-figures">
        <Stat label={<span className="row" style={{ gap: 6 }}><ArrowUpRight size={13} aria-hidden />{t('payments.hero.sentToday')}</span>} value={f.money(flows.sent, base, { mask: true })} foot={t('payments.hero.paymentsToday', { n: flows.nSent })} />
        <Stat label={<span className="row" style={{ gap: 6 }}><ArrowDownLeft size={13} aria-hidden />{t('payments.hero.receivedToday')}</span>} value={<span className="pos">{f.money(flows.received, base, { mask: true })}</span>} foot={t('payments.hero.paymentsToday', { n: flows.nIn })} />
        <div className="stat">
          <div className="stat-label row" style={{ gap: 6 }}><Gauge size={13} aria-hidden />{t('payments.hero.limitUsed')}</div>
          {limit > 0 ? (
            <>
              <div className="stat-value tnum">{f.pct(Math.min(999, (used / limit) * 100), 0)}</div>
              <Progress value={used} max={limit} label={t('payments.hero.limitUsed')} />
              <div className="stat-foot" title={t('payments.hero.limitHint')}>{t('payments.hero.limitOf', { used: f.money(used, 'USD'), limit: f.money(limit, 'USD') })}</div>
            </>
          ) : <div className="stat-foot">{t('payments.hero.noLimit')}</div>}
        </div>
        <Stat label={<span className="row" style={{ gap: 6 }}><Clock size={13} aria-hidden />{t('payments.hero.inFlight')}</span>} value={flows.flight} foot={t('payments.hero.inFlightSub')} />
      </div>
    </section>
  );
}

export function QuickTransfer() {
  const { t } = useT();
  const openAction = useUI((s) => s.openAction);
  const [client, setClient] = useState('');
  const [amount, setAmount] = useState('');
  const recent = useMyTransactions(60, (x) => (x.type === 'transfer' || x.type === 'request' || x.type === 'link') && !!x.recipient.clientId);
  const me = useMe();
  const payees = useMemo(() => {
    const seen = new Map<string, string>();
    for (const x of recent) {
      if (x.initiatorId !== me?.id || !x.recipient.clientId || x.recipient.clientId === me?.clientId) continue;
      if (!seen.has(x.recipient.clientId)) seen.set(x.recipient.clientId, x.recipient.name);
      if (seen.size >= 6) break;
    }
    return [...seen.entries()];
  }, [recent, me?.id, me?.clientId]);
  const go = () => openAction('transfer', { mode: 'client', client: client.trim().toUpperCase(), amount });
  return (
    <Panel title={t('payments.quick.title')} sub={t('payments.quick.sub')} icon={<Send />}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <div className="form-grid">
          <Field label={t('payments.quick.client')} htmlFor="qt-client" hint={t('transfer.clientHint')}>
            <Input id="qt-client" value={client} onChange={(e) => setClient(e.target.value.toUpperCase())} placeholder="ALD-C-104702" autoComplete="off" className="mono" />
          </Field>
          <Field label={t('payments.quick.amount')} htmlFor="qt-amount">
            <Input id="qt-amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))} inputMode="decimal" placeholder="0.00" autoComplete="off" />
          </Field>
        </div>
        <div className="stack-sm">
          <div className="xsmall muted">{t('payments.quick.recent')}</div>
          {payees.length ? (
            <div className="row" style={{ gap: 6 }}>
              {payees.map(([id, name]) => (
                <button key={id} type="button" className="chip pay-payee" aria-pressed={client === id} onClick={() => setClient(id)}>
                  <span className="pay-initial" aria-hidden>{name.slice(0, 1)}</span>{name}
                </button>
              ))}
            </div>
          ) : <div className="xsmall muted">{t('payments.quick.noRecent')}</div>}
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button type="submit" variant="primary" icon={<ArrowRight />}>{t('payments.quick.continue')}</Button>
        </div>
      </form>
    </Panel>
  );
}

export function RecentNetworkPayments() {
  const { t, tx } = useT();
  const f = useFmt();
  const mine = useMyAccountIds();
  const [status, setStatus] = useState<string>('all');
  const [type, setType] = useState<string>('all');
  const rows = useMyTransactions(0, (x) => NETWORK_TYPES.includes(x.type));
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r.status] = (m[r.status] ?? 0) + 1;
    return m;
  }, [rows]);
  const shown = rows.filter((r) => (status === 'all' || r.status === status) && (type === 'all' || r.type === type));
  const dirOf = (x: Transaction) => directionFor(x, mine);
  return (
    <Panel title={t('payments.recent.title')} sub={t('payments.recent.sub')} icon={<Activity />} flush
      actions={<Link className="btn btn-sm btn-ghost" to="/transactions">{t('common.seeAll')}<ArrowRight /></Link>}>
      <div className="pay-filters">
        <div className="pay-status-strip" role="group" aria-label={t('payments.recent.filterStatus')}>
          <button type="button" aria-pressed={status === 'all'} onClick={() => setStatus('all')}>{t('common.all')} <span className="count">{rows.length}</span></button>
          {TX_STATUSES.map((s) => (
            <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)} title={tx(`payments.statusHelp.${s}`)} className={`st-${s}`}>
              {tx(`status.tx.${s}`)} <span className="count">{counts[s] ?? 0}</span>
            </button>
          ))}
        </div>
        <Select aria-label={t('payments.recent.filterType')} value={type} onChange={(e) => setType(e.target.value)} style={{ width: 'auto', minWidth: 200 }}>
          <option value="all">{t('payments.recent.allTypes')}</option>
          {NETWORK_TYPES.map((ty) => <option key={ty} value={ty}>{tx(`txType.${ty}`)}</option>)}
        </Select>
      </div>
      {status !== 'all' && <div className="pay-status-help small ink2"><StatusBadge domain="tx" status={status} /> {tx(`payments.statusHelp.${status}`)}</div>}
      <DataTable
        rows={shown}
        rowKey={(r) => r.id}
        rowLink={(r) => (r.type === 'international' ? `/international?track=${r.id}` : `/transactions/${r.id}`)}
        initialSort={{ key: 'date', dir: 'desc' }}
        pageSize={12}
        csvName="aetherline-payments"
        empty={<div className="empty"><div className="empty-title">{t('payments.recent.empty')}</div></div>}
        columns={[
          { key: 'date', header: t('common.date'), value: (r) => r.createdAt, render: (r) => <span className="nowrap small">{f.dateTime(r.createdAt)}</span> },
          {
            key: 'party', header: t('payments.recent.counterparty'), value: (r) => (dirOf(r) === 'in' ? r.sender.name : r.recipient.name),
            render: (r) => {
              const d = dirOf(r);
              return (
                <div className="stack-sm" style={{ gap: 0, minWidth: 0 }}>
                  <span className="row" style={{ gap: 6 }}>
                    <span className={`pay-dir ${d}`} aria-label={d === 'in' ? t('payments.recent.dirIn') : d === 'out' ? t('payments.recent.dirOut') : t('payments.recent.dirOwn')}>{d === 'in' ? <ArrowDownLeft /> : <ArrowUpRight />}</span>
                    <strong className="truncate">{d === 'in' ? r.sender.name : r.recipient.name}</strong>
                  </span>
                  <span className="xsmall muted truncate">{r.description}</span>
                </div>
              );
            },
          },
          { key: 'type', header: t('common.type'), hideMobile: true, value: (r) => r.type, render: (r) => <span className="small">{tx(`txType.${r.type}`)}<span className="muted"> · {tx(`channel.${r.channel}`)}</span></span> },
          { key: 'ref', header: t('common.reference'), hideMobile: true, value: (r) => r.ref, render: (r) => <CodeTag>{r.ref}</CodeTag> },
          { key: 'fee', header: t('common.fee'), align: 'right', hideMobile: true, value: (r) => r.fee, render: (r) => (r.fee ? <span className="tnum small">{f.money(r.fee, r.feeCurrency)}</span> : <span className="muted small">—</span>) },
          {
            key: 'amount', header: t('common.amount'), align: 'right', value: (r) => r.amount,
            render: (r) => {
              const d = dirOf(r);
              const amt = d === 'in' ? r.creditAmount ?? r.amount : r.amount;
              const ccy = d === 'in' ? r.creditCurrency ?? r.currency : r.currency;
              const dead = ['failed', 'rejected', 'cancelled', 'expired'].includes(r.status);
              return <span className={`tnum nowrap ${dead ? 'muted' : d === 'in' ? 'pos' : ''}`} style={{ fontWeight: 600, textDecoration: dead ? 'line-through' : undefined }}>{f.money(d === 'in' ? amt : d === 'out' ? -amt : amt, ccy, { sign: d !== 'internal' && d !== 'none', mask: true })}</span>;
            },
          },
          { key: 'status', header: t('common.status'), value: (r) => r.status, render: (r) => <span className="row" style={{ gap: 4 }}><StatusBadge domain="tx" status={r.status} />{r.stage && r.status !== 'completed' && r.stage !== 'completed' ? <Badge tone="info" plain>{tx(`step.${r.stage}`)}</Badge> : null}</span> },
        ]}
      />
      <details className="pay-guide">
        <summary>{t('payments.recent.statusGuide')}</summary>
        <dl>
          {TX_STATUSES.map((s) => (
            <div key={s}><dt><StatusBadge domain="tx" status={s} /></dt><dd className="small ink2">{tx(`payments.statusHelp.${s}`)}</dd></div>
          ))}
        </dl>
      </details>
    </Panel>
  );
}
