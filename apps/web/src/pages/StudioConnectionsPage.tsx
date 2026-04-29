/**
 * /run/connections — "Connect a tool" UI for Composio OAuth.
 *
 * Moved from /studio/connections (Fix 5 — consumer-mode page belongs in /run,
 * not /studio which is creator-mode).
 *
 * Backend routes used:
 *   POST   /api/connections/initiate   { provider } → { auth_url }
 *   GET    /api/connections?status=active
 *   DELETE /api/connections/:provider
 *
 * OAuth flow:
 *   1. Click "Connect" → POST initiate → window.open(auth_url, '_blank') (Fix 1)
 *   2. Composio redirects back to /run/connections?connected=<provider>
 *   3. Page detects the param, refetches GET /api/connections, strips the param,
 *      shows a success toast (Fix 3)
 */

import { type CSSProperties, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { WorkspacePageShell, WorkspaceHeader } from '../components/WorkspacePageShell';
import { useSession } from '../hooks/useSession';
import { StudioSignedOutState } from '../components/studio/StudioSignedOutState';

// ── Provider catalog ─────────────────────────────────────────────────

// Fix 4: SVG icon components using SimpleIcons paths + official brand colours.
// Paths sourced from simpleicons.org (CC0 license).
function GmailIcon({ size = 24 }: { size?: number }) {
  return (
    <svg role="img" viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg" aria-label="Gmail">
      <path
        fill="#EA4335"
        d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.910 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"
      />
    </svg>
  );
}

function GoogleCalendarIcon({ size = 24 }: { size?: number }) {
  return (
    <svg role="img" viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg" aria-label="Google Calendar">
      <path
        fill="#4285F4"
        d="M18.316 5.684H24v12.632h-5.684V5.684zM5.684 24v-5.684H0V24h5.684zM24 18.316V24h-5.684v-5.684H24zM5.684 5.684V0H0v5.684h5.684zM18.316 0H5.684v5.684h12.632V0zM0 18.316h5.684V5.684H0v12.632zM18.316 18.316H5.684V24h12.632v-5.684zM24 5.684h-5.684v12.632H24V5.684z"
      />
      <path fill="#4285F4" d="M18.316 5.684H5.684v12.632h12.632V5.684z" />
      <text x="12" y="15.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="#fff" fontFamily="sans-serif">31</text>
    </svg>
  );
}

function GoogleSheetsIcon({ size = 24 }: { size?: number }) {
  return (
    <svg role="img" viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg" aria-label="Google Sheets">
      <path
        fill="#34A853"
        d="M11.318 0 6.545 2.294l-.407 19.206L11.318 24H24V0H11.318zM9.545 7.5h9v1.5h-9V7.5zm0 3h9v1.5h-9V10.5zm0 3h9v1.5h-9V13.5zm0 3h6v1.5h-6V16.5z"
      />
      <path fill="#188038" d="M0 2.294l6.545-.182V24L0 21.706V2.294z" />
      <path fill="#1a73e8" d="M6.545 2.112 11.318 0v24l-4.773-2.294V2.112z" opacity=".2" />
    </svg>
  );
}

function SlackIcon({ size = 24 }: { size?: number }) {
  return (
    <svg role="img" viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg" aria-label="Slack">
      <path
        fill="#4A154B"
        d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"
      />
    </svg>
  );
}

function NotionIcon({ size = 24 }: { size?: number }) {
  return (
    <svg role="img" viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg" aria-label="Notion">
      <path
        fill="#000000"
        d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z"
      />
    </svg>
  );
}

function GitHubIcon({ size = 24 }: { size?: number }) {
  return (
    <svg role="img" viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg" aria-label="GitHub">
      <path
        fill="#181717"
        d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
      />
    </svg>
  );
}

function LinearIcon({ size = 24 }: { size?: number }) {
  return (
    <svg role="img" viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg" aria-label="Linear">
      <path
        fill="#5E6AD2"
        d="M0 14.188 9.813 24l14.033-14.033L9.813 0 0 9.813v4.375zm9.813-11.25L21.25 14.375 9.813 21.437 2.75 14.375l7.063-11.438zM11.25 1.563 22.438 12.75 24 11.188 12.813 0l-1.563 1.563zm1.562 20.874L24 11l-1.563-1.563L11 21.875l1.813.562z"
      />
    </svg>
  );
}

function StripeIcon({ size = 24 }: { size?: number }) {
  return (
    <svg role="img" viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg" aria-label="Stripe">
      <path
        fill="#635BFF"
        d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.91 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z"
      />
    </svg>
  );
}

interface ProviderDef {
  slug: string;
  name: string;
  description: string;
  Icon: React.ComponentType<{ size?: number }>;
}

const PROVIDERS: ProviderDef[] = [
  { slug: 'gmail',    name: 'Gmail',            description: 'Read and send emails',            Icon: GmailIcon },
  { slug: 'calendar', name: 'Google Calendar',  description: 'Read and create calendar events', Icon: GoogleCalendarIcon },
  { slug: 'sheets',   name: 'Google Sheets',    description: 'Read and write spreadsheets',     Icon: GoogleSheetsIcon },
  { slug: 'slack',    name: 'Slack',            description: 'Send messages and read channels', Icon: SlackIcon },
  { slug: 'notion',   name: 'Notion',           description: 'Read and write pages',            Icon: NotionIcon },
  { slug: 'github',   name: 'GitHub',           description: 'Read repos, create issues',       Icon: GitHubIcon },
  { slug: 'linear',   name: 'Linear',           description: 'Manage issues and projects',      Icon: LinearIcon },
  { slug: 'stripe',   name: 'Stripe',           description: 'Read customers and payments',     Icon: StripeIcon },
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

  // Fix 3: Handle OAuth callback redirect: /run/connections?connected=gmail
  // Re-fetch connection state and strip the param so back/refresh don't re-show the toast.
  useEffect(() => {
    if (!connectedParam) return;
    const provider = PROVIDERS.find(p => p.slug === connectedParam);
    setSuccessMsg(`${provider?.name ?? connectedParam} connected.`);
    // Strip the param so back/refresh don't re-show the toast
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('connected');
      return next;
    }, { replace: true });
    // Re-poll connections after callback — this is what updates "Connect" → "Connected"
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

  // Fix 1: Open OAuth in a new tab so the user keeps the Floom tab open.
  // The OAuth popup/tab redirects back to /run/connections?connected=<slug>
  // and when the user returns here the ?connected param triggers a re-fetch.
  async function handleConnect(slug: string) {
    setConnecting(slug);
    setErrorMsg(null);
    try {
      const result = await initiateConnection(slug);
      window.open(result.auth_url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setErrorMsg((err as Error).message || `Could not connect ${slug}`);
    } finally {
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
      title="Connections · Floom"
      allowSignedOutShell={signedOutPreview}
    >
      {signedOutPreview ? (
        <StudioSignedOutState />
      ) : (
        <div>
          {/* Fix 5: eyebrow changed from "Studio" to "Workspace" — this is consumer-mode */}
          <WorkspaceHeader
            eyebrow="Workspace"
            title="Connect a tool"
            scope="Authorize Floom to act on your behalf in external services. Each connection is OAuth — your credentials stay with the provider."
          />

          {/* Fix 2: Soft hand-off copy so users know what to expect */}
          <p style={handoffNoteStyle}>
            OAuth happens on the provider&apos;s site. You&apos;ll come back here when it&apos;s done.
          </p>

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
              const { Icon } = provider;
              const connected = activeProviders.has(provider.slug);
              const isConnecting = connecting === provider.slug;
              const isDisconnecting = disconnecting === provider.slug;
              const busy = isConnecting || isDisconnecting;

              return (
                <div key={provider.slug} style={cardStyle(connected)}>
                  <div style={cardHeaderStyle}>
                    <span style={iconStyle} aria-hidden="true">
                      <Icon size={24} />
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
                        {isConnecting ? 'Opening…' : 'Connect'}
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

const handoffNoteStyle: CSSProperties = {
  margin: '0 0 20px',
  fontSize: 13,
  color: 'var(--muted)',
  lineHeight: 1.5,
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: 16,
  marginTop: 0,
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
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
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
