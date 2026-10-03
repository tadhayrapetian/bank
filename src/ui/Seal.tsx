/**
 * Seal impressions rendered as SVG with an ink filter: turbulence-displaced
 * edges and random voids make each impression look physically stamped.
 */
import { useId, type CSSProperties, type ReactNode } from 'react';
import { INKS, sealById, type InkId, type SealDef } from '@/core/docs/seals';
import { Emblem } from './heraldry';

export interface SealProps {
  sealId: string;
  ink?: InkId | string;
  size?: number | string;
  rotation?: number;
  opacity?: number;
  intensity?: number; // 0..1 ink coverage
  date?: string;
  animate?: boolean;
  seed?: number;
  title?: string;
}

function inkColor(ink?: string, def?: SealDef) {
  const key = (ink ?? def?.ink ?? 'royal') as InkId;
  return INKS[key] ?? ink ?? '#1f3f95';
}

export function Seal({ sealId, ink, size = 160, rotation = 0, opacity = 0.9, intensity = 0.85, date, animate, seed, title, blend = true }: SealProps & { blend?: boolean }) {
  const def = sealById(sealId);
  const uid = useId().replace(/:/g, '');
  if (!def) return null;
  const color = inkColor(ink, def);
  const isRect = def.shape === 'rect';
  const vb = isRect ? '0 0 240 110' : def.shape === 'oval' ? '0 0 240 160' : '0 0 200 200';
  const fid = `ink-${uid}`;
  const s = seed ?? sealId.length * 13 + (date ? date.charCodeAt(9) : 3);
  const coverage = Math.max(0.15, Math.min(1, intensity));
  const style = { width: typeof size === 'number' ? size : size, height: 'auto', transform: `rotate(${rotation}deg)`, opacity, ['--rot' as string]: `${rotation}deg` } as CSSProperties;
  const dateStr = date ? date.slice(0, 10).split('-').reverse().join('.') : undefined;

  const filter = def.shape === 'wax' ? null : (
    <filter id={fid} x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={s} result="grain" />
      <feDisplacementMap in="SourceGraphic" in2="grain" scale="2.6" xChannelSelector="R" yChannelSelector="G" result="rough" />
      <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="3" seed={s + 7} result="blotch" />
      <feColorMatrix in="blotch" type="matrix" values={`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -6 ${(3.2 + 1.2 * coverage).toFixed(2)}`} result="mask" />
      <feComposite in="rough" in2="mask" operator="in" />
    </filter>
  );

  const textArc = (r: number, top: string | undefined, bottom: string | undefined, cx = 100, cy = 100, fs = 15) => (
    <>
      <path id={`top-${uid}`} d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" />
      <path id={`bot-${uid}`} d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 0 ${cx + r} ${cy}`} fill="none" />
      {top && (
        <text fontFamily="Cinzel, 'Cormorant Garamond', serif" fontWeight="700" fontSize={fs} letterSpacing="1.5" fill={color}>
          <textPath href={`#top-${uid}`} startOffset="50%" textAnchor="middle">{top}</textPath>
        </text>
      )}
      {bottom && (
        <text fontFamily="Cinzel, 'Cormorant Garamond', serif" fontWeight="700" fontSize={fs * 0.82} letterSpacing="1.2" fill={color} dominantBaseline="hanging">
          <textPath href={`#bot-${uid}`} startOffset="50%" textAnchor="middle">{bottom}</textPath>
        </text>
      )}
    </>
  );

  let body: ReactNode = null;
  switch (def.shape) {
    case 'round':
      body = (
        <g filter={`url(#${fid})`} style={{ color }}>
          <circle cx="100" cy="100" r="94" fill="none" stroke={color} strokeWidth="5" />
          <circle cx="100" cy="100" r="86" fill="none" stroke={color} strokeWidth="1.6" />
          <circle cx="100" cy="100" r="56" fill="none" stroke={color} strokeWidth="2.2" />
          <circle cx="100" cy="100" r="51" fill="none" stroke={color} strokeWidth="0.8" strokeDasharray="1.5 3" />
          {textArc(70, def.top, def.bottom)}
          <path d="M28 100 l4 -4 4 4 -4 4z M172 100 l-4 -4 -4 4 4 4z" fill={color} />
          {def.emblem && <Emblem name={def.emblem} x={72} y={def.code ? 60 : 72} s={1.4} sw={2.2} />}
          {def.code && (
            <text x="100" y="134" textAnchor="middle" fontFamily="Cinzel, serif" fontWeight="700" fontSize="14" letterSpacing="3" fill={color}>{def.code}</text>
          )}
          {dateStr && <text x="100" y="148" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="9" fill={color}>{dateStr}</text>}
        </g>
      );
      break;
    case 'oval':
      body = (
        <g filter={`url(#${fid})`}>
          <ellipse cx="120" cy="80" rx="114" ry="74" fill="none" stroke={color} strokeWidth="4.5" />
          <ellipse cx="120" cy="80" rx="104" ry="64" fill="none" stroke={color} strokeWidth="1.4" />
          <path id={`otop-${uid}`} d="M 36 80 A 84 50 0 0 1 204 80" fill="none" />
          <path id={`obot-${uid}`} d="M 30 80 A 90 56 0 0 0 210 80" fill="none" />
          <text fontFamily="Cinzel, serif" fontWeight="700" fontSize="17" letterSpacing="2" fill={color}><textPath href={`#otop-${uid}`} startOffset="50%" textAnchor="middle">{def.top}</textPath></text>
          <text fontFamily="Cinzel, serif" fontWeight="700" fontSize="11.5" letterSpacing="1.4" fill={color} dominantBaseline="hanging"><textPath href={`#obot-${uid}`} startOffset="50%" textAnchor="middle">{def.bottom}</textPath></text>
          <line x1="64" y1="86" x2="176" y2="86" stroke={color} strokeWidth="1.2" />
          <text x="120" y="80" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="15" fontWeight="500" fill={color}>{dateStr ?? '— · — · —'}</text>
        </g>
      );
      break;
    case 'rect':
      body = (
        <g filter={`url(#${fid})`}>
          <rect x="4" y="4" width="232" height="102" rx="6" fill="none" stroke={color} strokeWidth="5" />
          <rect x="12" y="12" width="216" height="86" rx="3" fill="none" stroke={color} strokeWidth="1.6" />
          <text x="120" y={dateStr ? 60 : 68} textAnchor="middle" fontFamily="Cinzel, serif" fontWeight="700" fontSize={(def.center?.length ?? 6) > 10 ? 25 : 34} letterSpacing="3" fill={color}>{def.center}</text>
          {dateStr && <text x="120" y="85" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="13" fill={color}>{dateStr} · AEX</text>}
        </g>
      );
      break;
    case 'hex': {
      const hex = (r: number) => Array.from({ length: 6 }, (_, i) => { const a = (Math.PI / 3) * i - Math.PI / 2; return `${100 + r * Math.cos(a)},${100 + r * Math.sin(a)}`; }).join(' ');
      body = (
        <g filter={`url(#${fid})`}>
          <polygon points={hex(94)} fill="none" stroke={color} strokeWidth="5" />
          <polygon points={hex(84)} fill="none" stroke={color} strokeWidth="1.4" />
          {def.emblem && <g style={{ color }}><Emblem name={def.emblem} x={80} y={42} s={1} sw={2} /></g>}
          <text x="100" y="116" textAnchor="middle" fontFamily="Cinzel, serif" fontWeight="700" fontSize="21" letterSpacing="2.5" fill={color}>{def.center}</text>
          {['ᚠ', 'ᚱ', 'ᚨ', 'ᛟ', 'ᛞ', 'ᛉ'].map((r, i) => {
            const a = (Math.PI / 3) * i;
            return <text key={i} x={100 + 72 * Math.cos(a)} y={104 + 72 * Math.sin(a)} textAnchor="middle" fontSize="12" fill={color} fontFamily="serif">{r}</text>;
          })}
        </g>
      );
      break;
    }
    case 'star': {
      const pts = Array.from({ length: 16 }, (_, i) => { const r = i % 2 ? 66 : 96; const a = (Math.PI / 8) * i - Math.PI / 2; return `${100 + r * Math.cos(a)},${100 + r * Math.sin(a)}`; }).join(' ');
      body = (
        <g filter={`url(#${fid})`}>
          <polygon points={pts} fill="none" stroke={color} strokeWidth="4" />
          <circle cx="100" cy="100" r="54" fill="none" stroke={color} strokeWidth="1.6" />
          {textArc(44, def.top, undefined, 100, 100, 11)}
          <text x="100" y="112" textAnchor="middle" fontFamily="Cinzel, serif" fontWeight="700" fontSize="18" letterSpacing="2" fill={color}>{def.center}</text>
          {dateStr && <text x="100" y="128" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="8.5" fill={color}>{dateStr}</text>}
        </g>
      );
      break;
    }
    case 'wax': {
      const r = (a: number) => 84 + 6 * Math.sin(a * 5 + s) + 4 * Math.sin(a * 11 + s * 2);
      let d = '';
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        d += `${i ? 'L' : 'M'}${(100 + r(a) * Math.cos(a)).toFixed(1)} ${(100 + r(a) * Math.sin(a)).toFixed(1)} `;
      }
      body = (
        <g>
          <defs>
            <radialGradient id={`wax-${uid}`} cx="0.38" cy="0.32" r="0.8">
              <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
              <stop offset="0.18" stopColor={color} stopOpacity="1" />
              <stop offset="1" stopColor="#000" stopOpacity="0.85" />
            </radialGradient>
            <filter id={`emb-${uid}`}>
              <feGaussianBlur in="SourceAlpha" stdDeviation="1.2" result="b" />
              <feSpecularLighting in="b" surfaceScale="3" specularConstant="0.9" specularExponent="18" lightingColor="#fff" result="spec">
                <fePointLight x="40" y="20" z="80" />
              </feSpecularLighting>
              <feComposite in="spec" in2="SourceAlpha" operator="in" result="s" />
              <feComposite in="SourceGraphic" in2="s" operator="arithmetic" k1="0" k2="1" k3="0.6" k4="0" />
            </filter>
          </defs>
          <path d={d + 'Z'} fill={color} />
          <path d={d + 'Z'} fill={`url(#wax-${uid})`} opacity="0.9" />
          <circle cx="100" cy="100" r="58" fill="none" stroke="#000" strokeOpacity="0.35" strokeWidth="5" />
          <circle cx="100" cy="100" r="58" fill="none" stroke="#fff" strokeOpacity="0.25" strokeWidth="1.5" transform="translate(-1.5 -1.5)" />
          <g filter={`url(#emb-${uid})`} style={{ color: '#000' }} opacity="0.55">
            {def.emblem && <Emblem name={def.emblem} x={62} y={62} s={1.9} sw={3} />}
          </g>
          <g style={{ color: '#fff' }} opacity="0.22" transform="translate(-1.2 -1.2)">
            {def.emblem && <Emblem name={def.emblem} x={62} y={62} s={1.9} sw={2.4} />}
          </g>
        </g>
      );
      break;
    }
  }

  return (
    <svg
      viewBox={vb}
      className={animate ? 'ink-in' : undefined}
      style={{ ...style, mixBlendMode: def.shape === 'wax' || !blend ? 'normal' : 'multiply', overflow: 'visible', display: 'block' }}
      role="img"
      aria-label={title ?? def.top ?? def.center ?? sealId}
    >
      {filter && <defs>{filter}</defs>}
      {body}
    </svg>
  );
}
