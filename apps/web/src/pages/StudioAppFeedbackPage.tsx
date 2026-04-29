import { useParams } from 'react-router-dom';
import { WorkspacePageShell, WorkspaceHeader } from '../components/WorkspacePageShell';
import { StudioAppTabs } from '../components/StudioAppTabs';

/**
 * StudioAppFeedbackPage — `/studio/:slug/feedback`
 *
 * Per-app feedback / reviews. Designed placeholder until the full-stack
 * feature lands (issue #987). Replaces a 404 with a proper empty state.
 */
export function StudioAppFeedbackPage() {
  const { slug = '' } = useParams<{ slug: string }>();

  return (
    <WorkspacePageShell mode="studio" title={`${slug} feedback · Floom`}>
      <StudioAppTabs slug={slug} activeTab="feedback" />

      <WorkspaceHeader
        eyebrow="FEEDBACK"
        title="What users think of this app"
        scope="Ratings and comments from people who ran your app. Live in v1.0."
      />

      <section style={panelStyle} aria-labelledby="feedback-empty-heading">
        <div style={iconStyle} aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <h2 id="feedback-empty-heading" style={headingStyle}>
          Feedback launches in v1.0
        </h2>
        <p style={copyStyle}>
          Anyone who runs your app will be able to leave a 1-5 rating and a short comment. You&rsquo;ll see the average rating, full list of feedback, and trends over time &mdash; right here.
        </p>
        <div style={specStyle}>
          <div style={specRowStyle}><span style={specBulletStyle} /><span><strong>Aggregate rating</strong> &mdash; average, total count, distribution 1-5</span></div>
          <div style={specRowStyle}><span style={specBulletStyle} /><span><strong>Per-feedback list</strong> &mdash; rating, comment, user, timestamp</span></div>
          <div style={specRowStyle}><span style={specBulletStyle} /><span><strong>Trend</strong> &mdash; rating average over time, week-by-week</span></div>
        </div>
        <p style={trackingStyle}>
          Tracked in{' '}
          <a href="https://github.com/floomhq/floom/issues/987" target="_blank" rel="noreferrer" style={linkStyle}>
            issue #987
          </a>.
        </p>
      </section>
    </WorkspacePageShell>
  );
}

const panelStyle = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 14,
  padding: '32px 28px',
  boxShadow: 'var(--shadow-1)',
  maxWidth: 640,
  margin: '8px 0',
} as const;

const iconStyle = {
  width: 44,
  height: 44,
  borderRadius: 11,
  background: 'var(--accent-soft)',
  border: '1px solid var(--accent-border)',
  color: 'var(--accent)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: 16,
} as const;

const headingStyle = {
  fontFamily: 'var(--font-display)',
  fontSize: 22,
  fontWeight: 800,
  letterSpacing: '-0.01em',
  color: 'var(--ink)',
  margin: '0 0 8px',
} as const;

const copyStyle = {
  margin: '0 0 18px',
  fontSize: 14,
  lineHeight: 1.55,
  color: 'var(--muted)',
} as const;

const specStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 10,
  paddingTop: 16,
  borderTop: '1px solid var(--line)',
};

const specRowStyle = {
  display: 'flex',
  alignItems: 'flex-start' as const,
  gap: 10,
  fontSize: 13,
  lineHeight: 1.55,
  color: 'var(--ink)',
};

const specBulletStyle = {
  width: 6,
  height: 6,
  borderRadius: 999,
  background: 'var(--accent)',
  flexShrink: 0,
  marginTop: 7,
};

const trackingStyle = {
  margin: '20px 0 0',
  fontSize: 12,
  color: 'var(--muted)',
  fontFamily: 'var(--font-mono)',
};

const linkStyle = {
  color: 'var(--accent)',
  textDecoration: 'none',
  fontWeight: 600,
};
