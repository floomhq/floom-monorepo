/**
 * HelpPage — /help
 *
 * 3-column card grid: Documentation / Discord / Email
 * + collapsible FAQ section
 * + footer
 *
 * Uses v26 design tokens (var(--ink), var(--card), var(--line), etc.)
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageShell } from '../components/PageShell';

const FAQS: { q: string; a: string }[] = [
  {
    q: 'How do I get a Floom agent token?',
    a: 'Sign up at floom.dev/signup, then go to your dashboard (/home). Click "Mint your token" to create one. Copy it once. It won\'t be shown again.',
  },
  {
    q: 'Which AI tools does Floom work with?',
    a: 'Claude Desktop, Cursor, Codex CLI, and any MCP-compatible client. You can also use the HTTP API directly from any tool that can make HTTP requests.',
  },
  {
    q: 'How do I add the MCP server to Claude Desktop?',
    a: 'Open ~/Library/Application Support/Claude/claude_desktop_config.json, paste your MCP config (available on your /home page), then restart Claude Desktop.',
  },
  {
    q: 'I minted a token but lost it. What do I do?',
    a: 'Go to /home and click "Rotate" to revoke the old token and mint a fresh one. Copy the new token immediately. It is only shown once.',
  },
  {
    q: 'How do I publish my own app to Floom?',
    a: 'Check the documentation at /docs. You\'ll need a floom.yaml, a public GitHub repo or OpenAPI URL, and an agent token. Then run: floom deploy ./floom.yaml.',
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        borderBottom: '1px solid var(--line)',
        paddingBottom: 0,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          padding: '18px 0',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontFamily: "'Inter', system-ui, sans-serif",
          textAlign: 'left',
        }}
        aria-expanded={open}
      >
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.4 }}>{q}</span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--muted)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ flexShrink: 0, transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <p style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.65, margin: '0 0 18px', paddingRight: 28 }}>
          {a}
        </p>
      )}
    </div>
  );
}

function SupportCard({
  href,
  to,
  icon,
  title,
  body,
  badge,
  cta,
}: {
  href?: string;
  to?: string;
  icon: React.ReactNode;
  title: string;
  body: string;
  badge?: string;
  /** R11 (2026-04-28): explicit CTA at the bottom of each card so the
      visitor knows the action. Gemini audit flagged unstated affordance. */
  cta: string;
}) {
  const shared: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    padding: '28px 24px',
    border: '1px solid var(--line)',
    borderRadius: 14,
    background: 'var(--card)',
    textDecoration: 'none',
    color: 'var(--ink)',
    transition: 'border-color 0.15s',
  };

  const inner = (
    <>
      <div style={{ marginBottom: 16 }}>{icon}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
        {title}
        {badge && (
          <span style={{
            fontSize: 10.5,
            fontWeight: 700,
            background: 'var(--accent)',
            color: '#fff',
            padding: '2px 7px',
            borderRadius: 999,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}>
            {badge}
          </span>
        )}
      </div>
      <p style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 18px', flex: 1 }}>{body}</p>
      {/* R11 (2026-04-28): explicit CTA — button-styled accent pill so
          the action is unambiguous. Card itself is the click target;
          this is purely a visible affordance. */}
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 'auto',
          alignSelf: 'flex-start',
          padding: '8px 14px',
          background: 'var(--accent)',
          color: '#fff',
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {cta}
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M5 3l6 5-6 5V3z" fill="currentColor" />
        </svg>
      </span>
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        target={href.startsWith('http') ? '_blank' : undefined}
        rel={href.startsWith('http') ? 'noreferrer' : undefined}
        style={shared}
        onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--accent)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--line)'; }}
      >
        {inner}
      </a>
    );
  }
  return (
    <Link
      to={to!}
      style={shared}
      onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--accent)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--line)'; }}
    >
      {inner}
    </Link>
  );
}

// Simple SVG icons
function IconBook() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function IconDiscord() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="var(--accent)" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.001.022.015.043.033.055a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function IconMail() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function IconLinkedIn() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="var(--accent)" aria-hidden="true">
      <path d="M20.452 20.452h-3.555v-5.569c0-1.328-.026-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.353V9h3.414v1.561h.048c.476-.9 1.637-1.852 3.37-1.852 3.602 0 4.268 2.37 4.268 5.455v6.288zM5.337 7.433a2.062 2.062 0 01-2.062-2.063 2.062 2.062 0 114.125 0c0 1.139-.924 2.063-2.063 2.063zM7.114 20.452H3.558V9h3.556v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

export function HelpPage() {
  return (
    <PageShell title="Help & Support · Floom">
      <div
        style={{
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        {/* Hero — sits inside PageShell's 1080px <main>. The gradient
            from var(--card) to var(--bg) is subtle enough that the
            content-width band reads as a deliberate design surface
            rather than a breakout full-bleed. Keeps layout simple. */}
        <div
          style={{
            background: 'linear-gradient(180deg, var(--card) 0%, var(--bg) 100%)',
            borderBottom: '1px solid var(--line)',
            padding: '64px 24px 56px',
            textAlign: 'center',
            margin: '0 -24px',
          }}
        >
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 40,
              letterSpacing: '-0.025em',
              color: 'var(--ink)',
              margin: '0 0 14px',
            }}
          >
            Help & Support
          </h1>
          <p style={{ fontSize: 16, color: 'var(--muted)', margin: 0, lineHeight: 1.6, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
            Docs, community, and a real human. Pick the fastest path.
          </p>
        </div>

        {/* 4-column card grid — matches the page max-width. */}
        <div style={{ padding: '56px 0 0' }}>
          {/* R11b (2026-04-28): 4-col grid at desktop so all 4 support
              cards (Docs, Discord, Email, DM Federico) sit on one row
              and Gemini doesn't think DM Federico is missing a CTA
              (the previous 3+1 wrap pushed the 4th card below the fold
              with a half-rendered footer). Collapses to 2-col at
              tablet and 1-col on phones via auto-fit. */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 16,
            }}
          >
            {/* R17 (2026-04-28): card order = fastest path first.
                1. Docs (self-serve, instant) → 2. Discord (community,
                fast badge) → 3. DM Federico (founder access) → 4. Email
                (24h, fallback). Email loses position because it's the
                slowest channel; ordering now matches the hero promise
                ("pick the fastest path"). Email body also drops "or
                billing" — no billing on launch-mvp, would mislead. */}
            <SupportCard
              to="/docs"
              icon={<IconBook />}
              title="Documentation"
              body="MCP protocol reference, CLI guide, HTTP API, and how to publish your first app."
              cta="Read the docs"
            />
            <SupportCard
              href="https://discord.gg/8fXGXjxcRz"
              icon={<IconDiscord />}
              title="Discord community"
              body="Ask questions, share apps, and get real-time help from the team and other builders."
              badge="Fast"
              cta="Join Discord"
            />
            <SupportCard
              href="https://www.linkedin.com/in/federicodeponte"
              icon={<IconLinkedIn />}
              title="DM Federico"
              body="Reach the founder directly on LinkedIn. Good for partnerships, feedback, or anything that doesn't fit elsewhere."
              cta="DM on LinkedIn"
            />
            <SupportCard
              href="mailto:hello@floom.dev"
              icon={<IconMail />}
              title="Email us"
              body="hello@floom.dev. We reply within 24 hours. Good for account issues or anything that needs a paper trail."
              cta="Email us"
            />
          </div>

          {/* FAQ */}
          <div style={{ marginTop: 64 }}>
            <h2
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 800,
                fontSize: 26,
                letterSpacing: '-0.02em',
                color: 'var(--ink)',
                margin: '0 0 8px',
              }}
            >
              Common questions
            </h2>
            <p style={{ fontSize: 14, color: 'var(--muted)', margin: '0 0 32px' }}>
              Can't find an answer?{' '}
              <a href="https://discord.gg/8fXGXjxcRz" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
                Ask in Discord
              </a>
              .
            </p>
            <div style={{ borderTop: '1px solid var(--line)' }}>
              {FAQS.map((faq) => (
                <FaqItem key={faq.q} q={faq.q} a={faq.a} />
              ))}
            </div>
          </div>

          {/* Footer spacer */}
          <div style={{ height: 80 }} />
        </div>
      </div>
    </PageShell>
  );
}
