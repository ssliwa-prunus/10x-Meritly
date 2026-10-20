---
date: 2026-10-18T18:47:54+02:00
researcher: Claude (Opus 5.5) for ssliwa
git_commit: 37599bd
branch: develop
repository: 10x-Meritly
topic: "Implement the new landing page design (reports/design/project/Main.dc.html) in the existing app"
tags: [research, landing, ui, i18n, design-tokens, Welcome.astro, Layout.astro, LanguageSwitch]
status: complete
last_updated: 2026-10-18
last_updated_by: Claude (Opus 5.5) for ssliwa
---

# Research: new landing page from the supplied design

**Date**: 2026-10-18T18:47:54+02:00
**Researcher**: Claude (Opus 5.5) for ssliwa
**Git Commit**: 37599bd
**Branch**: develop
**Repository**: 10x-Meritly

## Research Question

The user supplied a design for a new landing page ("there is design … reports\design of nie landingpage"). The only design on disk is `reports/design/project/Main.dc.html` (canvas title "Meritly Landing Redesign", board "Strona główna (PL)", 1440×3900, `reports/design/project/canvas.json`). What does it contain, what does the current `/` page look like, and which code, tokens, i18n entries, guards and tests constrain moving the design into the app?

Note: `reports/` is gitignored (`.gitignore:390` `/reports/`), so the design file is not versioned. If the plan needs to reference it, copy it into this change folder.

## Summary

- The design is a static, PL-only HTML mock with inline styles and hex colours. It has 8 parts: a header with nav anchors, its own PL/EN pill and sign-in/sign-up CTAs; a hero with a badge, H1, lead, CTAs, two check bullets and a worked-example card; a formula band; "Jak to działa" (3 illustrated steps); "Każdy widzi to, co powinien" (3 role cards with SVG avatars); "Zasady, których system pilnuje sam" (4 guarantees); a final CTA with an SVG illustration; and a footer. It has two design props: `accent` (default `#d2b1f7`, options `#a5b4fc`, `#7dd3c0`, `#f5c38a`) and `showExample` (default true) (`Main.dc.html:439-447`).
- Today `/` is `src/pages/index.astro` → `src/components/Welcome.astro`: Topbar, an H1 with the app name, the pitch, CTAs (with a signed-in branch to `/dashboard`) and 3 "how it works" steps. All its text comes from `t.landing.*` (`src/lib/i18n/messages/pl.ts:68-86`, `en.ts:65-83`).
- **Hard constraints for the plan:**
  1. `Welcome.astro` is in `CLEAN_PATHS` (`scripts/check-ui-literals.mjs:23`), so hex, `rgba()`, palette classes and arbitrary px/rem values fail `npm run lint:ui`. The design's inline colours and the ~150 SVG `fill`/`stroke` hex values cannot be pasted as they are.
  2. All text needs PL and EN entries (CLAUDE.md i18n rule). The design has PL only.
  3. Smoke (`scripts/smoke.mjs:34-35,124-133`) and E2E (`tests/e2e/language-switch.spec.ts:11-12,28-38`) assert that `/` contains the exact pitch strings "Sprawiedliwy podział puli premiowej kamieni milowych" / "Fair split of milestone bonus pools". The design moves that sentence to the footer (`Main.dc.html:434`), and the hero H1 is a different text.
  4. Layout already renders the global PL/EN `LanguageSwitch`, fixed at the bottom right on every page (`src/layouts/Layout.astro:43`, `src/components/LanguageSwitch.astro:22`). The design's header pill (`Main.dc.html:32-35`) would be a second switch. Its buttons are `type="button"` with no form, so as drawn they do nothing. E2E finds the switch by the accessible names "Przełącz na język angielski" / "Switch to English" (`language-switch.spec.ts:31,37,55`), so two controls with the same names would break Playwright's strict-mode locators.
  5. The signed-in state is missing from the design. Today signed-in visitors get Topbar (email, nav, sign-out) and a "Przejdź do panelu" CTA (`Welcome.astro:10,18,24-28`). E2E expects a "Sign out" / "Wyloguj się" button on `/` after sign-in (`language-switch.spec.ts:68,73`).
- **Wrong copy in the design:** the worked-example card shows whole-złoty bonuses and "2 zł z zaokrągleń w dół zostaje w puli" (`Main.dc.html:106,115,124,131-132`). The app floors each bonus **to the grosz** (`supabase/migrations/20261004120000_milestone_kpi_and_payouts.sql:12,26-27`). With the design's inputs (pool 24 000 zł; e = 1.8, 0.8, 0.5; Σe = 3.1) the app's figures are 13 935,48 / 6 193,54 / 3 870,96 zł, which sum to 23 999,98 zł and leave a 0,02 zł residual, not 2 zł. The pool line `30 000 × 1,2 ÷ 1,5 = 24 000 zł` (`Main.dc.html:85`) matches the hard-cap rule `floor(target × M / multiplier_max)` (`20261004130000_milestone_payout_hard_cap.sql:6`). Its inputs are valid but not the defaults: the default `multiplier_max` is 1.30, rating factors run 0.80–1.20, and the largest default role weight is 1.25 (`20260926120000_bonus_rules_config.sql:177,181`). The card says "Przykład ilustracyjny", so non-default inputs are fine, but the rounding text describes the wrong rule.
- Fonts: the design loads Space Grotesk, IBM Plex Sans and IBM Plex Mono from Google Fonts (`Main.dc.html:11-12`). No font is configured in the app today: no `font`/`googleapis` hit in `src/styles`, `src/layouts` or `astro.config.mjs`, and no `public/_headers` (CSP) file. Adding fonts is a new, app-wide decision because `global.css` is shared.

## Detailed Findings

### The design (`reports/design/project/Main.dc.html`)

- Wrapper: the gradient is `#0d1222 → #141a30 → #0d1222` with text `#f7f8fb` (`:18`). Visually this matches the existing `bg-cosmic` utility (`src/styles/global.css` `@utility bg-cosmic`: background → background-accent → background). The `.dark` `--background`/`--background-accent` tokens are dark navy oklch values, so `bg-cosmic` is the token-safe equivalent.
- Header (`:21-39`): an SVG logo using `{{accent}}`, a "Meritly" wordmark, nav anchors `#jak` / `#role` / `#gwarancje`, the PL/EN pill (`:32-35`), and the CTAs "Zaloguj się" `#signin` and "Załóż konto" `#signup` (`:36-37`). The hrefs are placeholders; the real routes are `/auth/signin` and `/auth/signup` (`Welcome.astro:31,34`).
- Hero (`:42-136`): a badge with a success dot (`:44-47`), H1 "Pula premiowa podzielona uczciwie. Co do złotówki." (`:48`), the lead (`:49`), CTAs (`:50-55`) and 2 check bullets (`:56-59`). Note: "Co do złotówki" sits awkwardly next to the app's grosz precision; this is a copy decision for the user.
- Worked-example card (`:63-135`), wrapped in `<sc-if value="{{showExample}}">`: 3 stat tiles, the formula line, a 5-column table (Rola, Czas, Waga, Ocena, Premia) with 58% / 26% / 16% share bars (these match e_i/Σe = 1.8/3.1, 0.8/3.1, 0.5/3.1), and a figcaption with the sum and the residual.
- Formula band (`:139-149`): "udział pracownika ∝ czas pracy × waga roli × współczynnik oceny". This matches the e_i definition (`20261004120000_…sql:11`).
- "Jak to działa" (`:155-248`): 3 cards, each with a 200×140 inline SVG, a mono step number and a title. The bodies are reworded versions of the current `t.landing.steps.*` texts (compare `:194,221,245` with `pl.ts:75,79,83`). Note: in the HTML, `id="jak"` sits on the section commented `<!-- Roles -->` (`:154-155`); the `<!-- How it works -->` comment (`:151`) is empty. The anchors still point to the right content.
- Roles (`:248-328`): Administrator / Przełożony / Pracownik cards with 96×96 SVG avatars. The texts match the CLAUDE.md role definitions.
- Guarantees (`:331-356`): 4 items (budget, frozen results, time-share >100% warning, RLS privacy). Each matches an invariant in CLAUDE.md.
- Final CTA (`:359-429`): a 520×230 illustration, the H2 and both CTAs. Footer (`:431-436`): the wordmark and the current pitch sentence.
- Interaction: none. The PL/EN buttons have no handler (`:33-34`). The `accent`/`showExample` props are design-tool knobs, not product features.

### Current landing (`src/pages/index.astro`, `src/components/Welcome.astro`)

- `index.astro:1-8` wraps `<Welcome />` in `Layout`.
- `Welcome.astro:9-14`: `t = getMessages(Astro.locals.locale)`, `signedIn`, `steps` built from 3 `t.landing.steps.*` entries, CTA classes from `buttonVariants` via `cn()`.
- `Welcome.astro:16-55`: `bg-cosmic` shell, `max-w-4xl`, `<Topbar />`, centred hero, signed-in/anonymous CTA branch, 3-card `ol`. All classes are tokens (the file passes `lint:ui`).
- `Welcome` has one consumer: `src/pages/index.astro` (grep over `src`, `tests` and `scripts`).

### Shared chrome on `/`

- `Topbar.astro` renders the signed-in nav (dashboard / projects / employees / reports / my-bonuses by role, plus a sign-out form) or the anonymous sign-in/sign-up links. It uses palette classes (`border-white/10`, `text-purple-300`, …) and is **not** in `CLEAN_PATHS`. The design's header replaces it visually for anonymous visitors only.
- `Layout.astro:20` hard-codes `class="dark"`. `:43` renders `LanguageSwitch` after the slot on every page. `LanguageSwitch.astro` is a no-JS form POST to `/api/locale` with `next`, `aria-pressed` and per-option `aria-label` (`:1-50`). It is in `CLEAN_PATHS` (`check-ui-literals.mjs:14`).

### Tokens

- `src/styles/global.css` `.dark`: `--primary` oklch(0.827 0.119 306.383) is the lilac used as the design's default accent `#d2b1f7`. `--success` is the design's green `#34d39a`. `--card` 10% white and `--muted` 5% white cover the design's translucent surfaces; `--border` is 10% white; `--muted-foreground` covers the `#c3c9d8`/`#aeb5c6` greys.
- No tokens exist for the illustration palette (yellow `#f7c948`, teal `#7dd3c0`, peach `#f5c38a`, periwinkle `#a5b4fc`, skin tones, outline `#1a1426`). Options: add illustration tokens to `global.css` and reference them as `fill="var(--…)"` (the guard regex matches `#hex`, `rgba(`, `oklch(`, palette classes and arbitrary px/rem; `var(--x)` does not match, `check-ui-literals.mjs:30-31`); move the SVGs into their own files outside `CLEAN_PATHS` (e.g. `src/components/landing/illustrations/*.astro` or `public/*.svg`); or use the existing `--chart-*` tokens. Which one is the plan's decision.
- No font tokens exist. Tailwind 4 `@theme` would need `--font-sans` / `--font-heading` / `--font-mono` to adopt the design fonts.

### i18n

- Every visible string goes through `getMessages(locale)`. `Messages` is the type of `pl` and `en.ts:4` is typed `Messages`, so a new PL key without an EN key fails type-checking. Numbers stay pl-PL in both locales (CLAUDE.md), and `src/lib/format.ts:1,4` provides `formatPln`. The design's example figures could be computed with `formatPln` or kept as dictionary text.
- Reusable keys already exist: `t.common.signIn`, `t.common.signUp`, `t.common.appName`, `t.landing.goToDashboard`, `t.landing.howItWorks` and the 3 step titles.

### Tests and guards that touch `/`

- `scripts/smoke.mjs:124-133`: `/` anon → `<html lang="pl"` plus PL pitch; `/` with `lang=en` → EN pitch.
- `tests/e2e/language-switch.spec.ts:28-38`: `getByText(PL_PITCH|EN_PITCH)` must be **visible**, and the switch buttons must have the names "Przełącz na język polski" / "Switch to English" with `aria-pressed`. `:57`: `getByRole("link", { name: "Sign in", exact: true }).first()`, so several "Sign in" links are tolerated. `:68,73`: the "Sign out" / "Wyloguj się" button is visible on `/` when signed in.
- `scripts/check-ui-literals.mjs:23`: `Welcome.astro` must stay literal-free. Any new landing view file should be added to `CLEAN_PATHS`.
- No unit test imports `Welcome` (grep over `src/**/*.test.ts`).

## Code References

- `reports/design/project/Main.dc.html:21-39` header; `:42-136` hero + example; `:139-149` formula; `:155-248` steps; `:248-328` roles; `:331-356` guarantees; `:359-436` final CTA + footer; `:439-447` design props
- `src/pages/index.astro:1-8` page entry
- `src/components/Welcome.astro:9-55` current landing
- `src/layouts/Layout.astro:20,43` dark class, global LanguageSwitch
- `src/components/LanguageSwitch.astro:22` fixed bottom-right form
- `src/components/Topbar.astro` signed-in nav / sign-out (palette classes, not clean)
- `src/styles/global.css` `.dark` tokens, `@utility bg-cosmic`
- `src/lib/i18n/messages/pl.ts:68-86`, `en.ts:65-83` `landing` dictionary
- `src/lib/format.ts:1-4` `formatPln`
- `scripts/check-ui-literals.mjs:9-31` CLEAN_PATHS and literal regex
- `scripts/smoke.mjs:34-35,124-133` landing assertions
- `tests/e2e/language-switch.spec.ts:11-12,28-38,57,68,73` landing assertions
- `supabase/migrations/20261004120000_milestone_kpi_and_payouts.sql:5-27` split formula, grosz floor
- `supabase/migrations/20261004130000_milestone_payout_hard_cap.sql:1-21` capped payout pool
- `supabase/migrations/20260926120000_bonus_rules_config.sql:177-188` default multipliers, factors, role weights

## Architecture Insights

- The landing is a static `.astro` view with no state, so CLAUDE.md's component rule keeps it Astro, with no React island. The design's only interactive bit (the language pill) is already covered by the no-JS `LanguageSwitch`.
- The design-system contract (tokens + `lint:ui`) is enforced on this exact file. The prior `ui-projects-panel` change (`context/archive/2026-10-01-ui-projects-panel/tokens.md`) is where token values were mapped from literals; new tokens (illustrations, fonts) should follow the same `:root` / `.dark` + `@theme inline` pattern.
- The design's copy restates the invariants from CLAUDE.md (pool cap, draft until approved, frozen approvals, time-share >100% flag, RLS). Any reword must stay accurate to them, as the grosz-rounding discrepancy shows.

## Historical Context (from prior changes)

- `context/archive/2026-10-01-ui-projects-panel/` created the tokens, `bg-cosmic` and the `lint:ui` guard. `Welcome.astro` was later migrated onto tokens and added to `CLEAN_PATHS`.
- The `language-switch-pl-en` change (referenced by `tests/e2e/language-switch.spec.ts:1`) introduced `LanguageSwitch` and the pitch-text assertions in smoke/E2E.

## Related Research

- `context/archive/2026-10-01-ui-projects-panel/research.md` (token mapping); not re-read in full here.

## Open Questions (product/design choices for /10x-plan)

1. **Language switch**: keep the global bottom-right `LanguageSwitch` and drop the design's header pill, or move the switch into the landing header (then hide the Layout one on `/` so the accessible names stay unique)?
2. **Signed-in state**: on `/`, keep Topbar plus "Przejdź do panelu" for signed-in users, or give the new header a signed-in variant (dashboard link + sign-out)? E2E needs a visible sign-out button.
3. **Pitch text**: keep "Sprawiedliwy podział…" visible (footer, as in the design, satisfies `getByText(...).toBeVisible()` if it is in view; Playwright's `toBeVisible` does not require it to be in the viewport) or change the smoke/E2E assertions to the new H1. CLAUDE.md: don't edit assertions unless the requirement changed; a redesign is such a change, but it must be decided explicitly.
4. **Worked example rounding**: change the figures to grosz precision (13 935,48 / 6 193,54 / 3 870,96; residual 0,02 zł) or keep whole złoty and fix the residual sentence? Also: use default config values (max 1,30, role weight ≤ 1,25) or keep the illustrative 1,5?
5. **Fonts**: adopt Space Grotesk / IBM Plex (Google Fonts, app-wide via `@theme`) or keep the system font stack?
6. **Illustrations**: tokenised inline SVG, separate SVG files outside `CLEAN_PATHS`, or drop or simplify them?
7. **Accent / showExample props**: treat them as design-tool knobs (fixed to `--primary`, example always shown)? This is assumed but not confirmed.
