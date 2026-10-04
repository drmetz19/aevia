/**
 * Token bucket per kredensial, di memori proses ini.
 * CATATAN PRODUKSI: di Vercel (serverless) setiap instance punya memori sendiri, jadi batas ini hanya pagar kasar.
 * Untuk batas yang akurat lintas instance, ganti dengan penyimpanan bersama (mis. Redis/Upstash) di balik antarmuka yang sama.
 */
export interface RateLimitConfig {
  capacity: number;
  perSecond: number;
}
export const DEFAULT_RATE_LIMIT: RateLimitConfig = { capacity: 120, perSecond: 2 };

export class TokenBucketLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private cfg: RateLimitConfig = DEFAULT_RATE_LIMIT) {}

  take(key: string, nowMs: number): { ok: true } | { ok: false; retryAfterSeconds: number } {
    const b = this.buckets.get(key) ?? { tokens: this.cfg.capacity, at: nowMs };
    const elapsed = Math.max(0, nowMs - b.at) / 1000;
    b.tokens = Math.min(this.cfg.capacity, b.tokens + elapsed * this.cfg.perSecond);
    b.at = nowMs;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      this.buckets.set(key, b);
      return { ok: true };
    }
    this.buckets.set(key, b);
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - b.tokens) / this.cfg.perSecond)) };
  }
}
