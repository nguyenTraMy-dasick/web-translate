import { useCallback, useEffect, useState } from 'react';
import * as db from './lib/db';
import type { ApiKey, Book } from './lib/types';
import { subscribe } from './lib/runner';

/** Đọc một truyện từ IndexedDB, tự làm mới khi worker báo tiến độ. */
export function useBook(id: string | undefined) {
  const [book, setBook] = useState<Book | null | undefined>(undefined);
  const reload = useCallback(async () => {
    if (!id) { setBook(null); return; }
    setBook((await db.getBook(id)) ?? null);
  }, [id]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => subscribe((m) => {
    if ((m.type === 'state' || m.type === 'progress') && m.bookId === id) void reload();
  }), [id, reload]);
  const save = useCallback(async (b: Book) => {
    // Cập nhật giao diện ngay (để gõ phím không bị mất chữ), rồi mới ghi xuống IndexedDB
    const copy = structuredClone(b);
    setBook(copy);
    await db.putBook(structuredClone(copy));
  }, []);
  return { book, setBook, save, reload };
}

export function useKeys() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const reload = useCallback(async () => setKeys(await db.getKeys()), []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => subscribe((m) => { if (m.type === 'keys') void reload(); }), [reload]);
  return { keys, reload };
}

/** Đồng hồ cập nhật mỗi giây (cho đếm ngược thời gian nghỉ của key). */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
