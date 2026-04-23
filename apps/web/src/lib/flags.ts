import { getCachedSession, useSession } from '../hooks/useSession';

/**
 * Landing / launch-day feature flags.
 *
 * 2026-04-24 prod/preview split: the single source of truth is the SERVER's
 * DEPLOY_ENABLED env var, exposed via GET /api/session/me. The Docker image
 * for prod (floom.dev) and preview (preview.floom.dev) is the same, so the
 * build-time Vite flag cannot distinguish them — only the server's per-deploy
 * env can. `readDeployEnabled()` therefore reads the cached session payload
 * first, and only falls back to `VITE_DEPLOY_ENABLED` when the session hasn't
 * primed yet (first paint) or when `window.__FLOOM__.deployEnabled` is set
 * for test/fixture overrides.
 *
 * Static marketing sections that must decide at module load use the legacy
 * `DEPLOY_ENABLED` constant (Vite build-time) — fine for truly static copy,
 * but runtime chrome (TopBar, banners, CTAs) should use `useDeployEnabled()`.
 */
type Env = { VITE_DEPLOY_ENABLED?: string };

function readViteFlagString(): string {
  const env = (import.meta as { env?: Env }).env ?? {};
  return env.VITE_DEPLOY_ENABLED ?? '';
}

const rawViteFlag = readViteFlagString();

export const DEPLOY_ENABLED: boolean =
  rawViteFlag === 'true' ||
  rawViteFlag === '1' ||
  rawViteFlag === 'yes';

export function deployOrWaitlistCopy<T>(opts: { deploy: T; waitlist: T }): T {
  return DEPLOY_ENABLED ? opts.deploy : opts.waitlist;
}

/**
 * Sync read of the deploy flag for code paths that can't use a hook
 * (event handlers, route guards). Order of precedence:
 *   1. `window.__FLOOM__.deployEnabled` (test/fixture override)
 *   2. Cached `/api/session/me.deploy_enabled` (server-driven — the real flag)
 *   3. Build-time `VITE_DEPLOY_ENABLED === 'true'` (first-paint fallback only)
 *
 * The cached session is primed on boot (see main.tsx `primeSession()`), so
 * after the first async resolve this is accurate for the live runtime.
 */
export function readDeployEnabled(): boolean {
  if (typeof window !== 'undefined') {
    const w = window as Window & { __FLOOM__?: { deployEnabled?: boolean } };
    if (typeof w.__FLOOM__?.deployEnabled === 'boolean') {
      return w.__FLOOM__.deployEnabled;
    }
  }
  const cached = getCachedSession();
  if (cached && typeof cached.deploy_enabled === 'boolean') {
    return cached.deploy_enabled;
  }
  const env = (import.meta as { env?: Env }).env;
  return env?.VITE_DEPLOY_ENABLED === 'true';
}

/**
 * Launch feature flag from GET /api/session/me (`deploy_enabled`).
 *
 * Semantics:
 *   - `true`  → full Deploy / Publish CTAs (preview.floom.dev)
 *   - `false` → waitlist mode (floom.dev)
 *   - `null`  → session not yet loaded (or no payload yet); avoid flicker
 *
 * If /api/session/me errors out (self-host without the server boot, dev
 * without the API up), fall back to `window.__FLOOM__.deployEnabled`
 * then the build-time Vite env, matching `readDeployEnabled()`. This
 * keeps the UI coherent in failure modes instead of flipping everything
 * into waitlist just because a single fetch timed out.
 */
export function useDeployEnabled(): boolean | null {
  const { data, loading, error } = useSession();
  if (loading && !data) return null;
  if (error) {
    if (typeof window !== 'undefined') {
      const w = window as Window & { __FLOOM__?: { deployEnabled?: boolean } };
      if (typeof w.__FLOOM__?.deployEnabled === 'boolean') {
        return w.__FLOOM__.deployEnabled;
      }
    }
    const env = (import.meta as { env?: Env }).env;
    return env?.VITE_DEPLOY_ENABLED === 'true';
  }
  if (!data) return null;
  return data.deploy_enabled === true;
}
