// Thành phần giao diện dùng chung: header, stepper, chip, công tắc, thông báo.
import { createContext, useContext, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { LangContext, useT, type MsgKey } from '../i18n';
import { href } from '../router';

export const ThemeContext = createContext<{ dark: boolean; toggle: () => void }>({ dark: true, toggle: () => {} });
export const ToastContext = createContext<(msg: string, kind?: 'ok' | 'err') => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function Header({ active }: { active: 'discover' | 'library' | 'new' | 'keys' | null }) {
  const { t, lang } = useT();
  const { setLang } = useContext(LangContext);
  const { dark, toggle } = useContext(ThemeContext);
  const items: [typeof active, string, MsgKey][] = [
    ['discover', href('/'), 'nav.discover'],
    ['library', href('/library'), 'nav.library'],
    ['new', href('/new'), 'nav.new'],
    ['keys', href('/keys'), 'nav.keys'],
  ];
  return (
    <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, padding: '14px 32px', borderBottom: '1px solid var(--line2)' }}>
      <a href={href('/')} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'var(--text)' }}>
        <span className="zh" style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--pri)', color: 'var(--pri-fg)', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 800 }}>文A</span>
        <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-0.01em' }}>Web Translate</span>
      </a>
      <nav className="nav" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginLeft: 12 }}>
        {items.map(([id, h, k]) => (
          <a key={id} href={h} className={active === id ? 'on' : ''} aria-current={active === id ? 'page' : undefined}>{t(k)}</a>
        ))}
      </nav>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
        <div className="seg" role="group" aria-label={t('lang.label')}>
          <button className={lang === 'vi' ? 'on' : ''} aria-pressed={lang === 'vi'} onClick={() => setLang('vi')}>VI</button>
          <button className={lang === 'en' ? 'on' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
        </div>
        <button className="iconbtn" aria-label={t('theme.toggle')} title={t('theme.toggle')} onClick={toggle}>
          <Icon name={dark ? 'sun' : 'moon'} size={20} />
        </button>
      </div>
    </header>
  );
}

export function Stepper({ cur, bookId, maxStep }: { cur: number; bookId?: string; maxStep: number }) {
  const { t } = useT();
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {[1, 2, 3, 4, 5].map((i) => {
        const state = i < cur ? 'done' : i === cur ? 'cur' : '';
        const reachable = bookId && i <= maxStep && i !== cur;
        const inner = (
          <>
            <span className={`sdot ${state}`}>{i < cur ? <Icon name="check" size={16} /> : i}</span>
            <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
              <span className="hint">{t('step.n', { n: i })}</span>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{t(`step.${i}` as MsgKey)}</span>
            </span>
          </>
        );
        const style = { flex: '1 1 170px', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, background: 'var(--card)', border: `1px solid ${i === cur ? 'var(--text3)' : 'var(--line2)'}`, textDecoration: 'none', color: 'var(--text)' } as const;
        return (
          <li key={i} aria-current={i === cur ? 'step' : undefined} style={{ flex: '1 1 170px', display: 'flex' }}>
            {reachable ? <a href={href(`/wizard/${bookId}/${i}`)} style={style}>{inner}</a> : <div style={style}>{inner}</div>}
          </li>
        );
      })}
    </ol>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 32px 48px', display: 'flex', flexDirection: 'column', gap: 24 }}>{children}</main>;
}

export function Title({ kicker, title, sub }: { kicker?: string; title: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {kicker && <span className="hint" style={{ fontWeight: 600, letterSpacing: '0.04em' }}>{kicker}</span>}
      <h1 className="h1">{title}</h1>
      {sub && <p style={{ margin: 0, color: 'var(--text3)', maxWidth: 720 }}>{sub}</p>}
    </div>
  );
}

export function Banner({ kind = 'info', icon = 'info', children }: { kind?: 'info' | 'warn' | 'err'; icon?: IconName; children: ReactNode }) {
  return (
    <div className="card" role="note" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', color: `var(--${kind})`, background: `var(--${kind}-bg)`, borderColor: 'transparent' }}>
      <span style={{ flex: 'none', display: 'flex' }}><Icon name={icon} size={20} /></span>
      <span style={{ color: 'var(--text2)' }}>{children}</span>
    </div>
  );
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" className={`toggle${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />;
}

export function Chip({ kind = 'mute', plain, children }: { kind?: 'ok' | 'warn' | 'err' | 'info' | 'mute'; plain?: boolean; children: ReactNode }) {
  return <span className={`chip ${kind}${plain ? ' plain' : ''}`}>{children}</span>;
}

export function WizardActions({ back, next, nextLabel, extra, nextDisabled, onNext }: {
  back?: string; next?: string; nextLabel?: string; extra?: ReactNode; nextDisabled?: boolean; onNext?: () => void;
}) {
  const { t } = useT();
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingTop: 20, borderTop: '1px solid var(--line2)' }}>
      {back ? <a className="btn" href={back}><Icon name="left" />{t('common.back')}</a> : <span />}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {extra}
        <button className="btn pri" disabled={nextDisabled} onClick={() => { if (onNext) onNext(); else if (next) location.hash = next.replace(/^#/, ''); }}>
          {nextLabel || t('common.next')}<Icon name="right" />
        </button>
      </div>
    </div>
  );
}

export function fmtNum(n: number, lang: string): string {
  return n.toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US');
}

/** Ước tính token: chữ Hán ~1 token/chữ, chữ Latin ~4 ký tự/token. */
export function estimateTokens(chars: number): number {
  return Math.round(chars * 1.1);
}

export function fmtBig(n: number, lang: string): string {
  if (n >= 1e6) return (n / 1e6).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US', { maximumFractionDigits: 2 }) + (lang === 'vi' ? ' triệu' : 'M');
  if (n >= 1e3) return (n / 1e3).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US', { maximumFractionDigits: 1 }) + 'k';
  return String(n);
}
