import type { CSSProperties, ReactNode } from 'react';
import { AppShell } from './AppShell';
import { RunRail } from './RunRail';
import { SettingsRail } from './SettingsRail';
import { SettingsTabBar } from './SettingsTabBar';
import { StudioRail } from './StudioRail';

type Mode = 'run' | 'settings' | 'studio';

interface Props {
  mode: Mode;
  children: ReactNode;
  title?: string;
  allowSignedOutShell?: boolean;
  contentStyle?: CSSProperties;
  mainMaxWidth?: number | string;
}

export function WorkspacePageShell({
  mode,
  children,
  title,
  allowSignedOutShell = false,
  contentStyle,
  // No max-width cap: content fills the available space next to the rail.
  // Callers that need a narrower layout can pass mainMaxWidth explicitly.
  mainMaxWidth = 'none',
}: Props) {
  const rail = mode === 'studio' ? <StudioRail /> : mode === 'settings' ? <SettingsRail /> : <RunRail />;
  // v26: settings pages render a tab bar at top of main area (V26-IA-SPEC §/settings)
  const showSettingsTabs = mode === 'settings';
  // v26 wireframe: studio mode uses var(--studio) warm bg; run/settings use var(--bg)
  const studioBg = mode === 'studio' ? 'var(--studio)' : undefined;

  return (
    <AppShell
      rail={rail}
      title={title}
      allowSignedOutShell={allowSignedOutShell}
      mainMaxWidth={mainMaxWidth}
      background={studioBg ?? 'var(--bg)'}
      contentStyle={contentStyle}
    >
      {showSettingsTabs && <SettingsTabBar />}
      {children}
    </AppShell>
  );
}

export function PageKicker({ children }: { children: ReactNode }) {
  return <div style={kickerStyle}>{children}</div>;
}

export function ScopeLine({ children }: { children: ReactNode }) {
  return <p style={scopeStyle}>{children}</p>;
}

export function WorkspaceHeader({
  eyebrow,
  title,
  scope,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  scope?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header style={headerStyle}>
      <div style={{ minWidth: 0 }}>
        {eyebrow ? <PageKicker>{eyebrow}</PageKicker> : null}
        <h1 style={h1Style}>{title}</h1>
        {scope ? <ScopeLine>{scope}</ScopeLine> : null}
      </div>
      {actions ? <div style={actionsStyle}>{actions}</div> : null}
    </header>
  );
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 16,
  marginBottom: 24,
  flexWrap: 'wrap',
};

const kickerStyle: CSSProperties = {
  fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
  marginBottom: 6,
};

const h1Style: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 34,
  fontWeight: 800,
  letterSpacing: 0,
  lineHeight: 1.05,
  color: 'var(--ink)',
  margin: 0,
};

const scopeStyle: CSSProperties = {
  margin: '8px 0 0',
  fontSize: 14,
  lineHeight: 1.55,
  color: 'var(--muted)',
  maxWidth: 720,
};

const actionsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 10,
  flexWrap: 'wrap',
};
