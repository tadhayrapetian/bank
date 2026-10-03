/**
 * Charts (inline SVG) following the dataviz method: thin marks, 2px lines,
 * ≤24px bars with 4px rounded data-ends, recessive hairline grid, legend for
 * ≥2 series, hover crosshair / tooltip, and a table view for every chart.
 * Series colors come from theme tokens --s1…--s8 (validated per theme surface).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type * as React from 'react';
import { useT } from '@/hooks/useT';

export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => setW(Math.max(220, entries[0].contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref as React.RefObject<T>, w];
}

export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (min === max) {
    const d = Math.abs(min) || 1;
    min -= d * 0.5;
    max += d * 0.5;
  }
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

export interface LineSeries {
  id: string;
  label: string;
  color?: string;
  points: { t: number; v: number }[];
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  if (items.length < 2) return null;
  return (
    <ul className="row" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 14 }} aria-label="Legend">
      {items.map((i) => (
        <li key={i.label} className="row xsmall ink2" style={{ gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: i.color, display: 'inline-block' }} aria-hidden />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

export function ChartFrame({ title, legend, children, table, actions }: { title?: ReactNode; legend?: { label: string; color: string }[]; children: ReactNode; table: ReactNode; actions?: ReactNode }) {
  const { t } = useT();
  const [showTable, setShowTable] = useState(false);
  return (
    <div className="stack">
      <div className="row-between">
        <div className="row">{title && <div className="small ink2">{title}</div>}{legend && <Legend items={legend} />}</div>
        <div className="row">
          {actions}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>{showTable ? t('common.showChart') : t('common.showTable')}</button>
        </div>
      </div>
      {showTable ? <div className="table-wrap">{table}</div> : children}
    </div>
  );
}

export function LineChart({ series, height = 240, yFormat = (v) => String(v), xFormat = (t) => new Date(t).toISOString().slice(0, 10), area = true, zero = false, ariaLabel }: {
  series: LineSeries[]; height?: number; yFormat?: (v: number) => string; xFormat?: (t: number) => string; area?: boolean; zero?: boolean; ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 64, r: 16, t: 12, b: 26 };
  const all = series.flatMap((s) => s.points);
  const xs = series[0]?.points.map((p) => p.t) ?? [];
  const { yTicks, ymin, ymax, x0, x1 } = useMemo(() => {
    let lo = Math.min(...all.map((p) => p.v));
    let hi = Math.max(...all.map((p) => p.v));
    if (zero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
    const pad5 = (hi - lo) * 0.06 || Math.abs(hi) * 0.02 || 1;
    const ticks = niceTicks(lo - (zero ? 0 : pad5), hi + pad5, 4);
    return { yTicks: ticks, ymin: ticks[0], ymax: ticks[ticks.length - 1], x0: Math.min(...all.map((p) => p.t)), x1: Math.max(...all.map((p) => p.t)) };
  }, [all, zero]);
  if (!all.length) return <div ref={ref} style={{ height }} />;
  const iw = width - pad.l - pad.r, ih = height - pad.t - pad.b;
  const X = (t: number) => pad.l + (x1 === x0 ? iw / 2 : ((t - x0) / (x1 - x0)) * iw);
  const Y = (v: number) => pad.t + ih - ((v - ymin) / (ymax - ymin || 1)) * ih;
  const xTickIdx = [0, Math.floor(xs.length / 3), Math.floor((2 * xs.length) / 3), xs.length - 1].filter((v, i, a) => v >= 0 && a.indexOf(v) === i);
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * width;
    let best = 0, bd = Infinity;
    xs.forEach((tt, i) => { const d = Math.abs(X(tt) - x); if (d < bd) { bd = d; best = i; } });
    setHover(best);
  };
  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ display: 'block', touchAction: 'pan-y' }}>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={width - pad.r} y1={Y(v)} y2={Y(v)} stroke="var(--grid)" strokeWidth="1" />
            <text x={pad.l - 8} y={Y(v)} dy="0.32em" textAnchor="end" fontSize="10.5" fill="var(--muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>{yFormat(v)}</text>
          </g>
        ))}
        <line x1={pad.l} x2={width - pad.r} y1={pad.t + ih} y2={pad.t + ih} stroke="var(--axis)" strokeWidth="1" />
        {xTickIdx.map((i) => xs[i] !== undefined && (
          <text key={i} x={X(xs[i])} y={height - 8} textAnchor={i === 0 ? 'start' : i === xs.length - 1 ? 'end' : 'middle'} fontSize="10.5" fill="var(--muted)">{xFormat(xs[i])}</text>
        ))}
        {series.map((s, si) => {
          const color = s.color ?? SERIES[si % SERIES.length];
          const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(' ');
          const base = Y(Math.max(ymin, Math.min(ymax, 0 >= ymin && 0 <= ymax ? 0 : ymin)));
          const last = s.points[s.points.length - 1];
          return (
            <g key={s.id}>
              {area && series.length === 1 && <path d={`${d} L${X(last.t)} ${base} L${X(s.points[0].t)} ${base} Z`} fill={color} opacity="0.1" />}
              <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {last && <circle cx={X(last.t)} cy={Y(last.v)} r="4" fill={color} stroke="var(--chart-surface)" strokeWidth="2" />}
            </g>
          );
        })}
        {hover !== null && xs[hover] !== undefined && (
          <g pointerEvents="none">
            <line x1={X(xs[hover])} x2={X(xs[hover])} y1={pad.t} y2={pad.t + ih} stroke="var(--axis)" strokeWidth="1" />
            {series.map((s, si) => s.points[hover] && (
              <circle key={s.id} cx={X(s.points[hover].t)} cy={Y(s.points[hover].v)} r="4.5" fill={s.color ?? SERIES[si % SERIES.length]} stroke="var(--chart-surface)" strokeWidth="2" />
            ))}
          </g>
        )}
      </svg>
      {hover !== null && xs[hover] !== undefined && (
        <div role="status" style={{ position: 'absolute', top: 4, left: Math.min(Math.max(X(xs[hover]) + 10, 0), width - 190), pointerEvents: 'none', background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 6, padding: '6px 9px', boxShadow: 'var(--shadow-2)', fontSize: 12, minWidth: 150, zIndex: 2 }}>
          <div className="muted xsmall">{xFormat(xs[hover])}</div>
          {series.map((s, si) => s.points[hover] && (
            <div key={s.id} className="row-between" style={{ gap: 10 }}>
              <span className="row" style={{ gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: s.color ?? SERIES[si % SERIES.length] }} />{s.label}</span>
              <strong className="tnum">{yFormat(s.points[hover].v)}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface BarSeries {
  id: string;
  label: string;
  color?: string;
  values: number[];
}

export function BarChart({ categories, series, height = 240, yFormat = (v) => String(v), ariaLabel }: { categories: string[]; series: BarSeries[]; height?: number; yFormat?: (v: number) => string; ariaLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ c: number; s: number } | null>(null);
  const pad = { l: 64, r: 12, t: 12, b: 26 };
  const vals = series.flatMap((s) => s.values);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 4);
  const ymin = ticks[0], ymax = ticks[ticks.length - 1];
  const iw = width - pad.l - pad.r, ih = height - pad.t - pad.b;
  const Y = (v: number) => pad.t + ih - ((v - ymin) / (ymax - ymin || 1)) * ih;
  const band = iw / Math.max(1, categories.length);
  const barW = Math.min(24, Math.max(4, (band * 0.7 - (series.length - 1) * 2) / series.length));
  const groupW = barW * series.length + (series.length - 1) * 2;
  const zeroY = Y(0);
  const step = Math.ceil(categories.length / Math.max(1, Math.floor(iw / 64)));
  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} style={{ display: 'block' }} onPointerLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={width - pad.r} y1={Y(v)} y2={Y(v)} stroke="var(--grid)" />
            <text x={pad.l - 8} y={Y(v)} dy="0.32em" textAnchor="end" fontSize="10.5" fill="var(--muted)">{yFormat(v)}</text>
          </g>
        ))}
        <line x1={pad.l} x2={width - pad.r} y1={zeroY} y2={zeroY} stroke="var(--axis)" />
        {categories.map((c, ci) => {
          const gx = pad.l + ci * band + (band - groupW) / 2;
          return (
            <g key={c + ci}>
              {series.map((s, si) => {
                const v = s.values[ci] ?? 0;
                const x = gx + si * (barW + 2);
                const y1 = Y(Math.max(0, v)), y2 = Y(Math.min(0, v));
                const h = Math.max(0, y2 - y1);
                const r = Math.min(4, h / 2, barW / 2);
                const up = v >= 0;
                const d = up
                  ? `M${x} ${y2} V${y1 + r} Q${x} ${y1} ${x + r} ${y1} H${x + barW - r} Q${x + barW} ${y1} ${x + barW} ${y1 + r} V${y2} Z`
                  : `M${x} ${y1} V${y2 - r} Q${x} ${y2} ${x + r} ${y2} H${x + barW - r} Q${x + barW} ${y2} ${x + barW} ${y2 - r} V${y1} Z`;
                return (
                  <g key={s.id}>
                    <rect x={x - 2} y={pad.t} width={barW + 4} height={ih} fill="transparent" onPointerEnter={() => setHover({ c: ci, s: si })} />
                    {h > 0 && <path d={d} fill={s.color ?? SERIES[si % SERIES.length]} opacity={hover && (hover.c !== ci || hover.s !== si) ? 0.55 : 1} pointerEvents="none" />}
                  </g>
                );
              })}
              {ci % step === 0 && <text x={pad.l + ci * band + band / 2} y={height - 8} textAnchor="middle" fontSize="10.5" fill="var(--muted)">{c}</text>}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div role="status" style={{ position: 'absolute', top: 4, left: Math.min(pad.l + hover.c * band + band / 2 + 8, width - 180), pointerEvents: 'none', background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 6, padding: '6px 9px', boxShadow: 'var(--shadow-2)', fontSize: 12, zIndex: 2, minWidth: 140 }}>
          <div className="muted xsmall">{categories[hover.c]}</div>
          {series.map((s, si) => (
            <div key={s.id} className="row-between" style={{ gap: 10, fontWeight: si === hover.s ? 600 : 400 }}>
              <span className="row" style={{ gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: s.color ?? SERIES[si % SERIES.length] }} />{s.label}</span>
              <span className="tnum">{yFormat(s.values[hover.c] ?? 0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Donut({ slices, size = 180, center, ariaLabel, format = (v) => String(v) }: { slices: { label: string; value: number; color?: string }[]; size?: number; center?: ReactNode; ariaLabel: string; format?: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  const r = size / 2 - 6, inner = r * 0.64;
  let a0 = -Math.PI / 2;
  const gap = slices.length > 1 ? 0.012 : 0;
  return (
    <div className="row" style={{ gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel}>
          {total <= 0 && <circle cx={size / 2} cy={size / 2} r={(r + inner) / 2} fill="none" stroke="var(--grid)" strokeWidth={r - inner} />}
          {slices.map((s, i) => {
            const frac = Math.max(0, s.value) / (total || 1);
            const a1 = a0 + frac * Math.PI * 2;
            const sa = a0 + gap, ea = Math.max(sa, a1 - gap);
            a0 = a1;
            if (frac <= 0) return null;
            const c = size / 2;
            const large = ea - sa > Math.PI ? 1 : 0;
            const rr = hover === i ? r + 3 : r;
            const d = `M${c + rr * Math.cos(sa)} ${c + rr * Math.sin(sa)} A${rr} ${rr} 0 ${large} 1 ${c + rr * Math.cos(ea)} ${c + rr * Math.sin(ea)} L${c + inner * Math.cos(ea)} ${c + inner * Math.sin(ea)} A${inner} ${inner} 0 ${large} 0 ${c + inner * Math.cos(sa)} ${c + inner * Math.sin(sa)} Z`;
            return <path key={s.label} d={d} fill={s.color ?? SERIES[i % SERIES.length]} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />;
          })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center', pointerEvents: 'none', padding: inner * 0.3 }}>
          {hover !== null ? (
            <div><div className="xsmall muted">{slices[hover].label}</div><div className="tnum" style={{ fontWeight: 600 }}>{format(slices[hover].value)}</div></div>
          ) : center}
        </div>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 5, minWidth: 0, flex: 1 }}>
        {slices.map((s, i) => (
          <li key={s.label} className="row-between small" style={{ gap: 10, fontWeight: hover === i ? 600 : 400 }} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
            <span className="row-nowrap" style={{ gap: 7 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: s.color ?? SERIES[i % SERIES.length], flex: 'none' }} /><span className="truncate">{s.label}</span></span>
            <span className="tnum ink2">{format(s.value)} · {total ? Math.round((Math.max(0, s.value) / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Sparkline({ points, width = 120, height = 34, color = 'var(--accent)', label }: { points: number[]; width?: number; height?: number; color?: string; label: string }) {
  if (points.length < 2) return <svg width={width} height={height} aria-label={label} />;
  const lo = Math.min(...points), hi = Math.max(...points);
  const X = (i: number) => 2 + (i / (points.length - 1)) * (width - 6);
  const Y = (v: number) => 3 + (height - 6) - ((v - lo) / (hi - lo || 1)) * (height - 6);
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} style={{ display: 'block' }}>
      <path d={`${d} L${X(points.length - 1)} ${height} L${X(0)} ${height} Z`} fill={color} opacity="0.1" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx={X(points.length - 1)} cy={Y(points[points.length - 1])} r="2.6" fill={color} />
    </svg>
  );
}
