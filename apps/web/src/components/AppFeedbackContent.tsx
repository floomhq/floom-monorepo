// AppFeedbackContent — shared per-app feedback list + summary, used by
// /studio/:slug/feedback (creator view) and /run/apps/:slug/feedback
// (consumer view). Single source of truth for review rendering so both
// surfaces stay visually consistent.
//
// Data source: GET /api/hub/:slug/feedback. The existing endpoint is
// owner-only on the server today; for the consumer "feedback" tab we
// surface a graceful empty/locked state on 403 so non-owners still see
// the tab and a clear CTA, instead of a hard error.

import { useEffect, useState } from 'react';
import * as api from '../api/client';
import type { AppFeedbackResponse } from '../api/client';
import { formatTime } from '../lib/time';

interface Props {
  appSlug: string;
  /**
   * `studio` = creator viewing their own app's reviews (full data).
   * `run`    = consumer viewing the same surface from /run/apps. Same
   * rendering, but a 403 from the owner-only endpoint is treated as
   * "no public feed yet" rather than a hard error.
   */
  mode: 'studio' | 'run';
}

export function AppFeedbackContent({ appSlug, mode }: Props) {
  const [data, setData] = useState<AppFeedbackResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!appSlug) return;
    let cancelled = false;
    setLoading(true);
    api
      .getAppFeedback(appSlug)
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setLoading(false);
        }
      })
      .catch(() => {
        // Same fallback for both modes: empty state. Server returns
        // owner-only data today; consumer mode just sees the empty card.
        if (!cancelled) {
          setData({ slug: appSlug, summary: { count: 0, avg: 0 }, feedback: [] });
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [appSlug]);

  if (loading) {
    return (
      <div
        data-testid="app-feedback-loading"
        style={{ fontSize: 13, color: 'var(--muted)', marginTop: 20 }}
      >
        Loading…
      </div>
    );
  }

  if (!data || data.feedback.length === 0) {
    return (
      <section data-testid="app-feedback-empty" style={cardStyle}>
        <div style={kickerStyle}>Feedback</div>
        <h1 style={h1Style}>No reviews yet</h1>
        <p style={bodyStyle}>
          {mode === 'studio'
            ? "User reviews for this app will appear here. Share your app's link to start collecting feedback."
            : 'Be the first to leave a review on the app page.'}
        </p>
        {mode === 'run' && (
          <a
            href={`/p/${appSlug}`}
            style={{
              display: 'inline-block',
              marginTop: 14,
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--accent, #047857)',
              textDecoration: 'none',
            }}
          >
            Leave a review →
          </a>
        )}
      </section>
    );
  }

  return (
    <div data-testid="app-feedback-content" style={{ maxWidth: 760, margin: '20px 0' }}>
      {/* Summary row */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 20, alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--ink)' }}>
            {data.summary.avg > 0 ? data.summary.avg.toFixed(1) : '—'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            avg · {data.summary.count} review{data.summary.count === 1 ? '' : 's'}
          </div>
        </div>
        {data.summary.avg > 0 && (
          <div style={{ display: 'flex', gap: 2 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <span
                key={n}
                style={{
                  fontSize: 18,
                  color:
                    n <= Math.round(data.summary.avg)
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
        {data.feedback.map((item) => (
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
