/** Transaction / workflow timeline. */
import { Check, X, Clock, Loader2 } from 'lucide-react';
import { useT, useFmt } from '@/hooks/useT';
import type { TimelineStep } from '@/core/types';

export interface PlannedStep {
  key: string;
  label: string;
  at?: string;
  note?: string;
  actor?: string;
  state: 'ok' | 'fail' | 'current' | 'pending';
}

export function Timeline({ steps }: { steps: PlannedStep[] }) {
  const f = useFmt();
  return (
    <ol className="timeline">
      {steps.map((s, i) => (
        <li key={s.key + i} className={s.state}>
          <span className="node" aria-hidden>
            {s.state === 'ok' ? <Check /> : s.state === 'fail' ? <X /> : s.state === 'current' ? <Loader2 className="sigil-spin" style={{ animationDuration: '1.4s' }} /> : <Clock />}
          </span>
          <div>
            <div className="tl-title">{s.label}</div>
            <div className="tl-meta">
              {s.at ? f.dateTime(s.at) : ''}
              {s.actor ? ` · ${s.actor}` : ''}
              {s.note ? ` · ${s.note}` : ''}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Timeline of a transaction, including not-yet-reached standard steps. */
export function TxTimeline({ steps, status, expected }: { steps: TimelineStep[]; status: string; expected?: string[] }) {
  const { tx } = useT();
  const done = steps.map((s, i) => ({
    key: s.step,
    label: tx(`step.${s.step}`, undefined, s.step),
    at: s.at,
    note: s.note ? tx(`errors.${s.note}.title`, undefined, tx(`step.${s.note}`, undefined, s.note)) : undefined,
    actor: s.actor,
    state: (s.ok ? (i === steps.length - 1 && (status === 'processing' || status === 'pending') ? 'current' : 'ok') : 'fail') as PlannedStep['state'],
  }));
  const seen = new Set(steps.map((s) => s.step));
  const terminal = ['completed', 'failed', 'rejected', 'cancelled', 'expired', 'reversed'].includes(status);
  const rest = terminal ? [] : (expected ?? ['validated', 'processing', 'approved', 'settled', 'completed']).filter((k) => !seen.has(k as TimelineStep['step'])).map((k) => ({ key: k, label: tx(`step.${k}`, undefined, k), state: 'pending' as const }));
  return <Timeline steps={[...done, ...rest]} />;
}
