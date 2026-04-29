// /studio/:slug/runs — full list of runs scoped to a single app. The
// Studio Overview tab shows only the most recent 5; this page is the
// "see all" destination. Owner-only.
//
// Table rendering is delegated to <AppRunsList /> so the consumer-side
// /run/apps/:slug/history (issue #1084) renders the exact same UI.

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { WorkspacePageShell } from '../components/WorkspacePageShell';
import { StudioAppTabs } from '../components/StudioAppTabs';
import { AppRunsList, type AppRunRow } from '../components/AppRunsList';
import { AppHeader } from './MeAppPage';
import * as api from '../api/client';
import type { AppDetail, CreatorRun } from '../lib/types';

export function StudioAppRunsPage() {
  const { slug } = useParams<{ slug: string }>();
  const nav = useNavigate();
  const [app, setApp] = useState<AppDetail | null>(null);
  const [runs, setRuns] = useState<CreatorRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    api
      .getApp(slug)
      .then((res) => !cancelled && setApp(res))
      .catch((err) => {
        if (cancelled) return;
        const status = (err as { status?: number }).status;
        if (status === 404) {
          nav('/studio', { replace: true });
          return;
        }
        if (status === 403) {
          nav(`/p/${slug}`, { replace: true });
          return;
        }
        setError((err as Error).message || 'Failed to load app');
      });
    api
      .getAppRuns(slug, 100)
      .then((res) => !cancelled && setRuns(res.runs))
      .catch(() => !cancelled && setRuns([]));
    return () => {
      cancelled = true;
    };
  }, [slug, nav]);

  const rows: AppRunRow[] | null = runs
    ? runs.map((r) => ({
        id: r.id,
        started_at: r.started_at,
        action: r.action,
        status: r.status,
        duration_ms: r.duration_ms,
        href: `/me/runs/${r.id}`,
      }))
    : null;

  return (
    <WorkspacePageShell
      mode="studio"
      title={app ? `${app.name} · Runs · Studio` : 'Runs · Studio'}
    >
      <StudioAppTabs slug={slug ?? ''} activeTab="runs" />
      {error && <div style={errorStyle}>{error}</div>}
      {app && (
        <>
          <AppHeader app={app} />
          <h2 style={sectionHeader}>All runs</h2>
          <AppRunsList
            rows={rows}
            emptyTitle="No runs yet"
            emptyBody={
              <>
                Share <code style={{ fontFamily: 'var(--font-mono)' }}>/p/{app.slug}</code> to drive your first run.
              </>
            }
            testId="studio-app-runs"
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

const errorStyle: React.CSSProperties = {
  background: '#fdecea',
  border: '1px solid #f4b7b1',
  color: '#c2321f',
  padding: '10px 14px',
  borderRadius: 8,
  fontSize: 13,
  marginBottom: 20,
};
