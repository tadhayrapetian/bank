/** SIGIL card visual. Numbers are masked unless explicitly revealed. */
import { formatCardNumber } from '@/core/banking/numbers';
import { useT } from '@/hooks/useT';
import type { Card } from '@/core/types';

const DESIGNS: Record<Card['design'], { bg: string; ink: string; accent: string }> = {
  emerald: { bg: 'linear-gradient(135deg, #1d5a43 0%, #0e3022 55%, #0a2219 100%)', ink: '#f1e7cf', accent: '#d8b665' },
  burgundy: { bg: 'linear-gradient(135deg, #8c2434 0%, #4e1019 60%, #2e0a10 100%)', ink: '#f6e8d4', accent: '#e2c27a' },
  obsidian: { bg: 'linear-gradient(135deg, #2b2d33 0%, #131418 60%, #07080a 100%)', ink: '#e8e6e0', accent: '#b9bcc6' },
  brass: { bg: 'linear-gradient(135deg, #e8c879 0%, #b48a37 50%, #7c5a1c 100%)', ink: '#2a1d05', accent: '#3d2a08' },
  ivory: { bg: 'linear-gradient(135deg, #f6efe0 0%, #e1d4b6 60%, #c9b78f 100%)', ink: '#2b2418', accent: '#7c5a1c' },
  midnight: { bg: 'linear-gradient(135deg, #253a72 0%, #121d40 60%, #0a1128 100%)', ink: '#e6ecff', accent: '#9fc0ff' },
};

export function BankCard({ card, reveal = false, compact = false }: { card: Card; reveal?: boolean; compact?: boolean }) {
  const { t, tx } = useT();
  const d = DESIGNS[card.design];
  const dim = card.status !== 'active';
  return (
    <div
      role="img"
      aria-label={`${tx(`cardType.${card.type}`)} SIGIL •${card.last4} — ${tx(`status.card.${card.status}`)}`}
      style={{
        position: 'relative', aspectRatio: '1.586', width: '100%', maxWidth: compact ? 280 : 380, borderRadius: compact ? 12 : 16, padding: compact ? 14 : 20,
        background: d.bg, color: d.ink, boxShadow: '0 18px 36px -18px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.18)', overflow: 'hidden',
        display: 'grid', gridTemplateRows: 'auto 1fr auto', filter: dim ? 'grayscale(0.7) brightness(0.8)' : undefined, fontFamily: 'var(--f-ui)',
      }}
    >
      <svg viewBox="0 0 380 240" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.16 }} aria-hidden>
        {Array.from({ length: 14 }, (_, i) => <circle key={i} cx={330} cy={30} r={30 + i * 16} fill="none" stroke={d.accent} strokeWidth="0.8" />)}
      </svg>
      <div className="row-between" style={{ position: 'relative' }}>
        <div>
          <div style={{ fontFamily: 'var(--f-engraved)', fontWeight: 700, letterSpacing: '0.16em', fontSize: compact ? 11 : 13 }}>EXCHEQUER</div>
          <div style={{ fontSize: compact ? 8 : 9, letterSpacing: '0.2em', opacity: 0.8, textTransform: 'uppercase' }}>{tx(`cardType.${card.type}`)}</div>
        </div>
        <svg width={compact ? 22 : 28} height={compact ? 22 : 28} viewBox="0 0 40 40" aria-hidden><path d="M20 3 L24 15 L37 15 L27 23 L31 36 L20 28 L9 36 L13 23 L3 15 L16 15 Z" fill="none" stroke={d.accent} strokeWidth="2" /></svg>
      </div>
      <div style={{ position: 'relative', alignSelf: 'center', display: 'grid', gap: compact ? 8 : 12 }}>
        <div style={{ width: compact ? 34 : 44, height: compact ? 26 : 32, borderRadius: 6, background: `linear-gradient(135deg, ${d.accent}, #fff8 50%, ${d.accent})`, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.2)' }} aria-hidden />
        <div style={{ fontFamily: 'var(--f-mono)', fontSize: compact ? 14 : 19, letterSpacing: '0.12em', textShadow: '0 1px 0 rgba(0,0,0,0.25)' }}>{formatCardNumber(card.number, !reveal)}</div>
      </div>
      <div className="row-between" style={{ position: 'relative', alignItems: 'flex-end' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 8, opacity: 0.7, letterSpacing: '0.16em' }}>{t('common.holderName').toUpperCase()}</div>
          <div className="truncate" style={{ fontSize: compact ? 11 : 13, letterSpacing: '0.08em' }}>{card.holderName}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 8, opacity: 0.7, letterSpacing: '0.16em' }}>{t('common.expiry').toUpperCase()}</div>
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: compact ? 11 : 13 }}>{String(card.expMonth).padStart(2, '0')}/{String(card.expYear).slice(2)}</div>
        </div>
        <div style={{ fontFamily: 'var(--f-engraved)', fontWeight: 700, fontStyle: 'italic', fontSize: compact ? 14 : 18, letterSpacing: '0.08em', color: d.accent }}>SIGIL</div>
      </div>
      {dim && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
          <span className="badge tone-neutral" style={{ background: 'rgba(0,0,0,0.55)', color: '#fff', borderColor: '#fff' }}>{tx(`status.card.${card.status}`)}</span>
        </div>
      )}
    </div>
  );
}
