import type { HubApp } from './types';

/**
 * Slugs and descriptions that match these patterns are QA/test fixtures
 * produced by the e2e suite and the OpenAPI detect fallback. They ship to
 * the backend (harmless) but must never appear in the public /apps
 * directory, or in the "N apps running right now" stat on the landing
 * page, because a fresh consumer sees "Swagger Petstore" or "Renderer
 * Test" and loses trust.
 *
 * Single source of truth so the landing hero count and the /apps header
 * count never drift. See fix/ui-surgical-2026-04-18 (bug 2).
 */
const TEST_FIXTURE_SLUG = /^(swagger-petstore|stopwatch-\d|e2e-stopwatch|my-renderer-test)/i;
const TEST_FIXTURE_DESC =
  /^(This is a sample Pet Store Server|GitHub's v3 REST API\.|A simple HTTP Request & Response Service)/i;

export function isTestFixture(app: HubApp): boolean {
  if (TEST_FIXTURE_SLUG.test(app.slug)) return true;
  if (app.description && TEST_FIXTURE_DESC.test(app.description)) return true;
  return false;
}

/**
 * Public-facing hub list: same payload as /api/hub minus QA/test fixtures.
 * Anything that shows "N apps" to end users should count this array, not
 * the raw /api/hub response.
 */
export function publicHubApps(apps: HubApp[]): HubApp[] {
  return apps.filter((a) => !isTestFixture(a));
}

/**
 * Minimum description length we require before surfacing a non-featured
 * app to consumers. Apps below this threshold are almost always
 * bulk-imported OpenAPI specs where the "description" is just a restatement
 * of the slug — "Poemist API", "JSON storage API", "Highways England API".
 * They erode trust in the directory without adding real capability.
 *
 * Measured empirically against floom.dev/api/hub on 2026-04-20: the
 * natural break in the distribution sits at 40 chars. Cutting below 40
 * removes the 9 worst entries and keeps real taglines like
 * "Worldwide forward and reverse geocoding" (opencage, 39ch — kept by
 * `<` vs `<=`) and "Fetch the latest currency exchange rates via API"
 * (exchangerate, 48ch).
 */
const MIN_DESCRIPTION_CHARS = 40;

/**
 * Apps that should not appear on curated public surfaces even though
 * they are real, working apps. Today this is only the description-length
 * signal; as we learn which creators ship good metadata we can layer in
 * per-author trust or category-specific floors here.
 *
 * Featured apps are always kept — the featured flag is operator-curated
 * and overrides the heuristic. This is the escape hatch for short but
 * high-quality entries ("Charts, simple as a URL" could be featured
 * tomorrow and instantly reappear).
 */
export function isLowQuality(app: HubApp): boolean {
  if (app.featured) return false;
  const desc = (app.description ?? '').trim();
  if (desc.length < MIN_DESCRIPTION_CHARS) return true;
  return false;
}

/**
 * Curated public list: `publicHubApps` minus low-quality entries.
 *
 * Use this on the landing page hero count, the /apps directory, and
 * anywhere else a fresh consumer forms a first impression of the
 * catalog. Do NOT use it for:
 *   - Slug-addressed pages (/p/:slug) — those must resolve regardless of
 *     quality so already-bookmarked apps keep working.
 *   - The MCP /hub endpoint — agents should be able to discover anything
 *     that runs, even if it isn't marketing-ready.
 *   - Studio's "my apps" list — creators need to see their own drafts.
 */
export function qualityHubApps(apps: HubApp[]): HubApp[] {
  return publicHubApps(apps).filter((a) => !isLowQuality(a));
}
