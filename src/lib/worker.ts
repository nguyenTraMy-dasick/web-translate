/// <reference lib="webworker" />
// Web Worker chạy việc dịch: lấy cụm chưa dịch, chọn key, gọi Gemini, lưu kết quả.
// Worker ít bị trình duyệt làm chậm hơn tab thường khi tab bị ẩn.
import * as db from './db';
import { generate, GeminiError } from './gemini';
import { buildSystem, buildUser, parseResult } from './prompt';
import { RpmWindows, nextAvailableIn, pickKey, refreshKey } from './keypool';
import type { ApiKey, Book, Chunk, FromWorker, LogEntry, Settings, ToWorker } from './types';

declare const self: DedicatedWorkerGlobalScope;

const post = (m: FromWorker) => self.postMessage(m);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Job { bookId: string; pausing: boolean; controllers: Map<string, AbortController> }
let job: Job | null = null;

async function log(bookId: string, level: LogEntry['level'], msg: string, key?: string) {
  const entry = await db.addLog({ bookId, at: Date.now(), level, msg, key });
  post({ type: 'log', entry });
}

function progressOf(chunks: Chunk[]): Book['progress'] {
  let done = 0, errors = 0, running = 0;
  for (const c of chunks) {
    if (c.status === 'done') done++;
    else if (c.status === 'error') errors++;
    else if (c.status === 'running') running++;
  }
  return { done, total: chunks.length, errors, running };
}

/** Gộp danh sách key mới đọc từ DB (người dùng có thể thêm / sửa) với trạng thái đang chạy trong bộ nhớ. */
function mergeKeys(mem: ApiKey[], fresh: ApiKey[]): ApiKey[] {
  return fresh.map((f) => {
    const m = mem.find((k) => k.id === f.id);
    if (!m) return f;
    const userFixed = f.state === 'ok' && (m.state === 'invalid' || m.state === 'error');
    return {
      ...f,
      usedToday: Math.max(m.usedToday, f.usedDate === m.usedDate ? f.usedToday : 0),
      usedDate: m.usedDate,
      state: userFixed ? 'ok' : m.state,
      cooldownUntil: m.cooldownUntil,
      lastError: m.lastError,
      disabled: f.disabled,
    };
  });
}

async function run(bookId: string) {
  const book = await db.getBook(bookId);
  if (!book) return;
  let settings: Settings = await db.getSettings();
  const chunks = await db.getChunks(bookId);
  for (const c of chunks) if (c.status === 'running') { c.status = 'pending'; await db.putChunk(c); }

  const me: Job = { bookId, pausing: false, controllers: new Map() };
  job = me;
  book.status = 'running';
  book.statusDetail = undefined;
  book.startedAt = Date.now();
  book.progress = progressOf(chunks);
  await db.putBook(book);
  post({ type: 'state', bookId, status: 'running' });
  await log(bookId, 'info', 'start');

  let keys: ApiKey[] = (await db.getKeys()).map((k) => refreshKey(k));
  const win = new RpmWindows();
  const inflight = new Map<string, number>();
  const rr = { i: 0 };
  let lastReload = Date.now();
  let lastSaveBook = 0;
  let endStatus: Book['status'] = 'done';
  let endDetail: string | undefined;

  const saveKey = async (k: ApiKey) => {
    const latest = (await db.getKeys()).find((x) => x.id === k.id);
    if (!latest) return; // người dùng đã xoá key
    await db.putKey({ ...latest, usedToday: k.usedToday, usedDate: k.usedDate, state: k.state, cooldownUntil: k.cooldownUntil, lastError: k.lastError, disabled: k.disabled });
    post({ type: 'keys' });
  };

  const saveProgress = async (force = false) => {
    if (!force && Date.now() - lastSaveBook < 2000) return;
    lastSaveBook = Date.now();
    const b = await db.getBook(bookId);
    if (!b) return;
    b.progress = progressOf(chunks);
    await db.putBook(b);
    post({ type: 'progress', bookId, progress: b.progress });
  };

  const process = async (chunk: Chunk, key: ApiKey) => {
    const ctrl = new AbortController();
    me.controllers.set(chunk.id, ctrl);
    inflight.set(key.id, (inflight.get(key.id) || 0) + 1);
    win.hit(key.id);
    key.usedToday++;
    chunk.status = 'running';
    chunk.keyLabel = key.label;
    await db.putChunk(chunk);
    post({ type: 'chunk', chunk });
    const where = chunk.chapter >= 0 ? `#${chunk.chapter} · ${chunk.index + 1}` : chunk.chapter === -1 ? 'TOC' : 'META';
    const t0 = Date.now();
    try {
      const b = (await db.getBook(bookId)) || book;
      const model = b.prompt.model || key.model;
      const res = await generate({
        key: key.key, model, json: true, signal: ctrl.signal, temperature: b.prompt.temperature,
        system: buildSystem(b.prompt, chunk.items, chunk.context),
        user: buildUser(chunk.items),
      });
      chunk.result = parseResult(res.text, chunk.items);
      chunk.status = 'done';
      chunk.error = undefined;
      chunk.tokens = res.tokens;
      if (key.state !== 'ok') key.state = 'ok';
      await log(bookId, 'ok', `${where} ✓ ${res.tokens} token · ${((Date.now() - t0) / 1000).toFixed(1)}s`, key.label);
    } catch (e: any) {
      const err = e instanceof GeminiError ? e : new GeminiError('other', String(e?.message || e));
      key.lastError = `${err.kind}: ${err.message}`.slice(0, 300);
      switch (err.kind) {
        case 'aborted':
          chunk.status = 'pending';
          break;
        case 'rate': {
          const wait = Math.max(err.retryAfterMs || 0, settings.cooldownSec * 1000);
          key.state = 'cooldown';
          key.cooldownUntil = Date.now() + wait;
          chunk.status = 'pending';
          await log(bookId, 'warn', `429 → nghỉ ${Math.round(wait / 1000)}s`, key.label);
          break;
        }
        case 'quota':
          key.state = 'quota';
          chunk.status = 'pending';
          await log(bookId, 'warn', `quota/day → hết lượt hôm nay`, key.label);
          break;
        case 'auth':
        case 'model':
          key.state = 'invalid';
          if (settings.autoDisable) key.disabled = true;
          chunk.status = 'pending';
          await log(bookId, 'err', `${err.status || ''} ${err.kind === 'model' ? 'model không tồn tại' : 'key bị từ chối'} → ${settings.autoDisable ? 'đã tắt key' : 'bỏ qua key'}`, key.label);
          break;
        case 'safety':
          chunk.status = 'error';
          chunk.error = 'safety';
          chunk.attempts = settings.maxRetries;
          await log(bookId, 'err', `${where} ✗ bị bộ lọc an toàn chặn`, key.label);
          break;
        default:
          chunk.attempts++;
          chunk.error = `${err.kind}: ${err.message}`.slice(0, 300);
          chunk.status = chunk.attempts >= settings.maxRetries ? 'error' : 'pending';
          await log(bookId, chunk.status === 'error' ? 'err' : 'warn', `${where} ✗ ${err.kind}: ${err.message.slice(0, 120)} (lần ${chunk.attempts}/${settings.maxRetries})`, key.label);
          if (err.kind === 'server' || err.kind === 'network') await sleep(1500);
      }
    } finally {
      me.controllers.delete(chunk.id);
      inflight.set(key.id, Math.max(0, (inflight.get(key.id) || 1) - 1));
      await db.putChunk(chunk);
      post({ type: 'chunk', chunk });
      await saveKey(key);
      await saveProgress();
    }
  };

  const active = new Set<Promise<void>>();
  while (true) {
    if (me.pausing) break;
    if (Date.now() - lastReload > 3000) {
      lastReload = Date.now();
      settings = await db.getSettings();
      keys = mergeKeys(keys, await db.getKeys()).map((k) => refreshKey(k));
    }
    const queue = chunks.filter((c) => c.status === 'pending');
    if (!queue.length && !active.size) break;

    const usable = keys.filter((k) => !k.disabled && k.state !== 'invalid');
    const limit = Math.max(1, Math.min(settings.concurrency, Math.max(1, usable.length) * 4));
    let started = false;
    while (queue.length && active.size < limit && !me.pausing) {
      const key = pickKey(keys, settings, win, inflight, rr);
      if (!key) break;
      const chunk = queue.shift()!;
      const p = process(chunk, key).finally(() => active.delete(p));
      active.add(p);
      started = true;
    }

    if (!started && !active.size && queue.length) {
      const wait = nextAvailableIn(keys, win);
      if (wait === null) {
        endStatus = 'error';
        endDetail = 'no_keys';
        await log(bookId, 'err', 'Không còn API key nào dùng được (sai, bị tắt hoặc hết lượt hôm nay)');
        break;
      }
      await sleep(Math.min(Math.max(wait, 200), 2000));
      continue;
    }
    if (active.size) await Promise.race([...active, sleep(500)]);
    else await sleep(100);
  }

  if (me.pausing) {
    for (const c of me.controllers.values()) c.abort();
    await Promise.allSettled([...active]);
    endStatus = 'paused';
  } else if (endStatus === 'done' && chunks.some((c) => c.status === 'error')) {
    endStatus = 'error';
    endDetail = 'chunk_errors';
  }
  const b = await db.getBook(bookId);
  if (b) {
    b.status = endStatus;
    b.statusDetail = endDetail;
    b.progress = progressOf(chunks);
    await db.putBook(b);
    post({ type: 'progress', bookId, progress: b.progress });
  }
  await db.trimLogs(bookId);
  await log(bookId, endStatus === 'done' ? 'ok' : endStatus === 'paused' ? 'info' : 'err', `end: ${endStatus}${endDetail ? ` (${endDetail})` : ''}`);
  post({ type: 'state', bookId, status: endStatus, detail: endDetail });
  if (job === me) job = null;
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  if (m.type === 'start') {
    if (job) {
      if (job.bookId === m.bookId) post({ type: 'state', bookId: m.bookId, status: 'running' });
      else post({ type: 'state', bookId: m.bookId, status: 'paused', detail: 'busy' });
      return;
    }
    run(m.bookId).catch(async (e) => {
      job = null;
      await log(m.bookId, 'err', `worker: ${e?.message || e}`);
      const b = await db.getBook(m.bookId);
      if (b) { b.status = 'error'; b.statusDetail = 'worker'; await db.putBook(b); }
      post({ type: 'state', bookId: m.bookId, status: 'error', detail: 'worker' });
    });
  } else if (m.type === 'pause') {
    if (job) {
      job.pausing = true;
      for (const c of job.controllers.values()) c.abort();
    }
  }
};
