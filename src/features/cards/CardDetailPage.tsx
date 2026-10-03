/** One SIGIL card: face and reveal, lifecycle actions, limits, controls, wallet, linked account, activity and a purchase simulator. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Repeat2, EyeOff, Landmark, ListOrdered, Clock, Hourglass, CheckCheck, Undo2, CreditCard } from 'lucide-react';
import { useT, useFmt } from '@/hooks/useT';
import { useAction } from '@/hooks/useAction';
import { useAccountsWithBalances, useLive, useMe, useNow } from '@/hooks/data';
import { useCan } from '@/state/session';
import { db } from '@/core/db/db';
import { nowMs } from '@/core/clock';
import { formatAccountNumber, formatCardNumber } from '@/core/banking/numbers';
import { settleCardTx, voidCardAuthorization } from '@/core/banking/cards';
import { getSettings } from '@/core/settings';
import { Alert, Badge, Button, CodeTag, Empty, KV, PageHead, Pager, Panel, StatusBadge } from '@/ui/primitives';
import { TxRow } from '../transactions/TxRow';
import { CardFace } from './CardFace';
import { CardActions } from './CardActions';
import { ControlsPanel, LimitsPanel } from './CardSettings';
import { PurchaseSimulator } from './PurchaseSimulator';
import { expiryLabel, useCardSpend } from './cardKit';
import type { Account, Card, Transaction } from '@/core/types';

const REVEAL_SECONDS = 30;
const PAGE = 10;

export default function CardDetailPage() {
  const { id = '' } = useParams();
  const { t } = useT();
  const me = useMe();
  const staff = useCan('teller.desk');
  const card = useLive(() => db.cards.get(id).then((c) => c ?? null), [id], undefined as Card | null | undefined);
  const visible = card && me && (card.ownerId === me.id || staff);
  if (card === undefined) return <div className="page"><div className="skeleton" style={{ height: 320 }} /></div>;
  if (!card || !visible) {
    return (
      <div className="page">
        <Panel><Empty icon={<CreditCard aria-hidden />} title={t('cards.notFound')} action={<Link className="btn" to="/cards"><ArrowLeft />{t('cards.backToCards')}</Link>}>{t('cards.notFoundText')}</Empty></Panel>
      </div>
    );
  }
  return <CardView card={card} />;
}

function CardView({ card }: { card: Card }) {
  const { t, tx } = useT();
  const f = useFmt();
  const accounts = useLive(() => db.accounts.get(card.accountId).then((a) => (a ? [a] : [])), [card.accountId], [] as Account[]);
  const [acc] = useAccountsWithBalances(accounts);
  const pocket = acc?.pocketsInfo.find((p) => p.currency === card.currency);
  const spend = useCardSpend(useMemo(() => [card], [card])).get(card.id);
  const [flipped, setFlipped] = useState(false);
  const [revealUntil, setRevealUntil] = useState<number | null>(null);
  const tick = useNow(1000);
  const left = revealUntil ? Math.max(0, Math.ceil((revealUntil - tick) / 1000)) : 0;
  const reveal = left > 0;
  useEffect(() => {
    if (revealUntil && left === 0) setRevealUntil(null);
  }, [left, revealUntil]);
  const controlsRef = useRef<HTMLDivElement>(null);
  const replacement = useLive(() => (card.replacedById ? db.cards.get(card.replacedById) : undefined), [card.replacedById], undefined);
  const predecessor = useLive(() => (card.replacesId ? db.cards.get(card.replacesId) : undefined), [card.replacesId], undefined);

  return (
    <div className="page">
      <PageHead
        eyebrow={t('dept.PAY')}
        title={<>{t('cards.detailTitle', { type: tx(`cardType.${card.type}`) })} <span className="mono muted" style={{ fontSize: '0.7em' }}>•{card.last4}</span></>}
        sub={`${card.holderName} · ${acc?.name ?? card.currency}`}
        actions={<Link className="btn btn-ghost" to="/cards"><ArrowLeft />{t('cards.backToCards')}</Link>}
      />

      {card.status === 'frozen' && <Alert tone="warning" title={t('cards.banner.frozenTitle')}>{t('cards.banner.frozen')}</Alert>}
      {card.status === 'blocked' && <Alert tone="negative" title={t('cards.banner.blockedTitle')}>{card.pinAttempts >= 3 ? t('cards.banner.blockedPin') : t('cards.banner.blocked')}</Alert>}
      {card.status === 'expired' && <Alert tone="warning" title={t('cards.banner.expiredTitle')}>{t('cards.banner.expired')}</Alert>}
      {card.status === 'replaced' && (
        <Alert tone="info" title={t('cards.banner.replacedTitle')}>
          {t('cards.banner.replaced')} {replacement && <Link to={`/cards/${replacement.id}`}>{tx(`cardType.${replacement.type}`)} •{replacement.last4} →</Link>}
        </Alert>
      )}

      <div className="grid cols-main">
        <div className="stack-lg">
          <section className="panel ornate sg-hero" aria-label={t('cards.face')}>
            <div className="sg-hero-face">
              <CardFace card={card} reveal={reveal} flipped={flipped} />
              <div className="row sg-hero-tools">
                <Button size="sm" variant="ghost" icon={<Repeat2 />} onClick={() => setFlipped((v) => !v)} aria-pressed={flipped}>{flipped ? t('cards.showFront') : t('cards.showBack')}</Button>
                {reveal && (
                  <>
                    <Badge tone="warning">{t('cards.reveal.countdown', { n: left })}</Badge>
                    <Button size="sm" variant="ghost" icon={<EyeOff />} onClick={() => setRevealUntil(null)}>{t('cards.reveal.hide')}</Button>
                  </>
                )}
              </div>
            </div>
            <div className="sg-hero-side">
              <KV items={[
                [t('cards.number'), <span className="mono">{formatCardNumber(card.number, !reveal)}</span>],
                [t('common.holderName'), card.holderName],
                [t('common.expiry'), <span className="mono">{expiryLabel(card)}</span>],
                [t('cards.cvv'), <span className="mono">{reveal ? card.cvv : '•••'}</span>],
                [t('common.status'), <StatusBadge domain="card" status={card.status} />],
                [t('common.currency'), card.currency],
                [t('cards.network'), <span className="row" style={{ gap: 6 }}>SIGIL · {t('app.network')}</span>],
                [t('cards.wallet.title'), card.wallet.added ? <span className="stack-sm" style={{ gap: 0 }}><span>{card.wallet.device}</span><CodeTag>{card.wallet.token}</CodeTag></span> : t('cards.wallet.notAdded')],
                [t('cards.issued'), f.date(card.createdAt)],
                ...(predecessor ? [[t('cards.replaces'), <Link to={`/cards/${predecessor.id}`}>•{predecessor.last4}</Link>] as [string, ReactNode]] : []),
              ]} />
              <div className="xsmall muted">{t('cards.pinAttempts', { n: card.pinAttempts })}</div>
            </div>
            <div className="sg-hero-actions">
              <CardActions card={card} onReveal={() => setRevealUntil(nowMs() + REVEAL_SECONDS * 1000)} />
            </div>
          </section>

          <PurchaseSimulator card={card} onShowControls={() => controlsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })} />
          <CardActivity card={card} />
        </div>

        <div className="stack-lg">
          <Panel title={t('cards.linked.title')} icon={<Landmark />} actions={acc && <Link className="btn btn-sm btn-ghost" to={`/accounts/${acc.id}`}>{t('common.open')}</Link>}>
            {acc ? (
              <div className="stack">
                <div>
                  <div className="li-title">{acc.name}</div>
                  <div className="xsmall muted mono">{formatAccountNumber(acc.number)} · {tx(`accountType.${acc.type}`)}</div>
                </div>
                <div className="grid cols-2" style={{ gap: 12 }}>
                  <div className="stat"><div className="stat-label">{acc.type === 'credit' ? t('cards.creditAvailable') : t('common.available')}</div><div className="stat-value tnum" style={{ fontSize: '1.35rem' }}>{pocket ? f.money(pocket.available, card.currency, { mask: true }) : '—'}</div></div>
                  <div className="stat"><div className="stat-label">{t('common.balance')}</div><div className="stat-value tnum" style={{ fontSize: '1.35rem' }}>{pocket ? f.money(pocket.balance, card.currency, { mask: true }) : '—'}</div></div>
                </div>
                {pocket && pocket.held > 0 && <div className="xsmall warn-text">{t('cards.linked.held', { amount: f.money(pocket.held, card.currency) })}</div>}
                <StatusBadge domain="account" status={acc.status} />
              </div>
            ) : <Empty title={t('common.noData')} />}
          </Panel>
          <LimitsPanel card={card} spend={spend} />
          <div ref={controlsRef}><ControlsPanel card={card} /></div>
        </div>
      </div>
    </div>
  );
}

function CardActivity({ card }: { card: Card }) {
  const { t } = useT();
  const f = useFmt();
  const me = useMe();
  const { run, busy } = useAction();
  const [page, setPage] = useState(0);
  const rows = useLive(() => db.transactions.where('cardId').equals(card.id).toArray().then((r) => r.sort((a, b) => b.createdAt.localeCompare(a.createdAt))), [card.id], [] as Transaction[]);
  const myAccounts = useLive(() => (me ? db.accounts.where('partyIds').equals(me.id).primaryKeys() : []), [me?.id], [] as string[]);
  const mine = useMemo(() => new Set([...myAccounts, card.accountId]), [myAccounts, card.accountId]);
  const pending = rows.filter((r) => r.type === 'card_payment' && r.status === 'processing');
  const settleSecs = getSettings().cardSettlementSeconds;
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  return (
    <>
      <Panel title={t('cards.auth.title')} icon={<Hourglass />} sub={t('cards.auth.sub', { n: settleSecs })} flush>
        {pending.length ? (
          <div className="list">
            {pending.map((p) => (
              <div key={p.id} className="list-item">
                <span className="glyph"><Clock /></span>
                <div className="li-main">
                  <Link className="li-title" to={`/transactions/${p.id}`}>{p.merchant?.name ?? p.recipient.name}</Link>
                  <div className="li-sub">{f.dateTime(p.createdAt)} · {p.timeline.find((s) => s.step === 'authorized')?.note ?? p.ref}</div>
                </div>
                <span className="tnum nowrap" style={{ fontWeight: 600 }}>{f.money(p.amount + p.fee, p.currency)}</span>
                <div className="row" style={{ gap: 6 }}>
                  <Button size="sm" icon={<CheckCheck />} loading={busy} title={t('cards.auth.captureHint')} onClick={() => run(() => settleCardTx(p.id), { success: t('cards.auth.captured'), sound: 'payment' })}>{t('cards.auth.capture')}</Button>
                  <Button size="sm" variant="ghost" icon={<Undo2 />} loading={busy} title={t('cards.auth.voidHint')} onClick={() => run(() => voidCardAuthorization(p.id), { success: t('cards.auth.voided'), sound: 'paper' })}>{t('cards.auth.void')}</Button>
                </div>
              </div>
            ))}
          </div>
        ) : <Empty title={t('cards.auth.none')} />}
      </Panel>
      <Panel title={t('cards.txs')} icon={<ListOrdered />} flush footer={rows.length > PAGE ? <Pager page={page} pageSize={PAGE} total={rows.length} onPage={setPage} /> : undefined}>
        {shown.length ? <div className="list">{shown.map((x) => <TxRow key={x.id} tx={x} mine={mine} />)}</div> : <Empty title={t('cards.noActivity')} />}
      </Panel>
    </>
  );
}
