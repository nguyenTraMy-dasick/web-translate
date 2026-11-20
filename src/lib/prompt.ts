// Mẫu prompt, ghép biến và đọc kết quả JSON trả về từ Gemini.
import type { ChunkItem, GlossaryItem, PromptSettings } from './types';
import { GeminiError } from './gemini';
import { addressOptions, nameOptions, presetsFor, promptLangName } from './langs';
export { PRESETS } from './langs';

export const DEFAULT_TEMPLATE = `Bạn là dịch giả truyện {the_loai} từ {ngon_ngu_nguon} sang {ngon_ngu_dich}.

Yêu cầu:
- Dịch sát nghĩa nhưng mượt, đúng văn phong {the_loai}.
- Tên riêng chuyển theo {kieu_ten}; xưng hô theo kiểu {xung_ho}.
- Luôn dùng đúng bảng thuật ngữ sau: {bang_thuat_ngu}
- Không thêm chú thích hay lời bình của người dịch.

Ngữ cảnh đoạn trước (chỉ để tham khảo, không dịch):
{doan_truoc}`;

// Phần cố định web tự thêm vào cuối để ghép bản dịch đúng chỗ — người dùng không sửa.
export function formatRules(tgt: string): string {
  return `

ĐỊNH DẠNG BẮT BUỘC:
Đầu vào là một object JSON; mỗi khoá là mã đoạn (p1, p2, …), giá trị là đoạn văn gốc.
Trả về DUY NHẤT một object JSON có đúng các khoá đó, giá trị là bản dịch ${promptLangName(tgt)} của đoạn tương ứng.
Không gộp, không tách, không bỏ sót đoạn nào, không thêm khoá mới, không bọc trong markdown.`;
}

export function defaultPrompt(src = 'zh', tgt = 'vi'): PromptSettings {
  const p = presetsFor(src, tgt)[0];
  return {
    preset: p.id,
    genre: p.genre,
    address: addressOptions(src, tgt)[p.address ?? 0] ?? addressOptions(src, tgt)[0],
    names: nameOptions(src, tgt)[0],
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

export interface LangPair { src: string; tgt: string }

export function buildSystem(p: PromptSettings, items: ChunkItem[], context: string, lp: LangPair): string {
  const all = items.map((i) => i.text).join('\n');
  const vars: Record<string, string> = {
    the_loai: p.genre || 'tiểu thuyết',
    kieu_ten: p.names,
    xung_ho: p.address,
    bang_thuat_ngu: glossaryFor(p.glossary, all),
    doan_truoc: context || '(đây là đầu chương)',
    ngon_ngu_nguon: promptLangName(lp.src),
    ngon_ngu_dich: promptLangName(lp.tgt),
  };
  const body = p.template.replace(/\{(the_loai|kieu_ten|xung_ho|bang_thuat_ngu|doan_truoc|ngon_ngu_nguon|ngon_ngu_dich)\}/g, (_, k) => vars[k]);
  return body + formatRules(lp.tgt);
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
export function shortSystem(p: PromptSettings, kind: 'title' | 'creator' | 'description' | 'any', lp: LangPair): string {
  const what = kind === 'title' ? 'tên truyện' : kind === 'creator' ? 'bút danh tác giả' : kind === 'description' ? 'đoạn giới thiệu truyện' : 'đoạn văn';
  return `Dịch ${what} sau từ ${promptLangName(lp.src)} sang ${promptLangName(lp.tgt)}, văn phong ${p.genre || 'tiểu thuyết'}, tên riêng theo ${p.names}. Chỉ trả về bản dịch, không giải thích, không thêm dấu ngoặc.`;
}
