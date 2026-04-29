// /studio/:slug/feedback — per-app user reviews for the app creator (GH #881).
// Fetches from GET /api/hub/:slug/feedback (owner-only).

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { WorkspacePageShell } from '../components/WorkspacePageShell';
import { AppHeader } from './MeAppPage';
import { StudioAppTabs } from './StudioAppPage';
import * as api from '../api/client';
import type { AppDetail } from '../lib/types';
import type { AppFeedbackResponse } from '../api/client';
import { formatTime } from '../lib/time';

export function StudioAppFeedbackPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const nav = useNavigate();
  const [app, setApp] = useState<AppDetail | null>(null);
  const [feedbackData, setFeedbackData] = useState<AppFeedbackResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);
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
      .getAppFeedback(slug)
      .then((res) => {
        if (!cancelled) {
          setFeedbackData(res);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFeedbackData({ slug, summary: { count: 0, avg: 0 }, feedback: [] });
          setLoading(false);
        }
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

          {loading ? (
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 20 }}>Loading…</div>
          ) : feedbackData && feedbackData.feedback.length > 0 ? (
            <div style={{ maxWidth: 760, margin: '20px 0' }}>
              {/* Summary row */}
              <div
                style={{
                  display: 'flex',
                  gap: 20,
                  marginBottom: 20,
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--ink)' }}>
                    {feedbackData.summary.avg > 0
                      ? feedbackData.summary.avg.toFixed(1)
                      : '—'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    avg · {feedbackData.summary.count} review{feedbackData.summary.count === 1 ? '' : 's'}
                  </div>
                </div>
                {feedbackData.summary.avg > 0 && (
                  <div style={{ display: 'flex', gap: 2 }}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <span
                        key={n}
                        style={{
                          fontSize: 18,
                          color:
                            n <= Math.round(feedbackData.summary.avg)
                              ? 'var(--accent)'
                              : 'var(--line)',
                        }}
                      >
                        ★
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Review list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {feedbackData.feedback.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      background: 'var(--card)',
                      border: '1px solid var(--line)',
                      borderRadius: 10,
                      padding: '14px 16px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 6,
                      }}
                    >
                      <div style={{ display: 'flex', gap: 2 }}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <span
                            key={n}
                            style={{
                              fontSize: 13,
                              color: n <= item.rating ? 'var(--accent)' : 'var(--line)',
                            }}
                          >
                            ★
                          </span>
                        ))}
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {item.author_display}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
                        {formatTime(item.created_at)}
                      </span>
                    </div>
                    {item.title && (
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: 'var(--ink)',
                          marginBottom: 4,
                        }}
                      >
                        {item.title}
                      </div>
                    )}
                    {item.body && (
                      <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.55 }}>
                        {item.body}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <section style={cardStyle}>
              <div style={kickerStyle}>Feedback</div>
              <h1 style={h1Style}>No reviews yet</h1>
              <p style={bodyStyle}>
                User reviews for this app will appear here. Share your app's link to start
                collecting feedback.
              </p>
            </section>
          )}
        </>
      )}
    </WorkspacePageShell>
  );
}

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--line)',
  borderRadius: 12,
  background: 'var(--card)',
  padding: 24,
  maxWidth: 760,
  marginTop: 20,
};

const kickerStyle: React.CSSProperties = {
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
  marginBottom: 8,
};

const h1Style: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 28,
  fontWeight: 800,
  letterSpacing: 0,
  margin: 0,
  color: 'var(--ink)',
};

const bodyStyle: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.6,
  color: 'var(--muted)',
  margin: '10px 0 0',
  maxWidth: 620,
};
