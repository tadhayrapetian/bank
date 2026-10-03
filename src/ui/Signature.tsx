/** Signature display (handwritten / electronic / official) and a pointer-based signature pad. */
import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Eraser } from 'lucide-react';
import { SIG_H, SIG_W, syntheticSignature } from '@/core/docs/strokes';
import { keyFingerprint } from '@/core/util/crypto';
import { Button } from './primitives';
import { useT } from '@/hooks/useT';
import type { DocSignature } from '@/core/types';

export function SignatureMark({ sig, ink = '#1b2a6b', state }: { sig: DocSignature; ink?: string; state?: 'verified' | 'invalid' }) {
  const { t, tx } = useT();
  const strokes = sig.strokes ?? (sig.kind === 'electronic' ? undefined : syntheticSignature(sig.signerName));
  return (
    <figure style={{ margin: 0, display: 'grid', gap: 2, color: ink }}>
      {strokes ? (
        <svg viewBox={`0 0 ${SIG_W} ${SIG_H}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }} aria-label={t('docs.signedBy', { name: sig.signerName })}>
          <path d={strokes} fill="none" stroke={ink} strokeWidth={sig.kind === 'official' ? 2.4 : 2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <div style={{ border: `1.5px solid ${ink}`, borderRadius: 4, padding: '6px 8px', fontFamily: 'var(--f-mono)', fontSize: 10, lineHeight: 1.35 }}>
          <div style={{ fontWeight: 600, letterSpacing: '0.08em' }}>◈ {t('docs.digitallySigned')}</div>
          <div>{sig.signerName}</div>
          <div>{sig.publicKey ? keyFingerprint(sig.publicKey) : '—'}</div>
        </div>
      )}
      <figcaption style={{ borderTop: `1px solid ${ink}`, fontSize: 10, paddingTop: 2, fontFamily: 'var(--f-ui)', display: 'flex', justifyContent: 'space-between', gap: 6 }}>
        <span>{sig.signerName}{sig.signerRole ? ` · ${sig.signerRole}` : ''}</span>
        <span>{tx(`docs.sigKind.${sig.kind}`)}{state ? ` · ${state === 'verified' ? '✓' : '✗'}` : ''}</span>
      </figcaption>
    </figure>
  );
}

export function SignaturePad({ onChange, height = 140 }: { onChange: (path: string | null) => void; height?: number }) {
  const { t } = useT();
  const ref = useRef<SVGSVGElement>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const drawing = useRef<{ pts: [number, number][] } | null>(null);
  const [live, setLive] = useState('');

  const toPoint = (e: RPointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * SIG_W, ((e.clientY - r.top) / r.height) * SIG_H];
  };
  const smooth = (pts: [number, number][]) => {
    if (pts.length < 2) return pts.length ? `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)} l 0.1 0` : '';
    let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += ` Q ${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
    }
    const l = pts[pts.length - 1];
    return d + ` L ${l[0].toFixed(1)} ${l[1].toFixed(1)}`;
  };
  return (
    <div className="stack-sm">
      <svg
        ref={ref}
        viewBox={`0 0 ${SIG_W} ${SIG_H}`}
        style={{ width: '100%', height, background: 'var(--paper)', borderRadius: 'var(--r-sm)', border: '1px dashed var(--paper-line)', touchAction: 'none', cursor: 'crosshair' }}
        role="img"
        aria-label={t('docs.signaturePad')}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          drawing.current = { pts: [toPoint(e)] };
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          drawing.current.pts.push(toPoint(e));
          setLive(smooth(drawing.current.pts));
        }}
        onPointerUp={() => {
          if (!drawing.current) return;
          const d = smooth(drawing.current.pts);
          drawing.current = null;
          setLive('');
          const next = [...paths, d];
          setPaths(next);
          onChange(next.join(' '));
        }}
      >
        <line x1="20" y1={SIG_H - 22} x2={SIG_W - 20} y2={SIG_H - 22} stroke="var(--paper-line)" strokeDasharray="4 4" />
        <text x="22" y={SIG_H - 8} fontSize="9" fill="var(--paper-ink-2)">✕</text>
        {[...paths, live].filter(Boolean).map((d, i) => <path key={i} d={d} fill="none" stroke="#1b2a6b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />)}
      </svg>
      <div className="row-between">
        <span className="xsmall muted">{t('docs.signHere')}</span>
        <Button size="sm" variant="ghost" icon={<Eraser />} onClick={() => { setPaths([]); onChange(null); }}>{t('docs.clearSignature')}</Button>
      </div>
    </div>
  );
}
