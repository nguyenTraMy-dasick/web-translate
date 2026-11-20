// DaoSearch — API JSON chính thức (https://daosearch.io/developers), gom bảng xếp hạng của
// Qidian, JJWXC (Tấn Giang), Fanqie… Cần API key (miễn phí) đặt trong biến môi trường DAOSEARCH_KEY;
// trên GitHub là secret của repo. API không cho gọi từ trình duyệt, nên chỉ dùng ở script này.
//
// Điều khoản DaoSearch cần giữ (bản 4, 12/11/2026):
// - Ghi công DaoSearch bằng link nhìn thấy được trên trang hiện dữ liệu, kèm link `url` của từng truyện.
// - Đánh dấu hoặc ẩn truyện `mature` trên trang công khai → ở đây: ẩn.
// - Gửi User-Agent nêu tên công cụ; giữ trong giới hạn; không phát lại API thô.
import { UA, shorten } from '../lib.mjs';

const API = 'https://daosearch.io/api/v1';
const PER_LIST = 20;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, key) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${key}`, 'User-Agent': UA, Accept: 'application/json' },
    });
    if (res.status === 429 || res.status === 503) {
      const wait = Math.min(30, Number(res.headers.get('retry-after')) || 5);
      if (attempt < 2) { await sleep(wait * 1000); continue; }
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`DaoSearch ${res.status} ${body?.error?.code || ''}: ${body?.error?.message || path}`);
    await sleep(400); // lịch sự: tối đa vài request mỗi giây
    return body;
  }
  throw new Error(`DaoSearch: gave up on ${path}`);
}

/** Chọn bảng: bảng đầu tiên là bảng chính của nguồn ("hot"), cộng bảng mới / hoàn thành nếu có. */
export function pickBoards(boards) {
  const text = (b) => `${b.board} ${b.label || ''} ${b.zh || ''}`;
  const main = boards.filter((b) => !/^mm_/.test(b.board));
  const pool = main.length ? main : boards;
  const out = [];
  if (pool[0]) out.push({ id: 'hot', board: pool[0] });
  const newB = pool.find((b) => b !== pool[0] && /\bnew\b|newbie|新书|新人|新作|新晋/i.test(text(b)));
  if (newB) out.push({ id: 'new', board: newB });
  const doneB = pool.find((b) => b !== pool[0] && /finish|complet|完本|完结/i.test(text(b)));
  if (doneB) out.push({ id: 'completed', board: doneB });
  return out;
}

export function entryToItem(e, detail) {
  const b = e.book || {};
  const zhTitle = b.title?.zh || b.title?.en;
  if (!zhTitle) return null;
  return {
    rank: e.position,
    title: zhTitle,
    titleEn: b.title?.en || undefined,
    author: b.author?.zh || b.author?.en || '',
    url: b.url,
    cover: b.cover_url || undefined,
    blurb: detail?.synopsis_zh ? shorten(detail.synopsis_zh) : undefined,
    blurbEn: b.synopsis_excerpt ? shorten(b.synopsis_excerpt, 220) : undefined,
    tags: [b.genre?.zh].filter(Boolean),
    movement: e.movement,
  };
}

/** Tạo module nguồn cho một trang (qidian, jjwxc, fanqie…) qua DaoSearch. */
export function daosearch(source) {
  return {
    id: `ds-${source}`,
    homepage: `https://daosearch.io/${source}/rankings`,
    via: { name: 'DaoSearch', url: 'https://daosearch.io/' },
    stability: 'stable',
    lang: 'zh',
    async fetch() {
      const key = process.env.DAOSEARCH_KEY;
      if (!key) throw new Error('DAOSEARCH_KEY is not set (see README → DaoSearch)');
      const boards = (await api(`/${source}/rankings`, key)).data || [];
      const chosen = pickBoards(boards);
      if (!chosen.length) throw new Error(`${source}: no ranking boards`);

      const lists = [];
      for (const { id, board } of chosen) {
        const page = await api(`/${source}/rankings/${encodeURIComponent(board.board)}`, key);
        const entries = (page.data?.entries || []).filter((e) => e.book?.title?.zh || e.book?.title?.en).slice(0, PER_LIST + 10);
        lists.push({ id, url: page.data?.url || board.url, board: board.label, boardZh: board.zh, refreshedAt: page.data?.refreshed_at, entries });
      }

      // Lấy chi tiết theo lô (1 đơn vị / truyện) để biết truyện `mature` và tóm tắt tiếng Trung
      const ids = [...new Set(lists.flatMap((l) => l.entries.map((e) => `${e.book.source}:${e.book.source_book_id}`)))];
      const details = new Map();
      for (let i = 0; i < ids.length; i += 50) {
        const batch = await api(`/books?ids=${ids.slice(i, i + 50).map(encodeURIComponent).join(',')}`, key);
        for (const it of batch.data || []) if (it.book) details.set(it.id, it.book);
      }

      return lists.map((l) => ({
        id: l.id,
        url: l.url,
        board: l.board,
        boardZh: l.boardZh,
        items: l.entries
          // chỉ giữ truyện đã lấy được chi tiết và không bị đánh dấu mature
          .filter((e) => { const d = details.get(`${e.book.source}:${e.book.source_book_id}`); return d && !d.mature; })
          .map((e) => entryToItem(e, details.get(`${e.book.source}:${e.book.source_book_id}`)))
          .filter(Boolean)
          .slice(0, PER_LIST),
      }));
    },
  };
}
