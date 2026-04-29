// Shared /api/hub/installed hook.
//
// Module-level cache + useSyncExternalStore pattern (mirrors useMyApps and
// useMyRuns) so RunRail and RunAppsPage read from the same installed-apps
// list without re-fetching per route. First subscriber triggers the initial
// load; manual `refresh()` is exposed for after install / uninstall actions.
//
// V13 fix: previously RunRail derived its "Apps" count from useMyRuns (unique
// app_slugs in run history) while RunAppsPage's hero stat counted installed
// apps merged with run-only slugs — so a user who installed an app but never
// ran it saw rail=0 vs content=1. Both surfaces now share this hook for the
// "installed in workspace" count, making them MECE on a single source.

import { useEffect, useSyncExternalStore } from 'react';
import * as api from '../api/client';

export interface InstalledApp {
  slug: string;
  name: string;
  description: string;
  installed: boolean;
}

type CacheState = {
  apps: InstalledApp[] | null;
  loading: boolean;
  error: Error | null;
};

const listeners = new Set<() => void>();
let cache: CacheState = { apps: null, loading: false, error: null };

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

export async function refreshInstalledApps(): Promise<InstalledApp[] | null> {
  cache = { ...cache, loading: true, error: null };
  notify();
  try {
    const res = await api.getInstalledApps();
    cache = { apps: res.apps, loading: false, error: null };
  } catch (err) {
    cache = {
      apps: cache.apps,
      loading: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
  notify();
  return cache.apps;
}

export function useInstalledApps(): CacheState & {
  refresh: () => Promise<InstalledApp[] | null>;
} {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    if (!state.apps && !state.loading && !state.error) {
      void refreshInstalledApps();
    }
  }, [state.apps, state.loading, state.error]);
  return { ...state, refresh: refreshInstalledApps };
}
