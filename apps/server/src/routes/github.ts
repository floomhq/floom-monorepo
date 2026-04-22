// /api/github/* — user-scoped GitHub helpers.
//
// 2026-04-22 (launch): creators want to publish apps from their PRIVATE
// GitHub repos. The default GitHub OAuth scope (`read:user` + `user:email`)
// only sees the user identity; listing private repos needs the `repo`
// scope on the stored access token.
//
// This route reads Better Auth's `account` row for the signed-in user,
// pulls the GitHub access_token + scope string, and proxies the GitHub
// `GET /user/repos?affiliation=owner&visibility=all` call. It returns
// a trimmed list the /studio/build picker can render directly.
//
// Error modes the UI handles:
//   401 auth_required        — not signed in (not cloud mode or anon)
//   412 no_github_account    — signed in via email/Google, never linked GH
//   412 scope_upgrade_needed — linked GH, but token doesn't have `repo`
//   502 github_api_failed    — upstream GitHub error (surfaced verbatim)
//
// For 412s the UI calls `POST /auth/link-social { provider: 'github',
// scopes: ['repo'], callbackURL }` (signed-in users) or
// `POST /auth/sign-in/social { provider: 'github', scopes: ['repo'] }`
// (should not happen — by the time we return 412 the caller must be
// signed in, otherwise we'd have returned 401). Both endpoints return
// `{ url }` and the client top-level-navigates to that URL to kick off
// the OAuth consent flow. We don't return a ready-made link URL because
// both endpoints are POST-only and require a session cookie — a bare
// anchor wouldn't work.
//
// The access token stays on the server — we never send it to the browser.
// CSP in middleware/security.ts already whitelists api.github.com for the
// browser side star-count fetch, but that's unrelated: this route runs
// entirely in Node and proxies the response.

import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db.js';
import { resolveUserContext } from '../services/session.js';
import { isCloudMode } from '../lib/better-auth.js';
import { detectAppFromUrl } from '../services/openapi-ingest.js';

export const githubRouter = new Hono();

/**
 * Row shape in Better Auth's `account` table. We only SELECT the fields
 * we need. Better Auth stores the raw OAuth access token here when
 * `account.encryptOAuthTokens` is NOT set (which is our current config
 * — see lib/better-auth.ts buildAuthOptions). If that config ever flips,
 * we'd have to go through auth.api.getAccessToken() instead.
 */
interface GithubAccountRow {
  accessToken: string | null;
  scope: string | null;
  accountId: string | null;
}

function readGithubAccount(userId: string): GithubAccountRow | null {
  try {
    const row = db
      .prepare(
        `SELECT accessToken, scope, accountId
           FROM account
          WHERE userId = ?
            AND providerId = 'github'
          LIMIT 1`,
      )
      .get(userId) as GithubAccountRow | undefined;
    return row ?? null;
  } catch {
    // The `account` table only exists when Better Auth migrations have
    // run (cloud mode). In OSS mode this route is already unreachable
    // because of the isCloudMode gate below, but we still guard so a
    // misconfigured boot returns a clean 500 instead of a stack trace.
    return null;
  }
}

function hasRepoScope(scopeStr: string | null): boolean {
  if (!scopeStr) return false;
  // GitHub returns a comma-joined list in the token response; Better Auth
  // stores it verbatim. `repo` is a superset that includes `public_repo`,
  // so either one satisfies the picker. We accept both for forwards-
  // compatibility with a future per-repo GitHub App flow.
  const scopes = scopeStr.split(',').map((s) => s.trim());
  return scopes.includes('repo') || scopes.includes('public_repo');
}

interface GithubRepoApiRow {
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  description: string | null;
  html_url: string;
  updated_at: string;
  pushed_at: string;
  fork: boolean;
  archived: boolean;
}

interface GithubRepoOut {
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  description: string | null;
  html_url: string;
  updated_at: string;
}

/**
 * GET /api/github/repos
 *
 * Query params:
 *   - per_page: 1-100 (default 50). Higher values let the picker show
 *     the long tail without pagination UI.
 *
 * Response shape (200):
 *   { repos: [{ name, full_name, private, default_branch, description,
 *               html_url, updated_at }], scopes: string[] }
 *
 * Response shape (412 scope upgrade needed):
 *   { error, code: 'scope_upgrade_needed' | 'no_github_account',
 *     current_scopes: string[] }
 */
githubRouter.get('/repos', async (c) => {
  if (!isCloudMode()) {
    // OSS mode has no Better Auth → no stored token → nothing to list.
    // Return a clean 501 so the UI can fall back to the paste-URL ramp.
    return c.json(
      {
        error: 'GitHub repo listing requires cloud mode.',
        code: 'not_available',
      },
      501,
    );
  }

  const ctx = await resolveUserContext(c);
  if (!ctx.is_authenticated || !ctx.user_id) {
    return c.json(
      { error: 'Sign in to list your GitHub repos.', code: 'auth_required' },
      401,
    );
  }

  const account = readGithubAccount(ctx.user_id);

  if (!account || !account.accessToken) {
    return c.json(
      {
        error:
          'No GitHub account linked to this user. Connect GitHub to import private repos.',
        code: 'no_github_account',
        current_scopes: [],
      },
      412,
    );
  }

  if (!hasRepoScope(account.scope)) {
    return c.json(
      {
        error:
          'GitHub is connected but not authorized to read private repos. Reconnect to grant the `repo` scope.',
        code: 'scope_upgrade_needed',
        current_scopes: (account.scope || '').split(',').filter(Boolean),
      },
      412,
    );
  }

  // Parse per_page. GitHub caps at 100; below 1 is meaningless. Default
  // 50 keeps the picker feeling fast even on accounts with hundreds of
  // repos (the "updated" sort surfaces the relevant ones first).
  const perPageRaw = c.req.query('per_page');
  let perPage = 50;
  if (perPageRaw) {
    const n = Number(perPageRaw);
    if (Number.isFinite(n) && n >= 1 && n <= 100) perPage = Math.floor(n);
  }

  // `affiliation=owner` restricts to repos the user personally owns —
  // no org/collab repos. Launch scope is "users publish their own repos",
  // so this keeps the picker focused. Post-launch we can add
  // affiliation=owner,collaborator,organization_member.
  //
  // `sort=updated` surfaces recently-touched repos at the top, which is
  // what 95% of users want to import.
  const url =
    `https://api.github.com/user/repos` +
    `?affiliation=owner` +
    `&visibility=all` +
    `&sort=updated` +
    `&per_page=${perPage}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'floom-server',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch (err) {
    return c.json(
      {
        error: 'Could not reach GitHub.',
        code: 'github_api_failed',
        details: (err as Error).message,
      },
      502,
    );
  }

  if (res.status === 401) {
    // Token rejected (revoked, expired, or password reset on GitHub).
    // Surface the same re-consent affordance the no-account path returns
    // so the UI shows a single recovery CTA.
    return c.json(
      {
        error:
          'GitHub rejected the stored token. Reconnect GitHub to refresh it.',
        code: 'scope_upgrade_needed',
        current_scopes: (account.scope || '').split(',').filter(Boolean),
      },
      412,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return c.json(
      {
        error: `GitHub API returned ${res.status}.`,
        code: 'github_api_failed',
        upstream_status: res.status,
        details: body.slice(0, 500),
      },
      502,
    );
  }

  const rows = (await res.json()) as GithubRepoApiRow[];

  // Drop forks + archived so the picker only shows repos the user is
  // actively developing. They can still paste a fork's URL into the
  // paste-URL ramp if they need to.
  const repos: GithubRepoOut[] = rows
    .filter((r) => !r.fork && !r.archived)
    .map((r) => ({
      name: r.name,
      full_name: r.full_name,
      private: r.private,
      default_branch: r.default_branch,
      description: r.description,
      html_url: r.html_url,
      updated_at: r.updated_at,
    }));

  return c.json({
    repos,
    scopes: (account.scope || '').split(',').filter(Boolean),
  });
});

// ---------------------------------------------------------------------
// POST /api/github/detect — private-repo-aware spec detection
// ---------------------------------------------------------------------
//
// The /api/hub/detect endpoint probes a public raw URL. For private
// repos it would 404 because raw.githubusercontent.com requires a
// GitHub token on the request. This endpoint:
//   1. Reads the caller's GitHub OAuth access_token from the Better Auth
//      `account` table.
//   2. Fans out over the same candidate openapi paths the /build client
//      does (openapi.yaml / .yml / .json at repo root and docs/, api/),
//      fetching each with Authorization: Bearer <token>.
//   3. Returns the same DetectedApp shape /api/hub/detect returns, so
//      the /studio/build review step reuses the existing UI.
//
// We intentionally return the raw-contents URL in `openapi_spec_url` —
// it's the canonical reference the manifest will carry, same as the
// public path today. Runtime fetches for private repos will need to
// re-acquire a token (follow-up; out of scope for the launch weekend
// picker).

const DetectBody = z.object({
  full_name: z
    .string()
    .min(3)
    .max(200)
    .regex(
      /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/,
      'full_name must be "owner/repo"',
    ),
  branch: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9._/-]+$/)
    .optional(),
});

const OPENAPI_CANDIDATES = [
  'openapi.yaml',
  'openapi.yml',
  'openapi.json',
  'docs/openapi.yaml',
  'docs/openapi.yml',
  'docs/openapi.json',
  'api/openapi.yaml',
  'api/openapi.yml',
  'api/openapi.json',
];

githubRouter.post('/detect', async (c) => {
  if (!isCloudMode()) {
    return c.json(
      {
        error: 'GitHub detect requires cloud mode.',
        code: 'not_available',
      },
      501,
    );
  }

  const ctx = await resolveUserContext(c);
  if (!ctx.is_authenticated || !ctx.user_id) {
    return c.json(
      { error: 'Sign in to detect from GitHub.', code: 'auth_required' },
      401,
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Body must be JSON', code: 'invalid_body' }, 400);
  }
  const parsed = DetectBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: 'Invalid body shape',
        code: 'invalid_body',
        details: parsed.error.flatten(),
      },
      400,
    );
  }

  const account = readGithubAccount(ctx.user_id);
  if (!account || !account.accessToken) {
    return c.json(
      {
        error:
          'No GitHub account linked to this user. Connect GitHub to import private repos.',
        code: 'no_github_account',
        current_scopes: [],
      },
      412,
    );
  }
  if (!hasRepoScope(account.scope)) {
    return c.json(
      {
        error:
          'GitHub is connected but not authorized to read private repos. Reconnect to grant the `repo` scope.',
        code: 'scope_upgrade_needed',
        current_scopes: (account.scope || '').split(',').filter(Boolean),
      },
      412,
    );
  }

  const { full_name } = parsed.data;
  let branch = parsed.data.branch;

  // If the caller didn't pin a branch, look up the repo's default_branch
  // so we don't guess "main" vs "master". One extra GitHub API call, but
  // it's always needed for correctness on older repos.
  if (!branch) {
    try {
      const metaRes = await fetch(
        `https://api.github.com/repos/${full_name}`,
        {
          headers: {
            Authorization: `Bearer ${account.accessToken}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'floom-server',
          },
        },
      );
      if (metaRes.status === 404) {
        return c.json(
          { error: 'Repo not found.', code: 'repo_not_found' },
          404,
        );
      }
      if (!metaRes.ok) {
        return c.json(
          {
            error: `GitHub API returned ${metaRes.status} on repo metadata.`,
            code: 'github_api_failed',
            upstream_status: metaRes.status,
          },
          502,
        );
      }
      const meta = (await metaRes.json()) as { default_branch?: string };
      branch = meta.default_branch || 'main';
    } catch (err) {
      return c.json(
        {
          error: 'Could not reach GitHub.',
          code: 'github_api_failed',
          details: (err as Error).message,
        },
        502,
      );
    }
  }

  // Probe each candidate with a token-authed HEAD-ish GET. We GET
  // directly (instead of HEAD) because raw.githubusercontent.com returns
  // the same token-auth behavior on GET and we can reuse the successful
  // response body in detectAppFromUrl below by handing it the URL
  // + Authorization header.
  const authHeader = { Authorization: `Bearer ${account.accessToken}` };
  const attemptedUrls: string[] = [];

  for (const path of OPENAPI_CANDIDATES) {
    const rawUrl = `https://raw.githubusercontent.com/${full_name}/${branch}/${path}`;
    attemptedUrls.push(rawUrl);
    try {
      const probe = await fetch(rawUrl, { headers: authHeader });
      if (!probe.ok) continue;
      // detectAppFromUrl re-fetches the URL with the same extraHeaders,
      // so we don't need to pass the body we just read here. The second
      // fetch is cheap — raw.githubusercontent.com is served from a CDN
      // and the token auth is a single HMAC check on GitHub's side.
      //
      // A future optimization is to pass the pre-fetched body directly
      // into a `detectAppFromSpec(text)` variant to avoid the extra hop.
      const detected = await detectAppFromUrl(
        rawUrl,
        undefined,
        undefined,
        authHeader,
      );
      return c.json({ ...detected, attempted_urls: attemptedUrls });
    } catch {
      // Swallow and try the next candidate. `detectAppFromUrl` throws
      // for both fetch failures and parse failures; either way, move on.
      continue;
    }
  }

  return c.json(
    {
      error:
        "We couldn't find an openapi.yaml / .yml / .json in your repo root, docs/, or api/.",
      code: 'no_openapi',
      attempted_urls: attemptedUrls,
    },
    404,
  );
});
