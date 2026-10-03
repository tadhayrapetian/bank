/** Check book pieces: stage derivation, stubs, stage pips and the presentment dialog. */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check as CheckIcon, X, Landmark, ScrollText } from 'lucide-react';
import { Modal } from '@/ui/Modal';
import { Alert, Button, Field, Input, StatusBadge } from '@/ui/primitives';
import { AccountPicker, decodePocket } from '@/ui/pickers';
import { ErrorPanel } from '@/ui/ErrorPanel';
import { useT, useFmt } from '@/hooks/useT';
import { useAction } from '@/hooks/useAction';
import { presentCheck } from '@/core/banking/checks';
import type { Check, Transaction } from '@/core/types';

export const STAGES = ['draft', 'signed', 'stamped', 'issued', 'presented', 'paid'] as const;
export type Stage = (typeof STAGES)[number];

/** Index of the furthest stage reached (Draft → Signed → Sealed → Issued → Presented → Paid). */
export function stageIndex(c: Check): number {
  if (c.status === 'paid') return 5;
  if (c.status === 'presented' || c.status === 'processing') return 4;
  const issued = c.status === 'issued' || !!c.issuedAt;
  const presented = !!c.presentedAt;
  if (presented) return 4;
  if (issued) return 3;
  if (c.signature && c.seals.length) return 2;
  if (c.signature) return 1;
  return 0;
}

export const FAILED = new Set(['cancelled', 'rejected', 'expired']);

export function StagePips({ check, labels }: { check: Check; labels?: boolean }) {
  const { t, tx } = useT();
  const idx = stageIndex(check);
  const failed = FAILED.has(check.status);
  return (
    <ol className={`chk-stages${labels ? ' labelled' : ''}`} aria-label={t('checks.stageLabel')}>
      {STAGES.map((s, i) => {
        // "Sealed" is optional: a signed check may be issued without a seal
        const skipped = s === 'stamped' && idx >= 3 && !check.seals.length;
        const state = i <= idx && !skipped ? 'done' : failed && i === idx + 1 ? 'fail' : 'todo';
        return (
          <li key={s} className={`${state}${skipped ? ' skipped' : ''}`} title={tx(`checks.stage.${s}`)}>
            <span className="pip" aria-hidden>{state === 'done' ? <CheckIcon /> : state === 'fail' ? <X /> : null}</span>
            {labels && <span className="lbl">{tx(`checks.stage.${s}`)}</span>}
            <span className="sr-only">{tx(`checks.stage.${s}`)}: {state}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** One check as a perforated stub from a check book. */
export function CheckStub({ check, perspective, onPresent }: { check: Check; perspective: 'issuer' | 'payee' | 'bank'; onPresent?: (c: Check) => void }) {
  const { t, tx } = useT();
  const f = useFmt();
  const failed = FAILED.has(check.status);
  return (
    <article className={`chk-stub${failed ? ' void' : ''}`}>
      <div className="chk-stub-no">
        <span className="xsmall">№</span>
        <span className="mono">{check.number}</span>
        <span className="xsmall">{f.date(check.date)}</span>
        {check.kind === 'cashier' && <span className="chk-kind" title={t('checks.cashierCheck')}><Landmark size={12} aria-hidden /></span>}
      </div>
      <div className="chk-stub-main">
        <div className="chk-stub-who">
          <span className="xsmall chk-label">{perspective === 'payee' ? t('checks.detail.issuer') : t('checks.payToOrder')}</span>
          <Link to={`/checks/${check.id}`} className="chk-stub-link">
            <span className="chk-script">{perspective === 'payee' ? check.issuerName : check.payeeName}</span>
          </Link>
          {perspective === 'bank' && <span className="xsmall chk-muted">{t('checks.detail.issuer')}: {check.issuerName}</span>}
          {check.purpose && <span className="xsmall chk-muted truncate">{check.purpose}</span>}
        </div>
        <StagePips check={check} />
      </div>
      <div className="chk-stub-end">
        <span className="chk-amount tnum">{f.money(check.amount, check.currency)}</span>
        <StatusBadge domain="check" status={check.status} />
        {check.status === 'rejected' && check.rejectReason && <span className="xsmall chk-muted">{tx(`checks.rejectReason.${check.rejectReason}`, undefined, check.rejectReason)}</span>}
        {onPresent && check.status === 'issued' && (
          <Button size="sm" variant="primary" icon={<ScrollText />} onClick={() => onPresent(check)} className="chk-stub-btn">{t('checks.act.present')}</Button>
        )}
      </div>
    </article>
  );
}

/** Present a check (by number + verification code) into one of your accounts. */
export function PresentDialog({ onClose, number: initialNumber = '', code: initialCode = '' }: { onClose: () => void; number?: string; code?: string }) {
  const { t } = useT();
  const f = useFmt();
  const nav = useNavigate();
  const [number, setNumber] = useState(initialNumber);
  const [code, setCode] = useState(initialCode);
  const [pocket, setPocket] = useState('');
  const [done, setDone] = useState<Transaction | null>(null);
  const { run, busy, error } = useAction();
  const p = decodePocket(pocket);
  const submit = () => run(async () => {
    const tx = await presentCheck(number, code, p!.accountId);
    setDone(tx);
  }, { sound: 'payment', silentError: true });
  return (
    <Modal open onClose={onClose} title={t('checks.present.title')} eyebrow={t('dept.PAY')}
      footer={done ? (
        <>
          <Button onClick={onClose}>{t('common.close')}</Button>
          <Button variant="primary" onClick={() => { onClose(); nav(`/transactions/${done.id}`); }}>{t('checks.present.openTx')}</Button>
        </>
      ) : (
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" icon={<ScrollText />} loading={busy} disabled={!number.trim() || !code.trim() || !p} onClick={submit}>{t('checks.present.submit')}</Button>
        </>
      )}>
      {done ? (
        <Alert tone="positive" title={t('checks.present.done')}>{t('checks.present.paid', { amount: f.money(done.creditAmount ?? done.amount, done.creditCurrency ?? done.currency) })} · <span className="mono">{done.ref}</span></Alert>
      ) : (
        <>
          <p className="small ink2">{t('checks.present.text')}</p>
          <div className="form-grid">
            <Field label={t('checks.present.number')} htmlFor="pc-num" required><Input id="pc-num" className="mono" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="00400120" /></Field>
            <Field label={t('checks.present.code')} htmlFor="pc-code" required><Input id="pc-code" className="mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX" /></Field>
            <Field label={t('checks.present.into')} htmlFor="pc-acc" className="full"><AccountPicker id="pc-acc" value={pocket} onChange={setPocket} /></Field>
          </div>
        </>
      )}
      {error ? <ErrorPanel error={error} /> : null}
    </Modal>
  );
}
