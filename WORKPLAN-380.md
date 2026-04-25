# WORKPLAN-380 — CSP inline-style migration (Phase 1 inventory + audit)

Issue: [#380](https://github.com/floomhq/floom/issues/380)  
Phase: 1 (inventory + audit only; no CSP changes)

## Scope and constraints

- This document audits the migration set defined in `docs/ops/security-headers.md`.
- No source migration was performed in this phase.
- `apps/server/src/middleware/security.ts` was not modified in this phase.

## Baseline counts

Command requested in issue task:

```bash
grep -r "style={{" apps/web/src --include=*.tsx --include=*.ts -n | wc -l
```

Observed count (2026-04-25): **2058**

Migration-plan target set (`<style>{` blocks listed in docs):

- **18 files**
- **19 inline `<style>` blocks** (AboutPage contains 2 blocks)

## Inventory (complete for migration-plan target set)

Legend:
- `STATIC`: no runtime interpolation; safe to extract to CSS file/module.
- `DYNAMIC`: depends on props/state/runtime values; use CSS variables and keep minimal inline only if strictly needed.
- `THIRD-PARTY`: inline CSS owned by external package/component that we cannot directly edit.

| File | Line | Inline style content audit | Classification | Phase 2 action |
|---|---:|---|---|---|
| `apps/web/src/pages/AboutPage.tsx` | 182 | `@media (max-width: 720px)` collapses `.about-who-cards` to 1 column | `STATIC` | Move rule to bundled stylesheet/module; keep selector name or rename with scoped class |
| `apps/web/src/pages/AboutPage.tsx` | 463 | `@media (max-width: 640px)` collapses `.about-triad` and adjusts gap | `STATIC` | Move rule to bundled stylesheet/module |
| `apps/web/src/pages/AppPermalinkPage.tsx` | 1720 | Mobile-only (`<=640px`) layout overrides for hero, tabs, truncation, chip spacing | `STATIC` | Move full media block to stylesheet/module; preserve `data-testid` selectors |
| `apps/web/src/pages/AppsDirectoryPage.tsx` | 670 | Mobile toolbar/header/search overrides; skeleton grid breakpoints; `@keyframes apps-skeleton-shimmer` | `STATIC` | Move block + keyframes to stylesheet/module |
| `apps/web/src/pages/PricingPage.tsx` | 693 | `selfhost-inner` breakpoint + mobile hero/free-card typography/spacing tweaks | `STATIC` | Move media block to stylesheet/module |
| `apps/web/src/pages/NotFoundPage.tsx` | 435 | Hover/card SVG rules + responsive grid/headline/subhead adjustments | `STATIC` | Move block to stylesheet/module |
| `apps/web/src/pages/InstallInClaudePage.tsx` | 1052 | Main container padding on small screens + tablist/button compact layout | `STATIC` | Move media block to stylesheet/module |
| `apps/web/src/pages/LandingV17Page.tsx` | 553 | Hero typography and layout breakpoints (`1040/780/640`) across CTA, grids, limits | `STATIC` | Move media block to stylesheet/module |
| `apps/web/src/pages/CreatorHeroPage.tsx` | 945 | Hero breakpoint typography/layout (`1040/780/640`) for input, CTA row, logos, headers | `STATIC` | Move media block to stylesheet/module |
| `apps/web/src/components/public/AppGrid.tsx` | 430 | Grid breakpoints (`1024/760/480`) + focus-visible ring selector | `STATIC` | Move media block + focus style to stylesheet/module |
| `apps/web/src/components/FeedbackButton.tsx` | 92 | Trigger button base/hover/focus pseudo-element styles + mobile offset | `STATIC` | Move selector block to stylesheet/module |
| `apps/web/src/components/docs/DocsPublishWaitlistBanner.tsx` | 93 | Mobile horizontal padding adjustment for waitlist banner | `STATIC` | Move media block to stylesheet/module |
| `apps/web/src/components/home/LaunchAnswers.tsx` | 147 | Grid responsive transitions (`3/2/1` style behavior) | `STATIC` | Move media block to stylesheet/module |
| `apps/web/src/components/home/HeroAppTiles.tsx` | 201 | Grid breakpoint rules (both `<=900` and `<=520` currently set to 2 columns) | `STATIC` | Move media block to stylesheet/module (optionally dedupe identical breakpoint behavior) |
| `apps/web/src/components/home/ProofRow.tsx` | 75 | Mobile gap rule + `@keyframes proof-shimmer` animation | `STATIC` | Move media + keyframes to stylesheet/module |
| `apps/web/src/components/home/WhyFloom.tsx` | 124 | Grid collapse to single column at `<=900px` | `STATIC` | Move media block to stylesheet/module |
| `apps/web/src/components/home/LayersGrid.tsx` | 164 | Grid transitions to 3 columns then 1 column at narrow widths | `STATIC` | Move media block to stylesheet/module |
| `apps/web/src/components/home/ArchitectureDiagram.tsx` | 186 | Class-based layout rules + responsive `arch-node`/`arch-surfaces` adjustments | `STATIC` | Move class rules and media block to stylesheet/module |
| `apps/web/src/components/onboarding/CoachMark.tsx` | 295 | `@keyframes floom-onboarding-pulse` animation definition | `STATIC` | Move keyframes to stylesheet/module |

## Classification summary

- `STATIC`: **19 / 19**
- `DYNAMIC`: **0 / 19**
- `THIRD-PARTY`: **0 / 19**

Result: migration-plan target set does not require hash allowlists or runtime CSS-variable indirection in its current form.

## Proposed migration order (Phase 2)

1. Establish shared extraction target and import order
   - Create a dedicated stylesheet/module for migrated responsive + keyframe rules.
   - Ensure it loads after base styles to preserve intended overrides.
2. Migrate low-blast-radius component blocks first
   - `DocsPublishWaitlistBanner`, `LaunchAnswers`, `WhyFloom`, `LayersGrid`, `ProofRow`, `CoachMark`, `HeroAppTiles`.
3. Migrate shared/high-traffic layout components
   - `AppGrid`, `FeedbackButton`, `ArchitectureDiagram`.
4. Migrate page-level blocks
   - `AboutPage` (both blocks), `NotFoundPage`, `PricingPage`, `InstallInClaudePage`, `LandingV17Page`, `CreatorHeroPage`.
5. Migrate highest-regression-risk pages last
   - `AppsDirectoryPage`, `AppPermalinkPage`.
6. After visual + test verification, remove `'unsafe-inline'` from style element policy and re-enable strict assertion in `test/stress/test-security-headers.mjs`.

## Risk assessment

- Cascade/order risk: moved rules can lose precedence relative to existing CSS. Mitigation: import order control + preserve selectors + keep `!important` where currently required.
- Responsive regression risk on high-traffic pages (`/apps`, `/p/:slug`, landing variants). Mitigation: breakpoint-by-breakpoint viewport checks before CSP tightening.
- Selector coupling risk: several rules target `data-testid` and specific DOM structure. Mitigation: no structural refactor in same PR; migrate styles only.
- Keyframes name collision risk when centralized. Mitigation: keep existing prefixed names (`apps-skeleton-shimmer`, `proof-shimmer`, `floom-onboarding-pulse`).

## Phase 2 verification/test plan

1. Automated checks
   - `pnpm typecheck`
   - `pnpm lint`
   - `pnpm build`
   - `node test/stress/test-security-headers.mjs`
2. CSP assertions
   - Confirm top-level CSP no longer includes `'unsafe-inline'` for style elements per final policy decision.
   - Keep/adjust `style-src-attr` intentionally and document rationale.
3. Functional responsive checks (desktop + mobile widths)
   - `/apps`
   - `/p/:slug`
   - `/` landing and `/creator` hero
   - `/pricing`, `/about`, `/install-in-claude`, `/404`
4. Evidence required in Phase 2 PR
   - Before/after screenshots at key breakpoints for every migrated file.
   - Test command outputs and final CSP header sample.

## Phase 1 completion checklist

- [x] Re-read `docs/ops/security-headers.md`
- [x] Ran `grep -r "style={{" ...` and recorded count
- [x] Audited all migration-plan files and inline `<style>` blocks
- [x] Wrote this workplan without modifying source/CSP
