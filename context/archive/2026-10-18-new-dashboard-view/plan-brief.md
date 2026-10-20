# Restyle /dashboard to the supervisor and employee mockups — Plan Brief

> Full plan: `context/changes/new-dashboard-view/plan.md`
> Research: `context/changes/new-dashboard-view/research.md`

## What & Why

`/dashboard` is where users land after sign-in and set-password. Today it is a placeholder that shows nothing about their work and looks like a different app from every other page. This change rebuilds it to the two mockups: a supervisor/admin overview (what awaits approval, budgets, over-allocation) and an employee overview (own bonuses), built only from design tokens and shared components.

## Starting Point

- `src/pages/dashboard.astro` is a centred card with an email, a role pill, copied-class buttons and 10 literal-scan hits. It does not use the shared `Topbar.astro`.
- `Topbar.astro` has 11 hits and is rendered on 8 pages.
- No `warning`/`info` tokens exist, and the landing fonts load only on `/`.
- Budgets, over-allocation and the employee's lines are already queryable. The cross-project milestone data is not.

## Desired End State

- **Supervisor:** the mockup app bar, a greeting with a dynamic sentence, 4 stat tiles, a milestones table with Approve/Open/Results, "Wymaga uwagi" and budget bars.
- **Admin:** the same company-wide, without Approve.
- **Employee:** 3 tiles, the latest bonus breakdown (KPI multiplier instead of the hidden payout pool), a short history and the "new bonuses appear…" note.
- **Every page:** the new token-clean Topbar with an inline PL/EN switch.
- **States:** every section has an empty and an error state, shown in `/dev/dashboard-kitchen-sink`.

## Key Decisions Made

| Decision           | Choice                                                                                       | Why (1 sentence)                                                          | Source          |
| ------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------- |
| Data scope         | Full mockup, TS queries only, no new SQL                                                     | Covers the dashboard's purpose without touching RLS or the catalog guard. | Plan            |
| KPI / pool per row | Snapshot for approved rows; one summary RPC per scored, open milestone                       | Unscored rows cost nothing, and the live RPCs refuse approved milestones. | Research + Plan |
| "Do zatwierdzenia" | Approvable now: not approved or cancelled, open project, scored, ≥1 engagement               | The dashboard never disagrees with the milestone page's Approve button.   | Plan            |
| Employee breakdown | KPI multiplier replaces "Pula do wypłaty"                                                    | The pool is deliberately unreadable by employees (privacy split).         | Research + Plan |
| Topbar             | Migrate in this change, for all 8 pages                                                      | Fixes the shell mismatch and the shared literals once.                    | Plan            |
| Fonts              | `@fontsource` imports move to Layout (app-wide)                                              | One typographic system for the Topbar and dashboard; still self-hosted.   | Plan            |
| Status colours     | New `warning` (peach) and `info` (periwinkle) tokens + Badge variants                        | Artwork tokens are not status roles.                                      | Research + Plan |
| Admin              | Supervisor layout, company-wide, "Otwórz" only                                               | What RLS returns, and admins cannot approve.                              | Plan            |
| Term definitions   | Exact status; reserved over open projects; paid = `payout_total` in the Warsaw calendar year | Each number matches a label used elsewhere in the app.                    | Plan            |
| Table              | Open + this year's approved rows, awaiting first, cap 8, link to `/projects`                 | Keeps the panel scannable for admins with many milestones.                | Plan            |

## Scope

**In scope:**

- `warning`/`info` tokens, a `tokens.md` record, app-wide fonts, Badge variants
- `StatTile`, `ProgressBar` and `MilestoneStatusBadge`
- the Topbar rebuild plus `languageSwitch={false}` and `current` on 8 pages
- `src/lib/dashboard.ts` helpers and `src/lib/services/dashboard.ts`, test-first
- dashboard section components and the page, PL/EN strings, an approval anchor
- a kitchen sink, smoke IDOR cases for `/dashboard`, and a `CLAUDE.md` UI rule

**Out of scope:**

- any migration, view, RPC or policy
- the payout pool or colleague figures for employees
- restyling other page bodies
- a reduced admin variant
- client-side fetching
- Google Fonts
- the guard-regex gap F5

## Architecture / Approach

The server-rendered `dashboard.astro` picks a variant by role. It fetches in parallel through the existing services plus three new thin ones: visible milestones with a project embed, a summary-only payout RPC, and results approved in a window. Pure helpers in `src/lib/dashboard.ts` turn those into figures, rows and attention items. Prop-driven section components in `src/components/dashboard/` render them, with per-section empty and error states. The kitchen sink feeds the same components from fixtures.

## Phases at a Glance

| Phase                         | What it delivers                                                                           | Key risk                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| 1. Tokens, fonts & primitives | `warning`/`info` tokens, fonts in Layout, Badge variants, StatTile/ProgressBar/StatusBadge | Body font shift on all pages; peach/periwinkle contrast      |
| 2. Topbar migration           | The mockup app bar on tokens across 8 pages, inline PL/EN                                  | e2e names ("Raporty", "Wyloguj się"); double language switch |
| 3. Data layer (TDD)           | Tested helpers + 3 new services                                                            | Warsaw year boundary; `projects(...)` embed under RLS        |
| 4. Dashboard view             | Supervisor/admin/employee/no-role sections, i18n                                           | Numbers disagreeing with the project pages                   |
| 5. States, gate & guard       | Kitchen sink with the 7 states, smoke IDOR, screenshots, `CLAUDE.md` rule                  | Error/empty states missed in the happy path                  |

**Prerequisites:** local Supabase (`npx supabase start`, `db reset` for the seed), and `.dev.vars` with the `E2E_*` vars for phase 2.

**Estimated effort:** ~4–5 sessions across 5 phases. Phases 2 and 4 are the largest.

## Open Risks & Assumptions

- The PostgREST `projects(name, status)` embed on `milestones` is assumed to work under the current grants. Phase 3's manual check proves it before the view depends on it.
- Per-row summary RPCs are assumed cheap for typical counts. If an admin has dozens of scored, open milestones, a `security_invoker` view is the recorded follow-up.
- A supervisor's over-allocation covers only their own milestones (RLS-scoped). The copy must not imply a company-wide total.
- Moving the fonts to Layout changes the body typography of the other 8 pages. Phase 1's manual check covers `/projects`.

## Success Criteria (Summary)

- A supervisor sees what waits for approval and which budgets are at risk without opening a project. Each figure matches the project and milestone pages.
- An employee sees only their own approved bonuses, and smoke proves another employee's amount never appears.
- `dashboard.astro`, `Topbar.astro` and the new components are guarded by `lint:ui` with 0 literal hits, and the kitchen sink shows all 7 states.
