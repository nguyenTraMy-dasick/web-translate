// Các thao tác cấp cao mà giao diện gọi tới.
import JSZip from 'jszip';
import * as db from './db';
import { buildChunks, buildEpub, parseEpub, sampleBlocks } from './epub';
import { generate, GeminiError, listModels, pickDefaultModel } from './gemini';
import { buildSystem, buildUser, defaultPrompt, formatRules, parseResult, shortSystem, type LangPair } from './prompt';
import { addressOptions, base, detectLang, nameOptions, presetsFor, promptLangName } from './langs';
import { refreshKey } from './keypool';
import type { ApiKey, Book, Chunk, ChunkItem } from './types';
import { currentRunning } from './runner';

export function slugify(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^\w一-鿿]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'book';
}

export async function createBookFromFile(file: File): Promise<Book> {
  if (!/\.epub$/i.test(file.name)) throw new Error('not_epub');
  const parsed = await parseEpub(file);
  const id = db.uid();
  const o = parsed.original;
  const det = detectLang(o.language, parsed.sample);
  const targetLang = base(det.code) === 'vi' ? 'en' : 'vi';
  const book: Book = {
    id, createdAt: Date.now(), updatedAt: Date.now(), status: 'draft',
    fileName: file.name, fileSize: file.size, opfPath: parsed.opfPath,
    sourceLang: det.code, targetLang, detectedLang: { code: det.code, reason: det.reason },
    original: o,
    meta: {
      title: o.title, creator: o.creator, translator: '', language: targetLang, description: o.description,
      publisher: o.publisher, subjects: [...o.subjects],
      fileName: `${slugify(o.title || file.name.replace(/\.epub$/i, ''))}_${targetLang}.epub`,
    },
    chapters: parsed.chapters,
    tocLabels: parsed.tocLabels,
    prompt: defaultPrompt(det.code, targetLang),
    options: { translateToc: true, autoMeta: true, bilingual: false },
    step: 1,
    progress: { done: 0, total: 0, errors: 0, running: 0 },
  };
  // Prompt mẫu đã lưu (nút "Lưu làm mẫu"), nếu không có thì dùng lại prompt của truyện gần nhất
  const saved = loadTemplate();
  const prev = (await db.getBooks())[0];
  // Chỉ dùng lại khi cùng cặp ngôn ngữ, để không mang tuỳ chọn tiếng Trung sang truyện tiếng Nhật…
  const same = (b?: { sourceLang?: string; targetLang?: string }) => !!b && base(b.sourceLang || 'zh') === base(det.code) && base(b.targetLang || 'vi') === targetLang;
  if (saved && same(saved as any)) book.prompt = { ...book.prompt, ...saved, glossary: [] };
  else if (prev && same(prev)) book.prompt = { ...prev.prompt, glossary: [] };
  await db.putFile(id, file);
  await db.putBook(book);
  return book;
}

/** Tạo danh sách cụm cần dịch; giữ lại bản dịch cũ của những cụm không đổi. */
export async function prepareChunks(book: Book): Promise<Chunk[]> {
  const src = await db.getFile(book.id);
  if (!src) throw new Error('source_missing');
  const fresh = await buildChunks(book, src);
  const old = new Map((await db.getChunks(book.id)).map((c) => [c.id, c]));
  const same = (a: ChunkItem[], b: ChunkItem[]) => a.length === b.length && a.every((x, i) => x.id === b[i].id && x.text === b[i].text);
  for (const c of fresh) {
    const o = old.get(c.id);
    if (o && same(o.items, c.items)) {
      c.result = o.result; c.edited = o.edited; c.tokens = o.tokens; c.keyLabel = o.keyLabel;
      c.status = o.status === 'done' ? 'done' : 'pending';
    }
  }
  await db.replaceChunks(book.id, fresh);
  return fresh;
}

export async function downloadBook(book: Book): Promise<void> {
  const source = await db.getFile(book.id);
  if (!source) throw new Error('source_missing');
  const chunks = await db.getChunks(book.id);
  const cover = book.coverOverride ? await db.getFile(`${book.id}:cover`) : undefined;
  const blob = await buildEpub({ book, chunks, source, cover });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = book.meta.fileName || 'translated.epub';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** Lấy key dùng được ngay ở main thread (cho Dịch thử / dịch tên truyện). */
async function usableKeys(): Promise<ApiKey[]> {
  const now = Date.now();
  return (await db.getKeys())
    .map((k) => refreshKey(k, now))
    .filter((k) => !k.disabled && k.state !== 'invalid' && k.state !== 'quota' && !(k.state === 'cooldown' && k.cooldownUntil > now));
}

async function withKey<T>(fn: (k: ApiKey) => Promise<T>): Promise<{ value: T; key: ApiKey }> {
  const keys = await usableKeys();
  if (!keys.length) throw new Error('no_keys');
  let last: unknown;
  for (const k of keys) {
    try {
      const value = await fn(k);
      k.usedToday++;
      k.state = 'ok';
      await db.putKey(k);
      return { value, key: k };
    } catch (e) {
      last = e;
      if (e instanceof GeminiError && ['rate', 'quota', 'auth', 'model'].includes(e.kind)) {
        k.lastError = `${e.kind}: ${e.message}`.slice(0, 300);
        if (e.kind === 'rate') { k.state = 'cooldown'; k.cooldownUntil = Date.now() + 60_000; }
        if (e.kind === 'quota') k.state = 'quota';
        if (e.kind === 'auth' || e.kind === 'model') k.state = 'invalid';
        await db.putKey(k);
        continue; // thử key kế tiếp
      }
      throw e;
    }
  }
  throw last;
}

export interface TestResult { items: ChunkItem[]; result: Record<string, string>; tokens: number; ms: number; keyLabel: string }

export async function testTranslate(book: Book, chapterIndex: number, n = 3): Promise<TestResult> {
  const src = await db.getFile(book.id);
  if (!src) throw new Error('source_missing');
  const ch = book.chapters[chapterIndex];
  const items = await sampleBlocks(src, ch.href, n);
  if (!items.length) throw new Error('empty_chapter');
  const t0 = Date.now();
  const { value, key } = await withKey((k) => generate({
    key: k.key, model: book.prompt.model || k.model, json: true, temperature: book.prompt.temperature,
    system: buildSystem(book.prompt, items, '', langPair(book)), user: buildUser(items),
  }));
  return { items, result: parseResult(value.text, items), tokens: value.tokens, ms: Date.now() - t0, keyLabel: key.label };
}

export async function translateShort(book: Book, text: string, kind: 'title' | 'creator' | 'description'): Promise<string> {
  const { value } = await withKey((k) => generate({
    key: k.key, model: book.prompt.model || k.model, temperature: 0.3,
    system: shortSystem(book.prompt, kind, langPair(book)), user: text,
  }));
  return value.text.trim().replace(/^["“《]+|["”》]+$/g, '');
}

export async function testKey(k: ApiKey): Promise<ApiKey> {
  try {
    const models = await listModels(k.key);
    k.models = models;
    if (!k.model || !models.includes(k.model)) k.model = pickDefaultModel(models);
    k.state = 'ok';
    k.disabled = false;
    k.lastError = undefined;
  } catch (e) {
    const err = e instanceof GeminiError ? e : new GeminiError('other', String(e));
    k.lastError = `${err.kind}: ${err.message}`.slice(0, 300);
    k.state = err.kind === 'auth' ? 'invalid' : err.kind === 'rate' ? 'cooldown' : err.kind === 'quota' ? 'quota' : 'error';
    if (err.kind === 'rate') k.cooldownUntil = Date.now() + 60_000;
  }
  await db.putKey(k);
  return k;
}

/** Khi mở web: truyện đang "running" mà worker không chạy (do đóng tab) → chuyển sang tạm dừng. */
export async function recoverInterrupted(): Promise<void> {
  const running = currentRunning();
  for (const b of await db.getBooks()) {
    if (b.status === 'running' && b.id !== running) {
      b.status = 'paused';
      b.statusDetail = 'interrupted';
      await db.putBook(b);
    }
  }
}

export function chapterStats(book: Book, chunks: Chunk[]) {
  const per = new Map<number, { total: number; done: number; error: number; running: number; edited: boolean }>();
  for (const c of chunks) {
    if (c.chapter < 0) continue;
    const s = per.get(c.chapter) || { total: 0, done: 0, error: 0, running: 0, edited: false };
    s.total++;
    if (c.status === 'done') s.done++;
    if (c.status === 'error') s.error++;
    if (c.status === 'running') s.running++;
    if (c.edited && Object.keys(c.edited).length) s.edited = true;
    per.set(c.chapter, s);
  }
  const selected = book.chapters.filter((c) => per.has(c.index));
  const doneChapters = selected.filter((c) => { const s = per.get(c.index)!; return s.done === s.total; }).length;
  return { per, selected, doneChapters };
}

const TPL_KEY = 'wt.promptTemplate';
export function saveTemplate(p: Book['prompt'], lp: LangPair) {
  const { glossary: _g, ...rest } = p;
  try { localStorage.setItem(TPL_KEY, JSON.stringify({ ...rest, sourceLang: lp.src, targetLang: lp.tgt })); } catch { /* bỏ qua */ }
}

export function langPair(book: Book): LangPair {
  return { src: book.sourceLang || 'zh', tgt: book.targetLang || 'vi' };
}

/** Đổi cặp ngôn ngữ của truyện: chỉnh lại các tuỳ chọn prompt không còn hợp lệ. */
export function withLangs(book: Book, src: string, tgt: string): Book {
  const b = structuredClone(book);
  b.sourceLang = src;
  b.targetLang = tgt;
  const names = nameOptions(src, tgt);
  const addr = addressOptions(src, tgt);
  if (!names.includes(b.prompt.names)) b.prompt.names = names[0];
  if (!addr.includes(b.prompt.address)) b.prompt.address = addr[0];
  const presets = presetsFor(src, tgt);
  if (!presets.some((p) => p.id === b.prompt.preset)) {
    b.prompt.preset = presets[0].id;
    b.prompt.genre = presets[0].genre || b.prompt.genre;
  }
  if (b.meta.language === book.targetLang) b.meta.language = tgt;
  b.meta.fileName = b.meta.fileName.replace(/_([a-z]{2}(?:-[A-Za-z]+)?)\.epub$/, `_${tgt}.epub`);
  return b;
}

/** Dịch nhanh một loạt đoạn ngắn (dùng cho trang Khám phá). Trả về map id → bản dịch. */
export async function translateBatch(items: ChunkItem[], src: string, tgt: string): Promise<Record<string, string>> {
  const p = defaultPrompt(src, tgt);
  const system = `Dịch các đoạn sau từ ${promptLangName(src)} sang ${promptLangName(tgt)}. Đây là tên truyện, tên tác giả và tóm tắt ngắn trên bảng xếp hạng. Tên riêng theo ${p.names}.` + formatRules(tgt);
  const { value } = await withKey((k) => generate({ key: k.key, model: k.model, json: true, temperature: 0.3, system, user: buildUser(items) }));
  return parseResult(value.text, items);
}
function loadTemplate(): Partial<Book['prompt']> | null {
  try { const s = localStorage.getItem(TPL_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}

/** Ảnh bìa đang dùng: ảnh mới người dùng chọn, nếu không thì ảnh trong file gốc. */
export async function getCover(book: Book): Promise<Blob | undefined> {
  if (book.coverOverride) {
    const b = await db.getFile(`${book.id}:cover`);
    if (b) return b;
  }
  if (!book.original.coverHref) return undefined;
  const src = await db.getFile(book.id);
  if (!src) return undefined;
  const zip = await JSZip.loadAsync(src);
  const data = await zip.file(book.original.coverHref)?.async('blob');
  return data;
}
