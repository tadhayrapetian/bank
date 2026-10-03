/** Dashboard: identity, totals in a chosen base currency, pockets, cards, operations, notifications, quick actions. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeftRight, QrCode, Repeat, Wallet, ScrollText, Plus, PiggyBank, Banknote, HandCoins, ScanLine, FileSignature, Bell, Landmark, CreditCard, ShieldCheck, ArrowRight, Sparkles,
} from 'lucide-react';
import { useT, useFmt } from '@/hooks/useT';
import { useAccountsWithBalances, useLive, useMe, useMyAccounts, useMyTransactions, totalIn } from '@/hooks/data';
import { useUI, type ActionName } from '@/state/ui';
import { db } from '@/core/db/db';
import { MAJOR_CODES, currencies } from '@/core/currency/registry';
import { toBase } from '@/core/currency/rates';
import { translate } from '@/i18n';
import { formatAccountNumber } from '@/core/banking/numbers';
import { Avatar, Badge, Empty, Panel, Select, Stat, StatusBadge, Tabs, DemoFlag } from '@/ui/primitives';
import { BankCard } from '@/ui/BankCard';
import { RuneSigil } from '@/ui/heraldry';
import { TxRow } from '../transactions/TxRow';
import { directionFor } from '@/core/ops/analytics';
import { updatePreferences } from '@/core/security/auth';

const QUICK: { name: ActionName; icon: typeof ArrowLeftRight; label: 'quick.transfer' | 'quick.receive' | 'quick.exchange' | 'quick.pay' | 'quick.check' | 'quick.openAccount' | 'quick.deposit' | 'quick.withdraw' | 'quick.request' | 'quick.scan' | 'quick.document' }[] = [
  { name: 'transfer', icon: ArrowLeftRight, label: 'quick.transfer' },
  { name: 'receive', icon: QrCode, label: 'quick.receive' },
  { name: 'exchange', icon: Repeat, label: 'quick.exchange' },
  { name: 'pay', icon: Wallet, label: 'quick.pay' },
  { name: 'check', icon: ScrollText, label: 'quick.check' },
  { name: 'openAccount', icon: Plus, label: 'quick.openAccount' },
  { name: 'deposit', icon: PiggyBank, label: 'quick.deposit' },
  { name: 'withdraw', icon: Banknote, label: 'quick.withdraw' },
  { name: 'request', icon: HandCoins, label: 'quick.request' },
  { name: 'scan', icon: ScanLine, label: 'quick.scan' },
  { name: 'document', icon: FileSignature, label: 'quick.document' },
];

export default function DashboardPage() {
  const { t, tx, lang } = useT();
  const f = useFmt();
  const me = useMe();
  const ui = useUI();
  const base = ui.baseCurrency;
  const accounts = useMyAccounts();
  const withBal = useAccountsWithBalances(accounts);
  const mine = useMemo(() => new Set(accounts.map((a) => a.id)), [accounts]);
  const txs = useMyTransactions(400);
  const [tab, setTab] = useState<'all' | 'in' | 'out' | 'pending'>('all');
  const cards = useLive(() => (me ? db.cards.where('ownerId').equals(me.id).filter((c) => c.status !== 'replaced').toArray() : []), [me?.id], []);
  const notes = useLive(() => (me ? db.notifications.where('userId').equals(me.id).reverse().sortBy('createdAt').then((r) => r.slice(0, 6)) : []), [me?.id], []);
  const holds = useLive(async () => (await Promise.all(accounts.map((a) => db.holds.where('accountId').equals(a.id).filter((h) => h.status === 'active').toArray()))).flat(), [accounts.map((a) => a.id).join()], []);

  const total = totalIn(withBal, base, 'balance', (a) => a.type !== 'credit');
  const available = totalIn(withBal, base, 'available', (a) => a.type !== 'credit');
  const blocked = holds.reduce((s, h) => s + toBase(h.amount, h.currency, base), 0);
  const credit = withBal.filter((a) => a.type === 'credit').reduce((s, a) => s + a.pocketsInfo.reduce((x, p) => x + toBase(p.balance, p.currency, base), 0), 0);

  const pockets = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of withBal) if (a.type !== 'credit' && a.type !== 'loan') for (const p of a.pocketsInfo) m.set(p.currency, (m.get(p.currency) ?? 0) + p.balance);
    return [...m.entries()].filter(([, v]) => v !== 0).map(([ccy, v]) => ({ ccy, v, b: toBase(v, ccy, base) })).sort((a, b) => b.b - a.b);
  }, [withBal, base]);
  const pocketTotal = pockets.reduce((s, p) => s + Math.max(0, p.b), 0);

  const month = new Date().toISOString().slice(0, 7);
  const flows = useMemo(() => {
    let inn = 0, out = 0;
    for (const x of txs) {
      if (x.status !== 'completed' || !x.createdAt.startsWith(month)) continue;
      const d = directionFor(x, mine);
      if (d === 'in') inn += toBase(x.creditAmount ?? x.amount, x.creditCurrency ?? x.currency, base);
      if (d === 'out') out += toBase(x.amount, x.currency, base);
    }
    return { inn, out };
  }, [txs, mine, base, month]);

  const shown = txs.filter((x) => {
    const d = directionFor(x, mine);
    if (tab === 'in') return d === 'in' && x.status === 'completed';
    if (tab === 'out') return d === 'out' && x.status === 'completed';
    if (tab === 'pending') return x.status === 'pending' || x.status === 'processing';
    return true;
  }).slice(0, 9);
  const counts = {
    in: txs.filter((x) => directionFor(x, mine) === 'in' && x.status === 'completed').length,
    out: txs.filter((x) => directionFor(x, mine) === 'out' && x.status === 'completed').length,
    pending: txs.filter((x) => x.status === 'pending' || x.status === 'processing').length,
  };

  const hour = new Date().getUTCHours();
  const greet = hour < 12 ? t('dashboard.morning') : hour < 18 ? t('dashboard.afternoon') : t('dashboard.evening');

  return (
    <div className="page">
      <section className="panel ornate dash-hero" aria-label={t('dashboard.summary')}>
        <div className="dash-hero-id">
          <div className="row" style={{ gap: 14 }}>
            <Avatar name={me?.name ?? ''} hue={me?.avatarHue} size="lg" />
            <div className="stack-sm" style={{ gap: 2 }}>
              <div className="eyebrow">{greet}</div>
              <h1 style={{ fontSize: '2rem' }}>{me?.honorific ? `${me.honorific} ` : ''}{me?.name}</h1>
              <div className="row small ink2" style={{ gap: 8 }}>
                <span className="code-tag">{me?.clientId}</span>
                {me && <Badge tone={me.segment === 'premium' ? 'magic' : 'neutral'}>{tx(`segment.${me.segment}`)}</Badge>}
                {me && <StatusBadge domain="kyc" status={me.kycStatus} />}
              </div>
            </div>
          </div>
          <div className="dash-rune" aria-hidden><RuneSigil size={120} /></div>
        </div>
        <div className="dash-hero-figures">
          <div className="stack-sm">
            <div className="row-between">
              <span className="stat-label">{t('dashboard.totalBalance')}</span>
              <label className="row xsmall muted" style={{ gap: 6 }}>
                {t('common.baseCurrency')}
                <Select value={base} onChange={(e) => { ui.setBaseCurrency(e.target.value); void updatePreferences({ baseCurrency: e.target.value }); }} style={{ height: 28, width: 86, fontSize: 12 }} aria-label={t('common.baseCurrency')}>
                  {MAJOR_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </label>
            </div>
            <div className="hero-figure tnum">{f.money(total, base, { mask: true })}</div>
            <div className="xsmall muted">{t('dashboard.inBase', { name: currencies.get(base)?.name ?? base })}</div>
          </div>
          <div className="grid cols-3" style={{ gap: 14 }}>
            <Stat label={t('dashboard.available')} value={f.money(available, base, { mask: true })} />
            <Stat label={t('dashboard.blocked')} value={f.money(blocked, base, { mask: true })} foot={t('dashboard.holdsCount', { n: holds.length })} />
            <Stat label={t('dashboard.thisMonth')} value={<span className={flows.inn - flows.out >= 0 ? 'pos' : 'neg'}>{f.money(flows.inn - flows.out, base, { sign: true, mask: true })}</span>} foot={`${t('common.in')} ${f.money(flows.inn, base, { mask: true })} · ${t('common.out')} ${f.money(flows.out, base, { mask: true })}`} />
          </div>
          {credit < 0 && <div className="xsmall ink2">{t('dashboard.creditUsed', { amount: f.money(-credit, base) })}</div>}
        </div>
      </section>

      <Panel title={t('quick.title')}>
        <div className="quick-actions">
          {QUICK.map((q) => {
            const Icon = q.icon;
            return (
              <button key={q.name} type="button" className="qa" onClick={() => ui.openAction(q.name)}>
                <span className="glyph"><Icon /></span>
                {t(q.label)}
              </button>
            );
          })}
        </div>
      </Panel>

      <div className="grid cols-main">
        <Panel title={t('dashboard.operations')} icon={<ArrowLeftRight />} actions={<Link className="btn btn-sm btn-ghost" to="/transactions">{t('common.seeAll')}<ArrowRight /></Link>} flush>
          <div style={{ padding: '0 18px' }}>
            <Tabs label={t('dashboard.operations')} value={tab} onChange={setTab} tabs={[
              { value: 'all', label: t('common.all') },
              { value: 'in', label: t('dashboard.incoming'), count: counts.in },
              { value: 'out', label: t('dashboard.outgoing'), count: counts.out },
              { value: 'pending', label: t('dashboard.pending'), count: counts.pending },
            ]} />
          </div>
          <div className="list">
            {shown.map((x) => <TxRow key={x.id} tx={x} mine={mine} />)}
            {!shown.length && <Empty title={t('dashboard.noOperations')} />}
          </div>
        </Panel>

        <div className="stack-lg">
          <Panel title={t('dashboard.currencyAccounts')} icon={<Landmark />} actions={<Link className="btn btn-sm btn-ghost" to="/accounts">{t('nav.accounts')}<ArrowRight /></Link>}>
            <div className="stack">
              {pockets.map((p, i) => (
                <div key={p.ccy} className="stack-sm" style={{ gap: 4 }}>
                  <div className="row-between">
                    <span className="row" style={{ gap: 8 }}><span className="code-tag">{p.ccy}</span><span className="small ink2 truncate">{currencies.get(p.ccy)?.name}</span></span>
                    <span className="tnum" style={{ fontWeight: 600 }}>{f.money(p.v, p.ccy, { mask: true })}</span>
                  </div>
                  <div className="progress" aria-hidden><span style={{ width: `${pocketTotal ? Math.max(1, (Math.max(0, p.b) / pocketTotal) * 100) : 0}%`, background: `var(--s${(i % 8) + 1})` }} /></div>
                </div>
              ))}
              {!pockets.length && <Empty title={t('dashboard.noAccounts')} />}
            </div>
          </Panel>

          <Panel title={t('nav.cards')} icon={<CreditCard />} actions={<Link className="btn btn-sm btn-ghost" to="/cards">{t('common.seeAll')}<ArrowRight /></Link>}>
            <div className="card-strip">
              {cards.slice(0, 6).map((c) => (
                <Link key={c.id} to={`/cards/${c.id}`} className="card-strip-item" aria-label={`${tx(`cardType.${c.type}`)} •${c.last4}`}><BankCard card={c} compact /></Link>
              ))}
              {!cards.length && <Empty title={t('dashboard.noCards')} />}
            </div>
          </Panel>

          <Panel title={t('nav.notifications')} icon={<Bell />} actions={<Link className="btn btn-sm btn-ghost" to="/notifications">{t('common.seeAll')}<ArrowRight /></Link>} flush>
            <div className="list">
              {notes.map((n) => (
                <Link key={n.id} to={n.link ?? '/notifications'} className="list-item">
                  <span className="glyph" style={!n.read ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : undefined}>{n.category === 'security' ? <ShieldCheck /> : <Bell />}</span>
                  <div className="li-main">
                    <div className="li-title" style={{ fontWeight: n.read ? 400 : 600 }}>{translate(lang, n.titleKey, n.params)}</div>
                    <div className="li-sub">{translate(lang, n.bodyKey, n.params)}</div>
                  </div>
                </Link>
              ))}
              {!notes.length && <Empty title={t('dashboard.noNotifications')} />}
            </div>
          </Panel>
        </div>
      </div>

      <div className="row-between xsmall muted">
        <span>{t('dashboard.accountsLine', { n: accounts.length })} · {accounts[0] ? formatAccountNumber(accounts[0].number) : ''}</span>
        <DemoFlag><Sparkles size={12} />{t('app.demo')}</DemoFlag>
      </div>
    </div>
  );
}
