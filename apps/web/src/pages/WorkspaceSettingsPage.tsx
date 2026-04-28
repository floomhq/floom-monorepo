// /settings and /settings/general — General tab of Workspace settings.
//
// Part of the settings routing fix (issues #919, #922). All /settings/*
// routes now mount real page components backed by WorkspacePageShell
// mode="settings" (which automatically renders SettingsRail + SettingsTabBar).
//
// This file owns the General tab. Sibling tabs live in:
//   /settings/byok-keys     → MeSecretsPage.tsx   (SettingsByokKeysPage)
//   /settings/agent-tokens  → MeAgentKeysPage.tsx (SettingsAgentTokensPage)
//   /settings/studio        → StudioSettingsPage.tsx   (SettingsStudioPage)

import { WorkspaceHeader, WorkspacePageShell } from '../components/WorkspacePageShell';
import { useSession } from '../hooks/useSession';

export function SettingsGeneralPage() {
  const { data: session } = useSession();
  const ws = session?.active_workspace;
  const wsName = ws?.name ?? 'My workspace';
  const wsSlug = ws?.slug ?? '';
  const mcpEntry = `floom-${wsSlug || wsName.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <WorkspacePageShell mode="settings" title="General · Workspace settings · Floom">
      <WorkspaceHeader
        eyebrow="Workspace settings"
        title="General"
        scope={`Workspace identity and deep-link tab reference for ${wsName}.`}
      />

      <section style={sectionStyle}>
        <h2 style={h2Style}>Workspace identity</h2>
        <p style={mutedStyle}>
          The workspace name appears in the rail, install snippets, and MCP entry name.
        </p>
        <div style={controlGridStyle}>
          <ControlCard label="Name" value={wsName} />
          <ControlCard label="MCP entry" value={mcpEntry} mono />
          <ControlCard label="Default mode" value="Workspace Run" />
        </div>
      </section>

      <section style={{ ...sectionStyle, marginTop: 14 }}>
        <h2 style={h2Style}>Deep-link tabs</h2>
        <p style={mutedStyle}>
          These routes resolve to the same settings page with the matching tab active.
        </p>
        <div style={deepLinkRowStyle}>
          <code style={deepLinkCodeStyle}>
            /settings/byok-keys &middot; /settings/agent-tokens &middot; /settings/studio
          </code>
        </div>
      </section>
    </WorkspacePageShell>
  );
}

// Re-export as WorkspaceSettingsPage for the lazy import in main.tsx.
export function WorkspaceSettingsPage() {
  return <SettingsGeneralPage />;
}

// ---------- Tiny helpers ----------

function ControlCard({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={controlCardStyle}>
      <div style={controlLabelStyle}>{label}</div>
      <div style={mono ? { ...controlValueStyle, fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5 } : controlValueStyle}>
        {value}
      </div>
    </div>
  );
}

// ---------- Styles ----------

const sectionStyle: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 12,
  padding: '20px 22px',
  boxShadow: '0 1px 0 rgba(17,24,39,0.03)',
};

const h2Style: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: 'var(--ink)',
  margin: '0 0 4px',
};

const mutedStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: 'var(--muted)',
  margin: '0 0 14px',
  lineHeight: 1.55,
};

const controlGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
  gap: 10,
};

const controlCardStyle: React.CSSProperties = {
  background: 'var(--bg)',
  border: '1px solid var(--line)',
  borderRadius: 10,
  padding: '10px 14px',
};

const controlLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 4,
};

const controlValueStyle: React.CSSProperties = {
  fontSize: 13.5,
  fontWeight: 600,
  color: 'var(--ink)',
};

const deepLinkRowStyle: React.CSSProperties = {
  background: 'var(--bg)',
  border: '1px solid var(--line)',
  borderRadius: 8,
  padding: '10px 14px',
};

const deepLinkCodeStyle: React.CSSProperties = {
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: 12,
  color: 'var(--muted)',
};
