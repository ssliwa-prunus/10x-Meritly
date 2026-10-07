# Data Isolation & RLS Matrix — Plan Brief

> Full plan: `context/changes/testing-rls-matrix/plan.md`
> Research: `context/changes/testing-rls-matrix/research.md`

## What & Why

This is rollout Phase 1 of `context/foundation/test-plan.md`. It proves two things:

- no employee can see another employee's bonus or any Draft result (risk #1);
- no Supervisor can read or change another Supervisor's data (risk #2).

RLS is the only boundary: an employee can call the database API directly with their own login. So the proof has to live in the database, and it has to catch the _next_ migration as well as today's.

## Starting Point

Today's policies don't leak bonus figures. The tests are thinner than they look, though:

- most "employee sees nothing" checks use an employee account with no linked employee record;
- no second activated employee ever attacks;
- several Supervisor B → Supervisor A write cases are never asserted.

Research also found two holes:

- **F1:** any Supervisor can read every user's profile (email, name, role);
- **F2:** signed-in users still hold TRUNCATE, REFERENCES and TRIGGER on three tables.

## Desired End State

- One migration closes F1 and F2.
- `rls_matrix.test.sql` walks every role × table × operation cell with real attackers: Supervisors A and B, activated employees E1 and E2, an unlinked user, anon, and an Admin.
- `rls_catalog_guard.test.sql` fails whenever a table, policy, risky grant or definer function appears that nobody classified.
- The test plan carries the corrections, and §6.1 explains how to add the next RLS test.

## Key Decisions Made

| Decision                                  | Choice                                                                | Why (1 sentence)                                                                                         | Source          |
| ----------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------- |
| F1: Supervisor reads all profiles         | Drop `profiles_select_supervisor`, assert deny                        | No app path uses it (only the Admin's `listSupervisors` reads others), and it exposes every user's email | Research + Plan |
| F2: TRUNCATE/REFERENCES/TRIGGER grants    | Revoke from `authenticated`; guard asserts it for every table         | Makes all 9 tables consistent; TRUNCATE ignores RLS                                                      | Research + Plan |
| F3: visibility after project reassignment | New owner sees approved history, old owner loses it; pinned by a test | A team handover matches PRD "Supervisor: their own team" and needs no schema change                      | Plan            |
| F4: unscoped `is_approved_milestone`      | Accept and document in the guard allowlist                            | Returns only a boolean for an unguessable UUID; scoping would touch the employee read path for no gain   | Plan            |
| Test layer                                | pgTAP only                                                            | It runs the PostgREST path (`request.jwt.claims`) and already runs in CI                                 | Research        |
| Layout                                    | Two new files: matrix and catalog guard                               | The matrix reads in one place; the guard fails loudly on drift                                           | Plan            |
| HTTP IDOR check                           | Moved to test-plan Phase 3, backported                                | `/my-bonuses` takes no ID; foreign IDs return 200 + "not found", so HTTP adds little signal here         | Research + Plan |
| Attackers                                 | Linked, activated employees only                                      | An unlinked user sees nothing for the wrong reason                                                       | Research        |

## Scope

**In scope:**

- the F1/F2 migration and the two `profiles_rls` assertions it invalidates;
- the matrix suite;
- the catalog guard;
- the seed range comment;
- the test-plan §2/§3/§5/§6 updates;
- one `CLAUDE.md` rule bullet.

**Out of scope:**

- the HTTP IDOR check (Phase 3);
- Edge Function and email tests (Phase 3);
- payout formula and freeze tests (Phase 2);
- rewriting the six existing suites;
- changing `is_approved_milestone` or reassignment behaviour;
- CI YAML and branch triggers.

## Architecture / Approach

Fix, then test. The migration lands first, so the matrix's expected values come from the decided behaviour (the PRD visibility rule plus F1–F4), never from reading policy bodies. The two new suites complement each other:

- the **matrix** proves behaviour per actor: deny cells, plus allow cells so a deny-everything database can't pass;
- the **guard** pins the catalog: table set, exact `pg_policies` inventory, no `ALL` policies, grant hygiene, a definer-function allowlist, and `search_path` set.

A new policy turns the guard red until both files are updated on purpose. Mutation checks prove each suite fails for the right reason.

## Phases at a Glance

| Phase                              | What it delivers                                            | Key risk                                                                                           |
| ---------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1. Tighten the RLS surface         | Migration for F1/F2; two `profiles_rls` assertions adjusted | A hidden reader of other profiles breaks (research found none)                                     |
| 2. Behavioural matrix suite        | `rls_matrix.test.sql`, `…07xx` fixtures, mutation-checked   | Fixture setup for approved and reassigned milestones is long; copy the `milestone_approval` recipe |
| 3. Catalog guard                   | `rls_catalog_guard.test.sql`, mutation-checked              | Too-loose set comparisons that don't name the offending item                                       |
| 4. Test-plan backport and cookbook | §2/§3/§5 corrections, §6.1 how-to, `CLAUDE.md` bullet       | —                                                                                                  |

**Prerequisites:** Docker plus a local Supabase (`npx supabase start`); research.md read.
**Estimated effort:** ~2–3 sessions across 4 phases (Phase 2 is the bulk).

## Open Risks & Assumptions

- CI runs only on pushes and PRs to `master` (`.github/workflows/ci.yml:3-7`), so the suites gate only once work merges there.
- Whether a failing pgTAP step blocks merges depends on GitHub branch protection, which isn't visible in the repo.
- The hosted project picks up the migration through the normal deploy path. Rollback means a new migration.

## Success Criteria (Summary)

- `npx supabase test db` is green with both new suites, and each suite demonstrably fails when an isolation policy is weakened.
- No Supervisor can see another user's profile, and no API role holds TRUNCATE on any table.
- Test-plan §6.1 tells the next contributor exactly which two files to update when a migration touches RLS.
