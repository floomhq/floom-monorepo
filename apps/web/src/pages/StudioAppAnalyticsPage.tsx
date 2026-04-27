// MVP stub: /studio/:slug/analytics — replaced with ComingSoon for launch.

import { useParams } from 'react-router-dom';
import { StudioLayout } from '../components/studio/StudioLayout';
import { StudioAppTabs } from './StudioAppPage';
import { ComingSoon } from '../components/ComingSoon';

export function StudioAppAnalyticsPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  return (
    <StudioLayout title="Analytics · Studio · Floom" activeAppSlug={slug} activeSubsection="analytics">
      <StudioAppTabs slug={slug} active="analytics" />
      <ComingSoon feature="App analytics" />
    </StudioLayout>
  );
}
