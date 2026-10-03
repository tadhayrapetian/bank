/** App shell: sidebar rail, top bar, content outlet and phone tab bar. */
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, Menu, Search, Sun, Moon, Volume2, VolumeX, LogOut, UserCog, Shield, Settings, Users, LayoutDashboard, ArrowLeftRight, CreditCard, FolderOpen, Eye, EyeOff, Check } from 'lucide-react';
import { NAV } from './nav';
import { useT, useFmt } from '@/hooks/useT';
import { useLive, useNow } from '@/hooks/data';
import { useUI } from '@/state/ui';
import { useSession } from '@/state/session';
import { db } from '@/core/db/db';
import { clock } from '@/core/clock';
import { Crest, RuneSigil } from '@/ui/heraldry';
import { Avatar, IconButton } from '@/ui/primitives';
import { LANGUAGES } from '@/i18n';
import { MAJOR_CODES } from '@/core/currency/registry';
import { logout, switchIdentity, updatePreferences } from '@/core/security/auth';
import { primaryRole } from '@/core/context';
import { play } from '@/ui/sound';
import type { Lang, ThemeId } from '@/core/types';

const THEMES: ThemeId[] = ['ministry', 'classic', 'night', 'modern'];

function useBadges(userId: string | undefined, perms: Set<string>) {
  return useLive(
    async () => {
      if (!userId) return {} as Record<string, number>;
      const [notifications, mail, tickets, requests, approvals, fraud] = await Promise.all([
        db.notifications.where('[userId+read]').equals([userId, 0]).count(),
        db.mail.where('userId').equals(userId).filter((m) => !m.read && m.folder === 'inbox').count(),
        db.tickets.where('userId').equals(userId).filter((t) => !!t.unreadClient).count(),
        db.requests.where('payerId').equals(userId).filter((r) => r.status === 'pending').count(),
        (async () => {
          const cs = await db.companies.where('memberIds').equals(userId).toArray();
          if (!cs.length) return 0;
          const ids = new Set(cs.map((c) => c.id));
          return db.approvals.filter((a) => ids.has(a.companyId) && (a.status === 'pending_manager' || a.status === 'pending_accountant') && a.createdBy !== userId).count();
        })(),
        perms.has('fraud.review') ? db.fraud.where('status').equals('open').count() : Promise.resolve(0),
      ]);
      return { notifications, mail, messages: tickets, requests, approvals, fraud } as Record<string, number>;
    },
    [userId, perms.size],
    {},
  );
}

export function Layout() {
  const { t, tx } = useT();
  const loc = useLocation();
  const user = useSession((s) => s.user);
  const perms = useSession((s) => s.perms);
  const ui = useUI();
  const badges = useBadges(user?.id, perms as Set<string>);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    ui.setSidebar(false);
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname]);

  return (
    <div className="app">
      <a href="#main" className="skip-link" onClick={(e) => { e.preventDefault(); mainRef.current?.focus(); }}>{t('app.skip')}</a>
      {ui.sidebarOpen && <div className="scrim" onClick={() => ui.setSidebar(false)} aria-hidden />}
      <aside className={`sidebar${ui.sidebarOpen ? ' open' : ''}`} aria-label={t('nav.menu')}>
        <NavLink to="/" className="brand" end>
          <Crest className="brand-crest" size={42} />
          <div>
            <div className="brand-name">{t('app.name').toUpperCase()}</div>
            <div className="brand-sub">{t('app.bank')}</div>
          </div>
        </NavLink>
        <nav className="nav">
          {NAV.map((g) => {
            const items = g.items.filter((i) => !i.perm || perms.has(i.perm));
            if (!items.length) return null;
            return (
              <div key={g.label} role="group" aria-label={t(g.label)}>
                <div className="nav-group-label">{t(g.label)}</div>
                {items.map((i) => {
                  const Icon = i.icon;
                  const count = i.badge ? badges[i.badge] : 0;
                  return (
                    <NavLink key={i.path} to={i.path} end={i.path === '/'} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                      <Icon size={17} />
                      <span>{t(i.label)}</span>
                      {count ? <span className="count" aria-label={String(count)}>{count}</span> : null}
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="row" style={{ gap: 8, color: 'var(--side-accent)' }}>
            <RuneSigil size={28} />
            <span style={{ fontFamily: 'var(--f-engraved)', letterSpacing: '0.16em' }}>{t('app.motto')}</span>
          </div>
          <div>{t('app.demoNotice')}</div>
        </div>
      </aside>
      <div className="main">
        <Topbar badges={badges} />
        <main id="main" ref={mainRef} tabIndex={-1} style={{ outline: 'none' }}>
          <Outlet />
        </main>
        <nav className="tabbar" aria-label={t('nav.menu')}>
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}><LayoutDashboard />{t('nav.home')}</NavLink>
          <NavLink to="/payments" className={({ isActive }) => (isActive ? 'active' : '')}><ArrowLeftRight />{t('nav.pay')}</NavLink>
          <NavLink to="/cards" className={({ isActive }) => (isActive ? 'active' : '')}><CreditCard />{t('nav.cards')}</NavLink>
          <NavLink to="/documents" className={({ isActive }) => (isActive ? 'active' : '')}><FolderOpen />{t('nav.documents')}</NavLink>
          <button type="button" onClick={() => ui.setSidebar(true)}><Menu />{t('nav.more')}</button>
        </nav>
      </div>
      <span className="sr-only" aria-live="polite">{tx(`theme.${ui.theme}`)}</span>
    </div>
  );
}

function Chronometer() {
  const { t } = useT();
  const f = useFmt();
  const now = useNow(1000);
  const offsetDays = Math.round(clock.getOffset() / 86_400_000);
  return (
    <div className="chronometer" title={t('shell.chronometerHint')}>
      <span>{t('shell.bankTime')}{offsetDays ? ` · +${offsetDays}d` : ''}</span>
      <strong>{f.date(new Date(now).toISOString())} {new Date(now).toISOString().slice(11, 19)} UTC</strong>
    </div>
  );
}

function Topbar({ badges }: { badges: Record<string, number> }) {
  const { t, tx } = useT();
  const ui = useUI();
  const user = useSession((s) => s.user);
  const setUser = useSession((s) => s.setUser);
  const nav = useNavigate();
  const [menu, setMenu] = useState<null | 'user' | 'prefs'>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const identities = useLive(() => db.users.toArray().then((us) => us.filter((u) => u.kind === 'staff' || ['USR-AURELIA', 'USR-MIRELA', 'USR-IMOGEN', 'USR-BARNABY', 'USR-CORVIN', 'USR-TATEV', 'USR-CASPIAN'].includes(u.id))), [], []);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [menu]);

  const setLang = (l: Lang) => { ui.setLang(l); void updatePreferences({ language: l }); };
  const setTheme = (th: ThemeId) => { ui.setTheme(th); void updatePreferences({ theme: th }); };
  const setBase = (c: string) => { ui.setBaseCurrency(c); void updatePreferences({ baseCurrency: c }); };

  return (
    <header className="topbar">
      <IconButton label={t('nav.menu')} className="icon-btn mobile-only" onClick={() => ui.setSidebar(true)}><Menu /></IconButton>
      <button type="button" className="search-trigger" onClick={() => ui.openPalette('search')} aria-label={t('shell.searchLabel')}>
        <Search size={16} aria-hidden />
        <span className="truncate">{t('shell.searchPlaceholder')}</span>
        <span className="kbd desktop-only">Ctrl K</span>
      </button>
      <div className="topbar-actions">
        <Chronometer />
        <label className="sr-only" htmlFor="base-ccy">{t('common.baseCurrency')}</label>
        <select id="base-ccy" className="select desktop-only" style={{ width: 92, height: 34 }} value={ui.baseCurrency} onChange={(e) => setBase(e.target.value)} title={t('common.baseCurrency')}>
          {MAJOR_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <IconButton label={ui.balancesHidden ? t('shell.showBalances') : t('shell.hideBalances')} onClick={ui.toggleBalances}>{ui.balancesHidden ? <EyeOff /> : <Eye />}</IconButton>
        <IconButton label={ui.sound ? t('common.soundOff') : t('common.soundOn')} onClick={() => { ui.setSound(!ui.sound); if (!ui.sound) setTimeout(() => play('notify'), 50); }} aria-pressed={ui.sound}>{ui.sound ? <Volume2 /> : <VolumeX />}</IconButton>
        <div className="menu-wrap" ref={menu === 'prefs' ? menuRef : undefined}>
          <IconButton label={t('shell.appearance')} onClick={() => setMenu(menu === 'prefs' ? null : 'prefs')} aria-expanded={menu === 'prefs'} aria-haspopup="menu">{ui.theme === 'classic' || ui.theme === 'modern' ? <Sun /> : <Moon />}</IconButton>
          {menu === 'prefs' && (
            <div className="menu" role="menu">
              <div className="menu-label">{t('common.theme')}</div>
              {THEMES.map((th) => (
                <button key={th} role="menuitemradio" aria-checked={ui.theme === th} onClick={() => setTheme(th)}>
                  {ui.theme === th ? <Check /> : <span style={{ width: 16 }} />}{tx(`theme.${th}`)}
                </button>
              ))}
              <hr />
              <div className="menu-label">{t('common.language')}</div>
              {LANGUAGES.map((l) => (
                <button key={l.code} role="menuitemradio" aria-checked={ui.lang === l.code} onClick={() => setLang(l.code)} lang={l.code}>
                  {ui.lang === l.code ? <Check /> : <span style={{ width: 16 }} />}{l.nativeName}
                </button>
              ))}
              <hr />
              <div className="menu-label">{t('common.baseCurrency')}</div>
              <div style={{ padding: '4px 8px' }}>
                <select className="select" value={ui.baseCurrency} onChange={(e) => setBase(e.target.value)} aria-label={t('common.baseCurrency')}>
                  {MAJOR_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>
        <IconButton label={t('nav.notifications')} badge={badges.notifications} onClick={() => nav('/notifications')}><Bell /></IconButton>
        <div className="menu-wrap" ref={menu === 'user' ? menuRef : undefined}>
          <button type="button" className="icon-btn" style={{ width: 'auto', padding: '0 4px', gap: 8 }} onClick={() => setMenu(menu === 'user' ? null : 'user')} aria-expanded={menu === 'user'} aria-haspopup="menu" aria-label={t('shell.userMenu')}>
            <Avatar name={user?.name ?? '?'} hue={user?.avatarHue} />
          </button>
          {menu === 'user' && user && (
            <div className="menu" role="menu" style={{ minWidth: 270 }}>
              <div style={{ padding: '8px 10px' }}>
                <div style={{ fontWeight: 600 }}>{user.name}</div>
                <div className="xsmall muted">{user.clientId} · {tx(`role.${primaryRole(user.roles)}`)}</div>
              </div>
              <hr />
              <button role="menuitem" onClick={() => { setMenu(null); nav('/profile'); }}><UserCog />{t('nav.profile')}</button>
              <button role="menuitem" onClick={() => { setMenu(null); nav('/security'); }}><Shield />{t('nav.security')}</button>
              <button role="menuitem" onClick={() => { setMenu(null); nav('/settings'); }}><Settings />{t('nav.settings')}</button>
              <hr />
              <div className="menu-label">{t('shell.switchIdentity')}</div>
              <div style={{ maxHeight: 220, overflowY: 'auto', display: 'grid' }}>
                {identities.filter((u) => u.id !== user.id).map((u) => (
                  <button key={u.id} role="menuitem" onClick={async () => { setMenu(null); const nu = await switchIdentity(u.id); setUser(nu); ui.applyPreferences({ lang: ui.lang }); nav('/'); }}>
                    <Users />
                    <span className="grow truncate">{u.name}</span>
                    <span className="xsmall muted">{tx(`role.${primaryRole(u.roles)}`)}</span>
                  </button>
                ))}
              </div>
              <hr />
              <button role="menuitem" onClick={async () => { setMenu(null); await logout(); setUser(null); nav('/'); }}><LogOut />{t('common.signOut')}</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
