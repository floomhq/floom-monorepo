/**
 * RunsList — shared content shell for /run/runs and /studio/runs.
 *
 * Spec: V26-IA-SPEC §12.2 — both pages share shell + layout shape:
 *   [hero stat row] → [primary list] → (filter toolbar) → [activity strip]
 *
 * Only data + primary CTA differ between modes.
 *
 * Structure:
 *   page-head: heading + subtitle + optional secondary action + optional header CTA
 *   hero-stat-row: 4 stat cards
 *   filter toolbar: chips with optional counts + click handlers
 *   runs table: icon · body (lab/snippet/output) · status pill · duration · time
 *   pagination strip
 *
 * Row UI: status pill (DONE/FAILED/RUNNING) + payload snippet + ms-tag duration
 * is preserved across both modes (Run side originated this; it's more useful
 * than Studio's earlier "via Floom · Open →" placeholder shape). Studio rows
 * have no snippet/output (their data shape is lighter), so those lines just
 * don't render — the row still aligns visually because it's a CSS grid.
 */

import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AppIcon } from '../AppIcon';
import { formatTime } from '../../lib/time';
import type {
  MeRunSummary,
  RunStatus,
  StudioActivityRun,
} from '../../lib/types';
import { runSnippetText, runOutputSummary } from '../me/runPreview';

// ── Stat card ────────────────────────────────────────────────────────

interface StatCardData {
  label: string;
  value: string;
  sub?: string;
}

// ── Filter chip ──────────────────────────────────────────────────────

export interface RunsListFilter {
  /** Display label (e.g. "All", "Failed") */
  label: string;
  /** Optional count to show next to the label */
  count?: number;
  /** Whether this chip is the active selection */
  active?: boolean;
  /** Optional click handler. When omitted the chip is a static badge. */
  onClick?: () => void;
  /** Optional test id suffix (final id = `runs-list-chip-${id}`) */
  id?: string;
}

// ── Run row (unified shape for run + studio) ─────────────────────────

export interface RunsListRow {
  id: string;
  appSlug: string | null;
  appName: string;
  /** Main content line: app · action */
  body: string;
  /**
   * Optional secondary line (mono): payload snippet / input preview.
   * Run mode populates this from `runSnippetText`; Studio leaves null.
   */
  snippet?: string | null;
  /**
   * Optional tertiary line: output summary or failure reason.
   * Run mode populates this from `runOutputSummary`; Studio leaves null.
   */
  output?: string | null;
  /** Duration string (e.g. "1.8s") */
  duration: string;
  /** Timestamp string (rendered in the right-most column) */
  when: string;
  /** Whether this run failed */
  failed: boolean;
  /** href for the detail page */
  href: string;
  status: RunStatus;
}

// ── Top-level props ──────────────────────────────────────────────────

export interface RunsListProps {
  mode: 'run' | 'studio';
  /** Page heading (e.g. "Runs", "All runs") */
  heading: string;
  /** Supporting subtitle */
  subtitle: string;
  /**
   * Optional header CTA (rendered top-right of page-head).
   * Run side: "← Back to Apps" link. Studio side: usually null.
   */
  headerCta?: ReactNode;
  /** Optional secondary action (e.g. Export CSV). Rendered next to headerCta. */
  secondaryAction?: ReactNode;
  /** 4 hero stat cards */
  stats: [StatCardData, StatCardData, StatCardData, StatCardData];
  /** Filter chips. Pass at least one with `active: true`. */
  filters?: RunsListFilter[];
  /** Run rows to display (already filtered + sliced by caller) */
  runs: RunsListRow[] | null;
  /** Total count after filter (for "Showing N of X") */
  totalCount?: number;
  /** Whether more items can be loaded */
  hasMore?: boolean;
  /** Called when user clicks "Load more" */
  onLoadMore?: () => void;
  /** Loading state */
  loading?: boolean;
  /** Error string */
  error?: string | null;
  /** Optional empty-state node (when runs is `[]`). Defaults to a generic line. */
  emptyState?: ReactNode;
  /** Optional filter-empty-state node (runs is `[]` but a filter is active). */
  filterEmptyState?: ReactNode;
}

// ── Styles ───────────────────────────────────────────────────────────

const s: Record<string, CSSProperties> = {
  content: {
    padding: '24px 28px 64px',
  },
  head: {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 18,
    flexWrap: 'wrap',
    marginBottom: 18,
  },
  headActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  h1: {
    fontFamily: 'var(--font-display)',
    fontWeight: 800,
    fontSize: 30,
    letterSpacing: '-0.02em',
    lineHeight: 1.1,
    margin: '0 0 5px',
    color: 'var(--ink)',
  },
  subtitle: {
    fontSize: 14,
    color: 'var(--muted)',
    margin: 0,
    lineHeight: 1.55,
  },
  heroRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 12,
    marginBottom: 18,
  },
  statCard: {
    background: 'var(--card)',
    border: '1px solid var(--line)',
    borderRadius: 12,
    padding: '14px 16px',
  },
  statLab: {
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 10.5,
    color: 'var(--muted)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
    fontWeight: 600,
  },
  statVal: {
    fontFamily: 'JetBrains Mono, monospace',
    fontWeight: 700,
    fontSize: 22,
    color: 'var(--ink)',
    lineHeight: 1,
    marginTop: 6,
  },
  statSub: {
    fontSize: 11,
    color: 'var(--muted)',
    marginTop: 3,
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  filters: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 12,
    padding: '5px 11px',
    borderRadius: 999,
    background: 'var(--card)',
    border: '1px solid var(--line)',
    color: 'var(--muted)',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.12s ease',
  },
  chipOn: {
    background: 'var(--accent-soft)',
    color: 'var(--accent)',
    borderColor: 'var(--accent-border, #a7f3d0)',
    fontWeight: 600,
  },
  chipCount: {
    opacity: 0.7,
  },
  table: {
    background: 'var(--card)',
    border: '1px solid var(--line)',
    borderRadius: 14,
    overflow: 'hidden',
    boxShadow: 'var(--shadow-1)',
    marginBottom: 14,
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '36px minmax(0,1fr) 90px 100px auto',
    gap: 14,
    alignItems: 'center',
    padding: '12px 18px',
    borderTop: '1px solid var(--line)',
    textDecoration: 'none',
    color: 'inherit',
    transition: 'background 0.1s ease',
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    background: 'var(--bg)',
    border: '1px solid var(--line)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  body: {
    minWidth: 0,
  },
  nm: {
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--ink)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  snippetLine: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10.5,
    color: 'var(--muted)',
    marginTop: 2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  outLine: {
    fontSize: 11,
    color: 'var(--muted)',
    marginTop: 2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  outLineFail: {
    fontSize: 11,
    color: 'var(--danger, #ef4444)',
    marginTop: 2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  pillBase: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.04em',
  },
  pillDone: {
    background: 'var(--accent)',
    color: '#fff',
  },
  pillFail: {
    background: 'var(--danger, #ef4444)',
    color: '#fff',
  },
  pillRunning: {
    background: '#0ea5e9',
    color: '#fff',
  },
  pillNeutral: {
    background: 'var(--card)',
    border: '1px solid var(--line)',
    color: 'var(--muted)',
  },
  dur: {
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 10.5,
    color: 'var(--accent)',
    background: 'var(--accent-soft)',
    border: '1px solid var(--accent-border, #a7f3d0)',
    borderRadius: 999,
    padding: '2px 9px',
    fontWeight: 600,
    textAlign: 'center' as const,
    whiteSpace: 'nowrap' as const,
  },
  durFail: {
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 10.5,
    color: 'var(--danger, #ef4444)',
    background: 'var(--danger-soft, #fef2f2)',
    border: '1px solid #fca5a5',
    borderRadius: 999,
    padding: '2px 9px',
    fontWeight: 600,
    textAlign: 'center' as const,
    whiteSpace: 'nowrap' as const,
  },
  when: {
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 10.5,
    color: 'var(--muted)',
    whiteSpace: 'nowrap' as const,
  },
  pagination: {
    textAlign: 'center' as const,
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 11.5,
    color: 'var(--muted)',
  },
  paginationLink: {
    color: 'var(--accent)',
    fontWeight: 600,
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 11.5,
    padding: 0,
  },
  loading: {
    padding: 18,
    fontSize: 13.5,
    color: 'var(--muted)',
    border: '1px solid var(--line)',
    borderRadius: 14,
    background: 'var(--card)',
    marginBottom: 14,
  },
  error: {
    padding: '14px 16px',
    borderRadius: 16,
    border: '1px solid #f4b7b1',
    background: '#fdecea',
    color: '#5c2d26',
    fontSize: 13.5,
    lineHeight: 1.6,
    marginBottom: 16,
  },
  empty: {
    padding: '24px 18px',
    borderRadius: 18,
    border: '1px dashed var(--line)',
    background: 'var(--bg)',
    color: 'var(--muted)',
    fontSize: 13,
    marginBottom: 14,
    textAlign: 'center' as const,
  },
};

// ── Component ────────────────────────────────────────────────────────

export function RunsList({
  mode,
  heading,
  subtitle,
  headerCta,
  secondaryAction,
  stats,
  filters = [],
  runs,
  totalCount,
  hasMore,
  onLoadMore,
  loading = false,
  error = null,
  emptyState,
  filterEmptyState,
}: RunsListProps) {
  const visibleCount = runs?.length ?? 0;
  const activeFilterIsAll = filters.length === 0 || filters[0]?.active === true;

  return (
    <div data-testid={`workspace-runs-${mode}`} style={s.content}>

      {/* 1. page-head */}
      <div style={s.head}>
        <div>
          <h1 style={s.h1}>{heading}</h1>
          <p style={s.subtitle}>{subtitle}</p>
        </div>
        {(headerCta || secondaryAction) && (
          <div style={s.headActions}>
            {secondaryAction ?? null}
            {headerCta ?? null}
          </div>
        )}
      </div>

      {/* 2. hero stat row */}
      <div style={s.heroRow} data-testid="workspace-runs-stats">
        {stats.map((stat) => (
          <div key={stat.label} style={s.statCard}>
            <div style={s.statLab}>{stat.label}</div>
            <div style={s.statVal}>{stat.value}</div>
            {stat.sub ? <div style={s.statSub}>{stat.sub}</div> : null}
          </div>
        ))}
      </div>

      {/* 3. filter toolbar */}
      {filters.length > 0 && (
        <div style={s.toolbar}>
          <div style={s.filters} data-testid="workspace-runs-filters">
            {filters.map((f) => {
              const style = f.active ? { ...s.chip, ...s.chipOn } : s.chip;
              const testId = `workspace-runs-chip-${f.id ?? slugify(f.label)}`;
              if (f.onClick) {
                return (
                  <button
                    key={f.label}
                    type="button"
                    style={style}
                    onClick={f.onClick}
                    data-testid={testId}
                    aria-pressed={f.active ? 'true' : 'false'}
                  >
                    {f.label}
                    {f.count != null && (
                      <span style={s.chipCount}>{f.count}</span>
                    )}
                  </button>
                );
              }
              return (
                <span key={f.label} style={style} data-testid={testId}>
                  {f.label}
                  {f.count != null && (
                    <span style={s.chipCount}>{f.count}</span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* error */}
      {error ? (
        <div style={s.error} data-testid="workspace-runs-error">
          <strong style={{ color: '#b42318' }}>Couldn't load runs.</strong>{' '}
          {error}
        </div>
      ) : null}

      {/* 4. runs table */}
      {loading ? (
        <div style={s.loading} data-testid="workspace-runs-loading">
          Loading runs…
        </div>
      ) : runs && runs.length > 0 ? (
        <div
          style={s.table}
          aria-label="Workspace run history"
          data-testid="workspace-runs-table"
        >
          {runs.map((run, i) => (
            <RunRow key={run.id} row={run} isFirst={i === 0} />
          ))}
        </div>
      ) : runs && runs.length === 0 ? (
        activeFilterIsAll ? (
          <div style={s.empty} data-testid="workspace-runs-empty">
            {emptyState ??
              (mode === 'run'
                ? "You haven't run anything yet."
                : 'Nothing here yet.')}
          </div>
        ) : (
          <div
            style={s.empty}
            data-testid="workspace-runs-filter-empty"
          >
            {filterEmptyState ?? 'No runs match this filter.'}
          </div>
        )
      ) : null}

      {/* 5. pagination strip */}
      {runs && runs.length > 0 && (
        <div style={s.pagination} data-testid="workspace-runs-pagination">
          {totalCount != null
            ? `Showing ${visibleCount} of ${totalCount.toLocaleString()}`
            : null}
          {hasMore && onLoadMore ? (
            <>
              {totalCount != null ? ' · ' : null}
              <button
                type="button"
                style={s.paginationLink}
                onClick={onLoadMore}
                data-testid="workspace-runs-load-more"
              >
                Load more →
              </button>
            </>
          ) : null}
        </div>
      )}

    </div>
  );
}

// ── RunRow sub-component ─────────────────────────────────────────────

function RunRow({ row, isFirst }: { row: RunsListRow; isFirst: boolean }) {
  const isFailed = row.failed;
  const isRunning = row.status === 'running';
  const rowStyle: CSSProperties = {
    ...s.row,
    borderTop: isFirst ? 'none' : s.row.borderTop,
  };

  return (
    <Link
      to={row.href}
      data-testid={`workspace-run-row-${row.id}`}
      style={rowStyle}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {/* Icon */}
      <span style={s.iconWrap} aria-hidden="true">
        {row.appSlug ? (
          <AppIcon slug={row.appSlug} size={18} />
        ) : (
          <span
            style={{ fontSize: 14, fontWeight: 700, color: 'var(--muted)' }}
          >
            ·
          </span>
        )}
      </span>

      {/* Body: name + optional snippet + optional output */}
      <div style={s.body}>
        <div style={s.nm}>{row.body}</div>
        {row.snippet ? <div style={s.snippetLine}>{row.snippet}</div> : null}
        {row.output ? (
          <div style={isFailed ? s.outLineFail : s.outLine}>{row.output}</div>
        ) : null}
      </div>

      {/* Status pill */}
      <span>
        <span style={statusPillStyle(row.status, isFailed, isRunning)}>
          {statusPillLabel(row.status, isFailed, isRunning)}
        </span>
      </span>

      {/* Duration */}
      <span style={isFailed ? s.durFail : s.dur}>{row.duration}</span>

      {/* Timestamp */}
      <span style={s.when}>{row.when}</span>
    </Link>
  );
}

function statusPillStyle(
  status: RunStatus,
  isFailed: boolean,
  isRunning: boolean,
): CSSProperties {
  if (isFailed) return { ...s.pillBase, ...s.pillFail };
  if (isRunning) return { ...s.pillBase, ...s.pillRunning };
  if (status === 'success') return { ...s.pillBase, ...s.pillDone };
  return { ...s.pillBase, ...s.pillNeutral };
}

function statusPillLabel(
  status: RunStatus,
  isFailed: boolean,
  isRunning: boolean,
): string {
  if (isFailed) return 'FAILED';
  if (isRunning) return 'RUNNING';
  if (status === 'success') return 'DONE';
  return status.toUpperCase();
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ── Convenience helpers for callers ──────────────────────────────────

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s`;
}

/** Convert MeRunSummary[] → RunsListRow[] for Run mode (/run/runs and /me/runs) */
export function runListRowsFromMeRuns(
  runs: MeRunSummary[],
  hrefBase: '/run/runs' | '/me/runs' = '/run/runs',
): RunsListRow[] {
  return runs.map((run) => {
    const slug = run.app_slug;
    const action = run.action && run.action !== 'run' ? run.action : null;
    const lab = slug
      ? action
        ? `${slug} · ${action}`
        : slug
      : action || 'run';
    const snippet = runSnippetText(run);
    const output = runOutputSummary(run);
    return {
      id: run.id,
      appSlug: slug,
      appName: run.app_name || slug || 'App',
      body: lab,
      snippet: snippet || null,
      output: output || null,
      duration: formatDuration(run.duration_ms),
      when: formatTime(run.started_at),
      failed: run.status === 'error' || run.status === 'timeout',
      href: `${hrefBase}/${encodeURIComponent(run.id)}`,
      status: run.status,
    };
  });
}

/** Convert StudioActivityRun[] → RunsListRow[] for Studio mode (/studio/runs) */
export function runListRowsFromStudioActivity(
  runs: StudioActivityRun[],
): RunsListRow[] {
  return runs.map((run) => {
    const action = run.action && run.action !== 'run' ? run.action : null;
    const body = [run.app_name, action].filter(Boolean).join(' · ');
    return {
      id: run.id,
      appSlug: run.app_slug,
      appName: run.app_name,
      body,
      // Studio data shape has no inputs/outputs; snippet/output stay null.
      snippet: null,
      output: null,
      duration: formatDuration(run.duration_ms),
      when: formatTime(run.started_at),
      failed: run.status === 'error' || run.status === 'timeout',
      href: `/studio/${run.app_slug}/runs`,
      status: run.status,
    };
  });
}
