# Test rollout Phase 4 — US-01 e2e & gates wiring Implementation Plan

## Overview

Close test-plan §3 Phase 4 in two parts. First, run the US-01 Playwright suite as a required `e2e` check on PRs into `master`, extended so that both employees see only their own approved line. Second, give the agent loop a pgTAP gate: when a turn changed SQL under `supabase/migrations/` or `supabase/tests/`, the end-of-turn hook applies the pending migrations and runs `supabase test db`. RLS regressions then reach the agent before CI.

## Current State Analysis

- `.github/workflows/pr.yml` has three jobs, `checks`, `smoke` and `integration`, and no Playwright, no browser install and no e2e npm script (research §2).
- `playwright.config.ts` is already CI-aware: `forbidOnly`, `retries: 2`, `workers: 1`, a webServer that runs build + preview itself, and it loads `.dev.vars` when present (`playwright.config.ts:7,17-19,34-43`).
- The US-01 spec covers the Draft case, the own line (1200,00 zł) and the absence of the colleague's figure, from employee 1's view only (`tests/e2e/us-01-…spec.ts:141-160`).
- All credentials are seeded local accounts with a public password (`supabase/seed.sql:11-17`), so CI needs no secrets.
- `master` protection requires exactly `checks`, `smoke` and `integration` (app_id 15368, `strict: false`).
- The hooks never look at SQL: `LINTED` covers only TS/JS/Astro (`.claude/hooks/lib.mjs:12`), and `end-of-turn.mjs:203-205` `continue`s on a turn without code.
- `supabase test db` tests the database as it currently stands, so a migration file only counts once it has been applied (research §4).
- The working tree carries an uncommitted `break; // DELIBERATE BREAK A` at `src/middleware.ts:48`, which disables the signed-out redirect.

## Desired End State

- A PR into `master` cannot merge while the `e2e` job is red. The job runs the full Playwright suite (setup, seed, US-01) against local Supabase plus the production preview, with no repository secrets.
- US-01 proves, through the browser: before approval, neither employee sees the milestone. After approval, employee 1 sees exactly their own 1200,00 zł line and never 800,00 zł, and employee 2 sees exactly their own 800,00 zł line and never 1200,00 zł.
- When an agent turn changes `supabase/migrations/*.sql` or `supabase/tests/*.sql`, the Stop hook does one of four things:
  - local Supabase is reachable: it applies the pending migrations and runs the full pgTAP suite, blocking (exit 2) on a migration error or a failed test;
  - an already-applied migration changed: it blocks with an instruction to move the change into a new migration or reset the database;
  - local Supabase is unreachable: it skips with a visible `systemMessage`;
  - the turn changed no SQL: it never starts the CLI.
- `npm run test:hooks` proves each of those branches. Test-plan §3/§4/§5/§6, CLAUDE.md and `test-stack.md` describe the new gates.

### Key Discoveries:

- `node node_modules/supabase/dist/supabase.js` is the CLI entry. It fits `runTool` (`lib.mjs:47-62`) without npx.
- `migration list --local --output-format json` prints `{"migrations":[{"local","remote","time"}]}` on stdout. Against an unreachable database it exits 1 (observed with a dead `--db-url`).
- On this machine the full pgTAP suite takes 2.8 s (9 files, 660 tests), and the Stop hook's timeout is 180 s (`.claude/settings.json`).
- Every pgTAP file rolls back, so a test run leaves no data behind.
- Approval commits before the email call, and "Milestone approved." (`role="status"`) shows whatever the email outcome is (`approve.ts:51-59`, `ApprovalSection.astro:70-74`). The e2e job can therefore leave out the edge runtime.
- The precedent for required checks is to add one only after a green run has recorded its name, and to confirm with the user before changing repo settings (`context/archive/2026-10-10-new-pr-ci-cd-workflow/plan.md:47,201-230`).

## What We're NOT Doing

- No e2e on push to `master` (`ci.yml`) and no protection on `develop`. The PR check is the gate.
- No per-edit (PostToolUse) pgTAP run. A half-written migration would get applied, and CLAUDE.md requires a migration and its RLS test updates to land in the same turn.
- The hook never runs `supabase db reset`, because that wipes local data. It tells the agent to.
- No pgTAP trigger on `supabase/seed.sql` or other `supabase/**` files.
- No scoped pgTAP subset. The full suite costs under 3 s.
- No new e2e specs beyond extending US-01. No cross-browser projects.
- No edge runtime or Mailpit in the e2e job. Email is covered by the `integration` job.

## Implementation Approach

Start by restoring the middleware, so the first CI run of the new job tests real code. Then extend the spec and add the job. Build the hook branch next to the existing Stop checks, reusing `runTool`, the block/systemMessage contract and the stubbed-toolchain proof. Update the docs once the behaviour exists. Turn on branch protection last, after a green run has recorded the `e2e` check name, and only with the user's confirmation.

## Critical Implementation Details

- **Ordering in the Stop hook.** The SQL step must run before the `if (code.length === 0) continue;` at `end-of-turn.mjs:205`, otherwise a migration-only turn skips it. Run it **once per Stop**, not once per swept root: worktrees share one local database. Use the first root (cwd checkout first) that has SQL changes.
- **Retry behaviour.** On the retry Stop (`stop_hook_active`) the hook exits 0 before any check (`end-of-turn.mjs:171`). So the block message must tell the agent how to re-verify by hand: `npx supabase test db`, after `npx supabase db reset --local` where needed.
- **A failed new migration stays applied.** `migration up` records a migration before pgTAP runs. If the tests then fail, editing that file makes it an "already-applied migration changed" on the next Stop. The pgTAP failure message should warn about this up front: after a fix, either reset or add a follow-up migration.

## Phase 1: US-01 spec and the CI `e2e` job

### Overview

Restore the middleware, add the employee 2 direction to US-01, and run the Playwright suite as a new `e2e` job in `pr.yml` until a PR run is green.

### Changes Required:

#### 1. Revert the deliberate break

**File**: `src/middleware.ts`

**Intent**: Restore the signed-out redirect that the e2e break-verification left disabled, before any other work, so the seed spec and smoke stay green.

**Contract**: Line 48 is back to `return context.redirect(decision.location);`, and `git diff src/middleware.ts` is empty.

#### 2. Employee 2 direction in US-01

**File**: `tests/e2e/us-01-approved-bonus-visible-only-to-its-employee.spec.ts`, `.env.example`

**Intent**: Prove isolation in both directions. The colleague (`employee2@meritly.local`, linked to seeded employee `…0033`) sees no line for the project before approval. After approval they see exactly one line with `800,00 zł` and never `1200,00 zł`.

**Contract**:

- New env vars `E2E_EMPLOYEE2_USERNAME` / `E2E_EMPLOYEE2_PASSWORD`. A missing var throws the same kind of error as the existing ones. Both are listed in `.env.example`.
- A second isolated context signs in through `/api/auth/signin`, following the existing employee pattern, and is closed in `finally`.
- The oracle comment is extended: `0.40 → 800.00` own for employee 2.
- Locators follow the house rules: role/text first, no `waitForTimeout`.

#### 3. npm script

**File**: `package.json`

**Intent**: One named entry point for the suite, used locally and in CI.

**Contract**: `"test:e2e": "playwright test"`.

#### 4. `e2e` job

**File**: `.github/workflows/pr.yml`

**Intent**: Run the Playwright suite on every PR, against local Supabase and the production preview, with no secrets. The job is named `e2e` so it can become a required context.

**Contract**:

- Job id and name `e2e`, `ubuntu-latest`, `timeout-minutes: 20`. The checkout, setup-node and `npm ci` steps match `smoke`.
- Start Supabase with the same exclusion list as `smoke` (`pr.yml:44`), so no edge runtime and no Mailpit. Write `.dev.vars` with `SUPABASE_URL` / `SUPABASE_KEY` from `supabase status -o env`, following the `smoke` steps.
- `npx playwright install --with-deps chromium`.
- `npm run test:e2e`, with job-level env set to the seeded accounts:
  - `E2E_USERNAME=supervisor@meritly.local`
  - `E2E_EMPLOYEE_USERNAME=employee@meritly.local`
  - `E2E_EMPLOYEE2_USERNAME=employee2@meritly.local`
  - each `*_PASSWORD=Meritly-Local-Passw0rd!`, the public seed password from `supabase/seed.sql:17`
  - add a comment noting these are local seed values, not secrets.
- No separate build and no manual preview: the Playwright webServer owns both.
- On `failure()`: upload `playwright-report/` and `test-results/` with `actions/upload-artifact`, at the same major-version pinning style as the other actions.
- `if: always()`: `npx supabase stop --no-backup`.

### Success Criteria:

#### Automated Verification:

- `git diff src/middleware.ts` is empty, and `npx playwright test tests/e2e/seed.spec.ts` passes locally
- `npm run test:e2e` passes locally against local Supabase (setup, seed, US-01)
- A planted fault on the employee-view path turns US-01 red locally and names the failing assertion; reverting it turns the suite green
  (example fault: one employee's page also shows the colleague's line)
- `npm run lint`, `npx astro check` and `npm test` pass
- The PR run shows `e2e` green next to `checks`, `smoke` and `integration`

#### Manual Verification:

- The `e2e` job log shows no secrets used, and on a failed run the uploaded report opens with a trace

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: pgTAP in the Stop hook

### Overview

Teach `end-of-turn.mjs` to apply pending migrations and run pgTAP when the turn changed SQL, and prove each branch in `agent-hooks.test.ts`.

### Changes Required:

#### 1. Shared constants

**File**: `.claude/hooks/lib.mjs`

**Intent**: Name the new trigger scope and the CLI entry next to the existing ones.

**Contract**:

- `PGTAP_SCOPE = /^supabase\/(migrations|tests)\/[^/]+\.sql$/`
- `SUPABASE = "node_modules/supabase/dist/supabase.js"`

#### 2. Stop-hook pgTAP step

**File**: `.claude/hooks/end-of-turn.mjs`

**Intent**: When the turn changed SQL in scope, report RLS and payout regressions before the agent finishes, without ever destroying local data, and without blocking when local Supabase simply isn't running.

**Contract**, run once per Stop, in the first swept root whose changes include a `PGTAP_SCOPE` file that exists on disk:

1. Run `migration list --local --output-format json`.
   - If it exits non-zero, local Supabase is unreachable. Add a skip note and run no further SQL checks. If nothing else blocks, the hook exits 0 with `{"systemMessage": "end-of-turn.mjs: pgTAP skipped — local Supabase not reachable (npx supabase start); CI smoke still runs it."}`. If something else blocks, append the note to the stderr report.
   - If the output can't be parsed, report a failure that names the command. This is a check failure, not a skip.
2. For each changed migration file, the version is the digits before the first `_` in its name. If that version has a non-empty `remote` in the list, it is already applied. Block with: the file name(s); "already applied to local Supabase, so pgTAP can't see this edit"; and the two fixes, either put the change in a new migration or run `npx supabase db reset --local` and then `npx supabase test db`. Run no further SQL checks.
3. Otherwise run `migration up --local`. A non-zero exit means "Migration failed to apply", with the CLI output. Stop the SQL checks.
4. Run `test db`. A non-zero exit means "pgTAP fails (npx supabase test db)", with the output and the note that a migration applied in this step stays applied (see Critical Implementation Details).

All results go into the existing `report` array and the existing `block(...)`, which keeps the exit 2 + stderr contract. A turn without `PGTAP_SCOPE` changes never invokes the CLI.

#### 3. Proof

**File**: `scripts/__tests__/agent-hooks.test.ts`

**Intent**: Prove each branch of the new step with a stubbed Supabase CLI, in the same style as the ESLint, Vitest and astro stubs.

**Contract**:

- `installTools` adds a stub at `node_modules/supabase/dist/supabase.js` that:
  - appends each invocation to a call log in the fixture repo;
  - for `migration list`: exits 1 when a `SUPABASE_DOWN` marker file exists, otherwise prints JSON in which the versions listed in a fixture "applied" file have `remote` set;
  - for `migration up`: exits 1 when a migration contains `MIGRATION_ERROR`;
  - for `test db`: exits 1 when any `supabase/**/*.sql` contains `PGTAP_FAIL`.
- New cases in the Stop `describe`:
  - blocks a failing pgTAP run on a migration-only turn (exit 2, stderr names `supabase test db`);
  - runs `migration up` before `test db` (call-log order);
  - blocks a migration that fails to apply;
  - blocks an already-applied migration that changed, with stderr naming the file and `db reset --local`, and with no `migration up` or `test db` in the call log;
  - skips with a `systemMessage` and exit 0 when Supabase is down;
  - blocks a failing pgTAP test file change (`supabase/tests/*.sql`) when no migration changed;
  - passes silently for a clean SQL change;
  - never invokes the CLI on a docs-only or code-only turn (empty call log);
  - runs the SQL step once when a registered sibling worktree also has SQL changes.

### Success Criteria:

#### Automated Verification:

- `npm run test:hooks` passes, including every new case listed above
- `npm run lint` passes on the hook and proof files
- With local Supabase running, a scratch migration that drops an RLS policy makes the real Stop hook exit 2 with a pgTAP failure; the scratch file is removed afterwards and the database is reset

#### Manual Verification:

- With `npx supabase stop`, a turn that touches `supabase/tests/*.sql` ends with the "pgTAP skipped" system message and does not block
- In a real agent session, the hook's block message is enough for the agent to fix and re-verify without further guidance

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Docs

### Overview

Bring the test plan, CLAUDE.md and the test stack in line with the wired gates.

### Changes Required:

#### 1. Test plan

**File**: `context/foundation/test-plan.md`

**Intent**: Record the gates as wired and correct the "post-edit" wording to the Stop moment the research established.

**Contract**:

- §3 Phase 4: the Status goes from `researched` to `complete` at close-out, by the orchestrator. The row's description says "end-of-turn hook on migrations".
- §4 e2e row: "Playwright, `npm run test:e2e`, CI `e2e` job".
- §5: the `e2e on US-01` row becomes required (wired) in the CI `e2e` job. The post-edit hook row is renamed to "agent Stop hook (migrations/tests → pgTAP)", local, wired, and its Catches column adds "skips visibly without local Supabase". The pgTAP row adds "local: agent Stop hook".
- §6.1: one line saying the Stop hook runs pgTAP at the end of a turn and blocks on an edited applied migration.
- §6.5: replace TBD with when an e2e earns its place, the seed accounts and env vars, unique tokens, `waitForHydration` before non-idempotent actions, the residue rule and how CI runs it.
- §6.6: the Phase 4 note, including the middleware leftover found and reverted.

#### 2. Project guide

**File**: `CLAUDE.md`

**Intent**: Keep the command, hook and CI descriptions accurate.

**Contract**:

- Commands: add `npm run test:e2e` (needs local Supabase, `.dev.vars` with the `E2E_*` vars).
- `test:hooks` line: the Stop hook also runs `migration up` + `supabase test db` when the turn changed `supabase/migrations` or `supabase/tests` SQL, and skips when Supabase is unreachable.
- CI: `PR` runs four jobs, including `e2e`, and branch protection requires all four.

#### 3. Test stack

**File**: `context/foundation/test-stack.md`

**Intent**: Record the CI command and the employee 2 variables. This file is owned by `/10x-e2e-setup`, so keep it to the lines that changed.

**Contract**: Add a `ci:` line (job `e2e` in `pr.yml`, `npm run test:e2e`, env from seed accounts) and the `E2E_EMPLOYEE*` vars on the auth line.

### Success Criteria:

#### Automated Verification:

- `npx prettier --check context/foundation/test-plan.md context/foundation/test-stack.md CLAUDE.md` passes

#### Manual Verification:

- The §5 rows and the CLAUDE.md CI paragraph match the jobs in `pr.yml` and the hook behaviour

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Branch protection on `master`

### Overview

Make `e2e` a required check, after a green PR run has recorded the context.

### Changes Required:

#### 1. Repository setting (outside git)

**File**: none (GitHub API)

**Intent**: A red `e2e` must block the merge into `master`.

**Contract**:

- `gh api --method POST repos/ssliwa-prunus/10x-Meritly/branches/master/protection/required_status_checks/contexts` with `["e2e"]`. This adds one context and leaves `strict`, admins and reviews unchanged.
- The agent shows the exact command and **asks the user to confirm before running it**. Record the response in the PR description.
- Rollback: remove the `e2e` context before ever deleting the job.

### Success Criteria:

#### Automated Verification:

- `gh api repos/ssliwa-prunus/10x-Meritly/branches/master/protection --jq '.required_status_checks.contexts'` returns exactly `checks`, `smoke`, `integration` and `e2e` (order-insensitive)

#### Manual Verification:

- The PR page lists `e2e` as Required

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- Hook proof (`npm run test:hooks`): every branch of the pgTAP step against a stubbed CLI (Phase 2 list).

### Integration Tests:

- Real Stop hook against the real local Supabase with a scratch migration that breaks an RLS policy (Phase 2 automated criterion).
- The e2e suite against local Supabase plus the production preview, locally and in CI.

### Manual Testing Steps:

1. Run `npx supabase stop`, end a turn that touched a SQL test, and confirm the skip message appears without a block.
2. Plant a fault on the employee-view path, run `npm run test:e2e`, and confirm it goes red on the expected assertion. Then revert.
3. Open the failed-run artifact from a CI run and check the trace.

## Performance Considerations

- The Stop hook gains about 1 s (`migration list`) plus `migration up` plus about 3 s (`test db`), and only on turns with SQL changes. The 180 s timeout still covers `astro check` (~35 s) plus this.
- The `e2e` job runs in parallel with the other three. It adds wall time only if it outlasts `integration` (~2.5 min).

## Migration Notes

- No schema changes. Local developers need `E2E_EMPLOYEE2_USERNAME` / `E2E_EMPLOYEE2_PASSWORD` in `.dev.vars` (see `.env.example`).

## References

- Research: `context/changes/testing-e2e-gates-wiring/research.md`
- Workflow precedent: `context/archive/2026-10-10-new-pr-ci-cd-workflow/plan.md`
- `smoke` job template: `.github/workflows/pr.yml:34-62`
- Stop hook: `.claude/hooks/end-of-turn.mjs:167-235`
- Hook proof: `scripts/__tests__/agent-hooks.test.ts:19-95,226-332`
- US-01 spec: `tests/e2e/us-01-approved-bonus-visible-only-to-its-employee.spec.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: US-01 spec and the CI `e2e` job

#### Automated

- [x] 1.1 `git diff src/middleware.ts` is empty, and `npx playwright test tests/e2e/seed.spec.ts` passes locally
- [x] 1.2 `npm run test:e2e` passes locally against local Supabase (setup, seed, US-01)
- [x] 1.3 A planted fault on the employee-view path turns US-01 red locally and names the failing assertion; reverting it turns the suite green
- [x] 1.4 `npm run lint`, `npx astro check` and `npm test` pass
- [ ] 1.5 The PR run shows `e2e` green next to `checks`, `smoke` and `integration`

#### Manual

- [ ] 1.6 The `e2e` job log shows no secrets used, and on a failed run the uploaded report opens with a trace

### Phase 2: pgTAP in the Stop hook

#### Automated

- [ ] 2.1 `npm run test:hooks` passes, including every new case listed above
- [ ] 2.2 `npm run lint` passes on the hook and proof files
- [ ] 2.3 With local Supabase running, a scratch migration that drops an RLS policy makes the real Stop hook exit 2 with a pgTAP failure; the scratch file is removed afterwards and the database is reset

#### Manual

- [ ] 2.4 With `npx supabase stop`, a turn that touches `supabase/tests/*.sql` ends with the "pgTAP skipped" system message and does not block
- [ ] 2.5 In a real agent session, the hook's block message is enough for the agent to fix and re-verify without further guidance

### Phase 3: Docs

#### Automated

- [ ] 3.1 `npx prettier --check context/foundation/test-plan.md context/foundation/test-stack.md CLAUDE.md` passes

#### Manual

- [ ] 3.2 The §5 rows and the CLAUDE.md CI paragraph match the jobs in `pr.yml` and the hook behaviour

### Phase 4: Branch protection on `master`

#### Automated

- [ ] 4.1 `gh api repos/ssliwa-prunus/10x-Meritly/branches/master/protection --jq '.required_status_checks.contexts'` returns exactly `checks`, `smoke`, `integration` and `e2e` (order-insensitive)

#### Manual

- [ ] 4.2 The PR page lists `e2e` as Required
