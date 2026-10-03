/** Explains a banking error: what happened, why, what to do — plus a link to the failed transaction. */
import { Link } from 'react-router-dom';
import { XCircle } from 'lucide-react';
import { useT } from '@/hooks/useT';
import { isBankError, toBankError } from '@/core/errors';
import { CodeTag } from './primitives';

export function ErrorPanel({ error }: { error: unknown }) {
  const { tx, t } = useT();
  if (!error) return null;
  const e = isBankError(error) ? error : toBankError(error);
  const txId = e.params?.txId as string | undefined;
  return (
    <div className="alert tone-negative" role="alert">
      <XCircle aria-hidden />
      <div className="alert-body stack-sm">
        <div className="row-between">
          <div className="alert-title">{tx(`errors.${e.code}.title`, undefined, e.code)}</div>
          <CodeTag>{e.code}</CodeTag>
        </div>
        <div className="small"><strong>{t('common.whatHappened')}:</strong> {tx(`errors.${e.code}.explain`, undefined, e.message)}</div>
        <div className="small"><strong>{t('common.whatToDo')}:</strong> {tx(`errors.${e.code}.hint`)}</div>
        {txId && <Link className="small" to={`/transactions/${txId}`}>{t('common.openTransaction')} →</Link>}
      </div>
    </div>
  );
}

export function errorTitle(tx: (k: string, p?: Record<string, string | number>, f?: string) => string, error: unknown) {
  const e = toBankError(error);
  return tx(`errors.${e.code}.title`, undefined, e.code);
}
