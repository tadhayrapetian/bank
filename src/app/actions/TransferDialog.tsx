/** Transfer: form → review → live processing → receipt. Own accounts, client ID or account number. */
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Send, BookmarkPlus, CalendarClock } from 'lucide-react';
import { Modal } from '@/ui/Modal';
import { Button, Field, Input, Segmented, KV, Alert, Switch, Select } from '@/ui/primitives';
import { AccountPicker, MoneyInput, decodePocket, encodePocket } from '@/ui/pickers';
import { ErrorPanel } from '@/ui/ErrorPanel';
import { useT, useFmt } from '@/hooks/useT';
import { useLive, useMyAccounts } from '@/hooks/data';
import { db } from '@/core/db/db';
import { toMinor, fromMinor } from '@/core/currency/format';
import { quote } from '@/core/currency/rates';
import { transfer, transferOwn, resolveRecipient, saveTemplate, scheduleTransfer, markTemplateUsed } from '@/core/banking/payments';
import { getSettings } from '@/core/settings';
import { isValidAccountNumber, formatAccountNumber } from '@/core/banking/numbers';
import { canHold } from '@/core/banking/fx';
import { BankError } from '@/core/errors';
import { nowISO } from '@/core/clock';
import { useSession } from '@/state/session';
import { play } from '@/ui/sound';
import { toast } from '@/ui/Toasts';
import { TxProgress } from './TxProgress';
import type { Account, User } from '@/core/types';

type Mode = 'own' | 'client' | 'number';

export function TransferDialog({ onClose, params }: { onClose: () => void; params?: Record<string, string> }) {
  const { t, tx } = useT();
  const f = useFmt();
  const me = useSession((s) => s.user);
  const accounts = useMyAccounts();
  const templates = useLive(() => (me ? db.templates.where('ownerId').equals(me.id).toArray() : []), [me?.id], []);
  const [mode, setMode] = useState<Mode>((params?.mode as Mode) ?? (params?.to ? 'number' : 'client'));
  const [from, setFrom] = useState(params?.from ?? '');
  const [toOwn, setToOwn] = useState('');
  const [clientId, setClientId] = useState(params?.client ?? '');
  const [number, setNumber] = useState(params?.to ?? '');
  const [amount, setAmount] = useState(params?.amount ?? '');
  const [description, setDescription] = useState(params?.desc ?? '');
  const [purpose, setPurpose] = useState('');
  const [saveTpl, setSaveTpl] = useState(false);
  const [tplName, setTplName] = useState('');
  const [schedule, setSchedule] = useState(false);
  const [runAt, setRunAt] = useState('');
  const [stage, setStage] = useState<'form' | 'review' | 'run'>('form');
  const [resolved, setResolved] = useState<{ account: Account; user: User } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [txId, setTxId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!from && accounts.length) {
      const a = accounts.find((x) => x.type === 'current' && x.status === 'active') ?? accounts[0];
      setFrom(encodePocket({ accountId: a.id, currency: params?.ccy && a.pockets.includes(params.ccy) ? params.ccy : a.currency }));
    }
  }, [accounts, from, params?.ccy]);

  const src = decodePocket(from);
  const ccy = src?.currency ?? 'CRWN';
  const minor = toMinor(amount || '0', ccy);
  const ownTarget = decodePocket(toOwn);
  const ownAcc = accounts.find((a) => a.id === ownTarget?.accountId);
  const fee = mode === 'own' ? 0 : getSettings().transferFee;

  const fx = useMemo(() => {
    const target = mode === 'own' ? ownAcc : resolved?.account;
    if (!target || !(minor > 0)) return null;
    const tc = mode === 'own' ? ownTarget!.currency : canHold(target, ccy) ? ccy : target.currency;
    if (tc === ccy) return null;
    return quote(ccy, tc, minor);
  }, [mode, ownAcc, ownTarget, resolved, minor, ccy]);

  const errors = {
    from: !src ? t('transfer.err.from') : '',
    amount: !(minor > 0) ? t('transfer.err.amount') : '',
    to: mode === 'own' ? (!ownTarget ? t('transfer.err.to') : ownTarget.accountId === src?.accountId && ownTarget.currency === src?.currency ? t('errors.SAME_ACCOUNT.title') : '') : mode === 'client' ? (!clientId.trim() ? t('transfer.err.client') : '') : !isValidAccountNumber(number) ? t('transfer.err.number') : '',
    runAt: schedule && (!runAt || runAt <= nowISO().slice(0, 16)) ? t('transfer.err.runAt') : '',
  };
  const [touched, setTouched] = useState(false);
  const valid = !Object.values(errors).some(Boolean);

  const review = async () => {
    setTouched(true);
    setError(null);
    if (!valid) return;
    if (mode !== 'own') {
      try {
        const r = await resolveRecipient(mode === 'client' ? { clientId } : { accountNumber: number }, ccy);
        if (r.account.id === src!.accountId) throw new BankError('SAME_ACCOUNT');
        setResolved(r);
      } catch (e) {
        setError(e);
        return;
      }
    }
    setStage('review');
    play('paper');
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    setStage('run');
    try {
      if (saveTpl && tplName.trim() && mode !== 'own' && resolved) {
        await saveTemplate({ name: tplName.trim(), fromAccountId: src!.accountId, currency: ccy, amount: minor, recipientAccount: resolved.account.number, recipientName: resolved.user.name, description });
      }
      if (params?.template) await markTemplateUsed(params.template);
      if (schedule && mode !== 'own' && resolved) {
        await scheduleTransfer({ fromAccountId: src!.accountId, currency: ccy, amount: minor, recipientAccount: resolved.account.number, recipientName: resolved.user.name, description: description || t('transfer.defaultDescription'), runAt: new Date(runAt).toISOString() });
        toast({ tone: 'positive', title: t('transfer.scheduledToast'), body: f.dateTime(new Date(runAt).toISOString()) });
        onClose();
        return;
      }
      if (mode === 'own') {
        await transferOwn({ fromAccountId: src!.accountId, toAccountId: ownTarget!.accountId, currency: ccy, amount: minor, targetCurrency: ownTarget!.currency, description, onCreated: setTxId });
      } else {
        await transfer({ fromAccountId: src!.accountId, currency: ccy, amount: minor, recipient: { accountNumber: resolved!.account.number }, description, purpose, onCreated: setTxId });
      }
      play('payment');
    } catch (e) {
      setError(e);
      play('error');
    } finally {
      setBusy(false);
    }
  };

  const applyTemplate = (id: string) => {
    const tp = templates.find((x) => x.id === id);
    if (!tp) return;
    setMode('number');
    setNumber(formatAccountNumber(tp.recipientAccount));
    setFrom(encodePocket({ accountId: tp.fromAccountId, currency: tp.currency }));
    if (tp.amount) setAmount(String(fromMinor(tp.amount, tp.currency)));
    setDescription(tp.description);
    void markTemplateUsed(tp.id);
  };

  return (
    <Modal open onClose={onClose} title={t('transfer.title')} eyebrow={t('app.network')} size="wide"
      footer={
        stage === 'form' ? (
          <><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" icon={<ArrowRight />} onClick={review}>{t('transfer.review')}</Button></>
        ) : stage === 'review' ? (
          <><Button onClick={() => setStage('form')}>{t('common.back')}</Button><Button variant="primary" icon={schedule ? <CalendarClock /> : <Send />} onClick={submit} loading={busy} data-autofocus>{schedule ? t('transfer.schedule') : t('transfer.confirmSend')}</Button></>
        ) : (
          <Button onClick={onClose} variant="primary">{t('common.done')}</Button>
        )
      }
    >
      {stage === 'form' && (
        <div className="stack">
          <div className="row-between">
            <Segmented label={t('transfer.mode')} value={mode} onChange={(v) => { setMode(v); setResolved(null); }} options={[{ value: 'client', label: t('transfer.byClient') }, { value: 'number', label: t('transfer.byNumber') }, { value: 'own', label: t('transfer.own') }]} />
            {templates.length > 0 && (
              <Select aria-label={t('transfer.useTemplate')} value="" onChange={(e) => applyTemplate(e.target.value)} style={{ width: 'auto' }}>
                <option value="">{t('transfer.useTemplate')}</option>
                {templates.map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
              </Select>
            )}
          </div>
          <div className="form-grid">
            <Field label={t('transfer.from')} htmlFor="tr-from" required error={touched ? errors.from : ''} className="full">
              <AccountPicker id="tr-from" value={from} onChange={setFrom} />
            </Field>
            {mode === 'own' && (
              <Field label={t('transfer.to')} htmlFor="tr-own" required error={touched ? errors.to : ''} className="full">
                <AccountPicker id="tr-own" value={toOwn} onChange={setToOwn} includeAllCurrencies={ccy} />
              </Field>
            )}
            {mode === 'client' && (
              <Field label={t('common.clientId')} htmlFor="tr-client" required error={touched ? errors.to : ''} hint={t('transfer.clientHint')}>
                <Input id="tr-client" value={clientId} onChange={(e) => setClientId(e.target.value.toUpperCase())} placeholder="ALD-C-104702" autoComplete="off" />
              </Field>
            )}
            {mode === 'number' && (
              <Field label={t('common.accountNumber')} htmlFor="tr-num" required error={touched ? errors.to : ''} hint={t('transfer.numberHint')}>
                <Input id="tr-num" value={number} onChange={(e) => setNumber(e.target.value.toUpperCase())} placeholder="XA00 AEX0 0000 0000 0000" autoComplete="off" className="mono" />
              </Field>
            )}
            <Field label={t('common.amount')} htmlFor="tr-amt" required error={touched ? errors.amount : ''}>
              <MoneyInput id="tr-amt" value={amount} onChange={setAmount} currency={ccy} invalid={!!errors.amount} />
            </Field>
            <Field label={t('common.description')} htmlFor="tr-desc">
              <Input id="tr-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={140} />
            </Field>
            {mode !== 'own' && (
              <Field label={t('common.purpose')} htmlFor="tr-purpose">
                <Input id="tr-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={80} />
              </Field>
            )}
          </div>
          {mode !== 'own' && (
            <div className="grid cols-2">
              <div className="stack-sm">
                <Switch checked={saveTpl} onChange={setSaveTpl} label={<span className="row" style={{ gap: 6 }}><BookmarkPlus size={15} />{t('transfer.saveTemplate')}</span>} />
                {saveTpl && <Input aria-label={t('transfer.templateName')} placeholder={t('transfer.templateName')} value={tplName} onChange={(e) => setTplName(e.target.value)} />}
              </div>
              <div className="stack-sm">
                <Switch checked={schedule} onChange={setSchedule} label={<span className="row" style={{ gap: 6 }}><CalendarClock size={15} />{t('transfer.scheduleLater')}</span>} />
                {schedule && <Input type="datetime-local" aria-label={t('transfer.runAt')} value={runAt} onChange={(e) => setRunAt(e.target.value)} invalid={touched && !!errors.runAt} />}
                {schedule && touched && errors.runAt && <div className="field-error">{errors.runAt}</div>}
              </div>
            </div>
          )}
          {error ? <ErrorPanel error={error} /> : null}
        </div>
      )}
      {stage === 'review' && (
        <div className="stack">
          <div className="panel panel-paper" style={{ padding: 18 }}>
            <div className="eyebrow" style={{ color: 'var(--accent-2)' }}>{t('transfer.paymentOrder')}</div>
            <div style={{ fontFamily: 'var(--f-display)', fontSize: '2.2rem', fontWeight: 600 }} className="tnum">{f.money(minor, ccy)}</div>
            <KV items={[
              [t('transfer.from'), `${accounts.find((a) => a.id === src?.accountId)?.name ?? ''} · ${ccy}`],
              [t('transfer.to'), mode === 'own' ? `${ownAcc?.name} · ${ownTarget?.currency}` : `${resolved?.user.name} · ${formatAccountNumber(resolved?.account.number ?? '')}`],
              [t('common.fee'), fee ? f.money(fee, ccy) : t('transfer.noFee')],
              ...(fx ? [[t('exchange.bankRate'), `1 ${fx.from} = ${f.rate(fx.bankRate)} ${fx.to}`], [t('exchange.youReceive'), f.money(fx.targetAmount, fx.to)]] as [string, string][] : []),
              [t('common.description'), description || '—'],
              ...(schedule ? [[t('transfer.runAt'), f.dateTime(new Date(runAt).toISOString())]] as [string, string][] : []),
              [t('transfer.network'), mode === 'own' ? t('transfer.internalBook') : t('transfer.aetherlineInstant')],
            ]} />
          </div>
          <Alert tone="info">{t('transfer.reviewNote')}</Alert>
          {error ? <ErrorPanel error={error} /> : null}
        </div>
      )}
      {stage === 'run' && <TxProgress txId={txId} error={error} />}
      <span className="sr-only">{tx('quick.transfer')}</span>
    </Modal>
  );
}
