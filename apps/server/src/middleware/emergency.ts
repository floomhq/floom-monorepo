import type { MiddlewareHandler } from 'hono';

const ENV_FLAG = 'FLOOM_EMERGENCY_DISABLE_RUN_SURFACES';
const RETRY_ENV = 'FLOOM_EMERGENCY_RETRY_AFTER_SECONDS';
const AUTO_DISABLED_ENV = 'FLOOM_AUTO_EMERGENCY_DISABLED';
const AUTO_THRESHOLD_ENV = 'FLOOM_AUTO_EMERGENCY_RATE_LIMIT_HITS';
const AUTO_WINDOW_ENV = 'FLOOM_AUTO_EMERGENCY_WINDOW_MS';
const AUTO_COOLDOWN_ENV = 'FLOOM_AUTO_EMERGENCY_COOLDOWN_MS';
const DEFAULT_RETRY_AFTER_SECONDS = 300;
const DEFAULT_AUTO_THRESHOLD = 120;
const DEFAULT_AUTO_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_AUTO_COOLDOWN_MS = 15 * 60 * 1000;

let autoDisabledUntil = 0;
const rateLimitHitTimestamps: number[] = [];

function envNumber(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export function isEmergencyRunSurfacesDisabled(): boolean {
  return process.env[ENV_FLAG] === 'true' || Date.now() < autoDisabledUntil;
}

function retryAfterSeconds(): number {
  if (process.env[ENV_FLAG] !== 'true' && Date.now() < autoDisabledUntil) {
    return Math.max(1, Math.ceil((autoDisabledUntil - Date.now()) / 1000));
  }
  const raw = Number(process.env[RETRY_ENV]);
  if (Number.isFinite(raw) && raw > 0 && raw <= 86_400) return Math.floor(raw);
  return DEFAULT_RETRY_AFTER_SECONDS;
}

export function noteEmergencyRateLimitHit(scope: string, now = Date.now()): void {
  if (process.env[AUTO_DISABLED_ENV] === 'true') return;
  if (scope === 'user') return;
  const threshold = envNumber(AUTO_THRESHOLD_ENV, DEFAULT_AUTO_THRESHOLD);
  const windowMs = envNumber(AUTO_WINDOW_ENV, DEFAULT_AUTO_WINDOW_MS);
  const cooldownMs = envNumber(AUTO_COOLDOWN_ENV, DEFAULT_AUTO_COOLDOWN_MS);
  const cutoff = now - windowMs;
  while (rateLimitHitTimestamps.length > 0 && rateLimitHitTimestamps[0] < cutoff) {
    rateLimitHitTimestamps.shift();
  }
  rateLimitHitTimestamps.push(now);
  if (rateLimitHitTimestamps.length >= threshold) {
    autoDisabledUntil = Math.max(autoDisabledUntil, now + cooldownMs);
  }
}

export function __resetEmergencyForTests(): void {
  autoDisabledUntil = 0;
  rateLimitHitTimestamps.length = 0;
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname || '/';
}

export function isEmergencyGuardedPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  if (path === '/mcp' || path.startsWith('/mcp/')) return true;
  if (path === '/hook' || path.startsWith('/hook/')) return true;
  if (path === '/api/run') return true;
  if (path === '/api/agents/run') return true;
  if (path === '/api/hub/ingest') return true;
  if (path === '/api/hub/detect') return true;
  if (path === '/api/me/triggers' || path.startsWith('/api/me/triggers/')) return true;
  if (/^\/api\/[^/]+\/run$/.test(path)) return true;
  if (/^\/api\/[^/]+\/jobs(?:\/|$)/.test(path)) return true;
  if (/^\/api\/hub\/[^/]+\/triggers(?:\/|$)/.test(path)) return true;
  return false;
}

export const emergencyRunSurfaceGuard: MiddlewareHandler = async (c, next) => {
  if (!isEmergencyRunSurfacesDisabled()) return next();
  const pathname = new URL(c.req.url).pathname;
  if (!isEmergencyGuardedPath(pathname)) return next();

  const retryAfter = retryAfterSeconds();
  return c.json(
    {
      error: 'service_unavailable',
      code: 'server_overloaded',
      message: 'Floom is temporarily unavailable because the server is overloaded. Please retry later.',
      retry_after_seconds: retryAfter,
    },
    503,
    {
      'Retry-After': String(retryAfter),
      'Cache-Control': 'no-store',
    },
  );
};
