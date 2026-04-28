// GET /api/gh-releases — server-side proxy for floomhq/floom GitHub Releases.
// Mirrors routes/gh-stars.ts: 10-minute in-memory cache, optional GitHub PAT,
// in-flight de-dup, fallback empty array on upstream failure.
//
// Why this exists:
//   /changelog used to be a stub linking out to GitHub Releases. We surface the
//   actual release feed inline so visitors don't bounce. Browser-side fetches
//   to api.github.com get rate-limited (60/hour anon), so the proxy uses the
//   server's PAT when set (FEEDBACK_GITHUB_TOKEN or GITHUB_TOKEN), caches the
//   result for 10 minutes, and serves same-origin JSON to kill CORS / WAF /
//   adblock issues.
//
// Response shape: `{ releases: Release[], source: "live" | "cache" | "fallback" }`
// Each release: `{ tag, name, published_at, body_md, url }`
// `body_md` is the raw markdown from GitHub Releases — the client can render
// it via DescriptionMarkdown / react-markdown.

import { Hono } from 'hono';

export const ghReleasesRouter = new Hono();

const REPO = 'floomhq/floom';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const REQUEST_TIMEOUT_MS = 4000;
const MAX_RELEASES = 20;

export interface ReleaseItem {
  tag: string;
  name: string;
  published_at: string;
  body_md: string;
  url: string;
}

interface CacheEntry {
  releases: ReleaseItem[];
  ts: number;
}

let cache: CacheEntry | null = null;
let inFlight: Promise<ReleaseItem[] | null> | null = null;

function getToken(): string | undefined {
  return process.env.FEEDBACK_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
}

interface GitHubReleaseRaw {
  tag_name?: string;
  name?: string | null;
  published_at?: string | null;
  body?: string | null;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
}

async function fetchFromGitHub(): Promise<ReleaseItem[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'floom-server-releases-proxy',
    };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(
      `https://api.github.com/repos/${REPO}/releases?per_page=${MAX_RELEASES}`,
      {
        headers,
        signal: controller.signal,
      },
    );
    if (!r.ok) {
      console.warn(
        `[gh-releases] GitHub API responded ${r.status} (token=${token ? 'set' : 'unset'})`,
      );
      return null;
    }
    const body = (await r.json()) as GitHubReleaseRaw[];
    if (!Array.isArray(body)) return null;
    const items: ReleaseItem[] = body
      .filter((rel) => !rel.draft)
      .map((rel) => ({
        tag: rel.tag_name ?? '',
        name: rel.name?.trim() || rel.tag_name || '',
        published_at: rel.published_at ?? '',
        body_md: rel.body ?? '',
        url: rel.html_url ?? `https://github.com/${REPO}/releases`,
      }))
      .filter((rel) => rel.tag && rel.published_at);
    return items;
  } catch (err) {
    console.warn(
      '[gh-releases] fetch failed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function refreshCache(): Promise<ReleaseItem[] | null> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const releases = await fetchFromGitHub();
      if (Array.isArray(releases)) {
        cache = { releases, ts: Date.now() };
      }
      return releases;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

ghReleasesRouter.get('/', async (c) => {
  const now = Date.now();
  const fresh = cache && now - cache.ts < CACHE_TTL_MS;

  if (fresh && cache) {
    c.header('Cache-Control', 'public, max-age=300, s-maxage=600');
    return c.json({ releases: cache.releases, source: 'cache' as const });
  }

  const live = await refreshCache();
  if (Array.isArray(live)) {
    c.header('Cache-Control', 'public, max-age=300, s-maxage=600');
    return c.json({ releases: live, source: 'live' as const });
  }

  // Upstream failed — return stale cache if we have one, else empty.
  if (cache) {
    c.header('Cache-Control', 'public, max-age=60, s-maxage=60');
    return c.json({ releases: cache.releases, source: 'cache' as const });
  }
  c.header('Cache-Control', 'public, max-age=60, s-maxage=60');
  return c.json({ releases: [], source: 'fallback' as const });
});
