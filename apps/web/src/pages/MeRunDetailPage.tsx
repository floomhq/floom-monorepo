/**
 * /run/runs/:id — MVP stub. Replaced with ComingSoon for launch.
 * Full run detail UI is in development on the v26 branch.
 */

import { WorkspacePageShell } from '../components/WorkspacePageShell';
import { ComingSoon } from '../components/ComingSoon';

export function MeRunDetailPage() {
  return (
    <WorkspacePageShell mode="run" title="Run detail · Floom">
      <ComingSoon feature="Run detail" />
    </WorkspacePageShell>
  );
}
