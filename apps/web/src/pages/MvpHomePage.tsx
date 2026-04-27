/**
 * MvpHomePage — slim one-box authed home for launch-mvp.
 *
 * Single page: token card + install tabs + footer links.
 * No rail, no tabs, no Studio/BYOK/Members/Billing.
 *
 * Routes: /home (post-login redirect target on launch-mvp)
 */

import { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSession, clearSession } from '../hooks/useSession';
import { Logo } from '../components/Logo';
import * as api from '../api/client';
import type { CreatedAgentToken } from '../api/client';

// ---------- constants ----------

const INK = '#0e0e0c';
const MUTED = '#585550';
const ACCENT = '#047857';
const BG = '#fafaf8';
const CARD = '#fff';
const LINE = 'rgba(14,14,12,0.1)';
const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

const MCP_URL = 'https://floom.dev/mcp';

function buildMcpConfig(token: string) {
  return `{
  "mcpServers": {
    "floom": {
      "url": "${MCP_URL}",
      "headers": {
        "Authorization": "Bearer ${token}"
      }
    }
  }
}`;
}

function buildCliSnippet(token: string) {
  return `curl -fsSL https://floom.dev/install.sh | bash\nfloom auth login --token=${token}`;
}

// ---------- MvpAuthShell ----------

function MvpAuthShell({ children }: { children: React.ReactNode }) {
  const { data, isAuthenticated } = useSession();
  const [dropOpen, setDropOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const user = data?.user;
  const userLabel = user?.name || user?.email?.split('@')[0] || 'user';
  const userInitial = userLabel.charAt(0).toUpperCase();

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setDropOpen(false);
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  async function handleLogout() {
    try { await api.signOut(); } catch { /* ignore */ }
    clearSession();
    navigate('/');
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, display: 'flex', flexDirection: 'column', fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Slim top bar: logo + avatar */}
      <header style={{
        height: 52,
        borderBottom: `1px solid ${LINE}`,
        background: CARD,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: INK }}>
          <Logo size={20} withWordmark={false} variant="glow" />
          <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1 }}>floom</span>
        </Link>

        {isAuthenticated && (
          <div ref={dropRef} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setDropOpen(v => !v)}
              data-testid="mvp-user-trigger"
              aria-label="Account menu"
              aria-haspopup="menu"
              aria-expanded={dropOpen}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 8px 4px 4px',
                border: `1px solid ${LINE}`,
                borderRadius: 999,
                background: BG,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {user?.image ? (
                <img src={user.image} alt="" width={24} height={24} style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} />
              ) : (
                <span style={{ width: 24, height: 24, borderRadius: '50%', background: ACCENT, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
                  {userInitial}
                </span>
              )}
              <span style={{ fontSize: 13, color: INK }}>{userLabel}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, transition: 'transform 0.12s', transform: dropOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {dropOpen && (
              <div role="menu" data-testid="mvp-user-menu" style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, background: CARD, border: `1px solid ${LINE}`, borderRadius: 8, minWidth: 200, boxShadow: '0 4px 16px rgba(14,14,12,0.08)', padding: 4, zIndex: 50 }}>
                <Link to="/docs" role="menuitem" onClick={() => setDropOpen(false)} style={{ display: 'block', padding: '8px 12px', fontSize: 13, color: INK, textDecoration: 'none', borderRadius: 6 }}>Docs</Link>
                <Link to="/help" role="menuitem" onClick={() => setDropOpen(false)} style={{ display: 'block', padding: '8px 12px', fontSize: 13, color: INK, textDecoration: 'none', borderRadius: 6 }}>Help</Link>
                <a href="https://discord.gg/floom" target="_blank" rel="noreferrer" role="menuitem" onClick={() => setDropOpen(false)} style={{ display: 'block', padding: '8px 12px', fontSize: 13, color: INK, textDecoration: 'none', borderRadius: 6 }}>Discord</a>
                <div style={{ height: 1, background: LINE, margin: '4px 0' }} />
                <button type="button" onClick={() => { setDropOpen(false); void handleLogout(); }} role="menuitem" data-testid="mvp-logout" style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 13, color: INK, background: 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      <main style={{ flex: 1 }}>{children}</main>

      {/* Mini footer */}
      <footer style={{ borderTop: `1px solid ${LINE}`, padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20, flexWrap: 'wrap' }}>
        <Link to="/docs" style={{ fontSize: 13, color: MUTED, textDecoration: 'none' }}>Docs</Link>
        <Link to="/help" style={{ fontSize: 13, color: MUTED, textDecoration: 'none' }}>Help</Link>
        <a href="https://discord.gg/floom" target="_blank" rel="noreferrer" style={{ fontSize: 13, color: MUTED, textDecoration: 'none' }}>Discord</a>
      </footer>
    </div>
  );
}

// ---------- InstallTabs ----------

type TabId = 'mcp' | 'cli';

function InstallTabs({ token }: { token: string }) {
  const [active, setActive] = useState<TabId>('mcp');
  const [copied, setCopied] = useState(false);

  const mcpSnippet = buildMcpConfig(token);
  const cliSnippet = buildCliSnippet(token);
  const snippet = active === 'mcp' ? mcpSnippet : cliSnippet;

  async function handleCopy() {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(snippet);
      } else {
        const ta = document.createElement('textarea');
        ta.value = snippet;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* silent */ }
  }

  const tabBtn = (id: TabId, label: string) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={active === id}
      data-testid={`install-tab-${id}`}
      onClick={() => { setActive(id); setCopied(false); }}
      style={{
        padding: '9px 16px',
        fontSize: 13,
        fontWeight: active === id ? 700 : 500,
        border: 'none',
        background: 'transparent',
        color: active === id ? INK : MUTED,
        borderBottom: active === id ? `2px solid ${ACCENT}` : '2px solid transparent',
        marginBottom: -1,
        cursor: 'pointer',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap' as const,
      }}
    >{label}</button>
  );

  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, background: CARD, overflow: 'hidden' }}>
      {/* Tab bar */}
      <div role="tablist" style={{ display: 'flex', borderBottom: `1px solid ${LINE}`, background: BG, padding: '0 4px' }}>
        {tabBtn('mcp', 'MCP server')}
        {tabBtn('cli', 'CLI')}
      </div>

      {/* Snippet area */}
      <div style={{ padding: '16px 18px' }}>
        {active === 'mcp' && (
          <p style={{ fontSize: 12, color: MUTED, margin: '0 0 10px', lineHeight: 1.5 }}>
            Works with Claude Desktop, Cursor, Codex, and any MCP client.
          </p>
        )}
        {active === 'cli' && (
          <p style={{ fontSize: 12, color: MUTED, margin: '0 0 10px', lineHeight: 1.5 }}>
            Install the Floom CLI and authenticate with your token.
          </p>
        )}
        <div style={{ position: 'relative' }}>
          <pre style={{ fontFamily: MONO, fontSize: 12, background: '#1b1a17', color: '#d4d4c8', borderRadius: 8, padding: '14px 16px', overflowX: 'auto', whiteSpace: 'pre', lineHeight: 1.6, margin: 0, paddingRight: 80 }}>
            {snippet}
          </pre>
          <button
            type="button"
            data-testid={`copy-install-${active}`}
            onClick={() => void handleCopy()}
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              fontSize: 11,
              fontWeight: 600,
              color: copied ? '#d4d4c8' : ACCENT,
              background: 'rgba(255,255,255,0.07)',
              border: `1px solid ${copied ? 'rgba(212,212,200,0.2)' : 'rgba(4,120,87,0.35)'}`,
              borderRadius: 6,
              padding: '3px 10px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              letterSpacing: '0.03em',
            }}
            aria-label={copied ? 'Copied' : 'Copy install snippet'}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- TokenCard ----------

function TokenCard() {
  const { data: session } = useSession();
  const workspace = session?.active_workspace;
  const [tokens, setTokens] = useState<api.AgentTokenRecord[] | null>(null);
  const [minting, setMinting] = useState(false);
  const [minted, setMinted] = useState<CreatedAgentToken | null>(null);
  const [rotating, setRotating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!workspace) return;
    try {
      const list = await api.listWorkspaceAgentTokens(workspace.id);
      setTokens(list.filter(t => !t.revoked));
    } catch {
      setTokens([]);
    }
  }

  useEffect(() => { void load(); }, [workspace?.id]);

  async function handleMint() {
    if (!workspace) return;
    setMinting(true);
    setError(null);
    try {
      const created = await api.createWorkspaceAgentToken(workspace.id, { label: 'default', scope: 'read-write' });
      setMinted(created);
      await load();
    } catch (err) {
      setError((err as Error).message || 'Failed to mint token');
    } finally {
      setMinting(false);
    }
  }

  async function handleRotate() {
    if (!workspace || !tokens?.length) return;
    setRotating(true);
    setError(null);
    try {
      // Revoke all existing, then mint fresh
      for (const t of tokens) {
        await api.revokeWorkspaceAgentToken(workspace.id, t.id);
      }
      const created = await api.createWorkspaceAgentToken(workspace.id, { label: 'default', scope: 'read-write' });
      setMinted(created);
      await load();
    } catch (err) {
      setError((err as Error).message || 'Failed to rotate token');
    } finally {
      setRotating(false);
    }
  }

  async function handleCopyToken(tok: string) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(tok);
      } else {
        const ta = document.createElement('textarea');
        ta.value = tok;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* silent */ }
  }

  const activeToken = tokens?.[0] ?? null;
  const displayToken = minted?.raw_token ?? null;

  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, background: CARD, padding: '22px 24px' }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: ACCENT, margin: '0 0 8px' }}>
          Your agent token
        </h2>
        <p style={{ fontSize: 13, color: MUTED, margin: 0, lineHeight: 1.5 }}>
          Workspace credential. Use with MCP, CLI, or HTTP.
        </p>
      </div>

      {error && (
        <div style={{ background: '#fdecea', border: '1px solid #f4b7b1', color: '#c2321f', borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 14 }}>
          {error}
        </div>
      )}

      {/* One-time display of freshly minted/rotated token */}
      {displayToken && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
          <p style={{ fontSize: 12, color: '#166534', margin: '0 0 8px', fontWeight: 600 }}>
            Copy this token now — it won't be shown again.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code style={{ fontFamily: MONO, fontSize: 12.5, background: '#1b1a17', color: '#d4d4c8', padding: '8px 12px', borderRadius: 6, flex: 1, overflowX: 'auto', wordBreak: 'break-all' as const }}>
              {displayToken}
            </code>
            <button
              type="button"
              onClick={() => void handleCopyToken(displayToken)}
              data-testid="copy-token"
              style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, color: '#166534', background: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <button type="button" onClick={() => setMinted(null)} style={{ marginTop: 10, fontSize: 12, color: MUTED, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
            Done, I've saved it
          </button>
        </div>
      )}

      {tokens === null ? (
        <div style={{ color: MUTED, fontSize: 13, padding: '8px 0' }}>Loading...</div>
      ) : activeToken ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const }}>
          <code style={{ fontFamily: MONO, fontSize: 13, background: '#f4f4f2', border: `1px solid ${LINE}`, padding: '8px 14px', borderRadius: 8, color: INK, flex: '1 1 200px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
            floom_agent_••••••••
          </code>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => void handleRotate()}
              disabled={rotating}
              data-testid="rotate-token"
              style={{ fontSize: 13, fontWeight: 600, color: MUTED, background: BG, border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 14px', cursor: rotating ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: rotating ? 0.6 : 1 }}
            >
              {rotating ? 'Rotating...' : 'Rotate'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ textAlign: 'center' as const, padding: '16px 0 8px' }}>
          <p style={{ fontSize: 13, color: MUTED, margin: '0 0 16px', lineHeight: 1.5 }}>
            No token yet. Mint your workspace credential to connect from any MCP client or CLI.
          </p>
          <button
            type="button"
            onClick={() => void handleMint()}
            disabled={minting}
            data-testid="mint-token"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '11px 24px', borderRadius: 999, background: INK, color: '#fff', fontSize: 14, fontWeight: 700, cursor: minting ? 'not-allowed' : 'pointer', border: 'none', fontFamily: 'inherit', opacity: minting ? 0.7 : 1 }}
          >
            {minting ? 'Minting...' : 'Mint your token'}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- MvpHomePage ----------

export function MvpHomePage() {
  const { data: session, isAuthenticated } = useSession();
  const workspace = session?.active_workspace;
  const navigate = useNavigate();
  const [tokens, setTokens] = useState<api.AgentTokenRecord[] | null>(null);

  // Load tokens to know which snippet to seed install tabs with
  useEffect(() => {
    if (!workspace) return;
    api.listWorkspaceAgentTokens(workspace.id)
      .then(list => setTokens(list.filter(t => !t.revoked)))
      .catch(() => setTokens([]));
  }, [workspace?.id]);

  // Redirect unauthenticated users to login
  useEffect(() => {
    if (isAuthenticated === false) navigate('/login', { replace: true });
  }, [isAuthenticated, navigate]);

  const hasToken = tokens !== null && tokens.length > 0;
  // Use masked placeholder once token exists (actual raw token is only shown on mint in TokenCard)
  const installToken = hasToken ? 'floom_agent_••••••••' : '';

  return (
    <MvpAuthShell>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px 64px' }}>
        <TokenCard />

        <h2 style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: INK, margin: '36px 0 12px' }}>
          Install
        </h2>
        {hasToken ? (
          <InstallTabs token={installToken} />
        ) : (
          <div
            data-testid="install-no-token"
            style={{
              border: `1px solid ${LINE}`,
              borderRadius: 12,
              background: CARD,
              padding: '28px 24px',
              textAlign: 'center' as const,
              opacity: 0.6,
            }}
          >
            <p style={{ fontSize: 13, color: MUTED, margin: 0, lineHeight: 1.6 }}>
              Mint your first token above to see the install snippet.
            </p>
          </div>
        )}
      </div>
    </MvpAuthShell>
  );
}
