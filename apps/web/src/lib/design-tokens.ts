// Design tokens — small, honest, YAGNI.
//
// This file exists to kill the last repeated hardcoded values that show
// up across the nav + sidebar chrome (the 2026-04-20 nav unification).
// It is NOT a full design system. When a value is only in one place, it
// stays there. When a value repeats, it moves here.
//
// Color palette proper lives in CSS variables (:root in wireframe.css):
// --ink, --muted, --accent, --line, --card, --bg. Use those by default.
// This file exports the stragglers that are not yet in the palette.

export const colors = {
  /** Darker creator surface (Studio sidebar + main bg). Was duplicated
   *  in StudioLayout.tsx (x2) + StudioSidebar.tsx (x2) pre-unification. */
  sidebarBg: '#F5F5F1',
} as const;

export const spacing = {
  /** Default TopBar height. Also informs min-height math in layouts
   *  (e.g. `calc(100vh - 56px)` for sticky sidebars). */
  headerHeight: 56,
  /** Compact TopBar height used by AppPermalinkPage mid-run. */
  headerHeightCompact: 40,
} as const;
