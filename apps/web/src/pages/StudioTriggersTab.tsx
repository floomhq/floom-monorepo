// MVP stub: /studio/:slug/triggers — replaced with ComingSoon for launch.

import { useParams } from 'react-router-dom';
import { StudioLayout } from '../components/studio/StudioLayout';
import { StudioAppTabs } from './StudioAppPage';
import { ComingSoon } from '../components/ComingSoon';

export function StudioAppTriggersPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  return (
    <StudioLayout title="Triggers · Studio · Floom" activeAppSlug={slug} activeSubsection="triggers">
      <StudioAppTabs slug={slug} active="triggers" />
      <ComingSoon feature="Triggers" />
    </StudioLayout>
  );
}

export function StudioTriggersTab() {
  return <StudioAppTriggersPage />;
}
