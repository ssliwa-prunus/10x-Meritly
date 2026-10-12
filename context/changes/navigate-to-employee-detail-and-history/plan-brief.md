# Navigate to Employee Detail and History — Plan Brief

> Full plan: `context/changes/navigate-to-employee-detail-and-history/plan.md`

## What & Why

S-06 (FR-013, FR-014). Today, information about one person is spread across separate tabs. This change gives a Supervisor a path from a milestone's results to an employee's detail view: what the employee is on now, and what they earned on past milestones. The employee gets the same project-grouped history on `/my-bonuses`.

## Starting Point

S-05 stores every Approved result as a frozen snapshot (`milestone_result_lines`, with display names), already protected by RLS:

- The owning Supervisor and Admin read every line.
- An Employee reads only their own lines of approved milestones.

`/my-bonuses` lists an employee's own lines as a flat table. There is no employee detail page, and employee names in the payout table and the `/employees` list are plain text.

## Desired End State

**Supervisor and Admin.** Clicking an employee's name in a milestone's payout table (Draft or Approved), or in `/employees`, opens `/employees/<id>`, which shows:

- a header;
- current open assignments, with time share but no Draft figures;
- Approved bonuses grouped by project, with subtotals and a total.

A Supervisor sees only their own milestones; an Admin sees all.

**Employee.** `/my-bonuses` shows the same grouped history and takes no IDs. An Employee gets 403 on `/employees/<id>`.

## Key Decisions Made

| Decision         | Choice                                                                                                | Why (1 sentence)                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Supervisor scope | History only from milestones the Supervisor owns; Admin sees all; no hint of other history            | Matches existing RLS, so there's no migration and no new place where pay could leak between supervisors |
| History contents | Approved results, plus a separate "Current assignments" list for Supervisor/Admin                     | Answers "what are they on now and what did they earn" without mixing in changeable Draft figures        |
| Draft figures    | Not shown on the detail page                                                                          | Avoids a live payout RPC per milestone and keeps final and changeable figures apart                     |
| `/my-bonuses`    | Same URL, grouped by project with subtotals and a total, via a shared component                       | One rendering for both roles; still ID-free, keeping the "no employee URL takes an ID" property         |
| Ordering         | Projects by most recent approval, newest first; milestones by end date, newest first                  | The newest bonus is always at the top                                                                   |
| Entry points     | Name links in the payout table (Draft and Approved) and in the `/employees` list                      | Meets FR-013 and gives a second natural path at minimal cost                                            |
| Not found        | Invalid, missing or RLS-hidden id → HTTP 200 "Employee not found."                                    | Same pattern as `/projects/[id]`; doesn't reveal whether an id exists                                   |
| Testing          | Unit + mutation on the grouping helper, `rls_matrix` scope cells, smoke IDOR cells, updated US-01 e2e | Pins the scope at the database and the new route at HTTP, per test-plan §6.1/§6.3                       |

## Scope

**In scope:**

- Grouping helper and service reads.
- Shared `EmployeeHistory` component.
- `/my-bonuses` regrouped.
- `/employees/[id]`.
- Name links.
- Kitchen-sink states.
- Route-access rows, `rls_matrix` cells, smoke cells, US-01 locator update.
- Test-plan notes.

**Out of scope:**

- RLS, view or function changes, and migrations.
- Cross-supervisor history.
- Draft figures on the detail page.
- Editing on the detail page.
- Links from other sections.
- `/employees` token migration.
- A drill-down e2e.
- S-07 report.

## Architecture / Approach

Pages call thin service reads with the user's Supabase client, so RLS decides what each role sees. A pure `groupHistory()` turns snapshot lines into ordered project groups, summing in integer grosze. `EmployeeHistory.astro` renders the result on both `/my-bonuses` and `/employees/[id]`. Current assignments come from `milestone_engagements` with the same "open" rule as `employee_time_share_totals`.

## Phases at a Glance

| Phase                         | What it delivers                                                            | Key risk                                                           |
| ----------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1. History model and services | `groupHistory` + tests, detail/history/assignment reads, types              | Off-by-a-grosz totals; grouping by name merging two projects       |
| 2. `/my-bonuses` grouped      | Shared component, regrouped page, US-01 locators moved to project group     | US-01's Draft absence check passing vacuously after the regroup    |
| 3. Detail page and links      | `/employees/[id]`, name links, kitchen sink, route-access rows              | Not-found state leaking existence; unmigrated `/employees` styling |
| 4. Boundary tests and docs    | `rls_matrix` scope cells (incl. reassignment), smoke cells, test-plan notes | Cells derived from the policy instead of the decided matrix        |

**Prerequisites:** S-05 merged (it is), local Supabase (Docker), `.dev.vars` with the `E2E_*` seed accounts.
**Estimated effort:** ~2–3 sessions across 4 phases. Phases 1 and 4 are small.

## Open Risks & Assumptions

- **Partial history for Supervisors.** A Supervisor sees a partial history for employees shared with other Supervisors, and nothing tells them so. This was accepted to keep pay data within its owner.
- **Reassignment.** After a project reassignment, its history moves to the new owner, as already pinned (F3).
- **Group names.** Snapshot names are frozen per approval, so a renamed project's group shows its most recently approved name.

## Success Criteria (Summary)

- A Supervisor reaches an employee's detail from any payout row and sees current work plus Approved bonuses from their own milestones, totalled per project.
- An Employee sees their own grouped history and is refused every `/employees/<id>`, while pgTAP and smoke prove neither role crosses its boundary.
