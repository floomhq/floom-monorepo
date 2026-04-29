// /studio/apps (v26: /studio → /studio/apps via redirect)
// v26-IA-SPEC §12.2: same shell shape as /run/apps (WorkspacePageShell mode="studio")

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { WorkspacePageShell } from '../components/WorkspacePageShell';
import { StudioSignedOutState } from '../components/studio/StudioSignedOutState';
import * as api from '../api/client';
import { useMyApps } from '../hooks/useMyApps';
import { useSession } from '../hooks/useSession';
import { useDeployEnabled } from '../lib/flags';
import { formatTime } from '../lib/time';
import type { CreatorApp, MeRunSummary } from '../lib/types';
import { WaitlistModal } from '../components/WaitlistModal';
import {
  AppsList,
  studioAppsFromCreatorApps,
  type AppsListActivityRow,
} from '../components/workspace/AppsList';

/** Legacy v25 home — kept at /studio/overview for back-compat. */
export function StudioHomePage() {
  const { data: session } = useSession();
  const signedOutPreview = !!session && session.cloud_mode && session.user.is_local;
  return (
    <WorkspacePageShell
      mode="studio"
      title="Studio · Floom"
      allowSignedOutShell={signedOutPreview}
    >
      {/* Redirect handled at route level (/studio → /studio/apps).
          This page is only reachable via /studio/overview for back-compat. */}
      <div style={{ padding: '24px 0' }}>
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>
          Redirecting to Studio apps&hellip;
        </p>
      </div>
    </WorkspacePageShell>
  );
}

export function StudioAppsPage() {
  const { apps, error: loadError } = useMyApps();
  const { data: session } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [recentRuns, setRecentRuns] = useState<MeRunSummary[] | null>(null);
  const signedOutPreview = !!session && session.cloud_mode && session.user.is_local;
  // Launch flag. Null while session loads → fall back to showing the
  // original + New app / Start publishing CTAs rather than flickering.
  // A cold-load user who clicks before the session resolves would go to
  // /studio/build, which in turn runs through the same gate at render.
  const deployEnabled = useDeployEnabled();
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const waitlistMode = deployEnabled === false;

  useEffect(() => {
    if (signedOutPreview) {
      setError(null);
      return;
    }
    if (loadError) setError(loadError.message);
  }, [loadError, signedOutPreview]);

  // Fetch the cross-app activity feed. Only runs when we have a real
  // signed-in session (not the signed-out preview). Falls back to an
  // empty array on error so the panel shows an honest "no runs yet"
  // empty state instead of faking data.
  //
  // Scoping caveat: BOTH /me/runs AND /api/hub/:slug/runs filter by the
  // CALLER's user_id/device_id. There is currently no public endpoint
  // that returns "runs OTHER users triggered on your apps". We scope
  // honestly to the owner's own runs (the label "Your recent runs"
  // reflects that scope). Follow-up: expose /api/hub/mine/activity.
  useEffect(() => {
    if (signedOutPreview) return;
    if (!apps || apps.length === 0) return;
    const ownedSlugs = new Set(apps.map((a) => a.slug));
    let cancelled = false;
    api
      .getMyRuns(200)
      .then((resp) => {
        if (cancelled) return;
        const filtered = resp.runs
          .filter((r) => r.app_slug && ownedSlugs.has(r.app_slug))
          .slice(0, 6);
        setRecentRuns(filtered);
      })
      .catch(() => {
        if (!cancelled) setRecentRuns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [apps, signedOutPreview]);

  // Client-side metrics derived from the apps list. We deliberately
  // only show numbers we can verify — total run count summed from the
  // per-app counters, and the live/draft split. Success rate, p50
  // latency, unique users appear in the wireframe but require hub-level
  // aggregates the API doesn't expose yet; per
  // memory/feedback_never_fabricate.md we leave them out rather than
  // hardcode an "illustrative" number.
  //
  // Live semantics: treat `published` OR undefined as live; only the
  // explicit non-published states (draft / pending_review / rejected)
  // count as drafts. Preserves back-compat with older servers.
  const liveCount = apps?.filter(isLiveApp).length ?? 0;
  const draftCount = apps?.filter((a) => !isLiveApp(a)).length ?? 0;
  const totalRuns = apps?.reduce((sum, a) => sum + (a.run_count || 0), 0) ?? 0;

  // Activity rows for the secondary panel
  const activityRows = useMemo((): AppsListActivityRow[] => {
    if (!recentRuns || recentRuns.length === 0) return [];
    return recentRuns.map((run) => ({
      id: run.id,
      title: run.app_name || run.app_slug || 'App',
      snippet: run.action || '',
      duration:
        run.duration_ms != null
          ? run.duration_ms < 1000
            ? `${Math.round(run.duration_ms)}ms`
            : `${(run.duration_ms / 1000).toFixed(1)}s`
          : '—',
      when: formatTime(run.started_at),
      href: `/studio/${run.app_slug}`,
      fast: run.duration_ms != null && run.duration_ms < 2000,
    }));
  }, [recentRuns]);

  // Convert CreatorApp[] → AppsListAppItem[] for the shared AppsList component
  const appsListItems = useMemo(
    () => (apps ? studioAppsFromCreatorApps(apps) : null),
    [apps],
  );

  const primaryCta = waitlistMode ? (
    <button
      type="button"
      onClick={() => setWaitlistOpen(true)}
      data-testid="studio-new-app-waitlist"
      className="btn-ink"
      style={{ border: 'none', cursor: 'pointer', font: 'inherit' }}
    >
      Join waitlist
    </button>
  ) : (
    <Link
      to="/studio/build"
      data-testid="studio-new-app-cta"
      className="btn-ink"
      style={{ textDecoration: 'none' }}
    >
      + New app
    </Link>
  );

  return (
    <WorkspacePageShell
      mode="studio"
      title="Studio apps · Floom"
      allowSignedOutShell={signedOutPreview}
    >
      <div data-testid="studio-apps-page">
        {signedOutPreview ? (
          <StudioSignedOutState />
        ) : (
          <AppsList
            mode="studio"
            heading="Apps"
            subtitle={
              apps && apps.length > 0
                ? `${apps.length} app${apps.length === 1 ? '' : 's'} owned by this workspace — ${liveCount} live${draftCount > 0 ? `, ${draftCount} draft` : ''}.`
                : 'Publish apps from a GitHub repo or OpenAPI spec. They appear in the store once approved.'
            }
            primaryCta={primaryCta}
            stats={[
              {
                label: 'Runs total',
                value: apps ? totalRuns.toLocaleString() : '…',
                sub: totalRuns === 0 ? 'none yet' : 'all time',
              },
              {
                label: 'Apps',
                value: apps ? String(apps.length) : '…',
                sub:
                  !apps || apps.length === 0
                    ? 'none yet'
                    : `${liveCount} live${draftCount > 0 ? ` · ${draftCount} draft` : ''}`,
              },
              {
                label: 'Last run',
                value: apps ? lastRunLabel(apps) : '…',
              },
              {
                label: 'Avg speed',
                value: '—',
                sub: 'not tracked yet',
              },
            ]}
            filters={[
              { label: 'All', active: true },
              { label: 'Active' },
              { label: 'Drafts' },
              { label: 'Pending review' },
            ]}
            apps={appsListItems}
            activityTitle="Your recent runs"
            activityAllHref="/studio/runs"
            activityRows={activityRows}
            stripCta={primaryCta}
            loading={!apps && !error}
          />
        )}
      </div>
      <WaitlistModal
        open={waitlistOpen}
        onClose={() => setWaitlistOpen(false)}
        source="studio-deploy"
      />
    </WorkspacePageShell>
  );
}

function isLiveApp(app: CreatorApp): boolean {
  return !app.publish_status || app.publish_status === 'published';
}

function lastRunLabel(apps: CreatorApp[]): string {
  const latest = apps
    .map((a) => a.last_run_at)
    .filter((v): v is string => !!v)
    .sort((a, b) => (a < b ? 1 : -1))[0];
  if (!latest) return 'never';
  return formatTime(latest);
}
