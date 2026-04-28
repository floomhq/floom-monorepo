// /studio/apps — v26 Studio-mode apps dashboard.
//
// Wireframe: /var/www/wireframes-floom/v26/studio-apps.html
// Issues: #918 (stub fix), #913 (compact hero override), #928 (rebase onto main)
//
// Shell: WorkspacePageShell mode="studio" (StudioRail + ModeToggle per v26 §12).
// Hero: COMPACT single-line stat strip (NOT 4-card grid — issue #913).
// Grid: apps this user has built, sourced from useMyApps.
// Filter chips: All / Active / Drafts / Pending review (URL param ?filter=).
// Recent activity: panel from run history scoped to owned app slugs.
// Bottom CTA: + New app → /studio/build (overlay is issue #917, deferred).
//
// COEXIST strategy: v23 /studio/apps (StudioAppsPage in StudioHomePage.tsx) is
// preserved untouched. This file serves the NEW v26 /studio/apps route, which
// overrides the v23 route registration in main.tsx (last-wins in React Router).
// Per spec §9, /studio will redirect to /studio/apps going forward.

import { useEffect, useState, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { WorkspacePageShell } from '../components/WorkspacePageShell';
import { useMyApps } from '../hooks/useMyApps';
import { useSession } from '../hooks/useSession';
import { formatTime } from '../lib/time';
import { DescriptionMarkdown } from '../components/DescriptionMarkdown';
import { Sparkline } from '../components/studio/Sparkline';
import * as api from '../api/client';
import type { CreatorApp, MeRunSummary } from '../lib/types';

// ------------------------------------------------------------------
// Filter chips (wireframe studio-apps.html line 114)
// ------------------------------------------------------------------

type StudioAppFilter = 'all' | 'active' | 'drafts' | 'pending';

const STUDIO_APP_FILTER_LABELS: Record<StudioAppFilter, string> = {
  all: 'All',
  active: 'Active',
  drafts: 'Drafts',
  pending: 'Pending review',
};

function filterStudioApps(apps: CreatorApp[], filter: StudioAppFilter): CreatorApp[] {
  if (filter === 'all') return apps;
  if (filter === 'active') {
    return apps.filter(
      (a) => !a.publish_status || a.publish_status === 'published',
    );
  }
  if (filter === 'drafts') {
    return apps.filter((a) => a.publish_status === 'draft');
  }
  if (filter === 'pending') {
    return apps.filter((a) => a.publish_status === 'pending_review');
  }
  return apps;
}

function StudioFilterChipBar({
  active,
  counts,
  onChange,
}: {
  active: StudioAppFilter;
  counts: Record<StudioAppFilter, number>;
  onChange: (f: StudioAppFilter) => void;
}) {
  const filters: StudioAppFilter[] = ['all', 'active', 'drafts', 'pending'];
  return (
    <div
      data-testid="studio-apps-filter-chips"
      style={{
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        marginBottom: 16,
      }}
    >
      {filters.map((f) => {
        const isOn = f === active;
        return (
          <button
            key={f}
            type="button"
            data-testid={`studio-apps-chip-${f}`}
            onClick={() => onChange(f)}
            className="filter-chip"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 12,
              padding: '5px 11px',
              borderRadius: 999,
              background: isOn ? 'var(--accent-soft)' : 'var(--card)',
              border: `1px solid ${isOn ? 'var(--accent-border, #a7f3d0)' : 'var(--line)'}`,
              color: isOn ? 'var(--accent)' : 'var(--muted)',
              fontWeight: isOn ? 600 : 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.12s ease',
            }}
          >
            {STUDIO_APP_FILTER_LABELS[f]}
            <span style={{ opacity: 0.7, marginLeft: 2 }}>{counts[f]}</span>
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------
// Compact hero metric strip (issue #913: NOT 4-card grid)
// ------------------------------------------------------------------

function isLiveApp(app: CreatorApp): boolean {
  return !app.publish_status || app.publish_status === 'published';
}

function CompactHeroStrip({
  apps,
  totalRuns,
}: {
  apps: CreatorApp[] | null;
  totalRuns: number | null;
}) {
  // TODO: success_rate + p95 require a server-side aggregates endpoint.
  //       Only surface metrics we can verify (totalRuns, apps count).
  const appCount = apps?.length ?? 0;
  const liveCount = apps?.filter(isLiveApp).length ?? 0;

  if (!apps || appCount === 0) return null;

  return (
    <div
      className="ws-compact-hero"
      data-testid="studio-apps-compact-hero"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 12px',
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 999,
        fontSize: 12.5,
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontWeight: 500,
        color: 'var(--muted)',
        marginBottom: 18,
        flexWrap: 'wrap',
      }}
    >
      <span style={{ color: 'var(--ink)', fontWeight: 700 }}>
        {totalRuns !== null ? totalRuns.toLocaleString() : '—'}
      </span>
      <span>runs this week</span>
      <span aria-hidden style={{ color: 'var(--line)', userSelect: 'none' }}>·</span>
      <span style={{ color: 'var(--ink)', fontWeight: 700 }}>{appCount}</span>
      <span>app{appCount !== 1 ? 's' : ''}</span>
      {liveCount > 0 && (
        <>
          <span aria-hidden style={{ color: 'var(--line)', userSelect: 'none' }}>·</span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              color: 'var(--accent)',
              fontWeight: 700,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--accent)',
                display: 'inline-block',
              }}
            />
            {liveCount} live
          </span>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// App card
// ------------------------------------------------------------------

function StudioAppCard({ app }: { app: CreatorApp }) {
  const isPublished = isLiveApp(app);
  const initials = app.slug.slice(0, 2).toUpperCase();
  return (
    <Link
      to={`/studio/${app.slug}`}
      data-testid={`studio-apps-card-${app.slug}`}
      style={{
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 14,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        textDecoration: 'none',
        color: 'inherit',
        boxShadow: 'var(--shadow-2)',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--line-hover)';
        e.currentTarget.style.boxShadow = '0 1px 2px rgba(22,21,18,0.04), 0 1px 3px rgba(22,21,18,0.03), 0 4px 16px rgba(14,14,12,0.05)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--line)';
        e.currentTarget.style.boxShadow = 'var(--shadow-2)';
        e.currentTarget.style.transform = '';
      }}
    >
      {/* Row 1: icon + name + live/draft pill */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
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
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
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
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: 10.5,
              color: 'var(--muted)',
              marginTop: 2,
            }}
          >
            {app.run_count > 0
              ? `${app.run_count.toLocaleString()} runs${app.last_run_at ? ` · ${formatTime(app.last_run_at)}` : ''}`
              : 'No runs yet'}
            {/* TODO: unique callers count not available in CreatorApp — add when API exposes it */}
          </div>
        </div>
        {isPublished ? (
          <span
            data-testid={`studio-apps-live-${app.slug}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '2px 8px',
              borderRadius: 999,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.04em',
              background: 'var(--accent)',
              color: '#fff',
              border: '1px solid var(--accent)',
              flexShrink: 0,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 5,
                height: 5,
                borderRadius: 999,
                background: '#fff',
                display: 'inline-block',
              }}
            />
            LIVE
          </span>
        ) : (
          <span
            data-testid={`studio-apps-draft-${app.slug}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '2px 7px',
              borderRadius: 999,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.04em',
              background: 'var(--bg)',
              color: 'var(--muted)',
              border: '1px solid var(--line-hover)',
              flexShrink: 0,
            }}
          >
            DRAFT
          </span>
        )}
      </div>

      {/* Description */}
      <div
        style={{
          fontSize: 12.5,
          color: 'var(--muted)',
          lineHeight: 1.5,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {app.description ? (
          <DescriptionMarkdown
            description={app.description}
            style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5, margin: 0, maxWidth: 'none' }}
          />
        ) : (
          <span style={{ fontStyle: 'italic' }}>(no description)</span>
        )}
      </div>

      {/* Sparkline */}
      <Sparkline slug={app.slug} days={7} muted={app.run_count === 0} />

      {/* Runs + last run + open link */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 12,
          color: 'var(--muted)',
          paddingTop: 8,
          borderTop: '1px solid var(--line)',
        }}
      >
        <span>
          <strong
            style={{
              color: 'var(--ink)',
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            }}
          >
            {app.run_count.toLocaleString()}
          </strong>{' '}
          runs
          {app.last_run_at ? ` · last ${formatTime(app.last_run_at)}` : ''}
        </span>
        <span
          data-testid={`studio-apps-open-${app.slug}`}
          style={{
            fontSize: 12,
            color: 'var(--accent)',
            fontWeight: 600,
          }}
        >
          Open dashboard →
        </span>
      </div>
    </Link>
  );
}

// ------------------------------------------------------------------
// Recent activity panel (sourced from /me/runs, scoped to owned slugs)
// ------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function RecentActivityPanel({ runs }: { runs: MeRunSummary[] }) {
  const visible = runs.slice(0, 5);
  if (visible.length === 0) return null;

  return (
    <div
      data-testid="studio-apps-activity-feed"
      style={{
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        padding: '18px 20px 6px',
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
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
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--muted)',
            }}
          >
            Recent activity
          </span>
        </div>
        <Link
          to="/studio/runs"
          data-testid="studio-apps-activity-see-all"
          style={{
            fontSize: 12.5,
            color: 'var(--muted)',
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          All runs →
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
                gap: 14,
                alignItems: 'center',
                padding: '12px 16px',
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
                <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{appLabel}</span>{' '}
                <span style={{ color: 'var(--muted)' }}>· {run.action}</span>
              </div>
              <span
                style={{
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
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

function StudioEmptyState() {
  return (
    <div
      data-testid="studio-apps-empty"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        padding: '48px 24px 56px',
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 14,
        marginBottom: 18,
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
        Ship your first app.
      </h3>
      <p
        style={{
          fontSize: 14,
          color: 'var(--muted)',
          margin: '0 auto 20px',
          maxWidth: 460,
          lineHeight: 1.55,
        }}
      >
        Paste a GitHub URL or an OpenAPI spec. Floom packages it as a
        runnable app with a public page, an MCP endpoint, and a JSON API.
        Under 60 seconds.
      </p>
      <Link
        to="/studio/build"
        className="btn-ink"
        data-testid="studio-apps-empty-cta"
      >
        + Deploy from GitHub
      </Link>
    </div>
  );
}

// ------------------------------------------------------------------
// Page — /studio/apps (v26)
// ------------------------------------------------------------------

export function StudioAppsV26Page() {
  const { apps, loading: appsLoading } = useMyApps();
  const { data: session } = useSession();
  const [recentRuns, setRecentRuns] = useState<MeRunSummary[] | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Filter state from URL param; default 'all'
  const rawFilter = searchParams.get('filter');
  const activeFilter: StudioAppFilter =
    rawFilter === 'active' || rawFilter === 'drafts' || rawFilter === 'pending'
      ? rawFilter
      : 'all';

  function handleFilterChange(f: StudioAppFilter) {
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

  const filteredApps = useMemo(
    () => (apps ? filterStudioApps(apps, activeFilter) : null),
    [apps, activeFilter],
  );

  const filterCounts = useMemo(
    (): Record<StudioAppFilter, number> => ({
      all: apps ? apps.length : 0,
      active: apps ? filterStudioApps(apps, 'active').length : 0,
      drafts: apps ? filterStudioApps(apps, 'drafts').length : 0,
      pending: apps ? filterStudioApps(apps, 'pending').length : 0,
    }),
    [apps],
  );

  // Fetch recent runs scoped to owned app slugs.
  //
  // Scoping caveat: BOTH /me/runs AND /api/hub/:slug/runs filter by the
  // CALLER's user_id/device_id on the server. There is currently no public
  // endpoint that returns "runs OTHER users triggered on your apps". Until
  // such an endpoint exists we scope honestly to the owner's own runs
  // (the label below says "Your recent runs" not "Latest across callers"),
  // and fetch in a single /me/runs request filtered client-side to owned
  // slugs. Follow-up: expose GET /api/hub/mine/activity server-side.
  useEffect(() => {
    if (!apps || apps.length === 0) return;
    const ownedSlugs = new Set(apps.map((a) => a.slug));
    let cancelled = false;
    api
      .getMyRuns(200)
      .then((resp) => {
        if (cancelled) return;
        const filtered = resp.runs
          .filter((r) => r.app_slug && ownedSlugs.has(r.app_slug));
        setRecentRuns(filtered);
      })
      .catch(() => {
        if (!cancelled) setRecentRuns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [apps]);

  const signedOutPreview =
    !!session && session.cloud_mode && session.user.is_local;

  // Client-side metrics: 7-day run count from recent runs (not all-time totals).
  // recentRuns holds the full filtered array (no slice); the activity panel
  // handles its own display slice. We only count runs within the last 7 days.
  // When recentRuns is null (loading) we return null so the UI can show —
  // rather than falling back to an all-time total that contradicts the label.
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const totalRuns =
    recentRuns !== null
      ? recentRuns.filter((r) => new Date(r.started_at) >= weekAgo).length
      : null;

  return (
    <WorkspacePageShell mode="studio" title="Studio apps · Floom">
      <div data-testid="studio-apps-page">
        {signedOutPreview ? (
          <div
            data-testid="studio-apps-signed-out"
            style={{
              padding: '48px 24px',
              textAlign: 'center',
              color: 'var(--muted)',
            }}
          >
            <h3 style={{ color: 'var(--ink)', marginBottom: 8 }}>
              Sign in to view Studio
            </h3>
            <Link to="/login?next=%2Fstudio%2Fapps" className="btn-ink">
              Sign in
            </Link>
          </div>
        ) : (
          <>
            {/* Page head */}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
                gap: 18,
                flexWrap: 'wrap',
                marginBottom: 18,
              }}
            >
              <div>
                <h1
                  style={{
                    fontWeight: 800,
                    fontSize: 30,
                    letterSpacing: '-0.02em',
                    lineHeight: 1.1,
                    margin: '0 0 5px',
                    color: 'var(--ink)',
                  }}
                >
                  Apps
                </h1>
                <p style={{ fontSize: 14, color: 'var(--muted)', margin: 0, lineHeight: 1.55 }}>
                  {apps && apps.length > 0
                    ? 'Published and draft apps you have built.'
                    : 'Apps you build and publish appear here.'}
                </p>
              </div>
              <Link
                to="/studio/build"
                data-testid="studio-apps-new-app-cta"
                style={{
                  padding: '8px 14px',
                  background: 'var(--ink)',
                  color: '#fff',
                  border: '1px solid var(--ink)',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 700,
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                + New app
              </Link>
            </div>

            {/* Compact hero metric strip (issue #913: NOT 4-card grid) */}
            {!appsLoading && (
              <CompactHeroStrip apps={apps ?? null} totalRuns={totalRuns} />
            )}

            {/* Filter chip toolbar (wireframe studio-apps.html line 114) */}
            {!appsLoading && apps && apps.length > 0 && (
              <StudioFilterChipBar
                active={activeFilter}
                counts={filterCounts}
                onChange={handleFilterChange}
              />
            )}

            {/* Loading state */}
            {appsLoading && !apps && (
              <div
                data-testid="studio-apps-loading"
                style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}
              >
                {[1, 2].map((i) => (
                  <div
                    key={i}
                    style={{
                      background: 'var(--card)',
                      border: '1px solid var(--line)',
                      borderRadius: 14,
                      padding: 18,
                      height: 140,
                      boxShadow: 'var(--shadow-2)',
                    }}
                  >
                    <div style={{ width: '60%', height: 14, background: 'var(--line)', borderRadius: 4, marginBottom: 8 }} />
                    <div style={{ width: '90%', height: 10, background: 'var(--line)', borderRadius: 4 }} />
                  </div>
                ))}
              </div>
            )}

            {/* Apps grid */}
            {apps !== null && apps !== undefined && (
              <>
                {apps.length === 0 ? (
                  <StudioEmptyState />
                ) : (
                  <>
                    {/* Filter empty state — shown inline above grid, grid stays visible */}
                    {filteredApps !== null && filteredApps.length === 0 && activeFilter !== 'all' && (
                      <div
                        data-testid="studio-apps-filter-empty"
                        style={{
                          fontSize: 13,
                          color: 'var(--muted)',
                          marginBottom: 12,
                          padding: '10px 0',
                        }}
                      >
                        No apps match this filter.
                      </div>
                    )}

                    <style>{`@media (max-width: 760px) { [data-testid="studio-apps-grid"] { grid-template-columns: 1fr !important; } }`}</style>
                    <div
                      data-testid="studio-apps-grid"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, 1fr)',
                        gap: 14,
                        marginBottom: 18,
                      }}
                    >
                      {(filteredApps && filteredApps.length > 0 ? filteredApps : apps).map((app) => (
                        <StudioAppCard key={app.slug} app={app} />
                      ))}
                    </div>

                    {/* Recent activity panel */}
                    {recentRuns && recentRuns.length > 0 && (
                      <RecentActivityPanel runs={recentRuns} />
                    )}
                  </>
                )}
              </>
            )}

            {/* Bottom CTA: + New app (issue #917 overlay deferred; links to /studio/build) */}
            <div data-testid="studio-apps-bottom-cta" style={{ marginTop: 4 }}>
              <Link
                to="/studio/build"
                style={{
                  padding: '8px 16px',
                  background: 'var(--ink)',
                  color: '#fff',
                  border: '1px solid var(--ink)',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 700,
                  textDecoration: 'none',
                }}
              >
                + New app
              </Link>
            </div>
          </>
        )}
      </div>
    </WorkspacePageShell>
  );
}
