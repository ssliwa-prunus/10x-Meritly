# AI Code Review in CI — Plan Brief

> Full plan: `context/changes/ci-cd-code-review/plan.md`
> Research: `context/changes/ci-cd-code-review/research.md`

## What & Why

Run the existing `packages/code-reviewer` agent on every new pull request, so each PR gets a scored review comment and a pass/fail label without a human starting it. The scores follow the six criteria in `requirements.md`.

## Starting Point

The reviewer works as a local CLI (diff in, JSON out) but has no scores, ignores PR title and description at the CLI level, and drops token usage. `.github/workflows/review.yml` is an empty file and there is no composite action.

## Desired End State

Opening a PR to `master` or `develop` produces one bot comment (edited on reruns) with six 1-10 scores, a summary and findings, plus the label `ai-cr:passed` or `ai-cr:failed`. Adding `ai-cr:review` re-runs the review. The job is advisory and never blocks merging.

## Key Decisions Made

| Decision         | Choice                                                                    | Why (1 sentence)                                                       | Source   |
| ---------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------- |
| Pass rule        | All six scores >= 6 and security >= 7                                     | Simple to explain and stricter on the criterion that matters most here | Plan     |
| Inputs           | Title, description and diff                                               | Description is cheap relative to the diff and adds intent              | Plan     |
| Triggers         | PRs to `master` and `develop`; `opened`, `reopened`, label `ai-cr:review` | Matches `pr.yml`; no per-push reviews keeps cost down                  | Plan     |
| Output contract  | Scores + summary + findings, no `verdict`                                 | One source of truth, so label and verdict cannot disagree              | Plan     |
| Comment          | One comment edited via hidden marker                                      | Clean PR thread with current results                                   | Plan     |
| Failure handling | Advisory; reviewer error posts an error comment, no label                 | A flaky model cannot block merges                                      | Plan     |
| Cost control     | Truncate diff at 60000 chars, log usage every run                         | Bounds spend with no new infrastructure                                | Plan     |
| Tests            | Vitest unit tests for pure logic; workflow verified on a real PR          | Covers the risky rules without API cost                                | Plan     |
| Fork PRs         | Skipped                                                                   | Secrets are unavailable to forks                                       | Research |

## Scope

**In scope:** scoring schema and prompt, pass/fail evaluator, truncation, comment rendering, CLI inputs and usage, composite action, workflow, docs.

**Out of scope:** business-alignment and architecture criteria, review on every push, required status check, agent tools, fork PRs, hard spend cap in the repo.

## Architecture / Approach

The CLI is the single producer of the final result (scores, pass flag, rendered comment, usage). The composite action is a thin shell: get the diff with `gh`, run the CLI with PR text passed through env vars only, then create or edit the comment and swap labels with `gh`.

## Phases at a Glance

| Phase                 | What it delivers                                | Key risk                         |
| --------------------- | ----------------------------------------------- | -------------------------------- |
| 1. Scoring contract   | Schema with six scores, rubric prompt           | Breaking change to CLI output    |
| 2. Pure logic + tests | Evaluator, truncation, renderer, Vitest         | Vitest version must stay on `^4` |
| 3. CLI and usage      | Title/description input, JSON result, usage log | `ai@7` usage field names         |
| 4. Action + workflow  | Comment, labels, retry, permissions             | Only verifiable on a real PR     |
| 5. Hardening + docs   | Root lint/CI unaffected, README                 | Package may trip root lint       |

**Prerequisites:** `OPENROUTER_API_KEY` repository secret; a test PR to verify.
**Estimated effort:** ~3-4 sessions across 5 phases.

## Open Risks & Assumptions

- The default branch is assumed to be `master` (workflows use it); not verified with `gh`.
- Prompt injection through PR text is mitigated by the prompt and by never interpolating it into scripts, not eliminated.
- Truncated diffs mean partial reviews on large PRs; the comment says so.

## Success Criteria (Summary)

- A new PR gets exactly one comment and exactly one result label, reproducibly.
- The label retry works and does not duplicate the comment.
- Root CI stays green and each run logs its token usage.
