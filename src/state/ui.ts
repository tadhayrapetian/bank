/** UI state: language, theme, sound, base currency, overlays. Persisted per viewer (best effort). */
import { create } from 'zustand';
import type { Lang, ThemeId } from '@/core/types';

const KEY = 'ledgerhall.ui';

interface Persisted {
  lang: Lang;
  theme: ThemeId;
  sound: boolean;
  baseCurrency: string;
  reduceMotion: boolean;
  balancesHidden: boolean;
}

function load(): Partial<Persisted> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Persisted>;
  } catch {
    return {};
  }
}

function save(p: Persisted) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable — preferences last for the session */
  }
}

function browserLang(): Lang {
  const l = (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2);
  return l === 'ru' ? 'ru' : l === 'hy' ? 'hy' : 'en';
}

export type ActionName =
  | 'transfer' | 'receive' | 'exchange' | 'pay' | 'check' | 'openAccount' | 'deposit' | 'withdraw' | 'request' | 'scan' | 'document';

export interface UIState extends Persisted {
  sidebarOpen: boolean;
  paletteOpen: boolean;
  paletteMode: 'commands' | 'search';
  action: { name: ActionName; params?: Record<string, string> } | null;
  setLang: (l: Lang) => void;
  setTheme: (t: ThemeId) => void;
  setSound: (s: boolean) => void;
  setBaseCurrency: (c: string) => void;
  setReduceMotion: (v: boolean) => void;
  toggleBalances: () => void;
  setSidebar: (v: boolean) => void;
  openPalette: (mode?: 'commands' | 'search') => void;
  closePalette: () => void;
  openAction: (name: ActionName, params?: Record<string, string>) => void;
  closeAction: () => void;
  applyPreferences: (p: Partial<Persisted>) => void;
}

const initial = load();

export const useUI = create<UIState>((set, get) => {
  const persist = () => {
    const s = get();
    save({ lang: s.lang, theme: s.theme, sound: s.sound, baseCurrency: s.baseCurrency, reduceMotion: s.reduceMotion, balancesHidden: s.balancesHidden });
  };
  return {
    lang: initial.lang ?? browserLang(),
    theme: initial.theme ?? 'ministry',
    sound: initial.sound ?? false,
    baseCurrency: initial.baseCurrency ?? 'CRWN',
    reduceMotion: initial.reduceMotion ?? false,
    balancesHidden: initial.balancesHidden ?? false,
    sidebarOpen: false,
    paletteOpen: false,
    paletteMode: 'commands',
    action: null,
    setLang: (lang) => { set({ lang }); persist(); },
    setTheme: (theme) => { set({ theme }); persist(); },
    setSound: (sound) => { set({ sound }); persist(); },
    setBaseCurrency: (baseCurrency) => { set({ baseCurrency }); persist(); },
    setReduceMotion: (reduceMotion) => { set({ reduceMotion }); persist(); },
    toggleBalances: () => { set({ balancesHidden: !get().balancesHidden }); persist(); },
    setSidebar: (sidebarOpen) => set({ sidebarOpen }),
    openPalette: (paletteMode = 'commands') => set({ paletteOpen: true, paletteMode }),
    closePalette: () => set({ paletteOpen: false }),
    openAction: (name, params) => set({ action: { name, params }, paletteOpen: false }),
    closeAction: () => set({ action: null }),
    applyPreferences: (p) => { set(p); persist(); },
  };
});
