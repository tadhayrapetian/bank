/** Public payment page of an Aetherline payment link: payee, amount, choose account, pay, receipt — or why it cannot be paid. */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Send, Link2, Repeat, ArrowLeft, ShieldCheck, CheckCircle2, FileText, ExternalLink } from 'lucide-react';
import { useT, useFmt } from '@/hooks/useT';
import { useLive, useMe, useNow } from '@/hooks/data';
import { db } from '@/core/db/db';
import { payLink } from '@/core/banking/payments';
import { toMinor } from '@/core/currency/format';
import { currencies } from '@/core/currency/registry';
import { Alert, Button, CodeTag, Empty, Field, KV, PageHead, Panel, StatusBadge, Badge } from '@/ui/primitives';
import { MoneyInput } from '@/ui/pickers';
import { ErrorPanel } from '@/ui/ErrorPanel';
import { QRCode, qrPayload } from '@/ui/QR';
import { Guilloche } from '@/ui/heraldry';
import { Seal } from '@/ui/Seal';
import { TxProgress } from '@/app/actions/TxProgress';
import { play } from '@/ui/sound';
import { CopyButton, CurrencyPocketSelect, linkStatus, linkUrl, usePocketsIn } from './shared';

export default function PayLinkPage() {
  const { code = '' } = useParams();
  const { t } = useT();
  const f = useFmt();
  const me = useMe();
  const nowMs = useNow(30_000);
  const nowIso = new Date(nowMs).toISOString();
  const key = code.trim().toUpperCase();
  const link = useLive(() => db.links.where('code').equals(key).first().then((l) => l ?? null), [key], undefined as undefined | null | import('@/core/types').PaymentLink);
  const invoice = useLive(() => (link?.invoiceId ? db.invoices.get(link.invoiceId) : undefined), [link?.invoiceId], undefined);
  const [from, setFrom] = useState('');
  const [amount, setAmount] = useState('');
  const [touched, setTouched] = useState(false);
  const [running, setRunning] = useState(false);
  const [txId, setTxId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const pockets = usePocketsIn(link?.currency);
  const paidTx = useLive(() => (txId ? db.transactions.get(txId) : undefined), [txId], undefined);

  if (link === undefined) return <div className="page"><div className="skeleton" style={{ height: 320 }} /></div>;
  if (link === null) {
    return (
      <div className="page">
        <PageHead eyebrow={t('payments.payLink.eyebrow')} title={t('payments.payLink.notFound')} />
        <Panel><Empty title={t('payments.payLink.notFound')} icon={<Link2 aria-hidden />} action={<Link className="btn btn-sm" to="/payments"><ArrowLeft />{t('payments.payLink.another')}</Link>}>{t('payments.payLink.notFoundText', { code: key })}</Empty></Panel>
      </div>
    );
  }

  const st = linkStatus(link, nowIso);
  const own = link.ownerId === me?.id;
  const ccy = link.currency;
  const minor = link.amount ?? toMinor(amount || '0', ccy);
  const errors = { amount: !(minor > 0) ? t('payments.payLink.errAmount') : '', from: !from ? t('payments.payLink.errAccount') : '' };
  const payable = st === 'active' && !own;
  const lastPaid = link.payments[link.payments.length - 1];

  const pay = async () => {
    setTouched(true);
    if (errors.amount || errors.from) return;
    setBusy(true);
    setRunning(true);
    setError(null);
    try {
      await payLink(link.code, from, link.amount ? undefined : minor, setTxId);
      play('payment');
    } catch (e) {
      setError(e);
      play('error');
    } finally {
      setBusy(false);
    }
  };

  const done = paidTx?.status === 'completed';

  return (
    <div className="page">
      <PageHead eyebrow={t('dept.PAY')} title={t('payments.payLink.title', { name: link.ownerName })} sub={t('payments.payLink.secure')}
        actions={<Link className="btn" to="/payments"><ArrowLeft />{t('payments.payLink.another')}</Link>} />
      <div className="paylink">
        <article className="panel panel-paper paylink-doc paper-in" aria-label={t('payments.payLink.eyebrow')}>
          <div className="paylink-guilloche" aria-hidden><Guilloche width={420} height={220} opacity={0.12} /></div>
          <header className="paylink-head">
            <div>
              <div className="eyebrow">{t('payments.payLink.eyebrow')}</div>
              <h2 className="paylink-title">{link.ownerName}</h2>
              <div className="small pay-paper-muted">{link.description}</div>
            </div>
            <StatusBadge domain="link" status={st} />
          </header>
          {done && <div className="paylink-stamp" aria-hidden><Seal sealId="paid" size={130} rotation={-12} animate /></div>}
          {link.amount ? (
            <div>
              <div className="xsmall pay-paper-muted">{t('payments.payLink.amount')}</div>
              <div className="paylink-amount tnum">{f.money(link.amount, ccy)}</div>
            </div>
          ) : (
            <Badge tone="magic">{t('payments.links.openAmount')} · {ccy}</Badge>
          )}
          <KV items={[
            [t('payments.payLink.payee'), link.ownerName],
            [t('payments.payLink.purpose'), link.description],
            [t('common.currency'), `${ccy} · ${currencies.get(ccy)?.name ?? ''}`],
            [t('payments.payLink.validUntil'), f.dateTime(link.expiresAt)],
            [t('payments.payLink.code'), <CodeTag>{link.code}</CodeTag>],
            ...(invoice ? [[t('payments.links.invoiceLink'), <Link to={`/invoices/${invoice.id}`}>{invoice.number}</Link>] as [string, React.ReactNode]] : []),
          ]} />
          {link.multiUse && st === 'active' && <div className="xsmall pay-paper-muted">{t('payments.payLink.multiUse')}</div>}

          {running ? (
            <div className="stack">
              <TxProgress txId={txId} error={error} />
              {done && paidTx && (
                <Alert tone="positive" title={t('payments.payLink.successTitle')}>
                  {t('payments.payLink.successText', { amt: paidTx.amount, ccy: paidTx.currency, name: link.ownerName })}
                </Alert>
              )}
              {!busy && !done && <Button onClick={() => { setRunning(false); setTxId(null); }}>{t('common.back')}</Button>}
            </div>
          ) : own ? (
            <Alert tone="info" title={t('payments.payLink.ownTitle')}>{t('payments.payLink.ownText')}</Alert>
          ) : st === 'paid' ? (
            <Alert tone="positive" title={t('payments.payLink.paidTitle')}>{t('payments.payLink.paidText', { date: lastPaid ? f.dateTime(lastPaid.at) : '—', name: link.ownerName })}</Alert>
          ) : st === 'expired' ? (
            <Alert tone="warning" title={t('payments.payLink.expiredTitle')}>{t('payments.payLink.expiredText', { date: f.dateTime(link.expiresAt), name: link.ownerName })}</Alert>
          ) : st === 'cancelled' ? (
            <Alert tone="negative" title={t('payments.payLink.cancelledTitle')}>{t('payments.payLink.cancelledText', { name: link.ownerName })}</Alert>
          ) : (
            <form className="stack" onSubmit={(e) => { e.preventDefault(); void pay(); }}>
              {invoice && <Alert tone="info">{t('payments.payLink.invoiceNote', { number: invoice.number })}</Alert>}
              {!link.amount && (
                <Field label={t('payments.payLink.enterAmount')} htmlFor="pl-amt" error={touched ? errors.amount : ''}>
                  <MoneyInput id="pl-amt" value={amount} onChange={setAmount} currency={ccy} invalid={touched && !!errors.amount} autoFocus />
                </Field>
              )}
              {pockets.length ? (
                <Field label={t('payments.payLink.payFrom')} htmlFor="pl-from" error={touched ? errors.from : ''}>
                  <CurrencyPocketSelect id="pl-from" currency={ccy} value={from} onChange={setFrom} invalid={touched && !!errors.from} />
                </Field>
              ) : (
                <Alert tone="warning" title={t('payments.payLink.noPocket', { ccy })}>
                  {t('payments.payLink.noPocketHint', { ccy })} <Link to="/exchange">{t('payments.payLink.goExchange')} →</Link>
                </Alert>
              )}
              <Button type="submit" variant="primary" size="lg" icon={<Send />} disabled={!payable || !pockets.length} loading={busy} block>
                {minor > 0 ? t('payments.payLink.pay', { amt: minor, ccy }) : t('payments.payLink.payOpen')}
              </Button>
              <div className="row xsmall pay-paper-muted" style={{ gap: 6 }}><ShieldCheck size={13} aria-hidden />{t('payments.payLink.secure')}</div>
            </form>
          )}
        </article>

        <aside className="paylink-side">
          <Panel title={t('payments.payLink.scanToPay')} icon={<Link2 />}>
            <div className="stack" style={{ justifyItems: 'center', textAlign: 'center' }}>
              <div className="qr-thumb" style={{ padding: 10 }}><QRCode value={qrPayload('link', { code: link.code })} size={190} label={t('payments.links.qrTitle', { code: link.code })} /></div>
              <div className="mono small">{link.code}</div>
              <div className="row" style={{ justifyContent: 'center' }}>
                <CopyButton value={linkUrl(link.code)} label={t('payments.links.copy')} done={t('payments.links.copied')} />
                <CopyButton value={link.code} label={t('payments.links.copyCode')} />
              </div>
            </div>
          </Panel>
          {(own || link.payments.length > 0) && (
            <Panel title={t('payments.payLink.received')} icon={<CheckCircle2 />} flush
              actions={own ? <Link className="btn btn-sm btn-ghost" to={`/payments?tab=links`}>{t('payments.payLink.manage')}</Link> : undefined}>
              <div className="list">
                {link.payments.map((p) => (
                  <Link key={p.txId} to={`/transactions/${p.txId}`} className="list-item">
                    <div className="li-main"><div className="li-title">{p.payerName}</div><div className="li-sub">{f.dateTime(p.at)}</div></div>
                    <div className="li-end tnum" style={{ fontWeight: 600 }}>{f.money(p.amount, ccy)}</div>
                  </Link>
                ))}
                {!link.payments.length && <Empty title={t('common.noData')} />}
              </div>
            </Panel>
          )}
          {done && paidTx && (
            <Panel title={t('common.receipt')} icon={<FileText />}>
              <div className="row">
                {paidTx.documentIds[0] && <Link className="btn btn-sm" to={`/documents/${paidTx.documentIds[0]}`}><FileText />{t('common.viewReceipt')}</Link>}
                <Link className="btn btn-sm btn-ghost" to={`/transactions/${paidTx.id}`}><ExternalLink />{t('common.openTransaction')}</Link>
                <Link className="btn btn-sm btn-ghost" to="/exchange"><Repeat />{t('nav.exchange')}</Link>
              </div>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}
