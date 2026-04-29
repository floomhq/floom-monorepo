/**
 * LandingMVPPage — slim landing for the launch-mvp branch.
 *
 * One job: land → sign up → mint MCP token.
 * Structure: Hero + 3-step explainer + mini footer.
 *
 * The full marketing landing (LandingV17Page) is preserved at /marketing.
 * This page is only wired on launch-mvp via main.tsx.
 */

import { Link } from 'react-router-dom';

const GITHUB_URL = 'https://github.com/floomhq/floom';

export function LandingMVPPage() {
  return (
    <div
      data-testid="landing-mvp"
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* Slim TopBar: floom · Sign in · Get started */}
      <header
        style={{
          height: 52,
          borderBottom: '1px solid var(--line)',
          background: 'var(--bg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <Link
          to="/"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 17,
            color: 'var(--ink)',
            textDecoration: 'none',
            letterSpacing: '-0.02em',
          }}
        >
          floom
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link
            to="/login"
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              color: 'var(--muted)',
              textDecoration: 'none',
            }}
          >
            Sign in
          </Link>
          <Link
            to="/signup"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '7px 14px',
              borderRadius: 999,
              background: 'var(--ink)',
              color: '#fff',
              fontSize: 13.5,
              fontWeight: 700,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Get started
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <section
          data-testid="mvp-hero"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '80px 24px 60px',
            borderBottom: '1px solid var(--line)',
            background: 'linear-gradient(180deg, var(--card) 0%, var(--bg) 100%)',
          }}
        >
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 56,
              lineHeight: 1.03,
              letterSpacing: '-0.025em',
              color: 'var(--ink)',
              margin: '0 0 20px',
              maxWidth: 720,
            }}
          >
            Ship AI apps fast.
          </h1>
          <p
            style={{
              fontSize: 18,
              lineHeight: 1.5,
              color: 'var(--muted)',
              maxWidth: 560,
              margin: '0 auto 32px',
              fontWeight: 400,
            }}
          >
            Mint your MCP token in 30 seconds and use Floom from Claude, Cursor, or Codex.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <Link
              to="/signup"
              data-testid="mvp-hero-cta"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '14px 28px',
                borderRadius: 999,
                background: 'var(--ink)',
                color: '#fff',
                fontSize: 16,
                fontWeight: 700,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              Get your MCP token →
</Link>
            <Link
              to="/login"
              style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none' }}
            >
              Already have an account? Sign in
            </Link>
          </div>
        </section>

        {/* 3-step explainer */}
        <section
          data-testid="mvp-steps"
          style={{ padding: '56px 24px 64px', maxWidth: 800, margin: '0 auto', width: '100%' }}
        >
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 22,
              letterSpacing: '-0.02em',
              textAlign: 'center',
              margin: '0 0 36px',
              color: 'var(--ink)',
            }}
          >
            Up and running in 3 steps
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {STEPS.map((step) => (
              <div
                key={step.num}
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--line)',
                  borderRadius: 12,
                  padding: '20px 18px',
                }}
              >
                <div
                  style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    color: 'var(--accent)',
                    textTransform: 'uppercase' as const,
                    marginBottom: 10,
                  }}
                >
                  Step {step.num}
                </div>
                <h3
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    margin: '0 0 8px',
                    color: 'var(--ink)',
                    lineHeight: 1.3,
                  }}
                >
                  {step.title}
                </h3>
                <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.55, margin: 0 }}>
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Mini footer */}
      <footer
        data-testid="mvp-footer"
        style={{
          borderTop: '1px solid var(--line)',
          padding: '16px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <Link
          to="/"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 14,
            color: 'var(--ink)',
            textDecoration: 'none',
            letterSpacing: '-0.02em',
          }}
        >
          floom
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <Link to="/docs/privacy" style={{ fontSize: 12.5, color: 'var(--muted)', textDecoration: 'none' }}>Privacy</Link>
          <Link to="/docs/terms" style={{ fontSize: 12.5, color: 'var(--muted)', textDecoration: 'none' }}>Terms</Link>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: 'var(--muted)', textDecoration: 'none' }}>GitHub</a>
        </div>
      </footer>
    </div>
  );
}

const STEPS = [
  {
    num: '1',
    title: 'Sign up',
    body: 'Create a free account. No credit card needed. Free during the beta.',
  },
  {
    num: '2',
    title: 'Mint your token',
    body: 'Go to Agent Keys and mint your floom_agent_* token. One click.',
  },
  {
    num: '3',
    title: 'Paste the snippet',
    body: 'Copy the MCP config and paste it into Claude Desktop, Cursor, or Codex.',
  },
];
