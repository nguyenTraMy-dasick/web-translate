// Cầu nối giữa giao diện và worker dịch (một worker duy nhất cho cả app).
import type { FromWorker, ToWorker } from './types';

type Listener = (m: FromWorker) => void;

let worker: Worker | null = null;
const listeners = new Set<Listener>();
let wakeLock: { release: () => Promise<void> } | null = null;
let runningBook: string | null = null;

function ensure(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev: MessageEvent<FromWorker>) => {
    const m = ev.data;
    if (m.type === 'state') {
      runningBook = m.status === 'running' ? m.bookId : runningBook === m.bookId ? null : runningBook;
      if (m.status === 'running') void lockScreen();
      else if (!runningBook) void releaseScreen();
    }
    listeners.forEach((l) => l(m));
  };
  return worker;
}

// Giữ màn hình không tắt khi đang dịch (nếu trình duyệt hỗ trợ)
async function lockScreen() {
  try {
    const nav = navigator as any;
    if (!wakeLock && nav.wakeLock) wakeLock = await nav.wakeLock.request('screen');
  } catch { /* không hỗ trợ hoặc bị từ chối */ }
}
async function releaseScreen() {
  try { await wakeLock?.release(); } catch { /* bỏ qua */ }
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && runningBook) void lockScreen();
});

export function send(m: ToWorker) { ensure().postMessage(m); }
export function startBook(bookId: string) { send({ type: 'start', bookId }); }
export function pauseBook() { send({ type: 'pause' }); }
export function currentRunning(): string | null { return runningBook; }

export function subscribe(l: Listener): () => void {
  ensure();
  listeners.add(l);
  return () => { listeners.delete(l); };
}
