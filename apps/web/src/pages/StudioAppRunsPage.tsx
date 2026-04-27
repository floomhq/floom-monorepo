// MVP stub: /studio/:slug/runs — replaced with ComingSoon for launch.

import { useParams } from 'react-router-dom';
import { StudioLayout } from '../components/studio/StudioLayout';
import { StudioAppTabs } from './StudioAppPage';
import { ComingSoon } from '../components/ComingSoon';

export function StudioAppRunsPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  return (
    <StudioLayout title="Runs · Studio · Floom" activeAppSlug={slug} activeSubsection="runs">
      <StudioAppTabs slug={slug} active="runs" />
      <ComingSoon feature="App run history" />
    </StudioLayout>
  );
}
