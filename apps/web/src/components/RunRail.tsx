/**
 * RunRail — v26 workspace rail for Run mode.
 *
 * v26 changes (V26-IA-SPEC §12):
 *   §12.1 — brand logo REMOVED from rail (TopBar carries it)
 *   §12.2 — [Run|Studio] mode toggle pill below workspace name
 *   §12.3/12.4 — no standalone "App store" item; "+ New app" is the single
 *                entry point; in Run mode it opens an overlay
 *   §12.5 — Docs removed from rail (moved to avatar dropdown)
 *   §12.6 — workspace settings only via identity-block click
 *   Rail: {workspace name ▾} → [Run|Studio] toggle → Apps · Runs → footer
 */

import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Box, Play, Plus, Settings as SettingsIcon } from 'lucide-react';
import { WorkspaceIdentityBlock } from './WorkspaceIdentityBlock';
import { ModeToggle } from './ModeToggle';
// V13 fix: rail's "Apps" count is now sourced from /api/hub/installed via
// useInstalledApps — same source RunAppsPage reads — so rail and content
// stat agree (was: rail = unique app_slugs in run history, content =
// installed merged with run-only slugs, mismatched whenever a user
// installed without running or ran without installing).
import { useInstalledApps } from '../hooks/useInstalledApps';

const RAIL_WIDTH = 240;

export function RunRail() {
  const location = useLocation();
  const { apps } = useInstalledApps();
  const appsCount = apps ? apps.length : null;

  return (
    <aside data-testid="run-rail" aria-label="Run navigation" style={railStyle}>
      {/* v26 §12.1: no brand here — TopBar carries the floom logo */}
      <div style={headStyle}>
        <WorkspaceIdentityBlock />
        <ModeToggle activeMode="run" />
      </div>
      <div style={bodyStyle}>
        <RailItem
          to="/run/apps"
          active={
            location.pathname === '/run/apps' ||
            location.pathname.startsWith('/run/apps/')
          }
          icon={<Box size={15} />}
          count={appsCount ?? undefined}
        >
          Apps
        </RailItem>
        <RailItem
          to="/run/runs"
          active={
            location.pathname === '/run/runs' ||
            location.pathname.startsWith('/run/runs/')
          }
          icon={<Play size={15} />}
        >
          Runs
        </RailItem>

        {/* v26 §12.3/12.4: "+ New app" in Run mode → browse store (overlay in v1.1) */}
        <div style={{ marginTop: 'auto', paddingTop: 12 }}>
          <Link
            to="/apps"
            data-testid="run-rail-new-app"
            style={runPrimaryCtaStyle}
          >
            <Plus size={14} aria-hidden="true" />
            <span>New app</span>
          </Link>
        </div>
      </div>
      {/* v26 §12.5 + §12.6: no rail-bottom avatar or sign-out.
          Avatar dropdown lives in TopBar only (Account settings · Docs · Help · Sign out). */}
    </aside>
  );
}

/**
 * Rail footer: Settings shortcut + local time/timezone.
 *
 * Federico 2026-04-29: requested settings icon + time/tz at bottom-left after
 * the prior V2 cleanup left the rail bottom empty. Avatar + Sign out still
 * live in the TopBar dropdown only (per §12.5 + §12.6); this is just a quick
 * Settings shortcut and an at-a-glance "where am I" time display.
 */
export function RailFoot() {
  const now = useRailClock();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tzCity = tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
  const time = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return (
    <div style={railFootStyle}>
      <Link to="/me/settings" style={railFootLinkStyle} aria-label="Settings">
        <SettingsIcon size={14} aria-hidden="true" />
        <span>Settings</span>
      </Link>
      <div style={railFootMetaStyle}>
        {time} · {tzCity}
      </div>
    </div>
  );
}

function useRailClock(intervalMs = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const railFootStyle: CSSProperties = {
  borderTop: '1px solid var(--line)',
  padding: '10px 12px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const railFootLinkStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  color: 'var(--muted)',
  textDecoration: 'none',
  fontSize: 13,
  fontWeight: 500,
  padding: '4px 0',
};

const railFootMetaStyle: CSSProperties = {
  color: 'var(--muted)',
  fontSize: 11,
  letterSpacing: 0.2,
  paddingLeft: 22,
  fontVariantNumeric: 'tabular-nums',
};

/** Kept for backward-compat imports only (StudioRail used to import Brand). */
export function Brand({ to, label, tag }: { to: string; label: string; tag?: string }) {
  return (
    <Link to={to} style={brandStyle}>
      <span style={brandNameStyle}>{label}</span>
      {tag ? <span style={brandTagStyle}>{tag}</span> : null}
    </Link>
  );
}

export function RailSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section style={sectionStyle}>
      <div style={sectionLabelStyle}>{label}</div>
      {children}
    </section>
  );
}

export function RailItem({
  to,
  active,
  icon,
  count,
  children,
}: {
  to: string;
  active: boolean;
  icon: ReactNode;
  count?: number | null;
  children: ReactNode;
}) {
  return (
    <Link to={to} aria-current={active ? 'page' : undefined} style={itemStyle(active)}>
      <span style={iconStyle}>{icon}</span>
      <span style={itemTextStyle}>{children}</span>
      {typeof count === 'number' ? (
        <span style={countStyle}>{count}</span>
      ) : null}
    </Link>
  );
}

const runPrimaryCtaStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
  padding: '9px 12px',
  borderRadius: 8,
  background: 'var(--ink)',
  border: '1px solid var(--ink)',
  color: '#fff',
  textDecoration: 'none',
  fontSize: 13,
  fontWeight: 700,
  width: '100%',
  boxSizing: 'border-box' as const,
};

export const railStyle: CSSProperties = {
  width: RAIL_WIDTH,
  flexShrink: 0,
  borderRight: '1px solid var(--line)',
  background: 'var(--bg)',
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  position: 'sticky',
  top: 0,
  overflow: 'hidden',
};

export const headStyle: CSSProperties = {
  padding: '16px 14px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

export const bodyStyle: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '6px 10px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const brandStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  color: 'var(--ink)',
  textDecoration: 'none',
  minHeight: 24,
};

const brandNameStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 800,
  lineHeight: 1,
};

const brandTagStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--muted)',
  lineHeight: 1,
};

const sectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const sectionLabelStyle: CSSProperties = {
  fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--muted)',
  padding: '0 10px 3px',
};

const iconStyle: CSSProperties = {
  width: 18,
  height: 18,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const itemTextStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const countStyle: CSSProperties = {
  fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 10,
  color: 'var(--muted)',
  marginLeft: 'auto',
};

function itemStyle(active: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    padding: '9px 10px',
    borderRadius: 8,
    color: active ? 'var(--ink)' : 'var(--muted)',
    background: active ? 'var(--card)' : 'transparent',
    border: active ? '1px solid var(--line)' : '1px solid transparent',
    textDecoration: 'none',
    fontSize: 13,
    fontWeight: active ? 700 : 600,
  };
}
