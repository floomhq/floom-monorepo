/**
 * RunAppTabs — 3-item per-app tab bar for /run/apps/:slug/* pages.
 *
 * V26-IA-SPEC: consumer run context tabs. Rendered at the top of the
 * content area for each /run/apps/:slug sub-page. Mirrors StudioAppTabs
 * but scoped to the consumer (Run mode) surface with only Run + Triggers.
 * A "View runs →" cross-link is rendered inline as the third item.
 */

import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';

export type RunAppTab = 'run' | 'triggers' | 'secrets';

interface Props {
  slug: string;
  activeTab: RunAppTab;
}

const wrapStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 0,
  borderBottom: '1px solid var(--line)',
  marginBottom: 24,
  overflowX: 'auto',
};

function tabStyle(active: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '10px 14px',
    fontSize: 13,
    fontWeight: active ? 700 : 500,
    color: active ? 'var(--accent, #047857)' : 'var(--muted)',
    textDecoration: 'none',
    borderBottom: active ? '2px solid var(--accent, #047857)' : '2px solid transparent',
    marginBottom: -1,
    whiteSpace: 'nowrap' as const,
    transition: 'color 0.1s',
  };
}

const crossLinkStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '10px 14px',
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--accent, #047857)',
  textDecoration: 'none',
  borderBottom: '2px solid transparent',
  marginBottom: -1,
  whiteSpace: 'nowrap' as const,
  marginLeft: 'auto',
};

export function RunAppTabs({ slug, activeTab }: Props) {
  return (
    <nav
      style={wrapStyle}
      aria-label="Run app tabs"
      data-testid="run-app-tabs"
    >
      <Link
        to={`/run/apps/${slug}/run`}
        style={tabStyle(activeTab === 'run')}
        aria-current={activeTab === 'run' ? 'page' : undefined}
        data-testid="run-app-tab-run"
      >
        Run
      </Link>
      <Link
        to={`/run/apps/${slug}/triggers`}
        style={tabStyle(activeTab === 'triggers')}
        aria-current={activeTab === 'triggers' ? 'page' : undefined}
        data-testid="run-app-tab-triggers"
      >
        Triggers
      </Link>
      <Link
        to={`/run/runs?app=${slug}`}
        style={crossLinkStyle}
        data-testid="run-app-tab-view-runs"
        aria-label={`View all runs for this app`}
      >
        View runs for this app →
      </Link>
    </nav>
  );
}
