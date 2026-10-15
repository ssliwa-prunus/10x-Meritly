<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Aggregate Bonus Report

- **Plan**: context/changes/aggregate-bonus-report/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-15
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | WARNING |

Automated criteria re-run at HEAD (d7c76ec): `supabase migration up --local` ✔, `supabase test db` 696 ✔, `npm test` 434 ✔, `lint` ✔, `lint:ui` 18 clean ✔, `astro check` 0 errors ✔, `build` ✔, `smoke` ✔; `test:e2e` 5/5 green on identical code earlier in the session (not re-run, to avoid more residue). Manual rows 1.3, 3.4–3.8, 4.4 were confirmed by the user in session.

## Findings

### F1 — RPC result silently truncated past 1000 employees

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/reports.ts:40 (with supabase/config.toml:18 `max_rows = 1000`)
- **Detail**: `bonus_report` returns one row per employee, so PostgREST's `max_rows` cap is reached only when more than 1000 employees have approved lines in the caller's scope (realistically an Admin). Past that, the page's grand total and the CSV are quietly incomplete — silent data loss in a payroll export, contrary to the plan's own reason for aggregating in SQL. Other list services share the cap but none is a full export.
- **Fix A ⭐ Recommended**: Call the RPC with `{ count: "exact" }` and return a logged `load_failed` (page Alert, CSV 500) when `count` exceeds the rows received; add a service unit test for that branch.
  - Strength: Turns silent truncation into a visible, logged failure with a few lines in one service; matches the "never hide the evidence" rule.
  - Tradeoff: `count: "exact"` costs a second count of the function result per request (cheap at this scale); a company that does exceed 1000 gets an error instead of a report.
  - Confidence: MED — supabase-js supports `count` on `rpc`; exact header behaviour for set-returning functions should be confirmed in a unit/integration run.
  - Blind spot: Not verified against a live >1000-row dataset.
- **Fix B**: Document the 1000-employee limit in the function header and the plan's Performance section; no code change.
  - Strength: Zero risk now; honest about the boundary.
  - Tradeoff: Truncation stays silent if the limit is ever crossed.
  - Confidence: HIGH — documentation only.
  - Blind spot: Relies on someone reading the comment before the company grows.
- **Decision**: FIXED (Fix A) — `rpc(..., { count: "exact" })` + logged `load_failed` on truncation; 2 unit tests; break-check red; smoke green against live PostgREST

### F2 — Implementation deviations not recorded in the plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/aggregate-bonus-report/plan.md:74, :126, :247; change.md Notes
- **Detail**: Four agreed deviations contradict plan text and are explained only in code comments: employees get no rows from `bonus_report` (plan: E2 sees own row); CSV filename labels bounds `-from-`/`-to-`; e2e empty state uses a range starting in the future (plan: ending yesterday); `.gitignore` `reports/` → `/reports/` (unplanned, required). Reviews and archive treat the plan as ground truth.
- **Fix**: Add an "Implementation notes" list of these four deviations (with reasons) to change.md `## Notes`, leaving the Phase blocks untouched.
- **Decision**: FIXED — "Implementation notes" added to change.md `## Notes` (four deviations + the F1 truncation guard)

### F3 — Admin pgTAP cell checks only the fixture employees

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/rls_matrix.test.sql (S-07 block, AD `results_eq`)
- **Detail**: The plan asked for "AD → exact rows over every approved line"; the cell filters `where employee_id in (E1, E2)`, because seeded rows also exist. That pins E1/E2 but would not catch the Admin path dropping or mis-summing other employees. Undisclosed weakening.
- **Fix**: Add one cell comparing AD's full `bonus_report()` to an independent aggregate over all approved lines computed as the test superuser (count/sum per employee via the three-table join), and bump `plan(…)`.
- **Decision**: FIXED — `set_eq` cell against a superuser-computed temp aggregate, `plan(287)`; break-check (function dropping one seeded employee) turned only this cell red

### F4 — e2e empty-state oracle can race at midnight; comment overstates it

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/s-07-aggregate-bonus-report.spec.ts:6-12, 97-102
- **Detail**: The range starts "tomorrow" (Warsaw). A run computing tomorrow at 23:59:59 with a concurrent us-01 approval stamped after midnight puts a line inside the range and fails the empty-state check. The header comment claims no run "can ever land in" the range.
- **Fix**: Use a far-future `from` (today + 1 year) and reword the comment accordingly.
- **Decision**: FIXED — `aYearFromTodayInWarsaw()` replaces `tomorrowInWarsaw()`, header comment corrected; s-07 green

### F5 — Report page sends no Cache-Control

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/reports/bonuses.astro
- **Detail**: The CSV sends `no-store`, the HTML page does not — same as the existing pay pages (`employees/[id].astro`, `my-bonuses.astro`); the middleware sets none either. Workers do not edge-cache SSR responses, so exposure is the browser/back-forward cache on shared machines. Fixing only this page would be inconsistent; the right place is the middleware, which is outside this change.
- **Fix**: Open a follow-up change to set `Cache-Control: private, no-store` for authenticated responses in `src/middleware.ts`.
- **Decision**: FIXED (queued) — follow-up written to `follow-ups/review-fixes.md`; no code change in this change

### F6 — Date filter and RLS checks scan the whole lines table

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261015120000_bonus_report.sql:42-49
- **Detail**: `(approved_at at time zone 'Europe/Warsaw')::date` cannot use an index (none exists on `approved_at`), and for a Supervisor RLS evaluates `owns_milestone` per row across the joined tables. Fine at MVP scale.
- **Fix**: None now; if the report slows, add a pre-filter on raw timestamptz bounds or an expression index.
- **Decision**: SKIPPED — acceptable at MVP scale
