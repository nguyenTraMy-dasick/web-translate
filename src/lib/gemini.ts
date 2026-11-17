// Gọi Gemini API trực tiếp từ trình duyệt (không qua server trung gian).
// Không dùng DOM nên chạy được trong Web Worker.

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const DEFAULT_MODEL = 'gemini-flash-latest';

export type GeminiErrorKind = 'rate' | 'quota' | 'auth' | 'model' | 'safety' | 'format' | 'server' | 'network' | 'aborted' | 'other';

export class GeminiError extends Error {
  kind: GeminiErrorKind;
  status: number;
  retryAfterMs?: number;
  constructor(kind: GeminiErrorKind, message: string, status = 0, retryAfterMs?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

interface GenerateArgs {
  key: string;
  model: string;
  system?: string;
  user: string;
  temperature?: number;
  json?: boolean;
  signal?: AbortSignal;
}

export interface GenerateResult { text: string; tokens: number }

function parseDelay(s: unknown): number | undefined {
  if (typeof s !== 'string') return undefined;
  const m = s.match(/^([\d.]+)s$/);
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : undefined;
}

async function toError(res: Response): Promise<GeminiError> {
  let body: any = null;
  let raw = '';
  try { raw = await res.text(); body = JSON.parse(raw); } catch { /* không phải JSON */ }
  const err = body?.error ?? {};
  const msg: string = err.message || raw.slice(0, 300) || res.statusText;
  const details: any[] = Array.isArray(err.details) ? err.details : [];
  const reason = details.map((d) => d?.reason).filter(Boolean).join(',');
  let retry: number | undefined;
  for (const d of details) {
    if (String(d?.['@type'] || '').includes('RetryInfo')) retry = parseDelay(d.retryDelay);
  }
  const s = res.status;
  if (s === 429) {
    // Hết quota theo ngày khác với giới hạn theo phút
    const perDay = /PerDay|per day|daily/i.test(raw);
    return new GeminiError(perDay ? 'quota' : 'rate', msg, s, retry);
  }
  if (s === 401 || s === 403 || reason.includes('API_KEY_INVALID') || /API key not valid/i.test(msg)) {
    return new GeminiError('auth', msg, s);
  }
  if (s === 404) return new GeminiError('model', msg, s);
  if (s >= 500) return new GeminiError('server', msg, s);
  return new GeminiError('other', msg, s);
}

export async function generate(a: GenerateArgs): Promise<GenerateResult> {
  const model = (a.model || DEFAULT_MODEL).replace(/^models\//, '');
  const body: any = {
    contents: [{ role: 'user', parts: [{ text: a.user }] }],
    generationConfig: {
      temperature: a.temperature ?? 0.7,
      ...(a.json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  if (a.system) body.systemInstruction = { parts: [{ text: a.system }] };

  let res: Response;
  try {
    res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': a.key },
      body: JSON.stringify(body),
      signal: a.signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new GeminiError('aborted', 'aborted');
    throw new GeminiError('network', e?.message || 'network error');
  }
  if (!res.ok) throw await toError(res);

  const data: any = await res.json();
  const blocked = data?.promptFeedback?.blockReason;
  if (blocked) throw new GeminiError('safety', `blocked: ${blocked}`);
  const cand = data?.candidates?.[0];
  const finish: string = cand?.finishReason || '';
  if (['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION'].includes(finish)) {
    throw new GeminiError('safety', `finishReason: ${finish}`);
  }
  const text = (cand?.content?.parts || []).filter((p: any) => !p.thought).map((p: any) => p.text || '').join('');
  if (!text) throw new GeminiError('format', `empty response (${finish || 'no candidate'})`);
  if (finish === 'MAX_TOKENS') throw new GeminiError('format', 'output truncated (MAX_TOKENS)');
  return { text, tokens: data?.usageMetadata?.totalTokenCount ?? 0 };
}

/** Lấy danh sách model dùng được với generateContent — cũng là cách kiểm tra key. */
export async function listModels(key: string): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/models?pageSize=1000`, { headers: { 'x-goog-api-key': key } });
  } catch (e: any) {
    throw new GeminiError('network', e?.message || 'network error');
  }
  if (!res.ok) throw await toError(res);
  const data: any = await res.json();
  const skip = /(tts|image|imagen|live|audio|embedding|aqa|veo|robotics|transcribe|banana|omni|computer-use)/i;
  return (data.models || [])
    .filter((m: any) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m: any) => String(m.name).replace(/^models\//, ''))
    .filter((n: string) => n.startsWith('gemini') && !skip.test(n))
    .sort();
}

/** Chọn model mặc định hợp lý từ danh sách: ưu tiên bản Flash (không Lite), mới nhất. */
export function pickDefaultModel(models: string[]): string {
  if (models.includes(DEFAULT_MODEL)) return DEFAULT_MODEL;
  const flash = models.filter((m) => /flash/.test(m) && !/lite|preview|exp/.test(m));
  const byVer = (m: string) => parseFloat((m.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || '0');
  flash.sort((a, b) => byVer(b) - byVer(a));
  return flash[0] || models[0] || DEFAULT_MODEL;
}
