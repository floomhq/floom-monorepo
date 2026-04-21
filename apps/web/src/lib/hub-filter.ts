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
 * P0 launch curation (issue #252, 2026-04-21): the public landing +
 * /apps directory must only surface the three showcase demos plus the
 * first-party Floom zero-config utilities. The backend still returns
 * all ~42 rows (we don't delete DB rows — installs from MCP, deep-link
 * shares, and search-by-slug still resolve), but public listings are
 * allowlisted here.
 *
 * Anything outside this allowlist is hidden from:
 *   - landing hero tiles + featured stripes
 *   - landing "N apps running now" count
 *   - /apps directory grid + search
 *
 * To re-surface an app publicly, either add it to SHOWCASE_SLUGS or set
 * `featured: true` on the DB row.
 */
const SHOWCASE_SLUGS = new Set<string>([
  'lead-scorer',
  'competitor-analyzer',
  'resume-screener',
]);

function isFirstPartyUtility(app: HubApp): boolean {
  // First-party utilities are flagged `featured: true` on the DB row.
  // These are the zero-config Floom-built demos (uuid, base64, hash,
  // jwt-decode, password, json-format, word-count) that power the
  // InlineDemo component and the featured-apps row. Keeping them
  // public ensures the live-demo and "try it now" sections still work.
  return app.featured === true;
}

export function isPubliclyListed(app: HubApp): boolean {
  if (isTestFixture(app)) return false;
  if (SHOWCASE_SLUGS.has(app.slug)) return true;
  if (isFirstPartyUtility(app)) return true;
  return false;
}

/**
 * Public-facing hub list: the three showcase demos + first-party
 * Floom utilities. Every other app is hidden from landing + /apps
 * until explicitly allowlisted (SHOWCASE_SLUGS) or featured in the DB.
 */
export function publicHubApps(apps: HubApp[]): HubApp[] {
  return apps.filter(isPubliclyListed);
}
