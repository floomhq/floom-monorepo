// MVP stub: /studio/:slug/access — replaced with ComingSoon for launch.

import { useParams } from 'react-router-dom';
import { StudioLayout } from '../components/studio/StudioLayout';
import { StudioAppTabs } from './StudioAppPage';
import { ComingSoon } from '../components/ComingSoon';

export function StudioAppAccessPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  return (
    <StudioLayout title="Access · Studio · Floom" activeAppSlug={slug} activeSubsection="access">
      <StudioAppTabs slug={slug} active="access" />
      <ComingSoon feature="App access control" />
    </StudioLayout>
  );
}
