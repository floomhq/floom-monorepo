// GitHub URL normalization.
//
// Issue #90 (2026-04-21): the URL input on the landing hero and on
// /studio/build used to require a fully-qualified `github.com/...` URL.
// Creators who paste `owner/repo` (the shape they'd type into `git clone`
// from memory) got "We couldn't reach that URL". This module accepts the
// common shapes and normalizes to the canonical https URL before we run
// detect / ingest.
//
// Accepted shapes:
//   owner/repo
//   github.com/owner/repo
//   https://github.com/owner/repo
//   https://github.com/owner/repo.git
//   git@github.com:owner/repo.git
//   http://github.com/owner/repo  (coerced to https)
//
// Rejected:
//   anything with spaces
//   single-segment input (`owner` alone)
//   three-plus segments of the owner/repo form (`owner/repo/sub`) — we
//   only normalize the repo root; deeper paths fall through untouched
//   so the OpenAPI ramp can still consume a direct raw-file URL.

const BARE_OWNER_REPO = /^([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9._-]+?)(?:\.git)?$/;
const GIT_SSH = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i;
const HTTP_GITHUB = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:[/?#]|$)/i;
const SCHEMELESS_GITHUB = /^github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:[/?#]|$)/i;
const GITHUB_BLOB = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i;
const GITHUB_RAW = /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/i;

const COMMON_OPENAPI_PATHS = [
  'openapi.yaml',
  'openapi.yml',
  'openapi.json',
  'swagger.yaml',
  'swagger.yml',
  'swagger.json',
  'docs/openapi.yaml',
  'docs/openapi.yml',
  'docs/openapi.json',
  'api/openapi.yaml',
  'api/openapi.yml',
  'api/openapi.json',
  'openapi/openapi.yaml',
  'openapi/openapi.yml',
  'openapi/openapi.json',
  'spec/openapi.yaml',
  'spec/openapi.yml',
  'spec/openapi.json',
] as const;

export interface GithubRepoRef {
  owner: string;
  repo: string;
  canonicalRepoUrl: string;
  defaultBranchHint?: string;
  rawFileUrl?: string;
  filePath?: string;
}

/**
 * Normalize a user-supplied GitHub reference to a canonical https URL.
 * Returns null if the input doesn't match any known GitHub shape — the
 * caller should fall through to the generic OpenAPI ramp in that case.
 */
export function normalizeGithubUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;

  const ssh = trimmed.match(GIT_SSH);
  if (ssh) return `https://github.com/${ssh[1]}/${ssh[2]}`;

  const http = trimmed.match(HTTP_GITHUB);
  if (http) return `https://github.com/${http[1]}/${http[2]}`;

  const schemeless = trimmed.match(SCHEMELESS_GITHUB);
  if (schemeless) return `https://github.com/${schemeless[1]}/${schemeless[2]}`;

  // Bare owner/repo — only accept a strict 2-segment shape so we don't
  // silently reroute `docs/openapi.yaml` or other slashy paths.
  const bare = trimmed.match(BARE_OWNER_REPO);
  if (bare) {
    // Guard: a single `.` before the slash is the only way to type a
    // domain-shape here (e.g. `example.com/foo`), and those should not
    // be treated as GitHub refs. Reject owner segments that contain a dot.
    if (bare[1].includes('.')) return null;
    return `https://github.com/${bare[1]}/${bare[2]}`;
  }

  return null;
}

/**
 * Does this string look like a GitHub ref (canonical URL, schemeless,
 * SSH, or bare `owner/repo`)? Used by BuildPage to route a user-provided
 * URL to the GitHub ramp vs the OpenAPI ramp.
 */
export function looksLikeGithubRef(raw: string): boolean {
  return normalizeGithubUrl(raw) !== null;
}

export function parseGithubRepoRef(raw: string): GithubRepoRef | null {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;

  const blob = trimmed.match(GITHUB_BLOB);
  if (blob) {
    return {
      owner: blob[1],
      repo: blob[2].replace(/\.git$/i, ''),
      canonicalRepoUrl: `https://github.com/${blob[1]}/${blob[2].replace(/\.git$/i, '')}`,
      defaultBranchHint: blob[3],
      rawFileUrl: `https://raw.githubusercontent.com/${blob[1]}/${blob[2].replace(/\.git$/i, '')}/${blob[3]}/${blob[4]}`,
      filePath: blob[4],
    };
  }

  const rawMatch = trimmed.match(GITHUB_RAW);
  if (rawMatch) {
    return {
      owner: rawMatch[1],
      repo: rawMatch[2].replace(/\.git$/i, ''),
      canonicalRepoUrl: `https://github.com/${rawMatch[1]}/${rawMatch[2].replace(/\.git$/i, '')}`,
      defaultBranchHint: rawMatch[3],
      rawFileUrl: `https://raw.githubusercontent.com/${rawMatch[1]}/${rawMatch[2].replace(/\.git$/i, '')}/${rawMatch[3]}/${rawMatch[4]}`,
      filePath: rawMatch[4],
    };
  }

  const canonical = normalizeGithubUrl(trimmed);
  if (!canonical) return null;
  const m = canonical.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/i);
  if (!m) return null;
  return {
    owner: m[1],
    repo: m[2],
    canonicalRepoUrl: `https://github.com/${m[1]}/${m[2]}`,
  };
}

function githubRawUrl(owner: string, repo: string, branch: string, filePath: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
}

function fileLooksLikeOpenApi(filePath: string | undefined): boolean {
  return Boolean(filePath && /\.(ya?ml|json)$/i.test(filePath));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function buildGithubSpecCandidates(
  raw: string,
  options: { defaultBranch?: string | null } = {},
): string[] {
  const parsed = parseGithubRepoRef(raw);
  if (!parsed) return [];

  const branches = dedupe([
    options.defaultBranch || '',
    parsed.defaultBranchHint || '',
    'main',
    'master',
  ]);
  const urls: string[] = [];

  if (parsed.rawFileUrl && fileLooksLikeOpenApi(parsed.filePath)) {
    urls.push(parsed.rawFileUrl);
  }

  if (parsed.filePath) {
    const slash = parsed.filePath.lastIndexOf('/');
    const parent = slash >= 0 ? parsed.filePath.slice(0, slash) : '';
    if (parent) {
      for (const branch of branches) {
        for (const name of ['openapi.yaml', 'openapi.yml', 'openapi.json', 'swagger.yaml', 'swagger.yml', 'swagger.json']) {
          urls.push(githubRawUrl(parsed.owner, parsed.repo, branch, `${parent}/${name}`));
        }
      }
    }
  }

  for (const branch of branches) {
    for (const path of COMMON_OPENAPI_PATHS) {
      urls.push(githubRawUrl(parsed.owner, parsed.repo, branch, path));
    }
  }

  return dedupe(urls);
}

export function formatGithubCandidate(rawUrl: string): string {
  return rawUrl.replace('https://raw.githubusercontent.com/', '');
}
