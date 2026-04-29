# Landing / v17 wireframe parity audit — 2026-04-24

**Target page:** `apps/web/src/pages/LandingV17Page.tsx` (route `/`)
**Wireframe:** https://wireframes.floom.dev/v17/landing.html
**Preview:** https://preview.floom.dev/ (captured 2026-04-24, 1400x900)

**Outcome:** 0 code changes. Audit-only PR.

## Why this exists

Federico 2026-04-24: "some of them, like pricing are actually better now than wireframes, so dont follow blindly as this will lead to regressions."

The landing page has been polished heavily in the last 72h (PRs #662, #676, #696, #701, #709, #689). Several explicit Federico decisions supersede the wireframe. This doc captures the section-by-section comparison so future parity agents start with the ledger, not a blank slate.

Methodology:
1. Downloaded wireframe end-to-end.
2. Read `LandingV17Page.tsx` in full, including inline comments that cite the PR + date each section was tuned.
3. Read `git log -30` on the landing page + `apps/web/src/components/home/`.
4. Read PR bodies for #662, #676, #689, #696, #701, #709.
5. Full-page screenshot of preview at 1400x900.
6. Section-by-section verdict below. Default = KEEP unless wireframe captures a genuine gap.

## Change log

| # | Section | Current | Wireframe | Verdict | Reason |
|---|---|---|---|---|---|
| 1 | Hero eyebrow pill "Launching 27 April 2026" | Absent | Present | **KEEP** | LaunchWeekPill removed from landing in PR #676 (closes #669). Federico decision 2026-04-24. Kept on /waitlist only. |
| 2 | Works-with belt position | Above H1 (as eyebrow band) | Below CTAs | **KEEP** | Current position was tuned 2026-04-24 for hero margin (inline comment L143-149). Reordering would undo that margin fix. |
| 3 | Hero H1 "Ship AI apps fast." | Matches | Matches | **SKIP** | Aligned. |
| 4 | Hero sub "The protocol and runtime for agentic work." | Matches | Matches | **SKIP** | Aligned. |
| 5 | Hero CTAs | `[Run this in Claude]` ink + `[Deploy your own →]` text link | `[Try an app]` accent + `[Publish your app]` ink | **KEEP** | Current CTAs were chosen by Federico 2026-04-23 (inline comment L187-195 lists rejected alternatives verbatim). Wireframe predates. |
| 6 | Hero meta row ("22 live apps · MIT-licensed core · Self-host in 1 command") | Absent | Present | **KEEP** | "22 apps live" → "3 AI apps" was a PR #701 locked scope fix. "MIT-licensed" was banned from marketing copy in PR #701 per MEMORY.md. Adding this would regress two Federico-locked rules. |
| 7 | Hero demo | HeroDemo component (3-state Build/Deploy/Run) | 2-col Input/Output card | **KEEP** | HeroDemo is owned by another agent per brief. Out of scope. |
| 8 | CLI reference strip | Present (below hero) | Absent | **KEEP** | Added 2026-04-23 per inline comment L252-254. |
| 9 | How it works (3 steps) | Matches verbatim | Matches | **SKIP** | Identical copy. |
| 10 | WorkedExample band | Present (Lead Scorer 87/100) | Absent | **KEEP** | Added PR #662 (closes #541). Federico-requested. |
| 11 | ThreeSurfacesDiagram | Present | Absent | **KEEP** | Added PR #662 (closes #542). |
| 12 | FitBand (single "For" card) | Present, single card | Absent | **KEEP** | Anti-ICP "Not for" column intentionally removed in PR #701. |
| 13 | Showcase layout | Vertical AppStripe list | 1.2fr/1fr/1fr grid with PNG thumbs + "HERO" pill + run counts | **SKIP** | Borderline: grid layout differs. NOT adopted because (a) PR #701 explicitly removed FRESH/run-count badges ("read as noise"), (b) PNG thumb assets not confirmed for all 3 apps, (c) AppStripe `variant="landing"` is the intentional current choice, (d) parity-not-blind default = KEEP. Flag for future triage only. |
| 14 | Showcase copy | Matches | Matches | **SKIP** | Identical. |
| 15 | PublishCtaBox | Present | Present | **SKIP** | Aligned. |
| 16 | DualAudiences | Present, "3 AI apps, free to run" | Present, "22 apps live, free to run" | **KEEP** | "22 apps live" → "3 AI apps" explicit PR #701 fix. |
| 17 | PricingTeaser | Single $0 card | Single $0 card | **SKIP** | Federico called this out: "pricing are actually better now than wireframes". |
| 18 | "Want to build yours?" CTA | Present, Open the docs + Star on GitHub | Matches | **SKIP** | Identical. |
| 19 | WhosBehind (Fede photo) | Present | Absent | **KEEP** | Added PR #662 (closes #589). Previous cleanup agent was scolded for removing this (feedback_agents_preserve_dont_wipe.md). |
| 20 | DiscordCta chip | Present | Absent | **KEEP** | Added PR #662 (closes #613). |
| 21 | Footer | Shared `PublicFooter` | Custom footer in wireframe | **SKIP** | Shared component, not landing-scoped. |

## Summary

- **KEEP**: 10 items (each protects a Federico-explicit decision from the last 72h)
- **SKIP**: 10 items (aligned or out of scope)
- **MATCH**: **0 items**

## Preserved Federico decisions (regression check)

Every item below was at risk of being wiped by a blind-match agent. This audit preserves them:

1. Launch pill removed from landing (#669 / PR #676)
2. Hero CTAs `Run this in Claude` + `Deploy your own` (2026-04-23 in-code comment)
3. Hero works-with belt position and margin (2026-04-24 comment)
4. "3 AI apps, free to run" on DualAudiences teams card (PR #701)
5. No "MIT-licensed" in marketing copy (PR #701 + MEMORY.md global rule)
6. FitBand single-card "For" variant, no anti-ICP column (PR #701)
7. CLI reference strip below hero (2026-04-23)
8. WorkedExample band (PR #662, #541)
9. ThreeSurfacesDiagram (PR #662, #542)
10. WhosBehind Fede photo + bio (PR #662, #589)
11. DiscordCta chip (PR #662, #613)
12. Pricing teaser already better than wireframe (Federico 2026-04-24)
13. HeroDemo 3-state Build/Deploy/Run surface (owned by separate agent)

## Recommendation

Ship this doc as-is. No landing-page code changes warranted. If a future parity pass wants to revisit item #13 (Showcase grid), it should go through a dedicated issue with Federico's buy-in on: (a) re-adding run-count badges that were explicitly removed in #701, (b) sourcing 3 PNG thumbnails for the apps, (c) keeping the `HERO` pill semantic.
