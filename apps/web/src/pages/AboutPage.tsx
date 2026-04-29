// /about — the Floom story page.
//
// 2026-04-20: replaces the old `/about` → `/` redirect. A real page that
// tells creators + biz users what Floom is, who it's for, and what it
// isn't. H1 "Get that thing off localhost fast." lives alongside the
// landing H1 (currently "Production infrastructure for AI apps that do
// real work." / after H1-swap "Ship AI apps fast.") — the two taglines
// coexist: landing leads with what you get, About leads with the pain
// Floom solves.
//
// Rules applied: no em dashes, plain language (no "infrastructure",
// "orchestration", "abstraction layer" in body copy), Federico's voice
// ("your thing"), real numbers only (100 apps live, MIT, one founder),
// no invented stats.
//
// Structure (5 sections):
//   1. Hero: H1 + one-sentence mission restatement
//   2. Who Floom is for: two side-by-side cards (vibecoders + biz users)
//   3. Why headless: the standardization/security/speed argument
//   4. What Floom isn't: three negations
//   5. Who's behind it: Federico + Floom Inc + OSS commitment
//   + Footer CTA band: "Paste your app" → /studio/build

import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { WhosBehind } from '../components/home/WhosBehind';
import { readDeployEnabled } from '../lib/flags';
import { waitlistHref } from '../lib/waitlistCta';

// ── Shared styles ─────────────────────────────────────────────────────────

// R11 (2026-04-28): Gemini audit — at 1440px the 820px column read as
// a narrow letter-format page floating in the centre. Widened to 1080
// to match the /apps directory's main container (1180 minus padding)
// so the page feels purposeful at full desktop width. Body copy still
// caps at ~720px via the BODY_STYLE max-width chain so reading line
// length stays comfortable; only structural spacing widens.
const SECTION_STYLE: React.CSSProperties = {
  maxWidth: 1080,
  margin: '0 auto',
  padding: '56px 0',
};

const SECTION_BORDERED: React.CSSProperties = {
  ...SECTION_STYLE,
  borderTop: '1px solid var(--line)',
};

const EYEBROW_STYLE: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  margin: '0 0 12px',
};

const H2_STYLE: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontWeight: 700,
  fontSize: 32,
  lineHeight: 1.2,
  letterSpacing: '-0.02em',
  color: 'var(--ink)',
  margin: '0 0 20px',
};

const BODY_STYLE: React.CSSProperties = {
  fontSize: 17,
  lineHeight: 1.7,
  color: 'var(--ink)',
  margin: '0 0 16px',
};

const MUTED_BODY_STYLE: React.CSSProperties = {
  ...BODY_STYLE,
  color: 'var(--muted)',
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
      {/* 1. Hero
          R11b (2026-04-28): Gemini scored hero at 4/10 ("extremely sparse,
          unfinished on a wider screen, no CTA"). Added a primary CTA row
          + a 3-fact strip directly under the sub so the hero earns its
          screen real estate at 1440px. The CTA matches the footer band
          (deploy mode vs waitlist mode) so visitors get one consistent
          path. */}
      <section
        data-testid="about-hero"
        style={{ ...SECTION_STYLE, padding: '72px 0 48px', textAlign: 'center' }}
      >
        {/* R16 (2026-04-28): eyebrow reframes the page as the "why"
            behind the landing brand line ("Ship AI apps fast."). H1
            keeps the human-pain framing ("Get that thing off localhost
            fast.") so the page articulates the motivation, not the
            mechanism. */}
        <p style={{ ...EYEBROW_STYLE, textAlign: 'center' }}>Why I built Floom</p>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 52,
            lineHeight: 1.08,
            letterSpacing: '-0.025em',
            color: 'var(--ink)',
            margin: '0 0 20px',
            textWrap: 'balance' as unknown as 'balance',
          }}
        >
          Get that thing off localhost fast.
        </h1>
        <p
          style={{
            fontSize: 19,
            lineHeight: 1.55,
            color: 'var(--muted)',
            margin: '0 auto 28px',
            maxWidth: 640,
            textWrap: 'balance' as unknown as 'balance',
          }}
        >
          The landing page says "ship AI apps fast." This page tells you
          what that means in practice: take the script you already
          built, give it a real URL, and let other people actually use it.
        </p>

        {/* R11b: explicit primary CTA in the hero so the page tells you
            what to do next without scrolling. */}
        <div
          style={{
            display: 'inline-flex',
            gap: 10,
            flexWrap: 'wrap',
            justifyContent: 'center',
            margin: '0 auto 36px',
          }}
        >
          <Link
            to="/apps"
            data-testid="about-hero-cta-primary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '12px 22px',
              background: 'var(--accent)',
              color: '#fff',
              borderRadius: 9,
              fontSize: 14.5,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Browse the apps
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M5 3l6 5-6 5V3z" fill="currentColor" />
            </svg>
          </Link>
          <a
            href="https://github.com/floomhq/floom"
            target="_blank"
            rel="noreferrer"
            data-testid="about-hero-cta-github"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '12px 22px',
              background: 'var(--card)',
              color: 'var(--ink)',
              border: '1px solid var(--line)',
              borderRadius: 9,
              fontSize: 14.5,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            See it on GitHub
          </a>
        </div>

        {/* R11b: 3-fact strip — concrete, scannable proof points so the
            hero isn't just two paragraphs of copy floating in space. */}
        <div
          data-testid="about-hero-stats"
          style={{
            display: 'inline-flex',
            gap: 28,
            flexWrap: 'wrap',
            justifyContent: 'center',
            padding: '20px 28px',
            background: 'var(--card)',
            border: '1px solid var(--line)',
            borderRadius: 14,
            margin: '0 auto',
          }}
        >
          <HeroStat number="10" label="apps live today" />
          <HeroStat number="1" label="protocol, not bespoke" />
          <HeroStat number="0" label="vendor lock-in" />
        </div>
      </section>

      {/* 1b. Why Floom / Under the hood — R15 UI-4 (2026-04-28).
          Tackles Vladimir persona's "black box" complaint from the launch
          user feedback PDF. Visitors leaving the hero want to know what
          actually happens inside Floom before reading the persona cards
          below. Four short paragraphs explaining the real architecture
          choices: workspace-scoped runtime, MCP-native, OSS by default,
          open protocol. Plain language; one verifiable fact each. */}
      <section data-testid="about-why-floom" style={SECTION_BORDERED}>
        <p style={EYEBROW_STYLE}>Under the hood</p>
        <h2 style={H2_STYLE}>Why Floom.</h2>
        <p style={MUTED_BODY_STYLE}>
          Four choices we made early. Each one is verifiable from the
          source — not a tagline.
        </p>

        <div
          data-testid="about-why-floom-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 20,
            margin: '28px 0 0',
          }}
          className="about-why-floom-grid"
        >
          <WhyFloomCard
            label="Workspace-scoped runtime"
            body="Every app runs in an isolated container with workspace-level secrets, rate limits, and quotas. Your Anthropic key, your colleagues' Stripe key, and the public hub all live in different sandboxes. No shared state, no key bleed."
          />
          <WhyFloomCard
            label="MCP-native"
            body="Agents call the same endpoint humans see in their browser. One spec, three surfaces: the UI you click, the HTTP API you curl, the MCP tool Claude calls. No second adapter to maintain."
          />
          {/* R17 (2026-04-28): rephrased per Federico's brand rule —
              "MIT-licensed core." was the robotic license declaration
              the rule explicitly bans. Same factual content, woven
              naturally: self-host first, license as a parenthetical,
              not the lede. */}
          <WhyFloomCard
            label="OSS by default"
            body="Self-host on your own box, your own VPS, or your own Kubernetes cluster — one Docker command. The cloud version is a convenience, never a lock-in. Source is permissive (MIT) so you can fork it and keep going."
          />
          <WhyFloomCard
            label="Open protocol"
            body="The OpenAPI spec is the source of truth. No proprietary YAML, no Floom-specific DSL. If you can describe your app's inputs and outputs in OpenAPI, Floom can run it. Your spec is portable."
          />
        </div>
      </section>

      {/* 2. Who Floom is for */}
      <section data-testid="about-who-for" style={SECTION_BORDERED}>
        <p style={EYEBROW_STYLE}>Who Floom is for</p>
        <h2 style={H2_STYLE}>Two groups, equal weight.</h2>
        <p style={MUTED_BODY_STYLE}>
          Floom has two kinds of users. One builds the thing. The other
          just wants to use the thing. We care about both the same.
        </p>

        <div
          className="about-who-cards"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 20,
            margin: '28px 0 0',
          }}
        >
          <WhoCard
            tag="Vibecoders"
            title="People who build real tools with Cursor, Lovable, ChatGPT."
            body={
              deployEnabled ? (
                <>
                  You have something useful running on your laptop. Your
                  coworkers cannot use it because your coworkers cannot run
                  Python. Floom gives your thing a real URL.
                </>
              ) : (
                <>
                  You have something useful running on your laptop. Your
                  coworkers cannot use it if they cannot run your stack. On
                  floom.dev you can run apps and wire them into Claude via MCP
                  today. Publishing your own app to our hosted runtime is
                  waitlist-only; self-host is always open.
                </>
              )
            }
          />
          {/* Tag copy 2026-04-24 (audit): was "Biz users". Rendered uppercase
              with letter-spacing it read as "BIZ USERS" / "BIG USERS" and was
              ambiguous on first glance (business? frequent? corporate?).
              Swapped to "Users" to pair cleanly with "Vibecoders" above —
              one short noun per card, same grammatical weight. Internal ICP
              notes elsewhere in the codebase still say "biz users" for
              clarity; the customer-facing label is what moves here. */}
          <WhoCard
            tag="Users"
            title="People who need to use AI tools at work, not build them."
            body={
              <>
                A colleague built something. You want to run it once, get
                an answer, move on. Floom is the shareable link that just
                works. No install, no setup.
              </>
            }
          />
        </div>

      </section>

      {/* 3. Why headless */}
      <section data-testid="about-why-headless" style={SECTION_BORDERED}>
        <p style={EYEBROW_STYLE}>Why headless</p>
        <h2 style={H2_STYLE}>Floom is not another AI chat window.</h2>
        <p style={BODY_STYLE}>
          Every app's shape comes from its inputs and outputs, not from a
          chat box we bolt on top. That one choice buys three things:
        </p>

        <div
          style={{
            display: 'grid',
            gap: 16,
            margin: '24px 0 0',
          }}
        >
          <Triad
            label="More secure"
            body="Standardizing around one protocol shrinks the attack surface. No user-generated UI, no custom-rendered HTML bugs, no chat-prompt tricks on the input side."
          />
          <Triad
            label="Faster to go live"
            body={
              deployEnabled
                ? 'You ship a spec, not a UI. The page draws itself from your fields. Publish, share the link, done.'
                : 'You ship a spec, not a UI. The page draws itself from your fields. When you have publish access on floom.dev (or on your self-hosted instance), share the link and you are done.'
            }
          />
          <Triad
            label="Less ambiguity"
            body="Creators don't debate what interface to build. Users don't wonder 'is this a chat app or a dashboard?' The app looks like its job."
          />
        </div>
      </section>

      {/* 4. What Floom isn't */}
      <section data-testid="about-not" style={SECTION_BORDERED}>
        <p style={EYEBROW_STYLE}>What Floom isn't</p>
        <h2 style={H2_STYLE}>Three things people ask, three things we're not.</h2>

        <div style={{ display: 'grid', gap: 14, margin: '24px 0 0' }}>
          <NotRow
            lead="Not a chat UI."
            body="We don't wrap your app in a chat interface. Your app gets the UI its inputs and outputs deserve."
          />
          <NotRow
            lead="Not a low-code app builder."
            body="You bring the code. We give it a URL, auth, logs, and error handling. No drag-and-drop."
          />
          <NotRow
            lead="Not an agent orchestrator."
            body="We run apps. You orchestrate them wherever you want: Claude, Cursor, your own tool, whatever comes next."
          />
        </div>
      </section>

      {/* 5. Who's behind it
          R11 (2026-04-28): Gemini audit — dense prose paragraphs lost
          the key facts. Switched to a fact-callout grid (5 scannable
          items) above a one-line lead so visitors can grok founder +
          status + stack at a glance, then dive into prose if they
          want. */}
      <section data-testid="about-who-behind" style={SECTION_BORDERED}>
        <p style={EYEBROW_STYLE}>Who's behind it</p>
        <h2 style={H2_STYLE}>One founder, open source by default.</h2>
        <p style={BODY_STYLE}>
          Floom is built by{' '}
          <a
            href="https://linkedin.com/in/federicodeponte"
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--accent)' }}
          >
            Federico De Ponte
          </a>
          . Solo. From San Francisco. In public.
        </p>

        <div
          data-testid="about-facts-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12,
            margin: '24px 0 0',
          }}
        >
          <FactCallout
            label="Founder"
            value="Federico De Ponte"
            note="ex-SCAILE, $600K ARR, team of 10"
          />
          <FactCallout
            label="Company"
            value="Floom, Inc."
            note="Delaware C-Corp"
          />
          <FactCallout
            label="License"
            value="Open core"
            note="Runtime + protocol spec are self-hostable"
          />
          <FactCallout
            label="Cohort"
            value="Founders Inc"
            note="2026 (San Francisco)"
          />
          <FactCallout
            label="Funding"
            value="None yet"
            note="Hosted version is at floom.dev"
          />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, margin: '24px 0 0' }}>
          <PillLink href="https://github.com/floomhq/floom">GitHub repo</PillLink>
          <PillLink href="https://discord.gg/8fXGXjxcRz">Discord community</PillLink>
          <PillLink to="/protocol">The Floom protocol</PillLink>
          <PillLink to="/">floom.dev (hosted)</PillLink>
        </div>
      </section>

      {/* Who's behind — photo + contact band (2026-04-24). The /about
          page mentioned Federico textually but had no face; WhosBehind
          is already rendered on the landing page, reuse it here.
          Wrapped in a top-bordered section so the vertical rhythm
          matches the other /about sections.
          R25 (2026-04-29): WhosBehind has its own internal padding
          of 28px horizontal. Cancel it with negative horizontal margin
          so the photo/text grid aligns with the other sections at 1080px
          rather than being pinched to a narrower 900px band. */}
      <section
        data-testid="about-whos-behind-wrap"
        style={{ ...SECTION_BORDERED, padding: '0' }}
      >
        <WhosBehind />
      </section>

      {/* CTA footer band */}
      <section
        data-testid="about-cta"
        style={{
          ...SECTION_BORDERED,
          textAlign: 'center',
          padding: '64px 0 24px',
        }}
      >
        {/* Copy 2026-04-24 (audit): "Paste your thing" reads too informal
            for the trust section. "Paste your app" names what you're
            actually pasting and keeps the short imperative rhythm. */}
        <h2 style={{ ...H2_STYLE, margin: '0 0 12px' }}>
          {deployEnabled ? 'Paste your app. Share the link.' : 'Paste your app. Run it everywhere.'}
        </h2>
        <p
          style={{
            ...MUTED_BODY_STYLE,
            maxWidth: 560,
            margin: '0 auto 24px',
          }}
        >
          {deployEnabled ? (
            <>
              Point Floom at an OpenAPI spec or a GitHub repo. You get a live
              URL, auth, logs, and a page your colleagues can actually open.
            </>
          ) : (
            <>
              Point Floom at an OpenAPI spec or a GitHub repo to publish when
              the workspace has access on floom.dev, or run without limits on
              your own hardware. Until publish opens for you here, run catalog
              apps, use MCP, and self-host your own.
            </>
          )}
        </p>
        {deployEnabled ? (
          <Link
            to="/studio/build"
            data-testid="about-cta-build"
            style={{
              display: 'inline-block',
              padding: '14px 26px',
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
              // TODO(Agent 9): open WaitlistModal instead of routing.
              navigate(waitlistHref('about-footer'));
            }}
            style={{
              display: 'inline-block',
              padding: '14px 26px',
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

function WhoCard({
  tag,
  title,
  body,
}: {
  tag: string;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 14,
        padding: '24px 22px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
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
          fontSize: 18,
          fontWeight: 600,
          lineHeight: 1.35,
          color: 'var(--ink)',
          margin: 0,
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </p>
      <p
        style={{
          fontSize: 15,
          lineHeight: 1.6,
          color: 'var(--muted)',
          margin: 0,
        }}
      >
        {body}
      </p>
    </div>
  );
}

function Triad({ label, body }: { label: string; body: string }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '160px 1fr',
        gap: 20,
        alignItems: 'baseline',
        padding: '14px 0',
        borderTop: '1px dashed var(--line)',
      }}
      className="about-triad"
    >
      <span
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 12,
          fontWeight: 700,
          color: 'var(--accent)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {label}
      </span>
      <p style={{ fontSize: 15, lineHeight: 1.65, color: 'var(--ink)', margin: 0 }}>
        {body}
      </p>
    </div>
  );
}

function NotRow({ lead, body }: { lead: string; body: string }) {
  return (
    <div
      style={{
        padding: '16px 18px',
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 12,
      }}
    >
      <p
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: 'var(--ink)',
          margin: '0 0 4px',
          letterSpacing: '-0.005em',
        }}
      >
        {lead}
      </p>
      <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--muted)', margin: 0 }}>
        {body}
      </p>
    </div>
  );
}

function HeroStat({ number, label }: { number: string; label: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 4,
        textAlign: 'left',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 28,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          color: 'var(--accent)',
          lineHeight: 1,
        }}
      >
        {number}
      </span>
      <span
        style={{
          fontSize: 12.5,
          color: 'var(--muted)',
          lineHeight: 1.3,
        }}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * R15 UI-4 (2026-04-28): one card in the "Why Floom / Under the hood"
 * grid. Mono uppercase label + a short prose paragraph. Matches the
 * card chrome used elsewhere on /about (var(--card) bg, var(--line)
 * border, 12px radius) so it slots into the existing visual system.
 */
function WhyFloomCard({ label, body }: { label: string; body: string }) {
  return (
    <div
      data-testid={`about-why-floom-card-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
      style={{
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        padding: '22px 22px 24px',
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
          margin: '0 0 12px',
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: 15,
          lineHeight: 1.65,
          color: 'var(--ink)',
          margin: 0,
        }}
      >
        {body}
      </p>
    </div>
  );
}

function FactCallout({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div
      style={{
        padding: '14px 16px',
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 12,
      }}
    >
      <div
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 10.5,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--accent)',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: 'var(--ink)',
          lineHeight: 1.3,
          marginBottom: 4,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.45 }}>
        {note}
      </div>
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
    padding: '8px 14px',
    border: '1px solid var(--line)',
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--ink)',
    textDecoration: 'none',
    background: 'var(--card)',
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
