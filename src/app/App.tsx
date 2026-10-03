/** Application root: boot sequence, authentication gate, router and global hosts. */
import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { HashRouter, MemoryRouter, Route, Routes } from 'react-router-dom';
import { boot } from '@/core/boot';
import { getMeta, setMeta } from '@/core/db/db';
import { switchIdentity } from '@/core/security/auth';
import { useUI } from '@/state/ui';
import { useSession } from '@/state/session';
import { useT } from '@/hooks/useT';
import { Layout } from './Layout';
import { BootScreen, Login, Onboarding } from './Gate';
import { CommandPalette } from './CommandPalette';
import { ActionHost } from './actions/ActionHost';
import { ToastHost } from '@/ui/Toasts';
import { ConfirmHost } from '@/ui/Modal';
import { Alert } from '@/ui/primitives';
import { EMBED } from '@/ui/print';
import { ROUTES } from './routes';

function PageFallback() {
  return (
    <div className="page" aria-busy="true">
      <div className="skeleton" style={{ height: 42, width: '40%' }} />
      <div className="grid cols-3">
        <div className="skeleton" style={{ height: 120 }} />
        <div className="skeleton" style={{ height: 120 }} />
        <div className="skeleton" style={{ height: 120 }} />
      </div>
      <div className="skeleton" style={{ height: 280 }} />
    </div>
  );
}

const lazyCache = new Map<string, ComponentType>();
function lazyPage(key: string, loader: () => Promise<{ default: ComponentType }>) {
  let C = lazyCache.get(key);
  if (!C) {
    C = lazy(loader);
    lazyCache.set(key, C);
  }
  return C;
}

function useGlobalEffects() {
  const theme = useUI((s) => s.theme);
  const lang = useUI((s) => s.lang);
  const reduce = useUI((s) => s.reduceMotion);
  const openPalette = useUI((s) => s.openPalette);
  useEffect(() => {
    document.documentElement.setAttribute('data-lh-theme', theme);
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    if (reduce) document.documentElement.setAttribute('data-lh-motion', 'reduced');
    else document.documentElement.removeAttribute('data-lh-motion');
  }, [reduce]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '') || (e.target as HTMLElement)?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openPalette('commands');
      } else if (!typing && e.key === '/') {
        e.preventDefault();
        openPalette('search');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openPalette]);
}

export function App() {
  useGlobalEffects();
  const { t } = useT();
  const user = useSession((s) => s.user);
  const setUser = useSession((s) => s.setUser);
  const setReady = useSession((s) => s.setReady);
  const ready = useSession((s) => s.ready);
  const persistent = useSession((s) => s.persistent);
  const ui = useUI();
  const [progress, setProgress] = useState({ pct: 0, label: 'seed.unpack' });
  const [bootError, setBootError] = useState<string | undefined>();
  const [mode, setMode] = useState<'login' | 'onboarding'>('login');

  useEffect(() => {
    let alive = true;
    boot((pct, label) => alive && setProgress({ pct, label }))
      .then(async (r) => {
        if (!alive) return;
        if (r.user) {
          setUser(r.user);
          ui.applyPreferences({ theme: r.user.preferences.theme ?? ui.theme, baseCurrency: r.user.preferences.baseCurrency ?? ui.baseCurrency });
        } else if (!(await getMeta('firstRunDone', false))) {
          setMode('onboarding');
        }
        await setMeta('firstRunDone', true);
        setReady(r.persistent);
      })
      .catch((e) => setBootError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) return <BootScreen pct={progress.pct} label={progress.label} error={bootError} />;

  const Router = EMBED ? MemoryRouter : HashRouter;
  return (
    <Router>
      {!persistent && (
        <div style={{ position: 'fixed', bottom: 12, left: 12, right: 12, zIndex: 400, maxWidth: 560 }}>
          <Alert tone="warning">{t('app.sessionOnly')}</Alert>
        </div>
      )}
      {!user ? (
        mode === 'onboarding' ? (
          <Onboarding onCancel={() => setMode('login')} onSkip={async () => setUser(await switchIdentity('USR-AURELIA'))} />
        ) : (
          <Login onOnboard={() => setMode('onboarding')} />
        )
      ) : (
        <>
          <Routes>
            <Route element={<Layout />}>
              {ROUTES.map((r) => {
                const Page = lazyPage(r.path, r.load);
                return (
                  <Route
                    key={r.path}
                    path={r.path}
                    element={
                      <Suspense fallback={<PageFallback />}>
                        <Page />
                      </Suspense>
                    }
                  />
                );
              })}
            </Route>
          </Routes>
          <CommandPalette />
          <ActionHost />
        </>
      )}
      <ToastHost />
      <ConfirmHost />
    </Router>
  );
}
