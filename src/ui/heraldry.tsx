/** Original heraldry of the Exchequer of Aldermoor: crest, emblems and rune sigils (hand-drawn SVG). */
import type { ReactNode, SVGProps } from 'react';
import { useUI } from '@/state/ui';
import { translate } from '@/i18n';

export function Crest({ size = 48, motto = false, ...rest }: { size?: number; motto?: boolean } & SVGProps<SVGSVGElement>) {
  const h = motto ? size * 1.32 : size * 1.1;
  const lang = useUI((s) => s.lang);
  return (
    <svg viewBox={motto ? '0 0 120 158' : '0 0 120 132'} width={size} height={h} role="img" aria-label={translate(lang, 'app.bank')} {...rest}>
      <defs>
        <linearGradient id="crest-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f2d38a" />
          <stop offset="0.55" stopColor="#c9a253" />
          <stop offset="1" stopColor="#8a6418" />
        </linearGradient>
        <linearGradient id="crest-vert" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a6a4f" />
          <stop offset="1" stopColor="#123526" />
        </linearGradient>
        <linearGradient id="crest-gules" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9b2d3a" />
          <stop offset="1" stopColor="#5c1420" />
        </linearGradient>
      </defs>
      {/* crown */}
      <path d="M38 22 L44 8 L52 18 L60 4 L68 18 L76 8 L82 22 Z" fill="url(#crest-gold)" stroke="#6b4c12" strokeWidth="1" />
      <rect x="37" y="21" width="46" height="5" rx="1" fill="url(#crest-gold)" stroke="#6b4c12" strokeWidth="1" />
      <circle cx="60" cy="4.5" r="2.2" fill="#c9a253" />
      {/* shield */}
      <path d="M16 30 H104 V70 C104 100 82 118 60 127 C38 118 16 100 16 70 Z" fill="url(#crest-vert)" stroke="url(#crest-gold)" strokeWidth="3.2" />
      <path d="M60 30 H104 V70 C104 100 82 118 60 127 Z" fill="url(#crest-gules)" />
      <path d="M16 30 H104 V70 C104 100 82 118 60 127 C38 118 16 100 16 70 Z" fill="none" stroke="url(#crest-gold)" strokeWidth="3.2" />
      {/* chief star */}
      <path d="M60 37 l3.2 7 7.6 0.7 -5.8 5 1.8 7.4 -6.8 -4 -6.8 4 1.8 -7.4 -5.8 -5 7.6 -0.7z" fill="url(#crest-gold)" />
      {/* crossed key and quill */}
      <g stroke="url(#crest-gold)" strokeWidth="4" strokeLinecap="round" fill="none">
        <path d="M36 108 L84 62" />
        <path d="M84 108 L40 64" />
      </g>
      <circle cx="87" cy="59" r="7" fill="none" stroke="url(#crest-gold)" strokeWidth="3.4" />
      <path d="M40 106 l-6 0 M44 102 l-6 0" stroke="url(#crest-gold)" strokeWidth="3" strokeLinecap="round" />
      <path d="M40 64 C30 52 30 44 34 38 C40 46 46 52 46 62 Z" fill="url(#crest-gold)" />
      <path d="M38 60 L33 47" stroke="#6b4c12" strokeWidth="0.8" />
      {motto && (
        <g>
          <path d="M8 136 Q60 152 112 136 L108 148 Q60 162 12 148 Z" fill="url(#crest-gold)" stroke="#6b4c12" strokeWidth="0.8" />
          <text x="60" y="148" textAnchor="middle" fontFamily="Cinzel, serif" fontSize="7.4" fontWeight="700" fill="#2a1c05" letterSpacing="1.2">FIDES·ARCANUM·AURUM</text>
        </g>
      )}
    </svg>
  );
}

export type EmblemName = 'crest' | 'key' | 'quill' | 'scales' | 'vault' | 'eye' | 'globe' | 'rune' | 'star' | 'crown' | 'tower' | 'oath';

/** Emblems in a 40×40 box, stroked with currentColor. */
export function Emblem({ name, x = 0, y = 0, s = 1, sw = 2 }: { name: EmblemName; x?: number; y?: number; s?: number; sw?: number }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: sw, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const g = (children: ReactNode) => <g transform={`translate(${x} ${y}) scale(${s})`}>{children}</g>;
  switch (name) {
    case 'crest':
      return g(<><path d="M8 6 H32 V18 C32 28 26 34 20 37 C14 34 8 28 8 18 Z" {...common} /><path d="M20 6 V37" {...common} /><path d="M14 12 L26 26 M26 12 L14 26" {...common} /></>);
    case 'key':
      return g(<><circle cx="13" cy="13" r="7" {...common} /><path d="M18 18 L33 33 M28 28 L32 24 M31 31 L34 28" {...common} /></>);
    case 'quill':
      return g(<><path d="M30 4 C18 8 10 20 8 34 C16 26 26 20 30 4 Z" {...common} /><path d="M8 34 L22 16" {...common} /></>);
    case 'scales':
      return g(<><path d="M20 5 V34 M12 34 H28 M7 11 H33" {...common} /><path d="M7 11 L3 22 H11 Z M33 11 L29 22 H37 Z" {...common} /></>);
    case 'vault':
      return g(<><circle cx="20" cy="20" r="14" {...common} /><circle cx="20" cy="20" r="5" {...common} /><path d="M20 6 V11 M20 29 V34 M6 20 H11 M29 20 H34 M10 10 L13.5 13.5 M26.5 26.5 L30 30 M30 10 L26.5 13.5 M13.5 26.5 L10 30" {...common} /></>);
    case 'eye':
      return g(<><path d="M3 20 C10 9 30 9 37 20 C30 31 10 31 3 20 Z" {...common} /><circle cx="20" cy="20" r="5" {...common} /></>);
    case 'globe':
      return g(<><circle cx="20" cy="20" r="14" {...common} /><path d="M6 20 H34 M20 6 C13 13 13 27 20 34 C27 27 27 13 20 6" {...common} /></>);
    case 'rune':
      return g(<><path d="M12 5 V35 M12 12 L28 5 M12 20 L28 13 M28 22 L20 35" {...common} /></>);
    case 'star':
      return g(<path d="M20 4 L24 15 L36 15 L26 22 L30 34 L20 27 L10 34 L14 22 L4 15 L16 15 Z" {...common} />);
    case 'crown':
      return g(<><path d="M6 30 L4 12 L13 20 L20 8 L27 20 L36 12 L34 30 Z" {...common} /><path d="M6 34 H34" {...common} /></>);
    case 'tower':
      return g(<><path d="M10 35 V12 H30 V35 M8 12 V6 H13 V9 H17 V6 H23 V9 H27 V6 H32 V12" {...common} /><path d="M17 35 V27 C17 23 23 23 23 27 V35" {...common} /></>);
    case 'oath':
      return g(<><path d="M10 6 H28 C32 6 32 12 28 12 H12 V34 H30" {...common} /><path d="M16 18 H26 M16 23 H26 M16 28 H22" {...common} /></>);
    default:
      return null;
  }
}

/** Animated rune sigil used as ornament (decorative). */
export function RuneSigil({ size = 120, className = '' }: { size?: number; className?: string }) {
  const runes = ['M0 -6 V6 M0 -6 L5 -2', 'M-4 -6 V6 M-4 -6 L4 0 L-4 6', 'M0 -6 V6 M-5 -2 L5 2', 'M-4 6 L0 -6 L4 6', 'M-4 -6 L4 6 M4 -6 L-4 6', 'M0 -6 V6 M0 0 L5 -5 M0 0 L5 5', 'M-5 -6 L0 0 L5 -6 M0 0 V6'];
  return (
    <svg viewBox="-60 -60 120 120" width={size} height={size} className={className} aria-hidden>
      <g className="sigil-spin" style={{ transformBox: 'fill-box' }}>
        <circle r="54" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
        <circle r="46" fill="none" stroke="currentColor" strokeWidth="0.6" opacity="0.4" strokeDasharray="2 4" />
        {runes.concat(runes).map((d, i) => {
          const a = (i / 14) * Math.PI * 2;
          return <path key={i} d={d} transform={`translate(${Math.cos(a) * 50} ${Math.sin(a) * 50}) rotate(${(a * 180) / Math.PI + 90})`} fill="none" stroke="currentColor" strokeWidth="1.2" />;
        })}
      </g>
      <g className="rune-glow">
        <path d="M0 -30 L26 15 L-26 15 Z" fill="none" stroke="currentColor" strokeWidth="1" />
        <path d="M0 30 L-26 -15 L26 -15 Z" fill="none" stroke="currentColor" strokeWidth="1" />
        <circle r="9" fill="none" stroke="currentColor" strokeWidth="1.2" />
      </g>
    </svg>
  );
}

/** Guilloché rosette for checks and certificates (security pattern). */
export function Guilloche({ width = 600, height = 260, color = 'currentColor', opacity = 0.18 }: { width?: number; height?: number; color?: string; opacity?: number }) {
  const lines: string[] = [];
  for (let k = 0; k < 18; k++) {
    let d = '';
    for (let i = 0; i <= 160; i++) {
      const tt = (i / 160) * Math.PI * 2;
      const r = 70 + 22 * Math.sin(7 * tt + k * 0.35) + 8 * Math.cos(13 * tt);
      const x = width / 2 + r * Math.cos(tt) * 2.6;
      const y = height / 2 + r * Math.sin(tt) * 1.1;
      d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)} `;
    }
    lines.push(d + 'Z');
  }
  const waves: string[] = [];
  for (let k = 0; k < 10; k++) {
    let d = '';
    for (let x = 0; x <= width; x += 6) {
      const y = 14 + k * 3 + 4 * Math.sin(x / 18 + k);
      d += `${x ? 'L' : 'M'}${x} ${y.toFixed(1)} `;
    }
    waves.push(d);
  }
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" width="100%" height="100%" aria-hidden style={{ position: 'absolute', inset: 0, opacity }}>
      <g fill="none" stroke={color} strokeWidth="0.5">
        {lines.map((d, i) => <path key={i} d={d} />)}
        {waves.map((d, i) => <path key={'w' + i} d={d} />)}
        {waves.map((d, i) => <path key={'b' + i} d={d} transform={`translate(0 ${height - 50})`} />)}
      </g>
    </svg>
  );
}
