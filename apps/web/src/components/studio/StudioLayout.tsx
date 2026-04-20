// StudioLayout — creator workspace shell used by every /studio/* page.
//
// This is now a thin wrapper over <BaseLayout> (2026-04-20 nav
// unification). BaseLayout owns the TopBar + auth gating + route
// loading, so those behaviors stay identical between Store and Studio.
// StudioLayout's job is just to pass in the sidebar, the darker
// background, and the studio-specific <main> padding/max-width.
//
// The mobile drawer (hamburger at bottom-left that opens the sidebar
// on <900px) stays here because it is a Studio-specific affordance.
// The TopBar itself keeps its normal hamburger on <640px.
//
// Shape: TopBar + left sidebar (240px fixed desktop, drawer on mobile)
// + darker main surface on `colors.sidebarBg`. Auth-gates cloud-only.

import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { BaseLayout } from '../BaseLayout';
import { StudioSidebar } from './StudioSidebar';
import { useSession } from '../../hooks/useSession';
import { colors } from '../../lib/design-tokens';

interface Props {
  children: ReactNode;
  title?: string;
  activeAppSlug?: string;
  activeSubsection?: 'overview' | 'runs' | 'secrets' | 'access' | 'renderer' | 'analytics' | 'triggers';
  contentStyle?: CSSProperties;
  allowSignedOutShell?: boolean;
}

export function StudioLayout({
  children,
  title,
  activeAppSlug,
  activeSubsection,
  contentStyle,
  allowSignedOutShell = false,
}: Props) {
  const { data } = useSession();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const signedOutCloud = !!data && data.cloud_mode && data.user.is_local;
  const showSignedOutPreview = signedOutCloud && allowSignedOutShell;

  // Close mobile drawer on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <BaseLayout
      title={title}
      requireAuth="cloud"
      allowSignedOutShell={allowSignedOutShell}
      rootBackground={colors.sidebarBg}
      sidebar={
        <div className="studio-sidebar-wrap" style={{ display: 'contents' }}>
          <StudioSidebar
            activeAppSlug={activeAppSlug}
            activeSubsection={activeSubsection}
            signedOutPreview={showSignedOutPreview}
          />
        </div>
      }
      mainStyle={{
        flex: 1,
        padding: '28px 40px 120px',
        maxWidth: 1100,
        margin: '0 auto',
        width: '100%',
        minWidth: 0,
        ...contentStyle,
      }}
    >
      {/* Mobile drawer toggle (sidebar is hidden <900px). Shown via
          CSS on narrow viewports only. */}
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="Open Studio menu"
        data-testid="studio-mobile-toggle"
        className="studio-mobile-toggle"
        style={{
          position: 'fixed',
          bottom: 18,
          left: 18,
          width: 44,
          height: 44,
          borderRadius: 22,
          border: '1px solid var(--line)',
          background: 'var(--ink)',
          color: '#fff',
          fontSize: 16,
          fontFamily: 'inherit',
          cursor: 'pointer',
          zIndex: 30,
          display: 'none',
        }}
      >
        ☰
      </button>

      {menuOpen && (
        <div
          role="presentation"
          onClick={() => setMenuOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 40,
            background: 'rgba(14,14,12,0.4)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'absolute', top: 0, left: 0, height: '100%' }}
          >
            <StudioSidebar
              activeAppSlug={activeAppSlug}
              activeSubsection={activeSubsection}
              signedOutPreview={showSignedOutPreview}
            />
          </div>
        </div>
      )}

      {children}
    </BaseLayout>
  );
}
