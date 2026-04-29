// /studio/:slug/feedback — per-app user reviews for the app creator (GH #881).
// Fetches from GET /api/hub/:slug/feedback (owner-only).
//
// Review list rendering is delegated to <AppFeedbackContent /> so the
// consumer-side /run/apps/:slug/feedback (issue #1083) renders the
// exact same UI from one source of truth.

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { WorkspacePageShell } from '../components/WorkspacePageShell';
import { AppFeedbackContent } from '../components/AppFeedbackContent';
import { AppHeader } from './MeAppPage';
import { StudioAppTabs } from './StudioAppPage';
import * as api from '../api/client';
import type { AppDetail } from '../lib/types';

export function StudioAppFeedbackPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const nav = useNavigate();
  const [app, setApp] = useState<AppDetail | null>(null);
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
        if (status === 404) return nav('/studio', { replace: true });
        if (status === 403) return nav(`/p/${slug}`, { replace: true });
        setError((err as Error).message || 'Failed to load app');
      });
    return () => {
      cancelled = true;
    };
  }, [slug, nav]);

  return (
    <WorkspacePageShell mode="studio" title="Feedback · Studio">
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
      {app && (
        <>
          <AppHeader app={app} />
          <StudioAppTabs slug={slug} active="feedback" />
          <AppFeedbackContent appSlug={slug} mode="studio" />
        </>
      )}
    </WorkspacePageShell>
  );
}
