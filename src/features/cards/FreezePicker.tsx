/** Emergency picker opened by /cards?action=freeze: freeze any card in one click. */
import { Link } from 'react-router-dom';
import { Snowflake, Sun, CreditCard } from 'lucide-react';
import { Modal } from '@/ui/Modal';
import { Button, Empty, StatusBadge, Alert } from '@/ui/primitives';
import { ErrorPanel } from '@/ui/ErrorPanel';
import { useT } from '@/hooks/useT';
import { useAction } from '@/hooks/useAction';
import { freezeCard, unfreezeCard } from '@/core/banking/cards';
import type { Account, Card } from '@/core/types';

export function FreezePicker({ cards, accounts, onClose }: { cards: Card[]; accounts: Account[]; onClose: () => void }) {
  const { t, tx } = useT();
  const { run, busy, error } = useAction();
  const usable = cards.filter((c) => c.status === 'active' || c.status === 'frozen');
  return (
    <Modal open onClose={onClose} eyebrow={t('dept.SEC')} title={t('cards.freeze.title')} footer={<Button onClick={onClose}>{t('common.done')}</Button>}>
      <Alert tone="info">{t('cards.freeze.text')}</Alert>
      {usable.length ? (
        <div className="list panel" style={{ marginTop: 12 }}>
          {usable.map((c) => {
            const acc = accounts.find((a) => a.id === c.accountId);
            return (
              <div key={c.id} className="list-item">
                <span className={`glyph${c.status === 'frozen' ? ' fail' : ''}`}><CreditCard /></span>
                <div className="li-main">
                  <div className="li-title"><Link to={`/cards/${c.id}`} onClick={onClose}>{tx(`cardType.${c.type}`)} •{c.last4}</Link></div>
                  <div className="li-sub">{acc?.name ?? c.currency} · {c.holderName}</div>
                </div>
                <StatusBadge domain="card" status={c.status} />
                {c.status === 'active' ? (
                  <Button size="sm" variant="danger" icon={<Snowflake />} loading={busy} onClick={() => run(() => freezeCard(c.id), { success: t('cards.frozenToast', { last4: c.last4 }), sound: 'card', silentError: true })}>{t('cards.freeze.now')}</Button>
                ) : (
                  <Button size="sm" icon={<Sun />} loading={busy} onClick={() => run(() => unfreezeCard(c.id), { success: t('cards.unfrozenToast', { last4: c.last4 }), sound: 'card', silentError: true })}>{t('common.unfreeze')}</Button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <Empty title={t('cards.freeze.none')} />
      )}
      <ErrorPanel error={error} />
    </Modal>
  );
}
