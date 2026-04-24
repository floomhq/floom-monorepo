// /me — v17 wireframe-parity Overview tab of the Me dashboard.
//
// Wireframe: https://wireframes.floom.dev/v17/me.html
//
// Layout (desktop 1260px):
//   - Header: serif DM Serif Display H1 "Welcome back, {name}."
//     + subtitle + right-side [Browse all apps] + [Ship an app]
//   - Tab strip: Overview · Installed · My runs · Secrets · Settings
//     (with count pills from real data)
//   - Stats strip: 4 tiles — Runs (7d) · Avg duration · Installed apps
//     · Saved secrets. Serif numerals, JetBrains Mono delta underneath.
//   - 2-column grid: left = Recent runs card + Pinned apps card;
//     right rail = Workspace card + Secrets peek + Discord CTA.
//
// Wireframe deviations (kept over strict parity, called out in PR body):
//   - "Recent runs" shows REAL run data, not the wireframe's mocked
//     companies/JWT snippets. Per feedback_never_fabricate.
//   - "Pinned apps" uses real apps from the run history when available,
//     and falls back to the distinct-slugs list (no manual pinning UI
//     yet in the backend).
//   - BYOK indicator still surfaces inside the Saved secrets card
//     (accent if GEMINI_API_KEY is stored in the user vault).
//
// Preserved from the prior MePage (must not be dropped):
//   - Waitlist modal (deploy-disabled mode)
//   - Onboarding tour (?tour=1, first-run trigger, restart button)
//   - Welcome banner (?welcome=1) + AppNotFound notice (?notice=…)
//   - Signed-out shell preview (?cloud_mode && is_local)
//   - All existing data-testid hooks (me-page, me-overview-stats,
//     me-runs-preview, me-apps-preview, me-welcome-banner, etc).

import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { MeLayout } from '../components/me/MeLayout';
import { AppIcon } from '../components/AppIcon';
import { Tour } from '../components/onboarding/Tour';
import { hasOnboarded, resetOnboarding } from '../lib/onboarding';
import { useSession } from '../hooks/useSession';
import { useMyApps } from '../hooks/useMyApps';
import { useSecrets } from '../hooks/useSecrets';
import { useDeployEnabled } from '../lib/flags';
import { WaitlistModal } from '../components/WaitlistModal';
import * as api from '../api/client';
import { formatTime } from '../lib/time';
import type { MeRunSummary, RunStatus, UserSecretEntry } from '../lib/types';

// BYOK key is written by BYOKModal under this localStorage entry. Still
// read here for the "free-tier not set" fallback on first-run users
// (secrets vault takes precedence when populated).
const BYOK_LOCAL_KEY = 'floom_user_gemini_key';
const FETCH_LIMIT = 200;
const RECENT_RUNS_PREVIEW = 5;
const PINNED_APPS_PREVIEW = 4;

const s: Record<string, CSSProperties> = {
  // Page header: serif H1 + subtitle + right-side buttons
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
  // Stats strip
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 12,
    marginBottom: 24,
  },
  stat: {
    background: 'var(--card)',
    border: '1px solid var(--line)',
    borderRadius: 12,
    padding: '14px 16px',
  },
  statLabel: {
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 10,
    color: 'var(--muted)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    fontWeight: 600,
  },
  statVal: {
    fontFamily: "'DM Serif Display', Georgia, serif",
    fontWeight: 400,
    fontSize: 28,
    letterSpacing: '-0.02em',
    lineHeight: 1.1,
    marginTop: 6,
  },
  statSub: {
    fontSize: 11.5,
    color: 'var(--muted)',
    marginTop: 4,
    fontFamily: 'JetBrains Mono, monospace',
  },
  statSubAccent: {
    color: 'var(--accent)',
  },
  // 2-column grid (main + right rail)
  grid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 320px',
    gap: 20,
  },
  // Cards
  card: {
    background: 'var(--card)',
    border: '1px solid var(--line)',
    borderRadius: 14,
    overflow: 'hidden',
  },
  cardHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 20px',
    borderBottom: '1px solid var(--line)',
    gap: 10,
    flexWrap: 'wrap' as const,
  },
  cardH3: {
    fontSize: 14,
    fontWeight: 600,
    margin: 0,
  },
  cardHeadLink: {
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 10,
    color: 'var(--muted)',
    textDecoration: 'underline',
    textUnderlineOffset: 2,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
  },
  // Run rows
  runRow: {
    display: 'grid',
    gridTemplateColumns: '32px minmax(0, 1fr) 100px 80px 30px',
    gap: 12,
    alignItems: 'center',
    padding: '10px 20px',
    borderTop: '1px solid var(--line)',
    textDecoration: 'none',
    color: 'inherit',
    fontSize: 13,
    transition: 'background 0.12s ease',
    background: 'transparent',
    width: '100%',
    border: 'none',
    textAlign: 'left' as const,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  runIc: {
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
  runTitle: {
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--ink)',
    lineHeight: 1.3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  runSub: {
    fontSize: 11.5,
    color: 'var(--muted)',
    marginTop: 2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    fontFamily: 'JetBrains Mono, monospace',
  },
  runDur: {
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 11,
    color: 'var(--muted)',
    padding: '3px 9px',
    border: '1px solid var(--line)',
    borderRadius: 999,
    background: 'var(--card)',
    justifySelf: 'start' as const,
  },
  runDurFast: {
    background: 'var(--accent-soft)',
    color: 'var(--accent)',
    borderColor: 'var(--accent-border)',
  },
  runTime: {
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 10.5,
    color: 'var(--muted)',
    textAlign: 'right' as const,
  },
  // Pinned apps mini-tile
  appsList: {
    padding: '14px 16px',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10,
  },
  miniApp: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    border: '1px solid var(--line)',
    borderRadius: 10,
    textDecoration: 'none',
    color: 'inherit',
    transition: 'all 0.12s ease',
    background: 'var(--card)',
  },
  miniAppIc: {
    width: 28,
    height: 28,
    borderRadius: 7,
    background: 'var(--bg)',
    border: '1px solid var(--line)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  miniAppName: {
    fontSize: 13,
    fontWeight: 600,
    lineHeight: 1.3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  miniAppSub: {
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 10,
    color: 'var(--muted)',
    marginTop: 1,
  },
  statPill: {
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 10,
    color: 'var(--muted)',
    background: 'var(--bg)',
    border: '1px solid var(--line)',
    borderRadius: 999,
    padding: '2px 7px',
    fontWeight: 500,
  },
  // Right rail
  rail: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 14,
  },
  railCard: {
    background: 'var(--card)',
    border: '1px solid var(--line)',
    borderRadius: 14,
    padding: '18px 20px',
  },
  railH4: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--muted)',
    margin: '0 0 12px',
    fontFamily: 'JetBrains Mono, monospace',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  railH4Link: {
    color: 'var(--muted)',
    textDecoration: 'underline',
    textUnderlineOffset: 2,
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: 0,
    textTransform: 'none' as const,
  },
  wsSwitch: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    background: 'var(--bg)',
    border: '1px solid var(--line)',
    borderRadius: 10,
    marginBottom: 14,
  },
  wsAv: {
    width: 28,
    height: 28,
    borderRadius: 7,
    background: 'var(--accent)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: 12,
    flexShrink: 0,
  },
  wsName: { fontSize: 13, fontWeight: 600 },
  wsRole: {
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 10,
    color: 'var(--muted)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  },
  keyRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '9px 12px',
    background: 'var(--bg)',
    border: '1px solid var(--line)',
    borderRadius: 10,
    marginBottom: 8,
    fontSize: 12,
  },
  keyLabel: {
    fontWeight: 500,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  keyVal: {
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 10.5,
    color: 'var(--muted)',
  },
  keyValSet: { color: 'var(--accent)', fontWeight: 600 },
  discordCard: {
    background: 'linear-gradient(180deg, var(--card), var(--accent-soft))',
    border: '1px solid var(--accent-border)',
    borderRadius: 14,
    padding: '18px 20px',
  },
  discordH4: {
    fontSize: 13.5,
    fontWeight: 600,
    margin: '0 0 6px',
    color: 'var(--ink)',
  },
  discordP: {
    fontSize: 12.5,
    color: 'var(--muted)',
    lineHeight: 1.5,
    margin: '0 0 12px',
  },
  // Notices
  notice: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '12px 16px',
    marginBottom: 20,
    borderRadius: 10,
    border: '1px solid #f4b7b1',
    background: '#fdecea',
    color: '#5c2d26',
  },
  welcome: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '14px 16px',
    marginBottom: 20,
    borderRadius: 10,
    border: '1px solid var(--accent-border)',
    background: 'var(--accent-soft)',
    color: 'var(--ink)',
  },
  noticeDismiss: {
    flexShrink: 0,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--ink)',
    background: 'rgba(255,255,255,0.6)',
    border: '1px solid rgba(0,0,0,0.12)',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  footerLink: {
    marginTop: 28,
    paddingTop: 18,
    borderTop: '1px solid var(--line)',
    fontSize: 12,
    color: 'var(--muted)',
    textAlign: 'center' as const,
  },
};

// Narrow 960px breakpoint: collapse to single column. CSS media queries
// via inline style don't work, so we read window width once on mount
// plus resize (simple useEffect pattern; no debounce needed here).
function useIsNarrow(breakpoint: number): boolean {
  const [narrow, setNarrow] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < breakpoint;
  });
  useEffect(() => {
    function onResize() {
      setNarrow(window.innerWidth < breakpoint);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);
  return narrow;
}

export function MePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: sessionData, loading: sessionLoading, error: sessionError } = useSession();
  const { apps: myApps } = useMyApps();
  const { entries: secretEntriesRaw } = useSecrets();

  const [runs, setRuns] = useState<MeRunSummary[] | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);

  const sessionPending = sessionLoading || (sessionData === null && !sessionError);
  const signedOutPreview = !!sessionData && sessionData.cloud_mode && sessionData.user.is_local;
  const canLoadPersonalData = !signedOutPreview;

  // Gate vault reads on a real cloud session. The `useSecrets` hook keeps
  // a module-level cache that survives logout until full SPA reload —
  // without this gate, signing out would flash the previous account's
  // secret count + provider badges on /me. Fixes codex [P1].
  const secretEntries = canLoadPersonalData ? secretEntriesRaw : null;

  const deployEnabled = useDeployEnabled();
  const [waitlistOpen, setWaitlistOpen] = useState(false);

  const isNarrow = useIsNarrow(960);
  const isMobile = useIsNarrow(560);

  useEffect(() => {
    if (sessionPending) return;
    if (!canLoadPersonalData) {
      setRuns([]);
      setRunsError(null);
      return;
    }
    let cancelled = false;
    api
      .getMyRuns(FETCH_LIMIT)
      .then((res) => {
        if (!cancelled) setRuns(res.runs);
      })
      .catch((err) => {
        if (!cancelled) setRunsError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [canLoadPersonalData, sessionPending]);

  // Distinct slugs from the FULL run history (not truncated). Drives
  // both the installed-count stat + tab pill AND the pinned-apps
  // preview. Fixes codex [P2] — previously the count plateaued at 4
  // because we derived it from the truncated preview slice.
  const installedApps = useMemo(() => {
    if (runs === null) return null;
    const seen = new Map<
      string,
      {
        slug: string;
        name: string;
        totalCount: number;
        last7dCount: number;
        lastUsedAt: string | null;
      }
    >();
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const run of runs) {
      if (!run.app_slug) continue;
      const t = run.started_at ? new Date(run.started_at).getTime() : NaN;
      const isRecent = Number.isFinite(t) && t >= cutoff;
      const prev = seen.get(run.app_slug);
      if (prev) {
        prev.totalCount += 1;
        if (isRecent) prev.last7dCount += 1;
      } else {
        seen.set(run.app_slug, {
          slug: run.app_slug,
          name: run.app_name || run.app_slug,
          totalCount: 1,
          last7dCount: isRecent ? 1 : 0,
          lastUsedAt: run.started_at,
        });
      }
    }
    return Array.from(seen.values());
  }, [runs]);

  const pinnedApps = useMemo(() => {
    if (installedApps === null) return null;
    return installedApps.slice(0, PINNED_APPS_PREVIEW);
  }, [installedApps]);

  // Stats
  const runsLast7d = useMemo(() => {
    if (runs === null) return null;
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return runs.filter((r) => {
      const t = r.started_at ? new Date(r.started_at).getTime() : NaN;
      return Number.isFinite(t) && t >= cutoff;
    }).length;
  }, [runs]);

  const runsPrior7d = useMemo(() => {
    if (runs === null) return null;
    const now = Date.now();
    const start = now - 14 * 24 * 60 * 60 * 1000;
    const end = now - 7 * 24 * 60 * 60 * 1000;
    return runs.filter((r) => {
      const t = r.started_at ? new Date(r.started_at).getTime() : NaN;
      return Number.isFinite(t) && t >= start && t < end;
    }).length;
  }, [runs]);

  const avgDurationMs = useMemo(() => {
    if (runs === null) return null;
    const durations = runs
      .map((r) => r.duration_ms)
      .filter((d): d is number => typeof d === 'number' && d > 0);
    if (durations.length === 0) return null;
    const sum = durations.reduce((a, b) => a + b, 0);
    return Math.round(sum / durations.length);
  }, [runs]);

  const installedCount = installedApps ? installedApps.length : null;
  const authoredCount = myApps ? myApps.length : 0;
  const savedSecretsCount = secretEntries ? secretEntries.length : null;

  // BYOK status for secrets peek. Vault takes priority; localStorage is
  // the legacy pre-vault fallback for anon free-tier users.
  const [byokLocal, setByokLocal] = useState<boolean>(false);
  useEffect(() => {
    try {
      setByokLocal(!!window.localStorage.getItem(BYOK_LOCAL_KEY));
    } catch {
      setByokLocal(false);
    }
  }, []);

  const geminiSet =
    !!secretEntries?.some((e) => e.key === 'GEMINI_API_KEY') || byokLocal;
  const openaiSet = !!secretEntries?.some((e) => e.key === 'OPENAI_API_KEY');
  const anthropicSet = !!secretEntries?.some((e) => e.key === 'ANTHROPIC_API_KEY');

  const showNotice = searchParams.get('notice') === 'app_not_found';
  const noticeSlug = searchParams.get('slug');
  const showWelcome = searchParams.get('welcome') === '1';
  const forceTour = searchParams.get('tour') === '1';
  const [tourOpen, setTourOpen] = useState(false);

  function dismissNotice() {
    const next = new URLSearchParams(searchParams);
    next.delete('notice');
    next.delete('slug');
    setSearchParams(next, { replace: true });
  }

  function dismissWelcome() {
    const next = new URLSearchParams(searchParams);
    next.delete('welcome');
    setSearchParams(next, { replace: true });
  }

  useEffect(() => {
    if (forceTour) {
      setTourOpen(true);
      return;
    }
    if (sessionPending || !canLoadPersonalData) return;
    if (runs !== null && runs.length === 0 && !hasOnboarded()) {
      setTourOpen(true);
    }
  }, [forceTour, runs, sessionPending, canLoadPersonalData]);

  function closeTour() {
    setTourOpen(false);
    if (forceTour) {
      const next = new URLSearchParams(searchParams);
      next.delete('tour');
      setSearchParams(next, { replace: true });
    }
  }

  function openRun(run: MeRunSummary) {
    if (!run.app_slug) return;
    navigate(`/p/${run.app_slug}?run=${encodeURIComponent(run.id)}`);
  }

  const recentRuns = useMemo(
    () => (runs ? runs.slice(0, RECENT_RUNS_PREVIEW) : []),
    [runs],
  );

  const totalRuns = runs ? runs.length : null;

  // Resolve display name for the serif H1. "Welcome back, {name}." per
  // wireframe; fall back to "Welcome back." when no name is available.
  const displayName = (sessionData?.user?.name || '').trim() ||
    deriveNameFromEmail(sessionData?.user?.email || '');

  const runsDelta =
    runsLast7d !== null && runsPrior7d !== null
      ? runsLast7d - runsPrior7d
      : null;

  // Ship-an-app CTA: goes to /studio/build when deployEnabled, else opens
  // waitlist modal. Preserves earlier MePage behaviour of gating publish
  // behind the waitlist.
  function onShipApp() {
    if (deployEnabled === false) {
      setWaitlistOpen(true);
    } else {
      navigate('/studio/build');
    }
  }

  const header = (
    <div style={s.head}>
      <div>
        <h1 data-testid="me-greeting-name" style={s.h1}>
          {displayName ? `Welcome back, ${displayName}.` : 'Welcome back.'}
        </h1>
        <p style={s.headSub}>
          Here&rsquo;s what&rsquo;s running on your account. Tabs below to
          dig into installed apps, runs, secrets, and settings.
        </p>
      </div>
      <div style={s.headActions}>
        <Link to="/apps" style={s.btn} data-testid="me-head-browse-apps">
          Browse all apps
        </Link>
        <button
          type="button"
          onClick={onShipApp}
          style={{ ...s.btn, ...s.btnAccent }}
          data-testid="me-head-ship-app"
        >
          Ship an app
        </button>
      </div>
    </div>
  );

  return (
    <MeLayout
      activeTab="overview"
      title="Me · Floom"
      allowSignedOutShell={signedOutPreview}
      counts={{
        apps: installedCount,
        runs: totalRuns,
        secrets: savedSecretsCount,
      }}
      header={header}
    >
      <div data-testid="me-page">
        {showWelcome && <WelcomeBanner onDismiss={dismissWelcome} />}

        {showNotice && <AppNotFound slug={noticeSlug} onDismiss={dismissNotice} />}

        {/* Stats strip — 4 tiles */}
        <div
          data-testid="me-overview-stats"
          style={{
            ...s.stats,
            gridTemplateColumns: isNarrow ? '1fr 1fr' : 'repeat(4, 1fr)',
          }}
        >
          <StatTile
            testid="stat-runs-7d"
            label="Runs (7d)"
            value={runsLast7d === null ? '…' : String(runsLast7d)}
            sub={
              runsDelta === null
                ? runs && runs.length > 0
                  ? `${runs.length} total`
                  : 'your runs will show up here'
                : runsDelta > 0
                  ? `↑ ${runsDelta} vs last week`
                  : runsDelta < 0
                    ? `↓ ${Math.abs(runsDelta)} vs last week`
                    : 'same as last week'
            }
            subAccent={runsDelta !== null && runsDelta > 0}
          />
          <StatTile
            testid="stat-avg-duration"
            label="Avg duration"
            value={avgDurationMs === null ? '—' : formatDuration(avgDurationMs)}
            sub={
              avgDurationMs === null
                ? 'no runs yet'
                : avgDurationMs < 2000
                  ? 'under 2s target'
                  : 'over 2s target'
            }
          />
          <StatTile
            testid="stat-installed-apps"
            label="Installed apps"
            value={installedCount === null ? '…' : String(installedCount)}
            sub={
              authoredCount === 0
                ? 'none shipped by you'
                : authoredCount === 1
                  ? '1 shipped by you'
                  : `${authoredCount} shipped by you`
            }
          />
          <StatTile
            testid="stat-saved-secrets"
            label="Saved secrets"
            value={savedSecretsCount === null ? '…' : String(savedSecretsCount)}
            sub={buildSecretsSub(secretEntries, geminiSet)}
          />
        </div>

        {signedOutPreview && (
          <section
            data-testid="me-signed-out-shell"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: '16px 18px',
              marginBottom: 24,
              borderRadius: 12,
              border: '1px solid var(--line)',
              background: 'var(--card)',
            }}
          >
            <strong style={{ fontSize: 14, color: 'var(--ink)' }}>
              Sign in to load your runs.
            </strong>
            <span style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
              Browse apps or preview how this page works without signing in.
            </span>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Link to="/login?next=%2Fme" style={{ ...s.btn, ...s.btnAccent, background: 'var(--ink)', borderColor: 'var(--ink)' }}>
                Sign in
              </Link>
              <Link to="/apps" style={s.btn}>
                Browse apps
              </Link>
            </div>
          </section>
        )}

        {/* 2-column grid — left: recent runs + pinned apps; right: rail */}
        <div
          style={{
            ...s.grid,
            gridTemplateColumns: isNarrow ? '1fr' : 'minmax(0, 1fr) 320px',
          }}
        >
          {/* LEFT column */}
          <div>
            {/* Recent runs card */}
            <section
              id="recent-runs"
              data-testid="me-runs-preview"
              aria-label="Recent runs"
              style={{ ...s.card, marginBottom: 16 }}
            >
              <div style={s.cardHead}>
                <h3 style={s.cardH3}>Recent runs</h3>
                <Link to="/me/runs" data-testid="me-runs-see-all" style={s.cardHeadLink}>
                  {totalRuns ? `View all ${totalRuns} →` : 'View all →'}
                </Link>
              </div>

              {runs === null && !runsError ? (
                <div style={{ padding: 18, color: 'var(--muted)', fontSize: 13 }}>
                  Loading runs…
                </div>
              ) : runsError ? (
                <ErrorPanel message={runsError} />
              ) : recentRuns.length === 0 ? (
                <EmptyRuns signedOutPreview={signedOutPreview} />
              ) : (
                <div data-testid="me-runs-preview-list">
                  {recentRuns.map((run, i) => (
                    <RunRow
                      key={run.id}
                      run={run}
                      onOpen={openRun}
                      isFirst={i === 0}
                      isMobile={isMobile}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Pinned apps card */}
            <section
              data-testid="me-apps-preview"
              aria-label="Pinned apps"
              style={s.card}
            >
              <div style={s.cardHead}>
                <h3 style={s.cardH3}>Pinned apps</h3>
                <Link to="/me/apps" data-testid="me-apps-see-all" style={s.cardHeadLink}>
                  Manage →
                </Link>
              </div>
              {pinnedApps === null ? (
                <div style={{ padding: 18, color: 'var(--muted)', fontSize: 13 }}>
                  Loading your apps…
                </div>
              ) : pinnedApps.length === 0 ? (
                <div
                  data-testid="me-apps-preview-empty"
                  style={{
                    padding: '22px 20px',
                    textAlign: 'center' as const,
                    color: 'var(--muted)',
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}
                >
                  <div style={{ marginBottom: 12 }}>
                    Nothing pinned yet. Run an app from the directory to get started.
                  </div>
                  <Link
                    to="/apps"
                    style={{
                      ...s.btn,
                      background: 'var(--ink)',
                      color: '#fff',
                      borderColor: 'var(--ink)',
                    }}
                  >
                    Browse apps →
                  </Link>
                </div>
              ) : (
                <div
                  data-testid="me-apps-preview-grid"
                  style={{
                    ...s.appsList,
                    gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                  }}
                >
                  {pinnedApps.map((a) => (
                    <Link
                      key={a.slug}
                      to={`/p/${a.slug}`}
                      data-testid={`me-apps-preview-tile-${a.slug}`}
                      style={s.miniApp}
                    >
                      <span aria-hidden style={s.miniAppIc}>
                        <AppIcon slug={a.slug} size={14} />
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={s.miniAppName}>{a.name}</div>
                        <div style={s.miniAppSub}>
                          {a.last7dCount > 0
                            ? `${a.last7dCount} run${a.last7dCount === 1 ? '' : 's'} · 7d`
                            : `${a.totalCount} run${a.totalCount === 1 ? '' : 's'} total`}
                        </div>
                      </div>
                      <span style={s.statPill}>pinned</span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* RIGHT rail */}
          {!isNarrow && (
            <aside style={s.rail} data-testid="me-rail">
              {/* Workspace */}
              <div style={s.railCard} data-testid="me-rail-workspace">
                <h4 style={s.railH4}>Workspace</h4>
                <div style={s.wsSwitch}>
                  <div style={s.wsAv}>{(displayName[0] || 'Y').toUpperCase()}</div>
                  <div>
                    <div style={s.wsName}>{displayName || 'You'}</div>
                    <div style={s.wsRole}>personal · free plan</div>
                  </div>
                </div>
                <button
                  type="button"
                  style={{ ...s.btn, width: '100%', justifyContent: 'center' }}
                  disabled
                  title="Workspace switching coming soon"
                >
                  Switch workspace
                </button>
              </div>

              {/* Secrets peek */}
              <div style={s.railCard} data-testid="me-rail-secrets">
                <h4 style={s.railH4}>
                  <span>Secrets</span>
                  <Link to="/me/secrets" style={s.railH4Link}>
                    Manage →
                  </Link>
                </h4>
                <KeyRow name="GEMINI_API_KEY" set={geminiSet} entries={secretEntries} />
                <KeyRow name="OPENAI_API_KEY" set={openaiSet} entries={secretEntries} />
                <KeyRow
                  name="ANTHROPIC_API_KEY"
                  set={anthropicSet}
                  entries={secretEntries}
                />
              </div>

              {/* Discord */}
              <div style={s.discordCard}>
                <h4 style={s.discordH4}>Join the creators Discord</h4>
                <p style={s.discordP}>
                  Makers shipping on Floom. Share apps, trade feedback, get early access.
                </p>
                <a
                  href="https://discord.gg/8fXGXjxcRz"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    ...s.btn,
                    ...s.btnAccent,
                    width: '100%',
                    justifyContent: 'center',
                  }}
                >
                  Open Discord invite
                </a>
              </div>
            </aside>
          )}
        </div>

        {/* Footer affordance: restart onboarding tour. Kept from prior
            MePage — Federico uses ?tour=1 to re-run the walkthrough. */}
        <div data-testid="me-restart-tour" style={s.footerLink}>
          <button
            type="button"
            onClick={() => {
              resetOnboarding();
              setTourOpen(true);
            }}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              color: 'var(--muted)',
              textDecoration: 'underline',
              cursor: 'pointer',
              fontSize: 12,
              fontFamily: 'inherit',
            }}
          >
            Restart tour
          </button>
        </div>
      </div>

      {tourOpen && <Tour onClose={closeTour} />}
      <WaitlistModal
        open={waitlistOpen}
        onClose={() => setWaitlistOpen(false)}
        source="me-publish"
      />
    </MeLayout>
  );
}

/* ---------- subcomponents ---------- */

function StatTile({
  testid,
  label,
  value,
  sub,
  subAccent = false,
}: {
  testid: string;
  label: string;
  value: string;
  sub?: string;
  subAccent?: boolean;
}) {
  return (
    <section data-testid={testid} style={s.stat}>
      <div style={s.statLabel}>{label}</div>
      <div style={s.statVal}>{value}</div>
      {sub ? (
        <div style={{ ...s.statSub, ...(subAccent ? s.statSubAccent : null) }}>{sub}</div>
      ) : null}
    </section>
  );
}

function RunRow({
  run,
  onOpen,
  isFirst,
  isMobile,
}: {
  run: MeRunSummary;
  onOpen: (run: MeRunSummary) => void;
  isFirst: boolean;
  isMobile: boolean;
}) {
  const [hover, setHover] = useState(false);
  const appName = run.app_name || run.app_slug || 'App';
  const summary = runSummary(run);
  const outPreview = runOutputPreviewLine(run);
  const subline = [summary, outPreview].filter(Boolean).join(' → ');
  const time = formatTime(run.started_at);
  const durMs = run.duration_ms;
  const fast = typeof durMs === 'number' && durMs > 0 && durMs < 2000;
  const disabled = !run.app_slug;

  const chipText = initialsChip(run.app_slug || appName);

  return (
    <button
      type="button"
      onClick={() => onOpen(run)}
      disabled={disabled}
      data-testid={`me-run-row-${run.id}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...s.runRow,
        gridTemplateColumns: isMobile ? '28px 1fr 26px' : '32px minmax(0, 1fr) 100px 80px 30px',
        borderTop: isFirst ? 'none' : '1px solid var(--line)',
        background: hover && !disabled ? 'var(--bg)' : 'transparent',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      <span style={s.runIc} aria-hidden>
        {run.app_slug ? (
          <AppIcon slug={run.app_slug} size={14} />
        ) : (
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 700 }}>
            {chipText}
          </span>
        )}
      </span>

      <div style={{ minWidth: 0 }}>
        <div style={s.runTitle}>
          <MeRunStatusDot status={run.status} />
          {appName}
          {summary ? ` · ${truncate(summary, 48)}` : null}
        </div>
        {subline || outPreview ? (
          <div style={s.runSub}>{truncate(subline || outPreview || '', 80)}</div>
        ) : null}
      </div>

      {!isMobile && (
        <span style={{ ...s.runDur, ...(fast ? s.runDurFast : null) }}>
          {typeof durMs === 'number' && durMs > 0 ? formatDuration(durMs) : '—'}
        </span>
      )}

      {!isMobile && <span style={s.runTime}>{time}</span>}

      <span
        aria-hidden
        style={{
          width: 26,
          height: 26,
          borderRadius: 7,
          border: '1px solid var(--line)',
          background: 'var(--card)',
          color: 'var(--muted)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: hover && !disabled ? 1 : isMobile ? 0.6 : 0,
          transition: 'opacity 0.12s ease',
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15 a9 9 0 1 0 2.13 -9.36 L1 10" />
        </svg>
      </span>
    </button>
  );
}

function MeRunStatusDot({ status }: { status: RunStatus }) {
  let bg = 'var(--muted)';
  if (status === 'success') bg = 'var(--accent)';
  else if (status === 'error' || status === 'timeout') bg = '#c2321f';
  return (
    <span
      aria-label={`Status: ${status}`}
      style={{
        display: 'inline-block',
        width: 6,
        height: 6,
        borderRadius: 999,
        background: bg,
        marginRight: 8,
        verticalAlign: 'middle',
      }}
    />
  );
}

function KeyRow({
  name,
  set,
  entries,
}: {
  name: string;
  set: boolean;
  entries: UserSecretEntry[] | null;
}) {
  const entry = entries?.find((e) => e.key === name);
  const val = set
    ? entry
      ? `••••${maskTail(name, entry)}`
      : 'stored'
    : 'not set';
  return (
    <div style={s.keyRow}>
      <span style={s.keyLabel}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11 V7 a5 5 0 0 1 10 0 v4" />
        </svg>
        {name}
      </span>
      <span style={{ ...s.keyVal, ...(set ? s.keyValSet : null) }}>{val}</span>
    </div>
  );
}

// Mask tail derived deterministically from the key name + updated_at so
// the UI has something stable to show without ever reading the value.
function maskTail(name: string, entry: UserSecretEntry): string {
  const seed = `${name}${entry.updated_at ?? ''}`;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h.toString(16).slice(0, 4);
}

function WelcomeBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div role="status" data-testid="me-welcome-banner" style={s.welcome}>
      <div style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: 1.55 }}>
        <strong style={{ color: 'var(--accent)' }}>Welcome to Floom</strong>
        <span style={{ display: 'block', marginTop: 4 }}>
          Try an app below, or{' '}
          <Link to="/apps" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
            browse the directory
          </Link>{' '}
          to get started.
        </span>
      </div>
      <button
        type="button"
        aria-label="Dismiss welcome"
        data-testid="me-welcome-dismiss"
        onClick={onDismiss}
        style={s.noticeDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}

function AppNotFound({
  slug,
  onDismiss,
}: {
  slug: string | null;
  onDismiss: () => void;
}) {
  return (
    <div role="alert" data-testid="me-app-not-found-notice" style={s.notice}>
      <div style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: 1.55 }}>
        <strong style={{ color: '#c2321f' }}>App not found</strong>
        <span style={{ display: 'block', marginTop: 4 }}>
          We couldn&rsquo;t open that app
          {slug ? (
            <>
              {' '}
              (
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>
                {slug}
              </span>
              )
            </>
          ) : (
            ''
          )}
          . It may have been removed or you don&rsquo;t have access.
        </span>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        data-testid="me-app-not-found-dismiss"
        onClick={onDismiss}
        style={s.noticeDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <section
      data-testid="me-runs-error"
      style={{
        padding: '16px 20px',
        color: '#5c2d26',
        fontSize: 13,
        lineHeight: 1.55,
        background: '#fdecea',
      }}
    >
      <strong style={{ color: '#c2321f' }}>Couldn&rsquo;t load runs.</strong> {message}
    </section>
  );
}

function EmptyRuns({ signedOutPreview = false }: { signedOutPreview?: boolean }) {
  return (
    <section
      data-testid="me-runs-empty"
      style={{
        padding: '32px 24px',
        textAlign: 'center' as const,
      }}
    >
      <div
        style={{
          fontFamily: "'DM Serif Display', Georgia, serif",
          fontSize: 20,
          fontWeight: 400,
          letterSpacing: '-0.02em',
          color: 'var(--ink)',
          marginBottom: 8,
        }}
      >
        {signedOutPreview ? 'Sign in to see your runs.' : 'No runs yet.'}
      </div>
      <p
        style={{
          margin: '0 auto 18px',
          color: 'var(--muted)',
          fontSize: 14,
          lineHeight: 1.55,
          maxWidth: 380,
        }}
      >
        {signedOutPreview
          ? 'Your run history appears here after you sign in.'
          : 'Run any Floom app and it will show up here.'}
      </p>
      <Link
        to="/apps"
        data-testid="me-empty-browse"
        style={{
          display: 'inline-block',
          padding: '10px 18px',
          background: 'var(--ink)',
          color: '#fff',
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 600,
          textDecoration: 'none',
        }}
      >
        Browse apps →
      </Link>
    </section>
  );
}

/* ---------- helpers ---------- */

function deriveNameFromEmail(email: string): string {
  const t = (email || '').trim();
  if (!t.includes('@')) return t;
  const local = t.split('@')[0] || '';
  // capitalise first letter; leave the rest to respect email casing
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  return `${Math.round(s)}s`;
}

function initialsChip(input: string): string {
  const clean = input.replace(/[^a-zA-Z0-9]+/g, ' ').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '··';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function buildSecretsSub(entries: UserSecretEntry[] | null, _gemini: boolean): string {
  if (entries === null) return '…';
  if (entries.length === 0) return 'vault empty · add keys';
  const keys = entries.map((e) => shortenKey(e.key));
  if (keys.length <= 3) return keys.join(' · ');
  return `${keys.slice(0, 2).join(' · ')} +${keys.length - 2} more`;
}

function shortenKey(key: string): string {
  // GEMINI_API_KEY → GEMINI, OPENAI_API_KEY → OPENAI. For unknown keys,
  // keep the first segment before _API_KEY / _KEY, falling back to the
  // full name so user-defined secrets stay recognisable.
  const up = key.toUpperCase();
  const idxApi = up.indexOf('_API_KEY');
  if (idxApi > 0) return up.slice(0, idxApi);
  const idxKey = up.indexOf('_KEY');
  if (idxKey > 0) return up.slice(0, idxKey);
  return up;
}

function runIdShort(id: string | null | undefined): string {
  if (!id) return '';
  const trimmed = id.replace(/^run_/, '');
  return trimmed.slice(0, 8);
}
// Keep the helper exported indirectly via subcomponents; lint will drop
// it if unused.
void runIdShort;

function runOutputPreviewLine(run: MeRunSummary): string | null {
  const o = run.outputs;
  if (o == null || o === '') return null;
  if (typeof o === 'string') {
    const t = o.replace(/\s+/g, ' ').trim();
    return t ? truncate(t, 72) : null;
  }
  if (typeof o === 'object' && o !== null && !Array.isArray(o)) {
    const rec = o as Record<string, unknown>;
    const direct =
      typeof rec['text'] === 'string'
        ? rec['text']
        : typeof rec['message'] === 'string'
          ? rec['message']
          : typeof rec['result'] === 'string'
            ? rec['result']
            : null;
    if (direct && String(direct).trim()) {
      return truncate(String(direct).replace(/\s+/g, ' ').trim(), 72);
    }
  }
  try {
    const raw = JSON.stringify(o);
    if (raw.length <= 80) return raw;
    return `${raw.slice(0, 77)}…`;
  } catch {
    return null;
  }
}

function runSummary(run: MeRunSummary): string | null {
  const inputs = run.inputs;
  if (inputs && typeof inputs === 'object' && !Array.isArray(inputs)) {
    const prompt = inputs['prompt'];
    if (typeof prompt === 'string' && prompt.trim()) {
      return truncate(prompt.trim(), 90);
    }
    for (const value of Object.values(inputs)) {
      if (typeof value === 'string' && value.trim()) {
        return truncate(value.trim(), 90);
      }
    }
    const entries = Object.entries(inputs).filter(
      ([, v]) => v !== null && (typeof v === 'number' || typeof v === 'boolean'),
    );
    if (entries.length > 0) {
      const [k, v] = entries[0];
      return truncate(`${k}: ${v}`, 90);
    }
    const keyCount = Object.keys(inputs).length;
    if (keyCount > 0) return `${keyCount} input${keyCount === 1 ? '' : 's'}`;
  }
  if (run.action && run.action !== 'run') return run.action;
  return null;
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return `${str.slice(0, max - 1).trimEnd()}…`;
}
