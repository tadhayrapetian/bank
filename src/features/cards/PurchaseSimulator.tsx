/**
 * Merchant terminal simulator: presents the card at a fictional merchant through the
 * real card-payment pipeline, then explains which check approved or declined it.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Store, Check, X, Minus, CreditCard, Wifi, Globe, Cpu, Magnet, ArrowRight } from 'lucide-react';
import { Panel, Button, Field, Input, Select, Segmented, DemoFlag, Badge, CodeTag, KV } from '@/ui/primitives';
import { MoneyInput } from '@/ui/pickers';
import { ErrorPanel } from '@/ui/ErrorPanel';
import { TxTimeline } from '@/ui/Timeline';
import { useT, useFmt } from '@/hooks/useT';
import { useAction } from '@/hooks/useAction';
import { useLive } from '@/hooks/data';
import { db } from '@/core/db/db';
import { MERCHANTS, realmName } from '@/core/institution';
import { toMinor } from '@/core/currency/format';
import { quote } from '@/core/currency/rates';
import { isBankError, toBankError } from '@/core/errors';
import { cardPayment, type CardChannel } from '@/core/banking/cards';
import type { Card } from '@/core/types';

type Channel = Exclude<CardChannel, 'atm'>;
type CheckKey = 'pin' | 'status' | 'channel' | 'international' | 'perTx' | 'daily' | 'fraud' | 'funds';
type CheckState = 'ok' | 'fail' | 'skip';

const CHANNEL_ICON: Record<Channel, typeof Wifi> = { online: Globe, contactless: Wifi, chip: Cpu, magstripe: Magnet };

/** Map the error the authorizer raised onto the check that failed. */
function failedCheck(err: unknown): CheckKey | null {
  if (!isBankError(err)) return null;
  switch (err.code) {
    case 'INVALID_PIN': return 'pin';
    case 'CARD_BLOCKED': return 'status';
    case 'CARD_CONTROL_DISABLED': return err.params.control === 'international' ? 'international' : 'channel';
    case 'CARD_LIMIT_EXCEEDED': return err.params.limit === 'perTx' ? 'perTx' : 'daily';
    case 'FRAUD_BLOCKED': return 'fraud';
    case 'INSUFFICIENT_FUNDS': return 'funds';
    default: return null;
  }
}

export function PurchaseSimulator({ card, onShowControls }: { card: Card; onShowControls: () => void }) {
  const { t, tx } = useT();
  const f = useFmt();
  const [mIdx, setMIdx] = useState(0);
  const m = MERCHANTS[mIdx];
  const [amount, setAmount] = useState(String(Math.round((m.min + m.max) / 3)));
  const [channel, setChannel] = useState<Channel>(card.type === 'virtual' ? 'online' : 'contactless');
  const [pin, setPin] = useState('');
  const [txId, setTxId] = useState<string | null>(null);
  const [attempted, setAttempted] = useState<{ channel: Channel; realm: string } | null>(null);
  const { run, busy, error, setError } = useAction();
  const txn = useLive(() => (txId ? db.transactions.get(txId) : undefined), [txId], undefined);
  const minor = amount.trim() ? toMinor(amount, m.currency) : 0;
  const conv = useMemo(() => (m.currency !== card.currency && minor > 0 ? quote(m.currency, card.currency, minor) : null), [m.currency, card.currency, minor]);
  const needsPin = channel === 'chip' || channel === 'magstripe';

  const present = () => {
    setTxId(null);
    setError(null);
    setAttempted({ channel, realm: m.realm });
    return run(
      () => cardPayment({ cardId: card.id, merchant: m.name, mcc: m.mcc, realm: m.realm, amount: minor, currency: m.currency, channel, category: m.category, pin: needsPin ? pin : undefined, onCreated: setTxId }),
      { sound: 'payment', silentError: true },
    ).then(() => setPin(''));
  };

  const failed = error ? failedCheck(error) : null;
  const authorized = !error && txn && (txn.status === 'processing' || txn.status === 'completed');
  const order: CheckKey[] = [...(attempted && (attempted.channel === 'chip' || attempted.channel === 'magstripe') ? (['pin'] as CheckKey[]) : []), 'status', 'channel', ...(attempted && attempted.realm !== 'ALD' ? (['international'] as CheckKey[]) : []), 'perTx', 'daily', 'fraud', 'funds'];
  const failIdx = failed ? order.indexOf(failed) : -1;
  const stateOf = (k: CheckKey, i: number): CheckState => (authorized ? 'ok' : failIdx < 0 ? 'skip' : i < failIdx ? 'ok' : i === failIdx ? 'fail' : 'skip');
  const authCode = txn?.timeline.find((s) => s.step === 'authorized')?.note;
  const err = error ? toBankError(error) : null;

  const explainFix = () => {
    if (!err) return null;
    if (err.code === 'CARD_CONTROL_DISABLED') {
      const ctl = String(err.params.control ?? '');
      return (
        <div className="row-between inset">
          <span className="small">{ctl === 'virtual_online_only' ? t('cards.sim.fix.virtual') : t('cards.sim.fix.control', { control: tx(`cards.controls.${ctl}`, undefined, ctl) })}</span>
          {ctl !== 'virtual_online_only' && <Button size="sm" onClick={onShowControls}>{t('cards.controls.title')}<ArrowRight /></Button>}
        </div>
      );
    }
    if (err.code === 'CARD_LIMIT_EXCEEDED') {
      const lim = String(err.params.limit ?? 'daily');
      return <div className="inset small">{t('cards.sim.fix.limit', { limit: tx(`cards.limits.${lim}`, undefined, lim), value: f.money(Number(err.params.value ?? 0), card.currency) })}</div>;
    }
    if (err.code === 'CARD_BLOCKED') return <div className="inset small">{t('cards.sim.fix.status', { status: tx(`status.card.${String(err.params.status ?? card.status)}`) })}</div>;
    if (err.code === 'INVALID_PIN') return <div className="inset small">{t('cards.sim.fix.pin')}</div>;
    if (err.code === 'INSUFFICIENT_FUNDS') return <div className="inset small">{t('cards.sim.fix.funds', { available: f.money(Number(err.params.available ?? 0), String(err.params.currency ?? card.currency)) })}</div>;
    return null;
  };

  return (
    <Panel title={t('cards.sim.title')} icon={<Store />} sub={t('cards.sim.sub')} actions={<DemoFlag>{t('cards.sim.flag')}</DemoFlag>}>
      <div className="sg-sim">
        <div className="stack">
          <Field label={t('common.merchant')} htmlFor="sim-m">
            <Select id="sim-m" value={mIdx} onChange={(e) => { const i = Number(e.target.value); setMIdx(i); setAmount(String(Math.round((MERCHANTS[i].min + MERCHANTS[i].max) / 3))); }}>
              {MERCHANTS.map((x, i) => <option key={x.name} value={i}>{x.name} · {x.realm} · {x.currency}</option>)}
            </Select>
          </Field>
          <div className="xsmall muted">{realmName(m.realm)} · MCC {m.mcc} · {tx(`category.${m.category}`)}{m.realm !== 'ALD' && <> · <Badge tone="info">{t('cards.sim.abroad')}</Badge></>}</div>
          <Field label={t('common.amount')} htmlFor="sim-a" hint={conv ? t('cards.sim.billed', { amount: f.money(conv.targetAmount, card.currency) }) : undefined}>
            <MoneyInput id="sim-a" value={amount} onChange={setAmount} currency={m.currency} />
          </Field>
          <div className="field">
            <span className="field-label">{t('cards.sim.channel')}</span>
            <Segmented<Channel> label={t('cards.sim.channel')} value={channel} onChange={setChannel} options={(['online', 'contactless', 'chip', 'magstripe'] as Channel[]).map((c) => { const I = CHANNEL_ICON[c]; return { value: c, label: <span className="row" style={{ gap: 5 }}><I size={14} aria-hidden />{tx(`cards.sim.ch.${c}`)}</span> }; })} />
          </div>
          {needsPin && (
            <Field label={t('common.pin')} htmlFor="sim-pin" hint={t('cards.sim.pinHint')}>
              <Input id="sim-pin" type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
            </Field>
          )}
          <Button variant="primary" icon={<CreditCard />} loading={busy} disabled={!(minor > 0) || (needsPin && pin.length !== 4)} onClick={() => void present()}>{t('cards.sim.present')}</Button>
        </div>

        <div className="sg-terminal" aria-live="polite">
          <div className="sg-terminal-screen">
            <div className="xsmall sg-terminal-merchant">{m.name}</div>
            <div className="sg-terminal-amount tnum">{minor > 0 ? f.money(minor, m.currency) : '—'}</div>
            <div className={`sg-terminal-verdict${authorized ? ' ok' : err ? ' fail' : ''}`}>
              {busy ? t('cards.sim.waiting') : authorized ? t('cards.sim.approved') : err ? t('cards.sim.declined') : t('cards.sim.ready')}
            </div>
            {authorized && authCode && <div className="mono xsmall">{authCode}</div>}
            {err && <div className="mono xsmall">{err.code}</div>}
          </div>
          {attempted && !busy && (authorized || err) && (
            <ol className="sg-checks" aria-label={t('cards.sim.checks')}>
              {order.map((k, i) => {
                const s = stateOf(k, i);
                return (
                  <li key={k} className={s}>
                    <span aria-hidden>{s === 'ok' ? <Check size={13} /> : s === 'fail' ? <X size={13} /> : <Minus size={13} />}</span>
                    <span>{tx(`cards.sim.check.${k}`, { channel: tx(`cards.sim.ch.${attempted.channel}`) })}</span>
                    <span className="sr-only">{tx(`cards.sim.state.${s}`)}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>

      {err && (
        <div className="stack" style={{ marginTop: 14 }}>
          <ErrorPanel error={err} />
          {explainFix()}
        </div>
      )}
      {authorized && txn && (
        <div className="stack" style={{ marginTop: 14 }}>
          <KV items={[
            [t('common.reference'), <CodeTag>{txn.ref}</CodeTag>],
            [t('cards.sim.held'), f.money(txn.amount + txn.fee, txn.currency)],
            ...(txn.fx ? [[t('cards.sim.rate'), `1 ${txn.fx.sourceCurrency} = ${f.rate(txn.fx.bankRate)} ${txn.fx.targetCurrency}`] as [string, string]] : []),
            [t('common.status'), <span className="row" style={{ gap: 6 }}>{tx(`status.tx.${txn.status}`)}{txn.status === 'processing' && <span className="xsmall muted">{t('cards.sim.settlesLater')}</span>}</span>],
          ]} />
          <TxTimeline steps={txn.timeline} status={txn.status} expected={['validated', 'screened', 'authorized', 'held', 'settled', 'completed']} />
          <Link className="btn btn-sm btn-ghost" to={`/transactions/${txn.id}`} style={{ justifySelf: 'start' }}>{t('common.openTransaction')}<ArrowRight /></Link>
        </div>
      )}
    </Panel>
  );
}
