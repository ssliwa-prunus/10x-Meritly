# Payout Correctness & Approval Freeze — Plan Brief

> Full plan: `context/changes/testing-payout-correctness/plan.md`
> Research: `context/changes/testing-payout-correctness/research.md`

## What & Why

This is rollout Phase 2 of `context/foundation/test-plan.md`. It proves the PRD's money rules with hand-computed expected values:

- a milestone never pays out more than its payout pool, and the payout pool never exceeds the target pool (risk #3);
- Approved figures never change when an Admin edits the config (risk #4);
- the supervisor flags trip exactly at their boundaries (risk #7).

Two gaps research found are closed with small migrations.

## Starting Point

All payout and flag arithmetic is in SQL: four invoker functions and two `security_invoker` views. Two pgTAP suites already cover the worked example, min/max multiplier, rounding and the freeze after config edits. The gaps:

- the live payout RPCs still recompute Approved milestones from the current config, so the freeze holds only because pages check the status first;
- the time-share flag counts engagements in cancelled or completed projects;
- several boundary cases are untested.

## Desired End State

A new `supabase/tests/payout_correctness.test.sql` pins the boundary, freeze and flag cases against hand literals. The live RPCs raise MR015 for Approved milestones, and invisible milestones still return empty. The time-share total ignores closed projects. `test-plan.md` §6.2 is a working recipe, and Vitest is scheduled for Phase 3, where TS logic needs it.

## Key Decisions Made

| Decision                           | Choice                                         | Why (1 sentence)                                                                                         | Source   |
| ---------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------- |
| Test layer                         | pgTAP only                                     | All payout, freeze and flag logic is SQL; cost × signal favours testing it in the database               | Research |
| Vitest                             | Move bootstrap and gate to Phase 3             | Phase 3's route gating is the first TS logic worth a runner; here it would only re-test DB CHECKs        | Plan     |
| Live RPCs on Approved              | Refuse with MR015, after the visibility lookup | Makes the freeze a DB guarantee without letting non-owners learn a milestone's status                    | Plan     |
| Time share in closed projects      | Exclude via a view fix                         | Work in a closed project is no longer in progress; counting it raises false flags                        | Plan     |
| Budget exposure in closed projects | Unchanged, pinned by a test                    | A completed project still showing its exposure is the intended behaviour                                 | Plan     |
| Suite layout                       | One new suite, fixtures `…08xx`                | One file per rollout phase gives §6.2 a single reference test and leaves existing `plan(N)` counts alone | Plan     |
| §6.1 rule for body-only changes    | Add matrix cells, leave the guard unchanged    | The catalog shape doesn't change; behaviour per actor does                                               | Plan     |
| Oracles                            | Hand-derived in integer grosze                 | Floating point disagrees by a grosz; nothing is copied from the implementation                           | Research |

## Scope

**In scope:**

- the #3 boundary cases:
  - single employee;
  - pools near 9 999 999 999.99;
  - non-default config;
  - a bonus that floors to 0.00;
  - residual of n−1 grosze;
  - a Σ ≤ pool ≤ target property check;
- the #4 freeze (Draft picks up new config, Approved does not; MR015 on the live RPCs; MR007 on a rating-only update);
- the #7 flags (approval flipping the budget flag at equality, completed vs cancelled milestones, closed projects, time share at 1.00 vs 1.01);
- two migrations, matrix cells, and the test-plan and roadmap backport.

**Out of scope:**

- Vitest;
- the budget-exposure view;
- edits to existing suites other than `rls_matrix`;
- catalog guard edits;
- UI copy;
- concurrency tests;
- CI YAML;
- Phases 3–4 work.

## Architecture / Approach

One suite grows by one block per risk. Phases 2 and 3 write the red assertion first, then add the migration that turns it green. Every phase ends with a mutation check (break the rule in a scratch migration and watch the named assertion fail). Each test block sets the config explicitly, so the expected values never depend on the seeded defaults.

## Phases at a Glance

| Phase                      | What it delivers                                                                                     | Key risk                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1. Payout ceilings (#3)    | New suite and the `…08xx` fixture range; 6 oracle cases, a 0.00 snapshot line and the property check | Oracle arithmetic errors; derivations must be checkable by hand                                      |
| 2. Freeze at DB level (#4) | MR015 migration; Draft vs Approved after a config edit; matrix cells                                 | The status check placed before the visibility lookup would let non-owners learn a milestone's status |
| 3. Flag boundaries (#7)    | Closed-project view fix; budget and time-share boundary tests; matrix cells                          | The new project join runs under the caller's RLS                                                     |
| 4. Backport                | Test plan §3/§4/§5/§6, roadmap correction                                                            | None significant                                                                                     |

**Prerequisites:** Docker, `npx supabase start`, and a clean `npx supabase db reset --local`.
**Estimated effort:** about 2–3 sessions across 4 phases.

## Open Risks & Assumptions

- The project join in `employee_time_share_totals` assumes that every role that sees an engagement also sees its project. The matrix cells verify this.
- If a milestone is approved between the page reading its status and calling the RPC, the page shows its generic load error; a reload shows the snapshot. This is accepted.
- Moving Vitest to Phase 3 leaves the TS-only "≤ 2 decimals" parsing untested for one more phase. The DB CHECKs still bound the values.

## Success Criteria (Summary)

- `npx supabase test db` passes with the new suite. Each of its literals traces to a hand derivation.
- The Approved figures and the employee's view do not change after a config edit, and the live RPCs cannot recompute them.
- Both flags are pinned at equality (not flagged) and just over it (flagged). Closed projects no longer inflate the time-share total.
