/** Command palette (Ctrl/⌘+K) with integrated global search ("/"). */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ArrowRight, Landmark, CreditCard, BookOpen, FileText, ScrollText, ReceiptText, ArrowLeftRight, Briefcase, User, Building2, Users, Snowflake, FileSignature, Repeat, Plus, QrCode, Command } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useUI, type ActionName } from '@/state/ui';
import { useSession } from '@/state/session';
import { useT } from '@/hooks/useT';
import { ALL_NAV } from './nav';
import { globalSearch, type SearchHit, type SearchKind } from '@/core/ops/search';

interface Cmd {
  id: string;
  label: string;
  sub?: string;
  icon: ReactNode;
  group: string;
  run: () => void;
}

const KIND_ICON: Record<SearchKind, ReactNode> = {
  user: <User />, account: <Landmark />, card: <CreditCard />, transaction: <BookOpen />, document: <FileText />, check: <ScrollText />,
  invoice: <ReceiptText />, payment: <ArrowLeftRight />, case: <Briefcase />, employee: <Users />, branch: <Building2 />,
};

export function CommandPalette() {
  const { t, tx } = useT();
  const open = useUI((s) => s.paletteOpen);
  const mode = useUI((s) => s.paletteMode);
  const close = useUI((s) => s.closePalette);
  const openAction = useUI((s) => s.openAction);
  const perms = useSession((s) => s.perms);
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      setHits([]);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open, mode]);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    let alive = true;
    const h = setTimeout(() => {
      globalSearch(term).then((r) => alive && setHits(r)).catch(() => alive && setHits([]));
    }, 160);
    return () => {
      alive = false;
      clearTimeout(h);
    };
  }, [q, open]);

  const commands: Cmd[] = useMemo(() => {
    const act = (name: ActionName, params?: Record<string, string>) => () => openAction(name, params);
    const go = (path: string) => () => { close(); nav(path); };
    const actions: Cmd[] = [
      { id: 'transfer', label: t('palette.createTransfer'), icon: <ArrowLeftRight />, group: t('palette.actions'), run: act('transfer') },
      { id: 'openAccount', label: t('palette.openAccount'), icon: <Plus />, group: t('palette.actions'), run: act('openAccount') },
      { id: 'check', label: t('palette.createCheck'), icon: <ScrollText />, group: t('palette.actions'), run: act('check') },
      { id: 'exchange', label: t('palette.exchange'), icon: <Repeat />, group: t('palette.actions'), run: act('exchange') },
      { id: 'freeze', label: t('palette.freezeCard'), icon: <Snowflake />, group: t('palette.actions'), run: go('/cards?action=freeze') },
      { id: 'statement', label: t('palette.statement'), icon: <FileSignature />, group: t('palette.actions'), run: act('document', { kind: 'statement' }) },
      { id: 'searchTx', label: t('palette.searchTransaction'), icon: <Search />, group: t('palette.actions'), run: () => { useUI.getState().openPalette('search'); setQ(''); } },
      { id: 'openDoc', label: t('palette.openDocument'), icon: <FileText />, group: t('palette.actions'), run: go('/documents') },
      { id: 'request', label: t('quick.request'), icon: <ArrowLeftRight />, group: t('palette.actions'), run: act('request') },
      { id: 'scan', label: t('quick.scan'), icon: <QrCode />, group: t('palette.actions'), run: act('scan') },
      { id: 'receive', label: t('quick.receive'), icon: <QrCode />, group: t('palette.actions'), run: act('receive') },
    ];
    const pages: Cmd[] = ALL_NAV.filter((i) => !i.perm || perms.has(i.perm)).map((i) => {
      const Icon = i.icon;
      return { id: 'nav' + i.path, label: t(i.label), sub: i.path, icon: <Icon />, group: t('palette.goTo'), run: go(i.path) };
    });
    return [...actions, ...pages];
  }, [t, openAction, close, nav, perms]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const cmds = term ? commands.filter((c) => c.label.toLowerCase().includes(term) || c.sub?.includes(term)) : mode === 'search' ? [] : commands;
    const results: Cmd[] = hits.map((h) => ({ id: h.kind + h.id, label: h.title, sub: h.subtitle, icon: KIND_ICON[h.kind], group: tx(`search.kind.${h.kind}`), run: () => { close(); nav(h.link); } }));
    return mode === 'search' ? [...results, ...cmds.slice(0, 6)] : [...cmds.slice(0, 30), ...results];
  }, [q, commands, hits, mode, tx, close, nav]);

  useEffect(() => {
    if (sel >= filtered.length) setSel(Math.max(0, filtered.length - 1));
  }, [filtered.length, sel]);

  if (!open) return null;
  let lastGroup = '';
  return createPortal(
    <div className="modal-scrim" style={{ placeItems: 'start center' }} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label={mode === 'search' ? t('shell.searchLabel') : t('palette.title')}>
        <div className="cmdk-input">
          {mode === 'search' ? <Search size={18} aria-hidden /> : <Command size={18} aria-hidden />}
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            placeholder={mode === 'search' ? t('shell.searchPlaceholder') : t('palette.placeholder')}
            aria-label={mode === 'search' ? t('shell.searchLabel') : t('palette.title')}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={filtered[sel] ? `cmdk-${filtered[sel].id}` : undefined}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(filtered.length - 1, s + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); filtered[sel]?.run(); }
              else if (e.key === 'Escape') { e.preventDefault(); close(); }
            }}
          />
          <span className="kbd">Esc</span>
        </div>
        <div className="cmdk-list" id="cmdk-list" role="listbox">
          {filtered.length === 0 && <div className="empty small">{q.trim().length < 2 ? t('palette.hint') : t('common.noResults')}</div>}
          {filtered.map((c, i) => {
            const header = c.group !== lastGroup ? <div className="cmdk-group" key={'g' + c.group + i}>{c.group}</div> : null;
            lastGroup = c.group;
            return (
              <div key={c.id + i}>
                {header}
                <button type="button" id={`cmdk-${c.id}`} role="option" aria-selected={i === sel} className="cmdk-item" onMouseEnter={() => setSel(i)} onClick={c.run}>
                  {c.icon}
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="truncate" style={{ display: 'block' }}>{c.label}</span>
                    {c.sub && <span className="sub truncate" style={{ display: 'block' }}>{c.sub}</span>}
                  </span>
                  {i === sel && <ArrowRight size={14} aria-hidden />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="cmdk-foot">
          <span>↑↓ {t('palette.navigate')}</span>
          <span>↵ {t('palette.run')}</span>
          <span>Ctrl K · / </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
