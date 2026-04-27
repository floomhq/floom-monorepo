// MVP stub: /studio/:slug/renderer — replaced with ComingSoon for launch.

import { useParams } from 'react-router-dom';
import { StudioLayout } from '../components/studio/StudioLayout';
import { StudioAppTabs } from './StudioAppPage';
import { ComingSoon } from '../components/ComingSoon';

export function StudioAppRendererPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  return (
    <StudioLayout title="Source · Studio · Floom" activeAppSlug={slug} activeSubsection="renderer">
      <StudioAppTabs slug={slug} active="source" />
      <ComingSoon feature="Custom renderer" />
    </StudioLayout>
  );
}
