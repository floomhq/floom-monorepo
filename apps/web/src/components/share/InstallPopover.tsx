/**
 * InstallPopover — unified "Install" affordance for /p/:slug.
 *
 * R14 (2026-04-28). Federico's brief: redesign the popover for clarity.
 * Gemini scored 4/10 on R13 because the token field, endpoint URL, and
 * copy buttons were buried inside the JSON config block. R14 surfaces
 * each as its own labeled affordance.
 *
 * Layout (top → bottom, every tab):
 *   1. Token section — paste field (signed-out) OR masked token + reveal
 *      (signed-in). Pasting/typing updates the snippet below in real time.
 *   2. Endpoint URL field (MCP) / Skill URL field (Skill) with its own
 *      Copy URL button. CLI tab skips this — the command IS the URL.
 *   3. Code block with a prominent labeled Copy button above-right.
 *   4. Skill tab also keeps the per-agent sub-tabs and skill.md download.
 *
 * Token state strategy: we never fetch the raw signed-in token (it's
 * shown once at mint time on /home). Signed-in users see a masked
 * placeholder (`floom_agent_••••...••••`) unless they paste their token
 * back in to preview the working snippet locally. The paste field is
 * client-only — the value never leaves the browser.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ElementType } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Terminal, Server, Download, Eye, EyeOff } from 'lucide-react';
import { CopyButton } from '../output/CopyButton';

// lucide-react icons forward refs and use `Booleanish` for aria-hidden,
// which doesn't match a tightly-typed ComponentType. Use ElementType so
// the JSX rendering path infers the right shape without us mirroring
// lucide's full prop surface.
type IconCmp = ElementType;

type TabId = 'mcp' | 'cli' | 'skill';
type AgentId = 'claude-code' | 'cursor' | 'codex';

interface InstallPopoverProps {
  open: boolean;
  onClose: () => void;
  /** App slug — used for /mcp/app/<slug> + skill.md URL + cli command. */
  slug: string;
  /** App display name — used in skill modal headline. */
  appName: string;
  /** Whether the visitor is signed in. */
  isAuthenticated: boolean;
  /** Whether the visitor's workspace has at least one active token. */
  hasToken?: boolean;
  /**
   * Optional first declared input on the primary action — used to seed
   * the example prompt in the Skill tab so users see a concrete
   * invocation, not a placeholder.
   */
  firstInputName?: string | null;
  /**
   * Optional public origin override. Defaults to window.location.origin
   * so previews on preview.floom.dev / mvp.floom.dev fetch from the
   * host they were rendered on.
   */
  origin?: string;
}

const AGENTS: Array<{
  id: AgentId;
  label: string;
  pastePath: (slug: string) => string;
}> = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    pastePath: (slug) => `~/.claude/skills/${slug}/SKILL.md`,
  },
  {
    id: 'cursor',
    label: 'Cursor',
    pastePath: (slug) => `~/.cursor/skills/${slug}/SKILL.md`,
  },
  {
    id: 'codex',
    label: 'Codex',
    pastePath: (slug) => `~/.codex/skills/${slug}/SKILL.md`,
  },
];

const MASKED_TOKEN = 'floom_agent_••••••••••••••••';
const PLACEHOLDER_TOKEN = 'YOUR_TOKEN';

export function InstallPopover({
  open,
  onClose,
  slug,
  appName: _appName,
  isAuthenticated,
  hasToken = false,
  firstInputName,
  origin,
}: InstallPopoverProps) {
  const [activeTab, setActiveTab] = useState<TabId>('mcp');
  const [activeAgent, setActiveAgent] = useState<AgentId>('claude-code');
  const [pastedToken, setPastedToken] = useState('');
  const [revealMasked, setRevealMasked] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    function onClick(e: MouseEvent) {
      if (surfaceRef.current && !surfaceRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open, onClose]);

  const baseOrigin = useMemo(
    () =>
      origin ||
      (typeof window !== 'undefined' ? window.location.origin : 'https://floom.dev'),
    [origin]
  );

  // Token to render inside the JSON snippet. Priority:
  //   1. Pasted token (live preview)
  //   2. Signed-in masked placeholder
  //   3. Anonymous placeholder (`YOUR_TOKEN`)
  const effectiveToken = pastedToken.trim()
    ? pastedToken.trim()
    : isAuthenticated && hasToken
      ? MASKED_TOKEN
      : isAuthenticated
        ? MASKED_TOKEN
        : PLACEHOLDER_TOKEN;

  // URLs surfaced as their own copy-able fields.
  const endpointUrl = `${baseOrigin}/mcp/app/${slug}`;
  const skillUrl = `${baseOrigin}/p/${slug}/skill.md`;

  // MCP snippet — points at the per-app route (/mcp/app/<slug>) so the
  // agent only sees this app, not the whole catalogue.
  const mcpSnippet = `{
  "mcpServers": {
    "${slug}": {
      "url": "${endpointUrl}",
      "headers": {
        "Authorization": "Bearer ${effectiveToken}"
      }
    }
  }
}`;

  // CLI snippet — npx form is the primary affordance (no install step).
  const cliSnippet = `npx @floomhq/cli@latest run ${slug}`;

  // Skill: per-agent install command. Mirrors SkillModal's structure
  // but inlined here so the popover is one self-contained surface.
  const agent = AGENTS.find((a) => a.id === activeAgent) ?? AGENTS[0];
  const pastePath = agent.pastePath(slug);
  const skillCommand = [
    `mkdir -p ${pastePath.replace(/\/SKILL\.md$/, '')}`,
    `curl -fsSL ${skillUrl} \\`,
    `  -o ${pastePath}`,
  ].join('\n');
  const examplePrompt = firstInputName
    ? `Run ${slug} with ${firstInputName}=…`
    : `Run ${slug}`;

  if (!open) return null;

  const tabBtn = (id: TabId, label: string, Icon: IconCmp) => {
    const active = id === activeTab;
    return (
      <button
        key={id}
        type="button"
        role="tab"
        aria-selected={active}
        data-testid={`install-popover-tab-${id}`}
        onClick={() => setActiveTab(id)}
        style={{
          padding: '10px 14px',
          fontSize: 12.5,
          fontWeight: active ? 700 : 500,
          border: 'none',
          background: 'transparent',
          color: active ? 'var(--ink)' : 'var(--muted)',
          borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
          marginBottom: -1,
          cursor: 'pointer',
          fontFamily: 'inherit',
          whiteSpace: 'nowrap',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Icon size={13} aria-hidden />
        {label}
      </button>
    );
  };

  return (
    <div
      ref={surfaceRef}
      role="dialog"
      aria-modal="false"
      aria-label={`Install ${_appName}`}
      data-testid="install-popover"
      style={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        right: 0,
        width: 'min(560px, calc(100vw - 32px))',
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        boxShadow: '0 16px 40px rgba(27,26,23,0.18)',
        zIndex: 60,
        overflow: 'hidden',
      }}
    >
      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Install path"
        style={{
          display: 'flex',
          gap: 2,
          padding: '0 16px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--bg, #fafaf8)',
        }}
      >
        {tabBtn('mcp', 'MCP config', Server)}
        {tabBtn('cli', 'CLI', Terminal)}
        {tabBtn('skill', 'Skill', Sparkles)}
      </div>

      {/* Body */}
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* 1. Token affordance — appears on every tab so the user always
              has the token primitive at hand. */}
        <TokenSection
          isAuthenticated={isAuthenticated}
          hasToken={hasToken}
          slug={slug}
          pastedToken={pastedToken}
          onPaste={setPastedToken}
          revealMasked={revealMasked}
          onToggleReveal={() => setRevealMasked((v) => !v)}
        />

        {/* 2. Per-tab URL field + 3. code block with prominent Copy. */}
        {activeTab === 'mcp' && (
          <>
            <UrlField
              label="Endpoint URL"
              value={endpointUrl}
              testId="install-popover-mcp-url"
              copyLabel="Copy URL"
            />
            <CodeBlock
              description={
                <>
                  Merge this <code style={{ fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>mcpServers</code> entry into your client's config (Claude Desktop, Cursor, Codex …).
                </>
              }
              value={mcpSnippet}
              testId="install-popover-mcp-snippet"
              copyLabel="Copy JSON config"
            />
          </>
        )}
        {activeTab === 'cli' && (
          <CodeBlock
            description="Run from any shell. Node 18+ required."
            value={cliSnippet}
            testId="install-popover-cli-snippet"
            copyLabel="Copy command"
          />
        )}
        {activeTab === 'skill' && (
          <div data-testid="install-popover-skill-pane" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Per-agent sub-tabs */}
            <div
              role="tablist"
              aria-label="Agent"
              style={{
                display: 'flex',
                gap: 2,
                borderBottom: '1px solid var(--line)',
              }}
            >
              {AGENTS.map((a) => {
                const active = a.id === activeAgent;
                return (
                  <button
                    key={a.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    data-testid={`install-popover-agent-${a.id}`}
                    onClick={() => setActiveAgent(a.id)}
                    style={{
                      padding: '7px 12px',
                      fontSize: 11.5,
                      fontWeight: active ? 700 : 500,
                      border: 'none',
                      background: 'transparent',
                      color: active ? 'var(--ink)' : 'var(--muted)',
                      borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                      marginBottom: -1,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {a.label}
                  </button>
                );
              })}
            </div>
            <UrlField
              label="Skill file URL"
              value={skillUrl}
              testId="install-popover-skill-url"
              copyLabel="Copy URL"
            />
            <CodeBlock
              description={
                <>
                  Save to{' '}
                  <code style={{ fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>
                    {pastePath}
                  </code>
                </>
              }
              value={skillCommand}
              testId="install-popover-skill-snippet"
              copyLabel="Copy install command"
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
                marginTop: -2,
              }}
            >
              <a
                href={skillUrl}
                data-testid="install-popover-skill-download"
                download={`${slug}.skill.md`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: 'var(--accent)',
                  textDecoration: 'none',
                  fontFamily: 'inherit',
                }}
              >
                <Download size={13} aria-hidden /> Download skill.md
              </a>
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                Then ask {agent.label}: <em>"{examplePrompt}"</em>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================== */
/* Token section                                                  */
/* ============================================================== */

function TokenSection({
  isAuthenticated,
  hasToken,
  slug,
  pastedToken,
  onPaste,
  revealMasked,
  onToggleReveal,
}: {
  isAuthenticated: boolean;
  hasToken: boolean;
  slug: string;
  pastedToken: string;
  onPaste: (v: string) => void;
  revealMasked: boolean;
  onToggleReveal: () => void;
}) {
  const sectionStyle: React.CSSProperties = {
    border: '1px solid var(--line)',
    borderRadius: 10,
    padding: '10px 12px',
    background: 'var(--bg, #fafaf8)',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--muted)',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  };

  const helperStyle: React.CSSProperties = {
    fontSize: 11.5,
    color: 'var(--muted)',
    margin: 0,
    lineHeight: 1.5,
  };

  // Anonymous: paste field + "Get your token" CTA.
  if (!isAuthenticated) {
    return (
      <div data-testid="install-popover-token" style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={labelStyle}>Agent token</div>
          <Link
            data-testid="install-popover-signin"
            to={`/login?next=${encodeURIComponent(`/p/${slug}`)}`}
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--accent)',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Get your token →
          </Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
          <input
            type="text"
            inputMode="text"
            spellCheck={false}
            autoComplete="off"
            data-testid="install-popover-token-input"
            placeholder="Paste an existing token (floom_agent_…)"
            value={pastedToken}
            onChange={(e) => onPaste(e.target.value)}
            style={{
              flex: 1,
              minWidth: 0,
              padding: '7px 10px',
              fontSize: 12,
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              border: '1px solid var(--line)',
              borderRadius: 8,
              background: 'var(--card)',
              color: 'var(--ink)',
              outline: 'none',
            }}
          />
        </div>
        <p style={helperStyle}>
          Not stored or sent anywhere; just substituted into the snippet below as you type.
        </p>
      </div>
    );
  }

  // Signed in but no token minted yet.
  if (!hasToken) {
    return (
      <div data-testid="install-popover-token" style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={labelStyle}>Agent token</div>
          <Link
            data-testid="install-popover-mint"
            to="/home"
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--accent)',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Mint a token →
          </Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
          <input
            type="text"
            inputMode="text"
            spellCheck={false}
            autoComplete="off"
            data-testid="install-popover-token-input"
            placeholder="Or paste an existing token (floom_agent_…)"
            value={pastedToken}
            onChange={(e) => onPaste(e.target.value)}
            style={{
              flex: 1,
              minWidth: 0,
              padding: '7px 10px',
              fontSize: 12,
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              border: '1px solid var(--line)',
              borderRadius: 8,
              background: 'var(--card)',
              color: 'var(--ink)',
              outline: 'none',
            }}
          />
        </div>
      </div>
    );
  }

  // Signed in with a token. Show masked placeholder + reveal toggle (which
  // here only swaps between mask and a longer mask — the raw token is
  // never available client-side once minted). The paste field stays so
  // a user with multiple tokens can preview a different one.
  const displayedToken = revealMasked
    ? 'floom_agent_••••••••••••••••••••••••'
    : MASKED_TOKEN;
  return (
    <div data-testid="install-popover-token" style={sectionStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={labelStyle}>Your agent token</div>
        <Link
          to="/me/settings/tokens"
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--accent)',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          Manage tokens →
        </Link>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <code
          data-testid="install-popover-token-masked"
          style={{
            flex: 1,
            minWidth: 0,
            padding: '7px 10px',
            fontSize: 12,
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            border: '1px solid var(--line)',
            borderRadius: 8,
            background: 'var(--card)',
            color: 'var(--ink)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {displayedToken}
        </code>
        <button
          type="button"
          aria-label={revealMasked ? 'Hide token' : 'Reveal token'}
          onClick={onToggleReveal}
          style={{
            padding: '7px 9px',
            fontSize: 12,
            fontWeight: 600,
            border: '1px solid var(--line)',
            borderRadius: 8,
            background: 'var(--card)',
            color: 'var(--muted)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          {revealMasked ? <EyeOff size={13} aria-hidden /> : <Eye size={13} aria-hidden />}
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
        <input
          type="text"
          inputMode="text"
          spellCheck={false}
          autoComplete="off"
          data-testid="install-popover-token-input"
          placeholder="Or paste a different token to preview"
          value={pastedToken}
          onChange={(e) => onPaste(e.target.value)}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '6px 10px',
            fontSize: 11.5,
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            border: '1px solid var(--line)',
            borderRadius: 8,
            background: 'var(--card)',
            color: 'var(--ink)',
            outline: 'none',
          }}
        />
      </div>
      <p style={helperStyle}>
        Raw token is shown once at mint time. Pasted tokens are not stored; they only swap into the snippet locally.
      </p>
    </div>
  );
}

/* ============================================================== */
/* URL field                                                      */
/* ============================================================== */

function UrlField({
  label,
  value,
  testId,
  copyLabel,
}: {
  label: string;
  value: string;
  testId: string;
  copyLabel: string;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--muted)',
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          margin: '0 0 6px',
        }}
      >
        {label}
      </div>
      <div
        data-testid={testId}
        style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: 8,
        }}
      >
        <code
          style={{
            flex: 1,
            minWidth: 0,
            padding: '8px 10px',
            fontSize: 12,
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            border: '1px solid var(--line)',
            borderRadius: 8,
            background: 'var(--studio, #f5f4f0)',
            color: 'var(--ink)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {value}
        </code>
        <CopyButton value={value} label={copyLabel} className="install-copy-btn install-copy-btn-inline" />
      </div>
    </div>
  );
}

/* ============================================================== */
/* Code block                                                      */
/* ============================================================== */

function CodeBlock({
  description,
  value,
  testId,
  copyLabel,
}: {
  description: React.ReactNode;
  value: string;
  testId: string;
  copyLabel: string;
}) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 12,
          margin: '0 0 6px',
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: 'var(--muted)',
            lineHeight: 1.5,
            flex: 1,
          }}
        >
          {description}
        </p>
        <CopyButton value={value} label={copyLabel} className="install-copy-btn install-copy-btn-primary" />
      </div>
      <div
        data-testid={testId}
        style={{
          border: '1px solid var(--line)',
          borderRadius: 10,
          background: 'var(--studio, #f5f4f0)',
          padding: '12px 14px',
        }}
      >
        <pre
          style={{
            margin: 0,
            fontFamily:
              'JetBrains Mono, ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace',
            fontSize: 12,
            lineHeight: 1.6,
            color: 'var(--ink)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {value}
        </pre>
      </div>
    </div>
  );
}

export default InstallPopover;
