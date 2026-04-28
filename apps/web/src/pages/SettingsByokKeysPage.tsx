// /settings/byok-keys — BYOK keys tab of Workspace settings.
//
// Workspace-level provider credentials (GEMINI_API_KEY, OPENAI_API_KEY, etc.).
// Values are write-only: the list endpoint returns key names + metadata but
// never the plaintext value.
//
// API: /api/workspaces/:id/secrets (listWorkspaceSecrets / setWorkspaceSecret /
//      deleteWorkspaceSecret). Falls back to the personal /api/secrets endpoint
//      when the session has no active workspace.

import { useEffect, useState } from 'react';
import { WorkspaceHeader, WorkspacePageShell } from '../components/WorkspacePageShell';
import { useSession } from '../hooks/useSession';
import * as api from '../api/client';
import type { UserSecretEntry } from '../lib/types';

export function SettingsByokKeysPage() {
  const { data: session } = useSession();
  const workspace = session?.active_workspace;
  const wsName = workspace?.name ?? 'this workspace';
  const wsId = workspace?.id;

  const [entries, setEntries] = useState<UserSecretEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Add / replace form
  const [showAdd, setShowAdd] = useState(false);
  const [addKey, setAddKey] = useState('');
  const [addValue, setAddValue] = useState('');
  const [addState, setAddState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [addError, setAddError] = useState('');

  // Delete confirm
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [deleteState, setDeleteState] = useState<'idle' | 'deleting'>('idle');

  async function load() {
    if (!wsId) return;
    try {
      const list = await api.listWorkspaceSecrets(wsId);
      setEntries(list.entries ?? []);
      setLoadError(null);
    } catch (err) {
      setEntries([]);
      setLoadError((err as Error).message || 'Failed to load BYOK keys');
    }
  }

  useEffect(() => { void load(); }, [wsId]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const k = addKey.trim().toUpperCase();
    const v = addValue.trim();
    if (!k || !v || !wsId) return;
    setAddState('saving');
    setAddError('');
    try {
      await api.setWorkspaceSecret(wsId, k, v);
      setAddKey('');
      setAddValue('');
      setShowAdd(false);
      setAddState('idle');
      await load();
    } catch (err) {
      setAddState('error');
      setAddError((err as Error).message || 'Could not save key');
    }
  }

  async function handleDelete(key: string) {
    if (!wsId) return;
    setDeleteState('deleting');
    try {
      await api.deleteWorkspaceSecret(wsId, key);
      setDeletingKey(null);
      setDeleteState('idle');
      await load();
    } catch (err) {
      setLoadError((err as Error).message || 'Failed to remove key');
      setDeletingKey(null);
      setDeleteState('idle');
    }
  }

  function providerLabel(key: string): string {
    const k = key.toUpperCase();
    if (k.includes('GEMINI') || k.includes('GOOGLE')) return 'GEMINI';
    if (k.includes('OPENAI')) return 'OPENAI';
    if (k.includes('ANTHROPIC') || k.includes('CLAUDE')) return 'ANTHROPIC';
    return 'CUSTOM';
  }

  return (
    <WorkspacePageShell mode="settings" title="BYOK keys · Workspace settings · Floom">
      <WorkspaceHeader
        eyebrow="Workspace settings"
        title="BYOK keys"
        scope={`Workspace-level provider credentials for ${wsName}. Values are encrypted at rest and only decrypted at run time.`}
      />

      {loadError && (
        <div role="alert" style={errorStyle}>{loadError}</div>
      )}

      {entries === null ? (
        <div style={emptyStyle}>Loading…</div>
      ) : (
        <>
          {entries.length === 0 && !showAdd ? (
            <div style={emptyStyle}>
              No BYOK keys yet.{' '}
              <button
                type="button"
                onClick={() => setShowAdd(true)}
                style={inlineLinkStyle}
                data-testid="byok-add-trigger"
              >
                Add your first key
              </button>{' '}
              to let apps use your own provider credentials.
            </div>
          ) : (
            entries.map((entry) => {
              const provider = providerLabel(entry.key);
              const isDeleting = deletingKey === entry.key;
              return (
                <div key={entry.key} style={keyCardStyle} data-testid={`byok-key-${entry.key}`}>
                  <div style={keyCardIconStyle}>
                    <LockIcon />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={keyCardNameStyle}>{entry.key}</div>
                    <div style={keyCardValStyle}>
                      {provider} &middot;{' '}
                      {entry.updated_at
                        ? `updated ${relativeDate(entry.updated_at)}`
                        : 'set'}
                    </div>
                    <div style={resourceControlsStyle}>
                      <span style={pillAccentStyle}>Visibility: Public</span>
                      <span style={pillNeutralStyle}>Selected v1.1</span>
                      <span style={pillNeutralStyle}>Global rate limit: 600/day</span>
                    </div>
                  </div>
                  <div style={cardActionsStyle}>
                    {isDeleting ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setDeletingKey(null)}
                          disabled={deleteState === 'deleting'}
                          style={btnSecondaryStyle}
                          data-testid={`byok-cancel-${entry.key}`}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(entry.key)}
                          disabled={deleteState === 'deleting'}
                          style={btnDangerStyle}
                          data-testid={`byok-confirm-remove-${entry.key}`}
                        >
                          {deleteState === 'deleting' ? 'Removing…' : 'Confirm remove'}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setAddKey(entry.key);
                            setAddValue('');
                            setShowAdd(true);
                          }}
                          style={btnSecondaryStyle}
                          data-testid={`byok-replace-${entry.key}`}
                        >
                          Replace
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingKey(entry.key)}
                          style={btnDangerStyle}
                          data-testid={`byok-remove-${entry.key}`}
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </>
      )}

      {showAdd ? (
        <form onSubmit={handleAdd} style={addFormStyle} data-testid="byok-add-form">
          <div style={addRowStyle}>
            <input
              autoFocus
              value={addKey}
              onChange={(e) => setAddKey(e.target.value)}
              placeholder="Key name, e.g. GEMINI_API_KEY"
              style={{ ...textInputStyle, flex: '1 1 160px' }}
              data-testid="byok-key-name-input"
              maxLength={128}
            />
            <input
              type="password"
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              placeholder="Key value"
              style={{ ...textInputStyle, flex: '2 1 220px' }}
              data-testid="byok-key-value-input"
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={addState === 'saving' || !addKey.trim() || !addValue.trim()}
              style={addState !== 'saving' && addKey.trim() && addValue.trim() ? btnAccentStyle : btnAccentDisabledStyle}
              data-testid="byok-add-submit"
            >
              {addState === 'saving' ? 'Saving…' : 'Save key'}
            </button>
            <button
              type="button"
              onClick={() => { setShowAdd(false); setAddKey(''); setAddValue(''); setAddError(''); }}
              style={btnSecondaryStyle}
            >
              Cancel
            </button>
          </div>
          {addError && (
            <div style={{ fontSize: 12, color: 'var(--danger, #c44a2b)', marginTop: 8 }} data-testid="byok-add-error">
              {addError}
            </div>
          )}
        </form>
      ) : (
        <div style={dashedAddStyle}>
          <button
            type="button"
            onClick={() => { setShowAdd(true); setAddKey(''); setAddValue(''); }}
            style={inlineLinkStyle}
            data-testid="byok-add-trigger"
          >
            <strong>+ Add another key</strong>
          </button>{' '}
          &middot; Gemini, OpenAI, Anthropic, or any custom env var that an app declares.
        </div>
      )}
    </WorkspacePageShell>
  );
}

// Re-export for legacy usages (MeSecretsPage was once a personal-secrets page;
// during v26 the surface moved to workspace BYOK keys).
export function MeSecretsPage() {
  return <SettingsByokKeysPage />;
}

// ---------- Icon ----------
function LockIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

// ---------- Date helper ----------
function relativeDate(iso: string): string {
  try {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    if (days < 365) return `${Math.floor(days / 30)} months ago`;
    return `${Math.floor(days / 365)} years ago`;
  } catch { return iso; }
}

// ---------- Styles ----------
import type { CSSProperties } from 'react';

const errorStyle: CSSProperties = {
  background: 'var(--danger-soft, #fdf1ec)',
  border: '1px solid var(--danger-border, #f0d5c9)',
  color: 'var(--danger, #c44a2b)',
  padding: '10px 14px',
  borderRadius: 8,
  fontSize: 13,
  marginBottom: 16,
};

const emptyStyle: CSSProperties = {
  border: '1px dashed var(--line)',
  borderRadius: 14,
  padding: '28px 22px',
  background: 'var(--card)',
  textAlign: 'center',
  color: 'var(--muted)',
  fontSize: 14,
  lineHeight: 1.5,
  marginBottom: 10,
};

const keyCardStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr) auto',
  gap: 16,
  alignItems: 'center',
  padding: '18px 20px',
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 14,
  marginBottom: 10,
  boxShadow: '0 1px 0 rgba(17,24,39,0.03)',
};

const keyCardIconStyle: CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 11,
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const keyCardNameStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--ink)',
};

const keyCardValStyle: CSSProperties = {
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: 11.5,
  color: 'var(--muted)',
  marginTop: 3,
};

const resourceControlsStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  flexWrap: 'wrap',
  marginTop: 8,
};

const pillAccentStyle: CSSProperties = {
  fontSize: 10.5,
  padding: '2px 7px',
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  borderRadius: 5,
  fontWeight: 600,
  border: '1px solid var(--accent-border, #d1fae5)',
};

const pillNeutralStyle: CSSProperties = {
  fontSize: 10.5,
  padding: '2px 7px',
  background: 'var(--bg)',
  color: 'var(--muted)',
  borderRadius: 5,
  fontWeight: 600,
  border: '1px solid var(--line)',
};

const cardActionsStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  flexShrink: 0,
};

const addFormStyle: CSSProperties = {
  padding: '14px 16px',
  border: '1px solid var(--line)',
  borderRadius: 10,
  background: 'var(--bg)',
  marginBottom: 14,
};

const addRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  alignItems: 'center',
};

const textInputStyle: CSSProperties = {
  padding: '9px 12px',
  border: '1px solid var(--line)',
  borderRadius: 8,
  fontSize: 13,
  background: 'var(--card)',
  color: 'var(--ink)',
  fontFamily: 'inherit',
  minWidth: 0,
};

const dashedAddStyle: CSSProperties = {
  padding: '18px 20px',
  border: '1.5px dashed var(--line-hover, #d5d5d0)',
  borderRadius: 14,
  background: 'var(--bg)',
  textAlign: 'center',
  color: 'var(--muted)',
  fontSize: 13,
  marginTop: 4,
};

const inlineLinkStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--accent)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  padding: 0,
};

const btnAccentStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 14px',
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  flexShrink: 0,
};

const btnAccentDisabledStyle: CSSProperties = {
  ...btnAccentStyle,
  cursor: 'not-allowed',
  opacity: 0.5,
};

const btnSecondaryStyle: CSSProperties = {
  padding: '7px 12px',
  background: 'var(--card)',
  color: 'var(--ink)',
  border: '1px solid var(--line)',
  borderRadius: 8,
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  flexShrink: 0,
};

const btnDangerStyle: CSSProperties = {
  padding: '7px 12px',
  background: 'transparent',
  color: 'var(--danger, #c44a2b)',
  border: '1px solid var(--line)',
  borderRadius: 8,
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  flexShrink: 0,
};
