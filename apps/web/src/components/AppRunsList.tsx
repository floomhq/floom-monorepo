// AppRunsList — shared per-app run list table. Used by:
//   - StudioAppRunsPage    (creator: full owner-scoped runs via getAppRuns)
//   - MeAppHistoryPage     (consumer: caller's own runs filtered by slug)
//
// The Studio page calls /api/hub/:slug/runs (CreatorRun shape) and the
// consumer page uses /api/me/runs (MeRunSummary shape). Both shapes
// expose the four columns we render: started_at, action, status,
// duration_ms — so this component takes a normalized projection.

import { Link } from 'react-router-dom';
import { formatTime } from '../lib/time';

export interface AppRunRow {
  id: string;
  started_at: string;
  action: string;
  status: string;
  duration_ms: number | null;
  /**
   * Where the row click navigates. Studio rows use `/me/runs/:id`
   * (the canonical run-detail page); consumer rows can use the same
   * or `/run/runs/:id` for the v26 shell — caller decides.
   */
  href: string;
}

interface Props {
  /**
   * Normalized rows. Pass `null` to render the loading placeholder.
   */
  rows: AppRunRow[] | null;
  /**
   * Empty-state copy for "no runs found". Caller controls the exact
   * wording to match Studio vs. consumer voice.
   */
  emptyTitle: string;
  emptyBody: React.ReactNode;
  testId?: string;
}

export function AppRunsList({ rows, emptyTitle, emptyBody, testId }: Props) {
  if (!rows) {
    return (
      <div
        data-testid={testId ? `${testId}-loading` : 'app-runs-loading'}
        style={{ fontSize: 13, color: 'var(--muted)' }}
      >
        Loading…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div
        data-testid={testId ? `${testId}-empty` : 'app-runs-empty'}
        style={emptyState}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
          {emptyTitle}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>{emptyBody}</div>
      </div>
    );
  }

  return (
    <div
      data-testid={testId ?? 'app-runs-list'}
      style={{
        border: '1px solid var(--line)',
        borderRadius: 10,
        background: 'var(--card)',
        overflow: 'hidden',
      }}
    >
      <div style={tableHeaderStyle}>
        <span>Started</span>
        <span>Action</span>
        <span>Status</span>
        <span style={{ textAlign: 'right' }}>Time</span>
      </div>
      {rows.map((r) => (
        <Link key={r.id} to={r.href} style={tableRowStyle}>
          <span>{formatTime(r.started_at)}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
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

const emptyState: React.CSSProperties = {
  border: '1px dashed var(--line)',
  borderRadius: 10,
  padding: '24px 20px',
  background: 'var(--card)',
};

const tableHeaderStyle: React.CSSProperties = {
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
};

const tableRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1.5fr 1fr 1fr 80px',
  gap: 8,
  padding: '12px 16px',
  borderBottom: '1px solid var(--line)',
  fontSize: 13,
  color: 'var(--ink)',
  textDecoration: 'none',
  alignItems: 'center',
};
