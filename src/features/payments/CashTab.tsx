/** Cardless cash codes: active codes with their holds, history, cancel; creation through the Withdraw dialog. */
import { Link } from 'react-router-dom';
import { Banknote, X, ArrowRight, ExternalLink } from 'lucide-react';
import { useT, useFmt } from '@/hooks/useT';
import { useLive, useMe, useMyAccounts, useNow } from '@/hooks/data';
import { useAction } from '@/hooks/useAction';
import { useUI } from '@/state/ui';
import { db } from '@/core/db/db';
import { cancelCardless } from '@/core/banking/payments';
import { Button, Empty, Panel, StatusBadge, Money } from '@/ui/primitives';
import { confirmAction } from '@/ui/Modal';
import type { CardlessCode } from '@/core/types';

const fmtCode = (c: string) => c.replace(/(\d{4})(\d{4})/, '$1 $2');

export function CashTab() {
  const { t } = useT();
  const f = useFmt();
  const me = useMe();
  const now = useNow(30_000);
  const accounts = useMyAccounts({ includeClosed: true });
  const openAction = useUI((s) => s.openAction);
  const { run, busy } = useAction();
  const codes = useLive(() => (me ? db.cardless.where('ownerId').equals(me.id).toArray() : []), [me?.id], []);
  const nowIso = new Date(now).toISOString();
  const active = codes.filter((c) => c.status === 'active' && c.expiresAt >= nowIso).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  const past = codes.filter((c) => !active.includes(c)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const cancel = async (c: CardlessCode) => {
    const ok = await confirmAction({ title: t('payments.cash.cancelTitle', { code: fmtCode(c.code) }), body: t('payments.cash.cancelBody', { amt: c.amount, ccy: c.currency }), confirmLabel: t('payments.cash.cancel'), danger: true });
    if (ok) await run(() => cancelCardless(c.id), { success: t('payments.cash.cancelled'), sound: 'safe' });
  };
  const accName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '—';
  return (
    <div className="grid cols-main" style={{ alignItems: 'start' }}>
      <Panel title={t('payments.cash.active')} sub={t('payments.cash.sub')} icon={<Banknote />}
        actions={<><Link className="btn btn-sm btn-ghost" to="/atm">{t('payments.cash.goAtm')}<ArrowRight /></Link><Button size="sm" variant="primary" icon={<Banknote />} onClick={() => openAction('withdraw')}>{t('payments.cash.create')}</Button></>}>
        {active.length ? (
          <div className="pay-codes">
            {active.map((c) => (
              <div key={c.id} className="pay-code-slip" data-code={c.code}>
                <div className="row-between">
                  <span className="eyebrow">{accName(c.accountId)}</span>
                  <StatusBadge domain="cardless" status={c.status} />
                </div>
                <div className="pay-code-digits mono" aria-label={c.code}>{fmtCode(c.code)}</div>
                <div className="row-between">
                  <div className="stack-sm" style={{ gap: 0 }}>
                    <span className="xsmall muted">{t('payments.cash.held')}</span>
                    <Money minor={c.amount} ccy={c.currency} className="pay-strong" />
                  </div>
                  <div className="xsmall muted right">{t('payments.cash.validUntil', { date: f.dateTime(c.expiresAt) })}<br />{f.rel(c.expiresAt, now)}</div>
                </div>
                <Button size="sm" variant="ghost" icon={<X />} disabled={busy} onClick={() => cancel(c)}>{t('payments.cash.cancel')}</Button>
              </div>
            ))}
          </div>
        ) : <Empty title={t('payments.cash.empty')} icon={<Banknote aria-hidden />} action={<Button size="sm" onClick={() => openAction('withdraw')}>{t('payments.cash.create')}</Button>} />}
      </Panel>
      <Panel title={t('payments.cash.past')} icon={<Banknote />} flush>
        <div className="list">
          {past.map((c) => (
            <div key={c.id} className="list-item">
              <div className="li-main">
                <div className="li-title mono">{fmtCode(c.code)}</div>
                <div className="li-sub">{accName(c.accountId)} · {f.dateTime(c.createdAt)}</div>
              </div>
              <div className="li-end stack-sm" style={{ justifyItems: 'end', gap: 4 }}>
                <Money minor={c.amount} ccy={c.currency} />
                <span className="row" style={{ gap: 4 }}>
                  <StatusBadge domain="cardless" status={c.status === 'active' ? 'expired' : c.status} />
                  {c.txId && <Link to={`/transactions/${c.txId}`} aria-label={t('common.openTransaction')}><ExternalLink size={12} /></Link>}
                </span>
              </div>
            </div>
          ))}
          {!past.length && <Empty title={t('common.noData')} />}
        </div>
      </Panel>
    </div>
  );
}
