// Chạy tất cả nguồn Khám phá và ghi public/discover/data.json.
// Dùng trong GitHub Actions (mỗi ngày) hoặc local: `npm run discover`.
// Nguồn nào lỗi sẽ giữ dữ liệu lần thành công trước (đọc từ web đang chạy qua DISCOVER_PREV_URL).
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import openlibrary from './sources/openlibrary.mjs';
import { daosearch } from './sources/daosearch.mjs';

// Các trang Trung Quốc lấy qua API của DaoSearch (cần DAOSEARCH_KEY). Có thể thêm:
// faloo, qimao, zongheng, seventeenk, sfacg, ciweimao.
const DS_SOURCES = (process.env.DAOSEARCH_SOURCES || 'qidian,jjwxc,fanqie').split(',').map((s) => s.trim()).filter(Boolean);
const SOURCES = [...DS_SOURCES.map(daosearch), openlibrary];
const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../../public/discover/data.json');

async function loadPrevious() {
  const url = process.env.DISCOVER_PREV_URL;
  if (!url) return null;
  try {
    const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const prev = await loadPrevious();
const now = new Date().toISOString();
const sources = [];
for (const s of SOURCES) {
  const base = { id: s.id, homepage: s.homepage, stability: s.stability, lang: s.lang, ...(s.via ? { via: s.via } : {}) };
  const t0 = Date.now();
  try {
    const lists = (await s.fetch()).filter((l) => l.items?.length);
    if (!lists.length) throw new Error('no lists');
    sources.push({ ...base, ok: true, updatedAt: now, lists });
    console.log(`✓ ${s.id}: ${lists.map((l) => `${l.id}=${l.items.length}`).join(', ')} (${Date.now() - t0} ms)`);
  } catch (e) {
    const old = prev?.sources?.find((x) => x.id === s.id && x.lists?.length);
    sources.push({ ...base, ok: false, error: String(e?.message || e).slice(0, 300), updatedAt: old?.updatedAt ?? null, lists: old?.lists ?? [] });
    console.warn(`✗ ${s.id}: ${e?.message || e}${old ? ' (giữ dữ liệu cũ)' : ''}`);
  }
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ generatedAt: now, sources }, null, 1));
console.log(`→ ${OUT}`);
