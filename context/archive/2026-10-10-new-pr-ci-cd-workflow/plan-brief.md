# PR Validation Workflow — Plan Brief

> Full plan: `context/changes/new-pr-ci-cd-workflow/plan.md`

## What & Why

Add a dedicated GitHub Actions workflow (`pr.yml`) that checks every pull request into `master` or `develop` and blocks the merge into `master` when a check fails. Today's workflow skips the Vitest unit and Mailpit integration suites, ignores PRs into `develop`, and is advisory only, because `master` has no branch protection.

## Starting Point

`.github/workflows/ci.yml` runs on push and PR to `master`. Its `ci` job runs lint, `lint:ui`, `astro check` and build. Its `smoke` job runs pgTAP and the production-preview smoke. Node is `22` instead of `.nvmrc` 22.22.3, the Supabase CLI is `setup-cli` `latest`, and there are no `permissions` or `concurrency` settings. Unit and integration tests run only locally. `test-plan.md` §5 defers wiring them into CI to rollout Phase 4.

## Desired End State

Each PR into `master`/`develop` shows three green checks from the "PR" workflow: `checks`, `smoke` and `integration`. Each one goes red when its gate breaks. `ci.yml` only guards pushes to `master`. `master` requires the three checks before merge. `CLAUDE.md` and `test-plan.md` describe this setup.

## Key Decisions Made

| Decision             | Choice                                                      | Why (1 sentence)                                                                                       |
| -------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Workflow shape       | New `pr.yml`; `ci.yml` push-only                            | A distinct PR gate with clear check names and no duplicate runs; step duplication accepted             |
| Target branches      | `master` and `develop`                                      | Feature work merged into `develop` gets checked before the release PR                                  |
| Added gates          | Vitest unit + Vitest integration (Mailpit)                  | Delivers the CI-wiring part of test-plan §3 Phase 4 for both suites                                    |
| Integration layout   | Separate parallel `integration` job                         | Keeps `smoke` lean, keeps failures distinguishable, adds little wall time                              |
| Enforcement          | Protect `master` (3 required checks); no deploy             | Makes red checks block merges; CD waits for a deploy plan and access-protected previews                |
| Protection details   | Admins can bypass, `strict: false`, no required reviews     | Least friction for a solo maintainer; each can be turned on later                                      |
| `develop` protection | None; PR checks into `develop` are advisory                 | Direct pushes to `develop` keep working; the release PR into `master` enforces the gates               |
| `ci.yml` parity      | Add `npm test` to the push-to-`master` `ci` job             | The post-merge guard runs the same gates as the PR `checks` job                                        |
| Secrets              | None in `pr.yml`                                            | `SUPABASE_*` are optional at build (`astro.config.mjs:19-20`), so fork PRs work too                    |
| Supabase CLI         | `npx supabase` from the lockfile (2.117.0)                  | Same CLI locally and in CI; replaces the unpinned `latest`                                             |
| Functions env in CI  | CI-written `--env-file`, Mailpit via the inbucket container | `supabase start` doesn't load function env (CLI docs); `host.docker.internal` doesn't resolve on Linux |

## Scope

**In scope:**

- `pr.yml` with `checks` / `smoke` / `integration` jobs, least-privilege `permissions`, `concurrency`, timeouts, `.nvmrc` Node
- `ci.yml` changed to push-only, with the same pins and `npm test` added
- Branch protection on `master` (after you confirm)
- `CLAUDE.md` CI section and `test-plan.md` §3/§4/§5/§6.4 updates

**Out of scope:** any deploy or PR preview, e2e/Playwright, post-edit hook, Prettier/`npm audit` gates, reusable workflows, Stryker in CI, new tests or app code changes.

## Architecture / Approach

The "PR" workflow fans out three independent jobs on `ubuntu-latest`:

- `checks`: plain Node.
- `smoke`: local Supabase without Mailpit, then pgTAP, build, `astro preview` and `npm run smoke`.
- `integration`: local Supabase with Mailpit and the edge runtime, then a background `supabase functions serve --env-file` with a readiness wait, then `npm run test:integration`.

Every job uses `npm ci` and the lockfile CLI. Check names equal job ids, because Phase 4 pins them as required contexts.

## Phases at a Glance

| Phase                          | What it delivers                                             | Key risk                                                                      |
| ------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 1. PR workflow (checks, smoke) | `pr.yml` with the unit gate; `ci.yml` push-only              | `npx supabase` behaving differently from `setup-cli` on the runner            |
| 2. `integration` job           | Mailpit suite green on PRs, proven to fail on a broken guard | Docker networking between the edge runtime and inbucket; cold-start readiness |
| 3. Docs sync                   | `CLAUDE.md` + `test-plan.md` match the new CI                | Overwriting the uncommitted test-plan Phase 3 edit                            |
| 4. Branch protection           | `master` requires `checks`, `smoke`, `integration`           | A renamed job leaves a required check that never reports                      |

**Prerequisites:** `gh` authenticated with admin rights on `ssliwa-prunus/10x-Meritly`; a feature branch and PR to run the workflow.
**Estimated effort:** ~1–2 sessions; most of the time goes to waiting on CI runs in Phase 2.

## Open Risks & Assumptions

- Assumes the edge-runtime container reaches `supabase_inbucket_10x-astro-starter:8025` on the Supabase Docker network. If not, fall back to an alternative documented in `.env.example`, and note it.
- Assumes the 7-case suite is stable on shared runners (60 s timeouts). Flakiness would argue for retries, not for making the check non-blocking.
- Rollback must remove branch protection first, or merges block on checks that never report.

## Success Criteria (Summary)

- A PR with a broken unit test, RLS rule, smoke path or approval-email guard can't be merged into `master`.
- A clean PR shows three green checks within a few minutes, with no secrets and no duplicate "CI" run.
