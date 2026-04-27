# v26 / launch feedback log — 2026-04-27

Federico's running feedback as he reviews `mvp.floom.dev` and `v26.floom.dev`. This is the source of truth so nothing falls through cracks. Each item: source screenshot (path), description, status (OPEN/IN-FLIGHT/FIXED), agent owning it.

## launch-mvp track (mvp.floom.dev)

| # | Source | Issue | Status | Agent |
|---|---|---|---|---|
| M1 | SS 10.57.37 | Login page primitive: empty right column + awkward "No password" copy + "you are in the right place" line | IN-FLIGHT | ac487988005004b26 |
| M2 | SS 10.58.01 | Stubbed pages should redirect to `/me/agent-keys`, not show ComingSoon card | IN-FLIGHT | ac487988005004b26 |
| M3 | (implied) | Post-auth default landing should be `/me/agent-keys`, not `/run/apps` | IN-FLIGHT | ac487988005004b26 |
| M4 | (implied) | UX audit of all MVP-visible pages | IN-FLIGHT | ac487988005004b26 |
| M5 | (verbal Q) | mvp.floom.dev / landing is the FULL marketing landing — too full for MVP scope (sign up → mint MCP token). Should be slim landing with one big hero CTA + brief explanation. | OPEN | (new agent) |

## v26 polish track (v26.floom.dev, branch `ui/v23-p-slug-runsurface`)

| # | Source | Issue | Status | Agent |
|---|---|---|---|---|
| V1 | (verbal) | `/run/apps` + `/studio/apps` need UX work (empty states, stat rows, mode-specific CTAs) | IN-FLIGHT | a50aa3eea1abdc340 |
| V2 | SS 10.59.51 | Rail-bottom avatar+sign-out should not exist (avatar lives in TopBar only per §12.5) | IN-FLIGHT | a5c369123e7f99eb2 |
| V3 | SS 10.59.51 | No black terminal backgrounds — use `#1b1a17` warm dark | IN-FLIGHT | a5c369123e7f99eb2 |
| V4 | SS 11.00.53 | Studio Build "Run sample" fails with "App not found: example-api" | IN-FLIGHT | a5c369123e7f99eb2 |
| V5 | SS 11.01.36 | Sidebar + content containers shift between pages — should be static | IN-FLIGHT | ad00414ed0b97c8ed |
| V6 | SS 11.02.31 | "Copy for Claude" stacks 3 install methods, overwhelming — refactor to tabs (Claude/Cursor/Codex/CLI) | IN-FLIGHT | aff6d47e69f9fcc05 |
| V7 | (verbal) | `/p/:slug` not updated to v26 chrome | IN-FLIGHT (may already be v26 — check SS 11.04.35) | aff6d47e69f9fcc05 |
| V8 | (verbal) | No "+ Install in workspace" CTA on `/p/:slug` for authed users | IN-FLIGHT | aff6d47e69f9fcc05 |
| V9 | SS 11.04.16 | Footer cluttered: 13 links across 3 columns, redundancy (Cookies/Legal, Status/Changelog), wrong tag "Built in SF" | OPEN | (new agent) |
| V10 | SS 11.04.35 | Run on `/p/ai-readiness-audit` fails with `run_8wda96xryr1d` — `floom_internal_error` | OPEN | (new agent) |
| V11 | SS 11.05.45 | Header nav not clean — `Studio` + `My runs` + GitHub `6` badge shouldn't be in TopBar (per §12.5: slim TopBar = floom + Copy-for-Claude + + New app + avatar) | IN-FLIGHT | ab8376b7f1a4fa521 |
| V12 | SS 11.06.40 | Click on app card on `/run/apps` goes to `/p/:slug` (public) — should go to private workspace view `/run/apps/:slug` | OPEN | (new agent) |
| V13 | SS 11.06.40 | Counter mismatch: rail says "Apps 0", content stat says "Apps 1 installed" — different sources of truth | OPEN | (new agent) |
| V14 | SS 11.06.40 | Auto-install on first run: ran public app once → it now appears in workspace as "installed" without explicit claim. Either: (a) language wrong (call it "recently used" not "installed"), or (b) require explicit Install action | OPEN | (new agent) |
| V15 | SS 11.06.40 | Stat "RUNS 7D" shows `—` despite "last run just now" on the same page — stat not refreshing after new run | IN-FLIGHT | a3e2374cc94737519 |
| V16 | (verbal) | Black-bg sweep must cover ALL pages incl `/docs`, `/apps`, `/pricing`, marketing — not just app surfaces | FIXED — `--terminal-bg` updated to `#1b1a17` in wireframe.css (was `#0e0e0c`, too close to black); no pure #000/bg-black anywhere else in codebase | this agent |
| V17 | (verbal) | `/docs` has the same sidebar/content shift bug as /run/studio (layout shifts based on content width) | FIXED — created DocsPageShell (flex + fixed sidebar) mirroring WorkspacePageShell; used in DocsLandingPage + DocsPage | this agent |
| X5 | (verbal) | MCP testing scope = unauth (public store directory + run public apps) + authed (user-specific apps, create app, workspace switching) | IN-FLIGHT | a800539bb5a2eab58 (claude) + codex (codex bg) |
| X7 | (verbal) | Run MCP/CLI tests with BOTH claude AND codex independently, diff findings | IN-FLIGHT | claude=a800539bb5a2eab58, codex=bg |
| X6 | (verbal Q→confirmed) | Any public-visibility app is runnable at `/p/:slug` for anyone — by design. Private apps (only_me) return 404 to outsiders. | CONFIRMED | n/a |

## Cross-cutting

| # | Source | Issue | Status | Owner |
|---|---|---|---|---|
| X1 | SS 10.59.51 | "Built in SF" tag misleading — Federico in Hamburg moving to SF | OPEN | (new agent) |
| X2 | (verbal) | ICP scenarios A/B/C/D/E full headless testing on v26 + mvp | IN-FLIGHT | a33659defe804b805 |
| X3 | (verbal) | Schema additions ADR-34 (`unlisted` tier) + ADR-35 (`password_hash`) | OPEN | awaiting Federico's approval |
| X4 | (verbal) | Triage 16 P1/P2 ICP-test issues (#829-#844) | OPEN | Federico AM triage |

## Agents currently running

| Agent | Track | Files |
|---|---|---|
| ac487988005004b26 | mvp UX | LoginPage + stubbed pages → redirects |
| a50aa3eea1abdc340 | v26 dashboards | MeAppsPage, StudioHomePage / StudioAppsPage |
| a5c369123e7f99eb2 | v26 fixes | RunRail, StudioRail, MobileDrawer, Studio Build flow |
| ad00414ed0b97c8ed | v26 layout | WorkspacePageShell migration |
| aff6d47e69f9fcc05 | v26 UX | CopyForClaudeButton + AppPermalinkPage |
| a33659defe804b805 | testing | scenario A-E across v26 + mvp |

## How to use this log
- Update on every Federico screenshot/feedback.
- Each item gets a unique ID (M1, V1, X1) for cross-reference.
- Agent IDs are short hex from the Task tool.
- Mark FIXED only after redeploy + Federico ack.
