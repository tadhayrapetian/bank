/** Card lifecycle actions: reveal (PIN), freeze, change PIN, wallet, renew, replace, block. */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Snowflake, Sun, Eye, KeyRound, Smartphone, RefreshCcw, Replace, Ban, Check } from 'lucide-react';
import { Modal, confirmAction } from '@/ui/Modal';
import { Button, Field, Input, Select, Alert } from '@/ui/primitives';
import { ErrorPanel } from '@/ui/ErrorPanel';
import { useT } from '@/hooks/useT';
import { useAction } from '@/hooks/useAction';
import { useLive } from '@/hooks/data';
import { useSession } from '@/state/session';
import { db } from '@/core/db/db';
import { BankError } from '@/core/errors';
import { addToWallet, blockCard, changeCardPin, checkCardPin, freezeCard, removeFromWallet, renewCard, replaceCard, unfreezeCard } from '@/core/banking/cards';
import type { Card } from '@/core/types';

const REPLACE_REASONS = ['lost', 'stolen', 'damaged', 'compromised', 'design'] as const;
const BLOCK_REASONS = ['lost', 'stolen', 'compromised', 'fraud', 'closing'] as const;

function PinInput({ id, value, onChange, autoFocus }: { id: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return <Input id={id} type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={value} autoFocus={autoFocus} className="sg-pin-input" onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))} />;
}

export function CardActions({ card, onReveal }: { card: Card; onReveal: () => void }) {
  const { t, tx } = useT();
  const nav = useNavigate();
  const { run, busy } = useAction();
  const [modal, setModal] = useState<null | 'reveal' | 'pin' | 'wallet' | 'replace' | 'block'>(null);
  const live = card.status === 'active' || card.status === 'frozen';
  const close = () => setModal(null);
  const why = !live ? t('cards.actions.unavailable', { status: tx(`status.card.${card.status}`) }) : undefined;

  return (
    <>
      <div className="sg-actions">
        {card.status === 'frozen' ? (
          <Button icon={<Sun />} loading={busy} onClick={() => run(() => unfreezeCard(card.id), { success: t('cards.unfrozenToast', { last4: card.last4 }), sound: 'card' })}>{t('common.unfreeze')}</Button>
        ) : (
          <Button icon={<Snowflake />} loading={busy} disabled={card.status !== 'active'} title={why} onClick={() => run(() => freezeCard(card.id), { success: t('cards.frozenToast', { last4: card.last4 }), sound: 'card' })}>{t('common.freeze')}</Button>
        )}
        <Button icon={<Eye />} disabled={card.status === 'blocked' || card.status === 'replaced'} title={why} onClick={() => setModal('reveal')}>{t('cards.actions.reveal')}</Button>
        <Button icon={<KeyRound />} disabled={!live} title={why} onClick={() => setModal('pin')}>{t('cards.actions.changePin')}</Button>
        {card.wallet.added ? (
          <Button icon={<Smartphone />} loading={busy} onClick={async () => {
            if (await confirmAction({ title: t('cards.wallet.removeTitle'), body: t('cards.wallet.removeBody', { device: card.wallet.device ?? '' }), confirmLabel: t('common.remove') })) {
              await run(() => removeFromWallet(card.id), { success: t('cards.wallet.removed'), sound: 'card' });
            }
          }}>{t('cards.wallet.remove')}</Button>
        ) : (
          <Button icon={<Smartphone />} disabled={card.status !== 'active'} title={card.status !== 'active' ? why ?? t('cards.wallet.needActive') : undefined} onClick={() => setModal('wallet')}>{t('cards.wallet.add')}</Button>
        )}
        <Button icon={<RefreshCcw />} loading={busy} disabled={card.status === 'replaced' || card.status === 'blocked'} title={why} onClick={async () => {
          if (await confirmAction({ title: t('cards.renew.title'), body: t('cards.renew.body'), confirmLabel: t('cards.renew.confirm') })) {
            await run(() => renewCard(card.id), { success: t('cards.renew.done'), sound: 'card' });
          }
        }}>{t('cards.renew.title')}</Button>
        <Button icon={<Replace />} disabled={card.status === 'replaced' || card.status === 'expired'} title={why} onClick={() => setModal('replace')}>{t('cards.replace.title')}</Button>
        <Button variant="danger" icon={<Ban />} disabled={card.status === 'blocked' || card.status === 'replaced'} title={why} onClick={() => setModal('block')}>{t('cards.block.title')}</Button>
      </div>
      {modal === 'reveal' && <RevealModal card={card} onClose={close} onOk={onReveal} />}
      {modal === 'pin' && <ChangePinModal card={card} onClose={close} />}
      {modal === 'wallet' && <WalletModal card={card} onClose={close} />}
      {modal === 'replace' && <ReplaceModal card={card} onClose={close} onDone={(id) => nav(`/cards/${id}`)} />}
      {modal === 'block' && <BlockModal card={card} onClose={close} />}
    </>
  );
}

function AttemptsLeft({ card }: { card: Card }) {
  const { t } = useT();
  const left = Math.max(0, 3 - card.pinAttempts);
  return <div className={`xsmall ${left < 3 ? 'warn-text' : 'muted'}`}>{t('cards.attemptsLeft', { n: left })}</div>;
}

function RevealModal({ card, onClose, onOk }: { card: Card; onClose: () => void; onOk: () => void }) {
  const { t } = useT();
  const [pin, setPin] = useState('');
  const { run, busy, error } = useAction();
  const go = () => run(async () => {
    const ok = await checkCardPin(card, pin);
    if (!ok) {
      const fresh = await db.cards.get(card.id);
      setPin('');
      throw new BankError(fresh?.status === 'blocked' ? 'CARD_BLOCKED' : 'INVALID_PIN', { attemptsLeft: Math.max(0, 3 - (fresh?.pinAttempts ?? 3)) });
    }
    onOk();
    onClose();
  }, { sound: 'card', silentError: true });
  return (
    <Modal open onClose={onClose} eyebrow={t('dept.SEC')} title={t('cards.reveal.title')} footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} disabled={pin.length !== 4} onClick={go}>{t('cards.reveal.submit')}</Button></>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (pin.length === 4) void go(); }}>
        <p className="small ink2">{t('cards.reveal.text')}</p>
        <Field label={t('common.pin')} htmlFor="rv-pin"><PinInput id="rv-pin" value={pin} onChange={setPin} autoFocus /></Field>
        <AttemptsLeft card={card} />
        <ErrorPanel error={error} />
      </form>
    </Modal>
  );
}

function ChangePinModal({ card, onClose }: { card: Card; onClose: () => void }) {
  const { t } = useT();
  const [oldPin, setOld] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const { run, busy, error } = useAction();
  const weak = /^(\d)\1{3}$/.test(pin) || ['1234', '4321', '0000'].includes(pin);
  const ok = oldPin.length === 4 && pin.length === 4 && pin === pin2 && pin !== oldPin;
  return (
    <Modal open onClose={onClose} eyebrow={t('dept.SEC')} title={t('cards.actions.changePin')} footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" icon={<KeyRound />} loading={busy} disabled={!ok} onClick={() => run(async () => { await changeCardPin(card.id, oldPin, pin); onClose(); }, { success: t('cards.pin.done'), sound: 'card', silentError: true })}>{t('cards.pin.submit')}</Button></>}>
      <div className="form-grid">
        <Field label={t('cards.pin.old')} htmlFor="cp-old" className="full"><PinInput id="cp-old" value={oldPin} onChange={setOld} autoFocus /></Field>
        <Field label={t('cards.pin.new')} htmlFor="cp-new" hint={weak && pin.length === 4 ? t('cards.pin.weak') : t('cards.pinFormat')}><PinInput id="cp-new" value={pin} onChange={setPin} /></Field>
        <Field label={t('cards.pin.repeat')} htmlFor="cp-new2" error={pin2.length === 4 && pin !== pin2 ? t('cards.pinMismatch') : undefined}><PinInput id="cp-new2" value={pin2} onChange={setPin2} /></Field>
      </div>
      <AttemptsLeft card={card} />
      <ErrorPanel error={error} />
    </Modal>
  );
}

function WalletModal({ card, onClose }: { card: Card; onClose: () => void }) {
  const { t } = useT();
  const userId = useSession((s) => s.user?.id);
  const devices = useLive(() => (userId ? db.devices.where('userId').equals(userId).toArray() : []), [userId], []);
  const [device, setDevice] = useState('');
  const { run, busy, error } = useAction();
  const chosen = device || devices.find((d) => d.trusted)?.label || devices[0]?.label || '';
  return (
    <Modal open onClose={onClose} eyebrow={t('dept.PAY')} title={t('cards.wallet.add')} footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" icon={<Smartphone />} loading={busy} disabled={!chosen} onClick={() => run(async () => { await addToWallet(card.id, chosen); onClose(); }, { success: t('cards.wallet.added'), sound: 'card', silentError: true })}>{t('cards.wallet.submit')}</Button></>}>
      <p className="small ink2">{t('cards.wallet.text')}</p>
      <div className="list panel">
        {devices.map((d) => (
          <label key={d.id} className="list-item" style={{ cursor: 'pointer' }}>
            <input type="radio" name="wallet-device" checked={chosen === d.label} onChange={() => setDevice(d.label)} />
            <div className="li-main"><div className="li-title">{d.label}</div><div className="li-sub">{d.platform} · {d.trusted ? t('cards.wallet.trusted') : t('cards.wallet.untrusted')}</div></div>
            {chosen === d.label && <Check size={16} aria-hidden />}
          </label>
        ))}
      </div>
      {!devices.length && <Alert tone="warning">{t('cards.wallet.noDevices')}</Alert>}
      <ErrorPanel error={error} />
    </Modal>
  );
}

function ReplaceModal({ card, onClose, onDone }: { card: Card; onClose: () => void; onDone: (id: string) => void }) {
  const { t, tx } = useT();
  const [reason, setReason] = useState<(typeof REPLACE_REASONS)[number]>('damaged');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const { run, busy, error } = useAction();
  const ok = pin.length === 4 && pin === pin2;
  return (
    <Modal open onClose={onClose} eyebrow={t('dept.PAY')} title={t('cards.replace.title')} footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" icon={<Replace />} loading={busy} disabled={!ok} onClick={() => run(async () => { const next = await replaceCard(card.id, reason, pin); onClose(); onDone(next.id); }, { success: t('cards.replace.done'), sound: 'card', silentError: true })}>{t('cards.replace.submit')}</Button></>}>
      <p className="small ink2">{t('cards.replace.text', { last4: card.last4 })}</p>
      <div className="form-grid">
        <Field label={t('common.reason')} htmlFor="rp-r" className="full">
          <Select id="rp-r" value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
            {REPLACE_REASONS.map((r) => <option key={r} value={r}>{tx(`cards.reason.${r}`)}</option>)}
          </Select>
        </Field>
        <Field label={t('cards.pin.new')} htmlFor="rp-pin" hint={t('cards.pinFormat')}><PinInput id="rp-pin" value={pin} onChange={setPin} /></Field>
        <Field label={t('cards.pin.repeat')} htmlFor="rp-pin2" error={pin2.length === 4 && pin !== pin2 ? t('cards.pinMismatch') : undefined}><PinInput id="rp-pin2" value={pin2} onChange={setPin2} /></Field>
      </div>
      {(reason === 'stolen' || reason === 'compromised') && <Alert tone="warning">{t('cards.replace.stolenNote')}</Alert>}
      <ErrorPanel error={error} />
    </Modal>
  );
}

function BlockModal({ card, onClose }: { card: Card; onClose: () => void }) {
  const { t, tx } = useT();
  const [reason, setReason] = useState<(typeof BLOCK_REASONS)[number]>('lost');
  const [ack, setAck] = useState(false);
  const { run, busy, error } = useAction();
  return (
    <Modal open onClose={onClose} eyebrow={t('dept.SEC')} title={t('cards.block.title')} footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="danger" icon={<Ban />} loading={busy} disabled={!ack} onClick={() => run(async () => { await blockCard(card.id, reason); onClose(); }, { success: t('cards.block.done', { last4: card.last4 }), sound: 'stamp', silentError: true })}>{t('cards.block.submit')}</Button></>}>
      <Alert tone="negative" title={t('cards.block.irreversible')}>{t('cards.block.text')}</Alert>
      <Field label={t('common.reason')} htmlFor="bk-r">
        <Select id="bk-r" value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
          {BLOCK_REASONS.map((r) => <option key={r} value={r}>{tx(`cards.reason.${r}`)}</option>)}
        </Select>
      </Field>
      <label className="row small" style={{ gap: 8 }}>
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        {t('cards.block.ack', { last4: card.last4 })}
      </label>
      <ErrorPanel error={error} />
    </Modal>
  );
}
