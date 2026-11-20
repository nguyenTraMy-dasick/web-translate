// Danh sách ngôn ngữ, nhận diện ngôn ngữ gốc và các tuỳ chọn dịch theo cặp ngôn ngữ.

export interface LangInfo { code: string; vi: string; en: string; cjk?: boolean }

export const LANGS: LangInfo[] = [
  { code: 'zh', vi: 'Tiếng Trung (giản thể)', en: 'Chinese (Simplified)', cjk: true },
  { code: 'zh-Hant', vi: 'Tiếng Trung (phồn thể)', en: 'Chinese (Traditional)', cjk: true },
  { code: 'ja', vi: 'Tiếng Nhật', en: 'Japanese', cjk: true },
  { code: 'ko', vi: 'Tiếng Hàn', en: 'Korean', cjk: true },
  { code: 'vi', vi: 'Tiếng Việt', en: 'Vietnamese' },
  { code: 'en', vi: 'Tiếng Anh', en: 'English' },
  { code: 'fr', vi: 'Tiếng Pháp', en: 'French' },
  { code: 'de', vi: 'Tiếng Đức', en: 'German' },
  { code: 'es', vi: 'Tiếng Tây Ban Nha', en: 'Spanish' },
  { code: 'pt', vi: 'Tiếng Bồ Đào Nha', en: 'Portuguese' },
  { code: 'it', vi: 'Tiếng Ý', en: 'Italian' },
  { code: 'ru', vi: 'Tiếng Nga', en: 'Russian' },
  { code: 'th', vi: 'Tiếng Thái', en: 'Thai' },
  { code: 'id', vi: 'Tiếng Indonesia', en: 'Indonesian' },
];

export function langInfo(code: string): LangInfo {
  return LANGS.find((l) => l.code === code) || LANGS.find((l) => l.code === base(code)) || { code, vi: code, en: code };
}
export function langName(code: string, ui: 'vi' | 'en' = 'vi'): string {
  return langInfo(code)[ui];
}
/** Tên ngôn ngữ dùng trong prompt (viết thường, tiếng Việt). */
export function promptLangName(code: string): string {
  const n = langInfo(code).vi;
  return n.charAt(0).toLowerCase() + n.slice(1);
}
export function base(code: string): string {
  return (code || '').split(/[-_]/)[0].toLowerCase();
}
export function isCjk(code: string): boolean {
  return !!langInfo(code).cjk;
}

/** Chuẩn hoá mã trong dc:language về danh sách của web (zh-TW → zh-Hant, en-US → en…). */
export function normalizeLang(code: string): string {
  const c = (code || '').trim();
  if (!c) return '';
  if (/^zh[-_](tw|hk|mo|hant)/i.test(c)) return 'zh-Hant';
  return base(c);
}

// Một số chữ chỉ có ở dạng phồn thể / giản thể để phân biệt sơ bộ
const TRAD = /[這個們說來時會對發為們國學東車馬見長門開關書]/g;
const SIMP = /[这个们说来时会对发为们国学东车马见长门开关书]/g;

export interface Detected { code: string; confidence: number; reason: string }

/** Nhận diện ngôn ngữ gốc: ưu tiên dc:language, đối chiếu với loại chữ trong văn bản mẫu. */
export function detectLang(dcLanguage: string, sample: string): Detected {
  const s = sample.slice(0, 6000);
  const count = (re: RegExp) => (s.match(re) || []).length;
  const han = count(/\p{Script=Han}/gu);
  const kana = count(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const hangul = count(/\p{Script=Hangul}/gu);
  const cyr = count(/\p{Script=Cyrillic}/gu);
  const thai = count(/\p{Script=Thai}/gu);
  const latin = count(/\p{Script=Latin}/gu);
  const total = Math.max(1, han + kana + hangul + cyr + thai + latin);
  const pct = (n: number) => Math.round((n / total) * 100);
  const dc = normalizeLang(dcLanguage);

  let byScript = '';
  let share = 0;
  if (kana > total * 0.05) { byScript = 'ja'; share = pct(kana + han); }
  else if (hangul > total * 0.2) { byScript = 'ko'; share = pct(hangul); }
  else if (han > total * 0.3) { byScript = count(TRAD) > count(SIMP) ? 'zh-Hant' : 'zh'; share = pct(han); }
  else if (cyr > total * 0.3) { byScript = 'ru'; share = pct(cyr); }
  else if (thai > total * 0.3) { byScript = 'th'; share = pct(thai); }
  else if (latin > total * 0.5) { byScript = 'latin'; share = pct(latin); }

  if (byScript && byScript !== 'latin') {
    if (dc && base(dc) === base(byScript)) {
      return { code: dc === 'zh-Hant' ? dc : byScript, confidence: 0.95, reason: `dc:language = ${dcLanguage} · ${share}%` };
    }
    return { code: byScript, confidence: 0.8, reason: `${share}%` };
  }
  if (dc && !isCjk(dc)) return { code: dc, confidence: 0.9, reason: `dc:language = ${dcLanguage}` };
  if (dc) return { code: dc, confidence: 0.5, reason: `dc:language = ${dcLanguage}` };
  return { code: 'en', confidence: 0.3, reason: '?' };
}

/** Tuỳ chọn tên riêng theo ngôn ngữ gốc (khi dịch sang tiếng Việt). */
export function nameOptions(src: string, tgt: string): string[] {
  const b = base(src);
  if (base(tgt) !== 'vi') return ['giữ nguyên tên gốc, phiên âm theo thói quen của ngôn ngữ đích'];
  if (b === 'zh') return ['âm Hán Việt (ví dụ: 林逸 → Lâm Dật)', 'pinyin (ví dụ: 林逸 → Lin Yi)'];
  if (b === 'ja') return ['Romaji, giữ hậu tố -san, -kun, -chan…', 'Romaji, bỏ hậu tố kính ngữ'];
  if (b === 'ko') return ['Romaja (ví dụ: 김민지 → Kim Min-ji)', 'âm Hán Việt nếu tên có gốc Hán'];
  return ['giữ nguyên tên gốc'];
}

/** Tuỳ chọn xưng hô (chỉ có ý nghĩa khi dịch sang tiếng Việt). */
export function addressOptions(src: string, tgt: string): string[] {
  if (base(tgt) !== 'vi') return ['tự nhiên theo ngôn ngữ đích'];
  if (base(src) === 'zh') return ['cổ trang (ta – ngươi, huynh – muội, sư tôn – đồ nhi)', 'hiện đại (tôi – cậu, anh – em, chị – em)'];
  return ['hiện đại (tôi – cậu, anh – em, chị – em)', 'trang trọng (tôi – ngài, cô – cậu)', 'cổ trang (ta – ngươi)'];
}

export interface Preset { id: string; genre: string; src?: string; tgt?: string; address?: number }
export const PRESETS: Preset[] = [
  { id: 'xianxia', genre: 'tiên hiệp / huyền huyễn', src: 'zh', tgt: 'vi', address: 0 },
  { id: 'ancient', genre: 'ngôn tình cổ đại', src: 'zh', tgt: 'vi', address: 0 },
  { id: 'modern', genre: 'đô thị hiện đại', src: 'zh', tgt: 'vi', address: 1 },
  { id: 'lightnovel', genre: 'light novel', src: 'ja' },
  { id: 'webnovel', genre: 'tiểu thuyết mạng', src: 'ko' },
  { id: 'novel', genre: 'tiểu thuyết' },
  { id: 'custom', genre: '' },
];
export function presetsFor(src: string, tgt: string): Preset[] {
  return PRESETS.filter((p) => (!p.src || base(p.src) === base(src)) && (!p.tgt || base(p.tgt) === base(tgt)));
}

/** Ước tính token: chữ CJK ~1,1 token/chữ, chữ Latin… ~4 ký tự/token. */
export function estimateTokensFor(chars: number, src: string): number {
  return Math.round(isCjk(src) ? chars * 1.1 : chars / 3.5);
}
