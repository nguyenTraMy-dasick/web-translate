// IndexedDB tối giản, dùng được cả trong giao diện và trong Web Worker.
import type { ApiKey, Book, Chunk, LogEntry, Settings } from './types';
import { DEFAULT_SETTINGS } from './types';

const DB_NAME = 'web-translate';
const DB_VERSION = 2;

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      if (!db.objectStoreNames.contains('chunks')) {
        const s = db.createObjectStore('chunks', { keyPath: 'id' });
        s.createIndex('bookId', 'bookId');
      }
      if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'id' });
      // v2: bộ nhớ đệm bản dịch tên & tóm tắt ở trang Khám phá
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
      if (!db.objectStoreNames.contains('logs')) {
        const s = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
        s.createIndex('bookId', 'bookId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: string, mode: IDBTransactionMode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ---------- books ----------
export async function getBooks(): Promise<Book[]> {
  const list = await wrap((await store('books')).getAll()) as Book[];
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function getBook(id: string): Promise<Book | undefined> {
  return wrap((await store('books')).get(id)) as Promise<Book | undefined>;
}
export async function putBook(book: Book): Promise<void> {
  book.updatedAt = Date.now();
  await wrap((await store('books', 'readwrite')).put(book));
}
export async function deleteBook(id: string): Promise<void> {
  const db = await open();
  const tx = db.transaction(['books', 'files', 'chunks', 'logs'], 'readwrite');
  tx.objectStore('books').delete(id);
  tx.objectStore('files').delete(id);
  tx.objectStore('files').delete(`${id}:cover`);
  for (const name of ['chunks', 'logs']) {
    const idx = tx.objectStore(name).index('bookId');
    const keys = await wrap(idx.getAllKeys(id));
    for (const k of keys) tx.objectStore(name).delete(k);
  }
  await done(tx);
}

// ---------- files (EPUB gốc, ảnh bìa mới) ----------
export async function putFile(key: string, blob: Blob): Promise<void> {
  await wrap((await store('files', 'readwrite')).put(blob, key));
}
export async function getFile(key: string): Promise<Blob | undefined> {
  return wrap((await store('files')).get(key)) as Promise<Blob | undefined>;
}
export async function deleteFile(key: string): Promise<void> {
  await wrap((await store('files', 'readwrite')).delete(key));
}

// ---------- chunks ----------
export async function getChunks(bookId: string): Promise<Chunk[]> {
  const s = await store('chunks');
  const list = await wrap(s.index('bookId').getAll(bookId)) as Chunk[];
  return list.sort((a, b) => a.chapter - b.chapter || a.index - b.index);
}
export async function putChunk(chunk: Chunk): Promise<void> {
  chunk.updatedAt = Date.now();
  await wrap((await store('chunks', 'readwrite')).put(chunk));
}
export async function replaceChunks(bookId: string, chunks: Chunk[]): Promise<void> {
  const db = await open();
  const tx = db.transaction('chunks', 'readwrite');
  const s = tx.objectStore('chunks');
  const keys = await wrap(s.index('bookId').getAllKeys(bookId));
  for (const k of keys) s.delete(k);
  for (const c of chunks) s.put(c);
  await done(tx);
}

// ---------- keys ----------
export async function getKeys(): Promise<ApiKey[]> {
  const list = await wrap((await store('keys')).getAll()) as ApiKey[];
  return list.sort((a, b) => a.createdAt - b.createdAt);
}
export async function putKey(k: ApiKey): Promise<void> {
  await wrap((await store('keys', 'readwrite')).put(k));
}
export async function deleteKey(id: string): Promise<void> {
  await wrap((await store('keys', 'readwrite')).delete(id));
}

// ---------- settings ----------
export async function getSettings(): Promise<Settings> {
  const s = await wrap((await store('settings')).get('settings')) as Settings | undefined;
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}
export async function putSettings(s: Settings): Promise<void> {
  await wrap((await store('settings', 'readwrite')).put(s));
}

// ---------- logs ----------
const MAX_LOGS = 300;
export async function addLog(entry: LogEntry): Promise<LogEntry> {
  const s = await store('logs', 'readwrite');
  const id = await wrap(s.add(entry)) as number;
  return { ...entry, id };
}
export async function getLogs(bookId: string): Promise<LogEntry[]> {
  const s = await store('logs');
  const list = await wrap(s.index('bookId').getAll(bookId)) as LogEntry[];
  return list.sort((a, b) => b.at - a.at).slice(0, MAX_LOGS);
}
export async function trimLogs(bookId: string): Promise<void> {
  const db = await open();
  const tx = db.transaction('logs', 'readwrite');
  const s = tx.objectStore('logs');
  const list = await wrap(s.index('bookId').getAll(bookId)) as LogEntry[];
  if (list.length > MAX_LOGS) {
    list.sort((a, b) => a.at - b.at);
    for (const e of list.slice(0, list.length - MAX_LOGS)) s.delete(e.id!);
  }
  await done(tx);
}

// ---------- cache (bản dịch ở trang Khám phá) ----------
export async function getCacheMany(keys: string[]): Promise<Record<string, string>> {
  const s = await store('cache');
  const out: Record<string, string> = {};
  await Promise.all(keys.map(async (k) => {
    const v = await wrap(s.get(k)) as string | undefined;
    if (v !== undefined) out[k] = v;
  }));
  return out;
}
export async function putCacheMany(entries: Record<string, string>): Promise<void> {
  const db = await open();
  const tx = db.transaction('cache', 'readwrite');
  for (const [k, v] of Object.entries(entries)) tx.objectStore('cache').put(v, k);
  await done(tx);
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
