/**
 * /run/runs — v26 Run-mode all runs dashboard.
 *
 * Thin wrapper over RunsList. Data fetching + filter state live here;
 * all rendering delegates to the shared shell so /run/runs and /studio/runs
 * stay aligned per V26-IA-SPEC §12.2.
 *
 * Wireframe: /var/www/wireframes-floom/v26/run-runs.html
 *
 * Shell: WorkspacePageShell mode="run" (same as RunAppsPage).
 * Layout shape (shared with /studio/runs): hero stat row → filter chips → runs list.
 *
 * Data: reuses api.getMyRuns (same endpoint as MeRunsPage).
 *
 * COEXIST: MeRunsPage at /me/runs is preserved; both render via RunsList.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { WorkspacePageShell } from '../components/WorkspacePageShell';
import {
  RunsList,
  runListRowsFromMeRuns,
  type RunsListFilter,
} from '../components/workspace/RunsList';
import { useSession } from '../hooks/useSession';
import * as api from '../api/client';
import type { MeRunSummary } from '../lib/types';

const FETCH_LIMIT = 200;
const INITIAL_LIMIT = 25;
const LOAD_STEP = 25;

type RunFilter = 'all' | 'successful' | 'failed' | 'recent';

const FILTER_LABELS: Record<RunFilter, string> = {
  all: 'All',
  successful: 'Successful',
  failed: 'Failed',
  recent: 'Recent',
};

function filterRuns(runs: MeRunSummary[], filter: RunFilter): MeRunSummary[] {
  if (filter === 'all') return runs;
  if (filter === 'successful') {
    return runs.filter((r) => r.status === 'success');
  }
  if (filter === 'failed') {
    return runs.filter(
      (r) => r.status === 'error' || r.status === 'timeout',
    );
  }
  if (filter === 'recent') {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return runs.filter((r) => {
      const t = new Date(r.started_at).getTime();
      return Number.isFinite(t) && t >= cutoff;
    });
  }
  return runs;
}

export function RunRunsPage() {
  const { data: session, loading: sessionLoading, error: sessionError } = useSession();
  const [runs, setRuns] = useState<MeRunSummary[] | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_LIMIT);
  const [searchParams, setSearchParams] = useSearchParams();

  const sessionPending = sessionLoading || (session === null && !sessionError);

  // Filter from URL param
  const rawFilter = searchParams.get('filter');
  const activeFilter: RunFilter =
    rawFilter === 'successful' || rawFilter === 'failed' || rawFilter === 'recent'
      ? rawFilter
      : 'all';

  function handleFilterChange(f: RunFilter) {
    setVisibleCount(INITIAL_LIMIT);
    if (f === 'all') {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('filter');
          return next;
        },
        { replace: true },
      );
    } else {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('filter', f);
          return next;
        },
        { replace: true },
      );
    }
  }

  useEffect(() => {
    if (sessionPending) return;
    let cancelled = false;
    api
      .getMyRuns(FETCH_LIMIT)
      .then((res) => {
        if (!cancelled) setRuns(res.runs);
      })
      .catch((err) => {
        if (!cancelled) setRunsError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionPending]);

  const filteredRuns = useMemo(
    () => (runs ? filterRuns(runs, activeFilter) : []),
    [runs, activeFilter],
  );
  const visibleRuns = useMemo(
    () => filteredRuns.slice(0, visibleCount),
    [filteredRuns, visibleCount],
  );
  const visibleRows = useMemo(
    () => runListRowsFromMeRuns(visibleRuns, '/run/runs'),
    [visibleRuns],
  );
  const hasMore = filteredRuns.length > visibleCount;
  const totalRuns = runs?.length ?? 0;

  const filters: RunsListFilter[] = useMemo(() => {
    const all = runs ?? [];
    const counts: Record<RunFilter, number> = {
      all: all.length,
      successful: filterRuns(all, 'successful').length,
      failed: filterRuns(all, 'failed').length,
      recent: filterRuns(all, 'recent').length,
    };
    return (['all', 'successful', 'failed', 'recent'] as RunFilter[]).map((f) => ({
      id: f,
      label: FILTER_LABELS[f],
      count: runs ? counts[f] : undefined,
      active: activeFilter === f,
      onClick: () => handleFilterChange(f),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, activeFilter]);

  const subtitle =
    totalRuns > 0
      ? `${totalRuns} run${totalRuns !== 1 ? 's' : ''} across your apps.`
      : 'Everything you run on Floom shows up here.';

  return (
    <WorkspacePageShell mode="run" title="Runs · Run · Floom">
      <RunsList
        mode="run"
        heading="Runs"
        subtitle={subtitle}
        headerCta={
          <Link
            to="/run/apps"
            data-testid="run-runs-back-apps"
            style={{
              padding: '8px 14px',
              background: 'var(--card)',
              border: '1px solid var(--line)',
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--muted)',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            ← Back to Apps
          </Link>
        }
        stats={[
          {
            label: 'Runs 7d',
            value: runs ? totalRuns.toLocaleString() : '—',
            sub: 'this week',
          },
          {
            label: 'Success',
            value: runs ? successRate(runs) : '—',
            sub: 'rate',
          },
          {
            label: 'P95',
            value: runs ? p95(runs) : '—',
            sub: 'duration',
          },
          {
            label: 'Apps',
            value: runs
              ? String(
                  new Set(
                    runs.map((r) => r.app_slug).filter(Boolean) as string[],
                  ).size,
                )
              : '—',
            sub: 'active',
          },
        ]}
        filters={filters}
        runs={runs === null && !runsError ? null : visibleRows}
        totalCount={filteredRuns.length}
        hasMore={hasMore}
        onLoadMore={() => setVisibleCount((n) => n + LOAD_STEP)}
        loading={runs === null && !runsError}
        error={runsError}
        emptyState="No runs yet. Run any app from the store and its history will show up here."
      />
    </WorkspacePageShell>
  );
}

// ── Stat helpers ─────────────────────────────────────────────────────

function successRate(runs: MeRunSummary[]): string {
  if (runs.length === 0) return '—';
  const successes = runs.filter((r) => r.status === 'success').length;
  return `${((successes / runs.length) * 100).toFixed(1)}%`;
}

function p95(runs: MeRunSummary[]): string {
  const durations = runs
    .map((r) => r.duration_ms)
    .filter((d): d is number => d != null)
    .sort((a, b) => a - b);
  if (durations.length === 0) return '—';
  const idx = Math.floor(durations.length * 0.95);
  const ms = durations[Math.min(idx, durations.length - 1)];
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}
