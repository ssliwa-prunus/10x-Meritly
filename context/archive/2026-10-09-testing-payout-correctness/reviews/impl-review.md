<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Payout Correctness & Approval Freeze

- **Plan**: context/changes/testing-payout-correctness/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-09
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Evidence:

- **Changed files vs plan:** every file in the diff is in the plan, and every planned file was changed.
- **Re-run checks:** `npx supabase db reset --local && npx supabase test db` passes 658 tests in 9 files. Prettier passes on both docs, no "TBD — see §3 Phase 2" remains, and no scratch migration is left behind.
- **Untouched suites:** the catalog guard, `employees_rls` and `milestone_approval` are unchanged since `ecbb6fe`.
- **Manual checks:** all four were confirmed by the user in the session.
- **Oracles:** both review agents recomputed every literal by hand.
- **Migration bodies:** they match their predecessors except for the planned guard or join.
- **No leaks:** an Approved milestone the caller cannot see still returns no rows, so its status doesn't leak. The time-share join under RLS drops no open row.

## Findings

### F1 — CLAUDE.md RLS-test rule contradicts the new §6.1 exception

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: CLAUDE.md:25 vs context/foundation/test-plan.md:129 and supabase/tests/rls_matrix.test.sql:19-22
- **Detail**: CLAUDE.md still says a migration that "adds or changes a table, view, policy, grant or `security definer` function must update" both `rls_catalog_guard` and `rls_matrix`. §6.1 and the matrix header now let a migration that changes only a body leave the guard unchanged. This change followed the new wording (it changed one view and two functions without touching the guard). Agents read CLAUDE.md first, so the two sources now give different instructions. CLAUDE.md also has unrelated uncommitted edits in the worktree.
- **Fix A ⭐ Recommended**: Update the CLAUDE.md bullet to match §6.1. A migration that changes only the body of a view or `security invoker` function (same name, columns, `security_invoker`, grants, definer status) adds `rls_matrix` cells and leaves the guard unchanged.
  - Strength: It records the decision made during planning in the file agents read first, and keeps one rule everywhere.
  - Tradeoff: It edits a file with your uncommitted changes, so the commit has to stage only this hunk, or you commit it together with your edits.
  - Confidence: HIGH — the exception was an explicit planning decision ("Matrix cells, guard unchanged").
  - Blind spot: None significant.
- **Fix B**: Keep CLAUDE.md literal. Revert the §6.1 and matrix-header exception and add a guard assertion for the changed objects.
  - Strength: No rule change.
  - Tradeoff: Goes against the planning decision and turns every future body tweak into a guard edit.
  - Confidence: MED — it works, but adds friction for little signal.
  - Blind spot: The guard has no definition-pinning assertions today, so this would be a new kind of check.
- **Decision**: FIXED (Fix A) — CLAUDE.md RLS-test bullet now states the body-only exception.

### F2 — Time-share explanation text in the UI no longer matches the flag

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/pages/projects/[id]/milestones/[milestoneId].astro:304-305, src/pages/employees/index.astro:91
- **Detail**: Both pages explain the open total as time share "across milestones that are not completed, cancelled or approved". The employees page also leaves out "approved", which was already out of date. Since `20261009130000`, engagements in cancelled or completed projects are excluded too. The plan's "no UI copy change" covered only the budget panel text, so this gap was not decided.
- **Fix**: Update both sentences to "…across milestones that are not completed, cancelled or approved, in projects that are still open."
- **Decision**: FIXED — both explanations now say "…not completed, cancelled or approved, in projects that are still open".

### F3 — Nothing pins that MR015 applies only to `approved`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/tests/payout_correctness.test.sql:607-619
- **Detail**: The #4 section checks that MR015 fires on an Approved milestone, but no test shows that a `completed` (not approved) milestone still gets live figures. The page relies on that. A guard widened to `in ('approved', 'completed')` would pass the whole suite.
- **Fix**: Add one #4 assertion: a `completed` milestone with the C2 inputs returns the C2 hand figures from `milestone_payout_summary` as SP, and bump `plan(N)`.
- **Decision**: FIXED — #4 completes B and asserts lives_ok + the live C2 figures (plan 49 → 51); widening the guard to completed fails test 32 by name.

### F4 — Two definitions of "open" now differ (MR008 / MR012 vs time-share view)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: supabase/migrations/20261005120000_milestone_approval.sql:458, :552
- **Detail**: The owner-change guards MR008 and MR012 treat a milestone as open by its own status alone. The time-share view now also treats any milestone in a closed project as closed. An employee on an active milestone in a cancelled project therefore counts as engaged for those guards, but not for the open total. The guards are on the stricter side, so nothing breaks, but the difference is not recorded anywhere.
- **Fix**: Add one line to the Phase 2 note in test-plan.md §6.6 recording the difference as intended for now. Aligning the guards is left to a later change.
- **Decision**: FIXED — divergence recorded in the test-plan §6.6 Phase 2 note.

### F5 — test-plan.md has minor stale or extra wording

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/foundation/test-plan.md:82, :90, :113
- **Detail**:
  - §3 row 2 Status still says `change opened` while the change is implemented. The orchestrator owns this cell.
  - §4 still says "Exists — 6 test files"; there are now 9. This predates the change.
  - §5 Vitest "Catches" reads "gating logic and TS input-parsing regressions" rather than the planned "gating logic regressions". It is accurate, but beyond the contract.
- **Fix**: Correct the §4 file count to 9. Leave the §3 status to `/10x-test-plan` and keep the §5 wording.
- **Decision**: FIXED — §4 count corrected to 9; §3 status left to /10x-test-plan; §5 wording kept.

### F6 — Approval racing a page load shows a generic error

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/projects/[id]/milestones/[milestoneId].astro:69-104, src/lib/services/payouts.ts:145
- **Detail**: The page reads the status, then calls the RPCs. If the milestone is approved in between, MR015 surfaces as "Could not load bonuses" and a reload fixes it. The plan already accepted this under "What We're NOT Doing". It is listed only so it stays visible.
- **Fix**: None. It was already accepted in the plan.
- **Decision**: ACCEPTED — already accepted in the plan's "What We're NOT Doing".
