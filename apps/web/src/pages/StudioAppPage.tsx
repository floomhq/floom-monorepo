// /studio/:slug — Studio per-app Overview. Creator workspace view of
// an owned app.
//
// Wave-3b: rebuilt overview content per v26 wireframe (studio-app-overview.html).
// Layout: App meta strip + 2-col panels (Traffic sparkline, App meta,
// Top errors, Where it runs). Operational controls (visibility, primary
// action, danger zone) kept below.
//
// Data notes:
//   - Traffic sparkline: getAppRunsByDay(slug, 14) — endpoint exists, returns
//     {days: [{date, count}]}.
//   - Top errors: derived from getAppRuns(slug, 50).runs filtered by error field.
//   - Where it runs: CreatorRun has no source_label field. Panel renders empty
//     state with TODO until backend exposes it.
//     // TODO: wire to run.source_label when backend exposes it on CreatorRun
//
// Access-gated: non-owners are redirected to /p/:slug (the public page).

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { WorkspacePageShell } from '../components/WorkspacePageShell';
import { StudioAppTabs } from '../components/StudioAppTabs';
import * as api from '../api/client';
import { refreshMyApps } from '../hooks/useMyApps';
import type { AppDetail, CreatorRun } from '../lib/types';
import { formatTime } from '../lib/time';

export function StudioAppPage() {
  const { slug } = useParams<{ slug: string }>();
  const nav = useNavigate();
  const [app, setApp] = useState<AppDetail | null>(null);
  const [runs, setRuns] = useState<CreatorRun[] | null>(null);
  const [runsByDay, setRunsByDay] = useState<Array<{ date: string; count: number }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Issue #129: visibility toggle. Optimistic update so the pill flips
  // before the round-trip lands. Failure reverts it.
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [visibilityError, setVisibilityError] = useState<string | null>(null);
  // Audit 2026-04-20 (Fix 3): primary-action control.
  const [primaryActionBusy, setPrimaryActionBusy] = useState(false);
  const [primaryActionError, setPrimaryActionError] = useState<string | null>(null);

  async function handleDelete() {
    if (!app) return;
    if (confirmInput !== app.slug) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteApp(app.slug);
      await refreshMyApps();
      nav('/studio', { replace: true });
    } catch (err) {
      setDeleteError((err as Error).message || 'Delete failed');
      setDeleting(false);
    }
  }

  async function handleVisibilityChange(next: 'public' | 'private') {
    if (!app || visibilityBusy || app.visibility === next) return;
    const previous = app.visibility;
    setVisibilityBusy(true);
    setVisibilityError(null);
    setApp({ ...app, visibility: next });
    try {
      await api.updateAppVisibility(app.slug, next);
      await refreshMyApps();
    } catch (err) {
      setApp({ ...app, visibility: previous });
      setVisibilityError((err as Error).message || 'Could not update visibility');
    } finally {
      setVisibilityBusy(false);
    }
  }

  async function handlePrimaryActionChange(next: string) {
    if (!app || primaryActionBusy) return;
    const serverValue = next === '' ? null : next;
    const previous = app.manifest.primary_action ?? '';
    if (previous === next) return;
    setPrimaryActionBusy(true);
    setPrimaryActionError(null);
    const optimistic = {
      ...app,
      manifest: {
        ...app.manifest,
        primary_action: serverValue ?? undefined,
      },
    };
    setApp(optimistic);
    try {
      await api.updateAppPrimaryAction(app.slug, serverValue);
    } catch (err) {
      setApp(app);
      setPrimaryActionError(
        (err as Error).message || 'Could not update primary action',
      );
    } finally {
      setPrimaryActionBusy(false);
    }
  }

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setApp(null);
    setRuns(null);
    setRunsByDay(null);
    setError(null);
    api
      .getApp(slug)
      .then((res) => {
        if (cancelled) return;
        setApp(res);
      })
      .catch((err) => {
        if (cancelled) return;
        const status = (err as { status?: number }).status;
        if (status === 404) {
          const q = new URLSearchParams({ notice: 'app_not_found' });
          if (slug) q.set('slug', slug);
          nav(`/studio?${q.toString()}`, { replace: true });
          return;
        }
        if (status === 403) {
          nav(`/p/${slug}`, { replace: true });
          return;
        }
        setError((err as Error).message || 'Failed to load app');
      });
    api
      .getAppRuns(slug, 50)
      .then((res) => {
        if (!cancelled) setRuns(res.runs);
      })
      .catch(() => {
        if (!cancelled) setRuns([]);
      });
    api
      .getAppRunsByDay(slug, 14)
      .then((res) => {
        if (!cancelled) setRunsByDay(res.days);
      })
      .catch(() => {
        if (!cancelled) setRunsByDay([]);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, nav]);

  return (
    <WorkspacePageShell
      mode="studio"
      title={app ? `${app.name} · Studio` : 'App · Studio'}
    >
      <StudioAppTabs slug={slug ?? ''} activeTab="overview" />
      {error && (
        <div
          data-testid="studio-app-error"
          style={{
            background: '#fdecea',
            border: '1px solid #f4b7b1',
            color: '#c2321f',
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 20,
          }}
        >
          {error}
        </div>
      )}
      {!app && !error && <LoadingSkeleton />}
      {app && (
        <div data-testid="studio-app-overview">

          {/* ── App meta strip ── */}
          <AppMetaStrip app={app} />

          {/* ── 2-col row 1: Traffic + App meta ── */}
          <div style={grid2}>
            <TrafficPanel runsByDay={runsByDay} />
            <AppMetaPanel app={app} />
          </div>

          {/* ── 2-col row 2: Top errors + Where it runs ── */}
          <div style={{ ...grid2, marginTop: 14 }}>
            <TopErrorsPanel runs={runs} />
            <WhereItRunsPanel runs={runs} />
          </div>

          {/* ── Recent runs (last 5) ── */}
          <h2 style={sectionHeader}>Recent runs</h2>
          {!runs && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</div>}
          {runs && runs.length === 0 && (
            <div
              data-testid="studio-app-runs-empty"
              style={emptyState}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
                No runs yet
              </div>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
                Share <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>/p/{app.slug}</code> to drive your first run.
              </p>
            </div>
          )}
          {runs && runs.length > 0 && (
            <RunTable runs={runs.slice(0, 5)} />
          )}
          {runs && runs.length > 5 && (
            <div style={{ marginTop: 12 }}>
              <Link to={`/studio/${app.slug}/runs`} style={{ color: 'var(--accent)', fontSize: 13 }}>
                View all runs →
              </Link>
            </div>
          )}

          {/* ── Visibility ── */}
          {/* Issue #129 (2026-04-19): visibility toggle. Public/Private binary.
              auth-required is kept available through the server API but not
              exposed here — the 95% case is the public/private binary. */}
          <h2 style={sectionHeader}>Visibility</h2>
          <section
            data-testid="studio-app-visibility"
            style={{
              marginBottom: 32,
              border: '1px solid var(--line)',
              borderRadius: 10,
              background: 'var(--card)',
              padding: 20,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                marginBottom: 12,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Who can run this app?</span>
              <VisibilityPill
                value={
                  app.visibility === 'private' ? 'private' : app.visibility === 'auth-required' ? 'auth-required' : 'public'
                }
              />
            </div>
            <StudioVisibilityChooser
              value={app.visibility === 'private' ? 'private' : 'public'}
              onChange={handleVisibilityChange}
              busy={visibilityBusy}
              authRequired={app.visibility === 'auth-required'}
            />
            {visibilityError && (
              <p
                data-testid="studio-app-visibility-error"
                style={{ margin: '12px 0 0', fontSize: 12, color: '#c2321f' }}
              >
                {visibilityError}
              </p>
            )}
          </section>

          {/* ── Primary action (multi-action apps only) ── */}
          {/* Audit 2026-04-20 (Fix 3): primary-action pin. Hidden for ≤1 actions. */}
          {Object.keys(app.manifest.actions).length > 1 && (
            <>
              <h2 style={sectionHeader}>Primary action</h2>
              <section
                data-testid="studio-app-primary-action"
                style={{
                  marginBottom: 32,
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  background: 'var(--card)',
                  padding: 20,
                }}
              >
                <p
                  style={{
                    margin: '0 0 12px',
                    fontSize: 13,
                    color: 'var(--muted)',
                    lineHeight: 1.55,
                    maxWidth: 620,
                  }}
                >
                  Pick the action users should land on by default. Shows as
                  an active tab with a "Primary" pill on /p/{app.slug}.
                  Leave on "First action" to keep the default behavior.
                </p>
                <label
                  style={{
                    display: 'block',
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--ink)',
                    marginBottom: 6,
                  }}
                >
                  Primary action
                </label>
                <select
                  data-testid="studio-app-primary-action-select"
                  value={app.manifest.primary_action ?? ''}
                  disabled={primaryActionBusy}
                  onChange={(e) => handlePrimaryActionChange(e.target.value)}
                  style={{
                    width: '100%',
                    maxWidth: 360,
                    padding: '10px 12px',
                    border: '1px solid var(--line)',
                    borderRadius: 8,
                    background: 'var(--card)',
                    fontSize: 14,
                    color: 'var(--ink)',
                    fontFamily: 'inherit',
                    cursor: primaryActionBusy ? 'wait' : 'pointer',
                  }}
                >
                  <option value="">First action (default)</option>
                  {Object.entries(app.manifest.actions).map(([key, spec]) => (
                    <option key={key} value={key}>
                      {spec.label || key}
                    </option>
                  ))}
                </select>
                {primaryActionError && (
                  <p
                    data-testid="studio-app-primary-action-error"
                    style={{ margin: '12px 0 0', fontSize: 12, color: '#c2321f' }}
                  >
                    {primaryActionError}
                  </p>
                )}
              </section>
            </>
          )}

          {/* ── Danger zone ── */}
          {/* DELETE /api/me/apps/:slug; runs cascade via FK. */}
          <section
            data-testid="studio-app-danger-zone"
            style={{
              marginTop: 48,
              border: '1px solid var(--line)',
              borderRadius: 10,
              background: 'var(--card)',
              padding: 20,
            }}
          >
            <h2
              style={{
                fontSize: 12,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--muted)',
                margin: '0 0 12px',
              }}
            >
              Danger zone
            </h2>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
                  Delete this app
                </div>
                <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
                  Removes <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>/p/{app.slug}</code> from the store and drops all run history. Cannot be undone.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setConfirmOpen(true);
                  setConfirmInput('');
                  setDeleteError(null);
                }}
                data-testid="studio-app-delete-trigger"
                style={{
                  padding: '8px 14px',
                  background: 'transparent',
                  color: 'var(--muted)',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Delete this app
              </button>
            </div>
          </section>
        </div>
      )}

      {/* ── Delete confirmation modal ── */}
      {confirmOpen && app && (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="studio-app-delete-modal"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => !deleting && setConfirmOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--card)',
              borderRadius: 12,
              padding: 24,
              maxWidth: 440,
              width: '100%',
            }}
          >
            <h3 style={{ margin: '0 0 8px', fontSize: 16, color: 'var(--ink)' }}>
              Delete {app.slug}?
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--muted)', lineHeight: 1.55 }}>
              This removes the app from the store and drops run history. Cannot be undone.
              Type <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>{app.slug}</code> to confirm.
            </p>
            <input
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              autoFocus
              data-testid="studio-app-delete-confirm-input"
              aria-label="Type app slug to confirm"
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid var(--line)',
                borderRadius: 8,
                background: 'var(--card)',
                fontSize: 14,
                fontFamily: 'JetBrains Mono, monospace',
                color: 'var(--ink)',
                boxSizing: 'border-box',
              }}
            />
            {deleteError && (
              <div
                data-testid="studio-app-delete-error"
                style={{
                  marginTop: 10,
                  fontSize: 12,
                  color: '#c2321f',
                }}
              >
                {deleteError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                type="button"
                onClick={() => {
                  setConfirmOpen(false);
                  setConfirmInput('');
                }}
                disabled={deleting}
                style={{
                  padding: '8px 16px',
                  background: 'transparent',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  fontSize: 13,
                  color: 'var(--muted)',
                  cursor: deleting ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={confirmInput !== app.slug || deleting}
                data-testid="studio-app-delete-submit"
                style={{
                  padding: '8px 16px',
                  background: 'transparent',
                  color: '#a02818',
                  border: '1px solid #c2321f',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: confirmInput === app.slug && !deleting ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit',
                  opacity: confirmInput === app.slug && !deleting ? 1 : 0.5,
                }}
              >
                {deleting ? 'Deleting...' : 'Delete forever'}
              </button>
            </div>
          </div>
        </div>
      )}
    </WorkspacePageShell>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Overview panels
// ──────────────────────────────────────────────────────────────────────────────

/** Compact mono strip showing key app metadata below the tab bar. */
function AppMetaStrip({ app }: { app: AppDetail }) {
  return (
    <div
      data-testid="studio-app-meta-strip"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: 'var(--bg)',
        border: '1px solid var(--line)',
        borderRadius: 10,
        padding: '9px 12px',
        marginBottom: 16,
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
        color: 'var(--muted)',
        flexWrap: 'wrap',
        overflowX: 'auto',
      }}
    >
      <strong style={{ color: 'var(--ink)' }}>{app.slug}</strong>
      {app.version && <span>{app.version}</span>}
      <span>{app.runtime}</span>
      <span style={{ color: app.visibility === 'public' ? 'var(--accent)' : undefined }}>
        {app.visibility ?? 'private'}
      </span>
      <span style={{ flex: 1 }} />
      <span>floom.dev/p/{app.slug}</span>
    </div>
  );
}

/**
 * Traffic panel — 14d SVG polyline sparkline.
 * Uses an inline SVG polyline; no charting library required.
 */
function TrafficPanel({ runsByDay }: { runsByDay: Array<{ date: string; count: number }> | null }) {
  const W = 600;
  const H = 140;
  const PAD = 6;

  const bars = runsByDay ?? Array.from({ length: 14 }, () => ({ date: '', count: 0 }));
  const maxCount = bars.reduce((m, b) => (b.count > m ? b.count : m), 0);
  const loading = runsByDay === null;

  // Build SVG polyline points: left→right, bottom=0 at H-PAD, top at PAD.
  const points = bars
    .map((b, i) => {
      const x = (i / Math.max(bars.length - 1, 1)) * W;
      const ratio = maxCount > 0 ? b.count / maxCount : 0;
      const y = H - PAD - ratio * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const total = bars.reduce((s, b) => s + b.count, 0);

  return (
    <section
      data-testid="studio-traffic-panel"
      style={panelStyle}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
        <h3 style={panelHeading}>Traffic</h3>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, color: 'var(--muted)', letterSpacing: '0.04em' }}>
          last 14 days
        </span>
      </div>
      <p style={panelSub}>Runs per day</p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        aria-label={loading ? 'Loading traffic chart' : `14-day run chart, ${total} total`}
        style={{ width: '100%', height: 120, display: 'block', opacity: loading ? 0.3 : 1 }}
      >
        {/* Horizontal grid lines */}
        <g stroke="var(--line, #e8e6e0)" strokeWidth="1">
          <line x1="0" y1={H * 0.3} x2={W} y2={H * 0.3} />
          <line x1="0" y1={H * 0.6} x2={W} y2={H * 0.6} />
          <line x1="0" y1={H * 0.9} x2={W} y2={H * 0.9} />
        </g>
        {maxCount > 0 ? (
          <polyline
            points={points}
            fill="none"
            stroke="var(--accent, #047857)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          /* Flat baseline when no data */
          <line
            x1="0" y1={H - PAD} x2={W} y2={H - PAD}
            stroke="var(--line, #e8e6e0)"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
        )}
      </svg>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
        <span style={{ color: 'var(--ink)', fontWeight: 700 }}>{loading ? '—' : total}</span>
        <span style={{ color: 'var(--muted)' }}>total runs</span>
      </div>
    </section>
  );
}

/** App meta panel — key/value list from app metadata. */
function AppMetaPanel({ app }: { app: AppDetail }) {
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Slug', value: app.slug },
    { label: 'Version', value: app.version ?? '—' },
    { label: 'Runtime', value: app.runtime },
    { label: 'Visibility', value: app.visibility ?? 'private' },
    { label: 'Category', value: app.category ?? '—' },
    { label: 'Created', value: app.created_at ? formatTime(app.created_at) : '—' },
  ];

  return (
    <section
      data-testid="studio-app-meta-panel"
      style={panelStyle}
    >
      <h3 style={{ ...panelHeading, marginBottom: 12 }}>App meta</h3>
      {rows.map((r) => (
        <div
          key={r.label}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '7px 0',
            borderBottom: '1px solid var(--line)',
            fontSize: 12.5,
          }}
        >
          <span style={{ color: 'var(--muted)' }}>{r.label}</span>
          <span
            style={{
              color: r.label === 'Visibility' && r.value === 'public' ? 'var(--accent)' : 'var(--ink)',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 11.5,
              fontWeight: 500,
            }}
          >
            {r.value}
          </span>
        </div>
      ))}
    </section>
  );
}

/**
 * Top errors panel — groups runs by error message, shows top 5 by frequency.
 * Uses the already-fetched runs array (no extra request).
 */
function TopErrorsPanel({ runs }: { runs: CreatorRun[] | null }) {
  const loading = runs === null;

  // Tally errors from the loaded runs.
  const errorMap = new Map<string, { count: number; lastSeen: string }>();
  if (runs) {
    for (const r of runs) {
      if (r.status !== 'error' && r.status !== 'timeout') continue;
      const key = r.error || r.error_type || 'Unknown error';
      const prev = errorMap.get(key);
      const ts = r.started_at;
      if (!prev) {
        errorMap.set(key, { count: 1, lastSeen: ts });
      } else {
        errorMap.set(key, {
          count: prev.count + 1,
          lastSeen: ts > prev.lastSeen ? ts : prev.lastSeen,
        });
      }
    }
  }

  const sorted = Array.from(errorMap.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);

  const maxCount = sorted[0]?.[1].count ?? 1;

  return (
    <section
      data-testid="studio-top-errors-panel"
      style={panelStyle}
    >
      <h3 style={panelHeading}>Top errors · 7d</h3>
      <p style={panelSub}>What is breaking, by frequency.</p>
      {loading && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Loading…</div>
      )}
      {!loading && sorted.length === 0 && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--muted)',
            marginTop: 8,
            fontStyle: 'italic',
          }}
        >
          No errors in recent runs.
        </div>
      )}
      {sorted.map(([msg, { count, lastSeen }]) => (
        <div
          key={msg}
          style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, padding: '5px 0' }}
        >
          <span
            style={{
              width: 120,
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
            title={msg}
          >
            {msg}
          </span>
          <div
            style={{
              flex: 1,
              height: 6,
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              borderRadius: 4,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                background: 'var(--accent)',
                width: `${(count / maxCount) * 100}%`,
              }}
            />
          </div>
          <span
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 11,
              color: 'var(--muted)',
              minWidth: 24,
              textAlign: 'right',
            }}
          >
            {count}
          </span>
          {/* TODO: add link to filtered runs when /studio/:slug/runs supports error_type filter */}
        </div>
      ))}
      {!loading && runs && runs.length >= 50 && sorted.length > 0 && (
        <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
          Based on last 50 runs.
        </p>
      )}
    </section>
  );
}

/**
 * Where it runs panel — horizontal bar chart of run sources.
 *
 * NOTE: CreatorRun does not expose a source_label field as of Wave-3b.
 * The panel renders an empty state until the backend exposes it.
 * // TODO: wire to run.source_label when backend exposes it on CreatorRun
 */
function WhereItRunsPanel({ runs }: { runs: CreatorRun[] | null }) {
  const loading = runs === null;

  // TODO: wire to run.source_label when backend exposes it on CreatorRun.
  // For now, all we have is is_self (boolean). We can derive two categories
  // from that as a best-effort approximation.
  const sourceMap = new Map<string, number>();
  if (runs) {
    for (const r of runs) {
      const key = r.is_self ? 'You' : 'Other callers';
      sourceMap.set(key, (sourceMap.get(key) ?? 0) + 1);
    }
  }

  const sorted = Array.from(sourceMap.entries())
    .sort((a, b) => b[1] - a[1]);
  const maxCount = sorted[0]?.[1] ?? 1;
  const total = sorted.reduce((s, [, c]) => s + c, 0);

  return (
    <section
      data-testid="studio-where-it-runs-panel"
      style={panelStyle}
    >
      <h3 style={panelHeading}>Where it runs</h3>
      <p style={panelSub}>By caller · last 50 runs. Full source breakdown available in v1.1.</p>
      {loading && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Loading…</div>
      )}
      {!loading && sorted.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, fontStyle: 'italic' }}>
          No data yet.
        </div>
      )}
      {sorted.map(([label, count]) => (
        <div
          key={label}
          style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, padding: '5px 0' }}
        >
          <span style={{ width: 100, fontWeight: 500, flexShrink: 0 }}>{label}</span>
          <div
            style={{
              flex: 1,
              height: 6,
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              borderRadius: 4,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                background: 'var(--accent)',
                width: `${(count / maxCount) * 100}%`,
              }}
            />
          </div>
          <span
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 11,
              color: 'var(--muted)',
              minWidth: 44,
              textAlign: 'right',
            }}
          >
            {count} ({total > 0 ? Math.round((count / total) * 100) : 0}%)
          </span>
        </div>
      ))}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Shared sub-components (kept from previous version)
// ──────────────────────────────────────────────────────────────────────────────

function RunTable({ runs }: { runs: CreatorRun[] }) {
  return (
    <div
      data-testid="studio-app-runs"
      style={{
        border: '1px solid var(--line)',
        borderRadius: 10,
        background: 'var(--card)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.5fr 1fr 1fr 80px',
          gap: 8,
          padding: '10px 16px',
          background: 'var(--bg)',
          borderBottom: '1px solid var(--line)',
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--muted)',
          fontWeight: 700,
        }}
      >
        <span>Started</span>
        <span>Action</span>
        <span>Status</span>
        <span style={{ textAlign: 'right' }}>Time</span>
      </div>
      {runs.map((r) => (
        <Link
          key={r.id}
          to={`/me/runs/${r.id}`}
          style={{
            display: 'grid',
            gridTemplateColumns: '1.5fr 1fr 1fr 80px',
            gap: 8,
            padding: '12px 16px',
            borderBottom: '1px solid var(--line)',
            fontSize: 13,
            color: 'var(--ink)',
            textDecoration: 'none',
            alignItems: 'center',
          }}
        >
          <span>{formatTime(r.started_at)}</span>
          <span
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 12,
              color: 'var(--muted)',
            }}
          >
            {r.action}
          </span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{r.status}</span>
          <span style={{ textAlign: 'right', fontSize: 12, color: 'var(--muted)' }}>
            {r.duration_ms ? `${Math.round(r.duration_ms)}ms` : '-'}
          </span>
        </Link>
      ))}
    </div>
  );
}

function VisibilityPill({
  value,
}: {
  value: 'public' | 'private' | 'auth-required';
}) {
  const tones = {
    public: { bg: '#e6f4ea', fg: '#1a7f37', label: 'Public' },
    private: { bg: '#fef3c7', fg: '#b45309', label: 'Private' },
    'auth-required': { bg: '#e0e7ff', fg: '#3730a3', label: 'Auth required' },
  }[value];
  return (
    <span
      data-testid={`studio-app-visibility-pill-${value}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 10px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        background: tones.bg,
        color: tones.fg,
      }}
    >
      {tones.label}
    </span>
  );
}

function StudioVisibilityChooser({
  value,
  onChange,
  busy,
  authRequired,
}: {
  value: 'public' | 'private';
  onChange: (next: 'public' | 'private') => void;
  busy: boolean;
  authRequired: boolean;
}) {
  const options: Array<{ id: 'public' | 'private'; label: string; explainer: string }> = [
    {
      id: 'public',
      label: 'Public',
      explainer: 'Appears in the Store. Anyone can run this app.',
    },
    {
      id: 'private',
      label: 'Private',
      explainer: 'Hidden from the Store. Only your signed-in sessions can run it.',
    },
  ];
  return (
    <div>
      <div
        role="radiogroup"
        aria-label="App visibility"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 10,
        }}
      >
        {options.map((opt) => {
          const selected = value === opt.id;
          return (
            <label
              key={opt.id}
              data-testid={`studio-app-visibility-${opt.id}`}
              data-selected={selected ? 'true' : 'false'}
              style={{
                border: selected ? '1.5px solid var(--accent)' : '1px solid var(--line)',
                background: selected ? 'var(--accent-soft, #e6f4ea)' : 'var(--card)',
                borderRadius: 10,
                padding: '12px 14px',
                cursor: busy ? 'wait' : 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                opacity: busy ? 0.6 : 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="radio"
                  name="studio-app-visibility"
                  value={opt.id}
                  checked={selected}
                  disabled={busy}
                  onChange={() => onChange(opt.id)}
                  data-testid={`studio-app-visibility-${opt.id}-input`}
                  style={{ accentColor: 'var(--accent)', margin: 0 }}
                />
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: selected ? 'var(--accent)' : 'var(--ink)',
                  }}
                >
                  {opt.label}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                {opt.explainer}
              </p>
            </label>
          );
        })}
      </div>
      {authRequired && (
        <p
          style={{
            margin: '12px 0 0',
            fontSize: 12,
            color: 'var(--muted)',
            lineHeight: 1.5,
          }}
        >
          This app is currently set to <strong>Auth required</strong> (shared bearer token). Picking
          Public or Private above will replace that mode.
        </p>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div data-testid="studio-app-loading" style={{ opacity: 0.6 }}>
      <div style={{ height: 40, background: 'var(--bg)', borderRadius: 8, marginBottom: 14 }} />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 14,
          marginBottom: 14,
        }}
      >
        <div style={{ height: 180, background: 'var(--bg)', borderRadius: 10 }} />
        <div style={{ height: 180, background: 'var(--bg)', borderRadius: 10 }} />
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 14,
        }}
      >
        <div style={{ height: 140, background: 'var(--bg)', borderRadius: 10 }} />
        <div style={{ height: 140, background: 'var(--bg)', borderRadius: 10 }} />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Shared style constants
// ──────────────────────────────────────────────────────────────────────────────

const grid2: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 14,
};

const panelStyle: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 12,
  padding: '18px 20px',
  boxShadow: 'var(--shadow-1)',
};

const panelHeading: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  margin: 0,
  color: 'var(--ink)',
};

const panelSub: React.CSSProperties = {
  fontSize: 12.5,
  color: 'var(--muted)',
  lineHeight: 1.5,
  margin: '2px 0 10px',
};

const sectionHeader: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--muted)',
  margin: '32px 0 10px',
};

const emptyState: React.CSSProperties = {
  border: '1px dashed var(--line)',
  borderRadius: 10,
  padding: '24px 20px',
  background: 'var(--card)',
};
