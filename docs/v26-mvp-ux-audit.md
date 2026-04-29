# v26 MVP UX Audit (M4)

Author: Claude (subagent), 2026-04-29. Closes #1066.
Scope: every page reachable on `mvp.floom.dev` (deployed from `origin/launch-mvp`, build `0.4.0-mvp.5`).
Method: live `browse extract` per route, plus source review on `origin/launch-mvp`. Worktree branched from `origin/feat/v26-unified` per M4 brief.
Verified live: 2026-04-29 18:55 UTC, `curl https://mvp.floom.dev/api/healthz` returned `version:"0.4.0-mvp.5"`.

## TLDR

| Item | Value |
|---|---|
| MVP UX score | **5.5/10** |
| Pages audited | 14 anon + 1 authed (token mint) |
| P0 issues | 4 |
| P1 issues | 9 |

The slim auth-to-MCP-token flow (`/login` → `/home` → mint token → copy snippet) works and `/home` is the cleanest page in the surface. But the public surface leaks the full marketing site, the anon TopBar carries 8 items competing with one CTA, and three regressions from the V26-FEEDBACK-LOG M-track and X1 are still on `mvp.floom.dev`.

## Top three cross-page issues

### P0-1. `/` is not the slim MVP landing (M5 regression)

V26-FEEDBACK-LOG line 13 marks M5 FIXED with "hero + 3-step explainer + mini footer". Reality: `LandingMVPPage.tsx` is a 13-line wrapper around `<LandingV17Page variant="mvp" />`. The variant drops 6 sections out of roughly 14. What ships is the full marketing landing minus the creator-track and technical sections. 222 lines of extracted text including showcase grid (3 featured apps), full directory grid (10 apps), and a 6-question FAQ. Evidence: `/tmp/mvp-landing-extract.txt:1-222`. The feedback log entry overstates the fix.

### P0-2. Anon TopBar leaks 8 nav items on every page

Every public page renders `floom. · Apps · Docs · Pricing · Changelog · ★7 · Get install snippet · Sign in · Sign up`. Cited at `/tmp/mvp-login.txt:2-9`, `/tmp/mvp-pricing.txt:2-9`, `/tmp/mvp-help.txt:2-9`. V11 in V26-FEEDBACK-LOG removed centre nav for authed users only; anon was kept "unchanged" (074f467a). For an MVP funnel, 8 items is too many. `Get install snippet` competes with `Sign up`; `★7` is dev-bait. Slim spec: `floom. · Sign in · Sign up`.

### P0-3. Footer still ships "Built in SF · Founders Inc cohort" (X1 regression)

Visible on every page footer. X1 marks this FIXED on unified (074f467a, "footer now just 'Ship AI apps fast.'"), but `apps/web/src/components/public/PublicFooter.tsx:193,200` on `origin/launch-mvp` still renders both strings. Federico is in Hamburg moving to SF; the tag misleads. Cherry-pick is one revert.

### P0-4. Three pages have wrong `<title>`

`/help`, `/forgot-password`, `/home` all return `Ship AI apps fast · Floom` (the global default) instead of page-specific titles. Pages that DO set their own title: `/login`, `/signup`, `/p/:slug`, `/apps`, `/pricing`, `/protocol`, `/docs`, `/about`. Per-page negligence on three components.

## MVP-visible routes

From `git show origin/launch-mvp:apps/web/src/main.tsx`. Post-auth landing is `/home` (`LoginPage.tsx:69`, `nextPath = safeNext || '/home'`). Legacy `/me/*` paths server-301 to `/run/*`, `/settings/*`, or `/home` via `LegacyWorkspaceUiRedirect` (`main.tsx:183-219`); `/settings/agent-tokens` SPA-redirects again to `/home` (`main.tsx:336`). So `/me/agent-keys` is a two-hop redirect to `MvpHomePage`.

| Route | Component | Notes |
|---|---|---|
| `/` | LandingMVPPage | wraps LandingV17Page variant=mvp |
| `/login`, `/signup` | LoginPage | shared component, mode prop |
| `/forgot-password`, `/reset-password` | ForgotPassword/ResetPassword | |
| `/apps`, `/store` | AppsDirectoryPage | 10-app grid |
| `/p/:slug` | AppPermalinkPage | run public app, free runs counter |
| `/install`, `/install-in-claude` | InstallPage / InstallInClaudePage | self-host + MCP setup |
| `/protocol` | ProtocolPage | spec long-form |
| `/docs`, `/docs/:slug` | DocsLandingPage / DocsPage | sidebar IA |
| `/pricing`, `/about`, `/changelog`, `/help` | static marketing | |
| `/home` (authed only) | MvpHomePage | token mint + install tabs |

Authed `/run/*` and `/studio/*` are out of scope per the V26-FEEDBACK-LOG MVP cluster (M1-M5 are consumer-first); they have V1-V17 tracking already.

---

## Page findings

Each entry: stated purpose, strengths (max 3), issues (P0 → P3, max 5), severity-tagged. Every claim cites file:line or `/tmp/mvp-<page>.txt:line`. Concrete fixes are in the "Ship in 4 hours" list at the end.

### `/` LandingMVPPage

Purpose: convert cold visitor to sign-up + token mint, OR direct them to `/p/:slug` for a public-app trial.

Strengths: hero `Ship AI apps fast.` is crisp and product-true. `npx @floomhq/cli@latest setup` is real and copyable. Stat row "10 apps live · 1294 runs this week · ★ 7 stars" is honest social proof.

Issues:
- P0 not actually slim (cross-page #1).
- P1 hero has two equally-prominent CTAs (`Copy npx` + `try a live app in your browser →`); spec calls for one.
- P1 hero sub `Beta access via waitlist` contradicts the live `Sign up` button: `/signup` opens directly, no waitlist gate. One copy is wrong.
- P2 directory grid below the showcase duplicates `/apps`. Should link, not inline.
- P3 STEP 02 reads `DEPLOY (BUILDERS ONLY) · Join the waitlist`. Visitor reads "waitlist" in hero and bounces before reaching step 2.

### `/login` LoginPage

Purpose: sign in. Doubles as `/signup` via tab.

Strengths: single 440px column (M1 fix landed). H1 + sub copy is direct. OAuth + email/password both available (P0-C fix 2026-04-27).

Issues:
- P1 inline `Sign in · Sign up` tabs under the H1 are redundant with the bottom-link toggle; pick one.
- P1 `Continue with GitHub` button is rendered alongside Google; if launch-mvp `cloud_mode` lacks GitHub provider it's a dead button. Gate render on provider availability.
- P2 Terms / Privacy links open inline (no `target="_blank"`); user loses login state mid-flow. Verify in `LoginPage.tsx:280-310`.
- P2 `Back to home` is a small footer link; easy to miss.

### `/signup` LoginPage mode=signup

Same component as `/login`. H1 → `Create your account.`, sub → `30 seconds. Free during launch.`. Inherits all `/login` issues. Plus:
- P1 `Display name` is the first input. Email + Password is the universal sign-up shape; default display name from email and let user edit later in settings.

### `/forgot-password` ForgotPasswordPage

Strengths: one field, one CTA, copy is right (`We'll send a reset link valid for 15 minutes`).

Issues:
- P0 wrong `<title>` (cross-page #4).
- P1 only escape link is "Remembered it? Sign in →"; no `Back to home`.
- P2 `floom` logo above the H1 (`/tmp/mvp-forgot.txt:13`) duplicates the TopBar wordmark. M1's "removed page-level hero logo" fix was for LoginPage; same fix needed here.

### `/home` MvpHomePage (authed only)

Read from source: `git show origin/launch-mvp:apps/web/src/pages/MvpHomePage.tsx`.

Strengths: single-card layout (`TopBar + TokenCard + InstallTabs + PublicFooter`, lines 51-55). One-time token reveal pattern is correct (lines 246-265: redacted token + `Copy this token now: it won't be shown again` + visible `Done, I've saved it` dismiss). Install snippet uses `window.location.origin` (line 31), so a token minted on `mvp.floom.dev` produces `mvp.floom.dev/mcp` not the hardcoded `floom.dev` that broke Federico's flow on 2026-04-28 (cited in source comment).

Issues:
- P0 wrong `<title>` (cross-page #4).
- P1 InstallTabs has only 2 tabs (`MCP server` + `CLI`). V6 (V26-FEEDBACK-LOG line 24) calls for Claude / Cursor / Codex / CLI (4-way). Each MCP client has a different config file; collapsing into one JSON snippet is wrong.
- P1 No "verify it works" affordance after the token reveal. User is left with a redacted token + snippet and no `In Claude, ask: "what floom apps can I run?"` test.
- P2 caption reads `Workspace credential. Use with MCP, CLI, or HTTP.` but no HTTP tab is rendered. Either add curl snippet or drop "HTTP".
- P2 token scope hardcoded to `read-write` (line 211); MVP user has no choice or visibility.

### `/p/:slug` AppPermalinkPage

Audited: `https://mvp.floom.dev/p/ai-readiness-audit`. Extract: `/tmp/mvp-p-slug.txt`.

Strengths: clear hero with name + tagline + version + runtime + actions. Free-runs counter visible (`Gemini on us · 5 of 5 free runs left today`). Output panel pre-renders the result schema before any run.

Issues:
- P0 input field renders as `Company Urli` (`/tmp/mvp-p-slug.txt:34`). Looks like a typo; it's the field label `Company URL` collapsed into the info-badge `i` glyph with no whitespace. JSX bug in the input renderer.
- P1 sub-tabs `About · Install · Source · Earlier runs` render as flat text; user doesn't read them as tabs.
- P1 `Or try with example data →` doesn't populate the field with an actual example value; the hint is `Public HTTPS URL only. Max 200 characters.` not a real URL.
- P2 footer is the same heavy public footer with "Built in SF" cohort.
- P3 `Audit Route Health` indicator at the top right has no label.

### `/apps` AppsDirectoryPage

Strengths: stat row + filter chips (`All 10 · Developer 6 · Research 2 · Writing 2`). Cards are consistent (icon, runs/7d, tags, "Open app").

Issues:
- P1 `Ctrl K` and `Search` and `Sort · Trending` render as small text on one line; reads as decoration, not interactive controls.
- P2 `FREE TO RUN` banner is inside the grid, breaking visual rhythm; lift it above the filter chips.
- P2 FEATURED cards have a tag but no visual border/shadow distinction from non-featured.
- P3 `Browse all 10 apps` CTA is redundant when only 10 apps exist.

### `/install` InstallPage

Two-line problem: TopBar `<title>` says `Install the Floom CLI · Floom`; page H1 says `Self-host Floom`. Two different pages collapsed into one URL.

Strengths: minimal: one Docker command, one CLI snippet, one MCP endpoint. "Open source, no waitlist, no signup" is a clear statement for the self-host audience.

Issues:
- P0 title vs H1 mismatch.
- P1 page mixes self-host content (Docker, localhost:3051) with cloud content (CLI auth) without separating them. IA muddled.
- P2 `floom auth login --token=floom_agent_...` placeholder doesn't link to `/home` where the token is minted. Dead-end for new users.

### `/install-in-claude` InstallInClaudePage

Strengths: two-track pattern (Use apps / Publish your app) with clear consumer/creator split. Three-step `Open / Run command / Use by name` is the right shape. Workspace MCP helper card with redacted token preview.

Issues:
- P1 mixes `claude skill add` (Skills) and `claude mcp add` (MCP servers) without explaining when to use each. Consumer track uses `skill add`, workspace track uses `mcp add`. New user can't tell.
- P2 publish track has 3 stacked commands (curl install, init, deploy). Creator content; doesn't belong on the MVP auth-to-MCP page. Move to `/studio/build` or behind a "Publish" link.
- P2 Workspace MCP helper card says "shown to current user" but is rendered to anonymous viewers too.
- P3 `Create Agent token` button doesn't preview destination.

### `/protocol` ProtocolPage

Strengths: long-form spec with TOC. Self-contained for deep-link from `/p/:slug`.

Issues:
- P2 250 lines without an executable example at the top. Open with a 5-line `floom.yaml` then explain.
- P2 `License` section has no body text in the extract. Either fill or remove.
- P3 flat TOC for 10 sections; should be 2-column or collapsed.

### `/docs` DocsLandingPage

Strengths: clear sidebar IA with 10 sections. `Quickstart NEW` tag draws the eye.

Issues:
- P1 sidebar has 30+ flat links; no way to collapse sections.
- P2 right pane has no welcome content. If "pick from sidebar" is the intent, that's a wasted right pane. Add a `Quickstart` block.
- P2 `MCP Install` (Claude Desktop / Cursor / Codex CLI) collides with `/install-in-claude`. Two paths to the same content.
- P3 no search input.

### `/pricing` PricingPage

Strengths: one number ($0), three-tier explanation, FAQ collapse for objections.

Issues:
- P2 `LAUNCH WEEK · 27 APRIL 2026` chip is hardcoded; will read stale on day 8.
- P2 `5 runs / app / 24h` cap buried in cell body; lift to stat row.
- P3 `Read the docs →` and `Create account` CTAs visually equal.

### `/help` HelpPage

Strengths: 4-card escalation path (Docs / Discord / DM Federico / Email). `We reply within 24 hours` is honest.

Issues:
- P0 wrong `<title>` (cross-page #4).
- P1 Common questions section lists 5 questions as link text; clicking expands? navigates? unclear.
- P2 `DM Federico` won't scale post-launch; flag as `(launch-week only)` or remove.
- P2 Discord link adjacent to DM Federico: same outcome (real-time chat); pick one.

### `/about` AboutPage

Strengths: hero `Get that thing off localhost fast.` is the single best one-liner on the entire surface; should propagate to `/`. 3-stat row is punchy.

Issues:
- P1 `WHO'S BEHIND IT` block reuses Founders Inc cohort copy; same SF-tag conflict as the footer.
- P2 `Each app runs isolated. Your Anthropic key, your colleagues' Stripe key, and the public hub never share state.` introduces three actors at once. Simplify.

### `/changelog` ChangelogPage

Strengths: one block per release, dated, versioned. `v0.5.0-mvp · MVP launch · 2026-04-28` is clear.

Issues:
- P3 no atom/RSS link; agent ecosystems can't subscribe.

---

## Ship in 4 hours: minimum cleanup

Each is a single small PR. Total under 90 minutes for one engineer. No backend changes, no new components.

1. **Page `<title>` fix on `/help`, `/forgot-password`, `/home`.** One line each in `HelpPage.tsx`, `ForgotPasswordPage.tsx`, `MvpHomePage.tsx`. Use `<PageShell title="..." />` (already used in LoginPage). ~15 minutes.
2. **Cherry-pick X1 footer fix from unified (074f467a) onto launch-mvp.** Removes "Built in SF · Founders Inc cohort" from `PublicFooter.tsx:193,200`. ~10 minutes.
3. **Fix `Company Urli` JSX in `/p/:slug` input renderer.** Add whitespace or `<span style={{marginLeft:4}}>` between `{label}` and the info-badge. ~10 minutes.
4. **Slim `LandingMVPPage` properly.** Wrap `MarketingShowcase`, `AppGrid` directory, `MarketingFAQ`, `WhatYouCanShipBand` in `{!isMvp && ...}` in `LandingV17Page.tsx`. Keep hero + 3-step `HowItWorks` + mini footer. ~30 minutes.
5. **Reconcile `/` waitlist copy.** Drop `Beta access via waitlist` from hero sub OR put `/signup` behind a waitlist gate. Pick one. ~5 minutes.
6. **Slim anon TopBar to `floom. · Sign in · Sign up`.** Drop `Apps · Docs · Pricing · Changelog · ★7 · Get install snippet` for MVP-track anon users; keep them in the footer. ~15 minutes.

Out-of-scope-but-flagged: the install-instructions matrix is duplicated across `/install-in-claude`, `/docs/MCP Install`, and `/home` install tabs (three places to update on protocol changes); the legacy `/me/*` redirect chain is two-hop (server-301 + SPA-Navigate), fine for now but collapse to single 301 post-launch.
