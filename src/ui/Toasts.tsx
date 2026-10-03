/** Toast "dispatches" — operation results and live push notifications. */
import { useEffect } from 'react';
import { create } from 'zustand';
import { Bell, CheckCircle2, XCircle, X } from 'lucide-react';
import { useT } from '@/hooks/useT';
import { onPush } from '@/core/comms/notify';
import { useSession } from '@/state/session';
import { play } from './sound';
import { translate } from '@/i18n';
import { useUI } from '@/state/ui';

export interface Toast {
  id: number;
  tone: 'positive' | 'negative' | 'info';
  title: string;
  body?: string;
}

const useToasts = create<{ items: Toast[]; push: (t: Omit<Toast, 'id'>) => void; drop: (id: number) => void }>((set, get) => ({
  items: [],
  push: (t) => {
    const id = Date.now() + Math.random();
    set({ items: [...get().items.slice(-3), { ...t, id }] });
    setTimeout(() => get().drop(id), 6500);
  },
  drop: (id) => set({ items: get().items.filter((x) => x.id !== id) }),
}));

export function toast(t: Omit<Toast, 'id'>) {
  useToasts.getState().push(t);
}

export function ToastHost() {
  const { t } = useT();
  const items = useToasts((s) => s.items);
  const drop = useToasts((s) => s.drop);
  const userId = useSession((s) => s.user?.id);
  useEffect(
    () =>
      onPush((n) => {
        if (n.userId !== userId) return;
        const lang = useUI.getState().lang;
        toast({ tone: 'info', title: translate(lang, n.titleKey, n.params), body: translate(lang, n.bodyKey, n.params) });
        play('notify');
      }),
    [userId],
  );
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {items.map((x) => (
        <div key={x.id} className={`toast tone-${x.tone}`} role={x.tone === 'negative' ? 'alert' : 'status'}>
          <span className="toast-icon">{x.tone === 'positive' ? <CheckCircle2 size={16} /> : x.tone === 'negative' ? <XCircle size={16} /> : <Bell size={16} />}</span>
          <div>
            <div className="toast-title">{x.title}</div>
            {x.body && <div className="toast-body">{x.body}</div>}
          </div>
          <button type="button" className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => drop(x.id)} aria-label={t('common.close')}><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}
