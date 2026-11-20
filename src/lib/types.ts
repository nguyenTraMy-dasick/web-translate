// Kiểu dữ liệu dùng chung giữa giao diện (main thread) và worker dịch.

export type BookStatus = 'draft' | 'ready' | 'running' | 'paused' | 'done' | 'error';

export interface ChapterInfo {
  index: number;          // vị trí trong spine
  href: string;           // đường dẫn file trong zip (đầy đủ, ví dụ OEBPS/chapters/ch_001.xhtml)
  title: string;          // tiêu đề gốc (lấy từ mục lục, <title> hoặc thẻ heading đầu tiên)
  chars: number;          // số ký tự cần dịch
  blocks: number;         // số đoạn cần dịch
  selected: boolean;      // có dịch chương này không
  isNav: boolean;         // file mục lục EPUB3 (nav.xhtml)
}

export interface BookMeta {
  title: string;
  creator: string;
  translator: string;
  language: string;
  description: string;
  publisher: string;
  subjects: string[];
  fileName: string;
}

export interface GlossaryItem { src: string; dst: string; kind: string }

export interface PromptSettings {
  preset: string;          // id mẫu có sẵn
  genre: string;           // giá trị biến {the_loai}
  address: string;         // {xung_ho}
  names: string;           // {kieu_ten}
  template: string;        // nội dung prompt người dùng sửa được
  glossary: GlossaryItem[];
  model: string;           // để trống = dùng model riêng của từng key
  chunkChars: number;      // độ dài tối đa (ký tự) mỗi lần gửi
  temperature: number;
}

export interface BookOptions {
  translateToc: boolean;   // dịch tiêu đề chương & mục lục
  autoMeta: boolean;       // tự dịch tên truyện, tác giả, mô tả khi bắt đầu
  bilingual: boolean;      // chèn bản gốc dưới mỗi đoạn
}

export interface Book {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: BookStatus;
  statusDetail?: string;
  fileName: string;
  fileSize: number;
  opfPath: string;
  sourceLang: string;      // ngôn ngữ gốc (zh, ja, ko, en…)
  targetLang: string;      // ngôn ngữ dịch sang (mặc định vi)
  detectedLang?: { code: string; reason: string };
  original: { title: string; creator: string; language: string; description: string; publisher: string; subjects: string[]; images: number; coverHref?: string };
  meta: BookMeta;
  coverOverride?: { mime: string };   // có ảnh bìa mới (lưu ở store files với key `${id}:cover`)
  chapters: ChapterInfo[];
  tocLabels: string[];     // nhãn mục lục gốc (nav / ncx)
  prompt: PromptSettings;
  options: BookOptions;
  step: number;            // bước wizard cuối cùng đã tới
  progress: { done: number; total: number; errors: number; running: number };
  startedAt?: number;
}

export type ChunkStatus = 'pending' | 'running' | 'done' | 'error';

// Chương đặc biệt: -1 = nhãn mục lục, -2 = thông tin sách
export const CH_TOC = -1;
export const CH_META = -2;

export interface ChunkItem { id: string; text: string }

export interface Chunk {
  id: string;              // `${bookId}:${chapter}:${index}`
  bookId: string;
  chapter: number;         // index trong book.chapters, hoặc CH_TOC / CH_META
  index: number;
  items: ChunkItem[];      // đoạn gốc (id = b{số thứ tự đoạn trong chương})
  context: string;         // vài đoạn gốc phía trước, để giữ mạch
  status: ChunkStatus;
  result?: Record<string, string>;
  edited?: Record<string, string>;   // bản sửa tay, ưu tiên hơn result
  error?: string;
  attempts: number;
  keyLabel?: string;
  tokens?: number;
  updatedAt: number;
}

export type KeyState = 'ok' | 'cooldown' | 'quota' | 'invalid' | 'error' | 'untested';

export interface ApiKey {
  id: string;
  label: string;
  key: string;
  model: string;
  rpm: number;
  rpd: number;
  usedToday: number;
  usedDate: string;        // YYYY-MM-DD theo giờ máy
  state: KeyState;
  cooldownUntil: number;
  disabled: boolean;
  lastError?: string;
  models?: string[];       // danh sách model lấy từ API khi bấm Test
  createdAt: number;
}

export interface Settings {
  id: 'settings';
  rotation: 'roundrobin' | 'mostQuota';
  cooldownSec: number;
  concurrency: number;
  maxRetries: number;
  autoDisable: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings', rotation: 'roundrobin', cooldownSec: 60, concurrency: 3, maxRetries: 3, autoDisable: true,
};

export interface LogEntry {
  id?: number;
  bookId: string;
  at: number;
  level: 'ok' | 'warn' | 'err' | 'info';
  key?: string;
  msg: string;
}

// Tin nhắn giữa giao diện và worker
export type ToWorker =
  | { type: 'start'; bookId: string }
  | { type: 'pause' };

export type FromWorker =
  | { type: 'state'; bookId: string; status: BookStatus; detail?: string }
  | { type: 'progress'; bookId: string; progress: Book['progress'] }
  | { type: 'chunk'; chunk: Chunk }
  | { type: 'log'; entry: LogEntry }
  | { type: 'keys' };
