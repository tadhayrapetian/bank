/** Seal chooser: the registry grouped by kind, official seals locked for non-officers. */
import { useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { Seal } from '@/ui/Seal';
import { Modal } from '@/ui/Modal';
import { Button, Input, Segmented } from '@/ui/primitives';
import { ErrorPanel } from '@/ui/ErrorPanel';
import { useT } from '@/hooks/useT';
import { useAction } from '@/hooks/useAction';
import { useCan } from '@/state/session';
import { SEALS, type SealDef } from '@/core/docs/seals';
import { todayKey } from '@/core/clock';
import { sealName } from './docUi';

type Group = SealDef['group'] | 'all';

export function SealGrid({ value, onChange, groups, compact }: { value: string; onChange: (id: string) => void; groups?: SealDef['group'][]; compact?: boolean }) {
  const { t, tx } = useT();
  const official = useCan('documents.official');
  const [group, setGroup] = useState<Group>('all');
  const [q, setQ] = useState('');
  const list = useMemo(() => SEALS.filter((s) => (!groups || groups.includes(s.group)) && (group === 'all' || s.group === group) && (!q || sealName(tx, s.id).toLowerCase().includes(q.toLowerCase()) || (s.code ?? '').toLowerCase().includes(q.toLowerCase()))), [groups, group, q, tx]);
  const shownGroups = (['department', 'status', 'archive', 'wax', 'arcane'] as SealDef['group'][]).filter((g) => !groups || groups.includes(g));
  return (
    <div className="stack">
      <div className="row-between">
        <Segmented label={t('seals.allGroups')} value={group} onChange={setGroup} options={[{ value: 'all' as Group, label: t('seals.allGroups') }, ...shownGroups.map((g) => ({ value: g as Group, label: tx(`seals.group.${g}`) }))]} />
        <Input aria-label={t('seals.search')} placeholder={t('seals.search')} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 220 }} />
      </div>
      <div className={`seal-pick-grid${compact ? ' compact' : ''}`} role="radiogroup" aria-label={t('seals.bench.seal')}>
        {list.map((s) => {
          const locked = !!s.official && !official;
          return (
            <button key={s.id} type="button" role="radio" aria-checked={value === s.id} disabled={locked} className="seal-pick" onClick={() => onChange(s.id)} title={locked ? t('seals.officialHint') : sealName(tx, s.id)}>
              <span className="seal-pick-img"><Seal sealId={s.id} size="100%" opacity={1} intensity={0.95} seed={7} date={s.dated ? todayKey() : undefined} /></span>
              <span className="seal-pick-name">{sealName(tx, s.id)}</span>
              {locked && <span className="seal-pick-lock"><Lock size={11} aria-hidden />{t('seals.official')}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Pick a seal and run an action with it (e.g. stamp a check). */
export function SealPickerDialog({ title, subject, onClose, onPick, initial = '', groups, note }: {
  title: string; subject?: string; onClose: () => void; onPick: (sealId: string) => Promise<unknown>; initial?: string; groups?: SealDef['group'][]; note?: string;
}) {
  const { t } = useT();
  const [sealId, setSealId] = useState(initial);
  const { run, busy, error } = useAction();
  return (
    <Modal open onClose={onClose} title={title} eyebrow={subject} size="xwide"
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={!sealId} loading={busy} onClick={() => run(async () => { await onPick(sealId); onClose(); }, { sound: 'stamp', silentError: true })}>{t('common.stamp')}</Button></>}>
      {note && <p className="small ink2">{note}</p>}
      <SealGrid value={sealId} onChange={setSealId} groups={groups} compact />
      {error ? <ErrorPanel error={error} /> : null}
    </Modal>
  );
}
