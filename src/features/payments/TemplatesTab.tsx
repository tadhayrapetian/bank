/** Payment templates: create, use (prefilled transfer), delete. */
import { useState } from 'react';
import { BookMarked, Send, Trash2, Plus, UserCheck } from 'lucide-react';
import { useT, useFmt } from '@/hooks/useT';
import { useLive, useMe, useMyAccounts } from '@/hooks/data';
import { useAction } from '@/hooks/useAction';
import { useUI } from '@/state/ui';
import { db } from '@/core/db/db';
import { saveTemplate, deleteTemplate, resolveRecipient } from '@/core/banking/payments';
import { formatAccountNumber, isValidAccountNumber } from '@/core/banking/numbers';
import { toMinor, fromMinor } from '@/core/currency/format';
import { Button, Empty, Field, Input, Panel, Alert } from '@/ui/primitives';
import { AccountPicker, MoneyInput, decodePocket, encodePocket } from '@/ui/pickers';
import { ErrorPanel } from '@/ui/ErrorPanel';
import { confirmAction } from '@/ui/Modal';
import type { TransferTemplate } from '@/core/types';

function CreateTemplate() {
  const { t } = useT();
  const [name, setName] = useState('');
  const [pocket, setPocket] = useState('');
  const [number, setNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [touched, setTouched] = useState(false);
  const [found, setFound] = useState<string | null>(null);
  const { run, busy, error, setError } = useAction();
  const p = decodePocket(pocket);
  const ccy = p?.currency ?? 'CRWN';
  const errors = {
    name: !name.trim() ? t('payments.templates.errName') : '',
    from: !p ? t('payments.templates.errFrom') : '',
    number: !isValidAccountNumber(number) ? t('payments.templates.errAccount') : '',
  };
  const check = async () => {
    setError(null);
    setFound(null);
    try {
      const r = await resolveRecipient({ accountNumber: number }, ccy);
      setFound(r.user.name);
      return r;
    } catch (e) {
      setError(e);
      return null;
    }
  };
  const submit = async () => {
    setTouched(true);
    if (Object.values(errors).some(Boolean)) return;
    const r = await check();
    if (!r) return;
    const minor = amount ? toMinor(amount, ccy) : undefined;
    const ok = await run(() => saveTemplate({ name: name.trim(), fromAccountId: p!.accountId, currency: ccy, amount: minor && minor > 0 ? minor : undefined, recipientAccount: r.account.number, recipientName: r.user.name, description: description.trim() || t('transfer.defaultDescription') }), { success: t('payments.templates.saved'), sound: 'paper', silentError: true });
    if (ok) {
      setName(''); setNumber(''); setAmount(''); setDescription(''); setFound(null); setTouched(false);
    }
  };
  return (
    <Panel title={t('payments.templates.createTitle')} icon={<Plus />}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label={t('payments.templates.name')} htmlFor="tp-name" error={touched ? errors.name : ''}>
          <Input id="tp-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} invalid={touched && !!errors.name} />
        </Field>
        <Field label={t('payments.templates.from')} htmlFor="tp-from" error={touched ? errors.from : ''}>
          <AccountPicker id="tp-from" value={pocket} onChange={setPocket} filter={(a) => a.type !== 'deposit'} />
        </Field>
        <Field label={t('payments.templates.recipientAccount')} htmlFor="tp-num" error={touched ? errors.number : ''} hint={found ? <span className="pos row" style={{ gap: 4 }}><UserCheck size={13} aria-hidden />{t('payments.templates.recipientFound', { name: found })}</span> : t('transfer.numberHint')}>
          <div className="row row-nowrap">
            <Input id="tp-num" value={number} onChange={(e) => { setNumber(e.target.value.toUpperCase()); setFound(null); }} placeholder="XA00 AEX0 0000 0000 0000" className="mono grow" autoComplete="off" invalid={touched && !!errors.number} />
            <Button onClick={() => void check()} disabled={!isValidAccountNumber(number)}>{t('payments.templates.check')}</Button>
          </div>
        </Field>
        <div className="form-grid">
          <Field label={t('payments.templates.amountOptional')} htmlFor="tp-amt"><MoneyInput id="tp-amt" value={amount} onChange={setAmount} currency={ccy} /></Field>
          <Field label={t('payments.templates.description')} htmlFor="tp-desc"><Input id="tp-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={140} /></Field>
        </div>
        {error ? <ErrorPanel error={error} /> : null}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button type="submit" variant="primary" icon={<BookMarked />} loading={busy}>{t('payments.templates.save')}</Button>
        </div>
      </form>
    </Panel>
  );
}

export function TemplatesTab() {
  const { t } = useT();
  const f = useFmt();
  const me = useMe();
  const accounts = useMyAccounts();
  const openAction = useUI((s) => s.openAction);
  const { run, busy } = useAction();
  const templates = useLive(() => (me ? db.templates.where('ownerId').equals(me.id).toArray() : []), [me?.id], []);
  const sorted = [...templates].sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
  const use = (tp: TransferTemplate) => openAction('transfer', {
    mode: 'number', to: formatAccountNumber(tp.recipientAccount), from: encodePocket({ accountId: tp.fromAccountId, currency: tp.currency }),
    amount: tp.amount ? String(fromMinor(tp.amount, tp.currency)) : '', desc: tp.description, template: tp.id, ccy: tp.currency,
  });
  const remove = async (tp: TransferTemplate) => {
    const ok = await confirmAction({ title: t('payments.templates.deleteTitle', { name: tp.name }), body: t('payments.templates.deleteBody'), confirmLabel: t('payments.templates.delete'), danger: true });
    if (ok) await run(() => deleteTemplate(tp.id), { success: t('payments.templates.deleted'), sound: 'paper' });
  };
  return (
    <div className="grid cols-main" style={{ alignItems: 'start' }}>
      <Panel title={t('payments.templates.title')} sub={t('payments.templates.sub')} icon={<BookMarked />} flush>
        <div className="pay-templates">
          {sorted.map((tp) => {
            const acc = accounts.find((a) => a.id === tp.fromAccountId);
            return (
              <article key={tp.id} className="pay-template" data-template={tp.name}>
                <header className="row-between row-nowrap">
                  <div className="stack-sm" style={{ gap: 0, minWidth: 0 }}>
                    <strong className="truncate pay-template-name">{tp.name}</strong>
                    <span className="xsmall muted">{t('payments.templates.uses', { n: tp.uses })}</span>
                  </div>
                  <span className="pay-template-amt tnum">{tp.amount ? f.money(tp.amount, tp.currency) : <span className="xsmall muted">{t('payments.templates.anyAmount')}</span>}</span>
                </header>
                <div className="small">
                  <div><span className="muted">{t('common.recipient')}:</span> {tp.recipientName}</div>
                  <div className="mono xsmall ink2">{formatAccountNumber(tp.recipientAccount)}</div>
                  <div className="xsmall ink2"><span className="muted">{t('common.from')}:</span> {acc ? `${acc.name} · ${tp.currency}` : tp.currency}</div>
                  {tp.description && <div className="xsmall ink2">“{tp.description}”</div>}
                </div>
                {!acc && <Alert tone="warning">{t('payments.templates.errFrom')}</Alert>}
                <footer className="row">
                  <Button size="sm" variant="primary" icon={<Send />} onClick={() => use(tp)}>{t('payments.templates.use')}</Button>
                  <Button size="sm" variant="ghost" icon={<Trash2 />} disabled={busy} onClick={() => remove(tp)}>{t('payments.templates.delete')}</Button>
                </footer>
              </article>
            );
          })}
        </div>
        {!templates.length && <Empty title={t('payments.templates.empty')} icon={<BookMarked aria-hidden />} />}
      </Panel>
      <CreateTemplate />
    </div>
  );
}
