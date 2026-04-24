// /me/apps — v17 wireframe-parity "Installed" tab of the Me dashboard.
//
// Wireframe: https://wireframes.floom.dev/v17/me-apps.html
//
// MECE with Studio: this surface is apps the user has INSTALLED/USED
// from the Store. Apps the user has AUTHORED live in /studio (creator
// surface). We preserve the authored-apps section for now under a
// collapsed "You also publish N apps" affordance so creators can still
// jump to /studio from this page without losing the link.
//
// Layout (desktop 1260px):
//   - Page header: serif "Installed" H1 + subtitle + [Browse store]
//     + [Open Studio] right-side actions
//   - Stat pill strip: X installed · N runs 7d · Free plan
//   - Toolbar: chip filters (All/Sales/Dev tools/Utilities/Writing) + search
//   - 3-column grid: dashed "Browse the Store" tile first, then app
//     tiles with a runs counter, badges, and "by @author"
//
// Preserved from prior MeAppsPage:
//   - Pulls installed apps from run history (no install CRUD yet)
//   - Preserves authored-apps link to /studio
//   - All data-testid hooks (me-apps-page, me-apps-used, me-apps-published)

import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MeLayout } from '../components/me/MeLayout';
import { AppIcon } from '../components/AppIcon';
import { useSession } from '../hooks/useSession';
import { useMyApps } from '../hooks/useMyApps';
import * as api from '../api/client';
import type { MeRunSummary } from '../lib/types';

const FETCH_LIMIT = 200;

type Chip = 'all' | 'sales' | 'devtools' | 'utilities' | 'writing';

const CHIPS: { id: Chip; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'sales', label: 'Sales' },
  { id: 'devtools', label: 'Dev tools' },
  { id: 'utilities', label: 'Utilities' },
  { id: 'writing', label: 'Writing' },
];

// Heuristic slug → category mapping. Kept minimal — when the backend
// returns real app categories on the /me/apps API we swap this out.
function slugCategory(slug: string): Chip {
  const s = slug.toLowerCase();
  if (/(lead|score|crm|sales)/.test(s)) return 'sales';
  if (/(jwt|json|password|uuid|hash|base64|regex)/.test(s)) return 'utilities';
  if (/(draft|write|reply|compose|edit|summari)/.test(s)) return 'writing';
  if (/(api|deploy|ci|build|log|debug)/.test(s)) return 'devtools';
  return 'all';
}

const s: Record<string, CSSProperties> = {
  head: {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 16,
    flexWrap: 'wrap',
    marginBottom: 16,
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
  btnInk: {
    background: 'var(--ink)',
    color: '#fff',
    borderColor: 'var(--ink)',
  },
  statLine: {
    display: 'flex',
    gap: 18,
    flexWrap: 'wrap' as const,
    padding: '0 0 16px',
  },
  statPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    borderRadius: 999,
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 11,
    background: 'var(--card)',
    border: '1px solid var(--line)',
    color: 'var(--muted)',
  },
  statPillAccent: {
    color: 'var(--accent)',
    borderColor: 'var(--accent-border)',
    background: 'var(--accent-soft)',
  },
  statPillStrong: {
    color: 'var(--ink)',
    fontWeight: 700,
    marginRight: 4,
  },
  toolbar: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap' as const,
    padding: '14px 0',
    borderBottom: '1px solid var(--line)',
    marginBottom: 20,
  },
  chipRow: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap' as const,
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    borderRadius: 999,
    fontSize: 12.5,
    fontWeight: 500,
    border: '1px solid var(--line)',
    background: 'var(--card)',
    color: 'var(--muted)',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  chipOn: {
    background: 'var(--ink)',
    color: '#fff',
    borderColor: 'var(--ink)',
    fontWeight: 600,
  },
  searchWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '7px 12px',
    background: 'var(--card)',
    border: '1px solid var(--line)',
    borderRadius: 10,
    minWidth: 260,
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
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 16,
    paddingBottom: 40,
  },
  tile: {
    background: 'var(--card)',
    border: '1px solid var(--line)',
    borderRadius: 12,
    padding: '18px 20px',
    textDecoration: 'none',
    color: 'inherit',
    transition: 'all 0.15s ease',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 14,
    minHeight: 190,
  },
  tileHead: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    background: 'var(--bg)',
    border: '1px solid var(--line)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  tileBadge: {
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 10,
    color: 'var(--muted)',
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    padding: '3px 8px',
    border: '1px solid var(--line)',
    borderRadius: 999,
    background: 'var(--bg)',
  },
  tileBadgeOwner: {
    color: 'var(--accent)',
    background: 'var(--accent-soft)',
    borderColor: 'var(--accent-border)',
  },
  tileH3: {
    fontSize: 15,
    fontWeight: 600,
    margin: '0 0 4px',
    letterSpacing: '-0.005em',
  },
  tileP: {
    fontSize: 12.5,
    color: 'var(--muted)',
    margin: 0,
    lineHeight: 1.5,
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2 as unknown as number,
    WebkitBoxOrient: 'vertical' as CSSProperties['WebkitBoxOrient'],
  },
  tileFoot: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 10.5,
    color: 'var(--muted)',
    marginTop: 'auto',
  },
  tileRuns: {
    color: 'var(--ink)',
    fontWeight: 600,
  },
  createTile: {
    background: 'transparent',
    border: '2px dashed var(--line)',
    borderRadius: 12,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '28px 20px',
    textDecoration: 'none',
    color: 'inherit',
    transition: 'all 0.15s ease',
    minHeight: 190,
    cursor: 'pointer',
  },
  createIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    background: 'var(--accent)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  createH3: { fontSize: 15, fontWeight: 600, margin: '0 0 4px' },
  createP: {
    fontSize: 12.5,
    color: 'var(--muted)',
    margin: 0,
    lineHeight: 1.5,
    textAlign: 'center' as const,
    maxWidth: 220,
  },
  authoredBar: {
    marginTop: 24,
    padding: '14px 18px',
    border: '1px solid var(--line)',
    borderRadius: 12,
    background: 'var(--card)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap' as const,
  },
};

function useGridColumns(): number {
  const [cols, setCols] = useState(3);
  useEffect(() => {
    function onResize() {
      const w = window.innerWidth;
      if (w < 640) setCols(1);
      else if (w < 960) setCols(2);
      else setCols(3);
    }
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return cols;
}

export function MeAppsPage() {
  const { data: session, loading: sessionLoading, error: sessionError } = useSession();
  const { apps: myApps } = useMyApps();
  const [runs, setRuns] = useState<MeRunSummary[] | null>(null);
  const [chip, setChip] = useState<Chip>('all');
  const [query, setQuery] = useState('');

  const signedOutPreview = !!session && session.cloud_mode && session.user.is_local;
  const sessionPending = sessionLoading || (session === null && !sessionError);

  useEffect(() => {
    if (sessionPending) return;
    if (signedOutPreview) {
      setRuns([]);
      return;
    }
    let cancelled = false;
    api
      .getMyRuns(FETCH_LIMIT)
      .then((res) => {
        if (!cancelled) setRuns(res.runs);
      })
      .catch(() => {
        if (!cancelled) setRuns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionPending, signedOutPreview]);

  // Installed apps = distinct slugs from run history, with a run count
  // + last-used timestamp. Most-recent first.
  const installed = useMemo(() => {
    if (runs === null) return null;
    const seen = new Map<
      string,
      {
        slug: string;
        name: string;
        count: number;
        lastUsedAt: string | null;
        firstRunAt: string | null;
      }
    >();
    for (const run of runs) {
      if (!run.app_slug) continue;
      const prev = seen.get(run.app_slug);
      if (prev) {
        prev.count += 1;
        if (run.started_at && (!prev.firstRunAt || new Date(run.started_at) < new Date(prev.firstRunAt))) {
          prev.firstRunAt = run.started_at;
        }
      } else {
        seen.set(run.app_slug, {
          slug: run.app_slug,
          name: run.app_name || run.app_slug,
          count: 1,
          lastUsedAt: run.started_at,
          firstRunAt: run.started_at,
        });
      }
    }
    return Array.from(seen.values());
  }, [runs]);

  const runsLast7d = useMemo(() => {
    if (runs === null) return 0;
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return runs.filter((r) => {
      const t = r.started_at ? new Date(r.started_at).getTime() : NaN;
      return Number.isFinite(t) && t >= cutoff;
    }).length;
  }, [runs]);

  const authoredSlugs = useMemo(
    () => new Set((myApps || []).map((a) => a.slug)),
    [myApps],
  );

  const filtered = useMemo(() => {
    const list = installed ?? [];
    const q = query.trim().toLowerCase();
    return list.filter((a) => {
      if (chip !== 'all' && slugCategory(a.slug) !== chip) return false;
      if (q && !a.slug.toLowerCase().includes(q) && !a.name.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [installed, chip, query]);

  const cols = useGridColumns();
  const installedCount = installed ? installed.length : null;
  const authoredCount = myApps ? myApps.length : 0;

  const header = (
    <div style={s.head}>
      <div>
        <h1 style={s.h1}>Installed</h1>
        <p style={s.headSub}>
          Apps you&rsquo;ve run on Floom. Every tile links to{' '}
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--ink)' }}>/p/&lt;slug&gt;</span>{' '}
          so you can run them again. To manage apps you&rsquo;ve built, head to{' '}
          <Link to="/studio" style={{ color: 'var(--accent)', fontWeight: 600 }}>Studio</Link>.
        </p>
      </div>
      <div style={s.headActions}>
        <Link to="/apps" style={s.btn} data-testid="me-apps-browse-store">
          Browse store
        </Link>
        <Link to="/studio" style={{ ...s.btn, ...s.btnInk }} data-testid="me-apps-open-studio">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
          Open Studio
        </Link>
      </div>
    </div>
  );

  return (
    <MeLayout
      activeTab="apps"
      title="Installed · Me · Floom"
      allowSignedOutShell={signedOutPreview}
      counts={{
        apps: installedCount,
        runs: runs ? runs.length : null,
      }}
      header={header}
    >
      <div data-testid="me-apps-page">
        {/* Stat pill strip */}
        <div style={s.statLine}>
          <span style={s.statPill} data-testid="me-apps-stat-installed">
            <span style={s.statPillStrong}>{installedCount ?? '…'}</span> installed
          </span>
          <span style={s.statPill} data-testid="me-apps-stat-runs">
            <span style={s.statPillStrong}>{runsLast7d}</span> runs · 7d
          </span>
          <span style={{ ...s.statPill, ...s.statPillAccent }}>
            Free plan · unlimited installs
          </span>
        </div>

        {/* Toolbar: chips + search */}
        <div style={s.toolbar}>
          <div style={s.chipRow}>
            {CHIPS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setChip(c.id)}
                style={{ ...s.chip, ...(chip === c.id ? s.chipOn : null) }}
                data-testid={`me-apps-chip-${c.id}`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div style={s.searchWrap}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter apps"
              style={s.searchField}
              data-testid="me-apps-search"
            />
          </div>
        </div>

        {/* Grid */}
        {signedOutPreview ? (
          <div
            data-testid="me-apps-signed-out"
            style={{
              border: '1px dashed var(--line)',
              borderRadius: 12,
              background: 'var(--card)',
              padding: '32px 22px',
              textAlign: 'center',
              color: 'var(--muted)',
              fontSize: 14,
            }}
          >
            Sign in to see the apps you&rsquo;ve installed.
          </div>
        ) : installed === null ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            Loading your apps…
          </div>
        ) : (
          <div
            data-testid="me-apps-grid"
            style={{
              ...s.grid,
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
            }}
          >
            {/* Browse Store dashed tile always first */}
            <Link
              to="/apps"
              style={s.createTile}
              data-testid="me-apps-browse-tile"
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--accent)';
                (e.currentTarget as HTMLAnchorElement).style.background = 'var(--accent-soft)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--line)';
                (e.currentTarget as HTMLAnchorElement).style.background = 'transparent';
              }}
            >
              <div style={s.createIcon}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </div>
              <h3 style={s.createH3}>Browse the Store</h3>
              <p style={s.createP}>Find more apps to install. Zero setup.</p>
            </Link>

            {filtered.length === 0 && installed.length > 0 ? (
              <div
                data-testid="me-apps-filtered-empty"
                style={{
                  gridColumn: `span ${Math.max(1, cols - 1)}`,
                  padding: 40,
                  textAlign: 'center',
                  color: 'var(--muted)',
                  fontSize: 13,
                  border: '1px dashed var(--line)',
                  borderRadius: 12,
                }}
              >
                No apps match &ldquo;{query}&rdquo;
                {chip !== 'all' ? ` in ${chip}` : ''}.
              </div>
            ) : null}

            {installed.length === 0 && (
              <div
                data-testid="me-apps-used-empty"
                style={{
                  gridColumn: `span ${Math.max(1, cols - 1)}`,
                  padding: 40,
                  textAlign: 'center',
                  color: 'var(--muted)',
                  fontSize: 14,
                  lineHeight: 1.5,
                  border: '1px dashed var(--line)',
                  borderRadius: 12,
                }}
              >
                You haven&rsquo;t run any Floom apps yet.
                <div style={{ marginTop: 12 }}>
                  <Link to="/apps" style={{ ...s.btn, ...s.btnInk }}>
                    Try an app →
                  </Link>
                </div>
              </div>
            )}

            {filtered.map((app) => (
              <AppTile
                key={app.slug}
                slug={app.slug}
                name={app.name}
                count={app.count}
                isOwner={authoredSlugs.has(app.slug)}
              />
            ))}
          </div>
        )}

        {/* Authored-apps affordance. Keeps the creator-entry discoverable
            from /me/apps without duplicating the grid; MECE with Studio. */}
        {!signedOutPreview && authoredCount > 0 && (
          <div style={s.authoredBar} data-testid="me-apps-published">
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                You also publish {authoredCount} app{authoredCount === 1 ? '' : 's'}.
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>
                Manage drafts, analytics, and secrets in Studio.
              </div>
            </div>
            <Link
              to="/studio"
              style={s.btn}
              data-testid="me-apps-published-studio"
            >
              Open Studio →
            </Link>
          </div>
        )}
      </div>
    </MeLayout>
  );
}

function AppTile({
  slug,
  name,
  count,
  isOwner,
}: {
  slug: string;
  name: string;
  count: number;
  isOwner: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <Link
      to={`/p/${slug}`}
      data-testid={`me-apps-tile-${slug}`}
      style={{
        ...s.tile,
        borderColor: hover ? 'var(--ink)' : 'var(--line)',
        transform: hover ? 'translateY(-1px)' : 'none',
        boxShadow: hover ? '0 4px 12px rgba(14,14,12,0.05)' : 'none',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={s.tileHead}>
        <div style={s.tileIcon}>
          <AppIcon slug={slug} size={22} />
        </div>
        <span
          style={{
            ...s.tileBadge,
            ...(isOwner ? s.tileBadgeOwner : null),
          }}
        >
          {isOwner ? 'Owner' : 'Installed'}
        </span>
      </div>
      <div>
        <h3 style={s.tileH3}>{name}</h3>
        <p style={s.tileP}>
          {/* No description API surface yet; intentionally terse. */}
          {isOwner ? 'Your app.' : 'Run it again from your vault-backed config.'}
        </p>
      </div>
      <div style={s.tileFoot}>
        <span>
          <span style={s.tileRuns}>{count}</span> run{count === 1 ? '' : 's'}
        </span>
        <span>/p/{slug}</span>
      </div>
    </Link>
  );
}
