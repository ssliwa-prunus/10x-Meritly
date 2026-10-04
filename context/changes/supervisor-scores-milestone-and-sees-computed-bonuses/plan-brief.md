# Supervisor scores milestone and sees computed bonuses — Plan Brief

> Full plan: `context/changes/supervisor-scores-milestone-and-sees-computed-bonuses/plan.md`

## What & Why

Roadmap S-04, the north star. A Supervisor enters a milestone's four KPI scores and sees each employee's computed bonus, plus a milestone summary that confirms the payout never exceeds the KPI-scaled payout pool. It proves the core hypothesis: the software, not a person, applies the formula correctly. The multiplier sizes the pool, the weights split it, and rounding never overpays.

## Starting Point

Config (KPI weights, multiplier bounds, rating factors, role weights), projects and milestones with target pools, and employee engagements (time share, rating) already exist with RLS. `money_floor_mul` is the agreed rounding rule, and pgTAP runs in CI. Two things are missing: KPI score storage, and any computation or results view. The milestone page still uses old literal-class styling.

## Desired End State

On the milestone page a Supervisor saves four whole-number scores (0–100). The page shows the multiplier, payout pool, payout total, residual and a "within pool" check, and below them the per-employee table: time share, role weight, rating factor, weighted contribution, share and bonus. Before scoring, the table shows shares without PLN amounts. Admins see everything read-only. The whole page is on design tokens.

## Key Decisions Made

| Decision                | Choice                                                                                          | Why (1 sentence)                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| KPI → multiplier        | `M = min + (Σ w_k·score_k/100)·(max − min)`, linear between the Admin bounds; no `MIN(M,1)` cap | The only defined mapping (spreadsheet `Milestones!M`); the PRD lets M > 1 pay more than the target pool.               |
| Ryzyko direction        | Higher is better, like the other three                                                          | One mental model for all four fields; it matches the instruction doc's scale and example, not the spreadsheet formula. |
| Results storage         | Computed live on read by SQL functions; nothing persisted                                       | Draft results can't go stale, and S-05 snapshots on approval.                                                          |
| Where the math lives    | SQL, exact integer-grosz `div` split, reusing `money_floor_mul`                                 | Avoids numeric-division rounding up to a grosz; proven by pgTAP.                                                       |
| Unscored milestone      | Table shows weighted contribution and share; PLN fields read "Enter KPI scores"                 | The split can be checked before scoring, with no fake PLN figures.                                                     |
| When scoring is allowed | Any status except cancelled, while the project is open                                          | Scoring a completed milestone is the natural close-out step.                                                           |
| Score input             | Whole numbers 0–100; all four set together, no clearing                                         | Matches the spreadsheet; the all-or-none check keeps M well-defined.                                                   |
| UI styling              | Migrate the whole milestone page onto tokens and shadcn                                         | Avoids a mixed-style page and closes the deferred charge.                                                              |
| Project page            | No computed columns; milestone page only                                                        | Keeps the slice tight; budget exposure changes in S-05.                                                                |

## Scope

**In scope:**

- KPI score columns, the all-or-none check and the cancelled guard (MR012).
- `kpi_multiplier`, `milestone_payout_lines` and `milestone_payout_summary`, with a pgTAP suite.
- Seed scores.
- Payouts service and KPI POST route.
- Milestone page and `EngagementForm` onto tokens.
- KPI and payout sections, with kitchen-sink states.

**Out of scope:**

- Approved status, freezing or snapshots, employee visibility, email (S-05).
- Budget exposure change (S-05).
- Persisted results.
- Project-page figures.
- Clearing or partial scores, fractional scores.
- Drill-down and export (S-06/S-07).

## Architecture / Approach

Scores live on `milestones`. `kpi_multiplier()` holds the KPI→M mapping. `milestone_payout_summary()` and `milestone_payout_lines()` (security invoker, so RLS scopes them: owner and Admin see rows, everyone else gets none) compute everything in exact numeric, splitting the pool in integer grosze with truncating `div`. The Astro page calls both via RPC through `src/lib/services/payouts.ts`; the KPI form posts to `/api/projects/[id]/milestones/[milestoneId]/kpi` and redirects with a flash. TypeScript only formats.

**Worked example (pgTAP and manual):**

- Scores 80/90/85/60 with the default config give M = 1.1875.
- Target 10 000,00 gives a pool of 11 875,00.
- Bonuses are 5 126,56 / 4 511,38 / 2 237,04, residual 0,02.

## Phases at a Glance

| Phase                            | What it delivers                                               | Key risk                                                  |
| -------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------- |
| 1. Schema, computation and pgTAP | Columns, guard, 3 functions, test suite, seed, types, registry | Exact rounding and trigger ordering (42501 before MR012)  |
| 2. Service and API               | zod schema, error catalog, RPC loaders, KPI route              | Error codes leaking free text; Admin path                 |
| 3. Milestone page onto tokens    | Existing page and EngagementForm restyled and guarded          | Behaviour regressions in assignments                      |
| 4. KPI and bonus sections        | Two new cards, page wiring, kitchen-sink states                | Error routing between KPI and assignments; unscored state |

**Prerequisites:** S-01 and S-03 done (yes). Local Supabase running.
**Estimated effort:** ~3 sessions across 4 phases.

## Open Risks & Assumptions

- Ryzyko "higher is better" departs from the spreadsheet formula, so the same raw Ryzyko number gives a different M than Excel. The form hints that 100 is best for every field.
- Draft figures change when an Admin edits weights or bounds. This is intended; S-05 must snapshot on approval.
- The pool guardrail holds by construction. The within-pool badge is confirmatory, as the PRD says.

## Success Criteria (Summary)

- The Supervisor sees correct figures matching the worked example, and the total never exceeds the payout pool.
- Different KPI scores with identical engagements produce different payout totals.
- Employees and other Supervisors can't see any of it (pgTAP RLS matrix), and the page passes `lint:ui`.
