/**
 * StudioRail — v26 workspace rail for Studio mode.
 *
 * v26 changes (V26-IA-SPEC §12):
 *   §12.1 — brand logo REMOVED from rail (TopBar carries it)
 *   §12.2 — same shell shape as RunRail ([Run|Studio] toggle below workspace name)
 *   §12.3/12.4 — creation entry point lives in the TopBar;
 *                no standalone "App store" item
 *   §12.5 — Docs removed from rail (moved to avatar dropdown)
 *   §12.6 — workspace settings only via identity-block click (no gear in rail)
 *   Rail: {workspace name ▾} → [Run|Studio] toggle → Apps · Runs →
 *         footer
 */

import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { LayoutGrid, Play } from 'lucide-react';
import { WorkspaceIdentityBlock } from './WorkspaceIdentityBlock';
import { ModeToggle } from './ModeToggle';
import {
  RailFoot,
  RailItem,
  bodyStyle,
  headStyle,
  railStyle,
} from './RunRail';
import * as api from '../api/client';
import type { StudioAppSummary } from '../lib/types';

export function StudioRail() {
  const location = useLocation();
  const [apps, setApps] = useState<StudioAppSummary[] | null>(null);
  const firstSegment = location.pathname.match(/^\/studio\/([^/]+)/)?.[1];
  const activeSlug =
    firstSegment && !['apps', 'runs', 'build', 'new', 'overview'].includes(firstSegment)
      ? firstSegment
      : undefined;

  useEffect(() => {
    let cancelled = false;
    api
      .getStudioStats()
      .then((stats) => {
        if (!cancelled) setApps(stats.apps.items);
      })
      .catch(() => {
        if (!cancelled) setApps([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <aside data-testid="studio-rail" aria-label="Studio navigation" style={railStyle}>
      {/* v26 §12.1: no brand here — TopBar carries the floom logo */}
      <div style={headStyle}>
        <WorkspaceIdentityBlock />
        <ModeToggle activeMode="studio" />
      </div>
      <div style={bodyStyle}>
        {/* Primary nav items */}
        <RailItem
          to="/studio/apps"
          active={
            location.pathname === '/studio/apps' ||
            (!!activeSlug && location.pathname.startsWith('/studio/'))
          }
          icon={<LayoutGrid size={15} />}
          count={apps?.length}
        >
          Apps
        </RailItem>
        <RailItem
          to="/studio/runs"
          active={
            location.pathname === '/studio/runs' ||
            location.pathname.startsWith('/studio/runs/')
          }
          icon={<Play size={15} />}
        >
          Runs
        </RailItem>
      </div>
      <RailFoot />
    </aside>
  );
}
