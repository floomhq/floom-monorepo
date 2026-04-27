/**
 * /run/runs — MVP stub. Replaced with ComingSoon for launch.
 * Full run history UI is in development on the v26 branch.
 */

import { WorkspacePageShell } from '../components/WorkspacePageShell';
import { ComingSoon } from '../components/ComingSoon';

export function MeRunsPage() {
  return (
    <WorkspacePageShell mode="run" title="Runs · Floom">
      <ComingSoon feature="Run history" />
    </WorkspacePageShell>
  );
}
