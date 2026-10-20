<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Restyle /dashboard to the supervisor and employee mockups

- **Plan**: context/changes/new-dashboard-view/plan.md
- **Scope**: Full plan (phase 5 has one manual check still pending)
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-10-20
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

Evidence run during review: `astro sync`, `npm run lint`, `npm run lint:ui` (40 files clean), `astro check` (0/0/0), `npm test` (22 files, 697 tests), `npm run build` and `npm run preview`. In the preview, `/dev/dashboard-kitchen-sink` and `/dev/projects-kitchen-sink` both returned 404. `npm run smoke` and `test:e2e` were not re-run, because local Supabase was not running. Plan drift: no MISSING items and no intent mismatch. There are three small justified drifts, recorded in F9, and four benign extras: exports in `payouts.ts`/`projects.ts`, the `PUBLIC_ROUTES` entry for the sink, and a positive smoke control. Employee isolation holds: the employee branch only calls `listMyBonuses` under RLS, and the smoke IDOR cases cover it.

## Findings

### F1 — Failed payout summaries are hidden as "nothing awaiting"

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/dashboard.ts:103-116, src/pages/dashboard.astro:105-129
- **Detail**: `listPayoutSummaries` logs a failed `get_payout_summary` RPC and drops that milestone from the map. No flag reaches the page. The milestone then counts as not awaiting, so the greeting can show the "calm" sentence, the awaiting tile can show 0, "Wymaga uwagi" can show its empty state, and the row loses "Zatwierdź". Every other failed read on the page shows an alert. This one makes a failure look like a real zero, which breaks the CLAUDE.md rule "never hide the evidence".
- **Fix**: Return `{ summaries, failed: number }` from `listPayoutSummaries`, OR `failed > 0` into `greetingError`, `statsError` and `attentionError` (or show one "may be incomplete" alert), and add a service test with one rejected RPC.
  - Strength: Uses the existing per-section error alerts, so no new UI is needed.
  - Tradeoff: One failed RPC raises an alert over otherwise-good figures.
  - Confidence: HIGH — confirmed by reading the code.
  - Blind spot: Whether the RPC can fail for a visible milestone in practice (RLS-invisible milestones return null, not an error).
- **Decision**: FIXED — `listPayoutSummaries` returns `{ summaries, failed }`; `failed > 0` raises the greeting, stats and attention errors (`dashboard.astro`). Service tests went red, then green.

### F2 — Unbounded milestone read plus one RPC per milestone

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/dashboard.ts:62-75, 103-116
- **Detail**: `listVisibleMilestones` has no filter or limit, so an Admin reads every milestone ever created. `listPayoutSummaries` then calls one RPC for each scored, unapproved milestone in an open project, all at once. The table shows only 8 rows. This is fine at seed size but grows with the data.
- **Fix A ⭐ Recommended**: Defer to a follow-up change: a set-returning `get_payout_summaries(ids uuid[])` RPC (security invoker) and a SQL filter on live or this-year milestones.
  - Strength: Fixes the cause and keeps one round trip however many milestones there are.
  - Tradeoff: Needs a migration plus `rls_catalog_guard`/`rls_matrix` updates (CLAUDE.md), which is out of this UI change's scope.
  - Confidence: MED — the RPC signature isn't designed yet.
  - Blind spot: Real data volumes are unknown.
- **Fix B**: Cap the work now: limit the parallel RPCs (for example in batches of 10) and filter `status <> 'cancelled'` in the query.
  - Strength: A small change in this code, with no migration.
  - Tradeoff: Still N+1; it only softens the spike.
  - Confidence: HIGH — a local change.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — deferred as a follow-up change (follow-ups/review-fixes.md).

### F3 — A missing or failed bonus_settings read blanks KPI cells silently

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:112
- **Detail**: When `getBonusSettings` fails, every live row's KPI cell shows "—", the same as "not scored yet". No alert appears.
- **Fix**: Set `tableError` (or show a one-line notice) when `settingsResult.error` is set.
- **Decision**: FIXED — `tableError` also covers a failed or missing `bonus_settings` read.

### F4 — Manual check 5.6 is still open; smoke and e2e were not re-run in review

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/new-dashboard-view/plan.md:621
- **Detail**: 5.6 ("Focus rings are visible on every control in the sink") is unchecked. The code applies `focus-visible:ring-ring/50 ring-3` in Topbar and in the dashboard sections, but no one has checked it with the keyboard. 5.2 (smoke) is checked in Progress but could not be re-run here.
- **Fix**: Tab through `/dev/dashboard-kitchen-sink` in `npm run dev` and tick 5.6. With `npx supabase start` running, re-run `npm run smoke`.
- **Decision**: FIXED — the user confirmed every control in `/dev/dashboard-kitchen-sink` shows a focus ring (5.6 ticked); `npm run smoke` re-run against the rebuilt preview with local Supabase: all steps passed, including both employee2 `/dashboard` cases.

### F5 — Null payout pool shown as "0,00 zł"

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/dashboard/AttentionList.astro:65
- **Detail**: `formatPln(summary.payout_pool ?? 0)` shows a made-up zero when the pool is null.
- **Fix**: Show "—" when `payout_pool` is null.
- **Decision**: FIXED — a null pool shows `attention.noPool` ("—", PL/EN) instead of "0,00 zł".

### F6 — Per-project budget percentage computed in the component, untested

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/dashboard/ProjectBudgets.astro:24-34
- **Detail**: The open-project filter and floored percentage repeat `isOpenProject`/`reservedBudget` logic outside `src/lib/dashboard.ts`, so unit and mutation tests do not cover them.
- **Fix**: Extract a `projectBudgetRows()` helper into `src/lib/dashboard.ts` with tests.
- **Decision**: FIXED — `projectBudgetRows()` in `src/lib/dashboard.ts` (+ `ProjectBudgetRow` type), tests went red, then green; `ProjectBudgets.astro` uses it. Mutation run on dashboard.ts: 99.12%; the one survivor is the existing `byText` comparator (line 32), not the new helper.

### F7 — Raw ISO dates and a literal separator in the dashboard

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/dashboard/MilestonesTable.astro:84, src/components/dashboard/LatestBonusBreakdown.astro:43-44
- **Detail**: `start_date`/`end_date` are shown as raw ISO strings, while the history uses `formatDate`. The "–" separator is a template literal.
- **Fix**: Use `formatDate` and a message key for the range.
- **Decision**: DISMISSED — false positive: the app shows plain dates as YYYY-MM-DD (`src/lib/format.ts:22`), so `formatDate` would print the same text; the `start – end` template matches `projects/index.astro:132` and `milestones/[milestoneId].astro:237`.

### F8 — Unreachable `supabase` null fallbacks

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/dashboard.astro:55, 86-95, 133
- **Detail**: `supabase` is null only when `role` is null, and those branches run only when a role is set, so the `: {}` fallbacks are dead code that weakens the types.
- **Fix**: Create the client inside each role branch and drop the fallbacks.
- **Decision**: DISMISSED — false positive: `createClient` returns null when `SUPABASE_URL`/`SUPABASE_KEY` are missing (`src/lib/supabase.ts:6-8`), so the fallbacks are reachable; the attempted change failed `astro check` and was reverted.

### F9 — Small undocumented drifts from the plan contract

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/dashboard.ts:198-204, 261-266; src/lib/services/dashboard.ts:42
- **Detail**: `dashboardRows` takes a fifth parameter, `multiplierMax`, which the KPI cell definition needs. `attentionItems` lists over-budget items only for open projects, a new rule (commented). The embed is `projects!inner(...)` rather than `projects(...)` (commented and tested). All three are justified.
- **Fix**: None needed. These are recorded here for the archive.
- **Decision**: ACCEPTED — justified drifts, recorded for the archive.

## Triage summary (2026-10-20)

- Fixed: F1, F2 (Fix A, deferred to a follow-up), F3, F4, F5, F6
- Dismissed: F7, F8 (false positives, evidence above)
- Accepted: F9

Verification after the fixes: `npm run lint`, `npm run lint:ui` (40 files clean), `npx astro check` (0 errors), `npm test` (22 files, 699 tests), `npm run test:mutation -- --mutate src/lib/dashboard.ts` (99.12%), `npm run build`, `npm run smoke` (all steps passed).
