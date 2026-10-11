# Test rollout Phase 4 — US-01 e2e & gates wiring — Plan Brief

> Full plan: `context/changes/testing-e2e-gates-wiring/plan.md`
> Research: `context/changes/testing-e2e-gates-wiring/research.md`

## What & Why

This plan proves through the browser that after a Supervisor approves a milestone, each employee sees only their own result. A PR that breaks this can't merge into `master`. It also gives the agent loop a pgTAP gate, so an RLS regression in a migration is reported at the end of the agent's turn instead of first in CI.

## Starting Point

Playwright setup and the US-01 spec are already shipped. The spec covers employee 1 only, and nothing runs it in CI. The agent hooks check TS and Astro files but ignore `supabase/` SQL. `master` requires `checks`, `smoke` and `integration`. An uncommitted leftover in `src/middleware.ts:48` (`DELIBERATE BREAK A`) disables the signed-out redirect.

## Desired End State

A required `e2e` job runs setup, seed and US-01 on every PR, against local Supabase and the production preview, with no secrets. US-01 checks isolation in both directions (1200,00 zł and 800,00 zł). When an agent turn changes `supabase/migrations` or `supabase/tests` SQL, the Stop hook applies the pending migrations and runs the full pgTAP suite, blocking on failure. It blocks when the turn edited an already-applied migration, and it skips with a visible message when local Supabase is down.

## Key Decisions Made

| Decision                 | Choice                                                     | Why (1 sentence)                                                                                           | Source   |
| ------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------- |
| When the SQL gate runs   | Stop hook (end of turn), not per edit                      | Migration + RLS test updates land together, and a per-edit run would apply half-written migrations         | Research |
| Apply before testing     | `migration up --local`, then `test db`                     | `test db` tests the database as it stands, so an unapplied file would pass unseen                          | Research |
| Edited applied migration | Block: move the change to a new migration or reset by hand | The hook never wipes local data, and a green run on an untested schema would mislead                       | Plan     |
| Reachability check       | `migration list --local --output-format json`              | One call answers "is it up" (exit 1 when down) and "which versions are applied", and the proof can stub it | Plan     |
| Trigger paths            | `supabase/migrations/*.sql` and `supabase/tests/*.sql`     | Exactly the files that change RLS or its proof; `seed.sql` only applies on reset                           | Plan     |
| Test scope               | Full pgTAP suite                                           | 2.8 s for 660 tests; a subset saves under 1 s and misses payout regressions                                | Research |
| US-01 direction          | Add employee 2 (800,00 zł only)                            | Symmetric browser proof of isolation                                                                       | Plan     |
| CI layout                | Separate `e2e` job, edge runtime excluded                  | One clear required check, and approval succeeds without the email function                                 | Research |
| Middleware leftover      | Revert as the first step of Phase 1                        | The first CI run must test real code                                                                       | Plan     |
| Branch protection        | Add `e2e` after a green run, with user confirmation        | Follows the precedent set by `new-pr-ci-cd-workflow`                                                       | Research |

## Scope

**In scope:**

- middleware revert
- employee 2 check in US-01
- `test:e2e` script
- `e2e` job in `pr.yml`
- pgTAP step in `end-of-turn.mjs`, with stub-based proof cases
- docs: test-plan, CLAUDE.md, test-stack
- `e2e` added to `master` protection

**Out of scope:**

- e2e on push to `master`
- protection on `develop`
- per-edit pgTAP
- the hook running `db reset`
- `seed.sql` as a trigger
- new specs beyond US-01
- other browsers
- email in the e2e job

## Architecture / Approach

CI: a fourth parallel job copies `smoke`'s Supabase start and `.dev.vars` steps, installs Chromium, and runs `npm run test:e2e`. The Playwright webServer owns build and preview. The env vars carry the public seed accounts, and the report is uploaded on failure. Hooks: `end-of-turn.mjs` gains a SQL step that runs before its code-only `continue`, once per Stop, calling `node_modules/supabase/dist/supabase.js` through `runTool`. The steps are `migration list`, then the applied-edit guard, then `migration up`, then `test db`. Failures use the existing exit 2 + stderr report; an unreachable stack gets a `systemMessage`. The proof stubs the CLI with marker files and a call log.

## Phases at a Glance

| Phase                        | What it delivers                                             | Key risk                                                     |
| ---------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| 1. US-01 spec + CI `e2e` job | Middleware restored, both-direction spec, green `e2e` PR run | CI timing or a flaky first run (hydration, preview startup)  |
| 2. pgTAP in the Stop hook    | Apply + test on SQL turns, with each branch proven by stubs  | A failed new migration stays applied (the message covers it) |
| 3. Docs                      | test-plan §3–§6, CLAUDE.md, test-stack                       | Wording drifts from the real job and hook                    |
| 4. Branch protection         | `e2e` required on `master`                                   | Outward-facing; needs a green run and user confirmation      |

**Prerequisites:** local Supabase running (Docker); `.dev.vars` with the `E2E_*` vars, including the new employee 2 pair; `gh` authenticated for Phase 4.
**Estimated effort:** ~2 sessions across 4 phases (Phases 1–2 carry the work).

## Open Risks & Assumptions

- The down-state of `migration list --local` is inferred from a dead `--db-url` (exit 1). Phase 2 manual check 2.4 confirms it with `supabase stop`.
- The e2e job's duration is estimated at roughly `smoke`'s (~2–3 min). It runs in parallel, so wall time grows only if it is the longest job.

## Success Criteria (Summary)

- A PR that breaks approve → employee view, or lets one employee see the other's figure, shows a red required `e2e` check and can't merge into `master`.
- An agent turn that breaks RLS in a migration ends with a blocking pgTAP report instead of a green turn.
- With Supabase stopped, agent turns still finish, with a visible "pgTAP skipped" note.
