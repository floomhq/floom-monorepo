// /docs/prepare-with-claude: helper page for users whose repo doesn't yet
// have a Floom manifest. Surfaces a copy-paste prompt they can drop into
// Claude Code (or any coding agent) so the agent adds `openapi.yaml` or
// `floom.yaml` to the repo root before retrying the import.
//
// Deep-linked from the BuildPage "no-openapi" error card ("let Claude do it →").
//
// Design rules applied: plain language (no "manifest generation tooling"),
// no em dashes, no emojis, no invented claims. One accent, one CTA.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageShell } from '../components/PageShell';

// The prompt the user copies into Claude Code / Cursor / Codex / etc.
// Keep in sync with packages/cli/src/init.ts behavior so the agent-
// generated result and the CLI-generated result look the same.
const CLAUDE_PROMPT = `Read this repo's structure. Figure out what kind of app it is (HTTP API, Docker service, Python script). Then add the right Floom config file:

- If it has an OpenAPI spec somewhere: move or symlink it to \`openapi.yaml\` at the repo root.
- If it has a Dockerfile: generate a \`floom.yaml\` manifest declaring \`runtime: docker\`, with ops inferred from the exposed routes and inputs inferred from the request schemas.
- If it's a script (Python, Node, Bash): generate a \`floom.yaml\` with a single \`run\` op that wires stdin inputs to the script's arguments.

Test by running \`npx @floom/cli init\` (which will validate what you wrote) and then commit and push. The goal: the Floom importer at https://floom.dev/studio/build should accept this repo on the next try.`;

export function PrepareWithClaudePage() {
  const [copied, setCopied] = useState(false);
  const [openapiUrl, setOpenapiUrl] = useState('');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(CLAUDE_PROMPT);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard denied. Select the textarea as a fallback hint.
      const ta = document.getElementById('claude-prompt') as HTMLTextAreaElement | null;
      ta?.select();
    }
  };

  // When the user already has an OpenAPI URL, bounce them into the build
  // ramp with the URL prefilled (the existing BuildPage reads ?ingest_url).
  const pasteHref = openapiUrl.trim()
    ? `/studio/build?ingest_url=${encodeURIComponent(openapiUrl.trim())}`
    : '/studio/build';

  return (
    <PageShell
      title="Prepare with Claude · Floom"
      contentStyle={{ padding: '24px 24px 80px', maxWidth: 820 }}
    >
      {/* Hero */}
      <section data-testid="pwc-hero" style={{ padding: '56px 0 32px' }}>
        <p style={EYEBROW}>Import helper</p>
        <h1 style={H1}>
          Your repo missing a Floom manifest? Let Claude add it.
        </h1>
        <p style={LEAD}>
          Floom needs one file in your repo root: either{' '}
          <code style={CODE}>openapi.yaml</code> (for HTTP APIs) or{' '}
          <code style={CODE}>floom.yaml</code> (for Docker services and scripts).
          Instead of writing it by hand, drop the prompt below into Claude Code
          or any coding agent. The agent reads your repo, figures out the
          shape, and writes the file for you.
        </p>
      </section>

      {/* Prompt block */}
      <section data-testid="pwc-prompt" style={SECTION_BORDERED}>
        <p style={EYEBROW}>Step 1 · Copy this prompt</p>
        <h2 style={H2}>Paste into Claude Code, Cursor, or Codex.</h2>
        <p style={MUTED_BODY}>
          Run it at the root of your repo. The agent will write the right
          config file and tell you what it generated.
        </p>

        <div
          style={{
            position: 'relative',
            marginTop: 20,
            background: 'var(--bg)',
            border: '1px solid var(--line)',
            borderRadius: 12,
            padding: '16px 16px 16px 18px',
          }}
        >
          <textarea
            id="claude-prompt"
            readOnly
            value={CLAUDE_PROMPT}
            style={{
              width: '100%',
              minHeight: 200,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--ink)',
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 13,
              lineHeight: 1.65,
              resize: 'vertical',
              padding: 0,
            }}
          />
          <button
            type="button"
            data-testid="pwc-copy"
            onClick={handleCopy}
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              padding: '8px 14px',
              background: copied ? 'var(--accent)' : 'var(--card)',
              color: copied ? '#0a0a0a' : 'var(--ink)',
              border: '1px solid var(--line)',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {copied ? 'Copied' : 'Copy prompt'}
          </button>
        </div>

        <p style={{ ...MUTED_BODY, marginTop: 14, fontSize: 13 }}>
          Prefer the command line? Run{' '}
          <code style={CODE}>npx @floom/cli init</code> in your repo. It
          auto-detects the app type (Dockerfile, package.json, requirements.txt,
          existing OpenAPI spec) and writes a best-guess{' '}
          <code style={CODE}>floom.yaml</code> you can review and tweak.
        </p>
      </section>

      {/* Retry import */}
      <section data-testid="pwc-retry" style={SECTION_BORDERED}>
        <p style={EYEBROW}>Step 2 · Retry the import</p>
        <h2 style={H2}>Once the file is committed, come back here.</h2>
        <p style={MUTED_BODY}>
          Commit and push the new <code style={CODE}>openapi.yaml</code> or{' '}
          <code style={CODE}>floom.yaml</code> file, then paste your repo URL
          again on the build page.
        </p>
        <div style={{ marginTop: 20 }}>
          <Link
            to="/studio/build"
            data-testid="pwc-back-to-build"
            style={{
              display: 'inline-block',
              padding: '12px 22px',
              background: 'var(--accent)',
              color: '#0a0a0a',
              fontWeight: 600,
              fontSize: 14,
              borderRadius: 10,
              textDecoration: 'none',
            }}
          >
            Back to import
          </Link>
        </div>
      </section>

      {/* Fallback: paste an existing OpenAPI URL directly */}
      <section data-testid="pwc-fallback" style={SECTION_BORDERED}>
        <p style={EYEBROW}>Already have an OpenAPI file?</p>
        <h2 style={H2}>Paste the direct link.</h2>
        <p style={MUTED_BODY}>
          If your spec is hosted somewhere public (GitHub raw, Stoplight,
          Swagger Hub), paste the URL here and we'll skip the repo step.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            window.location.href = pasteHref;
          }}
          style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}
        >
          <input
            type="url"
            inputMode="url"
            placeholder="https://example.com/openapi.yaml"
            value={openapiUrl}
            onChange={(e) => setOpenapiUrl(e.target.value)}
            data-testid="pwc-openapi-input"
            style={{
              flex: '1 1 280px',
              minWidth: 240,
              padding: '12px 14px',
              background: 'var(--card)',
              color: 'var(--ink)',
              border: '1px solid var(--line)',
              borderRadius: 10,
              fontSize: 14,
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={!openapiUrl.trim()}
            data-testid="pwc-openapi-submit"
            style={{
              padding: '12px 20px',
              background: 'var(--accent)',
              color: '#0a0a0a',
              border: 'none',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              cursor: openapiUrl.trim() ? 'pointer' : 'not-allowed',
              opacity: openapiUrl.trim() ? 1 : 0.55,
              fontFamily: 'inherit',
            }}
          >
            Import spec
          </button>
        </form>
      </section>
    </PageShell>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const EYEBROW: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  margin: '0 0 12px',
};

const H1: React.CSSProperties = {
  fontFamily: "'DM Serif Display', Georgia, serif",
  fontWeight: 400,
  fontSize: 40,
  lineHeight: 1.12,
  letterSpacing: '-0.02em',
  color: 'var(--ink)',
  margin: '0 0 18px',
  textWrap: 'balance' as unknown as 'balance',
};

const H2: React.CSSProperties = {
  fontFamily: "'DM Serif Display', Georgia, serif",
  fontWeight: 400,
  fontSize: 26,
  lineHeight: 1.25,
  letterSpacing: '-0.015em',
  color: 'var(--ink)',
  margin: '0 0 14px',
};

const LEAD: React.CSSProperties = {
  fontSize: 17,
  lineHeight: 1.65,
  color: 'var(--ink)',
  margin: '0 0 8px',
};

const MUTED_BODY: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1.65,
  color: 'var(--muted)',
  margin: 0,
};

const SECTION_BORDERED: React.CSSProperties = {
  padding: '40px 0',
  borderTop: '1px solid var(--line)',
};

const CODE: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: '0.9em',
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 6,
  padding: '1px 6px',
};
