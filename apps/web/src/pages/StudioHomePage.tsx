// MVP stub: /studio/overview and /studio/apps — replaced with ComingSoon for launch.

import { WorkspacePageShell } from '../components/WorkspacePageShell';
import { ComingSoon } from '../components/ComingSoon';

/** Legacy v25 home — kept at /studio/overview for back-compat. */
export function StudioHomePage() {
  return (
    <WorkspacePageShell mode="studio" title="Studio · Floom">
      <ComingSoon feature="Studio" />
    </WorkspacePageShell>
  );
}

export function StudioAppsPage() {
  return (
    <WorkspacePageShell mode="studio" title="Studio apps · Floom">
      <ComingSoon feature="Studio apps" />
    </WorkspacePageShell>
  );
}
