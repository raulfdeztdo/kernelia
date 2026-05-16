/**
 * Sliding-window rate limiter, in-memory.
 *
 * Bounded for the Hobby tier and a single admin surface — no Redis. State
 * lives in a `Map<string, number[]>` of timestamps per key. We prune on
 * each call so the map can't grow unbounded.
 *
 * Use with two keys (one per IP, one per email) and OR the results: deny
 * if either is over budget. See `lib/auth/login-flow.ts` and
 * `lib/auth/forgot-password-flow.ts`.
 */

export interface RateLimitOptions {
  /** Max events allowed inside `windowMs`. */
  max: number;
  /** Rolling window in ms. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Remaining events in the current window after this call. */
  remaining: number;
  /** ms until the oldest counted event ages out (`0` when allowed has room). */
  retryAfterMs: number;
}

interface Store {
  hits: Map<string, number[]>;
}

const globalStore: Store = {
  hits: new Map(),
};

/**
 * Reads the current bucket state for `key` WITHOUT recording a new event.
 * Used by surfaces that only want to charge the bucket on certain paths
 * (e.g. login charges per-email only on failures, not successes).
 */
export function peekRateLimit(
  key: string,
  opts: RateLimitOptions,
  store: Store = globalStore,
  now: number = Date.now(),
): RateLimitResult {
  const windowStart = now - opts.windowMs;
  const arr = (store.hits.get(key) ?? []).filter((t) => t > windowStart);
  if (arr.length >= opts.max) {
    const oldest = arr[0] ?? now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, oldest + opts.windowMs - now),
    };
  }
  return { allowed: true, remaining: Math.max(0, opts.max - arr.length), retryAfterMs: 0 };
}

/**
 * Records an event for `key` and returns whether it is allowed. Caller is
 * expected to consult the result before performing the work.
 */
export function consumeRateLimit(
  key: string,
  opts: RateLimitOptions,
  store: Store = globalStore,
  now: number = Date.now(),
): RateLimitResult {
  const windowStart = now - opts.windowMs;
  const arr = store.hits.get(key) ?? [];
  // Drop events outside the window. Array stays small so linear filter is fine.
  const pruned = arr.filter((t) => t > windowStart);

  if (pruned.length >= opts.max) {
    store.hits.set(key, pruned);
    const oldest = pruned[0] ?? now;
    const retryAfterMs = Math.max(0, oldest + opts.windowMs - now);
    return { allowed: false, remaining: 0, retryAfterMs };
  }
  pruned.push(now);
  store.hits.set(key, pruned);
  return {
    allowed: true,
    remaining: Math.max(0, opts.max - pruned.length),
    retryAfterMs: 0,
  };
}

/**
 * Test-only: reset the global counter store between specs.
 */
export function _resetRateLimitForTests(): void {
  globalStore.hits.clear();
}
