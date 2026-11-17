// Logic luân phiên API key — hàm thuần, dùng chung cho worker và giao diện.
import type { ApiKey, Settings } from './types';

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Cập nhật trạng thái theo thời gian: qua ngày mới thì reset lượt, hết giờ nghỉ thì dùng lại. */
export function refreshKey(k: ApiKey, now = Date.now()): ApiKey {
  const t = today();
  if (k.usedDate !== t) {
    k.usedDate = t;
    k.usedToday = 0;
    if (k.state === 'quota') k.state = 'ok';
  }
  if (k.state === 'cooldown' && k.cooldownUntil <= now) k.state = 'ok';
  return k;
}

/** Cửa sổ trượt 60 giây cho giới hạn request/phút, giữ trong bộ nhớ. */
export class RpmWindows {
  private map = new Map<string, number[]>();
  hit(id: string, now = Date.now()) {
    const arr = this.recent(id, now);
    arr.push(now);
    this.map.set(id, arr);
  }
  recent(id: string, now = Date.now()): number[] {
    return (this.map.get(id) || []).filter((t) => now - t < 60_000);
  }
  /** ms cho tới khi key có thể nhận request tiếp theo theo RPM (0 = ngay). */
  waitFor(k: ApiKey, now = Date.now()): number {
    if (!k.rpm || k.rpm <= 0) return 0;
    const r = this.recent(k.id, now);
    if (r.length < k.rpm) return 0;
    return 60_000 - (now - r[0]) + 50;
  }
}

/** Key có bao giờ dùng lại được trong phiên này không (không tính hết quota ngày). */
export function isAlive(k: ApiKey): boolean {
  return !k.disabled && k.state !== 'invalid' && k.state !== 'error';
}

export function availableNow(k: ApiKey, win: RpmWindows, inflight: Map<string, number>, now = Date.now()): boolean {
  refreshKey(k, now);
  if (!isAlive(k)) return false;
  if (k.state === 'quota') return false;
  if (k.state === 'cooldown' && k.cooldownUntil > now) return false;
  if (k.rpd > 0 && k.usedToday >= k.rpd) { k.state = 'quota'; return false; }
  if (win.waitFor(k, now) > 0) return false;
  // Không dồn quá nhiều request song song lên cùng một key
  if ((inflight.get(k.id) || 0) >= Math.max(1, Math.ceil((k.rpm || 10) / 5))) return false;
  return true;
}

export function pickKey(
  keys: ApiKey[], s: Settings, win: RpmWindows, inflight: Map<string, number>, rr: { i: number }, now = Date.now(),
): ApiKey | null {
  const ok = keys.filter((k) => availableNow(k, win, inflight, now));
  if (!ok.length) return null;
  if (s.rotation === 'mostQuota') {
    const left = (k: ApiKey) => (k.rpd > 0 ? k.rpd - k.usedToday : Number.MAX_SAFE_INTEGER) - (inflight.get(k.id) || 0);
    return ok.sort((a, b) => left(b) - left(a))[0];
  }
  // Lần lượt: đi tiếp từ vị trí lần trước trong danh sách đầy đủ
  for (let step = 0; step < keys.length; step++) {
    const k = keys[(rr.i + step) % keys.length];
    if (ok.includes(k)) { rr.i = (keys.indexOf(k) + 1) % keys.length; return k; }
  }
  return ok[0];
}

/** ms cho tới khi có key dùng được; null nếu không còn key nào dùng được hôm nay. */
export function nextAvailableIn(keys: ApiKey[], win: RpmWindows, now = Date.now()): number | null {
  let best: number | null = null;
  for (const k of keys) {
    refreshKey(k, now);
    if (!isAlive(k) || k.state === 'quota') continue;
    if (k.rpd > 0 && k.usedToday >= k.rpd) continue;
    let w = 0;
    if (k.state === 'cooldown') w = Math.max(w, k.cooldownUntil - now);
    w = Math.max(w, win.waitFor(k, now));
    best = best === null ? w : Math.min(best, w);
  }
  return best;
}

export function maskKey(key: string): string {
  if (key.length <= 10) return '••••';
  return key.slice(0, 4) + '•'.repeat(10) + key.slice(-4);
}
