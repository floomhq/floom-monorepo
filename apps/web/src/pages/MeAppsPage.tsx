/**
 * /run/apps — thin wrapper over AppsList.
 * Data fetching lives here; all rendering in AppsList.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { WorkspacePageShell } from '../components/WorkspacePageShell';
import {
  AppsList,
  runAppsFromRuns,
  type AppsListActivityRow,
} from '../components/workspace/AppsList';
import { useSession } from '../hooks/useSession';
import { useMyRuns } from '../hooks/useMyRuns';
import { formatTime } from '../lib/time';

export function MeAppsPage() {
  const { data: session, loading: sessionLoading, error: sessionError } = useSession();
  const { runs } = useMyRuns();

  const signedOutPreview = !!session && session.cloud_mode && session.user.is_local;
  const sessionPending = sessionLoading || (session === null && !sessionError);

  const apps = useMemo(() => (runs ? runAppsFromRuns(runs) : null), [runs]);

  // Runs 7d: count runs from the last 7 days using same data already fetched
  const runs7d = useMemo(() => {
    if (!runs) return null;
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return runs.filter((r) => {
      const ts = r.started_at ? new Date(r.started_at).getTime() : 0;
      return ts >= cutoff;
    }).length;
  }, [runs]);

  // Active runs right now (status === 'running')
  const activeNow = useMemo(() => {
    if (!runs) return null;
    return runs.filter((r) => (r as { status?: string }).status === 'running').length;
  }, [runs]);

  // Build recent-activity rows from the most recent 5 runs
  const activityRows = useMemo((): AppsListActivityRow[] => {
    if (!runs || runs.length === 0) return [];
    return runs.slice(0, 5).map((run) => ({
      id: run.id,
      title: run.app_name || run.app_slug || 'App',
      snippet: run.action || '',
      duration: run.duration_ms != null
        ? run.duration_ms < 1000
          ? `${Math.round(run.duration_ms)}ms`
          : `${(run.duration_ms / 1000).toFixed(1)}s`
        : '—',
      when: formatTime(run.started_at),
      href: `/run/runs/${encodeURIComponent(run.id)}`,
      fast: run.duration_ms != null && run.duration_ms < 2000,
    }));
  }, [runs]);

  const loading = runs === null && !signedOutPreview && !sessionPending;

  return (
    <WorkspacePageShell
      mode="run"
      title="Apps · Workspace Run · Floom"
      allowSignedOutShell={signedOutPreview}
    >
      <AppsList
        mode="run"
        heading="Apps"
        subtitle={
          apps && apps.length > 0
            ? `${apps.length} app${apps.length === 1 ? '' : 's'} in this workspace — last run ${runs && runs.length > 0 ? formatTime(runs[0].started_at) : 'never'}.`
            : 'Install apps from the store. Runs appear here as you trigger them.'
        }
        primaryCta={
          <Link to="/apps" className="btn-ghost sm" style={{ textDecoration: 'none' }}>
            Browse store →
          </Link>
        }
        stats={[
          { label: 'Apps', value: apps ? String(apps.length) : '…', sub: !apps || apps.length === 0 ? 'none yet' : 'in workspace' },
          { label: 'Runs 7d', value: runs7d !== null ? String(runs7d) : '…', sub: runs7d === 0 ? 'none yet' : 'this week' },
          { label: 'Running now', value: activeNow !== null ? String(activeNow) : '…', sub: activeNow === 0 ? 'idle' : 'active' },
          { label: 'Avg speed', value: '—', sub: 'not tracked yet' },
        ]}
        filters={[
          { label: 'All', active: true },
          { label: 'Recently used' },
          { label: 'Scheduled' },
        ]}
        toolbarAction={
          <Link to="/apps" className="btn-ghost sm" style={{ textDecoration: 'none' }}>
            Browse store →
          </Link>
        }
        apps={apps}
        activityTitle="Recent runs"
        activityAllHref="/run/runs"
        activityRows={activityRows}
        stripCta={
          <Link to="/apps" className="btn-ghost sm" style={{ textDecoration: 'none' }}>
            Browse the app store →
          </Link>
        }
        loading={loading}
      />
    </WorkspacePageShell>
  );
}
