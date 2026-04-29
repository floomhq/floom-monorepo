/**
 * /studio/connections — Minimal "Connect a tool" UI for Composio OAuth.
 *
 * Scope: list known integrations, show connected state, allow connect +
 * disconnect. No marketplace, no search — just the 8 priority cards that
 * unblock Federico's end-to-end test.
 *
 * Backend routes used:
 *   POST   /api/connections/initiate   { provider } → { auth_url }
 *   GET    /api/connections?status=active
 *   DELETE /api/connections/:provider
 *
 * OAuth flow:
 *   1. Click "Connect" → POST initiate → navigate to auth_url (Composio / Google consent)
 *   2. Composio redirects back to /studio/connections?connected=<provider>
 *   3. Page detects the param, shows success toast, polls GET /api/connections
 */

import { type CSSProperties, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { WorkspacePageShell, WorkspaceHeader } from '../components/WorkspacePageShell';
import { useSession } from '../hooks/useSession';
import { StudioSignedOutState } from '../components/studio/StudioSignedOutState';

// ── Provider catalog ─────────────────────────────────────────────────

interface ProviderDef {
  slug: string;
  name: string;
  description: string;
  icon: string; // emoji placeholder — swap for real SVG when available
}

const PROVIDERS: ProviderDef[] = [
  { slug: 'gmail',    name: 'Gmail',    description: 'Read and send emails',           icon: '✉️' },
  { slug: 'calendar', name: 'Calendar', description: 'Read and create calendar events', icon: '📅' },
  { slug: 'sheets',   name: 'Sheets',   description: 'Read and write spreadsheets',     icon: '📊' },
  { slug: 'slack',    name: 'Slack',    description: 'Send messages and read channels', icon: '💬' },
  { slug: 'notion',   name: 'Notion',   description: 'Read and write pages',            icon: '📝' },
  { slug: 'github',   name: 'GitHub',   description: 'Read repos, create issues',       icon: '🐙' },
  { slug: 'linear',   name: 'Linear',   description: 'Manage issues and projects',      icon: '🔷' },
  { slug: 'stripe',   name: 'Stripe',   description: 'Read customers and payments',     icon: '💳' },
];

// ── Types ─────────────────────────────────────────────────────────────

interface ConnectionRecord {
  id: string;
  provider: string;
  status: 'pending' | 'active' | 'revoked' | 'expired';
}

interface InitiateResponse {
  auth_url: string;
  connection_id: string;
  provider: string;
  expires_at: string;
}

// ── API helpers ──────────────────────────────────────────────────────

async function initiateConnection(provider: string): Promise<InitiateResponse> {
  const res = await fetch('/api/connections/initiate', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = `Failed to connect ${provider}`;
    try { msg = (JSON.parse(text) as { error?: string }).error ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return res.json() as Promise<InitiateResponse>;
}

async function listConnections(): Promise<ConnectionRecord[]> {
  const res = await fetch('/api/connections?status=active', {
    credentials: 'include',
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { connections: ConnectionRecord[] };
  return json.connections ?? [];
}

async function revokeConnection(provider: string): Promise<void> {
  const res = await fetch(`/api/connections/${encodeURIComponent(provider)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = `Failed to disconnect ${provider}`;
    try { msg = (JSON.parse(text) as { error?: string }).error ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
}

// ── Page ─────────────────────────────────────────────────────────────

export function StudioConnectionsPage() {
  const { data: session } = useSession();
  const signedOutPreview = !!session && session.cloud_mode && session.user.is_local;

  const [searchParams, setSearchParams] = useSearchParams();
  const connectedParam = searchParams.get('connected');

  const [connections, setConnections] = useState<ConnectionRecord[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Load active connections on mount (and after OAuth callback)
  const refresh = () => {
    setLoadingConnections(true);
    listConnections()
      .then(setConnections)
      .catch(() => setConnections([]))
      .finally(() => setLoadingConnections(false));
  };

  useEffect(() => {
    if (!signedOutPreview) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedOutPreview]);

  // Handle OAuth callback redirect: /studio/connections?connected=gmail
  useEffect(() => {
    if (!connectedParam) return;
    const provider = PROVIDERS.find(p => p.slug === connectedParam);
    setSuccessMsg(`${provider?.name ?? connectedParam} connected successfully.`);
    // Strip the param so back/refresh don't re-show the toast
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('connected');
      return next;
    }, { replace: true });
    // Re-poll connections after callback
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedParam]);

  // Auto-dismiss messages
  useEffect(() => {
    if (!successMsg && !errorMsg) return;
    const t = setTimeout(() => {
      setSuccessMsg(null);
      setErrorMsg(null);
    }, 5000);
    return () => clearTimeout(t);
  }, [successMsg, errorMsg]);

  const activeProviders = new Set(
    connections.filter(c => c.status === 'active').map(c => c.provider),
  );

  async function handleConnect(slug: string) {
    setConnecting(slug);
    setErrorMsg(null);
    try {
      const result = await initiateConnection(slug);
      // Full-page navigate — Composio handles consent, then redirects back
      // to preview.floom.dev/studio/connections?connected=<slug>
      window.location.href = result.auth_url;
    } catch (err) {
      setErrorMsg((err as Error).message || `Could not connect ${slug}`);
      setConnecting(null);
    }
  }

  async function handleDisconnect(slug: string) {
    setDisconnecting(slug);
    setErrorMsg(null);
    try {
      await revokeConnection(slug);
      setSuccessMsg(`${PROVIDERS.find(p => p.slug === slug)?.name ?? slug} disconnected.`);
      refresh();
    } catch (err) {
      setErrorMsg((err as Error).message || `Could not disconnect ${slug}`);
    } finally {
      setDisconnecting(null);
    }
  }

  return (
    <WorkspacePageShell
      mode="studio"
      title="Connections · Studio · Floom"
      allowSignedOutShell={signedOutPreview}
    >
      {signedOutPreview ? (
        <StudioSignedOutState />
      ) : (
        <div>
          <WorkspaceHeader
            eyebrow="Studio"
            title="Connect a tool"
            scope="Authorize Floom to act on your behalf in external services. Each connection is OAuth — your credentials stay with the provider."
          />

          {/* Toast messages */}
          {successMsg && (
            <div role="status" aria-live="polite" style={toastStyle('success')}>
              {successMsg}
            </div>
          )}
          {errorMsg && (
            <div role="alert" aria-live="assertive" style={toastStyle('error')}>
              {errorMsg}
            </div>
          )}

          {/* Grid */}
          <div style={gridStyle}>
            {PROVIDERS.map((provider) => {
              const connected = activeProviders.has(provider.slug);
              const isConnecting = connecting === provider.slug;
              const isDisconnecting = disconnecting === provider.slug;
              const busy = isConnecting || isDisconnecting;

              return (
                <div key={provider.slug} style={cardStyle(connected)}>
                  <div style={cardHeaderStyle}>
                    <span style={iconStyle} aria-hidden="true">
                      {provider.icon}
                    </span>
                    <div style={cardTextStyle}>
                      <span style={cardNameStyle}>{provider.name}</span>
                      <span style={cardDescStyle}>{provider.description}</span>
                    </div>
                    {connected && (
                      <span style={connectedPillStyle} aria-label={`${provider.name} connected`}>
                        Connected
                      </span>
                    )}
                  </div>

                  <div style={cardActionsStyle}>
                    {connected ? (
                      <button
                        type="button"
                        onClick={() => void handleDisconnect(provider.slug)}
                        disabled={busy || loadingConnections}
                        style={disconnectBtnStyle(busy || loadingConnections)}
                        aria-busy={isDisconnecting}
                      >
                        {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleConnect(provider.slug)}
                        disabled={busy || !!connecting || loadingConnections}
                        style={connectBtnStyle(busy || !!connecting || loadingConnections)}
                        aria-busy={isConnecting}
                      >
                        {isConnecting ? 'Connecting…' : 'Connect'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {loadingConnections && connections.length === 0 && (
            <p style={loadingStyle}>Loading connections…</p>
          )}
        </div>
      )}
    </WorkspacePageShell>
  );
}

// ── Styles ────────────────────────────────────────────────────────────

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: 16,
  marginTop: 8,
};

function cardStyle(connected: boolean): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    padding: '20px 20px 16px',
    borderRadius: 12,
    background: 'var(--card)',
    border: connected ? '1.5px solid var(--accent)' : '1px solid var(--line)',
    boxSizing: 'border-box',
  };
}

const cardHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
};

const cardTextStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const iconStyle: CSSProperties = {
  fontSize: 24,
  lineHeight: 1,
  flexShrink: 0,
  width: 32,
  textAlign: 'center',
};

const cardNameStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--ink)',
  lineHeight: 1.3,
};

const cardDescStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--muted)',
  lineHeight: 1.4,
};

const connectedPillStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 8px',
  borderRadius: 20,
  background: 'var(--accent)',
  color: '#fff',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

const cardActionsStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
};

function connectBtnStyle(disabled: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '7px 14px',
    borderRadius: 8,
    border: '1px solid var(--ink)',
    background: 'var(--ink)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    transition: 'opacity 0.15s',
  };
}

function disconnectBtnStyle(disabled: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '6px 12px',
    borderRadius: 8,
    border: '1px solid var(--line)',
    background: 'transparent',
    color: 'var(--muted)',
    fontSize: 12,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    transition: 'opacity 0.15s',
  };
}

function toastStyle(type: 'success' | 'error'): CSSProperties {
  return {
    marginBottom: 16,
    padding: '10px 16px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    color: type === 'success' ? '#166534' : '#991b1b',
    background: type === 'success' ? '#dcfce7' : '#fee2e2',
    border: `1px solid ${type === 'success' ? '#86efac' : '#fca5a5'}`,
  };
}

const loadingStyle: CSSProperties = {
  marginTop: 32,
  fontSize: 13,
  color: 'var(--muted)',
  textAlign: 'center',
};
