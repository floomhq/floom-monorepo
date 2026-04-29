// /run/apps/:slug/history — consumer run history scoped to a single app.
//
// Issue #1084 (v26-iter28): the previous "View runs for this app →"
// inline cross-link is promoted to a real History tab. Mirrors
// StudioAppRunsPage's intent (per-app run table) but uses the consumer
// /api/me/runs endpoint and filters by `app_slug` client-side, since
// /api/hub/:slug/runs is owner-only.
//
// Rendering is delegated to <AppRunsList /> so Studio and Run-mode
// pages render the same table from one source.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { WorkspacePageShell } from '../components/WorkspacePageShell';
import { RunAppTabs } from '../components/RunAppTabs';
import { AppRunsList, type AppRunRow } from '../components/AppRunsList';
import { AppIcon } from '../components/AppIcon';
import * as api from '../api/client';
import type { AppDetail, MeRunSummary } from '../lib/types';

const FETCH_LIMIT = 200;

export function MeAppHistoryPage() {
  const { slug } = useParams<{ slug: string }>();
  const nav = useNavigate();
  const [app, setApp] = useState<AppDetail | null>(null);
  const [allRuns, setAllRuns] = useState<MeRunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    api
      .getApp(slug)
      .then((res) => {
        if (!cancelled) setApp(res);
      })
      .catch((err) => {
        if (cancelled) return;
        const status = (err as { status?: number }).status;
        if (status === 404) {
          nav('/run/apps', { replace: true });
          return;
        }
        setError((err as Error).message || 'Failed to load app');
      });
    api
      .getMyRuns(FETCH_LIMIT)
      .then((res) => {
        if (!cancelled) setAllRuns(res.runs);
      })
      .catch(() => {
        if (!cancelled) setAllRuns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, nav]);

  const rows: AppRunRow[] | null = useMemo(() => {
    if (!allRuns) return null;
    return allRuns
      .filter((r) => r.app_slug === slug)
      .map((r) => ({
        id: r.id,
        started_at: r.started_at,
        action: r.action ?? '—',
        status: r.status,
        duration_ms: r.duration_ms,
        href: `/run/runs/${r.id}`,
      }));
  }, [allRuns, slug]);

  return (
    <WorkspacePageShell
      mode="run"
      title={app ? `${app.name} · History · Floom` : 'History · Floom'}
    >
      {/* Breadcrumb (matches RunAppRunPage) */}
      <nav
        aria-label="Breadcrumb"
        style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}
      >
        <Link to="/run/apps" style={{ color: 'var(--muted)', textDecoration: 'none' }}>
          Apps
        </Link>
        <span style={{ margin: '0 6px' }}>›</span>
        {app ? (
          <Link
            to={`/run/apps/${app.slug}/run`}
            style={{ color: 'var(--muted)', textDecoration: 'none' }}
          >
            {app.name}
          </Link>
        ) : (
          <span>{slug}</span>
        )}
        <span style={{ margin: '0 6px' }}>›</span>
        <span style={{ color: 'var(--ink)' }}>History</span>
      </nav>

      {error && (
        <div
          style={{
            background: '#fdecea',
            border: '1px solid #f4b7b1',
            color: '#c2321f',
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 20,
          }}
        >
          {error}
        </div>
      )}

      {!app && !error && (
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</div>
      )}

      {app && (
        <>
          {/* App meta strip (mirrors RunAppRunPage) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 14,
              marginBottom: 20,
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background:
                  'radial-gradient(circle at 30% 25%, #d1fae5 0%, #ecfdf5 55%, #d1fae5 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                boxShadow:
                  'inset 0 0 0 1px rgba(5,150,105,0.15), 0 1px 2px rgba(5,150,105,0.18), inset 0 1px 0 rgba(255,255,255,0.6)',
              }}
            >
              <AppIcon slug={app.slug} size={22} color="#047857" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>
                {app.name}
              </h1>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--muted)',
                  marginTop: 3,
                }}
              >
                {app.slug}
                {app.version ? ` · v${app.version}` : ''}
              </div>
            </div>
          </div>

          <RunAppTabs slug={app.slug} activeTab="history" />

          <h2 style={sectionHeader}>Your runs</h2>
          <AppRunsList
            rows={rows}
            emptyTitle="No runs yet for this app"
            emptyBody={
              <>
                Head to the <Link to={`/run/apps/${app.slug}/run`} style={{ color: 'var(--accent)' }}>Run tab</Link> to kick off your first one.
              </>
            }
            testId="run-app-history"
          />
        </>
      )}
    </WorkspacePageShell>
  );
}

const sectionHeader: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--ink)',
  margin: '20px 0 12px',
};
