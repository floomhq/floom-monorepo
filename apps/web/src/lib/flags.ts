import { useMemo } from 'react';

/**
 * Cloud publish/deploy gate for floom.dev prod vs preview.floom.dev.
 * Agent 9 may replace env-only reads with server-sourced `window.__FLOOM__`
 * or session payload — keep call sites on this hook.
 */
export function useDeployEnabled(): boolean {
  return useMemo(() => readDeployEnabled(), []);
}

export function readDeployEnabled(): boolean {
  if (typeof window !== 'undefined') {
    const w = window as Window & { __FLOOM__?: { deployEnabled?: boolean } };
    if (typeof w.__FLOOM__?.deployEnabled === 'boolean') {
      return w.__FLOOM__.deployEnabled;
    }
  }
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_DEPLOY_ENABLED === 'true';
}
