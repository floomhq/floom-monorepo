// /run/apps — v26 Run-mode apps dashboard.
//
// Wireframe: /var/www/wireframes-floom/v26/run-apps.html
// Issues: #918 (stub fix), #913 (compact hero override), #928 (rebase onto main)
//
// Shell: WorkspacePageShell mode="run" (RunRail + ModeToggle per v26 §12).
// Hero: COMPACT single-line stat strip (NOT 4-card grid — issue #913).
// Grid: installed apps from /api/hub/installed merged with run history metadata.
// Filter chips: All / Recently used (URL param ?filter=).
// Recent runs: compact panel sourced from api.getMyRuns.
// Bottom CTA: Browse the app store → /apps.
//
// COEXIST strategy: v23 /me/apps (MeAppsPage) is preserved untouched.
// This file serves the NEW v26 /run/apps route. Per spec §9, /me/apps
// will redirect here in a future PR.

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { WorkspacePageShell } from '../components/WorkspacePageShell';
import { useSession } from '../hooks/useSession';
import { useInstalledApps, type InstalledApp } from '../hooks/useInstalledApps';
import { formatTime } from '../lib/time';
import * as api from '../api/client';
import type { MeRunSummary } from '../lib/types';

const FETCH_LIMIT = 200;

/** Per-app summary for the Run-mode grid. */
interface RunApp {
  slug: string;
  name: string;
  description?: string;
  runCount: number;
  lastRunAt: string | null;
  lastRunId: string | null;
  lastRunAction: string | null;
  lastRunStatus: string | null;
}

/**
 * Build the app grid from installed apps (primary source) merged with
 * run-history metadata (run count, last run, last status).
 * Apps that are installed but have never been run still appear (runCount=0).
 */
function mergeInstalledWithRuns(
  installed: InstalledApp[],
  runs: MeRunSummary[],
): RunApp[] {
  // Build run metadata map keyed by slug
  const runMeta = new Map<
    string,
    { runCount: number; lastRunAt: string; lastRunId: string; lastRunAction: string; lastRunStatus: string }
  >();
  for (const run of runs) {
    if (!run.app_slug) continue;
    const existing = runMeta.get(run.app_slug);
    if (existing) {
      existing.runCount += 1;
    } else {
      runMeta.set(run.app_slug, {
        runCount: 1,
        lastRunAt: run.started_at,
        lastRunId: run.id,
        lastRunAction: run.action,
        lastRunStatus: run.status,
      });
    }
  }

  // Merge: installed apps are primary; fill in slugs from runs that
  // aren't in the installed list (edge case: app removed after run).
  const result: RunApp[] = installed.map((a) => {
    const meta = runMeta.get(a.slug);
    return {
      slug: a.slug,
      name: a.name,
      description: a.description || undefined,
      runCount: meta?.runCount ?? 0,
      lastRunAt: meta?.lastRunAt ?? null,
      lastRunId: meta?.lastRunId ?? null,
      lastRunAction: meta?.lastRunAction ?? null,
      lastRunStatus: meta?.lastRunStatus ?? null,
    };
  });

  // Add run-only apps (installed but not in /installed list, e.g. removed apps)
  const installedSlugs = new Set(installed.map((a) => a.slug));
  for (const [slug, meta] of runMeta) {
    if (installedSlugs.has(slug)) continue;
    // Find name from runs
    const nameRun = runs.find((r) => r.app_slug === slug);
    result.push({
      slug,
      name: nameRun?.app_name || slug,
      description: undefined,
      runCount: meta.runCount,
      lastRunAt: meta.lastRunAt,
      lastRunId: meta.lastRunId,
      lastRunAction: meta.lastRunAction,
      lastRunStatus: meta.lastRunStatus,
    });
  }

  return result;
}

// ------------------------------------------------------------------
// Filter chips (wireframe run-apps.html lines 136–143)
// Only functional chips: All / Recently used.
// Scheduled and Drafts deferred until backend supports them.
// ------------------------------------------------------------------

type RunAppFilter = 'all' | 'recent';

const RUN_APP_FILTER_LABELS: Record<RunAppFilter, string> = {
  all: 'All',
  recent: 'Recently used',
};

function filterApps(apps: RunApp[], filter: RunAppFilter): RunApp[] {
  if (filter === 'all') return apps;
  if (filter === 'recent') {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return apps.filter((a) => {
      if (!a.lastRunAt) return false;
      const t = new Date(a.lastRunAt).getTime();
      return Number.isFinite(t) && t >= cutoff;
    });
  }
  return apps;
}

function FilterChipBar({
  active,
  counts,
  onChange,
}: {
  active: RunAppFilter;
  counts: Record<RunAppFilter, number>;
  onChange: (f: RunAppFilter) => void;
}) {
  const filters: RunAppFilter[] = ['all', 'recent'];
  return (
    // Wireframe .content-toolbar: space-between with filters left, secondary action right
    <div
      data-testid="run-apps-filter-chips"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-4)',
        flexWrap: 'wrap',
        marginBottom: 'var(--space-4)',
      }}
    >
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {filters.map((f) => {
          const isActive = f === active;
          return (
            <button
              key={f}
              type="button"
              data-testid={`run-apps-chip-${f}`}
              onClick={() => onChange(f)}
              className="filter-chip"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 12,
                padding: '5px 11px',
                borderRadius: 999,
                background: isActive ? 'var(--accent-soft)' : 'var(--card)',
                border: `1px solid ${isActive ? 'var(--accent-border, #a7f3d0)' : 'var(--line)'}`,
                color: isActive ? 'var(--accent)' : 'var(--muted)',
                fontWeight: isActive ? 600 : 500,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.12s ease',
              }}
            >
              {RUN_APP_FILTER_LABELS[f]}
              <span style={{ opacity: 0.7, marginLeft: 2 }}>{counts[f]}</span>
            </button>
          );
        })}
      </div>
      {/* Browse store: secondary action in toolbar row per wireframe .content-toolbar */}
      <Link
        to="/apps"
        data-testid="run-apps-browse-store"
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--muted)',
          textDecoration: 'none',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        Browse store →
      </Link>
    </div>
  );
}

// ------------------------------------------------------------------
// Hero stat row (4 cards per wireframe run-apps.html lines 128–133)
// Federico decision 2026-04-29: revert #913 compact pill, restore the
// wireframe's 4-card grid. Compact pill made the dashboard feel anemic.
// ------------------------------------------------------------------

function HeroStatRow({
  appCount,
  runCount7d,
  runningNow,
  p95Ms,
}: {
  appCount: number | null;
  runCount7d: number | null;
  runningNow: number | null;
  p95Ms: number | null;
}) {
  const cards = [
    { label: 'APPS',         value: appCount,    sub: 'in workspace' },
    { label: 'RUNS · 7D',    value: runCount7d,  sub: 'this week' },
    { label: 'RUNNING NOW',  value: runningNow,  sub: runningNow === 1 ? 'in flight' : 'in flight' },
    { label: 'P95',          value: p95Ms,       sub: 'typical', unit: 'ms' },
  ];
  return (
    <div
      data-testid="run-apps-hero-stat-row"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: 'var(--space-3)',
        marginBottom: 'var(--space-5)',
      }}
    >
      {cards.map((c) => (
        <div
          key={c.label}
          style={{
            background: 'var(--card)',
            border: '1px solid var(--line)',
            borderRadius: 12,
            padding: 'var(--space-4)',
            boxShadow: 'var(--shadow-2)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1)',
          }}
        >
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '0.06em',
            color: 'var(--muted)',
            textTransform: 'uppercase',
          }}>{c.label}</div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 19,
            fontWeight: 700,
            color: 'var(--ink)',
            lineHeight: 1.05,
          }}>
            {c.value ?? '—'}
            {c.unit && c.value != null && <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', marginLeft: 2 }}>{c.unit}</span>}
          </div>
          <div style={{
            fontSize: 11,
            color: 'var(--muted)',
          }}>{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------
// Apps grid
// ------------------------------------------------------------------

function AppCard({ app }: { app: RunApp }) {
  const initials = app.slug.slice(0, 2).toUpperCase();
  const failed =
    app.lastRunStatus === 'error' || app.lastRunStatus === 'timeout';
  return (
    <Link
      to={`/run/apps/${app.slug}/run`}
      data-testid={`run-apps-card-${app.slug}`}
      style={{
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 14,
        padding: 'var(--space-5) var(--space-4)',
        minHeight: 132,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        textDecoration: 'none',
        color: 'inherit',
        boxShadow: 'var(--shadow-2)',
        transition: 'border-color 0.12s ease, box-shadow 0.12s ease, transform 0.12s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--line-hover)';
        e.currentTarget.style.boxShadow = 'var(--shadow-3)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--line)';
        e.currentTarget.style.boxShadow = 'var(--shadow-2)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <div
          aria-hidden="true"
          style={{
            width: 38,
            height: 38,
            borderRadius: 9,
            background: 'var(--bg)',
            border: '1px solid var(--line)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            color: 'var(--ink)',
            flexShrink: 0,
          }}
        >
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--ink)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {app.name}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10.5,
              color: 'var(--muted)',
              marginTop: 2,
            }}
          >
            {app.runCount === 0
              ? 'Not run yet'
              : `${app.lastRunAt ? `last run ${formatTime(app.lastRunAt)}` : 'recent'} · ${app.runCount} run${app.runCount !== 1 ? 's' : ''}`}
          </div>
        </div>
      </div>

      {app.description && (
        <p
          style={{
            fontSize: 12.5,
            color: 'var(--muted)',
            margin: 0,
            lineHeight: 1.5,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {app.description}
        </p>
      )}

      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 12.5,
          color: failed ? '#ef4444' : 'var(--accent)',
          fontWeight: 700,
          marginTop: 'auto',
        }}
      >
        <span>{failed ? 'Last run failed' : app.runCount === 0 ? 'Run' : 'Run again'}</span>
        <span aria-hidden style={{ fontSize: 13, lineHeight: 1, transform: 'translateY(-0.5px)' }}>→</span>
      </div>
    </Link>
  );
}

function AppsGrid({ apps }: { apps: RunApp[] }) {
  // Odd-count grids: show a "+ Install app" placeholder in the last slot so
  // the 2-col layout doesn't look broken with a lone card.
  const showPlaceholder = apps.length % 2 !== 0;
  return (
    <>
      <style>{`@media (max-width: 760px) { [data-testid="run-apps-grid"] { grid-template-columns: 1fr !important; } }`}</style>
      <div
        data-testid="run-apps-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-5)',
        }}
      >
        {apps.map((app) => (
          <AppCard key={app.slug} app={app} />
        ))}
        {showPlaceholder && (
          <Link
            to="/apps"
            data-testid="run-apps-grid-placeholder"
            style={{
              background: 'transparent',
              border: '1px dashed var(--line)',
              borderRadius: 14,
              padding: 'var(--space-4)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-2)',
              textDecoration: 'none',
              color: 'var(--muted)',
              minHeight: 140,
            }}
          >
            <span style={{ fontSize: 22, lineHeight: 1 }}>+</span>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>Install more apps</span>
          </Link>
        )}
      </div>
    </>
  );
}

// ------------------------------------------------------------------
// Recent runs panel
// ------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function RecentRunsPanel({ runs }: { runs: MeRunSummary[] }) {
  const visible = runs.slice(0, 5);
  if (visible.length === 0) return null;

  return (
    <div
      data-testid="run-apps-recent-runs"
      style={{
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        padding: 'var(--space-5) var(--space-5) var(--space-2)',
        marginBottom: 'var(--space-4)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span
            aria-hidden="true"
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: 'var(--accent)',
              boxShadow: '0 0 0 3px var(--accent-soft)',
              display: 'inline-block',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--muted)',
            }}
          >
            Recent runs
          </span>
        </div>
        <Link
          to="/run/runs"
          data-testid="run-apps-view-all-runs"
          style={{
            fontSize: 12.5,
            color: 'var(--muted)',
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          View all →
        </Link>
      </div>
      <div style={{ borderTop: '1px solid var(--line)', margin: '0 -20px' }}>
        {visible.map((run) => {
          const failed =
            run.status === 'error' || run.status === 'timeout';
          const dotColor = failed ? '#ef4444' : 'var(--accent)';
          const dotHalo = failed ? '#fef2f2' : 'var(--accent-soft)';
          const appLabel = run.app_name || run.app_slug || 'app';
          const dur =
            run.duration_ms != null ? formatDuration(run.duration_ms) : '—';
          return (
            <Link
              key={run.id}
              to={`/run/runs/${run.id}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '32px minmax(0,1fr) auto auto auto',
                gap: 'var(--space-4)',
                alignItems: 'center',
                padding: 'var(--space-3) var(--space-4)',
                borderBottom: '1px solid var(--line)',
                fontSize: 12.5,
                textDecoration: 'none',
                color: 'inherit',
                transition: 'background 0.12s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: dotColor,
                  boxShadow: `0 0 0 3px ${dotHalo}`,
                  display: 'block',
                  margin: '0 auto',
                }}
              />
              <div
                style={{
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ fontWeight: 600, color: 'var(--ink)' }}>
                  {appLabel}
                </span>{' '}
                <span style={{ color: 'var(--muted)' }}>· {run.action}</span>
              </div>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--muted)',
                  fontSize: 11.5,
                }}
              >
                {dur}
              </span>
              <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>
                {formatTime(run.started_at)}
              </span>
              <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500 }}>
                View →
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Empty state
// ------------------------------------------------------------------

function EmptyState() {
  return (
    <div
      data-testid="run-apps-empty"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        padding: 'var(--space-8) var(--space-6) var(--space-8)',
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 14,
        marginBottom: 'var(--space-5)',
      }}
    >
      <h3
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 26,
          fontWeight: 400,
          letterSpacing: '-0.02em',
          margin: '0 0 8px',
          color: 'var(--ink)',
        }}
      >
        No apps in your workspace yet.
      </h3>
      <p
        style={{
          fontSize: 14,
          color: 'var(--muted)',
          margin: '0 auto 20px',
          maxWidth: 440,
          lineHeight: 1.55,
        }}
      >
        Browse the store and try one — it lands here automatically. Ready
        to run from your browser, Claude, Cursor, or the CLI.
      </p>
      <Link to="/apps" className="btn-ink" data-testid="run-apps-empty-cta">
        Browse the store →
      </Link>
    </div>
  );
}

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

// Module-level cache for runs so the skeleton only shows on first load
// per session. Installed apps share the useInstalledApps hook cache with
// RunRail (V13 fix: single source of truth for the "Apps" count).
let _cachedRuns: MeRunSummary[] | null = null;

export function RunAppsPage() {
  const { data: session, loading: sessionLoading, error: sessionError } = useSession();
  const { apps: installed } = useInstalledApps();
  const [runs, setRuns] = useState<MeRunSummary[] | null>(_cachedRuns);
  const [searchParams, setSearchParams] = useSearchParams();

  const sessionPending =
    sessionLoading || (session === null && !sessionError);

  // Read filter from URL param; default to 'all'
  const rawFilter = searchParams.get('filter');
  const activeFilter: RunAppFilter =
    rawFilter === 'recent' ? 'recent' : 'all';

  function handleFilterChange(f: RunAppFilter) {
    if (f === 'all') {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('filter');
        return next;
      }, { replace: true });
    } else {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('filter', f);
        return next;
      }, { replace: true });
    }
  }

  useEffect(() => {
    if (sessionPending) return;
    // Runs fetched here; installed apps come via the shared hook.
    let cancelled = false;
    api.getMyRuns(FETCH_LIMIT)
      .catch(() => ({ runs: [] as MeRunSummary[] }))
      .then((runsRes) => {
        if (cancelled) return;
        _cachedRuns = runsRes.runs;
        setRuns(_cachedRuns);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionPending]);

  const apps = useMemo<RunApp[]>(() => {
    if (!installed || !runs) return [];
    return mergeInstalledWithRuns(installed, runs);
  }, [installed, runs]);

  const filteredApps = useMemo(
    () => filterApps(apps, activeFilter),
    [apps, activeFilter],
  );

  const appCount = apps.length;
  // Hero count: runs in the last 7 days
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const runCount =
    runs?.filter((r) => new Date(r.started_at) >= weekAgo).length ?? 0;

  const filterCounts: Record<RunAppFilter, number> = useMemo(
    () => ({
      all: apps.length,
      recent: filterApps(apps, 'recent').length,
    }),
    [apps],
  );

  // Data is ready when both fetches have resolved
  const dataReady = installed !== null && runs !== null;

  return (
    <WorkspacePageShell mode="run" title="Apps · Run · Floom">
      <div data-testid="run-apps-page">
        {/* Page head */}
        <div style={{ marginBottom: 'var(--space-5)' }}>
          <h1
            style={{
              fontWeight: 800,
              fontSize: 30,
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
              margin: '0 0 var(--space-1)',
              color: 'var(--ink)',
            }}
          >
            Apps
          </h1>
          <p style={{ fontSize: 14, color: 'var(--muted)', margin: 0, lineHeight: 1.55 }}>
            {appCount > 0
              ? `${appCount} runnable app${appCount !== 1 ? 's' : ''} in your workspace. Available in browser, Claude, Cursor, and HTTP.`
              : 'Browse the store and try one — it lands here automatically.'}
          </p>
        </div>

        {/* Hero stat row — 4 cards per wireframe (reverts #913 compact pill).
            runningNow + p95Ms render "—" until backend wires them. */}
        <HeroStatRow
          appCount={dataReady ? appCount : null}
          runCount7d={dataReady ? runCount : null}
          runningNow={null}
          p95Ms={null}
        />

        {/* Filter chip toolbar + Browse store — always shown when data ready */}
        {dataReady && (
          <FilterChipBar
            active={activeFilter}
            counts={filterCounts}
            onChange={handleFilterChange}
          />
        )}

        {/* Apps grid */}
        {!dataReady ? (
          <div
            data-testid="run-apps-loading"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-4)' }}
          >
            {[1, 2].map((i) => (
              <div
                key={i}
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--line)',
                  borderRadius: 14,
                  padding: 'var(--space-5)',
                  height: 140,
                  boxShadow: 'var(--shadow-2)',
                }}
              >
                <div style={{ width: '60%', height: 14, background: 'var(--line)', borderRadius: 4, marginBottom: 'var(--space-2)' }} />
                <div style={{ width: '90%', height: 10, background: 'var(--line)', borderRadius: 4 }} />
              </div>
            ))}
          </div>
        ) : apps.length === 0 ? (
          <EmptyState />
        ) : filteredApps.length === 0 ? (
          <>
            <div
              data-testid="run-apps-filter-empty"
              style={{
                fontSize: 13,
                color: 'var(--muted)',
                marginBottom: 'var(--space-3)',
                padding: 'var(--space-3) 0',
              }}
            >
              No apps match this filter.
            </div>
            <AppsGrid apps={apps} />
          </>
        ) : (
          <AppsGrid apps={filteredApps} />
        )}

        {/* Recent runs panel */}
        {runs && runs.length > 0 && <RecentRunsPanel runs={runs} />}


        {/* Bottom CTA */}
        <div data-testid="run-apps-bottom-cta" style={{ marginTop: 'var(--space-1)' }}>
          <Link
            to="/apps"
            style={{
              padding: 'var(--space-2) var(--space-4)',
              background: 'var(--card)',
              border: '1px solid var(--line)',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--muted)',
              textDecoration: 'none',
            }}
          >
            Browse the app store →
          </Link>
        </div>
      </div>
    </WorkspacePageShell>
  );
}
