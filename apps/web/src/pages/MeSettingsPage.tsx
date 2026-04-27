// MVP stub: /settings/general — replaced with ComingSoon for launch.

import { WorkspacePageShell } from '../components/WorkspacePageShell';
import { ComingSoon } from '../components/ComingSoon';

export function AccountSettingsPage() {
  return (
    <WorkspacePageShell mode="settings" title="Account settings · Floom">
      <ComingSoon feature="Account settings" />
    </WorkspacePageShell>
  );
}

export function MeSettingsPage() {
  return <AccountSettingsPage />;
}
