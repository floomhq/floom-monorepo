// MeLayout — v17 wireframe-parity /me dashboard shell.
//
// Shared layout for the five /me tabs (Overview, Installed, My runs,
// Secrets, Settings). Renders the page header (serif H1 + subtitle +
// right-side action buttons, provided by each page) then a horizontal
// tab nav with ink-text + underline active state, and tab counts where
// available. At 390px the tab row becomes a horizontal scroller.
//
// Wireframe: https://wireframes.floom.dev/v17/me.html
//   - Serif DM Serif Display H1 (32px desktop, 22px mobile)
//   - Bottom-border tab strip with count pills (monospace 10px, pill 10px)
//   - 1260px max-width container, 28/32px padding
//
// Why not reuse StudioLayout? Studio is the *creator* surface (darker
// background, left rail, per-app drilldown). /me is the *user* surface
// — flat horizontal tabs, 1260px body, consumer chrome via PageShell.

import type { CSSProperties, ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PageShell } from '../PageShell';

export type MeTabId = 'overview' | 'apps' | 'runs' | 'secrets' | 'settings';

interface MeTab {
  id: MeTabId;
  label: string;
  href: string;
  testid: string;
}

// Wireframe label names. "Installed" (not Apps) + "My runs" (not Runs)
// per the MECE rule in v17/me-apps.html: consumer-me lists installed
// apps, Studio lists authored apps.
const TABS: readonly MeTab[] = [
  { id: 'overview', label: 'Overview', href: '/me', testid: 'me-tab-overview' },
  { id: 'apps', label: 'Installed', href: '/me/apps', testid: 'me-tab-apps' },
  { id: 'runs', label: 'My runs', href: '/me/runs', testid: 'me-tab-runs' },
  { id: 'secrets', label: 'Secrets', href: '/me/secrets', testid: 'me-tab-secrets' },
  { id: 'settings', label: 'Settings', href: '/me/settings', testid: 'me-tab-settings' },
] as const;

interface MeLayoutProps {
  /** Active tab id — drives the underline + aria-current. */
  activeTab: MeTabId;
  /** Page <title> injected via PageShell. */
  title?: string;
  /** Forwarded to PageShell — signed-out shell preview for public tabs. */
  allowSignedOutShell?: boolean;
  /** Optional counts rendered in the tab pills (Installed 4, My runs 142, Secrets 3). */
  counts?: Partial<Record<MeTabId, number | null>>;
  /** Header slot: renders ABOVE the tab strip (H1 + subtitle + right-side actions). */
  header?: ReactNode;
  children: ReactNode;
}

const s: Record<string, CSSProperties> = {
  shell: {
    maxWidth: 1260,
    margin: '0 auto',
    padding: '28px 32px 96px',
    width: '100%',
    boxSizing: 'border-box',
  },
  tabStrip: {
    display: 'flex',
    gap: 1,
    borderBottom: '1px solid var(--line)',
    marginBottom: 24,
    overflowX: 'auto' as const,
    WebkitOverflowScrolling: 'touch',
    scrollbarWidth: 'none' as const,
  },
  tabLink: {
    padding: '10px 14px',
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--muted)',
    textDecoration: 'none',
    borderBottom: '2px solid transparent',
    marginBottom: -1,
    whiteSpace: 'nowrap' as const,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    transition: 'color 0.15s ease, border-color 0.15s ease',
    fontFamily: 'inherit',
  },
  tabLinkActive: {
    color: 'var(--ink)',
    borderBottomColor: 'var(--ink)',
    fontWeight: 600,
  },
  tabCount: {
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 10,
    color: 'var(--muted)',
    background: 'var(--card)',
    border: '1px solid var(--line)',
    borderRadius: 10,
    padding: '1px 6px',
    fontWeight: 600,
  },
  tabCountActive: {
    color: 'var(--ink)',
  },
};

export function MeLayout({
  activeTab,
  title,
  allowSignedOutShell = false,
  counts,
  header,
  children,
}: MeLayoutProps) {
  return (
    <PageShell
      requireAuth="cloud"
      title={title || 'Me · Floom'}
      contentStyle={{ padding: 0, maxWidth: 'none', minHeight: 'auto' }}
      allowSignedOutShell={allowSignedOutShell}
      noIndex
    >
      <div data-testid="me-layout" style={s.shell}>
        {header ? <div data-testid="me-header">{header}</div> : null}

        <nav
          role="tablist"
          aria-label="Dashboard tabs"
          data-testid="me-tabs"
          style={s.tabStrip}
        >
          {TABS.map((tab) => {
            const active = tab.id === activeTab;
            const count = counts?.[tab.id];
            const style = active ? { ...s.tabLink, ...s.tabLinkActive } : s.tabLink;
            return (
              <Link
                key={tab.id}
                to={tab.href}
                data-testid={tab.testid}
                aria-current={active ? 'page' : undefined}
                role="tab"
                aria-selected={active}
                style={style}
              >
                {tab.label}
                {typeof count === 'number' ? (
                  <span
                    data-testid={`${tab.testid}-count`}
                    style={active ? { ...s.tabCount, ...s.tabCountActive } : s.tabCount}
                  >
                    {count}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div data-testid="me-tab-panel">{children}</div>
      </div>
    </PageShell>
  );
}

// Fallback used by /me pages when deep sub-paths need to resolve the
// parent tab (e.g. /me/apps/:slug). Exported so analytics + testids stay
// consistent with the MeLayout TABS list.
export function meTabFromPathname(pathname: string): MeTabId {
  if (pathname.startsWith('/me/apps')) return 'apps';
  if (pathname.startsWith('/me/runs')) return 'runs';
  if (pathname.startsWith('/me/secrets')) return 'secrets';
  if (pathname.startsWith('/me/settings') || pathname.startsWith('/me/api-keys')) return 'settings';
  return 'overview';
}

export function useMeTab(): MeTabId {
  const location = useLocation();
  return meTabFromPathname(location.pathname);
}
