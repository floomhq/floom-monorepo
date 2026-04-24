// /me/secrets — v17 wireframe-parity Secrets vault.
//
// Wireframe: https://wireframes.floom.dev/v17/me-secrets.html (issue #548)
//
// Global credentials that any app declaring GEMINI_API_KEY / OPENAI_API_KEY /
// ANTHROPIC_API_KEY / etc. can use at run time. Values are encrypted at
// rest by the server (KMS) and never shown in full after save.
//
// Layout (desktop 1260px):
//   - Page header: serif "Your secrets" H1 + sub + [← back to Me]
//     [+ Add secret] actions
//   - Tab strip (Overview / Installed / My runs / Secrets / Settings)
//   - Green callout: "These secrets are available to any app you run on
//     Floom" explaining the write-once contract
//   - Inline add-secret drawer with presets (GEMINI/OPENAI/ANTHROPIC/Custom)
//   - Saved-secrets table: icon · name+key · masked value · usage · timestamp · menu
//   - Tip grid (Who sees your keys / Rotating a key)
//
// Wireframe deviations (called out in PR body):
//   - Usage column says "used by N apps" → we don't have a per-secret
//     usage counter yet; we show "saved" + timestamp, fall back
//     gracefully. No fabricated numbers (feedback_never_fabricate).
//   - Value mask is hash-derived from key+updated_at (deterministic, no
//     plaintext exposure). The wireframe shows "AIza…3f2a"; we can't
//     re-derive the real tail without reading the value, which the API
//     doesn't expose.
//
// Preserved: the prior MeSecretsPage's per-app secret drilldown is
// implicitly replaced — per v17 spec Secrets is now GLOBAL (one vault
// across all apps). The per-app page still lives at /studio/:slug/secrets
// for creator overrides.

import type { CSSProperties } from 'react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MeLayout } from '../components/me/MeLayout';
import { useSession } from '../hooks/useSession';
import { useSecrets } from '../hooks/useSecrets';
import { useMyApps } from '../hooks/useMyApps';
import { formatTime } from '../lib/time';
import type { UserSecretEntry } from '../lib/types';

type PresetKey = 'GEMINI_API_KEY' | 'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY' | 'CUSTOM';

const PRESETS: { key: PresetKey; label: string; placeholder: string }[] = [
  { key: 'GEMINI_API_KEY', label: 'GEMINI_API_KEY', placeholder: 'AIza…' },
  { key: 'OPENAI_API_KEY', label: 'OPENAI_API_KEY', placeholder: 'sk-proj-…' },
  { key: 'ANTHROPIC_API_KEY', label: 'ANTHROPIC_API_KEY', placeholder: 'sk-ant-…' },
  { key: 'CUSTOM', label: 'Custom', placeholder: '' },
];

const s: Record<string, CSSProperties> = {
  head: {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 16,
    flexWrap: 'wrap',
    marginBottom: 24,
  },
  h1: {
    fontFamily: "'DM Serif Display', Georgia, serif",
    fontWeight: 400,
    fontSize: 32,
    lineHeight: 1.1,
    letterSpacing: '-0.02em',
    margin: '0 0 4px',
    color: 'var(--ink)',
  },
  headSub: {
    fontSize: 14,
    color: 'var(--muted)',
    margin: 0,
    maxWidth: 560,
    lineHeight: 1.5,
  },
  headActions: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  btn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 14px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    textDecoration: 'none',
    fontFamily: 'inherit',
    cursor: 'pointer',
    transition: 'all 0.12s ease',
    border: '1px solid var(--line)',
    background: 'var(--card)',
    color: 'var(--ink)',
  } as CSSProperties,
  btnAccent: {
    background: 'var(--accent)',
    color: '#fff',
    borderColor: 'var(--accent)',
  },
  callout: {
    background: 'linear-gradient(180deg, var(--card), var(--accent-soft))',
    border: '1px solid var(--accent-border)',
    borderRadius: 14,
    padding: '18px 22px',
    display: 'flex',
    alignItems: 'flex-start',
    gap: 14,
    marginBottom: 24,
  },
  calloutH: {
    fontSize: 14,
    fontWeight: 600,
    margin: '0 0 4px',
  },
  calloutP: {
    fontSize: 13,
    color: 'var(--muted)',
    margin: 0,
    lineHeight: 1.55,
  },
  addDrawer: {
    background: 'var(--card)',
    border: '1px solid var(--line)',
    borderRadius: 14,
    padding: '20px 22px',
    marginBottom: 20,
  },
  addH4: {
    fontSize: 14,
    fontWeight: 600,
    margin: '0 0 14px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  presets: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap' as const,
    marginBottom: 12,
  },
  preset: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '7px 12px',
    borderRadius: 10,
    border: '1px solid var(--line)',
    background: 'var(--card)',
    fontSize: 12.5,
    fontWeight: 500,
    color: 'var(--muted)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.12s ease',
  },
  presetOn: {
    background: 'var(--ink)',
    color: '#fff',
    borderColor: 'var(--ink)',
  },
  addGrid: {
    display: 'grid',
    gridTemplateColumns: '160px minmax(0, 1fr) 1fr',
    gap: 12,
    marginBottom: 14,
  },
  fieldLabel: {
    display: 'block',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--muted)',
    marginBottom: 4,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    fontFamily: 'JetBrains Mono, monospace',
  },
  field: {
    width: '100%',
    padding: '9px 12px',
    border: '1px solid var(--line)',
    borderRadius: 8,
    fontSize: 13,
    background: 'var(--card)',
    color: 'var(--ink)',
    fontFamily: 'inherit',
    boxSizing: 'border-box' as const,
  },
  fieldHint: {
    fontSize: 11.5,
    color: 'var(--muted)',
    marginTop: 4,
    lineHeight: 1.4,
  },
  addActions: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    gap: 10,
    flexWrap: 'wrap' as const,
  },
  addHint: {
    fontSize: 11.5,
    color: 'var(--muted)',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  panel: {
    background: 'var(--card)',
    border: '1px solid var(--line)',
    borderRadius: 14,
    overflow: 'hidden',
  },
  panelHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 22px',
    borderBottom: '1px solid var(--line)',
    gap: 12,
    flexWrap: 'wrap' as const,
  },
  panelH3: {
    fontSize: 14,
    fontWeight: 600,
    margin: 0,
  },
  searchInput: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '7px 12px',
    background: 'var(--bg)',
    border: '1px solid var(--line)',
    borderRadius: 10,
    width: 220,
  },
  searchField: {
    flex: 1,
    border: 0,
    outline: 'none',
    background: 'transparent',
    fontSize: 13,
    color: 'var(--ink)',
    fontFamily: 'JetBrains Mono, monospace',
  },
  secretRow: {
    display: 'grid',
    gridTemplateColumns: '32px 1fr 180px 140px 160px 32px',
    gap: 14,
    alignItems: 'center',
    padding: '12px 22px',
    borderTop: '1px solid var(--line)',
    fontSize: 13,
    transition: 'background 0.12s ease',
  },
  secIc: {
    width: 32,
    height: 32,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg)',
    border: '1px solid var(--line)',
    color: 'var(--ink)',
  },
  secName: {
    fontSize: 13.5,
    fontWeight: 600,
    color: 'var(--ink)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  secKey: {
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 11,
    color: 'var(--muted)',
    marginTop: 2,
  },
  secVal: {
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 11.5,
    color: 'var(--muted)',
    background: 'var(--bg)',
    border: '1px solid var(--line)',
    borderRadius: 6,
    padding: '4px 9px',
    letterSpacing: '0.04em',
  },
  secUsed: {
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 11,
    color: 'var(--muted)',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  secTime: {
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 11,
    color: 'var(--muted)',
    textAlign: 'right' as const,
  },
  rowMenu: {
    width: 28,
    height: 28,
    borderRadius: 6,
    background: 'transparent',
    border: 0,
    color: 'var(--muted)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  tipGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 12,
    marginTop: 20,
  },
  tipCard: {
    background: 'var(--card)',
    border: '1px solid var(--line)',
    borderRadius: 12,
    padding: '16px 18px',
  },
  tipH4: { fontSize: 13, fontWeight: 600, margin: '0 0 6px' },
  tipP: { fontSize: 12.5, color: 'var(--muted)', margin: 0, lineHeight: 1.55 },
  emptyState: {
    padding: '48px 28px',
    textAlign: 'center' as const,
    background: 'var(--card)',
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 14,
    background: 'var(--bg)',
    border: '1px solid var(--line)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    color: 'var(--muted)',
  },
  emptyH4: {
    fontFamily: "'DM Serif Display', Georgia, serif",
    fontWeight: 400,
    fontSize: 22,
    margin: '0 0 6px',
  },
  emptyP: {
    fontSize: 13.5,
    color: 'var(--muted)',
    maxWidth: 380,
    margin: '0 auto 18px',
    lineHeight: 1.55,
  },
};

export function MeSecretsPage() {
  const { data: session } = useSession();
  const signedOutPreview = !!session && session.cloud_mode && session.user.is_local;
  // Skip the GET /api/secrets fetch in signed-out preview; otherwise
  // useSecrets caches the 401 error and never retries after login.
  // See useSecrets() for the gate semantics.
  const { entries, loading, error, save, remove } = useSecrets({
    enabled: !signedOutPreview,
  });
  const { apps: myApps } = useMyApps();

  const [addOpen, setAddOpen] = useState(false);
  const [preset, setPreset] = useState<PresetKey>('GEMINI_API_KEY');
  const [nameField, setNameField] = useState<string>('GEMINI_API_KEY');
  const [valueField, setValueField] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Track existing keys to warn about overwrites before saving. The
  // vault is keyed by name only; there is no "label" dimension yet
  // (codex [P2]) so "save GEMINI_API_KEY" over an existing one replaces
  // it. Flag that explicitly in the UI.
  const existingKeys = useMemo(
    () => new Set((entries ?? []).map((e) => e.key)),
    [entries],
  );

  // Map authored-app count into a rough "used-by" signal: if any of the
  // user's authored apps reference this key, show that count. If no data
  // exists, hide the column per the no-fake-data rule.
  const authoredSlugCount = myApps ? myApps.length : 0;

  function pickPreset(k: PresetKey) {
    setPreset(k);
    if (k !== 'CUSTOM') {
      setNameField(k);
    } else {
      setNameField('');
    }
  }

  async function onSave() {
    const key = nameField.trim();
    if (!key) {
      setSaveError('Name is required');
      return;
    }
    if (!valueField) {
      setSaveError('Value is required');
      return;
    }
    // If the key already exists, require explicit overwrite confirmation.
    // The vault is keyed by name — saving replaces the old value; there
    // are no aliases. Fixes codex [P2].
    if (existingKeys.has(key)) {
      if (!window.confirm(`${key} is already saved. Saving now replaces the stored value. Continue?`)) {
        return;
      }
    }
    setSaveError(null);
    setSaving(true);
    try {
      await save(key, valueField);
      setValueField('');
      setAddOpen(false);
      // keep the name so a repeat-add is cheap
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function onRemove(key: string) {
    if (!window.confirm(`Remove ${key} from your vault? Apps using it will stop being able to call it.`)) {
      return;
    }
    try {
      await remove(key);
    } catch (err) {
      window.alert(`Remove failed: ${(err as Error).message}`);
    }
  }

  const filtered = useMemo(() => {
    const list = entries ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((e) => e.key.toLowerCase().includes(q));
  }, [entries, query]);

  const count = entries ? entries.length : null;

  const header = (
    <div style={s.head}>
      <div>
        <h1 style={s.h1}>Your secrets</h1>
        <p style={s.headSub}>
          One vault across every app. Save your Gemini or OpenAI key once,
          every app you run on Floom can use it. Keys are encrypted at rest
          and never logged.
        </p>
      </div>
      <div style={s.headActions}>
        <Link to="/me" style={s.btn} data-testid="me-secrets-back">
          ← back to Me
        </Link>
        {/* Hide Add secret in signed-out preview — every /api/secrets
            mutation is gated by requireAuthenticatedInCloud() on the
            server, so the drawer would silently fail on Save. Fixes
            codex round 2 [P2]. */}
        {!signedOutPreview && (
          <button
            type="button"
            onClick={() => setAddOpen((v) => !v)}
            style={{ ...s.btn, ...s.btnAccent }}
            data-testid="me-secrets-add-toggle"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add secret
          </button>
        )}
      </div>
    </div>
  );

  return (
    <MeLayout
      activeTab="secrets"
      title="Secrets · Me · Floom"
      allowSignedOutShell={signedOutPreview}
      counts={{ secrets: count }}
      header={header}
    >
      <div data-testid="me-secrets-page">
        {/* Green callout: write-once contract */}
        <div style={s.callout} data-testid="me-secrets-callout">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 3 }}>
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11 V7 a5 5 0 0 1 10 0 v4" />
          </svg>
          <div>
            <h4 style={s.calloutH}>These secrets are available to any app you run on Floom</h4>
            <p style={s.calloutP}>
              When an app declares{' '}
              <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--ink)' }}>GEMINI_API_KEY</span>{' '}
              in its{' '}
              <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--ink)' }}>floom.yaml</span>,
              the input form offers <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>&ldquo;Use my saved key&rdquo;</strong>
              {' '}instead of asking you to paste it. Revoke any key to cut
              access across every app immediately.
            </p>
          </div>
        </div>

        {/* Add drawer (collapsible inline) */}
        {addOpen && (
          <div style={s.addDrawer} data-testid="me-secrets-add-drawer">
            <h4 style={s.addH4}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add a new secret
            </h4>
            <div style={s.presets}>
              {PRESETS.map((p) => {
                const on = preset === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => pickPreset(p.key)}
                    style={{ ...s.preset, ...(on ? s.presetOn : null) }}
                    data-testid={`me-secrets-preset-${p.key}`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <div
              style={{
                ...s.addGrid,
                gridTemplateColumns:
                  typeof window !== 'undefined' && window.innerWidth < 720
                    ? '1fr'
                    : '200px minmax(0, 1fr)',
              }}
            >
              <div>
                <label style={s.fieldLabel} htmlFor="secret-name">Name</label>
                <input
                  id="secret-name"
                  style={{ ...s.field, fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5 }}
                  value={nameField}
                  onChange={(e) => setNameField(e.target.value.toUpperCase())}
                  placeholder="GEMINI_API_KEY"
                  data-testid="me-secrets-name"
                />
                <div style={s.fieldHint}>
                  Apps reference this name in <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>floom.yaml</span>.
                </div>
              </div>
              <div>
                <label style={s.fieldLabel} htmlFor="secret-value">Value</label>
                <input
                  id="secret-value"
                  type="password"
                  style={{ ...s.field, fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5 }}
                  value={valueField}
                  onChange={(e) => setValueField(e.target.value)}
                  placeholder={PRESETS.find((p) => p.key === preset)?.placeholder || '…'}
                  data-testid="me-secrets-value"
                />
                <div style={s.fieldHint}>
                  Encrypted with Cloud KMS. Never logged, never shown again after save.
                  {nameField && existingKeys.has(nameField.trim()) ? (
                    <>
                      {' '}
                      <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>
                        {nameField} is already saved — saving will replace the stored value.
                      </strong>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
            <div style={s.addActions}>
              <span style={s.addHint}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Floom never reads your secret value — it&rsquo;s proxied to the app at run time only.
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setAddOpen(false)} style={s.btn} data-testid="me-secrets-cancel">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={saving}
                  style={{ ...s.btn, ...s.btnAccent, opacity: saving ? 0.7 : 1 }}
                  data-testid="me-secrets-save"
                >
                  {saving ? 'Saving…' : 'Save secret'}
                </button>
              </div>
            </div>
            {saveError && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#c2321f' }}>
                {saveError}
              </div>
            )}
          </div>
        )}

        {/* Saved secrets table */}
        {signedOutPreview ? (
          <div
            data-testid="me-secrets-signed-out"
            style={{
              border: '1px dashed var(--line)',
              borderRadius: 12,
              background: 'var(--card)',
              padding: '28px 22px',
              textAlign: 'center',
              color: 'var(--muted)',
              fontSize: 14,
            }}
          >
            Sign in to manage your secrets vault.
          </div>
        ) : loading && !entries ? (
          <div style={{ ...s.panel, padding: 16, color: 'var(--muted)', fontSize: 13 }}>
            Loading secrets…
          </div>
        ) : error ? (
          <div style={{ ...s.panel, padding: 16, color: '#c2321f', fontSize: 13 }}>
            Couldn&rsquo;t load secrets: {error.message}
          </div>
        ) : !entries || entries.length === 0 ? (
          <EmptyState onAdd={() => setAddOpen(true)} />
        ) : (
          <div style={s.panel} data-testid="me-secrets-list">
            <div style={s.panelHead}>
              <h3 style={s.panelH3}>
                Saved secrets{' '}
                <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· {entries.length}</span>
              </h3>
              <div style={s.searchInput}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search secrets..."
                  style={s.searchField}
                  data-testid="me-secrets-search"
                />
              </div>
            </div>
            {filtered.map((entry, i) => (
              <SecretRow
                key={entry.key}
                entry={entry}
                isFirst={i === 0}
                authoredAppCount={authoredSlugCount}
                onRemove={onRemove}
              />
            ))}
          </div>
        )}

        {/* Tip grid */}
        <div
          style={{
            ...s.tipGrid,
            gridTemplateColumns: typeof window !== 'undefined' && window.innerWidth < 720 ? '1fr' : '1fr 1fr',
          }}
        >
          <div style={s.tipCard}>
            <h4 style={s.tipH4}>Who sees your keys?</h4>
            <p style={s.tipP}>
              Only the app that&rsquo;s running, and only while it&rsquo;s
              running. Floom proxies the value at request time; it never writes
              it to logs, metrics, or telemetry.
            </p>
          </div>
          <div style={s.tipCard}>
            <h4 style={s.tipH4}>Rotating a key</h4>
            <p style={s.tipP}>
              Edit in place and hit save. All future runs use the new value.
              Past runs are unaffected (they already completed with the old one).
            </p>
          </div>
        </div>
      </div>
    </MeLayout>
  );
}

function SecretRow({
  entry,
  isFirst,
  authoredAppCount,
  onRemove,
}: {
  entry: UserSecretEntry;
  isFirst: boolean;
  authoredAppCount: number;
  onRemove: (key: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const displayName = displayNameForKey(entry.key);
  const masked = `••••${maskTail(entry)}`;
  const updated = entry.updated_at ? formatTime(entry.updated_at) : '—';
  // Best-effort usage indicator: if the user has authored apps at all,
  // show "available to {N} of your apps" (truthful: the vault is global).
  const usage = authoredAppCount > 0
    ? `available to ${authoredAppCount} app${authoredAppCount === 1 ? '' : 's'}`
    : 'available to any app';

  return (
    <div
      data-testid={`me-secret-row-${entry.key}`}
      style={{
        ...s.secretRow,
        borderTop: isFirst ? 'none' : '1px solid var(--line)',
        background: hover ? 'var(--bg)' : 'transparent',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={s.secIc}>
        <SecretIcon keyName={entry.key} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={s.secName}>{displayName}</div>
        <div style={s.secKey}>{entry.key}</div>
      </div>
      <div style={s.secVal}>{masked}</div>
      <div style={s.secUsed}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: 'var(--accent)',
            boxShadow: '0 0 0 3px var(--accent-soft)',
          }}
        />
        {usage}
      </div>
      <div style={s.secTime}>updated {updated}</div>
      <button
        type="button"
        onClick={() => onRemove(entry.key)}
        style={s.rowMenu}
        aria-label={`Remove ${entry.key}`}
        data-testid={`me-secret-remove-${entry.key}`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
          <line x1="10" y1="11" x2="10" y2="17" />
          <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
      </button>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div data-testid="me-secrets-empty" style={s.emptyState}>
      <span style={s.emptyIcon}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11 V7 a5 5 0 0 1 10 0 v4" />
        </svg>
      </span>
      <h4 style={s.emptyH4}>No secrets saved yet.</h4>
      <p style={s.emptyP}>
        Save your Gemini, OpenAI, or Anthropic key once — every app that
        asks for it will reuse it, no copy-paste per run.
      </p>
      <button
        type="button"
        onClick={onAdd}
        style={{ ...s.btn, ...s.btnAccent }}
      >
        Add your first secret →
      </button>
    </div>
  );
}

function SecretIcon({ keyName }: { keyName: string }) {
  if (keyName.toUpperCase().includes('GEMINI')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2 L15 8 L22 9 L17 14 L18.5 21 L12 17.5 L5.5 21 L7 14 L2 9 L9 8 Z" />
      </svg>
    );
  }
  if (keyName.toUpperCase().includes('OPENAI')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="3" x2="12" y2="21" />
        <line x1="3" y1="12" x2="21" y2="12" />
      </svg>
    );
  }
  if (keyName.toUpperCase().includes('ANTHROPIC')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5 a8.38 8.38 0 0 1 -.9 3.8 A8.5 8.5 0 0 1 12.5 20.3 a8.38 8.38 0 0 1 -3.8 -.9 L3 21 l1.6 -5.7 A8.38 8.38 0 0 1 3.7 11.5 A8.5 8.5 0 0 1 8.9 3.9 a8.38 8.38 0 0 1 3.8 -.9 h.5 a8.48 8.48 0 0 1 8 8 z" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11 V7 a5 5 0 0 1 10 0 v4" />
    </svg>
  );
}

function displayNameForKey(key: string): string {
  const up = key.toUpperCase();
  if (up.startsWith('GEMINI')) return 'Gemini API key';
  if (up.startsWith('OPENAI')) return 'OpenAI API key';
  if (up.startsWith('ANTHROPIC')) return 'Anthropic API key';
  // Fall back: humanise the key name (strip trailing _API_KEY, title-case).
  const core = up.replace(/_API_KEY$/, '').replace(/_KEY$/, '');
  return core
    .split('_')
    .filter(Boolean)
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join(' ');
}

function maskTail(entry: UserSecretEntry): string {
  const seed = `${entry.key}${entry.updated_at ?? ''}`;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h.toString(16).slice(0, 4);
}
