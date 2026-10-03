/** Card face with a flip to the reverse (magnetic stripe, signature panel, CVV). Details are masked unless revealed. */
import { useT } from '@/hooks/useT';
import { BankCard } from '@/ui/BankCard';
import type { Card } from '@/core/types';

const BACK: Record<Card['design'], { bg: string; ink: string }> = {
  emerald: { bg: 'linear-gradient(160deg, #164a37, #0a2219)', ink: '#f1e7cf' },
  burgundy: { bg: 'linear-gradient(160deg, #6e1b29, #2e0a10)', ink: '#f6e8d4' },
  obsidian: { bg: 'linear-gradient(160deg, #26282e, #07080a)', ink: '#e8e6e0' },
  brass: { bg: 'linear-gradient(160deg, #cfae63, #7c5a1c)', ink: '#2a1d05' },
  ivory: { bg: 'linear-gradient(160deg, #efe6d2, #c9b78f)', ink: '#2b2418' },
  midnight: { bg: 'linear-gradient(160deg, #1d2f5e, #0a1128)', ink: '#e6ecff' },
};

export function CardFace({ card, reveal, flipped }: { card: Card; reveal: boolean; flipped: boolean }) {
  const { t } = useT();
  const b = BACK[card.design];
  return (
    <div className={`sg-flip${flipped ? ' flipped' : ''}`}>
      <div className="sg-flip-inner">
        <div className="sg-flip-front" aria-hidden={flipped}>
          <BankCard card={card} reveal={reveal} />
        </div>
        <div className="sg-flip-back" aria-hidden={!flipped} style={{ background: b.bg, color: b.ink }}>
          <div className="sg-stripe" aria-hidden />
          <div className="sg-back-row">
            <div className="sg-sigpanel">
              <span className="sg-sigpanel-name">{card.holderName}</span>
            </div>
            <div className="sg-cvv" aria-label={t('cards.cvv')}>
              <span className="xsmall">{t('cards.cvv')}</span>
              <strong className="mono">{reveal ? card.cvv : '•••'}</strong>
            </div>
          </div>
          <div className="sg-back-fine">{t('cards.backFine')}</div>
          <div className="sg-back-foot">
            <span className="mono xsmall">{card.network} · {card.type.toUpperCase()} · {card.id}</span>
            <span className="sg-holo" aria-hidden />
          </div>
        </div>
      </div>
    </div>
  );
}
