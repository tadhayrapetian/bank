/** Currency exchange between own account pockets with a live quote (rate, bank rate, fee, you receive, total). */
import { useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, Repeat } from 'lucide-react';
import { Button, Field, KV, Alert, DemoFlag } from '@/ui/primitives';
import { AccountPicker, MoneyInput, decodePocket, encodePocket, CurrencySelect } from '@/ui/pickers';
import { ErrorPanel } from '@/ui/ErrorPanel';
import { useT, useFmt } from '@/hooks/useT';
import { useMyAccounts, useNow } from '@/hooks/data';
import { toMinor } from '@/core/currency/format';
import { quote, hasRate } from '@/core/currency/rates';
import { exchange } from '@/core/banking/fx';
import { currencies } from '@/core/currency/registry';
import { play } from '@/ui/sound';
import { TxProgress } from './TxProgress';

export function ExchangeForm({ onDone, initialTo }: { onDone?: () => void; initialTo?: string }) {
  const { t } = useT();
  const f = useFmt();
  const accounts = useMyAccounts();
  const now = useNow(5000);
  const [from, setFrom] = useState('');
  const [toAcc, setToAcc] = useState('');
  const [toCcy, setToCcy] = useState(initialTo ?? 'USD');
  const [amount, setAmount] = useState('100');
  const [stage, setStage] = useState<'form' | 'run'>('form');
  const [txId, setTxId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!from && accounts.length) {
      const a = accounts.find((x) => x.multiCurrency && x.status === 'active') ?? accounts.find((x) => x.status === 'active');
      if (a) {
        setFrom(encodePocket({ accountId: a.id, currency: a.currency }));
        setToAcc(a.id);
      }
    }
  }, [accounts, from]);

  const src = decodePocket(from);
  const fromCcy = src?.currency ?? 'CRWN';
  const minor = toMinor(amount || '0', fromCcy);
  const target = accounts.find((a) => a.id === toAcc);
  const targetOk = !!target && (target.multiCurrency || target.pockets.includes(toCcy));
  const q = useMemo(() => {
    if (!(minor > 0) || fromCcy === toCcy || !hasRate(fromCcy) || !hasRate(toCcy)) return null;
    return quote(fromCcy, toCcy, minor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minor, fromCcy, toCcy, now]);

  const run = async () => {
    if (!src || !target) return;
    setBusy(true);
    setError(null);
    setStage('run');
    try {
      await exchange({ fromAccountId: src.accountId, fromCurrency: fromCcy, toAccountId: target.id, toCurrency: toCcy, amount: minor, onCreated: setTxId });
      play('payment');
    } catch (e) {
      setError(e);
      play('error');
    } finally {
      setBusy(false);
    }
  };

  if (stage === 'run') {
    return (
      <div className="stack">
        <TxProgress txId={txId} error={error} />
        <div className="row"><Button onClick={() => { setStage('form'); setTxId(null); setError(null); }} icon={<Repeat />}>{t('exchange.another')}</Button>{onDone && <Button variant="primary" onClick={onDone}>{t('common.done')}</Button>}</div>
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="form-grid">
        <Field label={t('exchange.sourceAccount')} htmlFor="fx-from" className="full"><AccountPicker id="fx-from" value={from} onChange={setFrom} /></Field>
        <Field label={t('exchange.amount')} htmlFor="fx-amt"><MoneyInput id="fx-amt" value={amount} onChange={setAmount} currency={fromCcy} /></Field>
        <Field label={t('exchange.sourceCurrency')} htmlFor="fx-src"><input id="fx-src" className="input mono" value={`${fromCcy} · ${currencies.get(fromCcy)?.name ?? ''}`} readOnly /></Field>
        <div className="full row" style={{ justifyContent: 'center' }}><ArrowDownUp className="muted" aria-hidden /></div>
        <Field label={t('exchange.targetCurrency')} htmlFor="fx-to"><CurrencySelect id="fx-to" value={toCcy} onChange={setToCcy} /></Field>
        <Field label={t('exchange.targetAccount')} htmlFor="fx-to-acc" error={target && !targetOk ? t('exchange.targetCantHold') : ''}>
          <select id="fx-to-acc" className="select" value={toAcc} onChange={(e) => setToAcc(e.target.value)}>
            {accounts.filter((a) => a.status === 'active' && a.type !== 'loan').map((a) => <option key={a.id} value={a.id}>{a.name} · {a.multiCurrency ? t('exchange.multi') : a.currency}</option>)}
          </select>
        </Field>
      </div>
      {q ? (
        <div className="inset">
          <div className="row-between"><strong>{t('exchange.quote')}</strong><DemoFlag>{t('exchange.demoRates')}</DemoFlag></div>
          <KV items={[
            [t('exchange.exchangeRate'), `1 ${fromCcy} = ${f.rate(q.midRate)} ${toCcy}`],
            [t('exchange.bankRate'), `1 ${fromCcy} = ${f.rate(q.bankRate)} ${toCcy} (${t('exchange.spread', { pct: q.spreadPct })})`],
            [t('common.fee'), f.money(q.fee, fromCcy)],
            [t('exchange.youReceive'), <strong className="tnum" style={{ fontSize: '1.15rem' }}>{f.money(q.targetAmount, toCcy)}</strong>],
            [t('exchange.finalAmount'), <span className="tnum">{f.money(q.totalDebit, fromCcy)}</span>],
          ]} />
        </div>
      ) : fromCcy === toCcy ? <Alert tone="warning">{t('exchange.samePair')}</Alert> : null}
      {error ? <ErrorPanel error={error} /> : null}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button variant="primary" icon={<Repeat />} onClick={run} disabled={!q || !targetOk || !src} loading={busy}>{t('exchange.confirm')}</Button>
      </div>
    </div>
  );
}
