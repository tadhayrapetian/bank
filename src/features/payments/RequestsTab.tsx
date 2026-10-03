/** Money requests: pay or decline what others ask of you; follow and withdraw your own requests. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { HandCoins, Inbox, Send, X, Check, ExternalLink } from 'lucide-react';
import { useT, useFmt } from '@/hooks/useT';
import { useLive, useMe } from '@/hooks/data';
import { useAction } from '@/hooks/useAction';
import { useUI } from '@/state/ui';
import { db } from '@/core/db/db';
import { payRequest, declineRequest } from '@/core/banking/payments';
import { formatAccountNumber } from '@/core/banking/numbers';
import { Button, Empty, Field, KV, Money, Panel, StatusBadge, CodeTag } from '@/ui/primitives';
import { Modal, confirmAction } from '@/ui/Modal';
import { ErrorPanel } from '@/ui/ErrorPanel';
import { TxProgress } from '@/app/actions/TxProgress';
import { play } from '@/ui/sound';
import { CurrencyPocketSelect } from './shared';
import type { MoneyRequest } from '@/core/types';

function PayRequestModal({ req, onClose }: { req: MoneyRequest; onClose: () => void }) {
  const { t } = useT();
  const f = useFmt();
  const [from, setFrom] = useState('');
  const [txId, setTxId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const target = useLive(() => db.accounts.get(req.toAccountId), [req.toAccountId], undefined);
  const pay = async () => {
    if (!from) {
      setError(null);
      return;
    }
    setBusy(true);
    setRunning(true);
    setError(null);
    try {
      await payRequest(req.id, from, setTxId);
      play('payment');
    } catch (e) {
      setError(e);
      play('error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={t('payments.requests.payTitle', { number: req.number })} eyebrow={t('app.network')}
      footer={running ? <Button variant="primary" onClick={onClose}>{t('common.done')}</Button> : <><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" icon={<Send />} disabled={!from} loading={busy} onClick={pay}>{t('payments.requests.pay')} {f.money(req.amount, req.currency)}</Button></>}>
      {running ? <TxProgress txId={txId} error={error} /> : (
        <div className="stack">
          <div className="panel panel-paper pay-order">
            <div className="eyebrow">{t('payments.requests.from', { name: req.requesterName })}</div>
            <div className="pay-order-amount tnum">{f.money(req.amount, req.currency)}</div>
            <KV items={[
              [t('payments.requests.note'), req.note ? `“${req.note}”` : '—'],
              [t('payments.requests.intoAccount'), target ? formatAccountNumber(target.number) : '—'],
              [t('common.reference'), <CodeTag>{req.number}</CodeTag>],
              [t('common.created'), f.dateTime(req.createdAt)],
            ]} />
          </div>
          <Field label={t('payments.requests.payFrom')} htmlFor="rq-pay-from" hint={t('payments.requests.chooseAccount')}>
            <CurrencyPocketSelect id="rq-pay-from" currency={req.currency} value={from} onChange={setFrom} />
          </Field>
          {error ? <ErrorPanel error={error} /> : null}
        </div>
      )}
    </Modal>
  );
}

export function RequestsTab() {
  const { t } = useT();
  const f = useFmt();
  const me = useMe();
  const openAction = useUI((s) => s.openAction);
  const { run, busy } = useAction();
  const [paying, setPaying] = useState<MoneyRequest | null>(null);
  const incoming = useLive(() => (me ? db.requests.where('payerId').equals(me.id).toArray() : []), [me?.id], []);
  const outgoing = useLive(() => (me ? db.requests.where('requesterId').equals(me.id).toArray() : []), [me?.id], []);
  const sortReq = (a: MoneyRequest, b: MoneyRequest) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || b.createdAt.localeCompare(a.createdAt);

  const decline = async (r: MoneyRequest) => {
    const ok = await confirmAction({ title: t('payments.requests.declineTitle'), body: t('payments.requests.declineBody', { name: r.requesterName, amt: r.amount, ccy: r.currency }), confirmLabel: t('payments.requests.decline'), danger: true });
    if (ok) await run(() => declineRequest(r.id), { success: t('payments.requests.declined'), sound: 'paper' });
  };
  const cancel = async (r: MoneyRequest) => {
    const ok = await confirmAction({ title: t('payments.requests.cancelTitle'), body: t('payments.requests.cancelBody', { name: r.payerName }), confirmLabel: t('payments.requests.cancel'), danger: true });
    if (ok) await run(() => declineRequest(r.id), { success: t('payments.requests.cancelled'), sound: 'paper' });
  };

  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <Panel title={t('payments.requests.incoming')} sub={t('payments.requests.incomingSub')} icon={<Inbox />} flush>
        <div className="list">
          {[...incoming].sort(sortReq).map((r) => (
            <div key={r.id} className={`list-item pay-req${r.status === 'pending' ? ' is-pending' : ''}`} data-request={r.number}>
              <span className="glyph in"><HandCoins /></span>
              <div className="li-main">
                <div className="li-title">{r.requesterName}</div>
                <div className="li-sub">{r.note ? `“${r.note}” · ` : ''}{f.dateTime(r.createdAt)} · <span className="mono">{r.number}</span></div>
                {r.status === 'pending' && (
                  <div className="row pay-req-actions">
                    <Button size="sm" variant="primary" icon={<Check />} onClick={() => setPaying(r)}>{t('payments.requests.pay')}</Button>
                    <Button size="sm" variant="ghost" icon={<X />} disabled={busy} onClick={() => decline(r)}>{t('payments.requests.decline')}</Button>
                  </div>
                )}
                {r.status === 'paid' && r.txId && <Link className="xsmall" to={`/transactions/${r.txId}`}>{t('payments.requests.paidOn', { date: f.dateTime(r.paidAt) })} <ExternalLink size={11} aria-hidden /></Link>}
              </div>
              <div className="li-end stack-sm" style={{ justifyItems: 'end', gap: 4 }}>
                <Money minor={r.amount} ccy={r.currency} className="pay-strong" />
                <StatusBadge domain="request" status={r.status} />
              </div>
            </div>
          ))}
          {!incoming.length && <Empty title={t('payments.requests.noIncoming')} />}
        </div>
      </Panel>

      <Panel title={t('payments.requests.outgoing')} sub={t('payments.requests.outgoingSub')} icon={<Send />} flush
        actions={<Button size="sm" variant="primary" icon={<HandCoins />} onClick={() => openAction('request')}>{t('payments.requests.new')}</Button>}>
        <div className="list">
          {[...outgoing].sort(sortReq).map((r) => (
            <div key={r.id} className="list-item pay-req" data-request={r.number}>
              <span className="glyph out"><HandCoins /></span>
              <div className="li-main">
                <div className="li-title">{t('payments.requests.to', { name: r.payerName })}</div>
                <div className="li-sub">{r.note ? `“${r.note}” · ` : ''}{f.dateTime(r.createdAt)} · <span className="mono">{r.number}</span></div>
                {r.status === 'pending' && (
                  <div className="row pay-req-actions">
                    <Button size="sm" variant="ghost" icon={<X />} disabled={busy} onClick={() => cancel(r)}>{t('payments.requests.cancel')}</Button>
                  </div>
                )}
                {r.status === 'paid' && r.txId && <Link className="xsmall" to={`/transactions/${r.txId}`}>{t('payments.requests.paidOn', { date: f.dateTime(r.paidAt) })} <ExternalLink size={11} aria-hidden /></Link>}
              </div>
              <div className="li-end stack-sm" style={{ justifyItems: 'end', gap: 4 }}>
                <Money minor={r.amount} ccy={r.currency} className="pay-strong" />
                <StatusBadge domain="request" status={r.status} />
              </div>
            </div>
          ))}
          {!outgoing.length && <Empty title={t('payments.requests.noOutgoing')} action={<Button size="sm" onClick={() => openAction('request')}>{t('payments.requests.new')}</Button>} />}
        </div>
      </Panel>
      {paying && <PayRequestModal req={paying} onClose={() => setPaying(null)} />}
    </div>
  );
}
