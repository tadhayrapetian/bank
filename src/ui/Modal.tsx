/** Accessible modal dialog (focus trap, Escape, scroll lock) and an in-app confirmation dialog. */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { X } from 'lucide-react';
import { Button } from './primitives';
import { useT } from '@/hooks/useT';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, eyebrow, children, footer, size, labelledBy }: {
  open: boolean; onClose: () => void; title: ReactNode; eyebrow?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'wide' | 'xwide'; labelledBy?: string;
}) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
        if (!items.length) return;
        const a = items[0], b = items[items.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
        else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`modal${size ? ' ' + size : ''}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? id}>
        <div className="modal-head">
          <div className="grow">
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <h2 className="modal-title" id={id}>{title}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.close')}><X /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmReq {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (v: boolean) => void;
}

const useConfirmStore = create<{ req: ConfirmReq | null; set: (r: ConfirmReq | null) => void }>((set) => ({ req: null, set: (req) => set({ req }) }));

/** Promise-based confirmation rendered inside the app (no window.confirm). */
export function confirmAction(opts: Omit<ConfirmReq, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => useConfirmStore.getState().set({ ...opts, resolve }));
}

export function ConfirmHost() {
  const { t } = useT();
  const req = useConfirmStore((s) => s.req);
  const set = useConfirmStore((s) => s.set);
  const done = (v: boolean) => {
    req?.resolve(v);
    set(null);
  };
  return (
    <Modal
      open={!!req}
      onClose={() => done(false)}
      title={req?.title ?? ''}
      footer={
        <>
          <Button onClick={() => done(false)}>{t('common.cancel')}</Button>
          <Button variant={req?.danger ? 'danger' : 'primary'} onClick={() => done(true)} data-autofocus>{req?.confirmLabel ?? t('common.confirm')}</Button>
        </>
      }
    >
      {req?.body && <div className="ink2">{req.body}</div>}
    </Modal>
  );
}
