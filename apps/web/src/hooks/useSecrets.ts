// v15.2: shared /api/secrets hook.
//
// Optimistic cache over the masked secrets list + POST/DELETE mutations.
// The server never returns plaintext values; the cache only holds
// { key, updated_at } pairs so the UI can render "set" / "not set" badges
// plus the last-updated timestamp. On save/remove, we mutate the cache
// immediately, fire the network call, roll back on error, and refresh
// once the mutation succeeds so updated_at comes from the server.

import { useEffect, useSyncExternalStore } from 'react';
import * as api from '../api/client';
import type { UserSecretEntry } from '../lib/types';

type CacheState = {
  entries: UserSecretEntry[] | null;
  loading: boolean;
  error: Error | null;
};

const listeners = new Set<() => void>();
let cache: CacheState = { entries: null, loading: false, error: null };

function notify(): void {
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getSnapshot(): CacheState {
  return cache;
}

export async function refreshSecrets(): Promise<UserSecretEntry[] | null> {
  cache = { ...cache, loading: true, error: null };
  notify();
  try {
    const res = await api.listSecrets();
    cache = { entries: res.entries, loading: false, error: null };
  } catch (err) {
    cache = {
      entries: cache.entries,
      loading: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
  notify();
  return cache.entries;
}

async function saveSecret(key: string, value: string): Promise<void> {
  const prev = cache.entries ?? [];
  const now = new Date().toISOString();
  const optimistic: UserSecretEntry[] = [
    ...prev.filter((e) => e.key !== key),
    { key, updated_at: now },
  ];
  cache = { ...cache, entries: optimistic };
  notify();
  try {
    await api.setSecret(key, value);
    await refreshSecrets();
  } catch (err) {
    cache = { ...cache, entries: prev };
    notify();
    throw err instanceof Error ? err : new Error(String(err));
  }
}

async function removeSecret(key: string): Promise<void> {
  const prev = cache.entries ?? [];
  const optimistic = prev.filter((e) => e.key !== key);
  cache = { ...cache, entries: optimistic };
  notify();
  try {
    await api.deleteSecret(key);
    await refreshSecrets();
  } catch (err) {
    cache = { ...cache, entries: prev };
    notify();
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * Subscribe to the vault cache.
 *
 * `options.enabled` gates the auto-fetch; callers pass `false` when there
 * is no authenticated cloud session (eg. /me in signed-out preview) to
 * avoid hitting GET /api/secrets and caching the 401 error, which would
 * otherwise permanently short-circuit future refreshes until the SPA
 * reloads. Defaults to `true` for backward compat with existing callers.
 */
export function useSecrets(options?: { enabled?: boolean }): CacheState & {
  refresh: () => Promise<UserSecretEntry[] | null>;
  save: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
} {
  const enabled = options?.enabled ?? true;
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    if (!enabled) return;
    if (!state.entries && !state.loading && !state.error) {
      void refreshSecrets();
    }
  }, [enabled, state.entries, state.loading, state.error]);
  return {
    ...state,
    refresh: refreshSecrets,
    save: saveSecret,
    remove: removeSecret,
  };
}
