// Per-IP rate limiting for auth-flow endpoints that send transactional
// email (signup verification, password reset). Stops bot-driven Resend
// quota exhaustion that would otherwise lock real users out of the
// verification flow.
//
// Pattern is the sliding-window from routes/waitlist.ts, lifted into a
// small reusable factory so each surface gets its own per-IP budget
// without leaking capacity across surfaces.
//
// Why a separate budget per endpoint (rather than one global counter):
// signup vs password-reset have very different abuse profiles. A single
// IP can plausibly retry a password reset 2-3 times (typo, lost email),
// but should not register 30 accounts/hour from the same address.

import type { Context, MiddlewareHandler } from 'hono';
import { extractIp, isRateLimitDisabled } from './rate-limit.js';

interface WindowEntry {
  currentStart: number;
  currentCount: number;
  previousCount: number;
  windowMs: number;
}

interface RateLimitConfig {
  /** Stable key for this surface, used in error logs + the store map. */
  scope: string;
  /** Max requests from a single IP in the rolling window. */
  perIpPerHour: number;
  /** Max requests across ALL IPs in a rolling 24h window. Null = no global cap. */
  globalPerDay: number | null;
}

/**
 * Returns a Hono middleware that enforces per-IP + optional global
 * rate limits for the configured scope. Independent stores per scope
 * so signup + password-reset don't share budgets.
 *
 * Returns 429 with structured JSON: { error, scope, retry_after_seconds }
 * + Retry-After header so well-behaved clients back off correctly.
 */
export function createAuthRateLimit(config: RateLimitConfig): MiddlewareHandler {
  const perIpStore = new Map<string, WindowEntry>();
  const globalStore: WindowEntry = {
    currentStart: Date.now(),
    currentCount: 0,
    previousCount: 0,
    windowMs: 24 * 60 * 60 * 1000,
  };

  return async (c, next) => {
    if (isRateLimitDisabled()) return next();

    const ip = extractIp(c) || 'unknown';
    const ipOk = incrementAndCheck(perIpStore, `${config.scope}:${ip}`, config.perIpPerHour, 60 * 60 * 1000);
    if (!ipOk) {
      return rateLimitResponse(c, config.scope, 'per_ip', 60 * 60);
    }

    if (config.globalPerDay !== null) {
      const globalOk = incrementGlobalAndCheck(globalStore, config.globalPerDay);
      if (!globalOk) {
        return rateLimitResponse(c, config.scope, 'global_daily', 24 * 60 * 60);
      }
    }

    return next();
  };
}

/**
 * Sliding-window check: increments the counter for `key` and returns
 * true if the running weighted total is <= limit. Same algorithm as
 * routes/waitlist.ts (kept duplicated rather than imported to keep
 * each store independent).
 */
function incrementAndCheck(
  store: Map<string, WindowEntry>,
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const halfMs = windowMs / 2;
  const entry = store.get(key);
  if (!entry) {
    store.set(key, { currentStart: now, currentCount: 1, previousCount: 0, windowMs });
    return 1 <= limit;
  }
  const elapsed = now - entry.currentStart;
  if (elapsed >= halfMs) {
    const halves = Math.floor(elapsed / halfMs);
    entry.previousCount = halves >= 2 ? 0 : entry.currentCount;
    entry.currentCount = 0;
    entry.currentStart = entry.currentStart + halves * halfMs;
  }
  entry.currentCount += 1;
  const weight = Math.max(0, 1 - (now - entry.currentStart) / halfMs);
  const count = entry.currentCount + Math.floor(entry.previousCount * weight);
  return count <= limit;
}

function incrementGlobalAndCheck(entry: WindowEntry, limit: number): boolean {
  const now = Date.now();
  const halfMs = entry.windowMs / 2;
  const elapsed = now - entry.currentStart;
  if (elapsed >= halfMs) {
    const halves = Math.floor(elapsed / halfMs);
    entry.previousCount = halves >= 2 ? 0 : entry.currentCount;
    entry.currentCount = 0;
    entry.currentStart = entry.currentStart + halves * halfMs;
  }
  entry.currentCount += 1;
  const weight = Math.max(0, 1 - (now - entry.currentStart) / halfMs);
  const count = entry.currentCount + Math.floor(entry.previousCount * weight);
  return count <= limit;
}

function rateLimitResponse(
  c: Context,
  scope: string,
  reason: 'per_ip' | 'global_daily',
  retryAfterSeconds: number,
) {
  c.header('Retry-After', String(retryAfterSeconds));
  return c.json(
    {
      error: 'rate_limit_exceeded',
      scope,
      reason,
      retry_after_seconds: retryAfterSeconds,
    },
    429,
  );
}
