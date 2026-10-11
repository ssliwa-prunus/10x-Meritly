---
date: 2026-10-11T18:27:08+02:00
researcher: Claude (Opus 5.5) for ssliwa
git_commit: 00b4e2f
branch: develop
repository: ssliwa-prunus/10x-Meritly
topic: "Ground test-plan Phase 4: US-01 e2e as a required PR check, and pgTAP on agent SQL edits"
tags: [research, e2e, playwright, ci, github-actions, branch-protection, agent-hooks, pgtap, supabase]
status: complete
last_updated: 2026-10-11
last_updated_by: Claude (Opus 5.5)
---

# Research: Phase 4 — US-01 e2e & gates wiring

**Date**: 2026-10-11T18:27:08+02:00
**Researcher**: Claude (Opus 5.5) for ssliwa
**Git Commit**: 00b4e2f (working tree has uncommitted changes, see "Blocker found in the working tree")
**Branch**: develop
**Repository**: ssliwa-prunus/10x-Meritly

## Research Question

Ground rollout Phase 4 of `context/foundation/test-plan.md` (risks cross-cutting #1/#2 and #5/#6):

1. Can the existing US-01 Playwright spec run as a required PR check (local Supabase, build + preview, no secrets), and what does adding it to branch protection on `master` take?
2. How should the `.claude/hooks` gates run pgTAP (`rls_matrix`, `rls_catalog_guard`) when an agent edits a migration or SQL test, and how can `scripts/__tests__/agent-hooks.test.ts` prove it?
3. What in test-plan §5/§6 changes?

Coverage method: all evidence was gathered in the main context (no sub-agents). The scope is three small file sets (one workflow, three hook scripts plus their proof, two specs plus config), all read in full. Two read-only local runs answered the timing questions: `supabase test db` and `supabase status`, against the running local stack. Two read-only `gh` calls returned the CI job times and the current branch protection.

## Summary

- **The US-01 spec needs no product or test change to run in CI.** It already checks the Draft case (0 rows before approval), the own line (exactly 1 row, `1200,00 zł`) and the colleague's figure (no `800,00 zł`) (`tests/e2e/us-01-approved-bonus-visible-only-to-its-employee.spec.ts:141-160`). It needs four env vars, all seeded local accounts with a password published in `supabase/seed.sql:17`, so CI needs no secrets. The edge runtime can be left out: approval commits before the email call, and the "Milestone approved." status shows whatever the email result is (`approve.ts:51-59`, `ApprovalSection.astro:70-74`).
- **CI wiring**: there is no Playwright job, no browser install and no npm script today (`.github/workflows/pr.yml`; `package.json` scripts). The `playwright.config.ts` webServer already builds and starts the preview itself, `forbidOnly`/`retries: 2`/`workers: 1` are already CI-aware, and the config reads `.dev.vars` when present (`playwright.config.ts:7,17-19,34-43`). The `smoke` job's Supabase start and `.dev.vars` steps (`pr.yml:43-53`) are the template to copy. Recommendation: a separate `e2e` job, which gives one required check named `e2e`.
- **Branch protection** on `master` currently requires exactly `checks`, `smoke` and `integration`, with app_id 15368 and `strict: false` (`gh api`, 2026-10-11). Adding `e2e` is an outward-facing repo setting. The precedent is to confirm with the user and apply it only after a green run has recorded the context name (`context/archive/2026-10-10-new-pr-ci-cd-workflow/plan.md:47,201-222`).
- **Hook: corrected guidance.** `supabase test db` tests the local database as it is. An edited migration file is not applied until `supabase migration up --local` (new file) or `supabase db reset --local` (already-applied file) runs. So "run `supabase test db` on a migration edit" alone would test the old schema and pass. The hook has to apply pending migrations first.
- **Hook: Stop, not per edit.** Correction to the test plan's "post-edit hook" label. On this machine, the full pgTAP suite took 2.8 s for 9 files and 660 tests, and the two RLS files took 1.9 s. Speed doesn't force a choice. Two other things do: (a) applying a migration on its first `Edit` records it as applied, so the agent's later edits to the same file never reach the database without a reset; (b) CLAUDE.md requires a migration and its `rls_catalog_guard`/`rls_matrix` updates to land together, so a per-edit run fails on every migration before the agent reaches the test files. The `end-of-turn.mjs` Stop hook with its one retry is the right moment. A scoped subset gains nothing: run the full suite.
- **The hooks can call the CLI without npx**: `node node_modules/supabase/dist/supabase.js` (CLI 2.117.0) works through the existing `runTool` (`.claude/hooks/lib.mjs:47-62`), and `status -o env` answered in 0.9 s. When Supabase isn't reachable, the hook should skip with a visible `systemMessage`, the same pattern as the "no git checkout" case (`end-of-turn.mjs:179-185`). It must not block.
- **Blocker found in the working tree**: `src/middleware.ts:48` has an uncommitted `break; // DELIBERATE BREAK A` in place of `return context.redirect(decision.location);`. This looks like a leftover from the e2e "deliberate break" verification. It must be reverted before this change commits anything. It also shows the gap this phase closes: ESLint, `astro check` and the unit tests all pass with it, and only a browser or smoke run catches it.

## Detailed Findings

### 1. US-01 spec: what it proves today

- Setup as the supervisor (saved `storageState`): a uniquely named project, a milestone with `target_pool 2000`, two engagements (seeded employees `…0031` at 0.60, `…0033` at 0.40, rating 3), and all four KPI scores at 100 (`us-01-…spec.ts:73-127`). The oracle is hand-derived: 1200.00 own, 800.00 colleague (`:42-46`).
- The employee signs in through `/api/auth/signin` in a separate context (`:130-139`).
- Draft: `/my-bonuses` has 0 rows for the project before approval (`:141-144`). Approve through the UI after `waitForHydration` (`:147-151`).
- Approved: exactly 1 row for the project, milestone cell, own bonus `^1200,00\s*zł$`, and no text matching `800,00\s*zł` anywhere on the page (`:154-160`).
- Not covered by this spec: the colleague's (`employee2`) side, and ID-bearing URLs. The ID-bearing URLs are already covered by the smoke IDOR cells (test-plan §6.6 Phase 3 note, `context/foundation/test-plan.md:207`). The reverse direction (employee2 sees only 800.00) would cost one more context. It is optional. The test plan scopes Phase 4 to "the employee sees only their own result", and the one-way check already fails if RLS leaks a colleague's line onto the page.
- Residue: every run leaves one approved project (`:32-34`). In CI the database is fresh per job, so this doesn't matter there.
- Re-run safety under `retries: 2` (`playwright.config.ts:18`): each attempt builds a new `token` from `Date.now()` (`:73`), so a retry after a committed approval creates a new project and doesn't collide with the first.

### 2. Running Playwright in CI without secrets

- Credentials: `auth.setup.ts:6-10` and `seed.spec.ts:10-14` read `E2E_USERNAME`/`E2E_PASSWORD`; the US-01 spec reads `E2E_EMPLOYEE_USERNAME`/`E2E_EMPLOYEE_PASSWORD` (`:68-72`). The seed accounts are `supervisor@meritly.local` and `employee@meritly.local`, with the shared local password `Meritly-Local-Passw0rd!` (`supabase/seed.sql:11-17,47`). `scripts/smoke.mjs:14` already hard-codes the same password, so writing it into the workflow adds no exposure.
- App config: the Cloudflare preview reads `.dev.vars` (`SUPABASE_URL`, `SUPABASE_KEY`). The `smoke` job writes it from `supabase status -o env` (`pr.yml:43-53`). `playwright.config.ts:7` loads `.dev.vars` too, so the E2E vars can be appended there or passed as job `env`.
- webServer: `npm run build && npm run preview -- --port 4321`, `reuseExistingServer: !CI`, 180 s timeout (`playwright.config.ts:34-43`). The job must not start a preview itself, and must not run a separate build (that would build twice).
- Browsers: no install step exists. The job needs `npx playwright install --with-deps chromium`, because the config defines only the `chromium` project (`playwright.config.ts:28-31`).
- Reporter: `html` (`playwright.config.ts:20`). In CI, uploading `playwright-report/` (and `test-results/` traces, `trace: "on-first-retry"`) as an artifact on failure keeps a red run debuggable. `.gitignore:393-399` already ignores those directories.
- Edge runtime: `approve.ts:51-59` commits the approval, then calls `notifyMilestoneApproved`. Any error there becomes a `notice` query parameter, never a rollback (`approvals.ts:333-371`). `ApprovalSection.astro:70-74` renders the `role="status"` "Milestone approved." alert whenever `saved` is set. The notice alert uses the default `role="alert"` (`src/components/ui/alert.tsx:24`), so the spec's `getByRole("status")` filter (`:151`) doesn't pick it up. Inference, not run: with `edge-runtime` excluded the function call fails, the page shows the `email_failed` notice, and the spec still passes. The `smoke` job's exclusion list (`pr.yml:44`) can be reused, keeping `mailpit` excluded.
- Cost: on the last green PR run (38072962428), `smoke` took 2 min 9 s, `integration` 2 min 31 s and `checks` 1 min 11 s, running in parallel. A separate `e2e` job adds wall time only if it is the longest. It is expected to run about as long as `smoke` (Supabase start + build + browser install + 3 tests), which is an estimate, not a measurement.
- Separate job vs folding into `smoke`: folding saves a second `supabase start`. The cost is shared database state between `smoke` (IDOR steps on the seeded "Approved Demo Project", `CLAUDE.md` Commands) and the e2e writes, and one check name for two kinds of failure. The archived workflow change chose one job per gate. Recommendation: separate `e2e` job.

### 3. Branch protection

- Current state (`gh api repos/ssliwa-prunus/10x-Meritly/branches/master/protection`, 2026-10-11): `contexts: ["checks","smoke","integration"]`, each with `app_id: 15368`, `strict: false`.
- Precedent (`context/archive/2026-10-10-new-pr-ci-cd-workflow/plan.md:47,201-230`): turn protection on only after GitHub has recorded the check names from a green run, show the exact `gh api` command, and ask the user to confirm before running it. Verify with `--jq '.required_status_checks.contexts'`. Rollback note (`:264`): remove a required context before deleting its job, or merges block on a check that never reports.
- For adding one context, the narrow call is `POST …/branches/master/protection/required_status_checks/contexts` with `["e2e"]`. It leaves the other settings unchanged, whereas the PUT on the whole protection object would reset them.
- `develop` has no protection by design (`plan.md:41`), so the e2e check stays advisory on PRs into `develop`.
- Doc drift: the git status context names `main` as the main branch, but the workflows and protection use `master` (`pr.yml:5`, `CLAUDE.md` CI section). Use `master`.

### 4. Hooks: where pgTAP fits

- Today `supabase/` SQL never reaches a check. `LINTED` matches only `ts|tsx|js|jsx|mjs|cjs|astro` (`.claude/hooks/lib.mjs:12`). `check-edited-file.mjs:106` exits 0 for any other extension. `end-of-turn.mjs:203-205` filters changed files to `LINTED` and `continue`s when none match, so a migration-only turn runs nothing. The pgTAP step must sit before that `continue`.
- The Stop hook sees changes from `git diff --name-only HEAD` plus untracked files (`end-of-turn.mjs:189-195`). That covers migrations written through Bash as well as through Edit. It also sweeps registered sibling worktrees (`:174-177`), but a worktree shares the one local database, so pgTAP should run once per turn, not once per root.
- Apply-before-test: `supabase test db [<path...>]` "Tests local database with pgTAP" (CLI 2.117.0 `test db --help`). `supabase migration up --local` "Apply pending migrations to local database" (`migration up --help`). `migration list --local` showed all 14 local migrations applied. So:
  - a **new** migration file needs `migration up --local` before the tests can see it;
  - an **edited, already-applied** migration is invisible to `migration up` and needs `db reset --local`, which wipes local data and reseeds (`CLAUDE.md` Commands). A hook should not run that on its own. It should block with a message telling the agent to run `npx supabase db reset --local`, or to put the change in a new migration (the safer default, because applied migrations are history);
  - a `migration up` failure (SQL error) is a check result in its own right. Report it on stderr with exit 2, like the other gates.
- Telling the cases apart: in `migration list --local` (JSON on this CLI), a changed file whose version has `remote` set is already applied; a version with `local` only is pending. Alternative: run `migration up`, then compare. The plan should pick one.
- Timing (this machine, local stack running): `test db` with all 9 files and 660 tests took 2.8 s wall time; `test db` with `rls_matrix` and `rls_catalog_guard` (2 files, 260 tests) took 1.9 s; `status -o env` took 0.9 s. The Stop hook's timeout is 180 s (`.claude/settings.json`), and `astro check` takes about 35 s (`end-of-turn.mjs:220`), so the full suite fits. A scoped subset saves under a second. Run the full suite, so a migration that breaks `payout_correctness` is caught too.
- Test isolation: each of the 9 test files contains a `rollback` (grep count 1 per file), so running them leaves no rows behind.
- Reachability: `status -o env` prints `API_URL`/`DB_URL` when the stack is up. What it prints when the stack is down, and its exit code, were **not observed** (the stack wasn't stopped for this research). Cheaper alternative: a TCP probe of `127.0.0.1:54322`, the `[db] port` in `supabase/config.toml:29`. When the stack is unreachable, the hook should exit 0 with `{"systemMessage": "…pgTAP skipped: local Supabase not reachable…"}` on stdout, like `end-of-turn.mjs:179-185`, because Docker may simply be off. CI's `smoke` job remains the hard gate.
- Invocation: `runTool(root, "node_modules/supabase/dist/supabase.js", ["test","db"])` fits the existing helper (`lib.mjs:47-62`): no npx, which `lib.mjs:45` notes costs about 40 s per call on Windows, and a missing binary fails visibly. `PLAIN_ENV` sets `CI=1` (`lib.mjs:9`). The CLI printed an update banner on stdout and stderr; it is harmless in a failure message.
- Which paths should trigger it: `supabase/migrations/*.sql` and `supabase/tests/*.sql` for sure. Possibly `supabase/seed.sql`: tests don't depend on it unless they read seeded rows, and it only applies on reset. The plan should decide.

### 5. Proving the hook (`scripts/__tests__/agent-hooks.test.ts`)

- Pattern: the real hook runs inside a throwaway git repo with a stubbed toolchain under `node_modules/…`. Each stub flags a marker string (`agent-hooks.test.ts:19-45,56-70`). A Supabase stub fits the same way: `node_modules/supabase/dist/supabase.js` that fails `test db` when any `supabase/**/*.sql` file contains `PGTAP_FAIL`, fails `migration up` on `MIGRATION_ERROR`, and answers `status`/`migration list` according to a `SUPABASE_DOWN` marker file. Reachability needs a stubbable seam. A TCP probe can't be stubbed through `node_modules`. If the plan picks the probe, make the port overridable by env, or probe through the CLI.
- Cases to add, following the existing names: blocks a failing pgTAP run on a migration-only turn (exit 2, stderr names `supabase test db`); applies a new migration before testing (the stub records the call order); blocks a migration SQL error; blocks or asks for a reset when an already-applied migration changed; skips with a `systemMessage` and exit 0 when Supabase is unreachable; does nothing for a docs-only turn (the existing case at `:234-238` must still pass, so README changes must not start Supabase); runs once even with a registered sibling worktree.
- `makeRepo` commits no `supabase/` folder (`:72-95`), so the existing cases are unaffected unless the new code runs on every Stop. It must not.
- The Stop hook re-runs this proof when any hook file changes (`end-of-turn.mjs:197-201`, `HOOK_PROOF_SCOPE` at `lib.mjs:18-19`). No wiring change is needed there.

### 6. Test plan §5/§6 changes

- §5 rows to update (`context/foundation/test-plan.md:117-118`): "e2e on US-01 | CI on PR | required after §3 Phase 4" becomes required (wired) in the `e2e` job. "post-edit hook (migrations → pgTAP) | local (agent loop) | recommended" becomes a Stop-hook gate (end of turn, applies pending migrations, skips visibly without local Supabase). Also: the `pgTAP` row (`:113`) can add "local: agent Stop hook".
- §4 Stack row for e2e (`:95`) still says "none yet — see Phase 4".
- §6.5 (`:197-199`) is "TBD". Fill it from `context/foundation/test-stack.md` and the US-01 spec: when an e2e earns its place (auth cookie + RLS + page), seed accounts, unique tokens, no `waitForTimeout`, `waitForHydration` before non-idempotent actions, the residue rule, and how CI runs it.
- §6.1 (`:126-137`) can add one line: the Stop hook runs pgTAP locally at the end of an agent turn.
- §6.6 gets the Phase 4 note at close-out. §3 Status goes from `change opened` to `researched` (this file).

## Code References

- `.github/workflows/pr.yml:34-62` — `smoke` job: Supabase start with exclusions, `supabase test db`, `.env`/`.dev.vars`, build, preview, smoke
- `playwright.config.ts:7,17-20,26-43` — `.dev.vars` load, CI switches, projects, webServer
- `tests/e2e/us-01-approved-bonus-visible-only-to-its-employee.spec.ts:61-165` — US-01 flow and assertions
- `tests/e2e/auth.setup.ts:5-27` — supervisor `storageState`
- `supabase/seed.sql:11-17` — seeded accounts and shared local password
- `src/pages/api/projects/[id]/milestones/[milestoneId]/approve.ts:51-59` — approval commits before notify
- `src/lib/services/approvals.ts:333-371` — `emailNotice`, `notifyMilestoneApproved`
- `src/components/milestones/ApprovalSection.astro:70-79` — status vs notice alerts
- `.claude/hooks/lib.mjs:9-19,47-62` — scopes, `runTool`
- `.claude/hooks/check-edited-file.mjs:106,120` — per-edit filters
- `.claude/hooks/end-of-turn.mjs:171,189-205,225` — retry guard, change sweep, code-only `continue`, block
- `.claude/settings.json` — PostToolUse 60 s, Stop 180 s timeouts
- `scripts/__tests__/agent-hooks.test.ts:19-70,226-332` — stubs and Stop cases
- `supabase/config.toml:29` — local DB port 54322
- `src/middleware.ts:48` — uncommitted deliberate break (revert)

## Architecture Insights

- Gates are layered by moment. Per edit runs cheap checks on one file. Stop runs the whole-turn checks with one retry. Pre-commit runs lint-staged. CI is the hard gate. pgTAP needs the database to be at the edited schema, which makes it a whole-turn check, so it belongs at Stop.
- Hooks never use npx and call repo-local binaries through `runTool`. Missing tools fail visibly. "Nothing to check" exits 0 silently. "Could not check" exits 0 with a `systemMessage`.
- CI needs no secrets for anything that runs against local Supabase. Seeded local credentials are public by design.

## Historical Context (from prior changes)

- `context/archive/2026-10-10-new-pr-ci-cd-workflow/plan.md` — created `pr.yml` and branch protection. Its claim that branch protection must wait for a green run holds: the contexts are recorded with `app_id 15368`. Its claim that `develop` stays unprotected also holds (`gh api` shows protection on `master` only, by design).
- Test-plan §3 Phase 4 row: "CI gate wiring delivered by `new-pr-ci-cd-workflow`; e2e + post-edit hook remain" is supported. The "post-edit hook" wording is partially contradicted: research recommends the Stop moment (see §4 above).
- Commit 00b4e2f (agent quality-gate hooks): its own CLAUDE.md line says "supabase/ SQL not covered". Supported by `lib.mjs:12`.

## Related Research

- `context/archive/2026-10-07-testing-rls-matrix/` — origin of `rls_matrix` / `rls_catalog_guard`
- `context/archive/2026-10-10-testing-route-gating-notification/` — smoke IDOR cells that the e2e does not need to repeat

## Open Questions

1. When an already-applied migration file is edited, should the Stop hook block with a reset instruction (recommended), or skip with a warning? The hook must never run `db reset` itself.
2. Reachability probe: CLI `status` (stubbable, ~0.9 s, down-state output not observed) or a TCP probe of 54322 (fast, needs an env seam for the proof)?
3. Should `supabase/seed.sql` edits trigger pgTAP?
4. Should the e2e add the reverse direction (employee2 sees only 800.00)? Optional, about one more browser context.
5. Applying the `e2e` required context to `master` is outward-facing and needs explicit user confirmation, after the first green `e2e` run.
