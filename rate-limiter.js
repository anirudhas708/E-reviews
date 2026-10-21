'use strict';

/**
 * Small in-memory sliding-window limiter.
 * Good enough for a single-process deployment; put a shared store
 * (e.g. Redis) behind the same interface if you scale out.
 */
class RateLimiter {
  constructor({ max, windowMs }) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
    this.timer = setInterval(() => this.sweep(), 60 * 1000);
    this.timer.unref();
  }

  recent(key, now) {
    const kept = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (kept.length > 0) this.hits.set(key, kept);
    else this.hits.delete(key);
    return kept;
  }

  isLimited(key) {
    return this.recent(key, Date.now()).length >= this.max;
  }

  retryAfterSeconds(key) {
    const now = Date.now();
    const kept = this.recent(key, now);
    if (kept.length === 0) return 0;
    return Math.max(1, Math.ceil((kept[0] + this.windowMs - now) / 1000));
  }

  hit(key) {
    const now = Date.now();
    const kept = this.recent(key, now);
    kept.push(now);
    this.hits.set(key, kept);
  }

  reset(key) {
    this.hits.delete(key);
  }

  sweep() {
    const now = Date.now();
    for (const key of [...this.hits.keys()]) this.recent(key, now);
  }

  close() {
    clearInterval(this.timer);
  }
}

module.exports = { RateLimiter };
