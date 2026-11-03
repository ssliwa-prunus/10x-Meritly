---
date: 2026-11-03T20:49:45+01:00
researcher: Claude (Sonnet 5.5)
git_commit: 020f24fd4a1b2132fc5b1cbc794bed9107b88a7b
branch: develop
repository: 10x-Meritly
topic: "ci-cd-code-review: what exists vs. what requirements.md expects"
tags: [research, codebase, github-actions, code-reviewer, ci]
status: complete
last_updated: 2026-11-03
last_updated_by: Claude (Sonnet 5.5)
last_updated_note: "Recorded decisions: pass/fail rule, include PR description, trigger on master+develop"
---

# Research: ci-cd-code-review — gap between `packages/code-reviewer` and `requirements.md`

**Date**: 2026-11-03T20:49:45+01:00 · **Git Commit**: 020f24f · **Branch**: develop · **Repository**: 10x-Meritly

## Research Question

Based on `context/changes/ci-cd-code-review/requirements.md`: what does the repo already provide for a GitHub Actions code-review workflow (composite action, PR comment, `ai-cr:*` labels, label-triggered retry), and what must be built or changed?

## Summary

- The reviewer package exists and works as a CLI (diff in, JSON out). The GitHub side does not exist: `.github/workflows/review.yml` is tracked but **0 bytes**, and `.github/actions/` does not exist.
- The package's output contract does **not** match the requirements. Requirements: six criteria scored 1–10 with a pass/fail outcome. Package: `summary`, `verdict` (`approve|request_changes|comment`) and a `findings[]` list, with no scores.
- `title` and `description` are already supported by `ReviewInputSchema`/`buildReviewPrompt`, but the CLI only accepts a diff (file or stdin). Title/description cannot be passed from a workflow without a CLI change.
- No usage/cost logging, no budget cap, no diff-size guard exist. The repo's CLAUDE.md "Hard rules" for this module require cost tracking per run and a hard budget cap before unattended runs.
- Existing workflows (`pr.yml`, `ci.yml`) give the conventions to follow (action versions, Node via `.nvmrc`, concurrency, `contents: read`).

## Detailed Findings

### GitHub Actions state

- `.github/workflows/` holds `ci.yml`, `pr.yml`, `review.yml`; `review.yml` is empty (`wc -c` = 0, committed in `3c64656` as 0 lines). It is a placeholder, so the new workflow can fill it or replace it.
- `.github/actions/` is absent: the composite action must be created (e.g. `.github/actions/ai-code-review/action.yml`).
- `pr.yml:3-5` triggers on `pull_request` to `[master, develop]`; requirements say "every new pull request to master". `pr.yml:7-8` sets `permissions: contents: read`; `pr.yml:10-12` uses a per-PR concurrency group with `cancel-in-progress`. Steps use `actions/checkout@v7`, `actions/setup-node@v7` with `node-version-file: .nvmrc` (`pr.yml:17-22`).
- Git remote is `github.com/ssliwa-prunus/10x-Meritly`. Note: the session's "main branch" is reported as `main` but the workflows and CLAUDE.md use `master`; the actual default branch was not verified via `gh`.

### Reviewer package (`packages/code-reviewer`)

- Entry: `src/cli.ts` reads a diff from a file path arg or stdin, errors on empty diff, prints `JSON.stringify(review)` to stdout, sets `process.exitCode = 1` on error (with cause chain). It does not use the verdict for the exit code.
- `src/agents/reviewer.ts`: `ToolLoopAgent` with `Output.object({ schema: ReviewSchema })`; `reviewDiff()` returns only `result.output` — **token usage on `result` is discarded**, so cost logging needs a code change.
- `src/model.ts`: OpenRouter provider, default `anthropic/claude-haiku-5.5`, requires `OPENROUTER_API_KEY` (so the workflow needs that repository secret).
- `src/schemas/review.ts`: `ReviewSchema = { summary, verdict, findings[] }`; `FindingSchema` has `file, line?, severity (critical|major|minor|nit), category, message, suggestion?`.
- `src/prompts/reviewer.ts`: generic prompt (bugs, security, perf, tests, readability); no mention of the six criteria, scoring scale, or repository conventions.
- `package.json`: scripts `start`, `dev`, `typecheck`; Node `>=22.22.0`; has its own `package-lock.json` (separate install: `npm ci` in `packages/code-reviewer`). No test script.
- Root `tsconfig` excludes the package (commit `020f24f`); root lint/CI are not verified to skip it (not inspected beyond the tsconfig commit message).

### Requirements → gap table

| Requirement                                      | Status                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Workflow on every new PR to master               | Missing (`review.yml` empty)                                                            |
| Composite action                                 | Missing                                                                                 |
| Inputs: title, description, diff                 | Schema/prompt support title+description; CLI does not; diff OK                          |
| 6 criteria scored 1–10                           | Missing in schema and prompt (schema is the contract per CLAUDE.md, so change it first) |
| Pass/fail → `ai-cr:passed` / `ai-cr:failed`      | Missing; no threshold rule defined anywhere                                             |
| PR comment with summary                          | Missing                                                                                 |
| Re-run when label `ai-cr:review` added           | Missing                                                                                 |
| Cost tracking / budget cap (CLAUDE.md hard rule) | Missing                                                                                 |

## Code References

- `.github/workflows/review.yml` — empty placeholder
- `.github/workflows/pr.yml:3-22` — trigger, permissions, concurrency, action versions to mirror
- `packages/code-reviewer/src/cli.ts:36-58` — input handling and output
- `packages/code-reviewer/src/agents/reviewer.ts:16-21` — `reviewDiff`, drops usage
- `packages/code-reviewer/src/schemas/review.ts:21-38` — `ReviewSchema`, `ReviewInputSchema`
- `packages/code-reviewer/src/model.ts:4-12` — model id and API key
- `packages/code-reviewer/src/prompts/reviewer.ts` — system prompt

## Architecture Insights

- Contract order (CLAUDE.md): schema → prompt → gates/evals. Adding criterion scores means editing `ReviewSchema` first.
- Fork PRs get no repository secrets under `pull_request`, so `OPENROUTER_API_KEY` is unavailable to them; same-repo PRs are fine. (General GitHub behaviour, not verified in this repo.)
- Applying labels and posting comments needs `pull-requests: write` (and `issues: write` for labels on some setups) on the review job; `pr.yml` is read-only, so the review job needs its own permissions block.
- A `labeled` event type must be added to the `pull_request` trigger (`opened`, `synchronize`/`reopened` as desired, `labeled` filtered to `ai-cr:review`); otherwise label-triggered retry will not fire. The default activity types are `opened`, `synchronize`, `reopened`.

## Historical Context (from prior changes)

- `context/changes/tool-loop-agent/plan.md`, `plan-brief.md` — plan that produced the current package (phases 1–3 committed; epilogue in `fd865ee`).
- `context/archive/2026-10-10-new-pr-ci-cd-workflow/` — earlier CI work that produced `pr.yml`; the pattern to follow for new workflow files.

## Related Research

None for this change.

## Open Questions

1. ~~**Pass/fail rule**~~ — **Decided 2026-11-03 (user accepted the suggestion):** `ai-cr:passed` only if every one of the six criteria scores >= 6 AND security and safety scores >= 7; otherwise `ai-cr:failed`. Still open: whether `verdict`/`findings` stay alongside the scores and, if so, that the scores (not `verdict`) decide the label.
2. ~~**PR description**~~ — **Decided 2026-11-03:** include it as input.
3. ~~**Target branches**~~ — **Decided 2026-11-03:** trigger on PRs to `master` and `develop` (supersedes the master-only wording in requirements.md).
4. **Diff size limit / truncation** and the budget cap value.
5. **Failure of the reviewer itself** (API error): label neither, or a distinct signal? Not specified.
6. **Comment strategy**: one updated comment vs. a new comment per run (matters for retries).
7. Default branch name (`master` vs. `main`) and whether `ai-cr:*` labels pre-exist or the action creates them.
