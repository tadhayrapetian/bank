/** Signature ceremony: electronic, handwritten (signature pad) or official (officers only). */
import { useState } from 'react';
import { PenLine, KeyRound, Landmark, Feather } from 'lucide-react';
import { Modal } from '@/ui/Modal';
import { Alert, Button } from '@/ui/primitives';
import { SignaturePad } from '@/ui/Signature';
import { ErrorPanel } from '@/ui/ErrorPanel';
import { useT } from '@/hooks/useT';
import { useAction } from '@/hooks/useAction';
import { useCan } from '@/state/session';
import type { SignatureKind } from '@/core/types';

export function SignDialog({ title, subject, onClose, onSign, kinds, initial = 'handwritten', note }: {
  title?: string;
  /** What is being signed, e.g. "Check № 00400120". */
  subject?: string;
  onClose: () => void;
  onSign: (kind: SignatureKind, strokes?: string) => Promise<unknown>;
  /** Restrict the available kinds (e.g. a cashier's check needs an official signature). */
  kinds?: SignatureKind[];
  initial?: SignatureKind;
  note?: string;
}) {
  const { t, tx } = useT();
  const official = useCan('documents.official');
  const avail = (kinds ?? (['handwritten', 'electronic', 'official'] as SignatureKind[])).filter((k) => k !== 'official' || official);
  const [kind, setKind] = useState<SignatureKind>(avail.includes(initial) ? initial : avail[0] ?? 'electronic');
  const [strokes, setStrokes] = useState<string | null>(null);
  const { run, busy, error } = useAction();
  const icons: Record<SignatureKind, typeof PenLine> = { handwritten: Feather, electronic: KeyRound, official: Landmark };
  const submit = () => run(async () => {
    await onSign(kind, kind === 'handwritten' ? strokes ?? undefined : undefined);
    onClose();
  }, { success: t('docs.signed'), sound: 'document', silentError: true });
  return (
    <Modal open onClose={onClose} title={title ?? t('docs.signTitle')} eyebrow={subject} size="wide"
      footer={<>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" icon={<PenLine />} loading={busy} disabled={!avail.length || (kind === 'handwritten' && !strokes)} onClick={submit}>{t('docs.sign')}</Button>
      </>}>
      <div className="sign-kinds" role="radiogroup" aria-label={t('docs.signAs')}>
        {(['handwritten', 'electronic', 'official'] as SignatureKind[]).map((k) => {
          const Icon = icons[k];
          const enabled = avail.includes(k);
          return (
            <button key={k} type="button" role="radio" aria-checked={kind === k} disabled={!enabled} className="sign-kind" onClick={() => setKind(k)} title={!enabled ? t('seals.officialHint') : undefined}>
              <Icon aria-hidden />
              <strong>{tx(`docs.sigKind.${k}`)}</strong>
              <span className="xsmall">{tx(`docs.sigKindDesc.${k}`)}</span>
            </button>
          );
        })}
      </div>
      {kind === 'handwritten' && <SignaturePad onChange={setStrokes} height={170} />}
      {kind === 'handwritten' && !strokes && <div className="xsmall muted">{t('docs.drawFirst')}</div>}
      {note && <Alert tone="warning">{note}</Alert>}
      <p className="xsmall muted">{t('docs.signNote')}</p>
      {error ? <ErrorPanel error={error} /> : null}
    </Modal>
  );
}
