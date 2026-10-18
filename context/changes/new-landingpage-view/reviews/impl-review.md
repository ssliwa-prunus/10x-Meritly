<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: New Landing Page View

- **Plan**: context/changes/new-landingpage-view/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-18
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Evidence:

- **Plan drift.** Every planned change is a MATCH, with no DRIFT and nothing MISSING. All 7 illustrations match the design's geometry attribute for attribute. `landing.pitch` is byte-identical to `37599bd`. `tests/**` is unchanged.
- **The only EXTRA item** is the `package.json` / `package-lock.json` bump from 0.1.0 to 0.2.0, which the user asked for during Phase 1.
- **Automated checks re-run on HEAD:**
  - `astro check`: 0 errors, 0 warnings
  - `lint`: clean
  - `lint:ui`: 26 files clean
  - `npm test`: 630 passed
  - `build`: complete
- **Smoke and E2E** passed in this session against the Phase 3 build: all smoke steps, and E2E 5/5. Since then only `plan.md` and `change.md` changed.
- **Manual checks:** all 13 manual rows were confirmed by the user.
- **Dismissed reviewer claim:** a reviewer said the smoke step's `bodyExcludes: ["Załóż konto"]` depends on the admin's locale. It doesn't: the admin cookie jar pins `lang=pl` (`scripts/smoke.mjs:47-52`).

## Findings

### F1 — Google Fonts on the public landing page send every visitor's IP to Google

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/index.astro:10-15
- **Detail**: The fonts load from `fonts.googleapis.com` and `fonts.gstatic.com` before any consent. For a Polish/EU audience this is a known GDPR exposure (LG München, 2022). The plan only noted the CSP angle. The markup itself is correct: preconnect `crossorigin` and `display=swap` are set.
- **Fix A ⭐ Recommended**: Self-host the three families with `@fontsource/space-grotesk`, `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono` (only the planned weights), imported on `/` only, and remove the Google links.
  - Strength: No third-party request and no consent question. The fonts are served from the Worker's own origin, and it also future-proofs a CSP.
  - Tradeoff: 3 new dependencies and about 100–200 KB of font files in the build.
  - Confidence: HIGH — the standard approach for Astro, which is what the `@fontsource` packages are built for.
  - Blind spot: Not verified how the Cloudflare adapter serves the imported font assets, though Vite bundles them as static assets.
- **Fix B**: Keep Google Fonts and record the decision in `change.md` Notes.
  - Strength: Zero code change, and it is what the plan agreed.
  - Tradeoff: The privacy exposure stays in place.
  - Confidence: MED — acceptable only if the project doesn't target EU visitors under strict consent rules.
  - Blind spot: The legal stance hasn't been checked with whoever owns compliance.
- **Decision**: FIXED (via Fix A). Added `@fontsource/{space-grotesk,ibm-plex-sans,ibm-plex-mono}` ^5.3.0 and replaced the Google links with per-weight imports in `src/pages/index.astro`. Verified in the preview: `/` has 0 Google references, and `/auth/signin` CSS has 0 `@font-face` rules.

### F2 — Illustration tokens are duplicated in `.dark` and published as unused utilities

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/styles/global.css (`:root` ~42-59, `.dark` ~99-116, `@theme inline` ~158-174)
- **Detail**: All 17 `--illustration-*` values are copied byte for byte into `.dark`. The plan asked for this, but it risks the two copies drifting apart. The SVGs use `var(--illustration-*)` attributes, so no `fill-illustration-*` or `text-illustration-*` class is used yet.
- **Fix**: Declare the illustration tokens once in `:root`, drop the duplicate `.dark` block, and keep the `@theme` entries for future views.
- **Decision**: FIXED. Removed the 17 duplicate `.dark` declarations from `src/styles/global.css` and kept the `:root` values and the `@theme` entries. Updated the wording in `tokens.md` to match.

### F3 — Signed-in visitors on `/` no longer see the Topbar's role links

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/Welcome.astro:73-83
- **Detail**: The header-variant decision means signed-in visitors on `/` see only a Dashboard link and Sign out. The email and the Projects / Employees / Reports / My bonuses links are gone. This was intended, but "What We're NOT Doing" doesn't say so.
- **Fix**: Add a line to the plan's "What We're NOT Doing": "no role-specific nav on `/`; signed-in users reach it via the dashboard".
- **Decision**: FIXED. Added the line to the plan's "What We're NOT Doing".

### F4 — Vague nav label and literal formula symbols

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/Welcome.astro:57, :263, :266; src/lib/i18n/messages/{pl,en}.ts (`landing.nav.label`)
- **Detail**: The in-page nav's `aria-label` is "Główna" / "Main", which is vague for a list of section links. The `∝` and `×` symbols in the formula band are literals in the view. That is borderline under the no-literals i18n rule, though they are language-neutral.
- **Fix**: Rename the label to "Sekcje strony" / "Page sections", and move `∝` and `×` into `landing.formula`.
- **Decision**: FIXED. `landing.nav.label` is now "Sekcje strony" / "Page sections". New keys `landing.formula.proportional` / `times` hold the symbols in both dictionaries, and `Welcome.astro` reads them.

### F5 — The UI literal guard misses unit-less and percentage arbitrary values (pre-existing)

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: scripts/check-ui-literals.mjs:30-31
- **Detail**: The regex only catches `-[<n>px|rem]`. It would miss `w-[58%]`, `text-[clamp(...)]` and `ring-[3]`-style values, which CLAUDE.md also forbids. The new views use none of these; this is a gap in the guard, not a violation in this change.
- **Fix**: Widen the arbitrary-value branch to any `-[` bracket value (excluding `[--var]` / `[var(--…)]` if needed), as a separate follow-up change.
- **Decision**: QUEUED as a follow-up in `context/changes/new-landingpage-view/follow-ups/review-fixes.md` (separate change, pre-existing gap).
