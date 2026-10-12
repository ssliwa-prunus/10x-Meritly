<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Navigate to Employee Detail and History

- **Plan**: context/changes/navigate-to-employee-detail-and-history/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-12
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | WARNING |

Automated criteria were re-run on HEAD (9038764):

- 196 unit tests pass.
- lint is clean.
- `lint:ui` reports 15 files clean.
- `astro check` reports 0 errors.
- pgTAP: 672 tests pass across 9 files.
- Smoke passes on all steps.
- Stryker scores `src/lib/history.ts` at 100%.

Every manual row has its user confirmation recorded in this session.

## Triage (2026-10-12)

- Fixed: F1 (Fix A), F2, F3, F5 (with F2), F6, F7
- Accepted: F4 (Fix A)
- After the fixes: unit 204, lint and lint:ui clean, astro check 0 errors, pgTAP 672, smoke and e2e (3) pass; Stryker 100% on src/lib/assignments.ts.

## Findings

### F1 — Detail-page history shows any stored line, including a non-approved one

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/approvals.ts:443
- **Detail**:
  - `listEmployeeHistory` reads `milestone_result_lines` filtered only by `employee_id`.
  - The Supervisor and Admin select policies are `owns_milestone` / `is_admin`, with no approved condition.
  - `rls_matrix` pins that SA's read returns the injected Draft line on MA_draft (supabase/tests/rls_matrix.test.sql:268).
  - So the page's guarantee that Draft figures are never shown holds only because `approve_milestone` is the sole writer.
  - The smoke check "never a Draft figure" passes because no Draft line exists, not because anything filters it out.
  - The plan's Desired End State claims no Draft figures on the detail page.
- **Fix A ⭐ Recommended**: Filter to approved milestones in the query, e.g. embed `milestones!inner(status)` with `.eq("milestones.status", "approved")`. Add a smoke or pgTAP-backed check if feasible.
  - Strength: Enforces the plan's invariant at the read, independent of who writes snapshot rows; one query change.
  - Tradeoff: A join on every detail-page load (negligible at this scale); an approved milestone is frozen, so nothing else changes.
  - Confidence: MED — the PostgREST embedded-filter syntax needs checking against the installed supabase-js version.
  - Blind spot: Whether a future un-approve path would want Draft snapshots shown to the Supervisor.
- **Fix B**: Keep the query and document the single-writer reliance in the service docstring and the page comment.
  - Strength: Zero behaviour change; the invariant is already enforced by the DB (only `approve_milestone` writes, MR015 freezes).
  - Tradeoff: The guarantee stays implicit; a future writer would silently surface Draft figures.
  - Confidence: HIGH — matches how `/my-bonuses` relies on RLS's approved check, which Supervisor policies lack.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — listEmployeeHistory filters through milestone_results!inner(milestones!inner(status)) = approved. Verified red→green: an injected Draft line on …0024 showed 1000,00 zł on /employees/…0033 before the fix, not after (approved 400,00 zł still shown); DB reset afterwards.

### F2 — Open-assignment filter is untested on the excluding side

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/lib/services/employees.ts:309
- **Detail**:
  - The "open" rule (`CLOSED_MILESTONE` / `CLOSED_PROJECT`) runs in TypeScript inside `listOpenAssignments`.
  - No unit test covers it, and pgTAP pins only the raw engagement scope.
  - Smoke checks only that the open Draft milestone appears.
  - A wrong list, such as one that lets approved milestones or cancelled projects through, passes every automated check.
  - The plan's SA matrix cell intended to cover the exclusion: include MA_draft, exclude MA_appr and MC.
- **Fix**: Extract the filter and sort into a pure helper in `src/lib`, e.g. `toOpenAssignments(rows)`, and unit-test both sides: closed milestone, approved milestone, closed project, and the open case.
- **Decision**: FIXED — open rule and order moved to pure src/lib/assignments.ts (toOpenAssignments), listOpenAssignments delegates; 8 unit tests cover planned/active kept, completed/cancelled/approved milestones and completed/cancelled projects dropped, hidden embeds dropped, order; Stryker 100%.

### F3 — Plan text out of date with what the tests pin

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/navigate-to-employee-detail-and-history/plan.md (Phase 4)
- **Detail**: The plan's Phase 4 contract differs from what was built in three places:
  - The SA history cell pins MA_appr + MA_draft (injected) + MR_appr, where the plan said MA_appr + MR_appr.
  - The SA open-assignments cell pins raw engagements; the open filter is in TypeScript (see F2).
  - The positive smoke cells use employee2 (`…0033`, 400,00 zł), not employee (`…0031`, 600,00 zł). Employee2 holds the Draft assignment the Draft-figure cell needs.

  The test plan and the commit messages record these, but the plan does not.

- **Fix**: Add a short implementation note to the plan's Phase 4 block recording the three deviations.
- **Decision**: FIXED — implementation note added to the plan Phase 4 rls_matrix block (SA injected Draft line + F1 filter, raw engagement scope + F2 unit tests, employee2 smoke fixture).

### F4 — Detail page shows email and account status for employees the Supervisor does not own

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/employees/[id].astro
- **Detail**:
  - `/employees` lists only the Supervisor's own employees.
  - The detail page shows any employee RLS lets them read, which includes another Supervisor's employee engaged on one of their milestones.
  - It is reachable via the new payout-table links, and the header shows that employee's email and invite status.
  - This is RLS-sanctioned and pinned ("after reassignment SB can open E1"), so it is not a leak. It is a wider read surface than the list implies.
- **Fix A ⭐ Recommended**: Accept as intended and note it in the plan's Desired End State.
  - Strength: The `employees_select_supervisor` policy already grants this read deliberately, and the payout table already shows the name.
  - Tradeoff: Email visibility of non-owned employees becomes an explicit product decision.
  - Confidence: HIGH — the policy and its tests were designed this way in S-03.
  - Blind spot: Whether the PRD expects email to be owner-only.
- **Fix B**: Hide email and account status when `supervisor_id !== profile.id && !isAdmin`.
  - Strength: The detail page reveals no more than the list does.
  - Tradeoff: Page filtering of an RLS-readable field, which is cosmetic rather than a boundary.
  - Confidence: MED — straightforward, but adds a role branch to the header.
  - Blind spot: Email remains readable through PostgREST directly anyway.
- **Decision**: ACCEPTED via Fix A — intended; recorded in the plan Desired End State (RLS grants the read; history and assignments stay own-milestones only).

### F5 — Open assignments: non-deterministic order on equal start dates

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/employees.ts:337
- **Detail**:
  - The sort uses `start_date` only. PostgREST returns rows unordered, so same-day assignments can swap between loads.
  - The function also fetches all of the employee's engagements and filters in JS, which is fine at this scale.
- **Fix**: Add tie-breakers (project name, milestone name). Folds naturally into F2's helper.
- **Decision**: FIXED with F2 — toOpenAssignments orders by start date, then project name, then milestone name (input-order test).

### F6 — Duplicate id validation in getEmployeeDetail

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/employees.ts:260
- **Detail**:
  - The page already validates with `employeeIdSchema` before calling.
  - Sibling services (`getProject`, `listOpenAssignments`, `listEmployeeHistory`) document "must already be a validated UUID" and don't re-check.
  - The check is harmless but inconsistent. The plan asked for it in the service, so it is plan-sanctioned.
- **Fix**: Drop the in-service check and use the siblings' docstring.
- **Decision**: FIXED — getEmployeeDetail no longer re-validates; docstring now says `id` must already be a validated UUID (the page validates; malformed-id smoke cell still covers it).

### F7 — Small pattern leftovers

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/history/EmployeeHistory.astro:14; src/pages/employees/index.astro:161; src/pages/employees/[id].astro:50
- **Detail**:
  - `headingLevel` is never passed, so it is always 3.
  - The new `/employees` name link's `focus-visible:ring-3` has no ring colour; the file's style uses `ring-purple-300/40` via `form-classes.ts`.
  - `focusRing` and `STATUS_LABELS` are copy-pasted again, now in six and two places respectively. This predates S-06.
- **Fix**: Remove `headingLevel`, add `focus-visible:ring-purple-300/40` to the link, and leave the shared-constant extraction for the `/employees` token migration.
- **Decision**: FIXED — headingLevel removed (projects are always h3 under an h2 section); focus-visible:ring-purple-300/40 added to the /employees name link. Shared focusRing / STATUS_LABELS extraction left for the /employees token migration.
