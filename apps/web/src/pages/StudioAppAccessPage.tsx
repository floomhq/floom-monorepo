import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Copy, Link as LinkIcon, RotateCcw, Trash2, UserPlus } from 'lucide-react';
import { WorkspacePageShell } from '../components/WorkspacePageShell';
import { StudioAppTabs } from './StudioAppPage';
import * as api from '../api/client';
import type { AppSharingInvite, AppSharingResponse, AppSharingState } from '../api/client';

export function StudioAppAccessPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [sharing, setSharing] = useState<AppSharingResponse | null>(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const linkUrl = useMemo(() => {
    if (!sharing?.link_share_token || typeof window === 'undefined') return '';
    return `${window.location.origin}/p/${encodeURIComponent(slug)}?key=${encodeURIComponent(sharing.link_share_token)}`;
  }, [sharing?.link_share_token, slug]);

  const load = useCallback(() => {
    if (!slug) return;
    setError(null);
    api
      .getAppSharing(slug)
      .then(setSharing)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load access settings.'));
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  async function setState(state: AppSharingState, rotate = false) {
    if (!slug) return;
    setBusy(`state:${state}`);
    setError(null);
    try {
      const next = await api.setAppSharing(slug, { state, link_token_rotate: rotate });
      setSharing((prev) => prev ? { ...prev, visibility: next.visibility, link_share_token: next.link_share_token } : prev);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update sharing.');
    } finally {
      setBusy(null);
    }
  }

  async function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = email.trim().toLowerCase();
    if (!value) return;
    setBusy('invite');
    setError(null);
    try {
      const response = await api.inviteToApp(slug, { emails: [value], permission: 'run' });
      setEmail('');
      setSharing((prev) =>
        prev
          ? {
              ...prev,
              visibility: prev.visibility === 'private' ? 'invited' : prev.visibility,
              invites: mergeInvites(prev.invites, response.invites ?? []),
            }
          : prev,
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invite.');
    } finally {
      setBusy(null);
    }
  }

  async function revoke(inviteId: string) {
    setBusy(`revoke:${inviteId}`);
    setError(null);
    try {
      const response = await api.revokeAppInvite(slug, inviteId);
      setSharing((prev) =>
        prev
          ? {
              ...prev,
              invites: prev.invites.map((invite) => (invite.id === inviteId ? response.invite : invite)),
            }
          : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke invite.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <WorkspacePageShell mode="studio" title="Access · Studio">
      <StudioAppTabs slug={slug} active="access" />
      <section style={panelStyle}>
        <div style={kickerStyle}>Access</div>
        <h1 style={h1Style}>Who can use this app</h1>
        <p style={bodyStyle}>Set visibility, create signed links, and invite teammates.</p>

        {error ? <div style={errorStyle}>{error}</div> : null}

        <div style={segmentedStyle} aria-label="Visibility">
          {(['private', 'invited', 'link'] as AppSharingState[]).map((state) => (
            <button
              key={state}
              type="button"
              onClick={() => void setState(state)}
              disabled={busy !== null}
              style={segmentStyle(sharing?.visibility === state)}
            >
              {stateLabel(state)}
            </button>
          ))}
        </div>

        <div style={gridStyle}>
          <div style={cardStyle}>
            <h2 style={h2Style}><UserPlus size={16} /> Invites</h2>
            <form onSubmit={submitInvite} style={inviteFormStyle}>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                placeholder="teammate@company.com"
                style={inputStyle}
              />
              <button type="submit" disabled={busy !== null || !email.trim()} style={primaryButtonStyle}>
                {busy === 'invite' ? 'Sending...' : 'Invite'}
              </button>
            </form>
            <div style={listStyle}>
              {(sharing?.invites ?? []).length === 0 ? (
                <p style={mutedStyle}>No invites yet.</p>
              ) : (
                sharing!.invites.map((invite) => (
                  <InviteRow
                    key={invite.id}
                    invite={invite}
                    busy={busy === `revoke:${invite.id}`}
                    onRevoke={() => void revoke(invite.id)}
                  />
                ))
              )}
            </div>
          </div>

          <div style={cardStyle}>
            <h2 style={h2Style}><LinkIcon size={16} /> Signed link</h2>
            {linkUrl ? (
              <>
                <div style={linkBoxStyle}>{linkUrl}</div>
                <div style={actionsStyle}>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(linkUrl).then(() => {
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 1200);
                      });
                    }}
                    style={secondaryButtonStyle}
                  >
                    <Copy size={14} /> {copied ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void setState('link', true)}
                    disabled={busy !== null}
                    style={secondaryButtonStyle}
                  >
                    <RotateCcw size={14} /> Rotate
                  </button>
                </div>
              </>
            ) : (
              <button type="button" onClick={() => void setState('link')} disabled={busy !== null} style={primaryButtonStyle}>
                Enable signed link
              </button>
            )}
          </div>
        </div>
      </section>
    </WorkspacePageShell>
  );
}

function mergeInvites(existing: AppSharingInvite[], incoming: AppSharingInvite[]): AppSharingInvite[] {
  const byId = new Map(existing.map((invite) => [invite.id, invite] as const));
  for (const invite of incoming) byId.set(invite.id, invite);
  return Array.from(byId.values());
}

function stateLabel(state: AppSharingState): string {
  if (state === 'private') return 'Private';
  if (state === 'invited') return 'Invite-only';
  return 'Signed link';
}

function inviteEmail(invite: AppSharingInvite): string {
  return invite.invited_email || invite.invited_user_email || invite.invited_user_id || 'Unknown invitee';
}

function InviteRow({ invite, busy, onRevoke }: { invite: AppSharingInvite; busy: boolean; onRevoke: () => void }) {
  const active = invite.state !== 'revoked' && invite.state !== 'declined';
  return (
    <div style={rowStyle}>
      <div style={{ minWidth: 0 }}>
        <div style={rowTitleStyle}>{inviteEmail(invite)}</div>
        <div style={mutedStyle}>{invite.state.replace('_', ' ')}</div>
      </div>
      {active ? (
        <button type="button" onClick={onRevoke} disabled={busy} style={iconButtonStyle} aria-label={`Revoke ${inviteEmail(invite)}`}>
          <Trash2 size={14} />
        </button>
      ) : null}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  border: '1px solid var(--line)',
  borderRadius: 12,
  background: 'var(--card)',
  padding: 24,
  maxWidth: 980,
};

const kickerStyle: React.CSSProperties = {
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
  marginBottom: 8,
};

const h1Style: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 28,
  fontWeight: 800,
  letterSpacing: 0,
  margin: 0,
  color: 'var(--ink)',
};

const bodyStyle: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.6,
  color: 'var(--muted)',
  margin: '10px 0 18px',
  maxWidth: 680,
};

const segmentedStyle: React.CSSProperties = {
  display: 'inline-flex',
  gap: 4,
  border: '1px solid var(--line)',
  borderRadius: 8,
  padding: 4,
  background: 'var(--paper)',
  marginBottom: 18,
};

function segmentStyle(active: boolean): React.CSSProperties {
  return {
    border: 'none',
    borderRadius: 6,
    padding: '8px 12px',
    background: active ? 'var(--ink)' : 'transparent',
    color: active ? 'var(--card)' : 'var(--muted)',
    fontWeight: 700,
    cursor: 'pointer',
  };
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: 16,
};

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--line)',
  borderRadius: 8,
  padding: 16,
  background: 'var(--paper)',
};

const h2Style: React.CSSProperties = {
  margin: '0 0 12px',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 15,
  color: 'var(--ink)',
};

const inviteFormStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  marginBottom: 14,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: '1px solid var(--line)',
  borderRadius: 8,
  padding: '10px 12px',
  fontSize: 14,
  background: 'var(--card)',
  color: 'var(--ink)',
};

const primaryButtonStyle: React.CSSProperties = {
  border: '1px solid var(--ink)',
  borderRadius: 8,
  padding: '10px 12px',
  background: 'var(--ink)',
  color: 'var(--card)',
  fontWeight: 800,
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  border: '1px solid var(--line)',
  borderRadius: 8,
  padding: '9px 11px',
  background: 'var(--card)',
  color: 'var(--ink)',
  fontWeight: 700,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

const listStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  border: '1px solid var(--line)',
  borderRadius: 8,
  padding: '10px 12px',
  background: 'var(--card)',
};

const rowTitleStyle: React.CSSProperties = {
  fontSize: 13.5,
  fontWeight: 700,
  color: 'var(--ink)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const mutedStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--muted)',
  fontSize: 12.5,
};

const iconButtonStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: 6,
  padding: 6,
  background: 'transparent',
  color: 'var(--muted)',
  cursor: 'pointer',
};

const linkBoxStyle: React.CSSProperties = {
  border: '1px solid var(--line)',
  borderRadius: 8,
  padding: 10,
  background: 'var(--card)',
  color: 'var(--ink)',
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: 12,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  marginBottom: 12,
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
};

const errorStyle: React.CSSProperties = {
  border: '1px solid rgba(180, 35, 24, 0.25)',
  borderRadius: 8,
  padding: '10px 12px',
  background: 'rgba(180, 35, 24, 0.06)',
  color: '#8a1f17',
  fontSize: 13,
  marginBottom: 14,
};
