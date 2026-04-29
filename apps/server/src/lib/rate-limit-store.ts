import type { Context, MiddlewareHandler } from 'hono';
import { hasValidAdminBearer } from './auth.js';
import { extractIp } from './client-ip.js';
import { isRateLimitDisabled } from './rate-limit.js';

interface WindowEntry {
  currentStart: number;
  currentCount: number;
  previousCount: number;
  windowMs: number;
}

interface CheckResult {
  allowed: boolean;
  retryAfterSec: number;
}

export interface CreateRateLimitOptions {
  key: string;
  perIpPerHour: number;
  globalPerDay?: number | null;
}

const store = new Map<string, WindowEntry>();
let lastSweep = 0;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function normalizeLimit(raw: number | null | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.floor(raw);
}

function maybeSweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, entry] of store) {
    if (now - entry.currentStart > entry.windowMs * 2) store.delete(key);
  }
}

function incrementAndCheck(key: string, limit: number, windowMs: number, now: number): CheckResult {
  maybeSweep(now);
  const halfMs = windowMs / 2;
  const entry = store.get(key);

  if (!entry) {
    store.set(key, {
      currentStart: now,
      currentCount: 1,
      previousCount: 0,
      windowMs,
    });
    return {
      allowed: 1 <= limit,
      retryAfterSec: Math.ceil(windowMs / 1000),
    };
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
  const retryAfterMs = Math.max(1000, entry.currentStart + windowMs - now);
  return {
    allowed: count <= limit,
    retryAfterSec: Math.ceil(retryAfterMs / 1000),
  };
}

function rateLimitResponse(
  c: Context,
  reason: 'per_ip_per_hour' | 'global_per_day',
  retryAfterSec: number,
): Response {
  return c.json(
    {
      error: 'rate_limited',
      reason,
      retry_after_seconds: retryAfterSec,
    },
    429,
    { 'Retry-After': String(retryAfterSec) },
  );
}

export function createRateLimit(options: CreateRateLimitOptions): MiddlewareHandler {
  const perIpLimit = normalizeLimit(options.perIpPerHour);
  const globalLimit = normalizeLimit(options.globalPerDay);
  const safeKey = options.key.replace(/[^a-zA-Z0-9:_-]/g, '_');

  return async (c, next) => {
    if (isRateLimitDisabled() || hasValidAdminBearer(c)) {
      return next();
    }

    const now = Date.now();
    if (perIpLimit !== null) {
      const ip = extractIp(c).trim() || 'unknown';
      const result = incrementAndCheck(`${safeKey}:ip:${ip}`, perIpLimit, HOUR_MS, now);
      if (!result.allowed) {
        return rateLimitResponse(c, 'per_ip_per_hour', result.retryAfterSec);
      }
    }

    if (globalLimit !== null) {
      const result = incrementAndCheck(`${safeKey}:global`, globalLimit, DAY_MS, now);
      if (!result.allowed) {
        return rateLimitResponse(c, 'global_per_day', result.retryAfterSec);
      }
    }

    return next();
  };
}

/** Reset the shared auth-flow/waitlist store. Exported for tests. */
export function __resetSharedRateLimitStoreForTests(): void {
  store.clear();
  lastSweep = 0;
}
