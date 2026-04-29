import type { CSSProperties, ReactNode } from 'react';
import { BaseLayout } from './BaseLayout';

interface Props {
  rail: ReactNode;
  children: ReactNode;
  title?: string;
  allowSignedOutShell?: boolean;
  contentStyle?: CSSProperties;
  mainMaxWidth?: number | string;
  background?: string;
}

export function AppShell({
  rail,
  children,
  title,
  allowSignedOutShell = false,
  contentStyle,
  mainMaxWidth = 'none',
  background = 'var(--bg)',
}: Props) {
  return (
    <BaseLayout
      requireAuth="cloud"
      title={title}
      allowSignedOutShell={allowSignedOutShell}
      noIndex
      bareMain
      rootBackground={background}
    >
      <div style={{ ...frameStyle, background }}>
        {rail}
        <main
          id="main"
          className="app-main"
          style={{
            ...mainStyle,
            background,
            maxWidth: mainMaxWidth,
            ...contentStyle,
          }}
        >
          {children}
        </main>
      </div>
    </BaseLayout>
  );
}

const frameStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  height: 'calc(100vh - 56px)',
  minHeight: 0,
  overflow: 'hidden',
};

const mainStyle: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  minWidth: 0,
  minHeight: 0,
  width: '100%',
  boxSizing: 'border-box',
  paddingTop: 24,
  paddingLeft: 28,
  paddingRight: 28,
  // Extra room ensures the cookie banner (position:fixed, bottom:0) never
  // overlaps content. 80px base + --cookie-banner-height (set by
  // CookieBanner.tsx via ResizeObserver; 0px when banner is dismissed).
  paddingBottom: 'calc(80px + var(--cookie-banner-height, 0px))',
};
