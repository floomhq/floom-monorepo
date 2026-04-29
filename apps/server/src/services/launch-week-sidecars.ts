// Launch Week sidecar lifecycle.
//
// These are pure Node proxied-mode examples used as public launch proof
// objects. At boot, Floom forks their HTTP servers, writes a runtime apps.yaml
// with the actual local ports, and ingests them as active proxied apps.
//
// Opt-in: FLOOM_LAUNCH_WEEK_APPS=true.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db.js';
import { ingestOpenApiApps } from './openapi-ingest.js';
import type { NormalizedManifest, OutputSpec } from '../types.js';

const HOST = process.env.FLOOM_LAUNCH_WEEK_HOST || '127.0.0.1';

interface LaunchWeekApp {
  slug: string;
  display_name: string;
  description: string;
  category: string;
  openapiPath: string;
  featured?: boolean;
  /**
   * R38 fix: when present, the first action's outputs in the DB manifest
   * are replaced with these declared specs after OpenAPI ingest. This is
   * required for Python FastAPI sidecars whose auto-generated operationIds
   * (e.g. `analyze_route_analyze_post`) cause `openapi-ingest` to store
   * `outputs: [{name:'response',type:'json'}]` — a generic fallback that
   * prevents the renderer cascade from picking the multi-section composite
   * card and loses the Download CSV button.
   */
  manifestOutputs?: OutputSpec[];
}

interface LaunchWeekSidecar {
  name: string;
  script: string;
  port: number;
  healthPath: string;
  apps: LaunchWeekApp[];
  /**
   * Optional command override for non-Node sidecars. Defaults to
   * `[process.execPath, script]` (Node.js). For Python sidecars set to
   * e.g. `['python3', script]`.
   */
  cmd?: readonly string[];
}

const SIDECARS: LaunchWeekSidecar[] = [
  {
    name: 'launch-scorecards',
    script: 'examples/launch-scorecards/server.mjs',
    port: Number(process.env.LAUNCH_SCORECARDS_PORT || 4120),
    healthPath: '/health',
    apps: [
      {
        slug: 'linkedin-roaster',
        display_name: 'LinkedIn Roaster',
        description:
          'Paste a LinkedIn profile URL and get sharper positioning, headline, About rewrite, and post ideas.',
        category: 'marketing',
        openapiPath: '/linkedin-roaster/openapi.json',
        featured: true,
      },
      {
        slug: 'yc-pitch-deck-critic',
        display_name: 'YC Pitch Deck Critic',
        description:
          'Upload a pitch deck outline or text export and get YC-style objections, rewrites, and next steps.',
        category: 'fundraising',
        openapiPath: '/yc-pitch-deck-critic/openapi.json',
        featured: true,
      },
    ],
  },
  {
    name: 'hook-stats',
    script: 'examples/hook-stats/server.mjs',
    port: Number(process.env.HOOK_STATS_PORT || 4110),
    healthPath: '/health',
    apps: [
      {
        slug: 'hook-stats',
        display_name: 'Hook Stats',
        description:
          'Upload a Claude Code bash-commands.log and get top commands, git stats, and per-day activity.',
        category: 'productivity',
        openapiPath: '/openapi.json',
        featured: true,
      },
    ],
  },
  {
    name: 'claude-wrapped',
    script: 'examples/claude-wrapped/server.mjs',
    port: Number(process.env.CLAUDE_WRAPPED_PORT || 4111),
    healthPath: '/health',
    apps: [
      {
        slug: 'claude-wrapped',
        display_name: 'Claude Wrapped',
        description:
          'Spotify Wrapped for Claude Code. Upload exported session files and visualize AI coding stats.',
        category: 'productivity',
        openapiPath: '/openapi.json',
        featured: true,
      },
    ],
  },
  {
    name: 'session-recall',
    script: 'examples/session-recall/server.mjs',
    port: Number(process.env.SESSION_RECALL_PORT || 4112),
    healthPath: '/health',
    apps: [
      {
        slug: 'session-recall',
        display_name: 'Session Recall',
        description:
          'Upload a Claude Code session file and search, recall, or generate a retry-loop report.',
        category: 'productivity',
        openapiPath: '/openapi.json',
        featured: true,
      },
    ],
  },
  {
    name: 'floom-this',
    script: 'examples/floom-this/server.mjs',
    port: Number(process.env.FLOOM_THIS_PORT || 4122),
    healthPath: '/health',
    apps: [
      {
        slug: 'floom-this',
        display_name: 'Floom This',
        description:
          'Paste a GitHub repo URL and get the Floom app shape: inputs, outputs, build plan, and next step.',
        category: 'developer-tools',
        openapiPath: '/floom-this/openapi.json',
        featured: true,
      },
    ],
  },
  // R37 (2026-04-29): pitch-coach, competitor-lens, ai-readiness-audit ported
  // from docker-runtime to proxy-runtime. Python FastAPI sidecars forked here
  // instead of building Docker images. Unhides the 3 slugs from the public
  // catalog and removes the /p/:slug "launching soon" gate in AppPermalinkPage.
  {
    name: 'pitch-coach',
    script: 'examples/pitch-coach/server.py',
    cmd: ['python3', 'examples/pitch-coach/server.py'],
    port: Number(process.env.PITCH_COACH_PORT || 4130),
    healthPath: '/health',
    apps: [
      {
        slug: 'pitch-coach',
        display_name: 'Pitch Coach',
        description:
          'Paste a 20-500 char startup pitch. Get 3 direct critiques, 3 angle-specific rewrites, and a 1-line TL;DR of the biggest issue. Under 5 seconds.',
        category: 'writing',
        openapiPath: '/openapi.json',
        featured: true,
        // R38 fix: same as competitor-lens — restore declared outputs.
        manifestOutputs: [
          { name: 'harsh_truth', label: 'Harsh Truth', type: 'json' },
          { name: 'rewrites', label: 'Rewrites', type: 'json' },
          { name: 'one_line_tldr', label: 'Biggest Issue', type: 'text' },
          { name: 'model', label: 'Model', type: 'text' },
        ],
      },
    ],
  },
  {
    name: 'competitor-lens',
    script: 'examples/competitor-lens/server.py',
    cmd: ['python3', 'examples/competitor-lens/server.py'],
    port: Number(process.env.COMPETITOR_LENS_PORT || 4131),
    healthPath: '/health',
    apps: [
      {
        slug: 'competitor-lens',
        display_name: 'Competitor Lens',
        description:
          'Paste 2 URLs (yours + one competitor). Get the positioning, pricing, and angle diff in under 5 seconds.',
        category: 'research',
        openapiPath: '/openapi.json',
        featured: true,
        // R38 fix: restore declared outputs so the renderer cascade picks the
        // multi-section CompositeOutputCard (positioning table + pricing table
        // + pricing_insight text + unique arrays) instead of falling through to
        // the generic KeyValueTable. Without this, autoPick looks for
        // outObj['response'] (the generic OpenAPI fallback) which is always
        // undefined, and the Download CSV button never renders.
        manifestOutputs: [
          { name: 'positioning', label: 'Positioning', type: 'table' },
          { name: 'pricing', label: 'Pricing', type: 'table' },
          { name: 'pricing_insight', label: 'Pricing Insight', type: 'text' },
          { name: 'unique_to_you', label: 'Unique To You', type: 'json' },
          { name: 'unique_to_competitor', label: 'Unique To Competitor', type: 'json' },
          { name: 'meta', label: 'Meta', type: 'json' },
        ],
      },
    ],
  },
  {
    name: 'ai-readiness-audit',
    script: 'examples/ai-readiness-audit/server.py',
    cmd: ['python3', 'examples/ai-readiness-audit/server.py'],
    port: Number(process.env.AI_READINESS_AUDIT_PORT || 4132),
    healthPath: '/health',
    apps: [
      {
        slug: 'ai-readiness-audit',
        display_name: 'AI Readiness Audit',
        description:
          'Paste a company URL. Get a readiness score, 3 risks, 3 opportunities, and one concrete next step.',
        category: 'research',
        openapiPath: '/openapi.json',
        featured: true,
        // R38 fix: same as competitor-lens — restore declared outputs so the
        // renderer cascade picks the multi-section composite card.
        manifestOutputs: [
          { name: 'company_url', label: 'Audited URL', type: 'text' },
          { name: 'readiness_score', label: 'Readiness Score', type: 'number' },
          { name: 'score_rationale', label: 'Score Rationale', type: 'text' },
          { name: 'risks', label: 'Risks', type: 'json' },
          { name: 'opportunities', label: 'Opportunities', type: 'json' },
          { name: 'next_action', label: 'Next Action', type: 'text' },
          { name: 'model', label: 'Model', type: 'text' },
        ],
      },
    ],
  },
];

const children = new Map<string, ChildProcess>();
let shuttingDown = false;
let restartTimer: NodeJS.Timeout | null = null;
let signalHandlersInstalled = false;
let healWatcher: NodeJS.Timeout | null = null;

function isEnabled(): boolean {
  const raw = process.env.FLOOM_LAUNCH_WEEK_APPS;
  if (raw === undefined || raw === '') return false;
  return /^(1|true|yes|on)$/i.test(raw);
}

function findRepoRoot(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '..', '..', '..', '..'),
    resolve(here, '..', '..', '..', '..', '..'),
    process.cwd(),
    resolve(process.cwd(), '..'),
    resolve(process.cwd(), '..', '..'),
  ];
  for (const root of candidates) {
    if (existsSync(join(root, 'package.json')) && existsSync(join(root, 'examples'))) {
      return root;
    }
  }
  return null;
}

async function waitForHealthy(url: string, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (res.ok) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function writeRuntimeAppsYaml(sidecars: LaunchWeekSidecar[]): string {
  const tmpDir = mkdtempSync(join(tmpdir(), 'floom-launch-week-yaml-'));
  const path = join(tmpDir, 'apps.yaml');
  const lines: string[] = ['apps:'];
  for (const sidecar of sidecars) {
    for (const app of sidecar.apps) {
      lines.push(`  - slug: ${app.slug}`);
      lines.push('    type: proxied');
      lines.push(`    openapi_spec_url: http://${HOST}:${sidecar.port}${app.openapiPath}`);
      lines.push(`    display_name: ${JSON.stringify(app.display_name)}`);
      lines.push(`    description: ${JSON.stringify(app.description)}`);
      lines.push(`    category: ${app.category}`);
    }
  }
  writeFileSync(path, lines.join('\n') + '\n', 'utf-8');
  return path;
}

/**
 * R38 fix: after OpenAPI ingest, replace the first action's `outputs` in the
 * stored manifest for each app that declares `manifestOutputs`. The ingest
 * pipeline always stores `outputs: [{name:'response',type:'json'}]` because it
 * cannot derive the correct output shape from an arbitrary API's response
 * schema. For our first-party Python sidecars we know the exact output shape,
 * so we patch it in after ingest so the renderer cascade can pick the
 * multi-section CompositeOutputCard instead of falling through to KeyValueTable.
 */
function patchManifestOutputs(sidecars: LaunchWeekSidecar[]): number {
  const getApp = db.prepare<[string], { id: string; manifest: string }>(
    `SELECT id, manifest FROM apps WHERE slug = ? AND status = 'active' LIMIT 1`,
  );
  const setManifest = db.prepare(
    `UPDATE apps SET manifest = ?, updated_at = datetime('now') WHERE id = ?`,
  );

  let patched = 0;
  for (const sidecar of sidecars) {
    for (const app of sidecar.apps) {
      if (!app.manifestOutputs || app.manifestOutputs.length === 0) continue;
      const row = getApp.get(app.slug);
      if (!row) continue;
      let manifest: NormalizedManifest;
      try {
        manifest = JSON.parse(row.manifest) as NormalizedManifest;
      } catch {
        console.warn(`[launch-week] patchManifestOutputs: invalid manifest JSON for ${app.slug}`);
        continue;
      }
      const actions = manifest.actions;
      if (!actions || Object.keys(actions).length === 0) continue;
      // Patch every action in the manifest. For these single-action Python
      // sidecars there's exactly one action (e.g. `analyze_route_analyze_post`);
      // patching all is safe even if there are multiple.
      for (const actionKey of Object.keys(actions)) {
        actions[actionKey]!.outputs = app.manifestOutputs;
      }
      setManifest.run(JSON.stringify(manifest), row.id);
      patched++;
      console.log(`[launch-week] patched manifest outputs for ${app.slug} (${Object.keys(actions).join(', ')})`);
    }
  }
  return patched;
}

function markFeatured(slugs: string[]): number {
  const stmt = db.prepare(
    `UPDATE apps SET featured = 1, updated_at = datetime('now') WHERE slug = ?`,
  );
  const tx = db.transaction((items: string[]) => {
    let touched = 0;
    for (const slug of items) {
      const result = stmt.run(slug);
      if (result.changes > 0) touched++;
    }
    return touched;
  });
  return tx(slugs);
}

export interface LaunchWeekBootResult {
  enabled: boolean;
  started: number;
  ingested: number;
  failed: number;
  skipped: string[];
  reason?: string;
}

export async function startLaunchWeekApps(): Promise<LaunchWeekBootResult> {
  if (!isEnabled()) {
    return { enabled: false, started: 0, ingested: 0, failed: 0, skipped: [], reason: 'disabled' };
  }

  const repoRoot = findRepoRoot();
  if (!repoRoot) {
    console.warn('[launch-week] repo root not found; skipping');
    return { enabled: true, started: 0, ingested: 0, failed: 0, skipped: [], reason: 'repo_root_not_found' };
  }

  const ready: LaunchWeekSidecar[] = [];
  const skipped: string[] = [];

  for (const sidecar of SIDECARS) {
    if (children.has(sidecar.name)) {
      ready.push(sidecar);
      continue;
    }

    const scriptPath = join(repoRoot, sidecar.script);
    if (!existsSync(scriptPath)) {
      skipped.push(sidecar.name);
      continue;
    }

    console.log(`[launch-week] forking ${sidecar.name}: ${scriptPath}`);
    // Python sidecars supply their own `cmd` array; Node sidecars default to
    // `[process.execPath, scriptPath]`. The first element is the executable,
    // the rest are argv (scriptPath is substituted for the path placeholder).
    const [exe, ...args] = sidecar.cmd
      ? sidecar.cmd.map((part) => (part === sidecar.script ? scriptPath : part))
      : [process.execPath, scriptPath];
    const child = spawn(exe, args, {
      env: {
        ...process.env,
        PORT: String(sidecar.port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      process.stdout.write(`[launch-week:${sidecar.name}] ${chunk}`);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(`[launch-week:${sidecar.name}:err] ${chunk}`);
    });
    child.on('exit', (code, signal) => {
      console.warn(`[launch-week] ${sidecar.name} exited code=${code} signal=${signal}`);
      children.delete(sidecar.name);
      if (!shuttingDown && isEnabled() && !restartTimer) {
        restartTimer = setTimeout(() => {
          restartTimer = null;
          startLaunchWeekApps().catch((err) => {
            console.error('[launch-week] restart failed:', err);
          });
        }, 1000);
        restartTimer.unref?.();
      }
    });

    children.set(sidecar.name, child);

    const healthy = await waitForHealthy(`http://${HOST}:${sidecar.port}${sidecar.healthPath}`);
    if (!healthy) {
      skipped.push(`${sidecar.name}:not_healthy`);
      continue;
    }

    ready.push(sidecar);
  }

  if (children.size > 0) {
    installSignalHandlers();
    ensureHealWatcher();
  }

  if (ready.length === 0) {
    return { enabled: true, started: 0, ingested: 0, failed: 0, skipped, reason: 'no_ready_sidecars' };
  }

  const runtimeYaml = writeRuntimeAppsYaml(ready);
  console.log(`[launch-week] wrote runtime apps.yaml at ${runtimeYaml}`);
  try {
    const result = await ingestOpenApiApps(runtimeYaml);
    const featured = ready.flatMap((s) => s.apps.filter((a) => a.featured).map((a) => a.slug));
    const pinned = markFeatured(featured);
    // R38 fix: patch manifest outputs AFTER ingest so the renderer cascade
    // picks the multi-section CompositeOutputCard for Python FastAPI sidecars.
    const patchCount = patchManifestOutputs(ready);
    console.log(
      `[launch-week] ingested ${result.apps_ingested} apps (${result.apps_failed} failed), marked ${pinned} featured, patched ${patchCount} manifest outputs`,
    );
    return {
      enabled: true,
      started: ready.length,
      ingested: result.apps_ingested,
      failed: result.apps_failed,
      skipped,
    };
  } catch (err) {
    console.error('[launch-week] ingest failed:', err);
    return {
      enabled: true,
      started: ready.length,
      ingested: 0,
      failed: 0,
      skipped,
      reason: (err as Error).message,
    };
  }
}

export function stopLaunchWeekApps(): void {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (healWatcher) {
    clearInterval(healWatcher);
    healWatcher = null;
  }
  for (const child of children.values()) {
    if (!child.killed) child.kill('SIGTERM');
  }
  children.clear();
}

/**
 * Sidecar status snapshot for /api/health/sidecars observability.
 */
export function getLaunchWeekStatus(): {
  enabled: boolean;
  expected: string[];
  alive: string[];
  dead: string[];
} {
  const enabled = isEnabled();
  const expected = SIDECARS.map((s) => s.name);
  const alive: string[] = [];
  const dead: string[] = [];
  for (const name of expected) {
    const c = children.get(name);
    if (c && !c.killed && c.exitCode === null) alive.push(name);
    else dead.push(name);
  }
  return { enabled, expected, alive, dead };
}

/**
 * Periodic self-heal watcher (30s interval). The per-child `exit` handler
 * already schedules a 1s respawn; this is belt-and-suspenders against
 * race conditions where the timer was cancelled (e.g. the parent received
 * a stray SIGTERM but didn't actually exit, which sets `shuttingDown=true`
 * permanently — we reset it here when we detect the parent is still alive).
 *
 * Was: a respawn-bug observed during AX41 OOM event 2026-04-29 left all 5
 * launch-week sidecars dead with no respawn. This watcher would have caught
 * it within 30s.
 */
function ensureHealWatcher(): void {
  if (healWatcher) return;
  if (!isEnabled()) return;
  healWatcher = setInterval(() => {
    if (shuttingDown) return;
    const expected = SIDECARS.map((s) => s.name);
    const aliveCount = expected.filter((n) => {
      const c = children.get(n);
      return c && !c.killed && c.exitCode === null;
    }).length;
    if (aliveCount < expected.length) {
      console.warn(
        `[launch-week:heal] ${aliveCount}/${expected.length} sidecars alive, triggering respawn`,
      );
      // If shuttingDown got latched true by a stray signal, but we're clearly
      // still running, reset it so respawn can proceed.
      shuttingDown = false;
      startLaunchWeekApps().catch((err) => {
        console.error('[launch-week:heal] respawn failed:', err);
      });
    }
  }, 30_000);
  healWatcher.unref?.();
}

function installSignalHandlers(): void {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;

  const shutdown = (signal: 'SIGINT' | 'SIGTERM') => {
    shuttingDown = true;
    stopLaunchWeekApps();
    setTimeout(() => process.exit(signal === 'SIGINT' ? 130 : 143), 50).unref();
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('exit', () => {
    shuttingDown = true;
    stopLaunchWeekApps();
  });
}
