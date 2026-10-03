/** Issue a new SIGIL card: type, linked account, embossed name, PIN. */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard, Check } from 'lucide-react';
import { Modal } from '@/ui/Modal';
import { Button, Field, Input, Select, Alert, KV } from '@/ui/primitives';
import { ErrorPanel } from '@/ui/ErrorPanel';
import { useT, useFmt } from '@/hooks/useT';
import { useAction } from '@/hooks/useAction';
import { useMe, useMyAccounts } from '@/hooks/data';
import { issueCard, DEFAULT_LIMITS } from '@/core/banking/cards';
import { formatAccountNumber } from '@/core/banking/numbers';
import type { CardType } from '@/core/types';
import { CARD_TYPES, eligibleAccount } from './cardKit';

const SWATCH: Record<CardType, string> = {
  debit: 'linear-gradient(135deg, #1d5a43, #0a2219)',
  credit: 'linear-gradient(135deg, #8c2434, #2e0a10)',
  virtual: 'linear-gradient(135deg, #253a72, #0a1128)',
  business: 'linear-gradient(135deg, #2b2d33, #07080a)',
  premium: 'linear-gradient(135deg, #e8c879, #7c5a1c)',
  vault: 'linear-gradient(135deg, #f6efe0, #c9b78f)',
};

export function IssueCardDialog({ onClose, initialType }: { onClose: () => void; initialType?: CardType }) {
  const { t, tx } = useT();
  const f = useFmt();
  const nav = useNavigate();
  const me = useMe();
  const accounts = useMyAccounts();
  const [type, setType] = useState<CardType>(initialType ?? 'debit');
  const [accountId, setAccountId] = useState('');
  const [holder, setHolder] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const { run, busy, error } = useAction();
  const eligible = useMemo(() => accounts.filter((a) => eligibleAccount(type, a)), [accounts, type]);
  useEffect(() => {
    if (!eligible.find((a) => a.id === accountId)) setAccountId(eligible[0]?.id ?? '');
  }, [eligible, accountId]);
  useEffect(() => {
    if (!holder && me) setHolder(me.name.toUpperCase());
  }, [me, holder]);
  const acc = eligible.find((a) => a.id === accountId);
  const lim = DEFAULT_LIMITS[type];
  const ccy = acc?.currency ?? 'CRWN';
  const pinOk = /^\d{4}$/.test(pin);
  const match = pin === pin2;
  const submit = () =>
    run(async () => {
      const card = await issueCard({ accountId, type, holderName: holder.trim(), pin });
      onClose();
      nav(`/cards/${card.id}`);
    }, { success: t('cards.issue.done'), sound: 'card', silentError: true });

  return (
    <Modal
      open
      onClose={onClose}
      size="wide"
      eyebrow={t('dept.PAY')}
      title={t('cards.issue.title')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" icon={<CreditCard />} loading={busy} disabled={!acc || !pinOk || !match || !holder.trim()} onClick={submit}>{t('cards.issue.submit')}</Button>
        </>
      }
    >
      <div className="stack">
        <fieldset className="sg-type-grid" aria-label={t('cards.issue.type')}>
          <legend className="field-label">{t('cards.issue.type')}</legend>
          {CARD_TYPES.map((ct) => (
            <label key={ct} className={`sg-type${type === ct ? ' on' : ''}`}>
              <input type="radio" name="card-type" value={ct} checked={type === ct} onChange={() => setType(ct)} className="sr-only" />
              <span className="sg-type-swatch" style={{ background: SWATCH[ct] }} aria-hidden>{type === ct && <Check size={14} />}</span>
              <span className="stack-sm" style={{ gap: 2 }}>
                <strong>{tx(`cardType.${ct}`)}</strong>
                <span className="xsmall muted">{tx(`cards.typeDesc.${ct}`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="form-grid">
          <Field label={t('cards.issue.account')} htmlFor="ic-acc" className="full" hint={tx(`cards.issue.accountRule.${type}`)}>
            <Select id="ic-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {!eligible.length && <option value="">{t('cards.issue.noAccount')}</option>}
              {eligible.map((a) => (
                <option key={a.id} value={a.id}>{a.name} · {a.currency} · {formatAccountNumber(a.number).slice(-9)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('cards.issue.holder')} htmlFor="ic-holder" className="full" hint={t('cards.issue.holderHint')}>
            <Input id="ic-holder" value={holder} maxLength={26} onChange={(e) => setHolder(e.target.value.toUpperCase().replace(/[^A-Z .'-]/g, ''))} />
          </Field>
          <Field label={t('cards.issue.pin')} htmlFor="ic-pin" hint={t('cards.issue.pinHint')} error={pin && !pinOk ? t('cards.pinFormat') : undefined}>
            <Input id="ic-pin" type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label={t('cards.issue.pin2')} htmlFor="ic-pin2" error={pin2 && !match ? t('cards.pinMismatch') : undefined}>
            <Input id="ic-pin2" type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
        {!eligible.length && <Alert tone="warning" title={t('cards.issue.noAccount')}>{tx(`cards.issue.accountRule.${type}`)}</Alert>}
        <div className="inset">
          <div className="stat-label" style={{ marginBottom: 6 }}>{t('cards.issue.defaults')}</div>
          <KV items={[
            [t('cards.limits.perTx'), f.money(lim.perTx, ccy)],
            [t('cards.limits.daily'), f.money(lim.daily, ccy)],
            [t('cards.limits.atmDaily'), lim.atmDaily ? f.money(lim.atmDaily, ccy) : t('cards.limits.noAtm')],
            [t('cards.issue.validity'), t('common.years', { n: type === 'virtual' ? 2 : 4 })],
          ]} />
        </div>
        <ErrorPanel error={error} />
      </div>
    </Modal>
  );
}
