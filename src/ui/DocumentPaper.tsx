/**
 * Official paper renderer. Every document type is typeset on cream paper with
 * letterhead, registry block, watermark, verification QR, barcode, folio and
 * version; positioned elements (seals, signatures, text, QR, barcode, dates,
 * numbers) overlay the page and can be moved/rotated/resized in edit mode.
 */
import { useRef, type CSSProperties, type ReactNode, type PointerEvent as RPointerEvent } from 'react';
import { Crest } from './heraldry';
import { Seal } from './Seal';
import { SignatureMark } from './Signature';
import { QRCode, qrPayload } from './QR';
import { Barcode } from './Barcode';
import { useT, useFmt } from '@/hooks/useT';
import { amountInWords } from '@/core/currency/words';
import { DEPARTMENTS, STATE } from '@/core/institution';
import type { BankDocument, DocElement, DeptCode, PartyInfo } from '@/core/types';

type Data = Record<string, unknown>;

export interface PaperProps {
  doc: BankDocument;
  editable?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onElementChange?: (el: DocElement) => void;
  sigStates?: Record<string, boolean>;
  printId?: string;
}

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const n = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0));

export function DocumentPaper({ doc, editable, selectedId, onSelect, onElementChange, sigStates, printId }: PaperProps) {
  const { t, tx, lang } = useT();
  const f = useFmt();
  const paperRef = useRef<HTMLDivElement>(null);
  const d = doc.data as Data;
  const dept = (DEPARTMENTS[doc.department as DeptCode]?.name ? doc.department : 'ADM') as DeptCode;
  const verifyUrl = qrPayload('verify', { doc: doc.id, code: doc.verificationCode });

  const drag = useRef<{ id: string; mode: 'move' | 'rotate' | 'resize'; sx: number; sy: number; el: DocElement } | null>(null);
  const onDown = (e: RPointerEvent, el: DocElement, mode: 'move' | 'rotate' | 'resize') => {
    if (!editable) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    onSelect?.(el.id);
    drag.current = { id: el.id, mode, sx: e.clientX, sy: e.clientY, el };
  };
  const onMove = (e: RPointerEvent) => {
    const g = drag.current;
    const box = paperRef.current?.getBoundingClientRect();
    if (!g || !box) return;
    const dx = ((e.clientX - g.sx) / box.width) * 100;
    const dy = ((e.clientY - g.sy) / box.height) * 100;
    if (g.mode === 'move') onElementChange?.({ ...g.el, x: clamp(g.el.x + dx, -5, 98), y: clamp(g.el.y + dy, -5, 98) });
    if (g.mode === 'resize') onElementChange?.({ ...g.el, w: clamp(g.el.w + dx, 4, 90) });
    if (g.mode === 'rotate') {
      const cx = box.left + ((g.el.x + g.el.w / 2) / 100) * box.width;
      const cy = box.top + ((g.el.y + g.el.w / 4) / 100) * box.height;
      const ang = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90;
      onElementChange?.({ ...g.el, rotation: Math.round(ang) });
    }
  };
  const onUp = () => {
    drag.current = null;
  };

  const renderEl = (el: DocElement) => {
    const st: CSSProperties = { position: 'absolute', left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, transform: `rotate(${el.rotation}deg)`, transformOrigin: 'center', opacity: el.opacity, zIndex: el.z, cursor: editable ? 'move' : undefined, touchAction: editable ? 'none' : undefined };
    const sel = editable && selectedId === el.id;
    let inner: ReactNode = null;
    switch (el.kind) {
      case 'seal':
        inner = <Seal sealId={s(el.props.sealId)} ink={s(el.props.ink) || undefined} size="100%" opacity={1} intensity={n(el.props.intensity ?? 0.85)} date={s(el.props.date) || undefined} seed={el.id.charCodeAt(4)} />;
        break;
      case 'signature': {
        const sig = doc.signatures.find((x) => x.id === el.props.signatureId);
        inner = sig ? <SignatureMark sig={sig} state={sigStates ? (sigStates[sig.id] ? 'verified' : 'invalid') : undefined} /> : null;
        break;
      }
      case 'qr':
        inner = <div style={{ background: '#fff8', padding: '4%', lineHeight: 0 }}><QRCode value={s(el.props.payload) === 'verify' || !el.props.payload ? verifyUrl : s(el.props.payload)} size={400} label={t('docs.paper.verifyQr')} /></div>;
        break;
      case 'barcode':
        inner = <Barcode value={s(el.props.value) || doc.number} height={40} />;
        break;
      case 'text':
        inner = <div style={{ fontSize: `${n(el.props.size || 1.6)}cqw`, fontFamily: s(el.props.font) === 'script' ? 'var(--f-script)' : s(el.props.font) === 'mono' ? 'var(--f-mono)' : 'var(--f-paper)', color: s(el.props.color) || 'var(--paper-ink)', fontWeight: el.props.bold ? 700 : 400, whiteSpace: 'pre-wrap', lineHeight: 1.25 }}>{s(el.props.text)}</div>;
        break;
      case 'date':
        inner = <div style={{ fontSize: `${n(el.props.size || 1.5)}cqw`, fontFamily: 'var(--f-mono)', color: 'var(--paper-ink)' }}>{f.dateLong(s(el.props.text) || doc.updatedAt)}</div>;
        break;
      case 'docnumber':
        inner = <div style={{ fontSize: `${n(el.props.size || 1.5)}cqw`, fontFamily: 'var(--f-mono)', color: 'var(--paper-ink)', letterSpacing: '0.06em' }}>№ {doc.number}</div>;
        break;
    }
    return (
      <div key={el.id} style={st} onPointerDown={(e) => onDown(e, el, 'move')} data-el={el.kind} aria-selected={sel || undefined}>
        <div style={{ outline: sel ? '1.5px dashed var(--accent-2)' : undefined, outlineOffset: 4 }}>{inner}</div>
        {sel && (
          <>
            <span onPointerDown={(e) => onDown(e, el, 'rotate')} title={t('editor.rotate')} style={handle(-14, '50%', 'grab', true)} />
            <span onPointerDown={(e) => onDown(e, el, 'resize')} title={t('editor.resize')} style={handle('100%', '100%', 'nwse-resize')} />
          </>
        )}
      </div>
    );
  };

  const dateLabel = f.dateLong(doc.createdAt);
  return (
    <div
      ref={paperRef}
      id={printId}
      className="doc-paper"
      data-doc={doc.id}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerDown={() => editable && onSelect?.(null)}
      style={{ containerType: 'inline-size', position: 'relative', width: '100%', maxWidth: 860, aspectRatio: doc.type === 'check' ? '2.3 / 1' : '1 / 1.4142', margin: '0 auto', background: 'var(--paper)', color: 'var(--paper-ink)', boxShadow: 'var(--shadow-paper)', border: '1px solid var(--paper-line)', borderRadius: 2, overflow: 'hidden', fontFamily: 'var(--f-paper)', userSelect: editable ? 'none' : undefined }}
    >
      <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 20% 0%, rgba(255,255,255,0.45), transparent 50%), radial-gradient(ellipse at 100% 100%, rgba(120,90,30,0.08), transparent 55%)' }} />
      <div aria-hidden style={{ position: 'absolute', left: '50%', top: '52%', width: '46%', transform: 'translate(-50%, -50%) rotate(-24deg)', opacity: 0.055, filter: 'grayscale(1)' }}>
        <Crest size={400} style={{ width: '100%', height: 'auto' }} />
      </div>
      <div aria-hidden style={{ position: 'absolute', inset: '2.2cqw', border: '1px solid var(--paper-line)' }} />
      <div aria-hidden style={{ position: 'absolute', inset: '2.7cqw', border: '0.5px solid var(--paper-line)' }} />
      {doc.type === 'check' ? (
        <CheckFace doc={doc} />
      ) : (
        <div style={{ position: 'absolute', inset: '5cqw 6cqw 4cqw', display: 'flex', flexDirection: 'column', gap: '1.6cqw', fontSize: '1.55cqw', lineHeight: 1.45 }}>
          {/* letterhead */}
          <header style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '2cqw', alignItems: 'center', borderBottom: '0.25cqw double var(--paper-line)', paddingBottom: '1.4cqw' }}>
            <Crest size={64} style={{ width: '7.5cqw', height: 'auto' }} />
            <div>
              <div style={{ fontFamily: 'var(--f-engraved)', fontWeight: 700, letterSpacing: '0.18em', fontSize: '2.1cqw' }}>{t('app.bank').toUpperCase()}</div>
              <div style={{ fontSize: '1.25cqw', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--paper-ink-2)' }}>{tx(`dept.${dept}`)} · {STATE.capital}</div>
              <div style={{ fontSize: '1.1cqw', color: 'var(--paper-ink-2)', fontStyle: 'italic' }}>{t('app.state')}</div>
            </div>
            <div style={{ textAlign: 'right', fontSize: '1.1cqw', fontFamily: 'var(--f-mono)', color: 'var(--paper-ink-2)', lineHeight: 1.5 }}>
              <div>{doc.registryNo}</div>
              <div>{doc.archiveCode}</div>
              {doc.caseNo && <div>{doc.caseNo}</div>}
              <div style={{ marginTop: '0.4cqw', display: 'inline-block', border: '1px solid currentColor', padding: '0 0.6cqw', letterSpacing: '0.12em', fontWeight: 600, color: doc.classification === 'public' ? 'var(--paper-ink-2)' : '#8d1f2c' }}>{tx(`classification.${doc.classification}`).toUpperCase()}</div>
            </div>
          </header>
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ fontFamily: 'var(--f-display)', fontSize: '3.4cqw', fontWeight: 700, letterSpacing: '0.02em', color: 'var(--paper-ink)' }}>{doc.title}</h2>
            <div style={{ fontFamily: 'var(--f-mono)', fontSize: '1.3cqw', color: 'var(--paper-ink-2)' }}>№ {doc.number} · {dateLabel}</div>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <DocBody doc={doc} />
          </div>
          {/* footer */}
          <footer style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'end', gap: '2cqw', borderTop: '0.15cqw solid var(--paper-line)', paddingTop: '1cqw', fontSize: '1.05cqw', color: 'var(--paper-ink-2)' }}>
            <div style={{ paddingLeft: '13cqw' }}>
              <div>{t('docs.paper.verifyAt')} · <strong style={{ fontFamily: 'var(--f-mono)', color: 'var(--paper-ink)' }}>{doc.verificationCode}</strong></div>
              <div>{t('docs.paper.issuedBy', { name: doc.authorName })} · {t('common.versionN', { n: doc.version })} · {t('docs.paper.folio', { page: 1, pages: 1 })}</div>
              <div style={{ fontStyle: 'italic' }}>{t('app.demoNotice')}</div>
            </div>
            <div style={{ width: '20cqw' }}><Barcode value={doc.number} height={28} /></div>
          </footer>
        </div>
      )}
      {doc.elements.map(renderEl)}
      {doc.status === 'cancelled' && <Stamp text={tx('status.document.cancelled')} />}
      {doc.status === 'expired' && <Stamp text={tx('status.document.expired')} />}
      {doc.status === 'draft' && <Stamp text={tx('status.document.draft')} faint />}
      <span className="sr-only">{lang}</span>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function handle(left: number | string, top: number | string, cursor: string, round = false): CSSProperties {
  return {
    position: 'absolute', left, top, width: 14, height: 14, marginLeft: -7, marginTop: -7, background: 'var(--accent-2)', border: '2px solid #fff',
    borderRadius: round ? '50%' : 3, cursor, boxShadow: '0 1px 3px rgba(0,0,0,0.4)', touchAction: 'none',
  };
}

function Stamp({ text, faint }: { text: string; faint?: boolean }) {
  return (
    <div aria-hidden style={{ position: 'absolute', left: '50%', top: '42%', transform: 'translate(-50%, -50%) rotate(-18deg)', border: '0.6cqw solid #a3192b', color: '#a3192b', padding: '0.6cqw 3cqw', fontFamily: 'var(--f-engraved)', fontWeight: 700, fontSize: '7cqw', letterSpacing: '0.2em', opacity: faint ? 0.18 : 0.45, mixBlendMode: 'multiply', pointerEvents: 'none' }}>
      {text.toUpperCase()}
    </div>
  );
}

function PaperTable({ head, rows, align }: { head: string[]; rows: ReactNode[][]; align?: ('l' | 'r')[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '1.3cqw' }}>
      <thead>
        <tr>{head.map((h, i) => <th key={i} style={{ textAlign: align?.[i] === 'r' ? 'right' : 'left', borderBottom: '0.15cqw solid var(--paper-ink-2)', padding: '0.4cqw 0.6cqw', fontFamily: 'var(--f-engraved)', fontSize: '1.05cqw', letterSpacing: '0.08em' }}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => <td key={j} style={{ textAlign: align?.[j] === 'r' ? 'right' : 'left', borderBottom: '0.08cqw solid var(--paper-line)', padding: '0.35cqw 0.6cqw', fontFamily: align?.[j] === 'r' ? 'var(--f-mono)' : undefined, whiteSpace: align?.[j] === 'r' ? 'nowrap' : undefined }}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

function KVPaper({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(18cqw, auto) 1fr', gap: '0.5cqw 2cqw', margin: 0, fontSize: '1.45cqw' }}>
      {rows.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt style={{ color: 'var(--paper-ink-2)', fontVariant: 'small-caps', letterSpacing: '0.04em' }}>{k}</dt>
          <dd style={{ margin: 0, borderBottom: '0.08cqw dotted var(--paper-line)' }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function party(p: unknown): string {
  const x = p as PartyInfo | undefined;
  if (!x) return '';
  return [x.name, x.accountNumber, x.bank].filter(Boolean).join(' · ');
}

function DocBody({ doc }: { doc: BankDocument }) {
  const { t, tx, lang } = useT();
  const f = useFmt();
  const d = doc.data as Data;
  const money = (k: string, c = 'currency') => (d[k] !== undefined && d[c] ? f.money(n(d[k]), s(d[c])) : '');
  const paras = doc.body.map((p, i) => <p key={i} style={{ textAlign: 'justify', textIndent: '3cqw', marginBottom: '0.8cqw' }}>{p}</p>);
  const words = (minor: number, ccy: string) => <div style={{ fontStyle: 'italic', fontSize: '1.3cqw', borderTop: '0.08cqw dotted var(--paper-line)', borderBottom: '0.08cqw dotted var(--paper-line)', padding: '0.4cqw 0' }}>{t('docs.paper.inWords')}: {amountInWords(minor, ccy, lang)}</div>;

  switch (doc.type) {
    case 'receipt': {
      if (d.kind === 'teller') {
        return <div style={{ display: 'grid', gap: '1.4cqw' }}><KVPaper rows={[[t('common.holder'), s(d.client)], [t('common.clientId'), s(d.clientId)], [t('docs.paper.issuedByTeller'), s(d.issuedBy)], [t('common.amount'), d.amount !== undefined && d.currency ? f.money(n(d.amount), s(d.currency)) : '']]} />{paras}</div>;
      }
      const fx = d.fx as Data | undefined;
      return (
        <div style={{ display: 'grid', gap: '1.4cqw' }}>
          <KVPaper rows={[
            [t('docs.paper.operation'), tx(`txType.${s(d.txType)}`)],
            [t('common.reference'), <span style={{ fontFamily: 'var(--f-mono)' }}>{s(d.ref)}</span>],
            [t('common.txId'), <span style={{ fontFamily: 'var(--f-mono)' }}>{s(d.txId)}</span>],
            [t('docs.paper.completedAt'), f.dateTime(s(d.completedAt))],
            [t('common.sender'), party(d.sender)],
            [t('common.recipient'), party(d.recipient)],
            [t('common.description'), s(d.description)],
            [t('common.purpose'), s(d.purpose)],
            [t('common.channel'), tx(`channel.${s(d.channel)}`)],
          ]} />
          <PaperTable head={[t('docs.paper.item'), t('common.amount')]} align={['l', 'r']} rows={[
            [t('docs.paper.principal'), money('amount')],
            ...(n(d.fee) ? [[t('common.fee'), f.money(n(d.fee), s(d.feeCurrency || d.currency))]] : []),
            ...(fx ? [[t('docs.paper.fxRate', { from: s(fx.sourceCurrency), to: s(fx.targetCurrency) }), n(fx.bankRate).toFixed(6)], [t('docs.paper.credited'), f.money(n(fx.targetAmount), s(fx.targetCurrency))]] : []),
            [<strong>{t('common.total')}</strong>, <strong>{f.money(n(d.amount) + (s(d.feeCurrency || d.currency) === s(d.currency) ? n(d.fee) : 0), s(d.currency))}</strong>],
          ]} />
          {words(n(d.amount), s(d.currency))}
        </div>
      );
    }
    case 'statement': {
      const lines = (d.lines as Data[] | undefined) ?? [];
      const shown = lines.slice(-18);
      return (
        <div style={{ display: 'grid', gap: '1.2cqw' }}>
          <KVPaper rows={[[t('common.holder'), s(d.holder)], [t('common.account'), `${s(d.name)} · ${s(d.number)}`], [t('common.currency'), s(d.currency)], [t('common.period'), `${f.date(s(d.from))} — ${f.date(s(d.to))}`]]} />
          <PaperTable head={[t('common.date'), t('common.reference'), t('common.description'), t('docs.paper.debit'), t('docs.paper.credit'), t('common.balance')]} align={['l', 'l', 'l', 'r', 'r', 'r']} rows={[
            [f.date(s(d.from)), '', <em>{t('docs.paper.opening')}</em>, '', '', f.money(n(d.opening), s(d.currency))],
            ...shown.map((l) => [f.date(s(l.at)), <span style={{ fontFamily: 'var(--f-mono)', fontSize: '1.05cqw' }}>{s(l.ref)}</span>, s(l.memo), n(l.debit) ? f.money(n(l.debit), s(d.currency)) : '', n(l.credit) ? f.money(n(l.credit), s(d.currency)) : '', f.money(n(l.balance), s(d.currency))]),
            [f.date(s(d.to)), '', <strong>{t('docs.paper.closing')}</strong>, f.money(n((d.totals as Data)?.debit), s(d.currency)), f.money(n((d.totals as Data)?.credit), s(d.currency)), <strong>{f.money(n(d.closing), s(d.currency))}</strong>],
          ]} />
          {lines.length > shown.length && <div style={{ fontSize: '1.1cqw', fontStyle: 'italic' }}>{t('docs.paper.moreLines', { n: lines.length - shown.length })}</div>}
        </div>
      );
    }
    case 'invoice': {
      const items = (d.items as Data[] | undefined) ?? [];
      const ccy = s(d.currency);
      return (
        <div style={{ display: 'grid', gap: '1.2cqw' }}>
          <KVPaper rows={[[t('invoices.issuer'), s(d.issuer)], [t('invoices.billTo'), s(d.recipient)], [t('common.due'), f.date(s(d.dueDate))], [t('invoices.paymentLink'), s(d.linkCode)]]} />
          <PaperTable head={[t('common.item'), t('common.quantity'), t('common.unitPrice'), t('common.discount'), t('common.tax'), t('common.total')]} align={['l', 'r', 'r', 'r', 'r', 'r']} rows={items.map((it) => {
            const line = Math.round(n(it.quantity) * n(it.price));
            const disc = Math.round((line * n(it.discount)) / 100);
            const tax = Math.round(((line - disc) * n(it.taxRate)) / 100);
            return [s(it.description), n(it.quantity), f.money(n(it.price), ccy), `${n(it.discount)}%`, `${n(it.taxRate)}%`, f.money(line - disc + tax, ccy)];
          })} />
          <div style={{ justifySelf: 'end', minWidth: '40%' }}>
            <KVPaper rows={[[t('common.subtotal'), f.money(n(d.subtotal), ccy)], [t('common.discount'), f.money(-n(d.discount), ccy)], [t('common.tax'), f.money(n(d.tax), ccy)], [t('common.total'), <strong>{f.money(n(d.total), ccy)}</strong>]]} />
          </div>
          {words(n(d.total), ccy)}
          {s(d.notes) && <p style={{ fontStyle: 'italic' }}>{s(d.notes)}</p>}
        </div>
      );
    }
    case 'deposit_certificate':
      return (
        <div style={{ display: 'grid', gap: '1.4cqw' }}>
          <p style={{ textAlign: 'justify' }}>{t('docs.paper.depositCertify', { holder: s(d.holder), number: s(d.number) })}</p>
          <KVPaper rows={[[t('common.amount'), money('principal')], [t('docs.paper.product'), tx(`depositProduct.${s(d.product)}`)], [t('common.rate'), `${n(d.rate)}% ${t('common.perAnnum')}`], [t('common.term'), t('common.months', { n: n(d.termMonths) })], [t('docs.paper.opened'), f.dateLong(s(d.openedAt))], [t('docs.paper.maturity'), f.dateLong(s(d.maturityDate))], [t('docs.paper.projected'), money('projected')]]} />
          {words(n(d.principal), s(d.currency))}
        </div>
      );
    case 'loan_agreement':
      return (
        <div style={{ display: 'grid', gap: '1.1cqw' }}>
          <KVPaper rows={[[t('docs.paper.borrower'), `${s(d.borrower)} (${s(d.clientId)})`], [t('docs.paper.product'), tx(`loanType.${s(d.loanType)}`)], [t('docs.paper.principal'), money('amount')], [t('common.rate'), `${n(d.rate)}% ${t('common.perAnnum')}`], [t('common.term'), t('common.months', { n: n(d.termMonths) })], [t('loans.monthlyPayment'), money('payment')], [t('common.purpose'), s(d.purpose)], [t('loans.collateral'), s(d.collateral)]]} />
          {words(n(d.amount), s(d.currency))}
          {paras}
        </div>
      );
    case 'check':
      return null;
    case 'certificate': {
      const kind = s(d.kind);
      const key = kind === 'account_opening' ? 'docs.paper.certOpen' : kind === 'account_closure' ? 'docs.paper.certClose' : kind === 'balance_confirmation' ? 'docs.paper.certBalance' : 'docs.paper.certHolding';
      const balances = (d.balances as Data[] | undefined) ?? [];
      return (
        <div style={{ display: 'grid', gap: '1.4cqw' }}>
          <p style={{ textAlign: 'justify', fontSize: '1.7cqw' }}>{tx(key, { holder: s(d.holder), number: s(d.number), type: tx(`accountType.${s(d.accountType)}`), ccy: s(d.currency), date: f.dateLong(s(d.closedAt || d.issuedAt || doc.createdAt)), recipient: s(d.recipient) || t('docs.paper.whomConcern') })}</p>
          {balances.length > 0 && <PaperTable head={[t('common.currency'), t('common.balance'), t('common.available')]} align={['l', 'r', 'r']} rows={balances.map((b) => [s(b.currency), f.money(n(b.balance), s(b.currency)), f.money(n(b.available), s(b.currency))])} />}
          {paras}
        </div>
      );
    }
    default: {
      const skip = new Set(['kind', 'lines', 'items', 'records', 'income', 'balances', 'fx', 'sender', 'recipientInfo']);
      const rows: [string, ReactNode][] = Object.entries(d)
        .filter(([k, v]) => !skip.has(k) && v !== undefined && v !== null && typeof v !== 'object')
        .slice(0, 16)
        .map(([k, v]) => [tx(`docs.field.${k}`, undefined, k), typeof v === 'number' && ['amount', 'principal', 'coverage', 'premium', 'total'].includes(k) && d.currency ? f.money(v, s(d.currency)) : /At$|Date$/.test(k) && typeof v === 'string' ? f.dateLong(v) : s(v)]);
      const records = (d.records as Data[] | undefined) ?? [];
      return (
        <div style={{ display: 'grid', gap: '1.3cqw' }}>
          {rows.length > 0 && <KVPaper rows={rows} />}
          {records.length > 0 && <PaperTable head={[t('common.number'), t('common.type'), t('common.amount'), t('common.status')]} align={['l', 'l', 'r', 'l']} rows={records.map((r) => [s(r.number), s(r.kind), f.money(n(r.amount), s(r.currency)), s(r.status)])} />}
          {paras}
          {doc.type === 'memo' && <div style={{ fontStyle: 'italic', fontSize: '1.2cqw' }}>{t('docs.paper.memoFooter')}</div>}
        </div>
      );
    }
  }
}

/** Landscape check face with guilloché, MICR line and amount in words. */
function CheckFace({ doc }: { doc: BankDocument }) {
  const { t, lang } = useT();
  const f = useFmt();
  const d = doc.data as Data;
  const ccy = s(d.currency);
  return (
    <div style={{ position: 'absolute', inset: '4cqw 4.5cqw 3cqw', display: 'grid', gridTemplateRows: 'auto auto 1fr auto', gap: '1.4cqw', fontSize: '1.6cqw' }}>
      <div aria-hidden style={{ position: 'absolute', inset: '-2cqw', background: 'repeating-linear-gradient(135deg, rgba(31,63,149,0.05) 0 2px, transparent 2px 7px), repeating-linear-gradient(45deg, rgba(19,104,74,0.05) 0 2px, transparent 2px 9px)' }} />
      <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '1.6cqw', alignItems: 'center' }}>
        <Crest size={48} style={{ width: '5.5cqw', height: 'auto' }} />
        <div>
          <div style={{ fontFamily: 'var(--f-engraved)', fontWeight: 700, letterSpacing: '0.16em', fontSize: '1.9cqw' }}>{t('app.bank').toUpperCase()}</div>
          <div style={{ fontSize: '1.15cqw', color: 'var(--paper-ink-2)' }}>{s(d.kind) === 'cashier' ? t('checks.cashierCheck') : t('checks.personalCheck')} · {t('app.network')}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: '1.8cqw' }}>№ {s(d.number)}</div>
          <div style={{ fontSize: '1.3cqw' }}>{f.dateLong(s(d.date))}</div>
        </div>
      </div>
      <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1fr auto', gap: '2cqw', alignItems: 'end' }}>
        <div>
          <div style={{ fontSize: '1.1cqw', color: 'var(--paper-ink-2)', letterSpacing: '0.1em' }}>{t('checks.payToOrder').toUpperCase()}</div>
          <div style={{ fontFamily: 'var(--f-script)', fontSize: '3.6cqw', borderBottom: '0.1cqw solid var(--paper-ink-2)', lineHeight: 1.1 }}>{s(d.payee)}</div>
        </div>
        <div style={{ border: '0.2cqw solid var(--paper-ink)', padding: '0.6cqw 1.4cqw', fontFamily: 'var(--f-mono)', fontSize: '2.6cqw', fontWeight: 600, background: 'rgba(255,255,255,0.5)' }}>{f.money(n(d.amount), ccy)}</div>
      </div>
      <div style={{ position: 'relative' }}>
        <div style={{ fontStyle: 'italic', fontSize: '1.7cqw', borderBottom: '0.1cqw solid var(--paper-ink-2)', paddingBottom: '0.4cqw' }}>{amountInWords(n(d.amount), ccy, lang)}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2cqw', marginTop: '1cqw', fontSize: '1.25cqw' }}>
          <div>
            <div style={{ color: 'var(--paper-ink-2)' }}>{t('common.purpose')}: {s(d.purpose)}</div>
            <div style={{ color: 'var(--paper-ink-2)' }}>{t('common.issuer')}: {s(d.issuer)} · {s(d.accountNumber)}</div>
            <div style={{ color: 'var(--paper-ink-2)' }}>{t('common.verificationCode')}: <strong style={{ fontFamily: 'var(--f-mono)', color: 'var(--paper-ink)' }}>{doc.verificationCode}</strong></div>
          </div>
          <div style={{ alignSelf: 'end', borderTop: '0.1cqw solid var(--paper-ink-2)', textAlign: 'center', color: 'var(--paper-ink-2)', paddingTop: '0.3cqw' }}>{t('checks.authorizedSignature')}</div>
        </div>
      </div>
      <div style={{ position: 'relative', fontFamily: 'var(--f-mono)', fontSize: '1.9cqw', letterSpacing: '0.3em', color: 'var(--paper-ink)' }}>
        ⑆{s(d.number)}⑆ {s(d.accountNumber).replace(/\s/g, '').slice(-12)}⑈ {doc.verificationCode.replace(/-/g, '')}
      </div>
    </div>
  );
}
