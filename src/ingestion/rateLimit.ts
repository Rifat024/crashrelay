export interface RateLimiterOptions {
  windowMs?: number;
  max?: number;
  now?: () => number;
}

export interface RateLimiter {
  /** Returns true if the request for `key` is allowed under the current window. */
  allow(key: string): boolean;
}

/** In-memory sliding-window limiter, keyed by an arbitrary string (typically source IP). */
export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 30;
  const now = options.now ?? (() => Date.now());
  const hits = new Map<string, number[]>();

  return {
    allow(key: string): boolean {
      const currentTime = now();
      const windowStart = currentTime - windowMs;
      const timestamps = (hits.get(key) ?? []).filter((t) => t > windowStart);
      if (timestamps.length >= max) {
        hits.set(key, timestamps);
        return false;
      }
      timestamps.push(currentTime);
      hits.set(key, timestamps);
      return true;
    },
  };
}
