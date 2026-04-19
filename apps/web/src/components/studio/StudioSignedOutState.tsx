import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';

const wrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
};

const heroStyle: CSSProperties = {
  border: '1px solid var(--line)',
  borderRadius: 12,
  background: 'var(--card)',
  padding: '28px 28px 24px',
};

const eyebrowStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--accent)',
  marginBottom: 14,
};

const ctaRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 10,
  marginTop: 18,
};

const primaryCtaStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '10px 16px',
  borderRadius: 8,
  background: 'var(--ink)',
  border: '1px solid var(--ink)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  textDecoration: 'none',
};

const secondaryCtaStyle: CSSProperties = {
  ...primaryCtaStyle,
  background: 'var(--bg)',
  border: '1px solid var(--line)',
  color: 'var(--ink)',
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 12,
};

const cardStyle: CSSProperties = {
  border: '1px solid var(--line)',
  borderRadius: 12,
  background: 'rgba(255,255,255,0.72)',
  padding: '18px 18px 16px',
  minHeight: 172,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const pillStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  alignSelf: 'flex-start',
  padding: '3px 8px',
  borderRadius: 999,
  background: 'var(--accent-soft, rgba(16,185,129,0.08))',
  color: 'var(--accent)',
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const sectionMap = [
  {
    title: 'Publish',
    body: 'Start from a repo URL, app URL, or OpenAPI spec. Studio turns it into the store, MCP, and HTTP surfaces.',
    detail: 'After sign in: publish flow and owned app list',
  },
  {
    title: 'Runs',
    body: 'Review the latest executions for each app so you can spot failures, timing changes, and what users actually ran.',
    detail: 'After sign in: per-app overview and runs',
  },
  {
    title: 'Secrets + access',
    body: 'Keep sensitive keys and visibility controls in one place. Public, private, and auth-required stay explicit.',
    detail: 'After sign in: secrets and access',
  },
  {
    title: 'Renderer + analytics',
    body: 'Tune how outputs render and monitor the health of each app without leaving the creator workspace.',
    detail: 'After sign in: renderer and analytics',
  },
] as const;

const sections = ['Overview', 'Runs', 'Secrets', 'Access', 'Renderer', 'Analytics'] as const;

export function StudioSignedOutState() {
  return (
    <section
      data-testid="studio-signed-out-shell"
      aria-label="Studio preview"
      style={wrapStyle}
    >
      <div style={heroStyle}>
        <div style={eyebrowStyle}>
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--accent)',
            }}
          />
          Signed-out preview
        </div>

        <h1
          style={{
            fontSize: 30,
            fontWeight: 700,
            color: 'var(--ink)',
            margin: '0 0 10px',
          }}
        >
          Studio
        </h1>
        <p
          style={{
            margin: 0,
            maxWidth: 720,
            fontSize: 15,
            lineHeight: 1.65,
            color: 'var(--muted)',
          }}
        >
          Studio is the creator workspace for publishing apps, tuning access,
          inspecting runs, and keeping the web, MCP, and HTTP surfaces aligned.
          Sign in to load the apps you own and unlock the actions that touch
          sensitive app data.
        </p>

        <div style={ctaRowStyle}>
          <Link to="/login?next=%2Fstudio" style={primaryCtaStyle}>
            Sign in to open Studio
          </Link>
          <Link to="/apps" style={secondaryCtaStyle}>
            Browse live apps
          </Link>
        </div>
      </div>

      <div style={gridStyle}>
        {sectionMap.map((item) => (
          <article key={item.title} style={cardStyle}>
            <span style={pillStyle}>Reviewable shell</span>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>
              {item.title}
            </div>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                lineHeight: 1.6,
                color: 'var(--muted)',
              }}
            >
              {item.body}
            </p>
            <div
              style={{
                marginTop: 'auto',
                paddingTop: 10,
                borderTop: '1px solid var(--line)',
                fontSize: 12,
                color: 'var(--ink)',
                fontWeight: 600,
              }}
            >
              {item.detail}
            </div>
          </article>
        ))}
      </div>

      <div
        style={{
          border: '1px dashed var(--line)',
          borderRadius: 12,
          background: 'rgba(255,255,255,0.68)',
          padding: '18px 20px',
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--muted)',
            marginBottom: 12,
          }}
        >
          Per-app sections
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          {sections.map((label) => (
            <span
              key={label}
              style={{
                padding: '7px 10px',
                borderRadius: 999,
                border: '1px solid var(--line)',
                background: 'var(--card)',
                color: 'var(--ink)',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
