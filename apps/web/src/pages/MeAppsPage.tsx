// MVP stub: /run/apps — replaced with ComingSoon for launch.

import { WorkspacePageShell } from '../components/WorkspacePageShell';
import { ComingSoon } from '../components/ComingSoon';

export function MeAppsPage() {
  return (
    <WorkspacePageShell mode="run" title="Apps · Floom">
      <ComingSoon feature="Apps dashboard" />
    </WorkspacePageShell>
  );
}
