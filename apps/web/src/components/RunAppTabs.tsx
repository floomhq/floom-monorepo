/**
 * RunAppTabs — per-app tab bar for /run/apps/:slug/* pages.
 *
 * V26-IA-SPEC: consumer run context tabs. Rendered at the top of the
 * content area for each /run/apps/:slug sub-page. Mirrors StudioAppTabs
 * but scoped to the consumer (Run mode) surface.
 *
 * Tabs (left-to-right):
 *   - Run        — the run surface itself
 *   - Triggers   — schedule/webhook setup
 *   - History    — runs of THIS app (issue #1084, was an inline cross-link)
 *   - Feedback   — leave/read reviews (issue #1083)
 */

import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';

export type RunAppTab = 'run' | 'triggers' | 'history' | 'feedback' | 'secrets';

interface Props {
  slug: string;
  activeTab: RunAppTab;
}

interface TabDef {
  id: RunAppTab;
  label: string;
  to: (slug: string) => string;
}

const TABS: TabDef[] = [
  { id: 'run',      label: 'Run',      to: (s) => `/run/apps/${s}/run` },
  { id: 'triggers', label: 'Triggers', to: (s) => `/run/apps/${s}/triggers` },
  { id: 'history',  label: 'History',  to: (s) => `/run/apps/${s}/history` },
  { id: 'feedback', label: 'Feedback', to: (s) => `/run/apps/${s}/feedback` },
];

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

export function RunAppTabs({ slug, activeTab }: Props) {
  return (
    <nav
      style={wrapStyle}
      aria-label="Run app tabs"
      data-testid="run-app-tabs"
    >
      {TABS.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <Link
            key={tab.id}
            to={tab.to(slug)}
            style={tabStyle(active)}
            aria-current={active ? 'page' : undefined}
            data-testid={`run-app-tab-${tab.id}`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
