/**
 * HelpPage — /help placeholder for launch-mvp.
 *
 * Separate from /docs (reference content).
 * Provides support contact + Discord link.
 */

import { Link } from 'react-router-dom';
import { PageShell } from '../components/PageShell';

export function HelpPage() {
  return (
    <PageShell title="Help · Floom">
      <div
        style={{
          maxWidth: 600,
          margin: '64px auto',
          padding: '0 24px',
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 32,
            letterSpacing: '-0.025em',
            color: 'var(--ink)',
            margin: '0 0 12px',
          }}
        >
          Help
        </h1>
        <p style={{ fontSize: 15, color: 'var(--muted)', margin: '0 0 40px', lineHeight: 1.6 }}>
          Need help? We're here.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <a
            href="mailto:hello@floom.dev"
            style={{
              display: 'block',
              padding: '20px 22px',
              border: '1px solid var(--line)',
              borderRadius: 12,
              background: 'var(--card)',
              textDecoration: 'none',
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
              Email support
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              hello@floom.dev — we reply within 24 hours.
            </div>
          </a>

          <a
            href="https://discord.gg/floom"
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'block',
              padding: '20px 22px',
              border: '1px solid var(--line)',
              borderRadius: 12,
              background: 'var(--card)',
              textDecoration: 'none',
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
              Discord community
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              Ask questions, share apps, and get real-time support.
            </div>
          </a>

          <Link
            to="/docs"
            style={{
              display: 'block',
              padding: '20px 22px',
              border: '1px solid var(--line)',
              borderRadius: 12,
              background: 'var(--card)',
              textDecoration: 'none',
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
              Documentation
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              Reference docs for the MCP protocol, CLI, and HTTP API.
            </div>
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
