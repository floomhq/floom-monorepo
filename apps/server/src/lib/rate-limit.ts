// In-memory sliding-window rate limiter for Floom run surfaces.
// Enforces three budgets per run: per-IP anon, per-user authed, per-(IP,
// app). Plus a separate per-user/IP cap on the MCP `ingest_app` tool.
//
// Storage: process-local Map, resets on restart. Good enough for
// single-replica preview. TODO: swap for Redis when Floom goes multi-replica.
// Window: two weighted half-buckets. Node is single-threaded so the read-
// modify-write is atomic per tick — safe under concurrent requests.
// Escape: FLOOM_RATE_LIMIT_DISABLED=true skips every check.

import type { Context, MiddlewareHandler } from 'hono';
import type { SessionContext } from '../types.js';
import { hasValidAdminBearer } from './auth.js';
import { extractIp } from './client-ip.js';
import { recordRateLimitHit } from './metrics-counters.js';
import { sendDiscordAlert } from './alerts.js';

type Scope = 'ip' | 'user' | 'app' | 'mcp_ingest' | 'write' | 'read-heavy';

/**
 * Policy tier for the generic rate-limit middleware. Each tier has its own
 * per-IP + per-user caps (see `defaultWrite*PerHour` / `defaultReadHeavy*PerHour`).
 *
 * - `write`: mutating endpoints (POST/PATCH/PUT/DELETE) that aren't run
 *   surfaces. Standard cap — slightly tighter than `run` because there's no
 *   per-slug bucket to absorb bursts.
 * - `read-heavy`: list/search/scan endpoints that return many rows and are a
 *   scraping vector (e.g. `/api/hub` directory, `/api/me/runs` history,
 *   `/api/session/me` identity probe). Lower cap to make mass enumeration
 *   expensive without hurting normal users.
 */
export type PolicyTier = 'write' | 'read-heavy';

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const isRateLimitDisabled = (): boolean =>
  process.env.FLOOM_RATE_LIMIT_DISABLED === 'true';
// Defaults bumped 2026-04-19 (issue #128): prior 20/200/50 were too tight for
// headless/integration/CI use and NAT'd offices. Anon 60/hr per IP covers a
// small team sharing an egress IP plus normal browser usage; authed 300/hr
// per user rewards sign-in with 5× anon headroom; per-(IP, app) 500/hr stops
// a single slug from monopolizing the process while still allowing bursty
// automations.
//
// Bumped again 2026-04-21 (pre-launch): anon raised 60 → 150 to absorb
// launch-day traffic. Shared NAT IPs (offices, mobile carriers, university
// networks), HN frontpage spikes, and demo embeds on the landing page all
// collapse onto a handful of source IPs, so 60/hr was tripping legitimate
// multi-user traffic. 150 keeps the per-client bucket tight enough to stop
// single-origin abuse while leaving room for 2-3 people behind one IP.
export const defaultAnonPerHour = (): number =>
  envNumber('FLOOM_RATE_LIMIT_IP_PER_HOUR', 150);
export const defaultUserPerHour = (): number =>
  envNumber('FLOOM_RATE_LIMIT_USER_PER_HOUR', 300);
export const defaultPerAppPerHour = (): number =>
  envNumber('FLOOM_RATE_LIMIT_APP_PER_HOUR', 500);
export const defaultMcpIngestPerDay = (): number =>
  envNumber('FLOOM_RATE_LIMIT_MCP_INGEST_PER_DAY', 10);

// Tiered caps (issue #600, 2026-04-23). Defense-in-depth on every mutation
// and heavy read endpoint. `write` is tighter than `run` because there's no
// per-slug bucket to share across apps, and writes typically do a database
// round-trip regardless of payload. `read-heavy` is tightest — these are
// list/search/identity-probe endpoints that are the most attractive scraping
// targets. All are independently tunable at boot.
export const defaultWriteIpPerHour = (): number =>
  envNumber('FLOOM_RATE_LIMIT_WRITE_IP_PER_HOUR', 120);
export const defaultWriteUserPerHour = (): number =>
  envNumber('FLOOM_RATE_LIMIT_WRITE_USER_PER_HOUR', 600);
export const defaultReadHeavyIpPerHour = (): number =>
  envNumber('FLOOM_RATE_LIMIT_READ_HEAVY_IP_PER_HOUR', 90);
export const defaultReadHeavyUserPerHour = (): number =>
  envNumber('FLOOM_RATE_LIMIT_READ_HEAVY_USER_PER_HOUR', 900);

// Re-export: historical import path is ../lib/rate-limit.js
export { extractIp } from './client-ip.js';

// ---------- sliding-window store ----------

interface WindowEntry {
  currentStart: number;
  currentCount: number;
  previousCount: number;
  windowMs: number;
}

const store = new Map<string, WindowEntry>();
let lastSweep = 0;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** Reset the store. Exported for tests; not used in production. */
export function __resetStoreForTests(): void {
  store.clear();
  lastSweep = 0;
}

function maybeSweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, entry] of store) {
    if (now - entry.currentStart > entry.windowMs * 2) store.delete(key);
  }
}

interface CheckResult {
  allowed: boolean;
  retryAfterSec: number;
  /** Effective count within the current sliding window. */
  count: number;
  /** Weighted-window budget remaining after this increment. Never negative. */
  remaining: number;
  /** Epoch seconds when the current window's earliest activity rolls off. */
  resetAt: number;
}

function incrementAndCheck(
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): CheckResult {
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
    const allowed = 1 <= limit;
    return {
      allowed,
      retryAfterSec: allowed ? 0 : Math.ceil(windowMs / 1000),
      count: 1,
      remaining: Math.max(0, limit - 1),
      resetAt: Math.ceil((now + windowMs) / 1000),
    };
  }

  const elapsed = now - entry.currentStart;
  if (elapsed >= halfMs) {
    // Advance: current → previous; skip idle half-windows. Idle >= full
    // window wipes both halves.
    const halves = Math.floor(elapsed / halfMs);
    entry.previousCount = halves >= 2 ? 0 : entry.currentCount;
    entry.currentCount = 0;
    entry.currentStart = entry.currentStart + halves * halfMs;
  }
  entry.currentCount += 1;

  // Weighted slide: previous half decays linearly across the current half.
  const weight = Math.max(0, 1 - (now - entry.currentStart) / halfMs);
  const count = entry.currentCount + Math.floor(entry.previousCount * weight);
  const resetAt = Math.ceil((entry.currentStart + windowMs) / 1000);

  if (count <= limit) {
    return {
      allowed: true,
      retryAfterSec: 0,
      count,
      remaining: Math.max(0, limit - count),
      resetAt,
    };
  }
  const retryAfterMs = Math.max(1000, entry.currentStart + windowMs - now);
  return {
    allowed: false,
    retryAfterSec: Math.ceil(retryAfterMs / 1000),
    count,
    remaining: 0,
    resetAt,
  };
}

// ---------- response helpers ----------

// Cap the public retry-after at 5 minutes. The sliding window is an hour,
// so on a cold bucket the true "seconds until under limit" can exceed 2500s.
// Telling a user "come back in 46 minutes" looks broken and wastes retries;
// capping at 300s produces a predictable "try again in a few minutes" UX
// while the internal sliding window keeps enforcing the real budget.
const RETRY_AFTER_CLAMP_SEC = 300;

function clampRetryAfter(sec: number): number {
  return Math.min(sec, RETRY_AFTER_CLAMP_SEC);
}

// ---------- abuse alerting ----------
//
// One IP tripping many 429s in a short window is an abuse signal (scraper,
// stuck retry loop, credential-stuffing bot). Track per-IP 429 counts in a
// rolling 5-min window; when a threshold trips, fire one Discord alert and
// debounce for an hour so a sustained attack doesn't spam the channel.
interface AbuseWindow {
  windowStart: number;
  count: number;
  lastAlertAt: number;
}
const abuseStore = new Map<string, AbuseWindow>();
const ABUSE_WINDOW_MS = 5 * 60 * 1000;
const ABUSE_THRESHOLD = 10;
const ABUSE_ALERT_COOLDOWN_MS = 60 * 60 * 1000;

function noteRateLimitHitForAbuse(ip: string, scope: Scope, now: number): void {
  // Skip authed-user 429s (misconfigured client, not abuse) and unknown IPs.
  if (scope === 'user') return;
  if (ip === 'unknown') return;
  let entry = abuseStore.get(ip);
  if (!entry || now - entry.windowStart > ABUSE_WINDOW_MS) {
    entry = { windowStart: now, count: 0, lastAlertAt: entry?.lastAlertAt ?? 0 };
    abuseStore.set(ip, entry);
  }
  entry.count += 1;
  if (entry.count >= ABUSE_THRESHOLD && now - entry.lastAlertAt > ABUSE_ALERT_COOLDOWN_MS) {
    entry.lastAlertAt = now;
    // Mask IPv4 last octet; truncate IPv6. Actionable signal without
    // splashing raw PII into Discord.
    const masked = ip.includes('.')
      ? ip.replace(/\.\d+$/, '.xxx')
      : ip.replace(/(:[0-9a-f]+){5,}$/i, ':xxxx');
    sendDiscordAlert(
      'Floom abuse: repeated 429s',
      `IP \`${masked}\` tripped ${entry.count} rate-limits in ${Math.round(ABUSE_WINDOW_MS / 60000)}m.`,
      { scope },
    );
  }
  if (entry.count > 10_000) entry.count = 10_000;
}

/** Reset the abuse store. Exported for tests. */
export function __resetAbuseStoreForTests(): void {
  abuseStore.clear();
}

function rateLimitResponse(
  c: Context,
  scope: Scope,
  result: CheckResult,
  limit: number,
): Response {
  recordRateLimitHit(scope);
  noteRateLimitHitForAbuse(extractIp(c), scope, Date.now());
  const retryAfter = clampRetryAfter(result.retryAfterSec);
  return c.json(
    {
      error: 'rate_limit_exceeded',
      retry_after_seconds: retryAfter,
      scope,
    },
    429,
    {
      'Retry-After': String(retryAfter),
      'X-RateLimit-Limit': String(limit),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(result.resetAt),
      'X-RateLimit-Scope': scope,
    },
  );
}

/**
 * Attach X-RateLimit-* headers to a successful response so clients can back
 * off pre-emptively. Hono sets response headers on `c.header()` before the
 * handler returns; it's safe to call from middleware prior to `next()`.
 */
function applyLimitHeaders(
  c: Context,
  result: CheckResult,
  limit: number,
  scope: Scope,
): void {
  c.header('X-RateLimit-Limit', String(limit));
  c.header('X-RateLimit-Remaining', String(result.remaining));
  c.header('X-RateLimit-Reset', String(result.resetAt));
  c.header('X-RateLimit-Scope', scope);
}

// ---------- middleware ----------

/**
 * Single middleware covering anon + authed + per-app caps. `resolveCtx` is
 * injected so tests can pass a cheap stub instead of pulling in the real
 * Better Auth lookup.
 */
export function runRateLimitMiddleware(
  resolveCtx: (c: Context) => Promise<SessionContext>,
): MiddlewareHandler {
  return async (c, next) => {
    if (isRateLimitDisabled()) return next();
    // Admin bypass (2026-04-21): when FLOOM_AUTH_TOKEN is configured AND
    // the caller presents the matching bearer, skip rate-limit entirely.
    // This unblocks ops sweeps, monitoring, and catalog rebuilds from the
    // server operator without opening the limit up publicly. Returns false
    // when no token is configured, so OSS mode still enforces the caps.
    if (hasValidAdminBearer(c)) return next();
    const now = Date.now();
    const windowMs = 3600 * 1000;
    const ip = extractIp(c);
    const ctx = await resolveCtx(c);

    // Authed → user bucket (higher cap). Anon → IP bucket.
    const primaryKey = ctx.is_authenticated ? `user:${ctx.user_id}` : `ip:${ip}`;
    const primaryCap = ctx.is_authenticated
      ? defaultUserPerHour()
      : defaultAnonPerHour();
    const primaryScope: Scope = ctx.is_authenticated ? 'user' : 'ip';
    const p = incrementAndCheck(primaryKey, primaryCap, windowMs, now);
    if (!p.allowed) return rateLimitResponse(c, primaryScope, p, primaryCap);

    // Per-(IP, app) cap applies in both auth states.
    const slug = c.req.param('slug');
    if (slug) {
      const appCap = defaultPerAppPerHour();
      const r = incrementAndCheck(`app:${ip}:${slug}`, appCap, windowMs, now);
      if (!r.allowed) return rateLimitResponse(c, 'app', r, appCap);
      // Advertise the *tightest* remaining budget so a well-behaved client
      // paces itself against whichever bucket will trip first. Primary vs
      // per-app: pick the smaller remaining.
      if (r.remaining < p.remaining) applyLimitHeaders(c, r, appCap, 'app');
      else applyLimitHeaders(c, p, primaryCap, primaryScope);
    } else {
      applyLimitHeaders(c, p, primaryCap, primaryScope);
    }
    return next();
  };
}

/**
 * Tiered middleware for non-run write + read-heavy endpoints (#600).
 *
 * Separate from `runRateLimitMiddleware` on purpose: run surfaces want the
 * per-(IP, app) bucket so one slug can't monopolize the process, but writes
 * (create workspace, upsert secret, edit trigger) and heavy reads (hub
 * directory, session probe) have no app context. Keying on IP + user is
 * enough.
 *
 * The primary key (IP when anon, user when authed) and the stored window are
 * deliberately namespaced with the tier so `write` and `read-heavy` don't
 * share a bucket with each other or with `run`. A user who pulls their run
 * history (`read-heavy`) still has full headroom to create a workspace
 * (`write`) in the same hour.
 *
 * Admin bearer (`FLOOM_AUTH_TOKEN`) bypasses the check — same policy as
 * `runRateLimitMiddleware`. FLOOM_RATE_LIMIT_DISABLED=true skips every tier.
 */
export function genericRateLimitMiddleware(
  tier: PolicyTier,
  resolveCtx: (c: Context) => Promise<SessionContext>,
): MiddlewareHandler {
  return async (c, next) => {
    if (isRateLimitDisabled()) return next();
    if (hasValidAdminBearer(c)) return next();
    const now = Date.now();
    const windowMs = 3600 * 1000;
    const ip = extractIp(c);
    const ctx = await resolveCtx(c);

    const anonCap =
      tier === 'write' ? defaultWriteIpPerHour() : defaultReadHeavyIpPerHour();
    const userCap =
      tier === 'write'
        ? defaultWriteUserPerHour()
        : defaultReadHeavyUserPerHour();

    const primaryKey = ctx.is_authenticated
      ? `${tier}:user:${ctx.user_id}`
      : `${tier}:ip:${ip}`;
    const primaryCap = ctx.is_authenticated ? userCap : anonCap;
    const r = incrementAndCheck(primaryKey, primaryCap, windowMs, now);
    if (!r.allowed) return rateLimitResponse(c, tier, r, primaryCap);
    applyLimitHeaders(c, r, primaryCap, tier);
    return next();
  };
}

/**
 * Paths already covered by `runRateLimitMiddleware` (the `run` tier with
 * per-slug buckets). These MUST pass through the generic `write` tier
 * un-touched so we don't double-charge a single request against two
 * buckets. Matching is prefix-based because sub-paths like
 * `/api/hub/ingest/...` shouldn't exist today but adding them later
 * shouldn't silently introduce a double-charge.
 */
/**
 * Exact paths already covered by `runRateLimitMiddleware` — the `run` tier
 * with per-slug buckets. These MUST pass through the generic `write` tier
 * un-touched so we don't double-charge a single request against two
 * buckets.
 *
 * Only exact matches or explicit sub-paths count here; `/api/run/:id/share`
 * is NOT a run-tier path even though it shares the `/api/run` prefix — it's
 * a share-link write and belongs in the generic `write` tier.
 */
function isRunTierPath(path: string): boolean {
  // Root run endpoints (exact match).
  if (path === '/api/run') return true;
  if (path === '/api/hub/ingest') return true;
  // MCP per-app: /mcp/app/:slug and any sub-path (tool-call echoes).
  if (path === '/mcp/app' || path.startsWith('/mcp/app/')) return true;
  // /api/:slug/run — exact, not share/result.
  if (/^\/api\/[^/]+\/run$/.test(path)) return true;
  // /api/:slug/jobs — exact enqueue/list, NOT the /:job_id sub-path which
  // is a read the generic read-heavy tier should throttle.
  if (/^\/api\/[^/]+\/jobs$/.test(path)) return true;
  return false;
}

/**
 * Wrap `genericRateLimitMiddleware('write', ...)` so it only applies to
 * mutating HTTP methods. Useful on routers that mix GET + write methods on
 * the same path prefix (e.g. `/api/workspaces`, where GET /:id is a read
 * but PATCH /:id / DELETE /:id are writes). GETs fall through to the
 * appropriate read-heavy middleware (if mounted) or flow un-throttled.
 *
 * Also skips paths already covered by the `run` tier so a single request
 * isn't charged against two buckets (see `isRunTierPath`).
 */
export function writeOnlyRateLimitMiddleware(
  resolveCtx: (c: Context) => Promise<SessionContext>,
): MiddlewareHandler {
  const inner = genericRateLimitMiddleware('write', resolveCtx);
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next();
    }
    const path = new URL(c.req.url).pathname;
    if (isRunTierPath(path)) return next();
    return inner(c, next);
  };
}

/**
 * Wrap `genericRateLimitMiddleware('read-heavy', ...)` so it only applies
 * to GET/HEAD. Mounted on path prefixes that mix reads + writes (e.g.
 * `/api/hub/*`), the write counterpart handles the mutating methods.
 */
export function readOnlyRateLimitMiddleware(
  resolveCtx: (c: Context) => Promise<SessionContext>,
): MiddlewareHandler {
  const inner = genericRateLimitMiddleware('read-heavy', resolveCtx);
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      return next();
    }
    return inner(c, next);
  };
}

/**
 * MCP `ingest_app` limit. Not a middleware because the MCP layer needs to
 * surface the error inside a JSON-RPC tool envelope, not as a top-level HTTP
 * 429. Per-user when authed, per-IP otherwise.
 */
export function checkMcpIngestLimit(
  ctx: SessionContext,
  ip: string,
): { allowed: true } | { allowed: false; retryAfterSec: number } {
  if (isRateLimitDisabled()) return { allowed: true };
  const key = ctx.is_authenticated
    ? `mcp_ingest:user:${ctx.user_id}`
    : `mcp_ingest:ip:${ip}`;
  const windowMs = 24 * 3600 * 1000;
  const r = incrementAndCheck(key, defaultMcpIngestPerDay(), windowMs, Date.now());
  if (!r.allowed) recordRateLimitHit('mcp_ingest');
  return r.allowed
    ? { allowed: true }
    : { allowed: false, retryAfterSec: r.retryAfterSec };
}
