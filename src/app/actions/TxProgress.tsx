/** Live view of a transaction going through the pipeline, ending in a receipt or an explained error. */
import { Link } from 'react-router-dom';
import { CheckCircle2, FileText, ExternalLink } from 'lucide-react';
import { useLive } from '@/hooks/data';
import { db } from '@/core/db/db';
import { useT, useFmt } from '@/hooks/useT';
import { TxTimeline } from '@/ui/Timeline';
import { ErrorPanel } from '@/ui/ErrorPanel';
import { Badge, StatusBadge, KV, CodeTag } from '@/ui/primitives';
import { BankError } from '@/core/errors';
import { useUI } from '@/state/ui';

export function TxProgress({ txId, error, expected }: { txId: string | null; error?: unknown; expected?: string[] }) {
  const { t, tx } = useT();
  const f = useFmt();
  const closeAction = useUI((s) => s.closeAction);
  const txn = useLive(() => (txId ? db.transactions.get(txId) : undefined), [txId], undefined);
  if (!txn) return error ? <ErrorPanel error={error} /> : <div className="skeleton" style={{ height: 160 }} />;
  const done = txn.status === 'completed';
  const err = txn.error ? new BankError(txn.error.code as never, { ...(txn.error.params ?? {}) }) : null;
  return (
    <div className="stack">
      <div className="inset row-between">
        <div className="stack-sm">
          <div className="row">
            <StatusBadge domain="tx" status={txn.status} />
            {txn.stage && txn.stage !== 'completed' && <Badge tone="info">{tx(`step.${txn.stage}`)}</Badge>}
          </div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: '1.6rem', fontWeight: 600 }} className="tnum">{f.money(txn.amount, txn.currency)}</div>
          <div className="small ink2">{txn.description}</div>
        </div>
        {done && <CheckCircle2 size={42} style={{ color: 'var(--pos)' }} className="ink-in" aria-hidden />}
      </div>
      <KV items={[
        [t('common.reference'), <CodeTag>{txn.ref}</CodeTag>],
        [t('common.txId'), <CodeTag>{txn.id}</CodeTag>],
        ...(txn.fx ? [[t('exchange.fxId'), <CodeTag>{txn.fx.id}</CodeTag>] as [string, JSX.Element]] : []),
        [t('common.recipient'), txn.recipient.name],
        ...(txn.creditAmount && txn.creditCurrency && txn.creditCurrency !== txn.currency ? [[t('exchange.youReceive'), f.money(txn.creditAmount, txn.creditCurrency)] as [string, string]] : []),
        ...(txn.fee ? [[t('common.fee'), f.money(txn.fee, txn.feeCurrency)] as [string, string]] : []),
      ]} />
      <TxTimeline steps={txn.timeline} status={txn.status} expected={expected} />
      {err && <ErrorPanel error={err} />}
      <div className="row">
        {txn.documentIds[0] && <Link className="btn btn-sm" to={`/documents/${txn.documentIds[0]}`} onClick={closeAction}><FileText />{t('common.viewReceipt')}</Link>}
        <Link className="btn btn-sm btn-ghost" to={`/transactions/${txn.id}`} onClick={closeAction}><ExternalLink />{t('common.openTransaction')}</Link>
      </div>
    </div>
  );
}
