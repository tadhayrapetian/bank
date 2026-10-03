/** Payment links: create (fixed or open amount), share as link or QR, follow payments, cancel. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Link2, QrCode, X, ExternalLink, Plus, Sparkles } from 'lucide-react';
import { useT, useFmt } from '@/hooks/useT';
import { useLive, useMe, useNow } from '@/hooks/data';
import { useAction } from '@/hooks/useAction';
import { db } from '@/core/db/db';
import { createPaymentLink, cancelLink } from '@/core/banking/payments';
import { toMinor } from '@/core/currency/format';
import { Badge, Button, Empty, Field, Input, Money, Panel, Segmented, Select, StatusBadge, Switch, Alert } from '@/ui/primitives';
import { AccountPicker, MoneyInput, decodePocket } from '@/ui/pickers';
import { ErrorPanel } from '@/ui/ErrorPanel';
import { Modal, confirmAction } from '@/ui/Modal';
import { QRCode, qrPayload } from '@/ui/QR';
import { CopyButton, linkStatus, linkUrl } from './shared';
import type { PaymentLink } from '@/core/types';

export function LinkQrCard({ link, size = 220 }: { link: PaymentLink; size?: number }) {
  const { t } = useT();
  const f = useFmt();
  return (
    <div className="panel panel-paper pay-qr-card">
      <div className="pay-qr-frame"><QRCode value={qrPayload('link', { code: link.code })} size={size} label={t('payments.links.qrTitle', { code: link.code })} /></div>
      <div className="pay-qr-code mono">{link.code}</div>
      <div className="small">{link.ownerName}</div>
      {link.amount ? <strong className="tnum pay-qr-amt">{f.money(link.amount, link.currency)}</strong> : <span className="xsmall">{t('payments.links.openAmount')} · {link.currency}</span>}
      <div className="xsmall pay-paper-muted">{link.description}</div>
    </div>
  );
}

function CreateLinkForm({ onCreated }: { onCreated: (code: string) => void }) {
  const { t } = useT();
  const me = useMe();
  const [pocket, setPocket] = useState('');
  const [mode, setMode] = useState<'fixed' | 'open'>('fixed');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [multi, setMulti] = useState(false);
  const [days, setDays] = useState(14);
  const [touched, setTouched] = useState(false);
  const { run, busy, error } = useAction();
  const p = decodePocket(pocket);
  const ccy = p?.currency ?? 'CRWN';
  const minor = toMinor(amount || '0', ccy);
  const errors = {
    account: !p ? t('payments.links.errAccount') : '',
    amount: mode === 'fixed' && !(minor > 0) ? t('payments.links.errAmount') : '',
    description: !description.trim() ? t('payments.links.errDescription') : '',
  };
  const submit = async () => {
    setTouched(true);
    if (Object.values(errors).some(Boolean)) return;
    const l = await run(() => createPaymentLink({ accountId: p!.accountId, amount: mode === 'fixed' ? minor : undefined, currency: ccy, description: description.trim(), multiUse: mode === 'open' ? true : multi, days }), { success: t('payments.links.created'), sound: 'stamp', silentError: true });
    if (l) {
      onCreated(l.code);
      setAmount('');
      setDescription('');
      setTouched(false);
    }
  };
  return (
    <Panel title={t('payments.links.createTitle')} icon={<Plus />}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label={t('payments.links.intoAccount')} htmlFor="ln-acc" error={touched ? errors.account : ''}>
          <AccountPicker id="ln-acc" value={pocket} onChange={setPocket} filter={(a) => a.type !== 'credit' && a.type !== 'deposit'} />
        </Field>
        <Segmented label={t('payments.links.amountMode')} value={mode} onChange={setMode} options={[{ value: 'fixed', label: t('payments.links.fixed') }, { value: 'open', label: t('payments.links.open') }]} />
        {mode === 'fixed' && (
          <Field label={t('common.amount')} htmlFor="ln-amt" error={touched ? errors.amount : ''}>
            <MoneyInput id="ln-amt" value={amount} onChange={setAmount} currency={ccy} invalid={touched && !!errors.amount} />
          </Field>
        )}
        <Field label={t('payments.links.description')} htmlFor="ln-desc" error={touched ? errors.description : ''}>
          <Input id="ln-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={120} placeholder={t('payments.links.descriptionPlaceholder')} invalid={touched && !!errors.description} />
        </Field>
        <div className="form-grid">
          <Field label={t('payments.links.validity')} htmlFor="ln-days">
            <Select id="ln-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[1, 3, 7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{t('payments.links.days', { n: d })}</option>)}
            </Select>
          </Field>
          <div className="field" style={{ alignSelf: 'end' }}>
            <Switch checked={mode === 'open' ? true : multi} disabled={mode === 'open'} onChange={setMulti} label={t('payments.links.multiUse')} />
          </div>
        </div>
        {error ? <ErrorPanel error={error} /> : null}
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="xsmall muted">{me?.name}</span>
          <Button type="submit" variant="primary" icon={<Link2 />} loading={busy}>{t('payments.links.create')}</Button>
        </div>
      </form>
    </Panel>
  );
}

export function LinksTab({ created, onCreated }: { created?: string | null; onCreated: (code: string) => void }) {
  const { t } = useT();
  const f = useFmt();
  const me = useMe();
  const nowMs = useNow(30_000);
  const nowIso = new Date(nowMs).toISOString();
  const { run, busy } = useAction();
  const [filter, setFilter] = useState<'active' | 'all'>('all');
  const [qr, setQr] = useState<PaymentLink | null>(null);
  const links = useLive(() => (me ? db.links.where('ownerId').equals(me.id).toArray() : []), [me?.id], []);
  const sorted = useMemo(() => [...links].sort((a, b) => (a.code === created ? -1 : b.code === created ? 1 : b.createdAt.localeCompare(a.createdAt))), [links, created]);
  const shown = sorted.filter((l) => filter === 'all' || linkStatus(l, nowIso) === 'active');
  const highlightRef = useRef<HTMLDivElement>(null);
  const fresh = links.find((l) => l.code === created);
  useEffect(() => {
    if (fresh) highlightRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [fresh?.id]);

  const cancel = async (l: PaymentLink) => {
    const ok = await confirmAction({ title: t('payments.links.cancelTitle', { code: l.code }), body: t('payments.links.cancelBody'), confirmLabel: t('payments.links.cancel'), danger: true });
    if (ok) await run(() => cancelLink(l.id), { success: t('payments.links.cancelled'), sound: 'paper' });
  };

  return (
    <div className="grid cols-side pay-links" style={{ alignItems: 'start' }}>
      <div className="stack-lg">
        <CreateLinkForm onCreated={onCreated} />
        {fresh && (
          <div className="stack fade-up" ref={highlightRef}>
            <Alert tone="positive" title={t('payments.links.justCreated')}>{fresh.code}</Alert>
            <LinkQrCard link={fresh} />
            <div className="row" style={{ justifyContent: 'center' }}>
              <CopyButton value={linkUrl(fresh.code)} label={t('payments.links.copy')} done={t('payments.links.copied')} variant="default" />
              <CopyButton value={fresh.code} label={t('payments.links.copyCode')} />
            </div>
          </div>
        )}
      </div>
      <Panel title={t('payments.links.title')} sub={t('payments.links.sub')} icon={<Link2 />} flush
        actions={<Segmented label={t('payments.links.filter')} value={filter} onChange={setFilter} options={[{ value: 'all', label: t('payments.links.filterAll') }, { value: 'active', label: t('payments.links.filterActive') }]} />}>
        <div className="list">
          {shown.map((l) => {
            const st = linkStatus(l, nowIso);
            const received = l.payments.reduce((s, p) => s + p.amount, 0);
            return (
              <div key={l.id} className={`list-item pay-link${l.code === created ? ' is-fresh' : ''}`} data-link={l.code}>
                <span className="glyph"><Link2 /></span>
                <div className="li-main">
                  <div className="li-title row" style={{ gap: 8 }}>
                    <span className="truncate">{l.description}</span>
                    {l.invoiceId && <Badge tone="info" plain>{t('payments.links.invoiceLink')}</Badge>}
                  </div>
                  <div className="li-sub">
                    <span className="mono">{l.code}</span> · {l.multiUse ? t('payments.links.reusable') : t('payments.links.single')} · {st === 'expired' ? t('payments.links.expiredOn', { date: f.date(l.expiresAt) }) : t('payments.links.expiresOn', { date: f.date(l.expiresAt) })}
                  </div>
                  {l.payments.length > 0 && (
                    <div className="xsmall ink2">
                      {t('payments.links.received')}: <strong className="tnum">{f.money(received, l.currency)}</strong> · {t('payments.links.payments', { n: l.payments.length })}
                      {' · '}{l.payments.slice(-2).map((p) => <Link key={p.txId} to={`/transactions/${p.txId}`} className="pay-payer">{p.payerName}</Link>)}
                    </div>
                  )}
                  <div className="row pay-link-actions">
                    <Button size="sm" variant="ghost" icon={<QrCode />} onClick={() => setQr(l)}>{t('payments.links.showQr')}</Button>
                    <CopyButton value={linkUrl(l.code)} label={t('payments.links.copy')} done={t('payments.links.copied')} />
                    <Link className="btn btn-sm btn-ghost" to={`/pay/${l.code}`}><ExternalLink />{t('payments.links.openPage')}</Link>
                    {st === 'active' && <Button size="sm" variant="ghost" icon={<X />} disabled={busy} onClick={() => cancel(l)}>{t('payments.links.cancel')}</Button>}
                  </div>
                </div>
                <div className="li-end stack-sm" style={{ justifyItems: 'end', gap: 4 }}>
                  {l.amount ? <Money minor={l.amount} ccy={l.currency} className="pay-strong" /> : <Badge tone="magic"><Sparkles size={11} aria-hidden />{t('payments.links.openAmount')}</Badge>}
                  <StatusBadge domain="link" status={st} />
                </div>
              </div>
            );
          })}
          {!shown.length && <Empty title={t('payments.links.empty')} />}
        </div>
      </Panel>
      {qr && (
        <Modal open onClose={() => setQr(null)} title={t('payments.links.qrTitle', { code: qr.code })} eyebrow={t('app.network')}
          footer={<><CopyButton value={linkUrl(qr.code)} label={t('payments.links.copy')} done={t('payments.links.copied')} variant="default" size="md" /><Button variant="primary" onClick={() => setQr(null)}>{t('common.close')}</Button></>}>
          <div className="stack" style={{ justifyItems: 'center' }}>
            <LinkQrCard link={qr} size={240} />
            <p className="small ink2 center">{t('payments.links.qrHint')}</p>
            <code className="code-tag pay-wrap">{linkUrl(qr.code)}</code>
          </div>
        </Modal>
      )}
    </div>
  );
}
