// /studio/:slug/analytics — real usage stats (GH #882).
// Fetches from GET /api/hub/:slug/analytics and renders 4 stat cards
// + a 7-day bar sparkline. No more "Coming v1.1" stub.

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { WorkspacePageShell } from '../components/WorkspacePageShell';
import { StudioAppTabs } from '../components/StudioAppTabs';
import { AppHeader } from './MeAppPage';
import * as api from '../api/client';
import type { AppDetail } from '../lib/types';
import type { AppAnalytics } from '../api/client';
import { formatTime } from '../lib/time';

export function StudioAppAnalyticsPage() {
  const { slug } = useParams<{ slug: string }>();
  const nav = useNavigate();
  const [app, setApp] = useState<AppDetail | null>(null);
  const [analytics, setAnalytics] = useState<AppAnalytics | null>(null);
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
    api
      .getAppAnalytics(slug)
      .then((res) => !cancelled && setAnalytics(res))
      .catch(() => !cancelled && setAnalytics(null));
    return () => {
      cancelled = true;
    };
  }, [slug, nav]);

  return (
    <WorkspacePageShell
      mode="studio"
      title={app ? `${app.name} · Analytics · Studio` : 'Analytics · Studio'}
    >
      <StudioAppTabs slug={slug ?? ''} activeTab="analytics" />
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

          {!analytics ? (
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 20 }}>Loading…</div>
          ) : (
            <div style={{ maxWidth: 760, margin: '20px 0' }}>
              {/* Stat cards row */}
              <div
                data-testid="analytics-stat-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: 12,
                  marginBottom: 24,
                }}
              >
                <StatCard
                  label="Total runs"
                  value={analytics.total_runs.toLocaleString()}
                  sub="all time"
                />
                <StatCard
                  label="Runs (7d)"
                  value={analytics.runs_7d.toLocaleString()}
                  sub="last 7 days"
                />
                <StatCard
                  label="Success rate"
                  value={
                    analytics.success_rate != null
                      ? `${Math.round(analytics.success_rate * 100)}%`
                      : '—'
                  }
                  sub={analytics.total_runs === 0 ? 'no runs yet' : 'of completed runs'}
                />
                <StatCard
                  label="Avg duration"
                  value={
                    analytics.avg_duration_ms != null
                      ? analytics.avg_duration_ms >= 1000
                        ? `${(analytics.avg_duration_ms / 1000).toFixed(1)}s`
                        : `${analytics.avg_duration_ms}ms`
                      : '—'
                  }
                  sub={analytics.avg_duration_ms != null ? 'successful runs' : 'no data yet'}
                />
                <StatCard
                  label="Last run"
                  value={
                    analytics.last_run_at
                      ? formatTime(analytics.last_run_at)
                      : '—'
                  }
                  sub={analytics.last_run_at ? 'most recent' : 'no runs yet'}
                />
              </div>

              {/* 7-day sparkline */}
              <div
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--line)',
                  borderRadius: 12,
                  padding: '20px 20px 16px',
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--muted)',
                    marginBottom: 12,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  Runs per day · last 7 days
                </div>
                <SparkBar days={analytics.runs_by_day} />
              </div>
            </div>
          )}
        </>
      )}
    </WorkspacePageShell>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div
      style={{
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 10,
        padding: '14px 16px',
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{sub}</div>
      )}
    </div>
  );
}

function SparkBar({ days }: { days: Array<{ date: string; count: number }> }) {
  const max = Math.max(...days.map((d) => d.count), 1);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 6,
        height: 80,
      }}
    >
      {days.map((d) => (
        <div
          key={d.date}
          title={`${d.date}: ${d.count} run${d.count === 1 ? '' : 's'}`}
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            height: '100%',
            justifyContent: 'flex-end',
          }}
        >
          <div
            style={{
              width: '100%',
              height: `${Math.max((d.count / max) * 60, d.count > 0 ? 4 : 2)}px`,
              background: d.count > 0 ? 'var(--accent)' : 'var(--line)',
              borderRadius: '2px 2px 0 0',
              minHeight: 2,
            }}
          />
          <div style={{ fontSize: 9, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
            {d.date.slice(5)}
          </div>
        </div>
      ))}
    </div>
  );
}
