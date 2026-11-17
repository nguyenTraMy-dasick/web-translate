// Đọc EPUB, tách đoạn cần dịch, và đóng lại EPUB với bản dịch thay vào đúng chỗ
// (giữ nguyên CSS, ảnh, mục lục và cấu trúc HTML của file gốc).
// Dùng DOMParser/XMLSerializer nên chỉ chạy ở main thread.
import JSZip from 'jszip';
import type { Book, ChapterInfo, Chunk, ChunkItem } from './types';
import { CH_META, CH_TOC } from './types';

const DC = 'http://purl.org/dc/elements/1.1/';
const OPF = 'http://www.idpf.org/2007/opf';


// ---------- tiện ích đường dẫn ----------
function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i + 1);
}
export function resolvePath(base: string, href: string): string {
  const clean = decodeURIComponent(href.split('#')[0]);
  const parts = (dirname(base) + clean).split('/');
  const out: string[] = [];
  for (const s of parts) {
    if (s === '..') out.pop();
    else if (s !== '.' && s !== '') out.push(s);
  }
  return out.join('/');
}

// ---------- parse XML/XHTML ----------
// Thực thể HTML thường gặp không có trong XML → đổi sang dạng số để DOMParser không lỗi.
const ENTITIES: Record<string, string> = {
  nbsp: '#160', ensp: '#8194', emsp: '#8195', thinsp: '#8201', zwnj: '#8204', zwj: '#8205', shy: '#173',
  mdash: '#8212', ndash: '#8211', hellip: '#8230', lsquo: '#8216', rsquo: '#8217', ldquo: '#8220', rdquo: '#8221',
  laquo: '#171', raquo: '#187', middot: '#183', bull: '#8226', copy: '#169', reg: '#174', trade: '#8482',
  times: '#215', divide: '#247', deg: '#176', para: '#182', sect: '#167', iexcl: '#161', iquest: '#191',
};
function fixEntities(s: string): string {
  return s.replace(/&([a-zA-Z]+);/g, (m, name) => (ENTITIES[name] ? `&${ENTITIES[name]};` : ['amp', 'lt', 'gt', 'quot', 'apos'].includes(name) ? m : m));
}

function parseXml(text: string, type: DOMParserSupportedType = 'application/xhtml+xml'): Document | null {
  const doc = new DOMParser().parseFromString(fixEntities(text), type);
  if (doc.getElementsByTagName('parsererror').length) return null;
  return doc;
}

function parseXhtml(text: string): { doc: Document; xml: boolean } {
  const x = parseXml(text, 'application/xhtml+xml');
  if (x) return { doc: x, xml: true };
  // File không phải XHTML hợp lệ: đọc như HTML (kết quả xuất ra vẫn là XHTML)
  return { doc: new DOMParser().parseFromString(text, 'text/html'), xml: false };
}

function serialize(doc: Document, original: string): string {
  let out = new XMLSerializer().serializeToString(doc);
  if (/^\s*<\?xml/i.test(original) && !/^\s*<\?xml/i.test(out)) {
    out = '<?xml version="1.0" encoding="utf-8"?>\n' + out;
  }
  return out;
}

// ---------- tách đoạn ----------
const BLOCK = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'dt', 'dd', 'td', 'th', 'figcaption', 'caption', 'blockquote',
  'div', 'section', 'article', 'aside', 'header', 'footer', 'pre', 'address', 'nav', 'ol', 'ul', 'dl', 'table',
  'thead', 'tbody', 'tfoot', 'tr', 'figure', 'main', 'hgroup', 'details', 'summary',
]);
const SKIP = new Set(['script', 'style', 'svg', 'math', 'head', 'rt', 'rp', 'template', 'noscript']);
const HAS_LETTER = /\p{L}/u;

const tag = (el: Element) => (el.localName || el.nodeName).toLowerCase();

function hasBlockDescendant(el: Element): boolean {
  for (const c of Array.from(el.children)) {
    const t = tag(c);
    if (SKIP.has(t)) continue;
    if (BLOCK.has(t) || hasBlockDescendant(c)) return true;
  }
  return false;
}

function textNodes(el: Node, out: Text[] = []): Text[] {
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === 3) out.push(c as Text);
    else if (c.nodeType === 1 && !SKIP.has(tag(c as Element))) textNodes(c, out);
  }
  return out;
}

function rawText(el: Element): string {
  return textNodes(el).map((t) => t.data).join('');
}

/** Văn bản gửi đi dịch: gom khoảng trắng, bỏ thụt đầu dòng. */
export function cleanText(s: string): string {
  return s.replace(/[\s 　]+/g, ' ').trim();
}

/** Các khối "lá" có chữ, theo thứ tự trong tài liệu. Thứ tự này phải ổn định giữa lúc tách và lúc ghép. */
export function collectBlocks(doc: Document): Element[] {
  const body = doc.getElementsByTagName('body')[0];
  const out: Element[] = [];
  if (!body) return out;
  const walk = (el: Element) => {
    for (const c of Array.from(el.children)) {
      const t = tag(c);
      if (SKIP.has(t)) continue;
      if (hasBlockDescendant(c)) { walk(c); continue; }
      if (BLOCK.has(t) || el === body) {
        if (HAS_LETTER.test(rawText(c))) out.push(c);
      }
    }
  };
  walk(body);
  return out;
}

/** Thay chữ trong một khối: giữ thẻ bao ngoài (span, style…), giữ thụt đầu dòng.
 *  Bản dịch được đặt vào nút chữ dài nhất (thường là thân đoạn), các nút chữ khác bị làm rỗng. */
export function applyText(el: Element, translated: string) {
  const nodes = textNodes(el).filter((n) => n.data.replace(/[\s\u00a0\u3000]/g, '') !== '');
  if (!nodes.length) return;
  const target = nodes.reduce((a, b) => (b.data.trim().length > a.data.trim().length ? b : a));
  const lead = (target.data.replace(/^[ \t\r\n]+/, '').match(/^[\u00a0\u3000]+/) || [''])[0];
  target.data = lead + translated;
  for (const n of nodes) if (n !== target) n.data = '';
}

// ---------- đọc EPUB ----------
export interface ParsedEpub {
  opfPath: string;
  original: Book['original'];
  chapters: ChapterInfo[];
  tocLabels: string[];
}

function dcText(opf: Document, name: string): string[] {
  return Array.from(opf.getElementsByTagNameNS(DC, name)).map((e) => (e.textContent || '').trim()).filter(Boolean);
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

interface Manifest { byId: Map<string, { href: string; type: string; props: string }>; opfPath: string; opf: Document }

async function readManifest(zip: JSZip): Promise<Manifest> {
  const container = await zip.file('META-INF/container.xml')?.async('string');
  if (!container) throw new Error('META-INF/container.xml not found — not a valid EPUB');
  const cdoc = parseXml(container, 'application/xml');
  const rootfile = cdoc?.getElementsByTagName('rootfile')[0]?.getAttribute('full-path');
  if (!rootfile) throw new Error('OPF path not found');
  const opfText = await zip.file(rootfile)?.async('string');
  if (!opfText) throw new Error(`${rootfile} not found`);
  const opf = parseXml(opfText, 'application/xml');
  if (!opf) throw new Error('OPF is not valid XML');
  const byId = new Map<string, { href: string; type: string; props: string }>();
  for (const it of Array.from(opf.getElementsByTagNameNS(OPF, 'item'))) {
    byId.set(it.getAttribute('id') || '', {
      href: resolvePath(rootfile, it.getAttribute('href') || ''),
      type: it.getAttribute('media-type') || '',
      props: it.getAttribute('properties') || '',
    });
  }
  return { byId, opfPath: rootfile, opf };
}

async function readTocLabels(zip: JSZip, m: Manifest): Promise<{ map: Map<string, string>; labels: string[] }> {
  const map = new Map<string, string>();
  const labels: string[] = [];
  const add = (href: string, label: string) => {
    const l = cleanText(label);
    if (!l) return;
    if (!map.has(href)) map.set(href, l);
    if (!labels.includes(l)) labels.push(l);
  };
  for (const it of m.byId.values()) {
    if (it.props.split(/\s+/).includes('nav')) {
      const t = await zip.file(it.href)?.async('string');
      if (!t) continue;
      const { doc } = parseXhtml(t);
      for (const a of Array.from(doc.getElementsByTagName('a'))) {
        const h = a.getAttribute('href');
        if (h) add(resolvePath(it.href, h), a.textContent || '');
      }
    }
    if (it.type === 'application/x-dtbncx+xml') {
      const t = await zip.file(it.href)?.async('string');
      const doc = t ? parseXml(t, 'application/xml') : null;
      if (!doc) continue;
      for (const np of Array.from(doc.getElementsByTagName('navPoint'))) {
        const label = np.getElementsByTagName('text')[0]?.textContent || '';
        const src = np.getElementsByTagName('content')[0]?.getAttribute('src');
        if (src) add(resolvePath(it.href, src), label);
      }
    }
  }
  return { map, labels };
}

export async function parseEpub(data: Blob | ArrayBuffer): Promise<ParsedEpub> {
  const zip = await JSZip.loadAsync(data);
  const m = await readManifest(zip);
  const { opf } = m;
  const toc = await readTocLabels(zip, m);

  let coverHref: string | undefined;
  for (const it of m.byId.values()) if (it.props.split(/\s+/).includes('cover-image')) coverHref = it.href;
  if (!coverHref) {
    const metaCover = Array.from(opf.getElementsByTagNameNS(OPF, 'meta')).find((e) => e.getAttribute('name') === 'cover');
    const item = metaCover && m.byId.get(metaCover.getAttribute('content') || '');
    if (item && item.type.startsWith('image/')) coverHref = item.href;
  }

  const images = Array.from(m.byId.values()).filter((i) => i.type.startsWith('image/')).length;
  const original: Book['original'] = {
    title: dcText(opf, 'title')[0] || '',
    creator: dcText(opf, 'creator')[0] || '',
    language: dcText(opf, 'language')[0] || '',
    description: stripTags(dcText(opf, 'description')[0] || ''),
    publisher: dcText(opf, 'publisher')[0] || '',
    subjects: dcText(opf, 'subject'),
    images,
    coverHref,
  };

  const tocSet = new Set(toc.labels);
  const chapters: ChapterInfo[] = [];
  const spine = Array.from(opf.getElementsByTagNameNS(OPF, 'itemref'));
  for (const ref of spine) {
    const item = m.byId.get(ref.getAttribute('idref') || '');
    if (!item || !/x?html/.test(item.type)) continue;
    const text = await zip.file(item.href)?.async('string');
    if (text == null) continue;
    const { doc } = parseXhtml(text);
    const blocks = collectBlocks(doc).map((b) => cleanText(rawText(b))).filter(Boolean);
    const chars = blocks.reduce((s, b) => s + b.length, 0);
    const isNav = item.props.split(/\s+/).includes('nav');
    // Trang mục lục dạng thường (toàn link tới chương) → mặc định không chọn, vì đã có tuỳ chọn dịch mục lục
    const isTocPage = blocks.length > 2 && blocks.filter((b) => tocSet.has(b) || /^(contents|目录|目錄)$/i.test(b)).length >= blocks.length - 1;
    const heading = doc.querySelector('h1,h2,h3')?.textContent || '';
    const title = toc.map.get(item.href) || cleanText(doc.getElementsByTagName('title')[0]?.textContent || '') || cleanText(heading) || item.href.split('/').pop()!;
    chapters.push({
      index: chapters.length,
      href: item.href,
      title,
      chars,
      blocks: blocks.length,
      selected: chars > 0 && !isNav && !isTocPage,
      isNav: isNav || isTocPage,
    });
  }
  return { opfPath: m.opfPath, original, chapters, tocLabels: toc.labels };
}

// ---------- chia cụm để gửi Gemini ----------
export async function buildChunks(book: Book, data: Blob): Promise<Chunk[]> {
  const zip = await JSZip.loadAsync(data);
  const chunks: Chunk[] = [];
  const now = Date.now();
  const mk = (chapter: number, index: number, items: ChunkItem[], context: string): Chunk => ({
    id: `${book.id}:${chapter}:${index}`, bookId: book.id, chapter, index, items, context,
    status: 'pending', attempts: 0, updatedAt: now,
  });

  if (book.options.autoMeta) {
    const items: ChunkItem[] = [];
    if (book.meta.title === book.original.title && book.original.title) items.push({ id: 'title', text: book.original.title });
    if (book.meta.creator === book.original.creator && book.original.creator) items.push({ id: 'creator', text: book.original.creator });
    if (book.meta.description === book.original.description && book.original.description) items.push({ id: 'description', text: book.original.description });
    if (items.length) chunks.push(mk(CH_META, 0, items, 'Đây là tên truyện, tên tác giả (bút danh) và phần giới thiệu truyện.'));
  }
  if (book.options.translateToc && book.tocLabels.length) {
    const items = book.tocLabels.map((t, i) => ({ id: `t${i}`, text: t })).filter((i) => HAS_LETTER.test(i.text));
    for (let i = 0; i < items.length; i += 80) {
      chunks.push(mk(CH_TOC, i / 80, items.slice(i, i + 80), 'Đây là danh sách tiêu đề chương trong mục lục.'));
    }
  }

  const max = Math.max(500, book.prompt.chunkChars || 2500);
  for (const ch of book.chapters) {
    if (!ch.selected) continue;
    const text = await zip.file(ch.href)?.async('string');
    if (text == null) continue;
    const { doc } = parseXhtml(text);
    const all = collectBlocks(doc).map((b, i) => ({ id: `b${i}`, text: cleanText(rawText(b)) }));
    let cur: ChunkItem[] = [];
    let size = 0;
    let idx = 0;
    let startAt = 0;
    const flush = () => {
      if (!cur.length) return;
      const ctx = all.slice(Math.max(0, startAt - 2), startAt).map((b) => b.text).join('\n').slice(-400);
      chunks.push(mk(ch.index, idx++, cur, ctx));
      cur = []; size = 0;
    };
    all.forEach((b, i) => {
      if (!b.text) return;
      if (cur.length && size + b.text.length > max) { flush(); startAt = i; }
      if (!cur.length) startAt = i;
      cur.push(b);
      size += b.text.length;
    });
    flush();
  }
  return chunks;
}

// ---------- ghép bản dịch & đóng EPUB ----------
export function chunkText(c: Chunk, id: string): string | undefined {
  return c.edited?.[id] ?? c.result?.[id];
}

function setText(doc: Document, parent: Element, ns: string, qname: string, value: string, opts: { all?: boolean } = {}) {
  const local = qname.split(':').pop()!;
  const list = Array.from(parent.getElementsByTagNameNS(ns, local));
  if (list.length) {
    list[0].textContent = value;
    if (opts.all) for (const e of list.slice(1)) e.parentNode?.removeChild(e);
    return list[0];
  }
  const el = doc.createElementNS(ns, qname);
  el.textContent = value;
  parent.appendChild(el);
  return el;
}

function newUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export interface BuildInput {
  book: Book;
  chunks: Chunk[];
  source: Blob;
  cover?: Blob;
}

export async function buildEpub({ book, chunks, source, cover }: BuildInput): Promise<Blob> {
  const zip = await JSZip.loadAsync(source);
  const m = await readManifest(zip);

  // Bản dịch theo chương
  const byChapter = new Map<number, Map<string, string>>();
  const tocMap = new Map<string, string>();
  const metaRes: Record<string, string> = {};
  for (const c of chunks) {
    for (const it of c.items) {
      const t = chunkText(c, it.id);
      if (!t) continue;
      if (c.chapter === CH_TOC) tocMap.set(it.text, t);
      else if (c.chapter === CH_META) metaRes[it.id] = t;
      else {
        if (!byChapter.has(c.chapter)) byChapter.set(c.chapter, new Map());
        byChapter.get(c.chapter)!.set(it.id, t);
      }
    }
  }

  const pick = (field: 'title' | 'creator' | 'description') =>
    book.options.autoMeta && book.meta[field] === book.original[field] && metaRes[field] ? metaRes[field] : book.meta[field];
  const finalTitle = pick('title');
  const finalCreator = pick('creator');
  const finalDesc = pick('description');

  const replaceTocAnchors = (doc: Document): boolean => {
    let changed = false;
    for (const a of Array.from(doc.getElementsByTagName('a'))) {
      const t = tocMap.get(cleanText(a.textContent || ''));
      if (t) { applyText(a, t); changed = true; }
    }
    const title = doc.getElementsByTagName('title')[0];
    const cur = cleanText(title?.textContent || '');
    const tt = title && (tocMap.get(cur) || (cur && cur === book.original.title && finalTitle !== cur ? finalTitle : undefined));
    if (title && tt) { title.textContent = tt; changed = true; }
    return changed;
  };

  const setLang = (doc: Document) => {
    const html = doc.documentElement;
    if (html.hasAttribute('lang')) html.setAttribute('lang', 'vi');
    if (html.hasAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang') || html.hasAttribute('xml:lang')) {
      html.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:lang', 'vi');
    }
  };

  const done = new Set<string>();
  // 1) Chương đã dịch
  for (const ch of book.chapters) {
    const tr = byChapter.get(ch.index);
    const file = zip.file(ch.href);
    if (!file) continue;
    const text = await file.async('string');
    const { doc } = parseXhtml(text);
    let changed = false;
    if (tr?.size) {
      const blocks = collectBlocks(doc);
      blocks.forEach((el, i) => {
        const t = tr.get(`b${i}`);
        if (!t) return;
        if (book.options.bilingual) {
          const orig = el.cloneNode(true) as Element;
          const style = orig.getAttribute('style');
          orig.setAttribute('style', (style ? style.replace(/;?\s*$/, '; ') : '') + 'opacity: 0.6;');
          el.parentNode?.insertBefore(orig, el.nextSibling);
        }
        applyText(el, t);
      });
      setLang(doc);
      changed = true;
    }
    if (replaceTocAnchors(doc)) changed = true;
    if (changed) { zip.file(ch.href, serialize(doc, text)); done.add(ch.href); }
  }

  // 2) Các trang XHTML khác (nav, trang mục lục) — chỉ thay nhãn mục lục / tên truyện
  {
    for (const it of m.byId.values()) {
      if (done.has(it.href) || !/x?html/.test(it.type)) continue;
      const file = zip.file(it.href);
      if (!file) continue;
      const text = await file.async('string');
      const { doc } = parseXhtml(text);
      if (replaceTocAnchors(doc)) zip.file(it.href, serialize(doc, text));
    }
  }

  // 3) toc.ncx
  const uuid = `urn:uuid:${newUuid()}`;
  for (const it of m.byId.values()) {
    if (it.type !== 'application/x-dtbncx+xml') continue;
    const text = await zip.file(it.href)?.async('string');
    const doc = text ? parseXml(text, 'application/xml') : null;
    if (!doc || !text) continue;
    for (const t of Array.from(doc.getElementsByTagName('text'))) {
      const parent = t.parentNode as Element | null;
      if (parent && (parent.localName === 'docTitle')) t.textContent = finalTitle;
      else if (parent && (parent.localName === 'docAuthor')) t.textContent = finalCreator;
      else {
        const tr = tocMap.get(cleanText(t.textContent || ''));
        if (tr) t.textContent = tr;
      }
    }
    for (const meta of Array.from(doc.getElementsByTagName('meta'))) {
      if (meta.getAttribute('name') === 'dtb:uid') meta.setAttribute('content', uuid);
    }
    zip.file(it.href, serialize(doc, text));
  }

  // 4) OPF metadata
  const { opf, opfPath } = m;
  const metadata = opf.getElementsByTagNameNS(OPF, 'metadata')[0];
  const isV3 = (opf.documentElement.getAttribute('version') || '').startsWith('3');
  if (metadata) {
    setText(opf, metadata, DC, 'dc:title', finalTitle);
    setText(opf, metadata, DC, 'dc:creator', finalCreator);
    setText(opf, metadata, DC, 'dc:language', book.meta.language || 'vi');
    if (finalDesc) setText(opf, metadata, DC, 'dc:description', finalDesc);
    if (book.meta.publisher) setText(opf, metadata, DC, 'dc:publisher', book.meta.publisher);
    for (const s of Array.from(metadata.getElementsByTagNameNS(DC, 'subject'))) s.parentNode?.removeChild(s);
    for (const s of book.meta.subjects) {
      const el = opf.createElementNS(DC, 'dc:subject');
      el.textContent = s;
      metadata.appendChild(el);
    }
    if (book.meta.translator) {
      const c = opf.createElementNS(DC, 'dc:contributor');
      c.textContent = book.meta.translator;
      if (isV3) {
        c.setAttribute('id', 'translator');
        const r = opf.createElementNS(OPF, 'meta');
        r.setAttribute('refines', '#translator');
        r.setAttribute('property', 'role');
        r.setAttribute('scheme', 'marc:relators');
        r.textContent = 'trl';
        metadata.appendChild(c);
        metadata.appendChild(r);
      } else {
        c.setAttributeNS(OPF, 'opf:role', 'trl');
        metadata.appendChild(c);
      }
    }
    // Đổi định danh để máy đọc sách không nhầm với bản gốc
    const uidId = opf.documentElement.getAttribute('unique-identifier');
    const ident = Array.from(metadata.getElementsByTagNameNS(DC, 'identifier')).find((e) => e.getAttribute('id') === uidId);
    if (ident) ident.textContent = uuid;
    for (const meta of Array.from(metadata.getElementsByTagNameNS(OPF, 'meta'))) {
      if (meta.getAttribute('property') === 'dcterms:modified') meta.textContent = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    }
  }
  // Ảnh bìa mới: ghi đè đúng file ảnh bìa cũ
  if (cover && book.original.coverHref) {
    zip.file(book.original.coverHref, cover);
    for (const it of Array.from(opf.getElementsByTagNameNS(OPF, 'item'))) {
      if (resolvePath(opfPath, it.getAttribute('href') || '') === book.original.coverHref && cover.type) {
        it.setAttribute('media-type', cover.type);
      }
    }
  }
  const opfOriginal = (await zip.file(opfPath)!.async('string'));
  zip.file(opfPath, serialize(opf, opfOriginal));

  // 5) Đóng gói: "mimetype" phải là file đầu tiên và không nén
  const out = new JSZip();
  out.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  const names = Object.keys(zip.files).filter((n) => n !== 'mimetype' && !zip.files[n].dir);
  for (const n of names) out.file(n, await zip.file(n)!.async('uint8array'));
  return out.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}



/** Lấy n đoạn đầu (có chữ) của một chương — dùng cho "Dịch thử". */
export async function sampleBlocks(data: Blob, href: string, n: number, skip = 0): Promise<ChunkItem[]> {
  const zip = await JSZip.loadAsync(data);
  const text = await zip.file(href)?.async('string');
  if (text == null) return [];
  const { doc } = parseXhtml(text);
  return collectBlocks(doc)
    .map((b, i) => ({ id: `b${i}`, text: cleanText(rawText(b)) }))
    .filter((b) => b.text)
    .slice(skip, skip + n);
}
