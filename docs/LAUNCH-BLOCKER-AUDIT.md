# Launch Blocker Audit - 2026-04-28

Audit run: 2026-04-27, roughly 14 hours before the Tuesday launch window.

Scope: Federico's punch list for Layer 5 R1-R3 plus launch-adjacent gaps that were visible from code, local prod-like data, HTTP smoke tests, browser screenshots, and stress tests.

## Top 3 Blocking Items for Federico

1. Production OAuth completion: GitHub and Google provider start URLs now resolve against `https://floom.dev`, but the full provider callback/login path requires real provider credentials and a browser session on prod or staging.
2. Real Resend delivery: verification, password reset, and invite templates render and the fallback path works without `RESEND_API_KEY`; live delivery needs a production `RESEND_API_KEY` and a real inbox check.
3. Real production data dry-run: the migration passed a prod-like local dataset and idempotency/concurrent-write simulation, but the launch gate still needs a backup/restore dry-run against a copy of the production DB before promotion.

## Punch List Findings

### 1. Prod Schema Migration Safety

Finding:
- `workspace_secrets` migration is present in `apps/server/src/db.ts`.
- Added `runWorkspaceSecretsBackfill()` export and `test/stress/test-workspace-secrets-backfill.mjs`.
- The test creates multiple users, multiple workspaces, legacy encrypted secrets, mixed same-workspace values, a pre-existing conflict row, and a post-first-pass write.
- Idempotency verified: rerunning the backfill keeps one row per `(workspace_id, app_slug, key)` and does not duplicate conflict rows.
- Conflict behavior verified: mixed legacy values for one workspace/key are recorded in `workspace_secret_backfill_conflicts`; the migration does not guess.
- Concurrent-write simulation verified: a legacy user secret written after the first pass is picked up by a later backfill pass.

Fix applied:
- Backfill now clears stale conflict rows when a later pass sees a single canonical value for that group.
- Rollback steps added to `docs/ROLLBACK.md`.

Residual risk:
- Module-load migration runs before the HTTP server accepts traffic, so true HTTP concurrency during normal boot is not active. Manual backfills while writers are active still require draining writes, rerunning `runWorkspaceSecretsBackfill()`, and inspecting `workspace_secret_backfill_conflicts`.

### 2. FLOOM_API_KEY Grandfather Period

Finding:
- Local prod-like DB: `data/floom-chat.db`.
- `agent_tokens` count in that DB: `0`.
- No existing `FLOOM_API_KEY` agent tokens were available locally to prove a real grandfather token.
- Code inspection confirms agent tokens resolve through `resolveUserContext()` and carry authoritative `workspace_id` from `agent_tokens`.

Expected behavior:
- Pre-Round 1 `floom_agent_*` tokens: continue to resolve if a matching `agent_tokens` row exists. The token row's `workspace_id` scopes the run and wins over cookies.
- Post-Round 1 tokens: minted through the workspace token surfaces and scoped to the active or explicit workspace.
- Legacy non-agent `floom_*` Better Auth API keys: still handled by the Better Auth API-key plugin in cloud mode; none were found in the local prod-like DB.

Fix applied:
- Added/extended workspace token coverage in the R1-R3 stress suite.

Residual risk:
- Federico needs one real pre-cutover production token, if any exist, tested against staging/prod because the local prod-like DB has no token rows.

### 3. Demo Apps End-to-End Smoke

Finding:
- Active launch demos are `competitor-lens`, `ai-readiness-audit`, and `pitch-coach`.
- BYOK gate still referenced the old demo roster (`lead-scorer`, `competitor-analyzer`, `resume-screener`).

Fix applied:
- Updated `apps/server/src/lib/byok-gate.ts` to gate the current three launch demos.
- Added `test/stress/test-launch-demo-http-smoke.mjs`.
- Added/updated demo stress coverage in `test/stress/test-launch-demos.mjs` and `test/stress/test-mcp-byok-gating.mjs`.

Verified:
- Each demo can run through `/api/:slug/run` using a workspace BYOK `GEMINI_API_KEY`.
- The upstream fixture receives the workspace key.
- `runs.workspace_id` and `runs.user_id` are written as `local`.
- HTTP result returns successfully.

Residual risk:
- The smoke uses proxied fixture apps, not live Dockerized demo images. Real prod demo containers plus a real Gemini key remain a manual launch gate.

### 4. `/embed/:slug` Status

Finding:
- `/embed/:slug` returned 404.
- L1 deferred embed to v1.1.

Fix applied:
- Server direct loads now return `302` to `/p/:slug` with `cache-control: no-cache`.
- Client-side navigation also redirects `/embed/:slug` to `/p/:slug`.
- Added route coverage in `test/stress/test-routes.mjs`.

Residual risk:
- None for v1.0. Real embed UX remains v1.1 scope.

### 5. Pricing/Docs Page Existence

Finding:
- `/pricing` exists and is routed.
- `/docs` exists and is routed.
- Public TopBar links are real nav items, not dead anchors.

Fix applied:
- No Pricing/Docs fix needed.

Residual risk:
- None found for these two routes in this audit.

### 6. OAuth Providers Smoke

Finding:
- `test/stress/test-auth-dynamic-baseurl.mjs` verifies the dynamic auth base URL behavior.
- Extended coverage to include GitHub, matching the existing Google check.
- Verified social sign-in start URLs use `https://floom.dev` when the request host is production.

Fix applied:
- Added GitHub OAuth start-route assertions alongside Google.

Residual risk:
- Full provider callback/login completion requires real GitHub and Google OAuth credentials configured for the prod callback URL.

### 7. Email/Resend

Finding:
- Email service has template paths for verification, password reset, and workspace invites.
- Without `RESEND_API_KEY`, `sendEmail()` logs a fallback and does not crash.

Fix applied:
- Added `test/stress/test-email-transactional.mjs`.

Verified:
- Signup confirmation template renders.
- Password reset template renders.
- Workspace invite template renders.
- Missing-Resend fallback path returns success without throwing.

Residual risk:
- Live delivery, DKIM/domain config, and inbox receipt require Federico to run the production Resend check.

### 8. Public Store Curation

Finding:
- `FLOOM_STORE_HIDE_SLUGS` is wired in `apps/server/src/routes/hub.ts`.
- The env var is parsed at module load and filters `GET /api/hub`.
- Direct `GET /api/hub/:slug` still works for hidden slugs, which keeps deep links/admin checks possible.

Fix applied:
- Added `test/stress/test-hub-store-hide-slugs.mjs`.

Launch-visible slugs verified in code:
- `competitor-lens`
- `ai-readiness-audit`
- `pitch-coach`

Hidden-slug policy:
- Hide every public app slug not approved for launch.
- This repo snapshot does not contain a canonical 13-app launch list. Current client launch/demo allowlists only identify the three slugs above.

Residual risk:
- Federico needs to provide or confirm the full 13-app launch list before setting the production `FLOOM_STORE_HIDE_SLUGS` value.

### 9. Status Page / Legal Pages

Finding:
- `/terms` exists.
- `/privacy` exists.
- `/status` was missing.
- Footer did not link Status.

Fix applied:
- Added `apps/web/src/pages/StatusPage.tsx`.
- Added `/status` client and server route metadata.
- Added Status link to `PublicFooter`.
- Moved the footer mobile media rule out of an inline `<style>` block into bundled CSS to satisfy the current CSP.

Verified:
- Browser screenshot: `/tmp/floom-status-page.png`.
- The page rendered the status content, footer link, and no loading state.
- Browser console showed only `[sentry] disabled`; style element count was `0`.

Residual risk:
- `/status` is a launch-week placeholder, not a real uptime provider integration.

### 10. Rollback Plan

Finding:
- `docs/ROLLBACK.md` existed.

Fix applied:
- Added a concrete Tuesday 2026-04-28 P0 rollback section covering freeze/evidence, code rollback, schema rollback, DNS rollback, and recovery checks.

Residual risk:
- Code rollback needs the exact pre-launch tag or image digest recorded before promotion.
- Schema rollback from `workspace_secrets` requires restoring from backup if migrated data must be preserved.

### 11. Launch Comms

Finding:
- This is out of code scope but launch-critical.

Fix applied:
- Created `/root/floom-internal/launch-comms-2026-04-28.md` with owner checklist, gates, X copy, Discord copy, ProductHunt notes, and Hacker News note.

Residual risk:
- Federico needs to choose exact launch time and whether ProductHunt/HN are in-scope for Tuesday.

## Pre-Launch Checklist

Run from `/root/floom`:

```bash
pnpm typecheck
pnpm --filter @floom/server build
pnpm --filter @floom/web build
node test/stress/test-workspace-secrets.mjs
node test/stress/test-workspace-secrets-backfill.mjs
node test/stress/test-agent-tokens-workspace.mjs
node test/stress/test-hub-store-hide-slugs.mjs
node test/stress/test-routes.mjs
node test/stress/test-email-transactional.mjs
node test/stress/test-auth-dynamic-baseurl.mjs
pnpm exec tsx test/stress/test-launch-demos.mjs
node test/stress/test-mcp-byok-gating.mjs
node test/stress/test-launch-demo-http-smoke.mjs
node test/stress/test-mcp-run-parity.mjs
node test/stress/test-redirects.mjs
```

Production/staging manual gates:

```bash
curl -I https://floom.dev/status
curl -I https://floom.dev/embed/competitor-lens
curl -s https://floom.dev/api/hub | jq '.apps[].slug'
```

UI clicks:
- Open `https://floom.dev/status`; confirm the page renders the four operational rows.
- Open `https://floom.dev/embed/competitor-lens`; confirm it lands on `/p/competitor-lens`.
- Click TopBar `Docs`; confirm `/docs`.
- Click TopBar `Pricing`; confirm `/pricing`.
- Start GitHub sign-in; confirm provider redirect leaves Floom and callback returns to Floom.
- Start Google sign-in; confirm provider redirect leaves Floom and callback returns to Floom.
- Sign up with a test inbox; confirm verification email receipt.
- Use password reset with a test inbox; confirm reset email receipt.

Production env reminders:

```bash
export FLOOM_STORE_HIDE_SLUGS="<comma-separated non-launch slugs>"
export RESEND_API_KEY="<prod key>"
export GITHUB_CLIENT_ID="<prod id>"
export GITHUB_CLIENT_SECRET="<prod secret>"
export GOOGLE_CLIENT_ID="<prod id>"
export GOOGLE_CLIENT_SECRET="<prod secret>"
```

Before migration:

```bash
sqlite3 "$PROD_DB_COPY" ".backup '/tmp/floom-pre-launch-2026-04-28.db'"
sqlite3 "$PROD_DB_COPY" "select count(*) from user_secrets;"
sqlite3 "$PROD_DB_COPY" "select count(*) from workspace_secrets;"
sqlite3 "$PROD_DB_COPY" "select count(*) from workspace_secret_backfill_conflicts;"
```

After migration:

```bash
sqlite3 "$PROD_DB_COPY" "select workspace_id, app_slug, key, count(*) from workspace_secrets group by 1,2,3 having count(*) > 1;"
sqlite3 "$PROD_DB_COPY" "select * from workspace_secret_backfill_conflicts limit 20;"
```

## Verification Evidence

Passed locally:

```text
pnpm --filter @floom/server build
pnpm --filter @floom/web build
pnpm typecheck
node test/stress/test-workspace-secrets.mjs
node test/stress/test-workspace-secrets-backfill.mjs
node test/stress/test-agent-tokens-workspace.mjs
node test/stress/test-hub-store-hide-slugs.mjs
node test/stress/test-routes.mjs
node test/stress/test-email-transactional.mjs
node test/stress/test-auth-dynamic-baseurl.mjs
pnpm exec tsx test/stress/test-launch-demos.mjs
node test/stress/test-mcp-byok-gating.mjs
node test/stress/test-launch-demo-http-smoke.mjs
node test/stress/test-mcp-run-parity.mjs
node test/stress/test-redirects.mjs
```

Browser verification:

```text
/status title: Status · Floom
Rendered text includes: Floom system status, Runtime API, Operational
Style element count: 0
Screenshot: /tmp/floom-status-page.png
```

