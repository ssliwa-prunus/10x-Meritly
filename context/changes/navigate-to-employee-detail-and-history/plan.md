# Navigate to Employee Detail and History Implementation Plan

## Overview

Roadmap S-06 (FR-013, FR-014). A Supervisor or Admin opens an employee's detail view from a milestone's results or from the employee list. The view shows the employee's current open assignments and their history of Approved bonuses, grouped by project. The employee sees the same project-grouped history on `/my-bonuses`. Both read the frozen approval snapshot (`milestone_result_lines`) under the existing RLS, so no migration is needed.

## Current State Analysis

- **No employee detail page exists.** `/employees` (`src/pages/employees/index.astro`) is a single list with inline edit forms, not migrated to tokens. Names in the list are plain text (`index.astro:150`).
- **The payout table links nowhere.** `PayoutSection.astro:126` renders `line.employee_name` as plain text. Draft lines (live RPC `milestone_payout_lines`) and Approved lines (snapshot) both carry `employee_id` (`src/types.ts:95,104`).
- **`/my-bonuses` is a flat history.** It lists Approved lines newest first via `listMyBonuses` (`src/lib/services/approvals.ts:398`), with a breakdown row per line. The page takes no parameters. The test plan relies on "no employee URL takes a data ID" (`context/foundation/test-plan.md` §6.3 IDOR).
- **RLS already gives the decided scope** (`supabase/migrations/20261005120000_milestone_approval.sql:198-218`):
  - `milestone_result_lines`: the owning Supervisor (`owns_milestone`) and Admin read every line. An activated Employee reads only their own lines of approved milestones.
  - `milestone_engagements`: the owning Supervisor and Admin only (`20260929120000_employees_and_engagements.sql:435-445`).
  - `employees`: a Supervisor reads employees they own plus anyone engaged on one of their milestones (`employees_select_supervisor`, `:384`).
- **"Open" is already defined** in `employee_time_share_totals`: milestone status not in (`completed`, `cancelled`, `approved`) and project status not in (`completed`, `cancelled`) (`20261009130000_time_share_excludes_closed_projects.sql:26-27`).
- **Not-found pattern:** `/projects/[id]` treats an invalid id, a missing row and an RLS-hidden row alike: HTTP 200 with a "not found" card (`src/pages/projects/[id].astro:57,103`).
- **Route gating:** `/employees/[id]` falls under the `/employees` prefix in `PROJECT_ROUTES` (Supervisor or Admin; Employee gets 403) with no change to `src/lib/route-access.ts`.

## Desired End State

- A Supervisor clicks an employee's name in any milestone's payout table (Draft or Approved) or in `/employees` and lands on `/employees/<id>`. The page shows:
  - **Header:** name, email, job role, invite status and open time-share total, with the over-100% flag.
  - **Current assignments:** open milestones only, each with project, milestone, period and time share, and a link to the milestone. No Draft bonus figures.
  - **Approved history:** grouped by project, with a subtotal per project and an overall total.
- What a Supervisor sees is limited to milestones they own. An Admin sees all.
- An unknown, invalid or RLS-hidden id shows "Employee not found." An Employee gets 403.
- Accepted (impl-review F4): a Supervisor can open any employee RLS lets them read, so not only their own but also another Supervisor's employee engaged on one of their milestones (`employees_select_supervisor`, reached through the payout-table links). The header then shows that employee's email and account status. This is intended: the policy grants the read deliberately, and the page adds nothing beyond it. History and assignments stay limited to the Supervisor's own milestones.
- `/my-bonuses` shows the same project-grouped history through the same component, still taking no parameters.
- Ordering: projects by their most recent `approved_at`, newest first. Milestones within a project by `end_date`, newest first.
- Verified by: unit tests for the grouping helper, `rls_matrix` cells pinning the scope, smoke cells for the new route, the updated US-01 e2e, and the kitchen sink.

### Key Discoveries:

- E1 in the matrix fixture has Approved lines on `MA_appr` (SA) and `MR_appr` (PR, reassigned to SB at the end of the suite). That's exactly the cross-supervisor case to pin (`supabase/tests/rls_matrix.test.sql:33-47,236-244`).
- US-01 e2e finds `/my-bonuses` rows with `getByRole("row").filter({ hasText: projectName })`, and the Draft step asserts that count is **0** (`tests/e2e/us-01-approved-bonus-visible-only-to-its-employee.spec.ts:142,159-164`).
- Smoke has a single seeded supervisor. Employee `…0031` has 600,00 zł on Approved milestone `…0023`; `employee2` has 400,00 zł (`scripts/smoke.mjs:15-22`).
- `CLEAN_PATHS` already includes `PayoutSection.astro` and `my-bonuses.astro`. The new page and component go there too (`scripts/check-ui-literals.mjs:9-23`).

## What We're NOT Doing

- No change to RLS, views, functions or grants, and no migration. A Supervisor does not see an employee's history on other Supervisors' milestones, and gets no hint that it exists.
- No Draft bonus figures on the detail page, and no live payout RPC calls per milestone.
- No employee detail URL with an ID for the Employee role. Employees stay on `/my-bonuses`.
- No editing on the detail page. Editing and invites stay in the `/employees` list.
- No links from the engagement/assignments section or the project pages (only the payout table and `/employees`).
- No token migration of `/employees/index.astro` beyond the name link.
- No new e2e spec for the drill-down (smoke and pgTAP cover the boundary).
- S-07 aggregate report, export, and a company-wide project browser.

## Implementation Approach

- **One pure helper.** It groups snapshot lines by `project_id`, orders them, and sums subtotals and the total in integer grosze. Both pages call it.
- **One presentational component.** `EmployeeHistory.astro` renders the grouped result on both pages, so Supervisor and Employee see identical shapes.
- **Thin service reads under the user's client.** RLS decides scope. The service adds an `employee_id` filter for the query shape, plus defence in depth on `/my-bonuses`.
- **Tests at the real boundary.** pgTAP pins the per-actor read of the exact query shapes the pages use. Smoke pins the HTTP layer of the new ID-bearing route.

## Critical Implementation Details

- **The e2e trap.** Grouping moves the project name out of each row, so the US-01 Draft check (`row` with project name → count 0) would pass vacuously. In Phase 2, locate the project group by its accessible name, assert the group is **absent** before approval and **present** with the own bonus after, and prove it with a deliberate break.
- **Money sums.** Subtotals and the total are summed in grosze (`Math.round(bonus * 100)`) and divided once for display. Floating-point addition of `numeric` strings converted to numbers can be off by a grosz (test-plan §6.2).
- **Group key.** Group by `project_id`, never by `project_name`. Two projects may share a name, and snapshot names are frozen per approval, so the display name of a group is taken from its most recently approved line.

## Phase 1: History model and services

### Overview

The data shape both pages render: a pure grouping helper with unit tests and mutation coverage, plus the service reads for the detail page.

### Changes Required:

#### 1. Types

**File**: `src/types.ts`

**Intent**: Add `project_id` to the history line type. Add types for a project group, the grouped history, the employee detail header and an open assignment.

**Contract**: `MyBonusLine` gains `project_id`. New:

- `HistoryProjectGroup`: `{ project_id, project_name, latest_approved_at, subtotal, lines }`.
- `EmployeeHistory`: `{ groups, total, line_count }`.
- `EmployeeDetail`: header fields plus `open_total` and `over_allocated`.
- `OpenAssignment`: `{ engagement_id, project_id, project_name, milestone_id, milestone_name, start_date, end_date, time_share }`.

#### 2. Grouping helper

**File**: `src/lib/history.ts` (new), tests in `src/lib/__tests__/history.test.ts`

**Intent**: Turn flat snapshot lines into ordered project groups with subtotals and a total. It's pure so it can be unit- and mutation-tested.

**Contract**: `groupHistory(lines: MyBonusLine[]): EmployeeHistory`.

- Groups by `project_id`. Each group's name comes from its most recently approved line.
- Groups are ordered by `latest_approved_at` desc. Ties break by `project_name`, then `project_id`.
- Lines within a group are ordered by `end_date` desc, then `milestone_name`.
- Sums are in integer grosze. Empty input gives `{ groups: [], total: 0, line_count: 0 }`.

#### 3. Service reads

**File**: `src/lib/services/approvals.ts`, `src/lib/services/employees.ts`

**Intent**:

- `listMyBonuses` selects `project_id` too.
- New `listEmployeeHistory(supabase, employeeId)` reads `milestone_result_lines` filtered by `employee_id` under the caller's RLS.
- New `getEmployeeDetail(supabase, employeeId)` reads the employee row (`EMPLOYEE_COLUMNS`) and its `employee_time_share_totals` row. It returns `data: null` when RLS hides the employee or the id is not a uuid.
- New `listOpenAssignments(supabase, employeeId)` reads `milestone_engagements` for the employee, embedding milestone and project, and keeps only open ones per the `employee_time_share_totals` rule.

**Contract**:

- All reads use the user's client, so no service-role key is involved.
- An invalid uuid is answered as not found without querying. Reuse the uuid validation the project/milestone pages use.
- Errors map through the existing `mapLoadError`.
- The open filter is `milestones.status not in (completed, cancelled, approved)` and `projects.status not in (completed, cancelled)`, ordered by `start_date`.

### Success Criteria:

#### Automated Verification:

- Grouping unit tests pass, including: two projects with the same name stay separate, group order follows the latest approval rather than the end date, a sub-grosz float sum is exact (e.g. 0.1 + 0.2 style), and empty input: `npx vitest run src/lib/__tests__/history.test.ts`
- Mutation testing of the helper leaves no surviving mutant in ordering or summing: `npm run test:mutation -- --mutate src/lib/history.ts`
- Full unit suite, lint and type-check pass: `npm test`, `npm run lint`, `npx astro check`

**Implementation Note**: After automated verification passes, pause for human confirmation before Phase 2.

---

## Phase 2: `/my-bonuses` grouped by project

### Overview

The employee side of FR-014. The same page and URL, rendered through the shared history component.

### Changes Required:

#### 1. Shared history component

**File**: `src/components/history/EmployeeHistory.astro` (new)

**Intent**: Render an `EmployeeHistory`: one titled section per project with its milestones (period, approval date, bonus, and the existing breakdown row) and a subtotal, plus an overall total and count. Includes an empty state.

**Contract**: Props `{ history: EmployeeHistory; headingLevel?: 2 | 3; emptyText: string }`.

- Each project group is a labelled region or table whose accessible name is the project name, so tests can locate it by role and name.
- Token classes only. Reuse `Table`/`Card` from `src/components/ui/` and the formatters in `@/lib/format`.
- Add the component to `CLEAN_PATHS`.

#### 2. `/my-bonuses`

**File**: `src/pages/my-bonuses.astro`

**Intent**: Replace the flat table with `groupHistory(lines)` → `EmployeeHistory`. Keep the not-linked and error states and the "no parameters" property.

**Contract**: No new query parameters are read, and the page heading stays "My bonuses". Update the card copy to describe the per-project grouping and total.

#### 3. US-01 e2e locators

**File**: `tests/e2e/us-01-approved-bonus-visible-only-to-its-employee.spec.ts`

**Intent**: Locate the own result by the project group's accessible name instead of a row containing the project name. The Draft-case absence check stays meaningful (see Critical Implementation Details).

**Contract**:

- Before approval, the project group is absent.
- After approval, the group is present and contains the milestone cell and `1200,00 zł` / `800,00 zł`.
- The colleague's figure is absent anywhere on the page (the existing `(?<!\d)` pattern).

### Success Criteria:

#### Automated Verification:

- Lint, UI literal guard, type-check and unit tests pass: `npm run lint`, `npm run lint:ui`, `npx astro check`, `npm test`
- US-01 e2e passes: `npx playwright test tests/e2e/us-01-approved-bonus-visible-only-to-its-employee.spec.ts`
- Deliberate break: making `/my-bonuses` render the colleague's line (or rendering the group before approval) turns the named US-01 assertion red; reverted afterwards
- Existing `/my-bonuses` smoke cells pass: `npm run smoke` against the rebuilt preview

#### Manual Verification:

- As `employee@meritly.local`, `/my-bonuses` shows "Approved Demo Project" as a group with its milestone, 600,00 zł, the breakdown, the subtotal and the total.
- The page reads correctly at phone width, with no horizontal page scroll beyond the table's own overflow.

**Implementation Note**: After automated verification passes, pause for human confirmation before Phase 3.

---

## Phase 3: Employee detail page and links

### Overview

The Supervisor side: the FR-013 navigation and the FR-014 history on `/employees/[id]`.

### Changes Required:

#### 1. Detail page

**File**: `src/pages/employees/[id].astro` (new)

**Intent**: Load `getEmployeeDetail`, `listOpenAssignments` and `listEmployeeHistory` in parallel. Render:

- the header;
- a "Current assignments" card linking each row to its milestone page;
- `EmployeeHistory` via `groupHistory`.

A missing, invalid or hidden employee shows the "Employee not found." card (HTTP 200, as `/projects/[id]` does).

**Contract**:

- Route `/employees/[id]` (Supervisor or Admin via the existing `PROJECT_ROUTES`).
- Heading copy states the scope: for a Supervisor, "Approved bonuses on your projects"; for an Admin, "All approved bonuses".
- Tokens only; add the page to `CLEAN_PATHS`.
- Includes a back link to `/employees`.

#### 2. Links to the detail page

**File**: `src/components/milestones/PayoutSection.astro`, `src/pages/employees/index.astro`

**Intent**: Turn the employee name into a link to `/employees/<employee_id>`. In the payout table that applies to Draft and Approved lines alike. In the `/employees` list it applies to the name cell.

**Contract**:

- Link text is the employee name.
- PayoutSection uses the token link style already used there (`text-primary hover:underline` plus `focusRing`).
- `/employees` keeps its current unmigrated classes for the cell. Don't introduce new palette classes beyond the existing link style in that file.

#### 3. Kitchen sink

**File**: `src/pages/dev/projects-kitchen-sink.astro`

**Intent**: Show `EmployeeHistory` in its default (two projects), empty and hover/focus-visible (name link) states from inline fixtures, and the PayoutSection name link in focus-visible.

**Contract**: Follow the existing `states` list and fixture style. Dev-only, 404 in production as now.

#### 4. Route-access rows

**File**: `src/lib/__tests__/route-access.test.ts`

**Intent**: Add `/employees/<uuid>` to the signed-out redirect table and the role × route matrix: employee 403, supervisor allowed, admin allowed.

**Contract**: The expected values come from the role rules, not from reading `route-access.ts`.

### Success Criteria:

#### Automated Verification:

- Route-classification and route-access tests pass: `npx vitest run src/lib/__tests__/route-access.test.ts src/lib/__tests__/route-classification.test.ts`
- Lint, UI literal guard (new page and component in `CLEAN_PATHS`), type-check, unit tests and build pass: `npm run lint`, `npm run lint:ui`, `npx astro check`, `npm test`, `npm run build`

#### Manual Verification:

- As the seeded supervisor:
  - On milestone `…0023` (Approved) and `…0024` (Draft), clicking an employee's name opens their detail page.
  - The page shows the header, the open Draft milestone under "Current assignments" with its time share and no bonus, and "Approved Demo Project" with 600,00 zł under history.
- As admin, the same page shows the "All approved bonuses" heading.
- `/employees/00000000-0000-4000-8000-000000000999` and `/employees/not-a-uuid` show "Employee not found.".
- Kitchen sink: the new states render correctly, and the focus ring is visible on the name links.

**Implementation Note**: After automated verification passes, pause for human confirmation before Phase 4.

---

## Phase 4: Boundary tests and docs

### Overview

Pin the decided visibility at the database and HTTP layers, and record the new ID-bearing route in the test plan.

### Changes Required:

#### 1. `rls_matrix` cells

> **Note (implementation and impl-review, 2026-10-12):** what was built differs from the contract below in three ways, each recorded on purpose.
>
> - **The SA history cell pins MA_appr + MA_draft + MR_appr.** MA_draft is the injected Draft line: the Supervisor policy is `owns_milestone` only. The detail page therefore filters to approved milestones itself (impl-review F1: `listEmployeeHistory` embeds `milestone_results!inner(milestones!inner(status))` = `approved`). This was proven red→green with an injected Draft line.
> - **The SA engagements cell pins the raw RLS scope** (all four E1 engagements). The "open" rule runs in TypeScript and is unit-tested in `src/lib/__tests__/assignments.test.ts` (impl-review F2, `toOpenAssignments`).
> - **The positive smoke cells use employee2** (`…0033`, 400,00 zł), not employee (`…0031`, 600,00 zł). employee2 holds the open Draft assignment the Draft-figure cell needs.

**File**: `supabase/tests/rls_matrix.test.sql`

**Intent**: Pin the history and assignment reads in the exact shape the pages use (`where employee_id = …`) for each actor. No migration changes, so `rls_catalog_guard.test.sql` stays unchanged (CLAUDE.md exception: the catalog shape did not change).

**Contract**: Expected values come from the decided matrix ("own milestones only", Admin all, Employee own approved only). Cells:

- **SA (before PR reassignment):** E1 history = `MA_appr` + `MR_appr` lines. E1 open assignments include `MA_draft` and exclude `MA_appr` (approved) and `MC` (cancelled project).
- **SB (before reassignment):** E1 history is empty, and E1's engagements are empty.
- **SB (after PR reassignment):** E1 history = `MR_appr` only, never `MA_appr`.
- **AD:** E1 history = every E1 line.
- **E2:** E1 history is empty.
- **E1:** own history = `MA_appr` + `MR_appr`, never the injected Draft line `…0751`.

Update `plan(N)` and the fixture-map comment.

#### 2. Smoke cells

> **Note (implementation, Phase 3):** these cells were written in Phase 3 as the test-first RED driver for the detail page and links (agreed at the `/10x-tdd` gate), together with an `htmlIncludes` check in the harness for link hrefs. A Draft-figure cell was added: the employee detail page must not show the Draft milestone's 1000,00 zł, which the Supervisor's milestone page does show (positive control). Phase 4 keeps step 4.3 (smoke passes) as the final check.

**File**: `scripts/smoke.mjs`

**Intent**: Cover the new route that carries data an employee must not see.

**Contract**:

- `employee` → `/employees/<EMPLOYEE_1>` gives 403, and `employee2` gives 403.
- Supervisor → `/employees/<EMPLOYEE_1>` gives 200 with `600,00 zł`. Admin gives the same.
- Supervisor → `/employees/<nonexistent uuid>` gives 200 with "Employee not found." and excludes `600,00 zł`, paired with the positive cell above.
- Supervisor → `/projects/<APPROVED_PROJECT>/milestones/<APPROVED_MILESTONE>` includes a link to `/employees/<EMPLOYEE_1>`.

#### 3. Docs and roadmap

**File**: `context/foundation/test-plan.md`, `CLAUDE.md`

**Intent**:

- Test plan §6.3 IDOR: an ID-bearing employee route now exists, Supervisor/Admin only (Employee 403), with RLS scope pinned in `rls_matrix`.
- §6.6 gets an S-06 note.
- CLAUDE.md gets a one-line mention of `/employees/[id]` under Architecture, if the route list there needs it.

**Contract**: Prose edits only.

### Success Criteria:

#### Automated Verification:

- pgTAP passes with the new cells: `npx supabase db reset --local && npx supabase test db`
- Deliberate break: a scratch migration that widens `milestone_result_lines_select_supervisor` to any supervisor turns the named SB cell red; scratch file deleted and database reset afterwards
- Smoke passes against the rebuilt preview: `npm run build`, `npx astro preview stop`, `npm run preview -- --port 4321`, `npm run smoke`
- Full checks pass: `npm run lint`, `npm run lint:ui`, `npx astro check`, `npm test`

#### Manual Verification:

- The test-plan §6.3 and §6.6 wording matches what was built.

---

## Testing Strategy

### Unit Tests:

- `groupHistory`: grouping by id rather than name, group and line ordering with ties, exact grosze sums, empty input, the group name taken from the latest approval.
- Route-access matrix rows for `/employees/<id>`.

### Integration Tests:

- pgTAP `rls_matrix` cells for the history and assignment query shapes per actor, including the reassignment case.
- Smoke: 403 for both employees, Supervisor and Admin visibility, not-found body, the link from the payout table.
- US-01 e2e, with group-based locators, for the employee side.

### Manual Testing Steps:

1. As the supervisor, open Approved milestone `…0023`, click `employee`'s name, and check the header, assignments and history.
2. Repeat from Draft milestone `…0024` and from `/employees`.
3. As admin, open the same employee and check the heading wording.
4. As `employee`, open `/my-bonuses` and check the grouping, subtotal and total. Then try `/employees/<own id>` and expect 403.
5. Open a nonexistent and an invalid id and expect "Employee not found.".

## Performance Considerations

There are three small parallel reads per detail page, bounded by one employee's engagements and lines. Grouping happens in memory and there are no per-milestone RPC calls.

## Migration Notes

None. No schema, policy or data changes.

## References

- Roadmap: `context/foundation/roadmap.md` § S-06
- PRD: `context/foundation/prd.md` FR-013, FR-014
- S-05 plan (snapshot, `/my-bonuses`): `context/archive/2026-10-05-supervisor-approves-milestone-employee-sees-bonus/plan.md`
- RLS matrix decisions (F3 reassignment): `context/archive/2026-10-07-testing-rls-matrix/`
- Test cookbook: `context/foundation/test-plan.md` §6.1, §6.3, §6.5
- Not-found pattern: `src/pages/projects/[id].astro:57`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: History model and services

#### Automated

- [x] 1.1 Grouping unit tests pass, including: two projects with the same name stay separate, group order follows the latest approval rather than the end date, a sub-grosz float sum is exact (e.g. 0.1 + 0.2 style), and empty input — f2432ba
- [x] 1.2 Mutation testing of the helper leaves no surviving mutant in ordering or summing — f2432ba
- [x] 1.3 Full unit suite, lint and type-check pass — f2432ba

### Phase 2: `/my-bonuses` grouped by project

#### Automated

- [x] 2.1 Lint, UI literal guard, type-check and unit tests pass — 46b3554
- [x] 2.2 US-01 e2e passes — 46b3554
- [x] 2.3 Deliberate break: making `/my-bonuses` render the colleague's line (or rendering the group before approval) turns the named US-01 assertion red; reverted afterwards — 46b3554
- [x] 2.4 Existing `/my-bonuses` smoke cells pass — 46b3554

#### Manual

- [x] 2.5 As `employee@meritly.local`, `/my-bonuses` shows "Approved Demo Project" as a group with its milestone, 600,00 zł, the breakdown, the subtotal and the total — 46b3554
- [x] 2.6 The page reads correctly at phone width, with no horizontal page scroll beyond the table's own overflow — 46b3554

### Phase 3: Employee detail page and links

#### Automated

- [x] 3.1 Route-classification and route-access tests pass — 1a8a59b
- [x] 3.2 Lint, UI literal guard (new page and component in `CLEAN_PATHS`), type-check, unit tests and build pass — 1a8a59b

#### Manual

- [x] 3.3 As the seeded supervisor, clicking an employee's name on milestones `…0023` and `…0024` opens a detail page with the header, the Draft milestone under current assignments (no bonus) and 600,00 zł under history — 1a8a59b
- [x] 3.4 As admin, the same page shows the "All approved bonuses" heading — 1a8a59b
- [x] 3.5 A nonexistent and an invalid id show "Employee not found." — 1a8a59b
- [x] 3.6 Kitchen sink: the new states render correctly, and the focus ring is visible on the name links — 1a8a59b

### Phase 4: Boundary tests and docs

#### Automated

- [x] 4.1 pgTAP passes with the new cells — 43875b3
- [x] 4.2 Deliberate break: a scratch migration that widens `milestone_result_lines_select_supervisor` to any supervisor turns the named SB cell red; scratch file deleted and database reset afterwards — 43875b3
- [x] 4.3 Smoke passes against the rebuilt preview — 43875b3
- [x] 4.4 Full checks pass — 43875b3

#### Manual

- [x] 4.5 The test-plan §6.3 and §6.6 wording matches what was built — 43875b3
