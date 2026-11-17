// Mẫu prompt, ghép biến và đọc kết quả JSON trả về từ Gemini.
import type { ChunkItem, GlossaryItem, PromptSettings } from './types';
import { GeminiError } from './gemini';

export const ADDRESS_OPTIONS = [
  'cổ trang (ta – ngươi, huynh – muội, sư tôn – đồ nhi)',
  'hiện đại (tôi – cậu, anh – em, chị – em)',
];
export const NAME_OPTIONS = ['âm Hán Việt (ví dụ: 林逸 → Lâm Dật)', 'pinyin (ví dụ: 林逸 → Lin Yi)'];

export interface Preset { id: string; genre: string; address: number; names: number }
export const PRESETS: Preset[] = [
  { id: 'xianxia', genre: 'tiên hiệp / huyền huyễn', address: 0, names: 0 },
  { id: 'ancient', genre: 'ngôn tình cổ đại', address: 0, names: 0 },
  { id: 'modern', genre: 'đô thị hiện đại', address: 1, names: 0 },
  { id: 'custom', genre: '', address: 1, names: 0 },
];

export const DEFAULT_TEMPLATE = `Bạn là dịch giả truyện {the_loai} từ tiếng Trung sang tiếng Việt.

Yêu cầu:
- Dịch sát nghĩa nhưng mượt, đúng văn phong {the_loai}.
- Tên riêng chuyển theo {kieu_ten}; xưng hô theo kiểu {xung_ho}.
- Luôn dùng đúng bảng thuật ngữ sau: {bang_thuat_ngu}
- Không thêm chú thích hay lời bình của người dịch.

Ngữ cảnh đoạn trước (chỉ để tham khảo, không dịch):
{doan_truoc}`;

// Phần cố định web tự thêm vào cuối để ghép bản dịch đúng chỗ — người dùng không sửa.
export const FORMAT_RULES = `

ĐỊNH DẠNG BẮT BUỘC:
Đầu vào là một object JSON; mỗi khoá là mã đoạn (p1, p2, …), giá trị là đoạn văn gốc.
Trả về DUY NHẤT một object JSON có đúng các khoá đó, giá trị là bản dịch tiếng Việt của đoạn tương ứng.
Không gộp, không tách, không bỏ sót đoạn nào, không thêm khoá mới, không bọc trong markdown.`;

export function defaultPrompt(): PromptSettings {
  const p = PRESETS[0];
  return {
    preset: p.id,
    genre: p.genre,
    address: ADDRESS_OPTIONS[p.address],
    names: NAME_OPTIONS[p.names],
    template: DEFAULT_TEMPLATE,
    glossary: [],
    model: '',
    chunkChars: 2500,
    temperature: 0.7,
  };
}

/** Chỉ đưa vào prompt những thuật ngữ thật sự xuất hiện trong đoạn đang dịch (tiết kiệm token). */
export function glossaryFor(glossary: GlossaryItem[], text: string): string {
  const used = glossary.filter((g) => g.src && g.dst && text.includes(g.src));
  if (!used.length) return '(không có)';
  return '\n' + used.map((g) => `  ${g.src} → ${g.dst}`).join('\n');
}

export function buildSystem(p: PromptSettings, items: ChunkItem[], context: string): string {
  const all = items.map((i) => i.text).join('\n');
  const vars: Record<string, string> = {
    the_loai: p.genre || 'tiểu thuyết',
    kieu_ten: p.names,
    xung_ho: p.address,
    bang_thuat_ngu: glossaryFor(p.glossary, all),
    doan_truoc: context || '(đây là đầu chương)',
  };
  const body = p.template.replace(/\{(the_loai|kieu_ten|xung_ho|bang_thuat_ngu|doan_truoc)\}/g, (_, k) => vars[k]);
  return body + FORMAT_RULES;
}

export function buildUser(items: ChunkItem[]): string {
  const obj: Record<string, string> = {};
  items.forEach((it, i) => { obj[`p${i + 1}`] = it.text; });
  return JSON.stringify(obj, null, 0);
}

/** Đọc JSON trả về, ánh xạ p1..pn về id đoạn thật. Thiếu đoạn → lỗi định dạng để thử lại. */
export function parseResult(text: string, items: ChunkItem[]): Record<string, string> {
  let s = text.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = s.indexOf('{');
  const startArr = s.indexOf('[');
  let data: any;
  try {
    data = JSON.parse(s);
  } catch {
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { data = JSON.parse(s.slice(start, end + 1)); } catch { /* bỏ qua */ }
    }
  }
  if (Array.isArray(data) && startArr >= 0) {
    const arr = data;
    data = {};
    arr.forEach((v: unknown, i: number) => { data[`p${i + 1}`] = v; });
  }
  if (!data || typeof data !== 'object') throw new GeminiError('format', 'response is not JSON');
  const out: Record<string, string> = {};
  const missing: string[] = [];
  items.forEach((it, i) => {
    const v = data[`p${i + 1}`];
    if (typeof v === 'string' && v.trim()) out[it.id] = v.trim();
    else missing.push(`p${i + 1}`);
  });
  // Cho phép thiếu rất ít đoạn ngắn? Không — thiếu là thử lại để tránh mất chữ.
  if (missing.length) throw new GeminiError('format', `missing ${missing.length}/${items.length} paragraphs (${missing.slice(0, 5).join(', ')})`);
  return out;
}

/** Prompt ngắn cho tên truyện / tác giả / mô tả. */
export function shortSystem(p: PromptSettings, kind: 'title' | 'creator' | 'description' | 'any'): string {
  const what = kind === 'title' ? 'tên truyện' : kind === 'creator' ? 'bút danh tác giả' : kind === 'description' ? 'đoạn giới thiệu truyện' : 'đoạn văn';
  return `Dịch ${what} sau từ tiếng Trung sang tiếng Việt, văn phong ${p.genre || 'tiểu thuyết'}, tên riêng theo ${p.names}. Chỉ trả về bản dịch, không giải thích, không thêm dấu ngoặc.`;
}
