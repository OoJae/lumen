/**
 * A small token bucket for the routes that spend money.
 *
 * `/api/reflect` and `/api/transcribe` both hold a 0G Compute credential and
 * call a paid provider on every request. They are reachable by anyone who can
 * reach the deployment, with no account and no auth — so without this, one
 * script can drain the credential, and the first person to notice would be a
 * judge finding a dead demo.
 *
 * Deliberately in-memory and deliberately modest. Serverless instances are
 * short-lived and there are several of them, so this is a speed bump rather
 * than a wall — it turns "drain the key in a loop" into "run a distributed
 * attack", which is the right amount of effort for a hackathon deployment with
 * no Redis. It is described that way in the docs rather than sold as airtight.
 *
 * Pure and injectable: `now` is a parameter, so the whole thing is testable
 * without timers.
 */

export interface RateLimitRule {
  /** Tokens in a full bucket — the most requests allowed in a burst. */
  burst: number;
  /** Tokens added per second. */
  refillPerSecond: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Whole seconds until one more token exists. 0 when allowed. */
  retryAfterSeconds: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/** Bound the map so a spray of unique keys cannot grow it without limit. */
const MAX_TRACKED_KEYS = 5_000;

export function createRateLimiter(rule: RateLimitRule) {
  const buckets = new Map<string, Bucket>();

  function evictIfCrowded(now: number) {
    if (buckets.size < MAX_TRACKED_KEYS) return;
    // Drop anything already back to a full bucket — it carries no state worth
    // keeping, and this is cheaper than tracking an LRU.
    for (const [key, bucket] of buckets) {
      const refilled = bucket.tokens + ((now - bucket.updatedAt) / 1000) * rule.refillPerSecond;
      if (refilled >= rule.burst) buckets.delete(key);
    }
    // Still crowded after that: this is not a normal traffic pattern.
    if (buckets.size >= MAX_TRACKED_KEYS) buckets.clear();
  }

  return function take(key: string, now: number = Date.now()): RateLimitResult {
    evictIfCrowded(now);
    const existing = buckets.get(key);
    const tokens = existing
      ? Math.min(rule.burst, existing.tokens + ((now - existing.updatedAt) / 1000) * rule.refillPerSecond)
      : rule.burst;

    if (tokens < 1) {
      buckets.set(key, { tokens, updatedAt: now });
      return { allowed: false, retryAfterSeconds: Math.ceil((1 - tokens) / rule.refillPerSecond) };
    }

    buckets.set(key, { tokens: tokens - 1, updatedAt: now });
    return { allowed: true, retryAfterSeconds: 0 };
  };
}

/**
 * Best-effort client identity. Vercel sets `x-forwarded-for`; the leftmost entry
 * is the client. It is spoofable in general, which is precisely why this is a
 * speed bump and not an authorization boundary.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return headers.get('x-real-ip') ?? 'unknown';
}
