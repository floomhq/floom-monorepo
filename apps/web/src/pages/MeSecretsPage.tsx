// MVP stub: /settings/byok-keys — replaced with ComingSoon for launch.

import { WorkspacePageShell } from '../components/WorkspacePageShell';
import { ComingSoon } from '../components/ComingSoon';

export function SettingsByokKeysPage() {
  return (
    <WorkspacePageShell mode="settings" title="BYOK Keys · Settings · Floom">
      <ComingSoon feature="BYOK keys" />
    </WorkspacePageShell>
  );
}

export function MeSecretsPage() {
  return <SettingsByokKeysPage />;
}
