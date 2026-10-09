# Payout Correctness & Approval Freeze Implementation Plan

## Overview

Rollout Phase 2 of `context/foundation/test-plan.md`, covering risks #3 (payout ceilings), #4 (approval freeze) and #7 (supervisor flags). This plan:

- adds one pgTAP suite, `supabase/tests/payout_correctness.test.sql`, that fills the coverage gaps research listed. Every expected value is worked out by hand in integer grosze from the PRD formula;
- closes two gaps research found, each with a small migration:
  - the live payout RPCs recompute Approved milestones from the current config, so the freeze holds only because pages check the status first. The RPCs will now refuse Approved milestones;
  - the >100 % time-share flag counts engagements in cancelled or completed projects. They will now be excluded;
- moves the Vitest bootstrap to rollout Phase 3, because none of this logic lives in TS, and writes the §6.2 cookbook entry.

## Current State Analysis

From `context/changes/testing-payout-correctness/research.md`:

- **All payout and flag arithmetic is in SQL**:
  - `kpi_multiplier` (`supabase/migrations/20261004120000_milestone_kpi_and_payouts.sql:105-128`);
  - `capped_payout_pool`, `milestone_payout_lines`, `milestone_payout_summary` (`supabase/migrations/20261004130000_milestone_payout_hard_cap.sql:28-222`);
  - the views `employee_time_share_totals` and `project_budget_exposure` (`supabase/migrations/20261005120000_milestone_approval.sql:568-616`).
  - TS does no money arithmetic (`src/lib/services/payouts.ts:112-114`). pgTAP is the cheapest layer that gives a real signal.
- **Coverage already exists**, so this phase fills gaps rather than starting from scratch:
  - `milestone_payouts.test.sql` (plan 55) covers the worked example, M at min and max, "different KPI scores → different totals", equal-weight rounding and score-range rejection.
  - `milestone_approval.test.sql` (plan 71) covers snapshot = live output just before approval, the freeze after config edits (hand literals), MR015/MR007 and the snapshot CHECKs.
- **Gaps for #3:**
  - a single employee gets the whole pool;
  - pools near the `numeric(12,2)` ceiling;
  - non-default config in a Draft milestone;
  - extreme weights and factors where a bonus floors to 0.00;
  - a residual near n−1 grosze;
  - a Σ ≤ pool ≤ target check across varied inputs.
- **Gaps for #4:**
  - no test shows a Draft milestone picking up a new config;
  - the live RPCs called on an Approved id recompute from the current config. They are granted to `authenticated` and have no status check (CAP:48-222). Only the owner and Admin can reach them, through PostgREST; no page calls them for Approved milestones (`src/pages/projects/[id]/milestones/[milestoneId].astro:87,104`);
  - updating only the rating on an Approved engagement is untested.
- **Gaps for #7:**
  - no test checks `over_budget` across a mix of Approved and non-Approved milestones near the boundary;
  - no test shows approval flipping the budget flag;
  - no test shows a `completed` milestone reserving its target or a cancelled milestone being excluded;
  - closed-project behaviour of both flags is unpinned;
  - a time share of exactly 1.01 is untested;
  - engagements in a cancelled project are still counted (fixture `…0446` exists in `employees_rls.test.sql`, but nothing asserts on it).
- **The §6.1 harness applies unchanged:**
  - wrap each suite in `begin; plan(N); … finish(); rollback;`;
  - switch identity with `set local role authenticated; set local request.jwt.claims`;
  - clear the claims after `reset role`;
  - use `@pgtap.test` emails;
  - keep fixtures in their own UUID range (`…08xx` is next free per `supabase/seed.sql:16-18`).

## Desired End State

- `supabase/tests/payout_correctness.test.sql` passes. Each of its assertions compares against a hand literal that is derived in a comment from the PRD formula, never from the function under test.
- `milestone_payout_lines` and `milestone_payout_summary` raise `MR015` for an Approved milestone the caller can see, and still return zero rows for one the caller cannot see. `approve_milestone` still produces the same snapshot.
- `employee_time_share_totals` counts only engagements on `planned`/`active` milestones whose project is not `completed` or `cancelled`.
- `rls_matrix.test.sql` has cells for both behaviour changes, one per actor. `rls_catalog_guard.test.sql` is unchanged and still passes.
- `test-plan.md`:
  - §3/§4/§5 move the Vitest bootstrap and its gate to Phase 3;
  - §6.2 is a working recipe;
  - §6.1 states the body-only clarification;
  - §6.6 has the Phase 2 notes.
- Verify: `npx supabase db reset --local && npx supabase test db` passes locally; CI's `smoke` job passes.

### Key Discoveries:

- `approve_milestone` reads `milestone_payout_lines` (APR:352-354) **before** it sets `status = 'approved'` (APR:389-391). A status check inside the lines function therefore does not affect approval.
- `milestone_payout_lines` returns early when the milestone row is not visible (CAP:80-82). The new status check must come **after** that lookup, so callers who cannot see the milestone still get zero rows and learn nothing about its status.
- `milestone_payout_summary` is `language sql` and always calls `milestone_payout_lines(m.id)` in a lateral join (CAP:213-216), so an exception from the lines function reaches its callers too. The test pins both functions regardless.
- MR015 already means "milestone is approved/frozen" (`milestones_check_frozen`, APR:252-255; `approve_milestone`, APR:301-304). Reusing it needs no new error mapping.
- Project status values: `planned | active | completed | cancelled` (`supabase/migrations/20260927120000_projects_and_milestones.sql:51`). Cancelling a project that still has an active milestone is allowed: `employees_rls.test.sql:25-37` does exactly that for `…0425`.
- Existing time-share assertions (`employees_rls.test.sql:378-389`, `milestone_approval.test.sql:274,535`) do not involve closed-project engagements, so the view fix does not change them.
- No existing test calls the live RPCs on an Approved milestone (they are called on `…0621` only before it is approved, `milestone_approval.test.sql:133-136`), so the hardening breaks no current assertion.
- Matrix fixtures to reuse for the new cells: `…0721` MA_appr (approved, SA's) and `…0722` MA_draft (`rls_matrix.test.sql:37-44`).
- Oracles must use integer grosze: a floating-point recompute can disagree by a grosz. The values in this plan were derived by hand and checked with an independent BigInt calculation during planning, never by calling the SQL.

## What We're NOT Doing

- **No Vitest in this phase.** The bootstrap moves to rollout Phase 3, together with the TS route-gating logic (`middleware.ts`, `safe-next.ts`) it will protect. The TS-only "at most 2 decimals" rule in `src/lib/forms.ts` stays untested until then; the DB's `numeric(p,2)` columns and CHECKs still enforce the limits.
- **No change to `project_budget_exposure`.** It keeps ignoring project status, so a completed or cancelled project still shows its exposure. That is treated as intended and pinned by a test.
- **No rewrite of existing suites.** `milestone_payouts.test.sql`, `milestone_approval.test.sql`, `projects_rls.test.sql` and `employees_rls.test.sql` are not edited. Only `rls_matrix.test.sql` gets new cells, and its `plan(N)` is updated.
- **No catalog guard edit.** Both fixes keep the catalog the same shape: same names, columns, `security_invoker`, invoker functions and grants.
- **No UI copy change.** `src/components/projects/BudgetExposurePanel.astro:35-36` omits the Approved rule in its explanatory text; that is display text and out of scope.
- **No concurrency tests** (approval racing a config or engagement write). pgTAP runs in one transaction and cannot exercise it cheaply; the `for update` lock and the single-statement snapshot are the existing mitigation.
- **No change to the page's error mapping.** If a milestone is approved between the page reading its status and calling the RPC, the page now gets MR015 and shows its generic load error. That is acceptable: reloading the page shows the snapshot.
- **No CI YAML change.** `supabase test db` already runs every file in `supabase/tests/`.
- No route gating, email or e2e work (Phases 3–4).

## Implementation Approach

One new suite grows across Phases 1–3, one section per risk. Phases 2 and 3 each start with a red assertion: the test describing the decided behaviour fails against the current schema, then the migration turns it green. Every phase ends with a mutation check (§6.1 "Prove it can fail") so each new block is shown to fail for the right reason. Phase 4 writes back to the test plan.

Fixture layout in `…08xx` (the implementer may refine it, but it must stay inside the range and be listed in the suite header):

- `…0801` Supervisor SP, `…0802` Admin AP, `…0803` second Supervisor SQ.
- `…081x` projects, `…082x` milestones, `…083x` employees, `…084x` engagements, `…085x` job roles.

**Bonus settings:** the singleton is set explicitly, as the owner, at the top of each block. The oracle must never depend on the seeded defaults.

## Phase 1: Payout ceilings and boundary cases (risk #3)

### Overview

Create the suite and its fixture range, then add the #3 boundary cases with hand oracles. No migration in this phase.

### Changes Required:

#### 1. Fixture range registry

**File**: `supabase/seed.sql`

**Intent**: Register `…08xx` as the payout-correctness suite range so later suites don't collide with it.

**Contract**: Extend the comment at `supabase/seed.sql:16-18` with `...08xx (payout correctness)`. Comment only, no data.

#### 2. New suite skeleton and #3 block

**File**: `supabase/tests/payout_correctness.test.sql` (new)

**Intent**: Prove Σ bonus ≤ payout pool ≤ target pool and exact grosz flooring on the boundary cases the existing suite lacks, with expected values derived by hand from PRD Business Logic (`context/foundation/prd.md:134-150`) and the linear KPI → M mapping.

**Contract**:

- Header comment:
  - what the suite covers;
  - the fixture map;
  - the oracle rule (M = min + (Σ wₖ·Sₖ)·0.01·(max−min); pool = floor₀.₀₁(target·M/max); bonusᵢ = floor₀.₀₁(pool·eᵢ/Σe) with eᵢ = time_share·role_weight·rating_factor);
  - the run command.
- Harness per §6.1. The config is set as the owner before switching to SP. All calls go through `milestone_payout_lines` / `milestone_payout_summary` as SP, and `capped_payout_pool` where noted.
- Config C1 for this block: KPI weights 0.25 each, multiplier_min 0.50, multiplier_max 2.00. Rating factors are set per case.

The cases below are written as inputs → hand oracle. Each one is asserted with `results_eq`/`is` against literals:

| Case                          | Inputs                                                                                                                                                                    | Oracle                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Single employee               | target 10 000.00; scores 50/50/50/50 (M = 1.25); one engagement                                                                                                           | pool 6 250.00; bonus 6 250.00; total 6 250.00; residual 0.00; `within_pool` true |
| Large pool, M = min           | target 9 999 999 999.99; scores 0/0/0/0 (M = 0.50); 3 identical engagements                                                                                               | pool 2 499 999 999.99; bonuses 833 333 333.33 ×3; residual 0.00                  |
| Large pool, M = max           | target 9 999 999 999.99; scores 100 ×4 (M = 2.00); 7 identical engagements                                                                                                | pool = target = 9 999 999 999.99; bonuses 1 428 571 428.57 ×7; residual 0.00     |
| Residual n−1                  | target 0.13; scores 100 ×4; 7 identical engagements                                                                                                                       | pool 0.13; bonuses 0.01 ×7; total 0.07; residual 0.06                            |
| Floor to zero                 | target 100.00; scores 100 ×4; E_hi time 1.00, role weight 3.00, factor 3.00 (rating 5); E_lo time 0.01, role weight 0.01, factor 0.01 (rating 1)                          | pool 100.00; E_hi 99.99; E_lo 0.00; residual 0.01                                |
| Non-default config in a Draft | config C1′: KPI weights 0.40/0.30/0.20/0.10, min 0.50, max 2.00; scores 100/50/0/0 (M = 1.325); target 10 000.00; two engagements, identical except factors 1.00 and 1.50 | pool 6 625.00; bonuses 2 650.00 / 3 975.00; residual 0.00                        |

- **Snapshot accepts a 0.00 bonus:** approve the "Floor to zero" milestone as SP. Assert that the snapshot line for E_lo has `bonus = 0.00` and the header CHECKs hold: payout_total 99.99, residual 0.01.
- **Property check:** one assertion over every milestone in this block. For each one, Σ line bonus ≤ summary `payout_pool` ≤ `target_pool`, and summary `payout_total` = Σ line bonus. This is the generic guard; the table rows above are the exact oracles.

### Success Criteria:

#### Automated Verification:

- `npx supabase db reset --local && npx supabase test db` passes, including `payout_correctness.test.sql`
- `plan(N)` in the new suite equals the number of assertions it runs (pgTAP reports no plan mismatch)
- Mutation check: in a scratch migration, change `capped_payout_pool` to round instead of floor (`round` in place of `div`). Then the "Residual n−1" or "Single employee"/"Large pool" assertions go red; delete the scratch file and reset

#### Manual Verification:

- Each oracle row has a derivation comment above its assertion that a reviewer can follow with pen and paper

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Approval freeze at the database level (risk #4)

### Overview

Make the freeze a database guarantee: the live payout RPCs refuse Approved milestones. Pin that a config change reaches Draft milestones and never Approved ones.

### Changes Required:

#### 1. Red tests first

**File**: `supabase/tests/payout_correctness.test.sql`

**Intent**: Describe the decided freeze behaviour before the migration exists, so the new assertions are red on the current schema.

**Contract**: A new `#4` block:

- **Setup:** config C1′. Two milestones with identical engagements and scores 100/50/0/0, target 10 000.00 (the "Non-default config" inputs: factors 1.00 and 1.50). Milestone A is approved by SP, milestone B stays Draft.
- **Before the config edit:**
  - A's snapshot: pool 6 625.00, bonuses 2 650.00 / 3 975.00;
  - B's live figures are the same.
- **Config edit (as owner):** C2 = KPI weights 0.25 each, min 0.50, max 2.00, and the rating factor used by the second engagement raised from 1.50 to 3.00.
- **After the edit:**
  - **B (Draft) reflects C2:** M = 1.0625, pool 5 312.50, bonuses 1 328.12 / 3 984.37, total 5 312.49, residual 0.01.
  - **A (Approved) is unchanged:** header and lines in `milestone_results` / `milestone_result_lines` equal the pre-edit literals. Read once as SP and once as A's employee (linked and activated, per §6.1 actor rules) through `milestone_result_lines`.
  - SP calling `milestone_payout_lines(A)` and `milestone_payout_summary(A)` → `throws_ok(…, 'MR015')`.
  - AP (Admin) calling either function on A → `MR015`.
  - SQ (foreign Supervisor) calling either on A → `is_empty` (no existence leak).
  - Rating-only update on A's engagement as SP → `MR007`.

#### 2. Hardening migration

**File**: `supabase/migrations/20261009120000_payout_rpcs_refuse_approved.sql` (new)

**Intent**: Stop the live RPCs from recomputing an Approved milestone from the current config. The snapshot becomes the only source of Approved figures at the database level, not just by page convention.

**Contract**:

- `create or replace function public.milestone_payout_lines(p_milestone_id uuid)`: same signature, return type, `stable`, `security invoker`, `search_path = ''`, grants unchanged. After the visibility lookup (the `if not found then return; end if;` branch), raise `MR015` with a message pointing at the approval snapshot when the visible milestone's status is `approved`. The lookup must also select `m.status`.
- `milestone_payout_summary`: add an explicit status guard (convert to plpgsql or keep `sql`, implementer's choice) so the refusal does not depend only on the lateral call. Same signature, return type and grants. If the return type is unchanged, `create or replace` keeps the grants; re-apply the revoke/grant lines anyway, following the existing migration style.
- Header comment: why (risk #4, research finding 5), and that `approve_milestone` is unaffected because it reads the lines before setting `approved`.

#### 3. Matrix cells

**File**: `supabase/tests/rls_matrix.test.sql`

**Intent**: Under the §6.1 rule, record the changed behaviour once per actor.

**Contract**: For `milestone_payout_summary('…0721')` and `milestone_payout_lines('…0721')` (MA_appr):

| Actor         | Expected result                                                              |
| ------------- | ---------------------------------------------------------------------------- |
| SA, AD        | `throws_ok … 'MR015'`                                                        |
| SB, E1, E2, U | `is_empty`                                                                   |
| anon          | already denied by grant; add the cell only if the anon block enumerates RPCs |

- Bump `plan(N)`.
- Update the file header's rule comment to note that body-only changes add cells here.

### Success Criteria:

#### Automated Verification:

- Before the migration: the new MR015 assertions fail and the rest of the `#4` block passes (record this in the commit message or PR description)
- After the migration: `npx supabase db reset --local && npx supabase test db` passes, including `milestone_approval.test.sql` unchanged (approval still snapshots correctly)
- `rls_catalog_guard.test.sql` passes with no edits
- Mutation check: in a scratch migration, drop the status guard from `milestone_payout_lines`; then the MR015 cells in the suite and the matrix go red. Delete the scratch file and reset

#### Manual Verification:

- With `npm run dev` against local Supabase, a seeded Draft milestone still shows computed bonuses. After approving it in the UI, the page shows the snapshot figures with no error

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Flag boundaries (risk #7)

### Overview

Pin both supervisor flags at their strict-`>` boundaries across mixed milestone states. Exclude closed projects from the time-share total.

### Changes Required:

#### 1. Red tests first

**File**: `supabase/tests/payout_correctness.test.sql`

**Intent**: Prove that the flags trip exactly at the boundary and that closed work never inflates the time-share total.

**Contract**: A new `#7` block.

**Budget exposure** (as SP; the config is C1 from Phase 1, so the "Single employee" oracle applies):

- **Approval flips the flag at equality.** Project P_b has total_budget 15 000.00. M1 has target 10 000.00 and the "Single employee" inputs (pool 6 250.00); M2 is Draft with target 8 750.00.
  - Before approval: reserved_total 18 750.00, `over_budget` true.
  - After approving M1: reserved_total 15 000.00, remaining 0.00, `over_budget` false.
- **Completed reserves its target; cancelled reserves nothing; one grosz over is flagged.** Project P_c has total_budget 5 000.00 and milestones: `completed` 3 000.00, `cancelled` 9 000.00, `planned` 2 000.01. Expected: reserved_total 5 000.01, `over_budget` true.
- **Closed project still shows its exposure.** Set P_c to `completed`. reserved_total stays 5 000.01 and `over_budget` stays true. This pins the decision that project status is ignored.

**Time share** (as SP):

- **Exactly 100 % is not flagged:** employee T1 with 0.50 + 0.50 on open milestones → open_total 1.00, `over_allocated` false.
- **Just over is flagged:** employee T2 with 0.60 on a `planned` milestone and 0.41 on an `active` one → 1.01, true.
- **Closed milestones are excluded:** T2 also has 0.30 on a `cancelled` milestone → total stays 1.01.
- **Closed projects are excluded:** T3 has 0.60 on an open milestone in an open project, plus 0.50 on an `active` milestone whose project is then set to `cancelled`, plus 0.50 on an `active` milestone whose project is then set to `completed`. Expected: 0.60, false. The cancelled and completed sub-cases must be separately visible, e.g. by asserting after each status change.
- **The cross-Supervisor non-flag, pinned explicitly** (accepted tradeoff from research): T4 owned by SP has 0.60 on SP's milestone and 0.60 on SQ's milestone. As SP: 0.60, false. As AP: 1.20, true. Build this fixture as the table owner, the same way `employees_rls.test.sql` builds EX (`…0436`, engagements `…0447`/`…0448`), so MR008 is respected.

#### 2. View migration

**File**: `supabase/migrations/20261009130000_time_share_excludes_closed_projects.sql` (new)

**Intent**: Stop engagements in cancelled or completed projects from counting toward an employee's open time share. Work in a closed project is no longer in progress, and counting it raises false over-allocation flags.

**Contract**:

- `create or replace view public.employee_time_share_totals with (security_invoker = true)`: same columns (`employee_id`, `open_total`, `over_allocated`).
- Join `public.projects` on the milestone's `project_id` and add `p.status not in ('completed', 'cancelled')` beside the existing milestone-status filter.
- Re-apply `revoke all … from anon, authenticated; grant select … to authenticated;`.
- Header comment: why (research finding 6) and the accepted per-Supervisor scope.
- **RLS caution:** the join runs under the caller's RLS. Verify that every role that sees an engagement row also sees its project (SA/AD do by ownership/admin). The matrix cells below catch a regression.

#### 3. Matrix cells

**File**: `supabase/tests/rls_matrix.test.sql`

**Intent**: Record the view change once per actor.

**Contract**:

- Add a fixture engagement for E1 on an `active` milestone in a cancelled project of SA's, inside the `…07xx` range, using the next free ids.
- SA and AD selecting `employee_time_share_totals` for E1: the total excludes it. The exact expected value comes from the matrix's fixture sums, written by hand.
- SB, E1, E2 and U: unchanged "none" cells, re-checked to still pass.
- Bump `plan(N)`.

### Success Criteria:

#### Automated Verification:

- Before the migration: only the closed-project time-share assertions fail; the budget and other time-share assertions pass
- After the migration: `npx supabase db reset --local && npx supabase test db` passes, with `employees_rls.test.sql` and `milestone_approval.test.sql` unchanged
- `rls_catalog_guard.test.sql` passes with no edits
- Mutation check: change `>` to `>=` in a scratch copy of the view; then the "Exactly 100 % is not flagged" assertion goes red. Delete the scratch file and reset

#### Manual Verification:

- On `/employees` with the seed data, the seeded over-allocated employee still shows the "Over 100%" badge (its projects are open)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Test-plan backport and cookbook

### Overview

Bring `test-plan.md` and the roadmap in line with what Phase 2 decided and built.

### Changes Required:

#### 1. Rollout, stack and gates

**File**: `context/foundation/test-plan.md`

**Intent**: Record that Phase 2 is pgTAP-only and that the Vitest bootstrap and its gate move to Phase 3.

**Contract**:

- §3 row 2:
  - Goal: drop "bootstrap Vitest if the logic lives in TS";
  - Test types: `pgTAP`;
  - Status is left to the orchestrator.
- §3 row 3 Test types: prepend "Vitest bootstrap +".
- §4 Vitest row Version: "none yet — see Phase 3".
- §5 Vitest gate: "required after §3 Phase 3"; "Catches": drop "formula, freeze".
- §5 pgTAP gate Required: append "and `payout_correctness` since §3 Phase 2".
- Bump "Last updated".

#### 2. Cookbook

**File**: `context/foundation/test-plan.md`

**Intent**: Turn §6.2 into the canonical recipe for a payout or formula test, and record the rule clarification and the phase notes.

**Contract**:

- **§6.2, replacing the TBD:**
  - Where: `supabase/tests/payout_correctness.test.sql` (fixtures `…08xx`).
  - Oracle rule: hand-derived in integer grosze from PRD Business Logic, with the derivation in a comment and never by calling the function under test. Set `bonus_settings` explicitly per block.
  - Required shape: exact literals per case, plus the Σ ≤ pool ≤ target property assertion.
  - Freeze pattern: approve → config edit → the Approved snapshot is unchanged (as the Supervisor and as the employee), the Draft milestone reflects the new config, and the live RPC on the Approved milestone raises MR015.
  - Flag pattern: assert at equality (not flagged) and one grosz or 0.01 over (flagged).
  - Mutation check and run command.
- **§6.1:** add one line. A migration that changes only a view or invoker function body, without changing its name, columns, `security_invoker`, grants or definer status, adds `rls_matrix` cells for the changed behaviour and leaves the catalog guard unchanged.
- **§6.6:** add a Phase 2 note:
  - the two gaps closed (live RPCs refuse Approved with MR015; time share excludes closed projects);
  - budget exposure ignoring project status is pinned as intended;
  - Vitest moved to Phase 3 and why;
  - the mutation checks confirmed.

#### 3. Roadmap correction note

**File**: `context/foundation/roadmap.md`

**Intent**: Stop the S-02 risk line from stating the old reserve rule without correction (research: `roadmap.md:112` still says "target × maximum").

**Contract**: Append a parenthetical correction to the line-112 risk text, matching the style of line 105: "(Corrected by S-04 on 2026-10-04: non-Approved milestones reserve their target pool.)". The archived-slice log line at 211 quotes the slice title as it was and stays unchanged.

### Success Criteria:

#### Automated Verification:

- `npx prettier --check context/foundation/test-plan.md context/foundation/roadmap.md` passes (the pre-commit hook formats `*.md`)
- `grep -n "TBD — see §3 Phase 2" context/foundation/test-plan.md` returns nothing

#### Manual Verification:

- §6.2 can be followed to add a new formula case without reading this plan

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Database (pgTAP):

- One new suite with one block per risk (#3, #4, #7); all expected values are hand literals.
- Matrix cells for each behaviour change, per actor; the catalog guard is re-run unchanged.
- Each phase ends with a mutation check proving its block can fail.

### Manual Testing Steps:

1. Run `npm run dev` against local Supabase and open a seeded Draft milestone: computed bonuses show.
2. Approve it, reload: snapshot figures show with no error.
3. `/employees`: the seeded over-allocated employee still shows "Over 100%".

## Migration Notes

- Both migrations use `create or replace` with unchanged signatures and columns, so no data moves and rollback is re-applying the previous definition.
- Order: `20261009120000_payout_rpcs_refuse_approved.sql`, then `20261009130000_time_share_excludes_closed_projects.sql`; they are independent.

## References

- Research: `context/changes/testing-payout-correctness/research.md`
- Test plan: `context/foundation/test-plan.md` §2 (#3, #4, #7), §3 Phase 2, §6.1
- Worked example (current rule): `context/archive/2026-10-04-supervisor-scores-milestone-and-sees-computed-bonuses/plan.md:388-397`
- Prior phase plan: `context/archive/2026-10-07-testing-rls-matrix/plan.md`
- Snapshot/approval: `supabase/migrations/20261005120000_milestone_approval.sql:282-393,568-616`
- Live RPCs: `supabase/migrations/20261004130000_milestone_payout_hard_cap.sql:28-222`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Payout ceilings and boundary cases (risk #3)

#### Automated

- [x] 1.1 `npx supabase db reset --local && npx supabase test db` passes, including `payout_correctness.test.sql` — c62ac1e
- [x] 1.2 `plan(N)` in the new suite equals the number of assertions it runs — c62ac1e
- [x] 1.3 Mutation check: rounding instead of flooring in `capped_payout_pool` turns the #3 oracles red — c62ac1e

#### Manual

- [x] 1.4 Each oracle row has a derivation comment a reviewer can follow by hand — c62ac1e

### Phase 2: Approval freeze at the database level (risk #4)

#### Automated

- [x] 2.1 Before the migration, only the new MR015 assertions fail
- [x] 2.2 After the migration, `npx supabase test db` passes with `milestone_approval.test.sql` unchanged
- [x] 2.3 `rls_catalog_guard.test.sql` passes with no edits
- [x] 2.4 Mutation check: dropping the status guard turns the MR015 cells red

#### Manual

- [x] 2.5 Draft milestone shows computed bonuses; after UI approval the snapshot shows with no error

### Phase 3: Flag boundaries (risk #7)

#### Automated

- [ ] 3.1 Before the migration, only the closed-project time-share assertions fail
- [ ] 3.2 After the migration, `npx supabase test db` passes with `employees_rls` and `milestone_approval` unchanged
- [ ] 3.3 `rls_catalog_guard.test.sql` passes with no edits
- [ ] 3.4 Mutation check: `>=` in the view turns the 100 % boundary assertion red

#### Manual

- [ ] 3.5 Seeded over-allocated employee still shows "Over 100%" on `/employees`

### Phase 4: Test-plan backport and cookbook

#### Automated

- [ ] 4.1 `npx prettier --check` passes on `test-plan.md` and `roadmap.md`
- [ ] 4.2 No "TBD — see §3 Phase 2" remains in `test-plan.md`

#### Manual

- [ ] 4.3 §6.2 can be followed to add a new formula case without reading this plan
