// MVP stub: /studio/build — replaced with ComingSoon for launch.

import { WorkspacePageShell } from '../components/WorkspacePageShell';
import { ComingSoon } from '../components/ComingSoon';

export function StudioBuildPage() {
  return (
    <WorkspacePageShell mode="studio" title="Build · Studio · Floom">
      <ComingSoon feature="App builder" />
    </WorkspacePageShell>
  );
}
