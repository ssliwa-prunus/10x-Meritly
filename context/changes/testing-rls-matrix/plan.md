# Data Isolation & RLS Matrix Implementation Plan

## Overview

Rollout Phase 1 of `context/foundation/test-plan.md` (risks #1 and #2). This plan:

- closes the two RLS holes research found (F1: Supervisors read every profile; F2: TRUNCATE/REFERENCES/TRIGGER still granted to `authenticated` on three tables);
- adds one pgTAP suite that walks the full role × table × operation matrix with real attackers: two activated employees and a second Supervisor;
- adds a catalog guard so a future migration cannot add a table, policy, grant or definer function without someone classifying it.

## Current State Analysis

From `context/changes/testing-rls-matrix/research.md`:

- **No current leak of bonus figures.**
  - Employees have exactly two select policies: `profiles_select_own` and `milestone_result_lines_select_employee`.
  - The result-lines policy requires `employee_id = current_employee_id()` and an approved parent milestone (`supabase/migrations/20261005120000_milestone_approval.sql:210-216`).
  - Draft figures are never stored.
  - Both views use `security_invoker` (`…approval.sql:569,591`).
- **The app is not the boundary.**
  - Every read uses the public key under the user's session (`src/lib/supabase.ts:3,6-20`).
  - An employee can call PostgREST directly, so pgTAP tests the real attack surface. It sets `role authenticated` and `request.jwt.claims`, the same path PostgREST uses.
- **Existing tests are weaker than they look.**
  - Most "employee sees nothing" checks use a user with no `employees` row (`projects_rls.test.sql:358-367`, `employees_rls.test.sql:415-428`, `milestone_payouts.test.sql:466-477`).
  - The only activated employee (E1) is in `milestone_approval.test.sql:628-707`.
  - No second activated employee ever attacks.
- **Untested out-of-scope cells**, listed in research §4:
  - B updating or deleting A's milestones;
  - B deleting A's employees;
  - B updating or deleting A's engagements from B's side;
  - B on `employee_time_share_totals`;
  - the snapshot visibility after a reassignment;
  - every employee write.
- **F1.** `profiles_select_supervisor` is `using (is_supervisor())`, unscoped (`20260925120000_role_and_rls_scaffold.sql:104-108`). The app never uses it:
  - Supervisors read only their own profile (`src/middleware.ts:45-49`);
  - `listSupervisors` runs for Admins only (`src/pages/projects/index.astro:33`, `src/pages/employees/index.astro:45`);
  - the other in-database profile reads are security-definer triggers (`…projects_and_milestones.sql:147`, `…employees_and_engagements.sql:184`, `…approval.sql:424`).
- **F2.** `profiles`, `job_roles` and `bonus_settings` revoke from `anon` only (`…scaffold.sql:22`, `…bonus_rules_config.sql:34,80`), unlike `projects`/`milestones` (`…projects_and_milestones.sql:62,94`).
- **Existing structural guard.** It checks that every public table has RLS and every public view has `security_invoker` (`supabase/tests/profiles_rls.test.sql:180-205`).

## Desired End State

- No Supervisor can read another user's profile except their own. No API role holds TRUNCATE, REFERENCES or TRIGGER on any public table.
- `supabase/tests/rls_matrix.test.sql` asserts every cell of the decided matrix below with real attackers. A wrong policy fails a named assertion. A test that "passes because the attacker isn't linked" is impossible because every employee attacker is linked and activated.
- `supabase/tests/rls_catalog_guard.test.sql` fails when a migration adds or renames a public table, policy, `ALL` policy, risky grant, or authenticated-callable security-definer function that the guard does not list.
- `test-plan.md` §2/§3 carry the research corrections and §6.1 is the cookbook for adding an RLS test.
- Verify: `npx supabase db reset && npx supabase test db` passes locally, and CI's `Run RLS tests` step passes.

### Key Discoveries:

- Denial shapes: an RLS-denied insert raises `42501`; an RLS-denied update or delete affects 0 rows (`context/archive/2026-09-27-supervisor-creates-project-and-milestones/plan.md:62`). Guard triggers raise `42501` before business codes (`20260927130000_milestones_guard_ownership.sql`).
- Harness pattern to copy:
  - `begin; … plan(N) … finish(); rollback;`;
  - users inserted into `auth.users` as owner;
  - roles set with `update public.profiles`;
  - identities switched with `set local role authenticated; set local request.jwt.claims = '{"sub":"…"}'` (`profiles_rls.test.sql:63-64`).
  - Claims persist across `reset role`, so clear them explicitly (`milestone_approval.test.sql:545-548`).
- Approved-milestone fixture recipe (scores, engagements, bonus settings pinned, `approve_milestone` as owner): `milestone_approval.test.sql:57-70,132-345`.
- Injected Draft snapshot recipe (owner inserts a header and line for a non-approved milestone): `milestone_approval.test.sql:671-694`.
- Visibility after reassignment follows the current project owner (`owns_milestone`, `…employees_and_engagements.sql:110-127`). MR012 treats approved milestones as closed (`…approval.sql:539-562`), so reassigning a project whose only milestone is approved is allowed.

## What We're NOT Doing

- No HTTP-level IDOR check. It moves to test-plan Phase 3 (route gating), where `scripts/smoke.mjs` is extended anyway. Research §6: `/my-bonuses` takes no ID, and foreign IDs return HTTP 200 with a "not found" body.
- No change to `is_approved_milestone` (F4 accepted: it returns only a boolean, and UUIDs are unguessable). It is listed in the guard's allowlist with a comment.
- No change to reassignment visibility (F3 decided: the new owner sees the approved history and the old owner loses it). It is pinned by a test, not changed.
- No rewrite of the six per-feature suites. They stay as they are, except the two `profiles_rls` assertions F1 invalidates.
- No Edge Function, Mailpit or `notified_at` tests (Phase 3, risk #5).
- No payout-formula or approval-freeze tests (Phase 2, risks #3/#4/#7).
- No CI YAML change. `supabase test db` already runs every file in `supabase/tests/` (`.github/workflows/ci.yml:44-45`).
- No change to the CI trigger branches (`master` only). That is outside this phase.

## Implementation Approach

Fix first, then test. The migration lands before the matrix, so the matrix's expected values come from the decided behaviour below (PRD visibility rule `context/foundation/prd.md:129`, PRD:160, FR-018, decisions F1–F4), never from reading the current policies. The matrix and the guard are complementary:

- the **matrix** proves behaviour per actor;
- the **guard** proves the policy surface has not changed underneath it. A new migration that adds a policy turns the guard red until someone updates both files on purpose.

### Decided matrix (the oracle)

Actors:

- **anon**;
- **U**: employee-role user with no `employees` row;
- **E1, E2**: activated employees owned by SA, both engaged on SA's milestones;
- **EB**: an employee owned by SB;
- **SA, SB**: supervisors;
- **AD**: admin.

Fixtures:

- **PA** (owner SA) with **MA_appr** (approved; E1 and E2 engaged) and **MA_draft** (active, KPI-scored; E1 and E2 engaged; plus an owner-injected Draft header and E1 line);
- **PB** (owner SB) with **MB** (active) and EB engaged;
- **PR** (owner SA) with **MR_appr** (approved, E1 engaged), used for the reassignment check.

"none" means the select returns 0 rows. "deny" means insert raises `42501`, or update/delete affects 0 rows followed by an owner-side check that the row is unchanged.

| Surface                                          | SA (owner)                                 | SB (foreign)                       | E1 / E2 (activated)                                                                                                  | U            | AD                                           |
| ------------------------------------------------ | ------------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------- |
| `profiles` select                                | own row only; **none** for SB, E1, AD (F1) | own row only                       | own row only                                                                                                         | own row only | all                                          |
| `profiles` insert/delete                         | deny                                       | deny                               | deny                                                                                                                 | deny         | deny                                         |
| `profiles` update                                | deny (incl. own role)                      | deny                               | deny                                                                                                                 | deny         | allow                                        |
| `job_roles`, `bonus_settings` select             | all                                        | all                                | none                                                                                                                 | none         | all                                          |
| `job_roles`/`bonus_settings` writes              | deny                                       | deny                               | deny                                                                                                                 | deny         | insert `job_roles`, update both; delete deny |
| `projects` PA                                    | sel/upd allow; delete deny                 | sel none; upd/del deny             | none; ins/upd/del deny                                                                                               | none         | sel/upd allow; delete deny                   |
| `milestones` of PA                               | sel/ins/upd allow; delete deny             | sel none; ins/upd/del deny         | none; ins/upd/del deny                                                                                               | none         | select only; ins/upd deny                    |
| `employees` (A's)                                | sel/ins/upd allow; delete deny             | sel none; upd/del deny             | none, **including own row**; upd/del deny                                                                            | none         | sel/ins/upd allow                            |
| `milestone_engagements` on PA                    | all four allow (not on MA_appr: MR007)     | sel none; ins/upd/del deny         | none; ins/upd/del deny                                                                                               | none         | select only                                  |
| `milestone_results`                              | PA rows                                    | none                               | **none** (privacy split)                                                                                             | none         | all                                          |
| `milestone_result_lines`                         | PA rows                                    | none                               | E1: exactly own MA_appr line; **not** E2's line queried by id; **not** the MA_draft line; E2 symmetric; upd/del deny | none         | all                                          |
| `project_budget_exposure`                        | PA row                                     | no PA row                          | none                                                                                                                 | none         | all                                          |
| `employee_time_share_totals`                     | A's employees                              | none for A's employees             | none                                                                                                                 | none         | all                                          |
| `milestone_payout_summary` / `_lines` (MA_draft) | rows                                       | none                               | none                                                                                                                 | none         | rows                                         |
| `kpi_multiplier` (MA_draft)                      | value                                      | null                               | null                                                                                                                 | null         | value                                        |
| `approve_milestone` (MA_draft)                   | (not called)                               | `42501`                            | `42501`                                                                                                              | `42501`      | `42501`                                      |
| `is_approved_milestone` (MB)                     | boolean                                    | boolean                            | boolean (F4, accepted)                                                                                               | boolean      | boolean                                      |
| After AD reassigns PR to SB                      | MR_appr results and lines: **none**        | MR_appr results and lines: visible | E1 still sees own MR_appr line                                                                                       | none         | all                                          |
| anon, any table/view                             | —                                          | —                                  | —                                                                                                                    | —            | select none / insert `42501`                 |

## Phase 1: Tighten the RLS surface

### Overview

Apply decisions F1 and F2 in one migration, and update the two existing assertions that encoded the old Supervisor-reads-all behaviour.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20261007120000_rls_tighten_profiles_and_grants.sql`

**Intent**: Drop the unscoped Supervisor profile read (Supervisors keep their own row through `profiles_select_own`). Revoke the privileges that bypass or sidestep RLS from `authenticated` on the three tables that still hold them, matching `projects`/`milestones`. The header comment states F1 and F2 and why no app path is affected.

**Contract**: `drop policy profiles_select_supervisor on public.profiles`; `revoke truncate, references, trigger on public.profiles, public.job_roles, public.bonus_settings from authenticated`. No other policy, function or table changes.

#### 2. Existing profiles suite

**File**: `supabase/tests/profiles_rls.test.sql`

**Intent**: Flip "supervisor sees all profiles" (`:104-108`) into "supervisor sees exactly their own profile". Make "target role is unchanged after the supervisor attempt" (`:119-123`) read the target row in owner context (`reset role` and clear claims, then switch back), because the Supervisor can no longer see it. Adjust `plan(N)` if the count changes.

**Contract**: The assertion descriptions say the new behaviour. Every other assertion in the file is untouched.

#### 3. Seed header

**File**: `supabase/seed.sql`

**Intent**: The fixture-range comment lists ranges only up to `…05xx`. Add `…06xx` (approval) and `…07xx` (RLS matrix) so the next suite picks a free range.

**Contract**: Comment lines only.

### Success Criteria:

#### Automated Verification:

- Migration applies on a clean database: `npx supabase db reset`
- All existing pgTAP suites pass, including the updated `profiles_rls`: `npx supabase test db`
- Type check and build unaffected: `npx astro check`

#### Manual Verification:

- Signed in as `supervisor@meritly.local`: `/projects` and `/employees` render as before, and the header shows the Supervisor's own name
- Signed in as `admin@meritly.local`: the owner select on `/projects` still lists both Supervisors

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Behavioural matrix suite

### Overview

One new pgTAP file asserts every row of the decided matrix with linked, activated attackers. Expected values come only from the matrix table above.

### Changes Required:

#### 1. Matrix suite

**File**: `supabase/tests/rls_matrix.test.sql`

**Intent**: Build the fixtures in the `…07xx` range and walk the actors in sections (anon, U, E1, E2, SB, SA, AD, reassignment). Each section asserts every surface in its matrix column. Each test group below states what it guards:

- **Employee isolation (risk #1).**
  - Assert: E1 and E2 each see exactly their own MA_appr line, cannot see the other's line when querying by the other's `employee_id` or line `id`, see nothing for MA_draft (with a stored injected line present, so the empty result is not trivial), and get none from both views, the payout RPCs, `milestone_results`, `employees` (own row included) and `milestone_engagements`.
  - Regression caught: a policy keyed only on `employee_id`, or one that drops the `approved` condition.
  - Boundary: a linked but unactivated account is already covered (`milestone_approval.test.sql:657-666`); this suite adds the second activated employee.
  - Anti-pattern avoided: an unlinked attacker that sees nothing for the wrong reason.
- **Employee writes (risk #1/#2).**
  - Assert: E1 cannot update or delete their own result line, cannot update or delete their own `employees` row (including `profile_id`), and cannot insert, update or delete engagements, projects or milestones, nor score KPIs.
  - Regression caught: a future write policy granted to `authenticated` without a role predicate.
- **Foreign Supervisor (risk #2).**
  - Assert: SB gets none or deny on every PA surface in the matrix, including the cells research §4 found untested: update/delete of A's milestones, delete of A's employees, update/delete of A's engagements, and `employee_time_share_totals` for A's employees. SB cannot read E1's or SA's profile (F1).
  - Edge: each denied update/delete is followed by an owner-side check that the row is unchanged, so "0 rows" cannot hide a wrong-row write.
  - Anti-pattern avoided: asserting only what each policy author intended.
- **Owner and Admin positives.**
  - Assert: SA and AD can do exactly the "allow" cells.
  - Why: a matrix of denials alone passes on a database that denies everything, so the positives prove the fixtures are reachable.
- **Reassignment (F3).**
  - Assert: after AD reassigns PR to SB, SB sees MR_appr's results and lines, SA sees none, and E1 still sees their own MR_appr line.
  - Regression caught: an owner-change path that leaks history to both owners or hides it from the employee.
- **`is_approved_milestone` (F4).**
  - Assert: called by E1 for MB, it returns a boolean and nothing else.
  - The comment records the decision as an accepted exposure.

**Contract**: The file follows the harness conventions above and uses the `…07xx` UUID range and `@pgtap.test` emails. Counts are scoped to fixture IDs. Assertion descriptions name the actor, surface and expected outcome (e.g. `'SB deleting A''s employee affects 0 rows'`). There is no shared helper extension.

### Success Criteria:

#### Automated Verification:

- The matrix suite passes: `npx supabase test db`
- Mutation check: removing the approved condition from the employee result-lines policy fails the MA_draft assertion; reverted (use a scratch migration that recreates the policy without `and public.is_approved_milestone(milestone_id)`, run, then delete it and `db reset`)
- Mutation check: recreating `profiles_select_supervisor` fails the SB-reads-profiles assertion; reverted

#### Manual Verification:

- Reviewer confirms every decided-matrix row has an assertion and no expected value was copied from a policy body

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: Catalog guard

### Overview

A catalog-level pgTAP file that fails when the policy surface changes without a matching update. It extends the intent of the existing structural guard (`profiles_rls.test.sql:180-205`), which stays where it is.

### Changes Required:

#### 1. Guard suite

**File**: `supabase/tests/rls_catalog_guard.test.sql`

**Intent**: The `pg_catalog` / `pg_policies` checks run as owner, with no fixtures. Each check fails with a message that says what to update: this file and `rls_matrix.test.sql`.

**Contract**: The suite asserts:

- **Table set**: the set of tables in `public` equals the 9 known tables. A new table must be classified on purpose.
- **Policy inventory**: the set of `(tablename, policyname, cmd)` in `pg_policies` for schema `public` equals the expected list. That is research §1 minus `profiles_select_supervisor`.
- **No broad policies**: no policy has `cmd = 'ALL'`, and every policy's `roles` is exactly `{authenticated}`.
- **Grant hygiene**: for every public table, `anon` holds no privilege, and `authenticated` holds none of TRUNCATE, REFERENCES or TRIGGER. This is F2's regression test.
- **Definer allowlist**: the set of `public` functions that are `security definer` and executable by `authenticated` equals `current_app_role`, `is_admin`, `is_supervisor`, `owns_project`, `owns_milestone`, `employee_engaged_on_own_milestone`, `current_employee_id`, `is_approved_milestone` (comment: F4 accepted) and `approve_milestone`.
- **Search path**: every `security definer` function in `public` has a `search_path` setting in `proconfig`.

### Success Criteria:

#### Automated Verification:

- The guard suite passes: `npx supabase test db`
- Mutation check: a dummy `for all` policy or new public table fails the guard with a naming message; reverted

#### Manual Verification:

- Reviewer confirms the guard's expected policy list matches the decided matrix

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 4.

---

## Phase 4: Test-plan backport and cookbook

### Overview

Record what research and this phase changed in the quality contract, so the next RLS change follows the pattern.

### Changes Required:

#### 1. Test plan

**File**: `context/foundation/test-plan.md`

**Intent**: Backport the research corrections (no file anchors, per test-plan §1 principle #3):

- §2 Risk Response Guidance #1: replace "403 / 404" with the observed outcomes (zero rows at the database; 403 or a 200 "not found" page over HTTP), and add the unlinked-attacker anti-pattern;
- §2 #2: add the catalog guard as the mechanism;
- §3 Phase 1 test types: "pgTAP matrix + catalog guard";
- §3 Phase 3 test types: add "HTTP IDOR check (moved from Phase 1)";
- §5 pgTAP row: name the matrix and the guard.

Fill §6.1 with the cookbook: where the files live, the `…07xx` range, the actor cast, the denial shapes, the "update both files when you add a table, policy or definer function" rule, and the run command. Add a §6.6 note for Phase 1. Leave the §3 Status cell to `/10x-test-plan` reconciliation.

**Contract**: Sections §2, §3, §5, §6.1 and §6.6 only. The §3 Status vocabulary is unchanged.

#### 2. Project rules

**File**: `CLAUDE.md`

**Intent**: Add one bullet under "RLS rules for this project": a migration that adds a table, policy, grant or definer function must update `supabase/tests/rls_catalog_guard.test.sql` and `supabase/tests/rls_matrix.test.sql` (see test-plan §6.1).

**Contract**: One added bullet; nothing else changes.

### Success Criteria:

#### Automated Verification:

- Markdown formatting passes: `npx prettier --check context/foundation/test-plan.md CLAUDE.md`
- Full suite still green: `npx supabase test db`

#### Manual Verification:

- §6.1 reads as a standalone how-to for adding a test for a new table

**Implementation Note**: The last phase. Run `/10x-test-plan` afterwards to reconcile §3 status.

---

## Testing Strategy

### Unit Tests:

- Not applicable. All guarantees live in Postgres, so pgTAP is the unit layer.

### Integration Tests:

- `rls_matrix.test.sql`: behavioural, per actor, against real policies under `request.jwt.claims` (the PostgREST path).
- `rls_catalog_guard.test.sql`: structural, catches surface drift that no behavioural test was written for.
- Mutation checks in Phases 2 and 3 prove both suites can fail for the right reason.

### Manual Testing Steps:

1. Sign in as each seed account and confirm the pages render as before (Phase 1).
2. Read the matrix suite against the decided-matrix table (Phase 2).
3. Read §6.1 cold (Phase 4).

## Migration Notes

- `20261007120000_rls_tighten_profiles_and_grants.sql` is forward-only. Rollback means a new migration recreating the policy and grants. No data changes.
- Hosted project: the migration applies through the normal deploy path. No app code reads profiles through the dropped policy.

## References

- Research: `context/changes/testing-rls-matrix/research.md`
- Test plan: `context/foundation/test-plan.md` §2 (risks #1, #2), §3 Phase 1
- Harness pattern: `supabase/tests/profiles_rls.test.sql:63-64,180-205`, `supabase/tests/milestone_approval.test.sql:57-70,545-548,628-707`
- Policies: `supabase/migrations/20260925120000_role_and_rls_scaffold.sql:98-121`, `supabase/migrations/20261005120000_milestone_approval.sql:168-216`
- PRD visibility rule: `context/foundation/prd.md:129,160`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Tighten the RLS surface

#### Automated

- [x] 1.1 Migration applies on a clean database: `npx supabase db reset` — 2508b90
- [x] 1.2 All existing pgTAP suites pass, including the updated `profiles_rls`: `npx supabase test db` — 2508b90
- [x] 1.3 Type check and build unaffected: `npx astro check` — 2508b90

#### Manual

- [x] 1.4 Signed in as `supervisor@meritly.local`: `/projects` and `/employees` render as before, and the header shows the Supervisor's own name — 2508b90
- [x] 1.5 Signed in as `admin@meritly.local`: the owner select on `/projects` still lists both Supervisors — 2508b90

### Phase 2: Behavioural matrix suite

#### Automated

- [x] 2.1 The matrix suite passes: `npx supabase test db` — 5182571
- [x] 2.2 Mutation check: removing the approved condition from the employee result-lines policy fails the MA_draft assertion; reverted — 5182571
- [x] 2.3 Mutation check: recreating `profiles_select_supervisor` fails the SB-reads-profiles assertion; reverted — 5182571

#### Manual

- [x] 2.4 Reviewer confirms every decided-matrix row has an assertion and no expected value was copied from a policy body — 5182571

### Phase 3: Catalog guard

#### Automated

- [x] 3.1 The guard suite passes: `npx supabase test db`
- [x] 3.2 Mutation check: a dummy `for all` policy or new public table fails the guard with a naming message; reverted

#### Manual

- [x] 3.3 Reviewer confirms the guard's expected policy list matches the decided matrix

### Phase 4: Test-plan backport and cookbook

#### Automated

- [ ] 4.1 Markdown formatting passes: `npx prettier --check context/foundation/test-plan.md CLAUDE.md`
- [ ] 4.2 Full suite still green: `npx supabase test db`

#### Manual

- [ ] 4.3 §6.1 reads as a standalone how-to for adding a test for a new table
