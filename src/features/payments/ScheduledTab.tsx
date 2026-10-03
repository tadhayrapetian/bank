/** One-off scheduled Aetherline transfers: list, follow and cancel. */
import { Link } from 'react-router-dom';
import { CalendarClock, X, ExternalLink, Repeat } from 'lucide-react';
import { useT, useFmt } from '@/hooks/useT';
import { useLive, useMe, useMyAccounts, useNow } from '@/hooks/data';
import { useAction } from '@/hooks/useAction';
import { useUI } from '@/state/ui';
import { db } from '@/core/db/db';
import { cancelScheduled } from '@/core/banking/payments';
import { formatAccountNumber } from '@/core/banking/numbers';
import { Button, Panel, StatusBadge, CodeTag, Empty } from '@/ui/primitives';
import { DataTable } from '@/ui/DataTable';
import { confirmAction } from '@/ui/Modal';
import type { ScheduledTransfer } from '@/core/types';

export function ScheduledTab() {
  const { t, tx } = useT();
  const f = useFmt();
  const me = useMe();
  const now = useNow(30_000);
  const accounts = useMyAccounts({ includeClosed: true });
  const openAction = useUI((s) => s.openAction);
  const { run, busy } = useAction();
  const rows = useLive(() => (me ? db.scheduled.where('ownerId').equals(me.id).toArray() : []), [me?.id], []);
  const cancel = async (s: ScheduledTransfer) => {
    const ok = await confirmAction({ title: t('payments.scheduled.cancelTitle'), body: t('payments.scheduled.cancelBody', { amt: s.amount, ccy: s.currency, name: s.recipientName, date: f.dateTime(s.runAt) }), confirmLabel: t('payments.scheduled.cancel'), danger: true });
    if (ok) await run(() => cancelScheduled(s.id), { success: t('payments.scheduled.cancelled'), sound: 'paper' });
  };
  return (
    <Panel title={t('payments.scheduled.title')} sub={t('payments.scheduled.sub')} icon={<CalendarClock />} flush
      actions={<>
        <Link className="btn btn-sm btn-ghost" to="/recurring"><Repeat />{t('payments.scheduled.recurringLink')}</Link>
        <Button size="sm" variant="primary" icon={<CalendarClock />} title={t('payments.scheduled.newHint')} onClick={() => openAction('transfer', { mode: 'number' })}>{t('payments.scheduled.new')}</Button>
      </>}>
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        initialSort={{ key: 'runAt', dir: 'desc' }}
        empty={<Empty title={t('payments.scheduled.empty')} icon={<CalendarClock aria-hidden />}>{t('payments.scheduled.newHint')}</Empty>}
        columns={[
          {
            key: 'runAt', header: t('payments.scheduled.runAt'), value: (r) => r.runAt,
            render: (r) => <div className="stack-sm" style={{ gap: 0 }}><span className="nowrap">{f.dateTime(r.runAt)}</span>{r.status === 'scheduled' && <span className="xsmall muted">{f.rel(r.runAt, now)}</span>}</div>,
          },
          {
            key: 'recipient', header: t('common.recipient'), value: (r) => r.recipientName,
            render: (r) => <div className="stack-sm" style={{ gap: 0, minWidth: 0 }}><strong className="truncate">{r.recipientName}</strong><span className="xsmall muted mono">{formatAccountNumber(r.recipientAccount)}</span></div>,
          },
          { key: 'from', header: t('common.from'), hideMobile: true, value: (r) => accounts.find((a) => a.id === r.fromAccountId)?.name ?? '', render: (r) => <span className="small">{accounts.find((a) => a.id === r.fromAccountId)?.name ?? '—'}</span> },
          { key: 'desc', header: t('common.description'), hideMobile: true, value: (r) => r.description, render: (r) => <span className="small ink2">{r.description}</span> },
          { key: 'amount', header: t('common.amount'), align: 'right', value: (r) => r.amount, render: (r) => <strong className="tnum nowrap">{f.money(r.amount, r.currency)}</strong> },
          {
            key: 'status', header: t('common.status'), value: (r) => r.status,
            render: (r) => (
              <div className="stack-sm" style={{ gap: 2 }}>
                <StatusBadge domain="scheduled" status={r.status} />
                {r.error && <span className="xsmall neg">{t('payments.scheduled.failedReason')}: {tx(`errors.${r.error}.title`, undefined, r.error)}</span>}
              </div>
            ),
          },
          {
            key: 'act', header: <span className="sr-only">{t('common.actions')}</span>,
            render: (r) => r.status === 'scheduled'
              ? <Button size="sm" variant="ghost" icon={<X />} disabled={busy} onClick={() => cancel(r)}>{t('payments.scheduled.cancel')}</Button>
              : r.txId ? <Link className="btn btn-sm btn-ghost" to={`/transactions/${r.txId}`}><ExternalLink />{t('payments.scheduled.executedTx')}</Link> : <CodeTag>{r.id}</CodeTag>,
          },
        ]}
      />
    </Panel>
  );
}
