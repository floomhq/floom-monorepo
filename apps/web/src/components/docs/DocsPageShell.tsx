// v26 V17 — Docs layout shell.
//
// Mirrors the WorkspacePageShell pattern: flex row, sidebar has an explicit
// fixed width + flexShrink:0 so it never shifts regardless of content width
// in the article column. Previously both DocsLandingPage and DocsPage used
// CSS grid with `minmax(0,1fr)` on the content column, which reflows the
// grid on navigation and can cause a visible sidebar x-shift.
//
// Layout spec (no docs wireframe in v26 — mirrors WorkspacePageShell):
//   - Sidebar: 260px fixed, flexShrink: 0, sticky
//   - Content: flex:1, minWidth:0, max-width capped at 1000px for readability
//   - Container: max-width 1280, margin 0 auto, flush padding
//
// DocsSidebar and DocsPublishWaitlistBanner are NOT rendered here — they
// are passed as children so each page controls its own sidebar+banner.

import type { CSSProperties, ReactNode } from 'react';

interface Props {
  sidebar: ReactNode;
  children: ReactNode;
  banner?: ReactNode;
}

const containerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  maxWidth: 1280,
  margin: '0 auto',
  width: '100%',
  boxSizing: 'border-box',
};

export const DOCS_SIDEBAR_WIDTH = 260;

// R19 (2026-04-28): make the sidebar wrapper itself sticky so the
// sidebar stays in view as the article column scrolls. Previously
// the inner <aside> in DocsSidebar.tsx was sticky, but a flex item
// that wraps a sticky child only works while the wrapper is at least
// as tall as the article — and on short pages the sticky sidebar
// would unsticky and disappear when the user scrolled past the
// shell. Sticky on the wrapper anchors the column to viewport top
// (offset by the 56px TopBar), and `align-self: flex-start` keeps it
// from stretching to full content height.
const sidebarWrapStyle: CSSProperties = {
  width: DOCS_SIDEBAR_WIDTH,
  flexShrink: 0,
  position: 'sticky',
  top: 56,
  alignSelf: 'flex-start',
  maxHeight: 'calc(100vh - 56px)',
  overflowY: 'auto',
};

const contentStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
};

export function DocsPageShell({ sidebar, children, banner }: Props) {
  return (
    <div className="docs-shell-v26">
      {banner}
      <main id="main" className="docs-shell-v26__grid" style={containerStyle}>
        {/* R13 (2026-04-28): inline <style> migrated to
            styles/csp-inline-style-migrations.css for CSP compliance. */}
        <div className="docs-shell-v26__sidebar" style={sidebarWrapStyle}>
          {sidebar}
        </div>
        <div className="docs-shell-v26__content" style={contentStyle}>
          {children}
        </div>
      </main>
    </div>
  );
}
