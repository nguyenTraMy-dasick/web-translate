import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LangContext, type Lang } from './i18n';
import { Header, ThemeContext, ToastContext } from './ui/common';
import { useRoute } from './router';
import { recoverInterrupted } from './lib/actions';
import Library from './screens/Library';
import KeysScreen from './screens/KeysScreen';
import Wizard from './screens/Wizard';
import BookPage from './screens/BookPage';

function load<T extends string>(key: string, fallback: T): T {
  try { return (localStorage.getItem(key) as T) || fallback; } catch { return fallback; }
}
function store(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* bỏ qua */ }
}

export default function App() {
  const [lang, setLangState] = useState<Lang>(() => load<Lang>('wt.lang', 'vi'));
  const [theme, setTheme] = useState<'dark' | 'light'>(() => load('wt.theme', window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);
  const timer = useRef<number>(undefined);
  const route = useRoute();

  useEffect(() => { void recoverInterrupted(); }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useEffect(() => {
    document.documentElement.style.colorScheme = theme;
    document.body.style.background = theme === 'dark' ? '#0A0E15' : '#F0F1F5';
  }, [theme]);

  const setLang = useCallback((l: Lang) => { setLangState(l); store('wt.lang', l); }, []);
  const themeCtx = useMemo(() => ({
    dark: theme === 'dark',
    toggle: () => setTheme((t) => { const n = t === 'dark' ? 'light' : 'dark'; store('wt.theme', n); return n; }),
  }), [theme]);
  const showToast = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ msg, kind });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), kind === 'err' ? 6000 : 3000);
  }, []);

  const [r0, r1, r2] = route;
  let screen;
  let active: 'library' | 'new' | 'keys' | null = null;
  if (!r0) { screen = <Library />; active = 'library'; }
  else if (r0 === 'keys') { screen = <KeysScreen />; active = 'keys'; }
  else if (r0 === 'new') { screen = <Wizard step={1} />; active = 'new'; }
  else if (r0 === 'wizard' && r1) { screen = <Wizard bookId={r1} step={Math.min(5, Math.max(1, Number(r2) || 1))} />; active = 'new'; }
  else if (r0 === 'book' && r1) { screen = <BookPage bookId={r1} />; }
  else { screen = <Library />; active = 'library'; }

  return (
    <LangContext.Provider value={{ lang, setLang }}>
      <ThemeContext.Provider value={themeCtx}>
        <ToastContext.Provider value={showToast}>
          <div className={theme === 'dark' ? 'app' : 'app light'}>
            <Header active={active} />
            {screen}
            {toast && <div className={`toast${toast.kind === 'err' ? ' err' : ''}`} role="status" aria-live="polite">{toast.msg}</div>}
          </div>
        </ToastContext.Provider>
      </ThemeContext.Provider>
    </LangContext.Provider>
  );
}
