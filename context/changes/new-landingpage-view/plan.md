# New Landing Page View Implementation Plan

## Overview

Rebuild the public landing page (`/`) from the supplied design (`reports/design/project/Main.dc.html`, "Meritly Landing Redesign") as a static, token-only Astro view with PL and EN copy. The page has its own header, which carries the existing language switch and a signed-in variant. The old pitch sentence moves to the footer so the smoke and E2E assertions keep passing unchanged.

## Current State Analysis

- `/` is `src/pages/index.astro`, which wraps `src/components/Welcome.astro` (Topbar, app-name H1, pitch, CTAs with a signed-in branch, 3 step cards) in `Layout`. All copy comes from `t.landing.*` (`src/lib/i18n/messages/pl.ts:68-86`, `en.ts:65-83`).
- The design is a static PL-only mock with inline hex/rgba styles and 7 inline SVG illustrations plus a logo (~150 hex `fill`/`stroke` values), using Space Grotesk, IBM Plex Sans and IBM Plex Mono from Google Fonts.
- `Welcome.astro` is in `CLEAN_PATHS` (`scripts/check-ui-literals.mjs:23`). The guard regex (`:30-31`) rejects `#hex`, `rgba(`, `oklch(`, palette classes and arbitrary px/rem values. It does not reject `var(--token)` or opacity modifiers such as `bg-primary/15`.
- `Layout.astro:43` renders `LanguageSwitch` on every page. `LanguageSwitch.astro:22` hard-codes `fixed right-4 bottom-4`. Layout has no head slot (`:21-27`).
- The app has no custom fonts. `font-mono` is already used by `src/components/ui/LibBadge.astro`, so the landing fonts must not redefine `--font-mono`.
- Smoke (`scripts/smoke.mjs:124-133`) and E2E (`tests/e2e/language-switch.spec.ts:11-12,28-38,57,68,73`) pin: the exact pitch text visible on `/`, the switch buttons' accessible names plus `aria-pressed`, the first "Sign in" link, and a visible "Sign out" / "Wyloguj się" button on `/` when signed in. Playwright strict mode fails if two elements share those names.

## Desired End State

- Anonymous visitors on `/` see the redesigned page: a header (logo, wordmark, in-page nav, the PL/EN switch inline, Zaloguj się / Załóż konto), a hero with the worked-example card, the formula band, "Jak to działa" (3 illustrated steps), roles (3 avatars), guarantees (4 items), a final CTA with an illustration, and a footer that carries the pitch. Everything is in PL and EN.
- Signed-in visitors see the same page. The header shows a dashboard link and a sign-out button instead of the auth links, and the hero and final CTAs read "Przejdź do panelu".
- Every other page is unchanged: its language switch stays fixed bottom-right and it uses no web fonts.
- `npm run lint:ui` covers `Welcome.astro` and every new landing component. Smoke and E2E pass without editing existing assertions.

### Key Discoveries:

- The existing `bg-cosmic` utility (`src/styles/global.css`) is the token equivalent of the design's `#0d1222 → #141a30` gradient.
- `.dark --primary` is the design's default accent `#d2b1f7`. `--success` is its green `#34d39a`. `--card`, `--muted`, `--border` and `--muted-foreground` cover its translucent surfaces and greys.
- Existing token values were mapped from literals in `context/archive/2026-10-01-ui-projects-panel/tokens.md`. New tokens follow the same `:root` / `.dark` + `@theme inline` pattern.
- `src/components/LanguageSwitch.astro` is a no-JS form POST with `next`. Reusing it in the header keeps the behaviour and accessible names that E2E relies on.
- The worked example's 58 % / 26 % / 16 % share bars round to the Tailwind fractions `w-7/12`, `w-1/4` and `w-1/6`, so the bars need no arbitrary values.

## What We're NOT Doing

- No change to the worked example's numbers or rounding text. It stays exactly as designed (whole-złoty bonuses, "2 zł z zaokrągleń w dół zostaje w puli", max multiplier 1,5) as static marketing copy marked "Przykład ilustracyjny". This is the user's decision: it is marketing, not a real computation. No helper and no unit test compute it.
- No app-wide font change. The web fonts load on `/` only.
- No restyle of `Topbar.astro` or of any other page. Topbar simply stops rendering on `/`.
- No `accent` / `showExample` switches. These are design-tool knobs, so the accent is `--primary` and the example is always shown.
- No edits to existing smoke or E2E assertions, and no new E2E spec.
- No light-mode artwork. The app runs dark (`Layout.astro:20`), and illustration tokens get the same values in `:root` and `.dark`.

## Implementation Approach

Lay the design-system groundwork first (tokens, fonts, Layout/LanguageSwitch props) without changing any page. Then port the artwork into token-only components that the guard checks. Finally rebuild the view on top of both. Each phase leaves the app green and the change is visible only in Phase 3.

## Critical Implementation Details

- **Two copies of named controls**: `/` must render exactly one language-switch form and, when signed in, exactly one sign-out button. Layout's copy is turned off on `/` (`languageSwitch={false}`), and Topbar is removed from `Welcome.astro`. A second copy fails Playwright strict mode in `language-switch.spec.ts`.
- **Pitch visibility**: `getByText(PL_PITCH).toBeVisible()` needs the footer pitch rendered, not visually hidden. Playwright's visible check does not require the text to be inside the viewport.

## Phase 1: Design-system groundwork

### Overview

Add the tokens, the font utilities and two small layout hooks the landing needs. No page changes appearance in this phase.

### Changes Required:

#### 1. Illustration and font tokens

**File**: `src/styles/global.css`

**Intent**: Publish the illustration palette and the three landing font families as tokens, so the artwork and the view stay literal-free.

**Contract**:

- New `--illustration-*` custom properties, in oklch with identical values in `:root` and `.dark`, published as colours through `@theme inline` (`--color-illustration-*`). They cover the design's artwork colours:
  - outline `#1a1426`, highlight `#f7f8fb`, line grey `#c3c9d8`, navy `#3b4570`
  - gold `#f7c948`, gold-deep `#c9952b`, gold-ink `#8a5a12`
  - teal `#7dd3c0`, peach `#f5c38a`, periwinkle `#a5b4fc`, blush `#f19a9a`
  - skin ×3 (`#f2c7a5`, `#c98e64`, `#8d5a3b`) and hair ×3 (`#3b2a20`, `#22181a`, `#2a1d17`)
- The lilac and green reuse `--primary` and `--success`. The black shadow uses `var(--illustration-outline)` or `black` with the design's `fill-opacity`; `fill-opacity` is a plain number and passes the guard.
- Font tokens `--font-heading` (Space Grotesk), `--font-body` (IBM Plex Sans) and `--font-figures` (IBM Plex Mono), each with a system fallback stack, which produce `font-heading`, `font-body` and `font-figures` utilities. `--font-sans` and `--font-mono` stay untouched.

#### 2. Token mapping record

**File**: `context/changes/new-landingpage-view/tokens.md` (new)

**Intent**: Record hex → token for every design colour, so later artwork changes go through tokens. This mirrors `context/archive/2026-10-01-ui-projects-panel/tokens.md`.

**Contract**: A table with columns design hex, token name, and oklch value.

#### 3. Layout hooks

**File**: `src/layouts/Layout.astro`

**Intent**: Let a page add `<head>` content and opt out of the global fixed language switch.

**Contract**:

- `Props` gains `languageSwitch?: boolean` (default `true`). When it is `false`, the trailing `<LanguageSwitch />` is not rendered.
- A named `<slot name="head" />` inside `<head>`, after `<title>`.
- Every existing page renders exactly as before.

#### 4. Inline placement for the switch

**File**: `src/components/LanguageSwitch.astro`

**Intent**: Allow the same no-JS switch to sit inside the landing header.

**Contract**:

- `Props` gains `placement?: "fixed" | "inline"` (default `"fixed"`). The `fixed right-4 bottom-4 z-50` classes apply only to `"fixed"`, merged with `cn()`.
- Form, `next`, button names, `lang`, `aria-label` and `aria-pressed` are unchanged.
- The header comment is updated to mention the inline use on `/`.

### Success Criteria:

#### Automated Verification:

- Astro types regenerate and type-check passes: `npx astro sync && npx astro check`
- Lint passes: `npm run lint`
- UI literal guard passes: `npm run lint:ui`
- Unit tests pass: `npm test`

#### Manual Verification:

- `/`, `/auth/signin` and `/dashboard` look exactly as before, with the language switch still fixed bottom-right

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Illustrations

### Overview

Port the logo and the 7 design illustrations into token-only Astro components that the guard checks.

### Changes Required:

#### 1. Illustration components

**File**: `src/components/landing/illustrations/` (new):

- `MeritlyLogo.astro`
- `StepPoolIllustration.astro`, `StepShareIllustration.astro`, `StepApprovalIllustration.astro`
- `AdminAvatar.astro`, `SupervisorAvatar.astro`, `EmployeeAvatar.astro`
- `CelebrationIllustration.astro`

**Intent**: Reproduce each SVG from the design (logo `Main.dc.html:23`, steps `:163-190`, `:198-217`, `:225-241`, avatars `:255-274`, `:279-298`, `:304-322`, final CTA `:360-423`) with the same geometry, with every colour switched to a token.

**Contract**:

- Each component renders one decorative `<svg aria-hidden="true">` with the design's `viewBox`.
- `fill` and `stroke` use `var(--illustration-*)`, `var(--primary)`, `var(--success)` or `currentColor`. The logo uses `currentColor` and the caller sets `text-primary`.
- Inline `style="max-width:100%;height:auto"` becomes classes (`max-w-full h-auto`).
- Width and height come from the SVG attributes or token-safe classes, never arbitrary values.
- The `zł` `<text>` in the CTA illustration stays as is (currency symbol, not translatable copy).

#### 2. Guard coverage

**File**: `scripts/check-ui-literals.mjs`

**Intent**: Keep the artwork on the token contract from now on.

**Contract**: All 8 new component paths are added to `CLEAN_PATHS`.

### Success Criteria:

#### Automated Verification:

- UI literal guard passes and covers the 8 new files: `npm run lint:ui`
- Type-check passes: `npx astro check`
- Lint passes: `npm run lint`

#### Manual Verification:

- No hex value is left in `src/components/landing/illustrations/` (spot-check the guard by temporarily adding a hex to one file and seeing it fail)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Landing view

### Overview

Rebuild `Welcome.astro` from the design. Add the PL and EN copy, wire fonts and the inline switch on `/` only, add smoke checks for the CTAs, and verify end to end.

### Changes Required:

#### 1. Landing dictionary (PL + EN)

**Files**: `src/lib/i18n/messages/pl.ts`, `src/lib/i18n/messages/en.ts`

**Intent**: Every visible string on the new page goes into `landing`. PL is the design's text verbatim; EN is a faithful translation.

**Contract**:

- `landing.pitch` keeps its exact current text in both locales (smoke/E2E pin it). `goToDashboard` and `howItWorks` keep their keys.
- New keys:
  - `nav` (how it works / for whom / guarantees, plus the nav `aria-label`)
  - `badge`, `title`, `lead`, `bullets` (2)
  - `example`: title, "illustrative" label, 3 tile labels and values, formula line, 5 column headers, 3 rows (role, time, weight, rating, bonus), sum label and value, residual sentence, figure `aria-label`
  - `formula`: the 4 terms and `aria-label`
  - `howItWorksLead`
  - `steps.*.body`, updated to the design wording (`Main.dc.html:194,221,245`)
  - `roles`: title, lead, and admin / supervisor / employee each with title and body
  - `guarantees`: title, lead, and 4 items with title and body
  - `finalCta.title`
- The example's figures stay as dictionary strings in pl-PL number format in both locales.

#### 2. Landing view

**File**: `src/components/Welcome.astro`

**Intent**: Implement the design's sections in order with token classes and the new illustration components, replacing the current layout and Topbar.

**Contract**:

- `bg-cosmic` shell, `max-w-6xl`-class container, `font-body` base, `font-heading` headings, `font-figures` figures.
- Sections:
  - **header**: `MeritlyLogo` + wordmark linking to `#top`; `<nav>` anchors `#how-it-works`, `#roles`, `#guarantees`; `<LanguageSwitch placement="inline" />`; anonymous → sign-in link plus primary sign-up link; signed in → dashboard link plus a sign-out `<form method="POST" action="/api/auth/signout">` button labelled `t.common.signOut`
  - **hero**: badge with a `bg-success` dot, H1 `title`, `lead`, CTAs (anonymous: sign-up primary, sign-in outline; signed in: `goToDashboard`), 2 check bullets
  - **worked-example** `<figure>`: tiles, with the payout tile highlighted via `bg-primary/15 border-primary/40`; formula line; table inside `overflow-x-auto`; bars `w-7/12`, `w-1/4`, `w-1/6`; figcaption
  - **formula band**; **how it works** `<ol>` with step illustrations; **roles** with avatars; **guarantees**; **final CTA** with `CelebrationIllustration` and the same CTA branch
  - **footer**: wordmark + `t.landing.pitch`
- CTAs use `buttonVariants` via `cn()`; links go to `/auth/signin`, `/auth/signup` and `/dashboard`.
- No literal colours or arbitrary values. The file stays in `CLEAN_PATHS`.
- The header comment is updated to describe the new page.

#### 3. Page wiring

**File**: `src/pages/index.astro`

**Intent**: Load the landing fonts and turn off the global switch, on `/` only.

**Contract**:

- `<Layout languageSwitch={false}>`.
- A `slot="head"` fragment with preconnects to `https://fonts.googleapis.com` and `https://fonts.gstatic.com` (`crossorigin`) and the stylesheet link for Space Grotesk 500/600/700, IBM Plex Sans 400/500/600 and IBM Plex Mono 400/500 with `display=swap`.

#### 4. Smoke coverage for the new CTAs

**File**: `scripts/smoke.mjs`

**Intent**: Pin the anonymous and signed-in CTA targets on `/` without touching existing assertions.

**Contract**:

- New step: anonymous `/` → `htmlIncludes` `href="/auth/signup"` and `href="/auth/signin"`.
- New step, placed after the admin sign-in step (`:205`): `/` as `admin` → `htmlIncludes` `href="/dashboard"` and `action="/api/auth/signout"`, and `bodyExcludes` the sign-up CTA label `Załóż konto`.

### Success Criteria:

#### Automated Verification:

- Type-check passes (EN dictionary matches the `Messages` type): `npx astro sync && npx astro check`
- Lint passes: `npm run lint`
- UI literal guard passes: `npm run lint:ui`
- Unit tests pass: `npm test`
- Production build succeeds: `npm run build`
- Smoke passes against the running preview, including the new CTA steps: `npm run smoke`
- E2E passes, including `language-switch.spec.ts` unchanged: `npm run test:e2e`

#### Manual Verification:

- At 1440 px, `/` matches the design section by section (layout, fonts, illustrations, worked example)
- At 375 px there is no horizontal page scroll, the header wraps cleanly and the example table scrolls inside its card
- With `lang=en`, every text on `/` is English and the figures stay pl-PL
- Signed in, the header shows the dashboard link and the sign-out button and the hero CTA reads "Przejdź do panelu"; sign-out works
- Keyboard tab order reaches nav, switch and CTAs with a visible focus ring
- Other pages still show the bottom-right switch and no web fonts

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- None new. The page is static markup with no pure logic, and the worked example is static copy by decision. The existing i18n tests and `astro check` catch PL/EN key drift.

### Integration Tests:

- Smoke: the existing pitch / `lang` steps, plus the 2 new CTA-target steps (anonymous and admin).
- E2E: `language-switch.spec.ts` unchanged. It proves the inline switch works (same names, `aria-pressed`, no-JS POST) and that exactly one switch and one sign-out button exist on `/`.

### Manual Testing Steps:

1. `npm run dev`, open `/` signed out at 1440 px and at 375 px, and compare with `reports/design/project/Main.dc.html`.
2. Click EN in the header and check that the whole page switches and the URL stays `/`.
3. Sign in as a seeded user and return to `/`. Check the header variant, then sign out from the header.
4. Open `/projects` and `/auth/signin` and check that the switch is bottom-right and the fonts are system fonts.

## Performance Considerations

- One extra Google Fonts stylesheet request on `/` only, with `display=swap` so text renders immediately. The SVGs are inline and small.

## Migration Notes

- Not applicable (no data or schema changes).

## References

- Research: `context/changes/new-landingpage-view/research.md`
- Design (gitignored): `reports/design/project/Main.dc.html`, `reports/design/project/canvas.json`
- Token mapping precedent: `context/archive/2026-10-01-ui-projects-panel/tokens.md`
- Current view: `src/components/Welcome.astro:9-55`; layout `src/layouts/Layout.astro:20,43`; switch `src/components/LanguageSwitch.astro:22`
- Guard: `scripts/check-ui-literals.mjs:9-31`
- Tests pinning `/`: `scripts/smoke.mjs:124-133,205`; `tests/e2e/language-switch.spec.ts:11-12,28-38,57,68,73`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Design-system groundwork

#### Automated

- [x] 1.1 Astro types regenerate and type-check passes: `npx astro sync && npx astro check` — 8b5ce50
- [x] 1.2 Lint passes: `npm run lint` — 8b5ce50
- [x] 1.3 UI literal guard passes: `npm run lint:ui` — 8b5ce50
- [x] 1.4 Unit tests pass: `npm test` — 8b5ce50

#### Manual

- [x] 1.5 `/`, `/auth/signin` and `/dashboard` look exactly as before, with the language switch still fixed bottom-right — 8b5ce50

### Phase 2: Illustrations

#### Automated

- [x] 2.1 UI literal guard passes and covers the 8 new files: `npm run lint:ui` — f9bdcf8
- [x] 2.2 Type-check passes: `npx astro check` — f9bdcf8
- [x] 2.3 Lint passes: `npm run lint` — f9bdcf8

#### Manual

- [x] 2.4 No hex value is left in `src/components/landing/illustrations/` (spot-check the guard by temporarily adding a hex to one file and seeing it fail) — f9bdcf8

### Phase 3: Landing view

#### Automated

- [x] 3.1 Type-check passes (EN dictionary matches the `Messages` type): `npx astro sync && npx astro check`
- [x] 3.2 Lint passes: `npm run lint`
- [x] 3.3 UI literal guard passes: `npm run lint:ui`
- [x] 3.4 Unit tests pass: `npm test`
- [x] 3.5 Production build succeeds: `npm run build`
- [x] 3.6 Smoke passes against the running preview, including the new CTA steps: `npm run smoke`
- [x] 3.7 E2E passes, including `language-switch.spec.ts` unchanged: `npm run test:e2e`

#### Manual

- [x] 3.8 At 1440 px, `/` matches the design section by section (layout, fonts, illustrations, worked example)
- [x] 3.9 At 375 px there is no horizontal page scroll, the header wraps cleanly and the example table scrolls inside its card
- [x] 3.10 With `lang=en`, every text on `/` is English and the figures stay pl-PL
- [x] 3.11 Signed in, the header shows the dashboard link and the sign-out button and the hero CTA reads "Przejdź do panelu"; sign-out works
- [x] 3.12 Keyboard tab order reaches nav, switch and CTAs with a visible focus ring
- [x] 3.13 Other pages still show the bottom-right switch and no web fonts
