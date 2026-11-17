// Bộ icon nét (stroke) dùng chung — giống mockup.
import type { ReactNode } from 'react';

const PATHS: Record<string, ReactNode> = {
  upload: <><path d="M12 16V4"/><path d="m6 10 6-6 6 6"/><path d="M4 20h16"/></>,
  book: <><path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z"/><path d="M4 17a3 3 0 0 1 3-3h11"/></>,
  key: <><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9"/><path d="m17 6 3 3"/></>,
  check: <><path d="m5 12 5 5 9-10"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  right: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
  left: <><path d="M19 12H5"/><path d="m11 6-6 6 6 6"/></>,
  moon: <><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></>,
  play: <><path d="M7 4v16l13-8z"/></>,
  pause: <><path d="M8 4v16M16 4v16"/></>,
  download: <><path d="M12 4v12"/><path d="m6 10 6 6 6-6"/><path d="M4 20h16"/></>,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></>,
  trash: <><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/></>,
  spark: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></>,
  file: <><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16z"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/></>,
  warn: <><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/></>,
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  x: <><path d="M6 6l12 12M18 6 6 18"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></>,
};

export type IconName = 'upload' | 'book' | 'key' | 'check' | 'plus' | 'right' | 'left' | 'moon' | 'sun' | 'lock' | 'play' | 'pause' | 'download' | 'refresh' | 'trash' | 'spark' | 'info' | 'file' | 'edit' | 'search' | 'image' | 'warn' | 'more' | 'x' | 'settings';

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{PATHS[name]}</svg>
  );
}
