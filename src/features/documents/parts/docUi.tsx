/** Shared pieces of the document pages: signature checks, badges, print/PDF tools, seal labels. */
import { useEffect, useState, type ReactNode } from 'react';
import { Printer, FileDown, ShieldCheck, ShieldX, ShieldQuestion, PenLine } from 'lucide-react';
import { useT } from '@/hooks/useT';
import { useAction } from '@/hooks/useAction';
import { Badge, Button } from '@/ui/primitives';
import { EMBED, exportPdf, printElement } from '@/ui/print';
import { signatureForensics, signatureState, contentHash, type SignatureFinding, type SignatureState } from '@/core/docs/documents';
import { sealById } from '@/core/docs/seals';
import type { BankDocument } from '@/core/types';

export type SigUiState = SignatureState | 'signed';

export interface SigCheck {
  loading: boolean;
  state: SignatureState;
  results: Record<string, boolean>;
  findings: SignatureFinding[];
  hash: string;
}

/** Cryptographic verification of every signature of a document (re-runs whenever the document changes). */
export function useSignatureCheck(doc: BankDocument | null | undefined): SigCheck {
  const [res, setRes] = useState<SigCheck>({ loading: true, state: 'unsigned', results: {}, findings: [], hash: '' });
  const key = doc ? `${doc.id}:${doc.version}:${doc.updatedAt}:${doc.signatures.length}` : '';
  useEffect(() => {
    if (!doc) return;
    let alive = true;
    setRes((r) => ({ ...r, loading: true }));
    (async () => {
      const [{ state, results }, findings] = await Promise.all([signatureState(doc), signatureForensics(doc)]);
      if (alive) setRes({ loading: false, state, results, findings, hash: contentHash(doc) });
    })().catch(() => alive && setRes({ loading: false, state: 'invalid', results: {}, findings: [], hash: '' }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return res;
}

export function SigBadge({ state, count }: { state: SigUiState; count?: number }) {
  const { tx } = useT();
  const tone = state === 'verified' || state === 'signed' ? 'positive' : state === 'invalid' ? 'negative' : 'neutral';
  const Icon = state === 'verified' ? ShieldCheck : state === 'invalid' ? ShieldX : state === 'signed' ? PenLine : ShieldQuestion;
  return (
    <Badge tone={tone} plain>
      <Icon size={12} aria-hidden />
      {tx(`docs.sigState.${state}`)}
      {count && count > 1 ? ` ×${count}` : ''}
    </Badge>
  );
}

export function sealName(tx: (k: string, p?: Record<string, string | number>, f?: string) => string, id: string) {
  const def = sealById(id);
  return tx(`seals.names.${id}`, undefined, def?.center ?? def?.top ?? id);
}

/** Print and PDF export of one paper element (hidden in the embedded preview). */
export function PaperTools({ targetId, filename, size = 'md', extra }: { targetId: string; filename: string; size?: 'sm' | 'md'; extra?: ReactNode }) {
  const { t } = useT();
  const { run, busy } = useAction();
  if (EMBED) return <>{extra}</>;
  const el = () => document.getElementById(targetId);
  return (
    <>
      {extra}
      <Button size={size} icon={<Printer />} onClick={() => printElement(el())}>{t('docs.print')}</Button>
      <Button size={size} icon={<FileDown />} loading={busy} onClick={() => run(() => exportPdf(el(), filename), { success: t('docs.pdfDone'), sound: 'paper' })}>{t('docs.pdf')}</Button>
    </>
  );
}

/** Seal ids impressed on a document, in order of impression. */
export function sealsOn(doc: BankDocument): string[] {
  return doc.elements.filter((e) => e.kind === 'seal').map((e) => String(e.props.sealId));
}

export function shortHash(h: string) {
  return h ? `${h.slice(0, 10)}…${h.slice(-6)}` : '—';
}
