// Tiện ích dùng chung cho các module lấy dữ liệu Khám phá.
// Chỉ lấy thông tin cơ bản (tên, tác giả, thứ hạng, tóm tắt ngắn, link) — KHÔNG lấy nội dung chương.

export const UA = 'WebTranslateDiscover/1.0 (+https://github.com/nguyenTraMy-dasick/web-translate)';

export async function fetchText(url, { encoding, timeoutMs = 20000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8', ...headers },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const enc = encoding || sniffEncoding(res.headers.get('content-type') || '', buf) || 'utf-8';
    return new TextDecoder(enc).decode(buf);
  } finally {
    clearTimeout(t);
  }
}

export async function fetchJson(url, opts = {}) {
  return JSON.parse(await fetchText(url, { ...opts, encoding: 'utf-8', headers: { Accept: 'application/json', ...(opts.headers || {}) } }));
}

function sniffEncoding(contentType, buf) {
  const m = contentType.match(/charset=([\w-]+)/i);
  if (m) return normalizeEnc(m[1]);
  const head = new TextDecoder('ascii').decode(buf.slice(0, 2048));
  const m2 = head.match(/<meta[^>]+charset=["']?([\w-]+)/i);
  return m2 ? normalizeEnc(m2[1]) : null;
}
function normalizeEnc(e) {
  e = e.toLowerCase();
  return ['gb2312', 'gbk', 'gb18030'].includes(e) ? 'gb18030' : e;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', hellip: '…', mdash: '—', ldquo: '“', rdquo: '”' };
export function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}

export function stripTags(s) {
  return decodeEntities(String(s || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Rút gọn tóm tắt: tối đa n ký tự, cắt ở dấu câu nếu được. */
export function shorten(s, n = 160) {
  s = stripTags(s);
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const p = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('. '), cut.lastIndexOf('！'), cut.lastIndexOf('？'));
  return (p > n * 0.5 ? cut.slice(0, p + 1) : cut) + '…';
}

/**
 * Tìm các thẻ <a> có href khớp mẫu, theo thứ tự xuất hiện, bỏ trùng.
 * Trả về [{ id, href, text, index }] — index là vị trí trong HTML để ghép với thông tin gần đó.
 */
export function findLinks(html, hrefPattern) {
  const out = [];
  const seen = new Set();
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const href = (attrs.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!href) continue;
    const hm = href.match(hrefPattern);
    if (!hm) continue;
    const text = stripTags(m[2]) || stripTags((attrs.match(/title\s*=\s*["']([^"']+)["']/i) || [])[1] || '');
    const id = hm[1] || href;
    if (!text || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, href: decodeEntities(href), text, index: m.index, attrs });
  }
  return out;
}

export function absUrl(base, href) {
  try { return new URL(href, base).toString(); } catch { return href; }
}
