// useMyRuns — module-level cache + useSyncExternalStore so /me and any
// component that lists recent runs all read from the same source without
// refetching per mount.  Mirrors the useMyApps pattern.
//
// First subscriber triggers the initial load; manual `refresh()` is exposed
// for after a new run completes.

import { useEffect, useSyncExternalStore } from 'react';
import * as api from '../api/client';
import type { MeRunSummary } from '../lib/types';

type CacheState = {
  runs: MeRunSummary[] | null;
  loading: boolean;
  error: Error | null;
};

const listeners = new Set<() => void>();
let cache: CacheState = { runs: null, loading: false, error: null };

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

export async function refreshMyRuns(limit = 50): Promise<MeRunSummary[] | null> {
  cache = { ...cache, loading: true, error: null };
  notify();
  try {
    const res = await api.getMyRuns(limit);
    cache = { runs: res.runs, loading: false, error: null };
  } catch (err) {
    cache = {
      runs: cache.runs,
      loading: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
  notify();
  return cache.runs;
}

export function useMyRuns(limit = 50): CacheState & {
  refresh: () => Promise<MeRunSummary[] | null>;
} {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    if (!state.runs && !state.loading && !state.error) {
      void refreshMyRuns(limit);
    }
  }, [state.runs, state.loading, state.error, limit]);
  return { ...state, refresh: () => refreshMyRuns(limit) };
}
