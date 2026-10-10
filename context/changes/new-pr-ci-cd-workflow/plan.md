# PR Validation Workflow Implementation Plan

## Overview

Add `.github/workflows/pr.yml`, a dedicated GitHub Actions gate for pull requests into `master` and `develop`. It runs three parallel jobs: `checks` (lint, `lint:ui`, `astro check`, Vitest unit, build), `smoke` (pgTAP + production-preview smoke) and `integration` (the Mailpit email suite). `ci.yml` becomes a push-to-`master` guard only. Once the new checks have run green, `master` requires all three before merge. Deployment stays out of scope.

## Current State Analysis

- `.github/workflows/ci.yml` already runs on `push` and `pull_request` to `master`, with two jobs: `ci` (sync, lint, `lint:ui`, `astro check`, build with `SUPABASE_URL`/`SUPABASE_KEY` secrets) and `smoke` (local Supabase without mailpit/edge-runtime, `supabase test db`, build, preview, `npm run smoke`). Recent runs are green (~2 min).
- Gaps:
  - `npm test` (Vitest unit, `src/lib/__tests__/*.test.ts`) is not run in CI.
  - `npm run test:integration` is local-only.
  - PRs into `develop` are not validated.
  - `master` has no branch protection (GitHub API: "Branch not protected"), so a red check does not block a merge.
  - Node is `22` instead of `.nvmrc` 22.22.3.
  - The Supabase CLI comes from `supabase/setup-cli@v1` with `version: latest` (unpinned).
  - No `permissions`, `concurrency` or `timeout-minutes`.
- The repository is public (`ssliwa-prunus/10x-Meritly`, default branch `master`). Fork PRs get no secrets, so a job that needs repository secrets would fail for them.
- No Worker deployment exists yet (`context/deployment/` absent; `infrastructure.md` lists CI/CD as out of scope and warns that Workers previews are public and would expose compensation data).

## Desired End State

Every PR into `master` or `develop` shows three checks (`checks`, `smoke`, `integration`) from the "PR" workflow. All three are green on a clean PR, and each one fails when its gate is broken. A push to `master` still runs the existing two-job "CI" workflow. `master` refuses a PR merge until all three PR checks pass. `CLAUDE.md` and `test-plan.md` describe this accurately.

### Key Discoveries:

- `astro.config.mjs:19-20` declares `SUPABASE_URL` / `SUPABASE_KEY` as `optional: true`, so `npm run build` needs no secrets. The PR workflow uses none, which keeps it fork-safe.
- `package.json:62`: `supabase` is a devDependency, locked at 2.117.0 in `package-lock.json`. `npx supabase` after `npm ci` pins the CLI to the version used locally, replacing `setup-cli` `latest`.
- Supabase CLI docs (Context7, `/supabase/cli`, checked 2026-10-10): `supabase start` runs the edge runtime with `discoverFunctionEnvFiles: false` and no env file. Only `supabase functions serve` reads `supabase/functions/.env` (or `--env-file`, which takes precedence). So the integration job must run `functions serve` with an env file.
- `supabase/functions/.env.example`: when the edge-runtime container cannot reach `host.docker.internal` (true on Linux runners), point `MAILPIT_URL` at the inbucket container, `http://supabase_inbucket_10x-astro-starter:8025` (`project_id = "10x-astro-starter"`, `supabase/config.toml:5`).
- `tests/integration/notify-milestone-approved.integration.test.ts:22-36,262`: requires `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; `MAILPIT_URL` defaults to `http://127.0.0.1:54324`. It fails (never skips) when a variable is missing or Mailpit is unreachable.
- `context/foundation/test-plan.md` §5: Vitest unit becomes "required after §3 Phase 4 (CI wiring)", and integration "required after §3 Phase 4 if CI starts mailpit + edge-runtime". This change delivers that CI-wiring part of Phase 4. The e2e and post-edit-hook parts stay in Phase 4.

## What We're NOT Doing

- No deployment of any kind: no `wrangler deploy`, no `wrangler versions upload` preview per PR, no `CLOUDFLARE_API_TOKEN`.
- No e2e/Playwright job (§3 Phase 4, Lesson 4), and no post-edit hook.
- No Prettier `--check` and no `npm audit` gate.
- No reusable `workflow_call` workflow. `pr.yml` and `ci.yml` keep their own job steps (accepted duplication).
- No `include admins` (`enforce_admins`) on branch protection, so admins can still bypass. No "require branches to be up to date" (`strict: false`). No required reviews. All three can be switched on later in repo settings.
- No branch protection on `develop`. PR checks into `develop` are advisory, so direct pushes to `develop` keep working, and the release PR into `master` enforces the gates.
- No Stryker mutation run in CI (it stays a selective local gate per CLAUDE.md).
- No change to the tests themselves or to application code.

## Implementation Approach

Build `pr.yml` incrementally on a feature branch and let each phase prove itself on a real PR run. Phase 1 moves today's two jobs into the PR workflow with hardening and the unit gate. Phase 2 adds the integration job. Phase 3 syncs the docs. Phase 4 turns on branch protection only after GitHub has recorded the three check names from a green run, because required-check contexts must match the job names exactly.

## Critical Implementation Details

- **Check names are the contract for Phase 4.** The required status check contexts are the job names (`checks`, `smoke`, `integration`). Renaming a job later silently leaves a required check that never reports, which blocks every merge. Use job `id`s without `name:` overrides, or keep them identical.
- **`pull_request` uses the PR head's workflow file.** The `ci.yml` trigger change and the new `pr.yml` take effect on the PR that introduces them, so the introducing PR already exercises `pr.yml`.
- **Functions readiness.** `supabase functions serve` runs in the background. The job must wait until the function endpoint answers (not 502/connection refused) before starting the suite, or the first test fails on a cold start. Bound the wait (~60 s) and fail with the serve log if it never becomes ready.

## Phase 1: PR workflow with `checks` and `smoke`

### Overview

Create the PR gate with the existing gates plus Vitest unit, hardened and pinned, and make `ci.yml` push-only.

### Changes Required:

#### 1. PR workflow

**File**: `.github/workflows/pr.yml` (new)

**Intent**: Give every PR into `master`/`develop` a dedicated, least-privilege, self-cancelling validation run that adds the unit gate and needs no secrets.

**Contract**:

- `name: PR`; trigger `pull_request` with `branches: [master, develop]` (default activity types).
- Top-level `permissions: contents: read`.
- `concurrency`: group keyed on workflow + PR number, `cancel-in-progress: true`.
- Every job: `runs-on: ubuntu-latest`, `timeout-minutes` (≈10 for `checks`, ≈20 for `smoke`), `actions/setup-node` with `node-version-file: .nvmrc` and `cache: npm`, then `npm ci`.
- Job `checks`: `npx astro sync`, `npm run lint`, `npm run lint:ui`, `npx astro check`, `npm test`, `npm run build` (no `env` secrets).
- Job `smoke`: same steps as `ci.yml`'s `smoke` job, but the Supabase CLI comes from the lockfile (`npx supabase start …`, `npx supabase status`, `npx supabase test db`, `npx supabase stop` under `if: always()`). Drop `supabase/setup-cli`.

#### 2. CI workflow becomes push-only

**File**: `.github/workflows/ci.yml`

**Intent**: Stop duplicate runs on PRs and keep a post-merge guard on `master` aligned with the PR workflow's pins.

**Contract**: remove the `pull_request` trigger (keep `push: branches: [master]`). Add the same `permissions`, Node pin (`node-version-file: .nvmrc`) and lockfile-pinned `npx supabase` in place of `setup-cli` `latest`. Job names `ci` and `smoke` stay unchanged. The `ci` job adds `npm test` after `npx astro check`, so the post-merge guard on `master` runs the same gates as the PR `checks` job. Its other gates stay unchanged.

### Success Criteria:

#### Automated Verification:

- `ci.yml`'s `ci` job contains an `npm test` step
- Both workflow files pass `npx --yes actionlint` (or, if unavailable on Windows, `gh workflow view` after push lists them without a parse error)
- Local gates the `checks` job runs all pass: `npx astro sync && npm run lint && npm run lint:ui && npx astro check && npm test && npm run build`
- On the PR that introduces the change, the "PR" workflow reports `checks` and `smoke` green
- That PR does not trigger the "CI" workflow (`gh run list --workflow CI` shows no `pull_request` run for it)

#### Manual Verification:

- The `smoke` job log shows the Supabase CLI version 2.117.0 (lockfile), not a `setup-cli` download
- Pushing a second commit to the PR cancels the in-flight run (concurrency)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: `integration` job (Mailpit email suite)

### Overview

Run `npm run test:integration` on every PR against a local Supabase with Mailpit and the edge runtime, with `notify-milestone-approved` served from a CI-written env file.

### Changes Required:

#### 1. Integration job

**File**: `.github/workflows/pr.yml`

**Intent**: Turn the approval-email oracle (one email per employee, own figures only, no Draft or unauthorised sends, no duplicates) into a PR gate, in its own parallel job so it doesn't slow or obscure `smoke`.

**Contract**: job `integration` (`timeout-minutes` ≈20, same Node/`npm ci` setup), with these steps:

1. `npx supabase start`, excluding only services the suite does not use (keep `mailpit`/inbucket, `edge-runtime`, auth, rest, db, kong). Studio, imgproxy, logflare, vector, realtime, storage-api, postgres-meta and supavisor may stay excluded, provided the suite passes.
2. Write a CI-only functions env file (in the runner temp dir, never committed) with `APP_URL=http://localhost:4321`, empty `RESEND_API_KEY`/`MAIL_FROM` (forces the Mailpit transport), and `MAILPIT_URL=http://supabase_inbucket_10x-astro-starter:8025`.
3. Start `npx supabase functions serve --env-file <that file>` in the background with output redirected to a log file, then poll the function endpoint until it answers (bounded, ~60 s).
4. Export `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` from `npx supabase status -o env` (`API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`) and `MAILPIT_URL=http://127.0.0.1:54324`, then run `npm run test:integration`.
5. On failure, print the functions serve log. Under `if: always()`, run `npx supabase stop --no-backup`.

The service-role key exists only inside this ephemeral runner's local Supabase. It is not a repository secret and never reaches the app build.

### Success Criteria:

#### Automated Verification:

- `npx --yes actionlint` (or `gh workflow view`) still parses `pr.yml`
- On the PR, the "PR" workflow reports `integration` green, and its log shows all 7 cases of `notify-milestone-approved.integration.test.ts` passing
- `checks` and `smoke` stay green

For 2.4: on a throwaway commit (not merged), remove the `status !== "approved"` guard in `supabase/functions/notify-milestone-approved/index.ts`. Case 3 then gets 200 instead of 409. `integration` runs in parallel with `smoke`, which is what bounds 2.5.

#### Manual Verification:

- Prove it can fail: guard removal turns `integration` red on case 3, revert turns it green
- The `integration` job's wall time keeps the overall PR run within ~5 min

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Docs sync

### Overview

Make `CLAUDE.md` and `test-plan.md` describe the new CI shape so future agents and reviewers rely on the right gates.

### Changes Required:

#### 1. CLAUDE.md CI section

**File**: `CLAUDE.md` (`## CI`)

**Intent**: Replace the outdated "runs on every push and PR to master" sentence with the new two-workflow shape.

**Contract**: one short paragraph covering:

- `pr.yml` on PRs into `master`/`develop`, with jobs `checks` / `smoke` / `integration`, no secrets.
- `ci.yml` on push to `master`.
- Supabase CLI pinned by the lockfile (`npx supabase`).
- `master` requires the three PR checks.

Also fix the `npm run smoke` and `npm run test:integration` command notes that say "CI runs it…" or "not part of … CI" so they match. Keep it to existing sections only.

#### 2. Test plan

**File**: `context/foundation/test-plan.md`

**Intent**: Record that the CI-wiring part of §3 Phase 4 is delivered, without changing the risk strategy.

**Contract**:

- §5 Quality Gates rows "Vitest unit" and "Vitest integration": Where → CI `checks` / `integration` jobs on PR; Required → "required (wired)" with this change-id.
- §6.4 last line ("Not in CI until §3 Phase 4 …"): now runs in the PR workflow's `integration` job.
- §3 Phase 4 row: Goal/notes say CI gate wiring was delivered by `new-pr-ci-cd-workflow`, and e2e + post-edit hook remain. Status stays `not started`.
- §4 Stack row "integration (TS)": "local only" becomes "local + CI (PR `integration` job)".

The existing uncommitted Phase 3 status edit in the working tree is preserved, not reverted.

### Success Criteria:

#### Automated Verification:

- `npx prettier --check CLAUDE.md context/foundation/test-plan.md` passes
- `grep -n "PR to master" CLAUDE.md` returns nothing (outdated wording gone)

#### Manual Verification:

- Reading `CLAUDE.md` `## CI` and `test-plan.md` §5 alone, a newcomer can tell which gates block a PR

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Branch protection on `master`

### Overview

Make the three PR checks block merges into `master`. Run this only after a PR run has reported all three green, so GitHub knows the check contexts.

### Changes Required:

#### 1. Repository setting (outside git)

**File**: none (GitHub repository settings via `gh api`)

**Intent**: A red PR check must block the merge into `master`. Today it is advisory.

**Contract**: `PUT repos/ssliwa-prunus/10x-Meritly/branches/master/protection` with:

- `required_status_checks: { strict: false, contexts: ["checks", "smoke", "integration"] }`
- `enforce_admins: false`
- `required_pull_request_reviews: null`
- `restrictions: null`

The agent shows the exact command and **asks the user to confirm before running it** (outward-facing, outside git). Record the applied JSON (the `gh api` response) in the PR description for traceability.

### Success Criteria:

#### Automated Verification:

- `gh api …/branches/master/protection` required contexts are exactly `checks`, `smoke`, `integration`

Check 4.1 with `gh api repos/ssliwa-prunus/10x-Meritly/branches/master/protection --jq '.required_status_checks.contexts'` (order-insensitive).

#### Manual Verification:

- On the open PR into `master`, the merge box lists `checks`, `smoke` and `integration` as required
- Merging the change's PR into `master` succeeds with all three green, and the follow-up push run of "CI" on `master` is green

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

- No new tests. The `checks` job runs the existing `npm test` suite (`src/lib/__tests__/`, `src/lib/services/__tests__/`).

### Integration Tests:

- No new tests. The `integration` job runs the existing 7-case Mailpit suite. Its failure mode is proved by the guard-removal check in Phase 2.

### Manual Testing Steps:

1. Open the change's PR into `develop` (or `master`) and confirm the "PR" workflow shows three checks and no "CI" run.
2. Push a deliberate unit-test break (throwaway commit): `checks` goes red, then revert.
3. Run the Phase 2 guard-removal check: `integration` goes red, then revert.
4. After Phase 4, confirm the merge box requires the three checks.

## Performance Considerations

`integration` and `smoke` each boot Docker-based Supabase in parallel, roughly 2–4 runner minutes each per PR. That's acceptable for a public repo (free Actions minutes). `concurrency` cancels superseded runs.

## Migration Notes

Rollback means reverting the commit: `ci.yml` regains its `pull_request` trigger and `pr.yml` disappears. Before reverting, delete the branch protection or remove the three contexts, otherwise merges block on checks that never report.

## References

- Existing workflow: `.github/workflows/ci.yml`
- Gate definitions: `context/foundation/test-plan.md` §3 Phase 4, §5, §6.4
- Integration suite: `tests/integration/notify-milestone-approved.integration.test.ts`, `vitest.integration.config.ts`
- Functions env: `supabase/functions/.env.example`; `supabase/config.toml:5,99,358,377`
- Optional build secrets: `astro.config.mjs:19-20`
- Supabase CLI env loading: Context7 `/supabase/cli` (`functions serve` vs `start`), checked 2026-10-10
- Deploy constraints (why no CD): `context/foundation/infrastructure.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: PR workflow with `checks` and `smoke`

#### Automated

- [x] 1.1 `ci.yml`'s `ci` job contains an `npm test` step — f9caa4f
- [x] 1.2 Both workflow files pass `npx --yes actionlint` (or, if unavailable on Windows, `gh workflow view` after push lists them without a parse error) — f9caa4f
- [x] 1.3 Local gates the `checks` job runs all pass: `npx astro sync && npm run lint && npm run lint:ui && npx astro check && npm test && npm run build` — f9caa4f
- [x] 1.4 On the PR that introduces the change, the "PR" workflow reports `checks` and `smoke` green — f9caa4f
- [x] 1.5 That PR does not trigger the "CI" workflow (`gh run list --workflow CI` shows no `pull_request` run for it) — f9caa4f

#### Manual

- [x] 1.6 The `smoke` job log shows the Supabase CLI version 2.117.0 (lockfile), not a `setup-cli` download — f9caa4f
- [x] 1.7 Pushing a second commit to the PR cancels the in-flight run (concurrency) — f9caa4f

### Phase 2: `integration` job (Mailpit email suite)

#### Automated

- [x] 2.1 `npx --yes actionlint` (or `gh workflow view`) still parses `pr.yml` — 18f96c0
- [x] 2.2 On the PR, the "PR" workflow reports `integration` green, and its log shows all 7 cases of `notify-milestone-approved.integration.test.ts` passing — 18f96c0
- [x] 2.3 `checks` and `smoke` stay green — 18f96c0

#### Manual

- [x] 2.4 Prove it can fail: guard removal turns `integration` red on case 3, revert turns it green — 18f96c0
- [x] 2.5 The `integration` job's wall time keeps the overall PR run within ~5 min — 18f96c0

### Phase 3: Docs sync

#### Automated

- [x] 3.1 `npx prettier --check CLAUDE.md context/foundation/test-plan.md` passes
- [x] 3.2 `grep -n "PR to master" CLAUDE.md` returns nothing (outdated wording gone)

#### Manual

- [x] 3.3 Reading `CLAUDE.md` `## CI` and `test-plan.md` §5 alone, a newcomer can tell which gates block a PR

### Phase 4: Branch protection on `master`

#### Automated

- [ ] 4.1 `gh api …/branches/master/protection` required contexts are exactly `checks`, `smoke`, `integration`

#### Manual

- [ ] 4.2 On the open PR into `master`, the merge box lists `checks`, `smoke` and `integration` as required
- [ ] 4.3 Merging the change's PR into `master` succeeds with all three green, and the follow-up push run of "CI" on `master` is green
