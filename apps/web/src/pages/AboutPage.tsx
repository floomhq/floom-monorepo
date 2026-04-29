// /about — the Floom story page.
//
// R28 (2026-04-29): Full visual redesign. Dropped the SECTION_BORDERED
// card-stack pattern. New structure:
//   1. Hero: eyebrow + H1 + sub-para + ONE CTA. Stats inline in sub.
//   2. What it does: narrative prose, asymmetric two-column
//   3. For creators + users: two simple persona blocks, no card chrome
//   4. Four design choices: large-label horizontal rows, no card borders
//   5. WhosBehind: closing emotional beat (handled by component)
//   6. Footer CTA band
//
// Design principles: lots of whitespace (72-80px section gaps), no boxes,
// clear narrative hierarchy, single visual focus per section.

import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { WhosBehind } from '../components/home/WhosBehind';
import { readDeployEnabled } from '../lib/flags';
import { waitlistHref } from '../lib/waitlistCta';

// ── Shared styles ─────────────────────────────────────────────────────────

const WRAP: React.CSSProperties = {
  maxWidth: 1080,
  margin: '0 auto',
};

const EYEBROW: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.10em',
  margin: '0 0 16px',
  display: 'block',
};

const H2: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontWeight: 700,
  fontSize: 34,
  lineHeight: 1.15,
  letterSpacing: '-0.025em',
  color: 'var(--ink)',
  margin: '0 0 20px',
};

const BODY: React.CSSProperties = {
  fontSize: 17,
  lineHeight: 1.75,
  color: 'var(--muted)',
  margin: '0 0 20px',
  maxWidth: 640,
};

// ── Page ──────────────────────────────────────────────────────────────────

export function AboutPage() {
  const deployEnabled = useMemo(() => readDeployEnabled(), []);
  const navigate = useNavigate();

  return (
    <PageShell
      title="About · Floom"
      description="Floom is the protocol and runtime for agentic work — built so vibecoders and business users can ship AI apps without wiring auth, rate limits, sandboxing, or MCP tooling themselves."
      contentStyle={{ padding: '24px 24px 80px', maxWidth: 1180 }}
    >
      {/* 1. Hero ─────────────────────────────────────────────────────── */}
      <section
        data-testid="about-hero"
        style={{
          ...WRAP,
          padding: '88px 0 72px',
          textAlign: 'center',
        }}
      >
        <span style={{ ...EYEBROW, textAlign: 'center' }}>Why Floom exists</span>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 'clamp(40px, 5.5vw, 64px)',
            lineHeight: 1.06,
            letterSpacing: '-0.03em',
            color: 'var(--ink)',
            margin: '0 0 24px',
            textWrap: 'balance' as unknown as 'balance',
          }}
        >
          Get that thing off localhost fast.
        </h1>
        <p
          style={{
            fontSize: 19,
            lineHeight: 1.6,
            color: 'var(--muted)',
            margin: '0 auto 36px',
            maxWidth: 580,
            textWrap: 'balance' as unknown as 'balance',
          }}
        >
          Take the AI script you already built, give it a real URL, and let
          other people actually use it. No auth wiring, no rate-limit logic,
          no custom UI — Floom handles the plumbing.
        </p>

        {/* Single primary CTA */}
        <Link
          to="/apps"
          data-testid="about-hero-cta-primary"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '13px 26px',
            background: 'var(--accent)',
            color: '#fff',
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 600,
            textDecoration: 'none',
            letterSpacing: '-0.005em',
          }}
        >
          Browse live apps
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5 3l6 5-6 5V3z" fill="currentColor" />
          </svg>
        </Link>

        {/* Inline stat strip — no card chrome, just numbers in a row */}
        <div
          data-testid="about-hero-stats"
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 40,
            flexWrap: 'wrap',
            margin: '52px auto 0',
            paddingTop: 40,
            borderTop: '1px solid var(--line)',
            maxWidth: 480,
          }}
        >
          <InlineStat number="10+" label="apps live" />
          <InlineStat number="0" label="vendor lock-in" />
          <InlineStat number="1" label="open protocol" />
        </div>
      </section>

      {/* 2. What it actually does — narrative, asymmetric layout ───────── */}
      <section
        data-testid="about-what"
        style={{ ...WRAP, padding: '72px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 64, alignItems: 'start' }}
        className="about-two-col"
      >
        <div>
          <span style={EYEBROW}>What it does</span>
          <h2 style={H2}>Your app. A real URL. Instantly.</h2>
          <p style={BODY}>
            Floom reads your OpenAPI spec — or finds one in your GitHub repo —
            and generates a live page with structured inputs, rate limits, auth,
            and logs already in place.
          </p>
          <p style={{ ...BODY, margin: '0 0 28px' }}>
            The same endpoint Claude calls via MCP is the one your colleague
            opens in their browser. One spec, three surfaces: UI, HTTP API,
            and MCP tool — no second adapter to maintain.
          </p>
          <a
            href="https://github.com/floomhq/floom"
            target="_blank"
            rel="noreferrer"
            data-testid="about-github-link"
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--ink)',
              textDecoration: 'none',
              borderBottom: '1px solid var(--line)',
              paddingBottom: 2,
            }}
          >
            See the source on GitHub →
          </a>
        </div>

        {/* Right column: four tight bullet rows, no card chrome */}
        <div
          data-testid="about-why-floom-grid"
          style={{ display: 'flex', flexDirection: 'column', gap: 0 }}
        >
          <TightRow
            label="Workspace-scoped runtime"
            body="Each app runs isolated. Your Anthropic key, your colleagues' Stripe key, and the public hub never share state."
          />
          <TightRow
            label="MCP-native"
            body="One spec, three surfaces. UI, HTTP API, and MCP tool — no second adapter."
          />
          <TightRow
            label="Self-hostable core"
            body="One Docker command. Cloud version is a convenience, never a lock-in. Source is MIT."
          />
          <TightRow
            label="Open protocol"
            body="Standard OpenAPI in, standard OpenAPI out. No Floom-specific DSL. Your spec is portable."
          />
        </div>
      </section>

      {/* 3. Two audiences — no card chrome, visual separation via line ─── */}
      <section
        data-testid="about-who-for"
        style={{
          ...WRAP,
          padding: '72px 0',
          borderTop: '1px solid var(--line)',
        }}
      >
        <span style={EYEBROW}>Who it's for</span>
        <h2 style={{ ...H2, maxWidth: 560 }}>Two groups. Equal weight.</h2>

        <div
          className="about-who-cards"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 48,
            marginTop: 40,
          }}
        >
          <PersonaBlock
            tag="Vibecoders"
            title="People who build real tools with Cursor, Lovable, ChatGPT."
            body={
              deployEnabled ? (
                <>
                  You have something useful running on your laptop. Your
                  coworkers cannot use it because they cannot run Python. Floom
                  gives your thing a real URL.
                </>
              ) : (
                <>
                  You have something useful running on your laptop. Your
                  coworkers cannot use it if they cannot run your stack. On
                  floom.dev you can run apps and wire them into Claude via MCP
                  today. Publishing your own app is waitlist-only; self-host is
                  always open.
                </>
              )
            }
          />
          <PersonaBlock
            tag="Users"
            title="People who need to use AI tools at work, not build them."
            body={
              <>
                A colleague built something. You want to run it once, get an
                answer, move on. Floom is the shareable link that just works.
                No install, no setup.
              </>
            }
          />
        </div>
      </section>

      {/* 4. Who's behind it — founder facts, no card chrome ────────────── */}
      <section
        data-testid="about-who-behind"
        style={{
          ...WRAP,
          padding: '72px 0',
          borderTop: '1px solid var(--line)',
        }}
      >
        <span style={EYEBROW}>Who's behind it</span>
        <h2 style={H2}>One founder, building in public.</h2>
        <p style={BODY}>
          Floom is built by{' '}
          <a
            href="https://linkedin.com/in/federicodeponte"
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--ink)', textDecoration: 'underline', textUnderlineOffset: 3 }}
          >
            Federico De Ponte
          </a>
          {' '}— solo, from San Francisco, in public. Previously built SCAILE to
          $600K ARR with a team of 10. Now doing this full-time as part of the
          2026 Founders Inc cohort.
        </p>

        {/* Fact row: horizontal, no cards, just label+value pairs */}
        <div
          data-testid="about-facts-grid"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '24px 48px',
            margin: '36px 0 32px',
            paddingTop: 28,
            borderTop: '1px solid var(--line)',
          }}
        >
          <FactPair label="Company" value="Floom, Inc. (Delaware)" />
          <FactPair label="License" value="Open core — self-hostable runtime" />
          <FactPair label="Cohort" value="Founders Inc, 2026" />
          <FactPair label="Funding" value="None yet" />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <PillLink href="https://github.com/floomhq/floom">GitHub repo</PillLink>
          <PillLink href="https://discord.gg/8fXGXjxcRz">Discord</PillLink>
          <PillLink to="/protocol">The Floom protocol</PillLink>
          <PillLink to="/">floom.dev</PillLink>
        </div>
      </section>

      {/* 5. WhosBehind — photo + contact as the emotional close ────────── */}
      <section
        data-testid="about-whos-behind-wrap"
        style={{
          borderTop: '1px solid var(--line)',
          padding: '0',
        }}
      >
        <WhosBehind />
      </section>

      {/* 6. CTA footer band ─────────────────────────────────────────────── */}
      <section
        data-testid="about-cta"
        style={{
          ...WRAP,
          borderTop: '1px solid var(--line)',
          textAlign: 'center',
          padding: '80px 0 24px',
        }}
      >
        <h2
          style={{
            ...H2,
            fontSize: 36,
            margin: '0 0 16px',
            maxWidth: 'none',
          }}
        >
          {deployEnabled ? 'Paste your app. Share the link.' : 'Paste your app. Run it everywhere.'}
        </h2>
        <p
          style={{
            ...BODY,
            margin: '0 auto 32px',
            textAlign: 'center',
          }}
        >
          {deployEnabled ? (
            <>
              Point Floom at an OpenAPI spec, or let Floom discover one from a
              GitHub repo. You get a live URL, auth, logs, and a page your
              colleagues can actually open.
            </>
          ) : (
            <>
              Point Floom at an OpenAPI spec, or let Floom discover one from a
              GitHub repo. Until publish opens for you on floom.dev, run catalog
              apps, use MCP, and self-host your own instance.
            </>
          )}
        </p>
        {deployEnabled ? (
          <Link
            to="/studio/build"
            data-testid="about-cta-build"
            style={{
              display: 'inline-block',
              padding: '14px 28px',
              background: 'var(--accent)',
              color: '#ffffff',
              fontWeight: 600,
              fontSize: 15,
              borderRadius: 10,
              textDecoration: 'none',
              letterSpacing: '-0.005em',
            }}
          >
            Paste your app → Studio
          </Link>
        ) : (
          <button
            type="button"
            data-testid="about-cta-waitlist"
            onClick={() => {
              navigate(waitlistHref('about-footer'));
            }}
            style={{
              display: 'inline-block',
              padding: '14px 28px',
              background: 'var(--accent)',
              color: '#ffffff',
              fontWeight: 600,
              fontSize: 15,
              borderRadius: 10,
              textDecoration: 'none',
              letterSpacing: '-0.005em',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Join the publish waitlist
          </button>
        )}
      </section>
    </PageShell>
  );
}

// ── Building blocks ───────────────────────────────────────────────────────

function InlineStat({ number, label }: { number: string; label: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 32,
          fontWeight: 800,
          letterSpacing: '-0.03em',
          color: 'var(--accent)',
          lineHeight: 1,
        }}
      >
        {number}
      </span>
      <span
        style={{
          fontSize: 12,
          color: 'var(--muted)',
          lineHeight: 1.3,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        }}
      >
        {label}
      </span>
    </div>
  );
}

function TightRow({ label, body }: { label: string; body: string }) {
  return (
    <div
      data-testid={`about-why-floom-card-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
      style={{
        padding: '22px 0',
        borderBottom: '1px solid var(--line)',
      }}
    >
      <p
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--accent)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          margin: '0 0 8px',
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: 15,
          lineHeight: 1.65,
          color: 'var(--muted)',
          margin: 0,
        }}
      >
        {body}
      </p>
    </div>
  );
}

function PersonaBlock({
  tag,
  title,
  body,
}: {
  tag: string;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--accent)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        {tag}
      </span>
      <p
        style={{
          fontSize: 20,
          fontWeight: 600,
          lineHeight: 1.3,
          color: 'var(--ink)',
          margin: 0,
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </p>
      <p
        style={{
          fontSize: 15.5,
          lineHeight: 1.65,
          color: 'var(--muted)',
          margin: 0,
        }}
      >
        {body}
      </p>
    </div>
  );
}

function FactPair({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.10em',
          color: 'var(--muted)',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: 'var(--ink)',
          lineHeight: 1.3,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function PillLink({
  href,
  to,
  children,
}: {
  href?: string;
  to?: string;
  children: React.ReactNode;
}) {
  const style: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '8px 16px',
    border: '1px solid var(--line)',
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--ink)',
    textDecoration: 'none',
  };
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" style={style}>
        {children}
      </a>
    );
  }
  return (
    <Link to={to!} style={style}>
      {children}
    </Link>
  );
}
