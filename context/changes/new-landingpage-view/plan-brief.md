# New Landing Page View — Plan Brief

> Full plan: `context/changes/new-landingpage-view/plan.md`
> Research: `context/changes/new-landingpage-view/research.md`

## What & Why

Replace the minimal `/` page with the supplied "Meritly Landing Redesign" (`reports/design/project/Main.dc.html`). The new page explains the bonus split with a worked example, the formula, three steps, the three roles and the guarantees. It is built as a static, token-only Astro view in PL and EN, without breaking the design-system guard or the tests that pin `/`.

## Starting Point

Today `/` is `Welcome.astro`: Topbar, an app-name H1, the pitch, CTAs and 3 step cards. The design is a PL-only mock with inline hex colours, 7 SVG illustrations plus a logo, Google Fonts and a non-functional language pill. The real switch is rendered fixed bottom-right by `Layout.astro` on every page.

## Desired End State

Visitors see the redesigned page in PL or EN. The language switch sits in the header and the pitch sits in the footer. Signed-in users get a header with a dashboard link and sign-out instead of the auth links. Every other page looks exactly as before. `lint:ui`, smoke and E2E all pass, with no existing assertion edited.

## Key Decisions Made

| Decision        | Choice                                                                                       | Why (1 sentence)                                                              | Source   |
| --------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------- |
| Language switch | Reuse `LanguageSwitch` inline in the header; Layout skips its fixed copy on `/` only         | Matches the design and keeps the no-JS POST and the accessible names E2E uses | Plan     |
| Signed-in state | Header variant: dashboard link + sign-out form; CTAs → "Przejdź do panelu"                   | One coherent token-only header; E2E needs a visible sign-out on `/`           | Plan     |
| Pitch text      | Keep `landing.pitch` unchanged, rendered in the footer                                       | Smoke and E2E pass without editing assertions                                 | Plan     |
| Worked example  | Exactly as designed (whole złoty, "2 zł" residual), static dictionary copy                   | User decision: marketing illustration, not a real computation                 | Plan     |
| Fonts           | Space Grotesk / IBM Plex via Google Fonts on `/` only, as `font-heading/body/figures` tokens | Design look without restyling the app; `font-mono` stays untouched            | Plan     |
| Illustrations   | 8 token-only SVG components, added to `CLEAN_PATHS`                                          | Faithful to the design and guard-checked                                      | Plan     |
| Design knobs    | `accent` fixed to `--primary`, example always shown                                          | `accent` and `showExample` are design-tool props, not product features        | Research |

## Scope

**In scope:**

- Illustration and font tokens, plus a `tokens.md` mapping record
- Layout `head` slot and `languageSwitch` prop; LanguageSwitch `placement` prop
- 8 illustration components
- Rebuilt `Welcome.astro`
- PL and EN `landing` dictionary
- 2 new smoke steps

**Out of scope:**

- Recomputing or correcting the example figures
- App-wide fonts
- A Topbar restyle
- Light-mode artwork
- New E2E specs
- Edits to existing test assertions

## Architecture / Approach

Static `.astro` only, with no React island. `index.astro` passes `languageSwitch={false}` and font links through `slot="head"`. `Welcome.astro` composes `LanguageSwitch placement="inline"`, `buttonVariants` CTAs and the illustration components. All colours come from `global.css` tokens: the existing `--primary`, `--success`, `--card`, `--muted` and `bg-cosmic`, plus new `--illustration-*`.

## Phases at a Glance

| Phase                       | What it delivers                                                        | Key risk                                                               |
| --------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1. Design-system groundwork | Tokens, font utilities, Layout/LanguageSwitch props; no visual change   | Accidentally changing other pages' switch or fonts                     |
| 2. Illustrations            | 8 token-only SVG components under the guard                             | Tedious hex → token port drifting from the design                      |
| 3. Landing view             | Rebuilt page, PL/EN copy, header variants, smoke CTA steps, full verify | Duplicate switch or sign-out breaking E2E strict mode; mobile overflow |

**Prerequisites:** local Supabase (`npx supabase start`) and `.dev.vars` with the `E2E_*` vars for smoke/E2E; the design file at `reports/design/project/` (gitignored).
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- The design file is gitignored. If it goes missing, Phase 2 and Phase 3 lose their reference, so copy it into the change folder if needed.
- The worked example deliberately differs from the app's grosz-precision rounding. This is accepted as marketing copy.
- An external Google Fonts request on `/`. A future CSP would need to allow `fonts.googleapis.com` and `fonts.gstatic.com`.

## Success Criteria (Summary)

- `/` matches the design at desktop and mobile widths, in PL and EN, signed out and signed in.
- `lint:ui`, `astro check`, smoke and E2E pass with the existing assertions untouched.
- Every other page is visually unchanged.
