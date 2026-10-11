<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Test rollout Phase 4 — US-01 e2e & gates wiring

- **Plan**: context/changes/testing-e2e-gates-wiring/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-11
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Success criteria re-run on 2026-10-11:

- `src/middleware.ts` has no diff against develop, and line 48 is `return context.redirect(decision.location);`.
- `npm run test:e2e`: 3 passed.
- lint: 0 errors. `astro check`: 0 errors.
- `npm test`: 184 passed. `npm run test:hooks`: 46 passed.
- prettier is clean on test-plan.md, test-stack.md and the committed CLAUDE.md.
- `master` requires `checks`, `smoke`, `integration` and `e2e`. PR #20's checks are all passing.
- 2.3 (real database, scratch migration plus reset) was not re-run because it is destructive. The evidence from the implementation run stands.

Every manual row has recorded evidence: CI runs 38161588971, 38162322089 and 38162629951; the skip run with Supabase stopped; and user confirmations for 2.5, 3.2 and 4.2.

## Findings

### F1 — Ledger misses a committed, edited migration applied by `migration up`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .claude/hooks/end-of-turn.mjs (checkSql, `for (const f of uncommitted) ledger[…]` after `migration up`)
- **Detail**: After a successful `migration up`, only uncommitted migrations get a ledger entry. Take a committed migration that is edited in the working tree and still pending locally, for example one pulled, then edited before it was ever applied. The hook applies the edited content but records nothing. On the next Stop the migration is applied, committed and has no ledger entry, so the hook blocks it as "already applied … run `db reset`". That is false, and the advice wipes local data. It happens once, because "tell once" then records it. No test covers this case. Both review agents found it independently.
- **Fix**: After `migration up`, record every changed migration that was pending before `up` (not only uncommitted ones), and add a proof case: a committed migration, edited and pending, passes on two consecutive Stops.
- **Decision**: FIXED — ledger records every changed migration that was pending before `up`; proof case added (deliberate break went red)

### F2 — No per-call timeout on the Supabase CLI calls

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: .claude/hooks/lib.mjs (runTool `spawnSync`, no `timeout`); used by end-of-turn.mjs checkSql
- **Detail**: One Stop can now run, in sequence, test:hooks (~20 s), `migration list`, `migration up`, `supabase test db` (pg_prove in Docker), ESLint, Vitest and astro check (~35 s), all within the 180 s Stop timeout. If a Supabase call hangs (Docker half up, slow image pull), the harness kills the whole hook and the agent gets no report at all.
- **Fix A ⭐ Recommended**: Give the three Supabase calls a timeout (for example 60 s) through an optional `runTool` option. Treat a timed-out `migration list` like "not reachable" (skip with the message) and a timed-out `up`/`test db` as a reported failure.
  - Strength: Keeps the rest of the Stop report intact and puts a bound on the one external, Docker-dependent step.
  - Tradeoff: Small change to the shared `runTool`, plus one or two proof cases with a sleeping stub.
  - Confidence: MED — the hang is plausible (Docker states) but hasn't been observed.
  - Blind spot: How long a cold `test db` takes when the pg_prove image has to be pulled.
- **Fix B**: Raise the Stop timeout in `.claude/settings.json` instead.
  - Strength: One-line config change.
  - Tradeoff: A real hang still kills the hook, just later, and the agent waits longer.
  - Confidence: MED.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — 60 s per-call timeout (`SUPABASE_TIMEOUT_MS`, env override `CLAUDE_HOOK_SUPABASE_TIMEOUT_MS`); timed-out list skips, timed-out up/test db blocks; 2 proof cases

### F3 — CLAUDE.md and test-plan §6.1 overstate the hook's behaviour

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: CLAUDE.md (`test:hooks` line); context/foundation/test-plan.md §6.1 "Agent loop"
- **Detail**: CLAUDE.md says the Stop hook "also [runs] `supabase migration up --local` + `supabase test db`" and "blocks on an edited, already-applied migration". In the code, `up` runs only when a migration is pending, and an edited applied migration blocks once per content and is trusted on the next turn. Neither document says that a missing Supabase CLI blocks. §6.6 has the accurate description.
- **Fix**: Reword both lines to "applies pending migrations, then `supabase test db`; reports an edited, already-applied migration once per content". Add the missing-CLI failure to CLAUDE.md. Stage only these lines in CLAUDE.md, as in Phase 3.
- **Decision**: FIXED — CLAUDE.md test:hooks line and test-plan §6.1 reworded (pending-only `up`, once per content, missing CLI, 60 s timeout)

### F4 — Approved deviations aren't recorded in plan.md

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/testing-e2e-gates-wiring/plan.md (Phase 1 and Phase 2 blocks)
- **Detail**: The hash ledger and "tell once" appear only in the p2 commit and in test-plan §6.6. Three other choices appear nowhere outside code and tests: `migration up` runs only when pending, a missing CLI counts as a failure, and the `e2e` job writes `.env`. test-plan §6.5 says the job writes only `.dev.vars`.
- **Fix**: Add a short "Deviations (implementation)" note under Phase 1 and Phase 2 in plan.md, and correct the `.dev.vars` sentence in §6.5.
- **Decision**: FIXED — deviation notes under plan Phases 1 and 2; test-plan §6.5 says `.env` and `.dev.vars`

### F5 — "Migration failed to apply" gives no re-verify hint

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .claude/hooks/end-of-turn.mjs (checkSql, `migration up` failure message)
- **Detail**: The plan's Critical Implementation Details require every block message to say how to re-verify by hand, because the retry Stop exits early. The stale and pgTAP messages do this. The migration-failure message only shows the CLI output.
- **Fix**: Append "fix the SQL, then re-run `npx supabase migration up --local` and `npx supabase test db`."
- **Decision**: FIXED — migration-failure message ends with the re-run commands; asserted in its case

### F6 — SQL changes in a sibling worktree pass silently

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .claude/hooks/end-of-turn.mjs (`sqlChecked` once-per-Stop guard)
- **Detail**: The SQL step runs only for the first root with SQL changes, by design, because worktrees share one database. SQL changes in another swept worktree are neither applied nor tested, and nothing says so.
- **Fix**: When a later root also has SQL changes, add a note naming it ("pgTAP ran in <root>; SQL changes in <other> were not applied") to the skip note or the report.
- **Decision**: FIXED — other roots with SQL changes are named in the report / systemMessage; 2 cases

### F7 — A deleted, applied migration isn't flagged

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .claude/hooks/end-of-turn.mjs (`existsSync` filter on PGTAP_SCOPE files)
- **Detail**: Deleted files are dropped from the trigger set. If the only SQL change is deleting an applied migration, the pgTAP step doesn't run. A later `migration up` may then fail on the remote-only version, with no hint about `supabase migration repair`.
- **Fix**: Accept and document it in test-plan §6.1 (deleting applied migrations is outside the agent workflow), or flag deleted migrations whose version is applied.
- **Decision**: FIXED — accepted gap documented in test-plan §6.1

### F8 — test-plan §3 Phase 4 status still says `researched`

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md §3 row 4
- **Detail**: The plan leaves this status flip to the `/10x-test-plan` orchestrator at close-out. The change is now implemented, so the row is out of date until that runs.
- **Fix**: Run `/10x-test-plan` to reconcile Phase 4 to `complete` (after archiving, or as part of it).
- **Decision**: FIXED — test-plan §3 Phase 4 status set to complete
