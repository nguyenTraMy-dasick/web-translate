// Router đơn giản dựa trên hash (#/...) — chạy được trên GitHub Pages không cần cấu hình.
import { useEffect, useState } from 'react';

export const href = (path: string) => `#${path}`;
export const go = (path: string) => { location.hash = path; };

function current(): string {
  return location.hash.replace(/^#/, '') || '/';
}

export function useRoute(): string[] {
  const [path, setPath] = useState(current());
  useEffect(() => {
    const on = () => { setPath(current()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return path.split('/').filter(Boolean);
}
