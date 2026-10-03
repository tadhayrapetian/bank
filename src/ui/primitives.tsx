/** Design-system primitives. All visible text comes from callers (translated). */
import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Loader2, AlertTriangle, Info, CheckCircle2, XCircle, Sparkles, Inbox } from 'lucide-react';
import { statusDef, type StatusDomain, type Tone } from '@/core/status';
import { useT, useFmt } from '@/hooks/useT';

type BtnVariant = 'default' | 'primary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  loading?: boolean;
  block?: boolean;
  iconOnly?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', icon, loading, block, iconOnly, className = '', children, disabled, type = 'button', ...rest },
  ref,
) {
  const cls = ['btn', variant !== 'default' && `btn-${variant}`, size !== 'md' && `btn-${size}`, block && 'btn-block', iconOnly && 'btn-icon', className].filter(Boolean).join(' ');
  return (
    <button ref={ref} type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Loader2 className="sigil-spin" style={{ animationDuration: '1s' }} aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ label, children, badge, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; badge?: number }) {
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} {...rest}>
      {children}
      {badge ? <span className="dot" aria-hidden>{badge > 99 ? '99+' : badge}</span> : null}
    </button>
  );
}

export function Panel({ title, sub, icon, actions, children, footer, className = '', flush, ornate, paper, id, as = 'section' }: {
  title?: ReactNode; sub?: ReactNode; icon?: ReactNode; actions?: ReactNode; children?: ReactNode; footer?: ReactNode; className?: string;
  flush?: boolean; ornate?: boolean; paper?: boolean; id?: string; as?: 'section' | 'div' | 'article';
}) {
  const Tag = as;
  const headId = useId();
  return (
    <Tag className={['panel', ornate && 'ornate', paper && 'panel-paper', className].filter(Boolean).join(' ')} aria-labelledby={title ? headId : undefined} id={id}>
      {(title || actions) && (
        <header className="panel-head">
          <div className="grow">
            {title && <h2 className="panel-title" id={headId}>{icon}{title}</h2>}
            {sub && <div className="panel-sub">{sub}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      <div className={flush ? 'panel-body flush' : 'panel-body'}>{children}</div>
      {footer && <footer className="panel-foot">{footer}</footer>}
    </Tag>
  );
}

export function PageHead({ eyebrow, title, sub, actions }: { eyebrow?: ReactNode; title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="grow">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Badge({ tone = 'neutral', children, plain, title }: { tone?: Tone; children: ReactNode; plain?: boolean; title?: string }) {
  return <span className={`badge tone-${tone}${plain ? ' plain' : ''}`} title={title}>{children}</span>;
}

export function StatusBadge({ domain, status }: { domain: StatusDomain; status: string }) {
  const { tx } = useT();
  const def = statusDef(domain, status);
  return <Badge tone={def.tone}>{tx(`status.${domain}.${status}`, undefined, status)}</Badge>;
}

export function DemoFlag({ children }: { children?: ReactNode }) {
  const { t } = useT();
  return <span className="demo-flag"><Sparkles size={12} aria-hidden />{children ?? t('common.demoData')}</span>;
}

export function Field({ label, hint, error, required, children, className = '', htmlFor }: {
  label: ReactNode; hint?: ReactNode; error?: ReactNode; required?: boolean; children: ReactNode; className?: string; htmlFor?: string;
}) {
  return (
    <div className={`field ${className}`}>
      <label className="field-label" htmlFor={htmlFor}>{label}{required && <span className="req" aria-hidden>*</span>}</label>
      {children}
      {error ? <div className="field-error" role="alert"><AlertTriangle size={13} aria-hidden />{error}</div> : hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className = '', invalid, ...rest }, ref) {
  return <input ref={ref} className={`input ${className}`} aria-invalid={invalid || undefined} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select({ className = '', invalid, children, ...rest }, ref) {
  return <select ref={ref} className={`select ${className}`} aria-invalid={invalid || undefined} {...rest}>{children}</select>;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className = '', invalid, ...rest }, ref) {
  return <textarea ref={ref} className={`textarea ${className}`} aria-invalid={invalid || undefined} {...rest} />;
});

export function Switch({ checked, onChange, label, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; id?: string }) {
  return (
    <label className="switch" style={disabled ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}>
      <input type="checkbox" role="switch" id={id} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-checked={checked} />
      <span className="switch-track" aria-hidden />
      <span>{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, label }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; count?: number; icon?: ReactNode }[]; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((tb) => (
        <button
          key={tb.value}
          type="button"
          role="tab"
          aria-selected={tb.value === value}
          tabIndex={tb.value === value ? 0 : -1}
          onClick={() => onChange(tb.value)}
          onKeyDown={(e) => {
            const i = tabs.findIndex((x) => x.value === value);
            if (e.key === 'ArrowRight') onChange(tabs[(i + 1) % tabs.length].value);
            if (e.key === 'ArrowLeft') onChange(tabs[(i - 1 + tabs.length) % tabs.length].value);
          }}
        >
          {tb.icon}
          {tb.label}
          {tb.count !== undefined && <span className="count">{tb.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v], i) => (
        <div key={i} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Stat({ label, value, foot, mono }: { label: ReactNode; value: ReactNode; foot?: ReactNode; mono?: boolean }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value tnum${mono ? ' mono' : ''}`}>{value}</div>
      {foot && <div className="stat-foot">{foot}</div>}
    </div>
  );
}

export function Money({ minor, ccy, sign, className = '', mask, tone }: { minor: number; ccy: string; sign?: boolean; className?: string; mask?: boolean; tone?: boolean }) {
  const f = useFmt();
  const toneCls = tone ? (minor > 0 ? ' pos' : minor < 0 ? ' neg' : '') : '';
  return <span className={`tnum nowrap${toneCls} ${className}`}>{f.money(minor, ccy, { sign, mask })}</span>;
}

export function Empty({ title, children, icon, action }: { title: ReactNode; children?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon ?? <Inbox aria-hidden />}
      <div className="empty-title">{title}</div>
      {children && <div className="small">{children}</div>}
      {action}
    </div>
  );
}

export function Alert({ tone = 'info', title, children }: { tone?: Tone; title?: ReactNode; children?: ReactNode }) {
  const Icon = tone === 'negative' ? XCircle : tone === 'warning' ? AlertTriangle : tone === 'positive' ? CheckCircle2 : tone === 'magic' ? Sparkles : Info;
  return (
    <div className={`alert tone-${tone}`} role={tone === 'negative' ? 'alert' : 'status'}>
      <Icon aria-hidden />
      <div className="alert-body">
        {title && <div className="alert-title">{title}</div>}
        {children && <div className="small">{children}</div>}
      </div>
    </div>
  );
}

export function Progress({ value, max = 100, label }: { value: number; max?: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={`progress${value > max ? ' over' : ''}`} role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function CodeTag({ children, title }: { children: ReactNode; title?: string }) {
  return <code className="code-tag" title={title}>{children}</code>;
}

export function Avatar({ name, hue = 140, size }: { name: string; hue?: number; size?: 'lg' }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  return (
    <span className={`avatar${size ? ' ' + size : ''}`} style={{ background: `linear-gradient(140deg, hsl(${hue} 42% 38%), hsl(${(hue + 40) % 360} 45% 24%))` }} aria-hidden>
      {initials}
    </span>
  );
}

export function Rule({ children }: { children?: ReactNode }) {
  return <div className="rule" role="separator">{children}</div>;
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const { t } = useT();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <nav className="pager" aria-label={t('common.page', { page: page + 1, pages })}>
      <span>{t('common.pageOf', { from, to, total })}</span>
      <div className="row">
        <Button size="sm" onClick={() => onPage(page - 1)} disabled={page === 0}>{t('common.previous')}</Button>
        <span className="tnum">{t('common.page', { page: page + 1, pages })}</span>
        <Button size="sm" onClick={() => onPage(page + 1)} disabled={page >= pages - 1}>{t('common.next')}</Button>
      </div>
    </nav>
  );
}
