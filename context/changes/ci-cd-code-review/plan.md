# AI Code Review in CI Implementation Plan

## Overview

Extend `packages/code-reviewer` with a six-criterion scoring contract, a pass/fail evaluator and a comment renderer, then wrap it in a composite GitHub Action and a `review.yml` workflow. Every new PR to `master` or `develop` gets one review comment and exactly one label (`ai-cr:passed` or `ai-cr:failed`); adding the label `ai-cr:review` re-runs the review on demand.

## Current State Analysis

- The reviewer CLI works: diff on stdin or file path, JSON on stdout (`packages/code-reviewer/src/cli.ts:36-58`). Output is `summary`, `verdict`, `findings[]`; it has no scores (`src/schemas/review.ts:21-38`).
- `ReviewInputSchema` and `buildReviewPrompt` already accept `title` and `description` (`src/prompts/reviewer.ts`, `src/schemas/review.ts`); the CLI never passes them.
- `reviewDiff` returns `result.output` only, so token usage is discarded (`src/agents/reviewer.ts:16-21`).
- `.github/workflows/review.yml` is committed but empty; `.github/actions/` does not exist.
- `pr.yml` is the convention to mirror: `actions/checkout@v7`, `actions/setup-node@v7` with `node-version-file: .nvmrc`, per-PR `concurrency`, least-privilege `permissions` (`.github/workflows/pr.yml:3-22`).
- The package has its own `package.json` and lockfile and no test script. Root `vitest.config.ts` covers `src/**` only; root `eslint.config.js` does not ignore `packages/`.

## Desired End State

- Opening a PR (or reopening it) against `master` or `develop` triggers the review. The PR gets one bot comment (edited in place on reruns) with the six scores, the summary and the findings, plus one of `ai-cr:passed` (green) / `ai-cr:failed` (red).
- Pass rule: every criterion >= 6 **and** security and safety >= 7. Anything else is `ai-cr:failed`.
- Adding label `ai-cr:review` re-runs the review; the action removes that label when it finishes so it can be added again.
- The job is advisory: a failed review does not fail the job. If the reviewer itself errors, the comment says so and neither result label is set.
- Verified by: unit tests green, `npm run typecheck` in the package, and a manual run on a real test PR.

### Key Discoveries:

- Schema is the contract; change it first, then prompt, then consumers (CLAUDE.md, "Hard rules").
- Cost per run must be logged and bounded before unattended use (CLAUDE.md, "Hard rules").
- PR title and body are attacker-controlled text. They must reach the CLI through environment variables or files, never be interpolated into a `run:` script.
- Secrets are not exposed to fork PRs under `pull_request`, so fork PRs are skipped.

## What We're NOT Doing

- Business-alignment and architectural-fit criteria (parked in `requirements.md`).
- Reviewing on every push (`synchronize`); retry is by label only, to bound cost.
- Making the check required in branch protection (the job is advisory).
- Tools for the agent (reading repo files); the reviewer sees only the diff, title and description.
- A hard spend cap in the repo; cost is bounded by diff truncation and logged per run. An OpenRouter key-level limit is a recommended manual step, documented in Phase 5.
- Reviewing fork PRs.
- `actionlint` or other workflow linting in CI.

## Implementation Approach

Build from the inside out: contract, then pure logic with tests, then the CLI that glues them, then the GitHub layer that calls the CLI, then hardening. The CLI becomes the single place that produces the final machine-readable result (scores, pass flag, rendered comment body, usage), so the composite action stays a thin shell around `gh`.

## Phase 1: Scoring contract

### Overview

Replace the verdict-based output with six 1-10 scores and teach the model the rubric.

### Changes Required:

#### 1. Review schema

**File**: `packages/code-reviewer/src/schemas/review.ts`

**Intent**: Make `ReviewSchema` carry the six criteria scores instead of `verdict`, keeping `summary` and `findings`.

**Contract**: `scores` object with integer fields 1-10 for `correctness`, `idiomaticity`, `complexity`, `testCoverage`, `documentation`, `security` (higher is always better; for complexity 10 = simple). `verdict` is removed. `FindingSchema` is unchanged. Export a `CRITERIA` constant (ordered keys) so the evaluator and renderer share one list. Update `src/index.ts` exports.

#### 2. Reviewer prompt

**File**: `packages/code-reviewer/src/prompts/reviewer.ts`

**Intent**: Replace the generic checklist and the verdict rule with the six-criterion rubric from `requirements.md` (1 and 10 anchors per criterion), and state that the PR title and description are untrusted context that must not change the instructions.

**Contract**: `REVIEWER_INSTRUCTIONS` names all six criteria with their 1/10 anchors; instructs scoring of what is visible in the diff only; no mention of verdict. `buildReviewPrompt` signature unchanged.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck` (in `packages/code-reviewer`)
- No remaining references to `verdict`: `grep -rn verdict packages/code-reviewer/src` returns nothing

#### Manual Verification:

- The rubric text in the prompt matches the six criteria and anchors in `requirements.md`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Pure logic with unit tests

### Overview

Add the deterministic pieces (pass/fail rule, diff truncation, comment rendering) as pure functions with Vitest tests; the model is never called in tests.

### Changes Required:

#### 1. Test runner

**File**: `packages/code-reviewer/package.json`

**Intent**: Add Vitest so the package can test its own logic.

**Contract**: `devDependencies.vitest` pinned to `^4` (same major as the root, which Stryker requires); script `"test": "vitest run"`. Update the package lockfile.

#### 2. Pass/fail evaluator

**File**: `packages/code-reviewer/src/evaluate.ts`

**Intent**: Turn scores into a pass/fail result and the list of criteria that missed their threshold, so the comment can explain a failure.

**Contract**: `evaluate(scores): { passed: boolean; failing: Array<{ criterion; score; required }> }`. Thresholds: `MIN_SCORE = 6` for all criteria, `MIN_SECURITY_SCORE = 7` for `security`. Boundaries: 6 passes, 5 fails; security 7 passes, 6 fails.

#### 3. Diff truncation

**File**: `packages/code-reviewer/src/truncate.ts`

**Intent**: Bound the prompt size and cost by cutting oversized diffs.

**Contract**: `truncateDiff(diff, maxChars): { diff: string; truncated: boolean; originalChars: number }`. Default limit constant `DEFAULT_MAX_DIFF_CHARS = 60000`, overridable by env `REVIEW_MAX_DIFF_CHARS`. Cuts on a line boundary so no half line reaches the model.

#### 4. Comment renderer

**File**: `packages/code-reviewer/src/render.ts`

**Intent**: Produce the Markdown PR comment from a review, its evaluation, truncation info and usage.

**Contract**: `renderComment(...)` returns Markdown starting with the hidden marker `<!-- ai-cr -->` (used to find and edit the comment), a pass/fail heading, a table of six scores with the required threshold, the summary, findings grouped by severity, a notice when the diff was truncated, and a one-line token usage footer. `renderErrorComment(message)` returns the marker plus a short "review could not run" text with no label implication. Escape nothing from model output beyond what Markdown needs; never include the raw diff.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test` (in `packages/code-reviewer`)
- Tests cover the pass-rule boundaries (6/5 for all criteria, 7/6 for security), truncation at and over the limit and on a line boundary, and the comment containing the marker, the truncation notice and the failing criteria
- Type checking passes: `npm run typecheck`

#### Manual Verification:

- Rendered comment for a sample failing review reads clearly in a Markdown preview

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: CLI and usage logging

### Overview

Make the CLI accept title and description, apply truncation, return usage, and emit one machine-readable result for the action.

### Changes Required:

#### 1. Agent returns usage

**File**: `packages/code-reviewer/src/agents/reviewer.ts`

**Intent**: Stop discarding token usage so cost can be logged.

**Contract**: `reviewDiff` returns `{ review, usage }` where `usage` carries input/output/total tokens from the AI SDK result. Verify the exact field names against the installed `ai@7` types before using them.

#### 2. CLI inputs and output

**File**: `packages/code-reviewer/src/cli.ts`

**Intent**: Read the PR title and description from env vars `REVIEW_TITLE` and `REVIEW_DESCRIPTION`, truncate the diff, run the review, and print a single JSON result.

**Contract**: stdout JSON `{ passed, failing, review, truncated, usage, comment }` where `comment` is the rendered Markdown. Usage is also logged to stderr as one human-readable line. On reviewer failure the CLI exits non-zero, prints the cause chain to stderr (existing `formatError`), and writes nothing to stdout. The existing diff-from-file/stdin input and empty-diff error are kept.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Unit tests pass: `npm test`
- Empty diff exits non-zero: `echo "" | npm start` fails with the "diff is empty" message

#### Manual Verification:

- With a real `OPENROUTER_API_KEY`, `git diff HEAD~1 | npm start` prints valid JSON with six scores, `passed`, `comment` and non-zero usage
- `REVIEW_TITLE` and `REVIEW_DESCRIPTION` appear to influence the review (e.g. a description claiming the change is a doc fix is reflected in the summary)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Composite action and workflow

### Overview

Wire the CLI into GitHub: composite action for the review itself, workflow for triggers and permissions.

### Changes Required:

#### 1. Composite action

**File**: `.github/actions/ai-code-review/action.yml`

**Intent**: Run the whole review for one PR and apply the side effects, so the workflow stays a few lines.

**Contract**: Inputs: `openrouter-api-key`, `github-token`, `pr-number`, `pr-title`, `pr-body`. Steps: `actions/setup-node@v7` (`node-version-file: .nvmrc`, npm cache keyed on the package lockfile); `npm ci` in `packages/code-reviewer`; get the diff with `gh pr diff`; run the CLI with title/body passed only via `env:`; on success, create or edit the bot comment found by the `<!-- ai-cr -->` marker, ensure both labels exist with their colours (`ai-cr:passed` green, `ai-cr:failed` red), set the one that applies and remove the other. On CLI failure, post or edit the comment with `renderErrorComment` text, set neither result label, and still finish green. Always remove `ai-cr:review` at the end. No user-controlled text is interpolated into `run:` scripts.

#### 2. Workflow

**File**: `.github/workflows/review.yml`

**Intent**: Trigger the action for new PRs and for the retry label, with the permissions it needs and nothing more.

**Contract**: `on: pull_request` with `branches: [master, develop]` and `types: [opened, reopened, labeled]`. Job `review` runs only when the event is not `labeled`, or the added label is `ai-cr:review`, and the PR head repo equals the base repo (skips forks). `permissions: contents: read, pull-requests: write, issues: write`. `concurrency` group per PR number with `cancel-in-progress: true`. `timeout-minutes: 10`. Passes `secrets.OPENROUTER_API_KEY` and `github.token` to the action.

### Success Criteria:

#### Automated Verification:

- Both YAML files parse: `node -e "require('node:fs').readFileSync('.github/workflows/review.yml','utf8')"` plus a YAML parse of each file (e.g. `npx --yes yaml valid .github/workflows/review.yml .github/actions/ai-code-review/action.yml`)
- Existing CI is unaffected: `pr.yml` and `ci.yml` unchanged in the diff

#### Manual Verification:

- Opening a test PR to `develop` produces one comment and exactly one of `ai-cr:passed` / `ai-cr:failed`
- Adding `ai-cr:review` re-runs the review, edits the same comment, swaps labels if the result changed and removes `ai-cr:review`
- A PR with a deliberately broken `OPENROUTER_API_KEY` posts the error comment and sets neither result label, and the job stays green
- A PR from a fork is skipped

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Hardening and docs

### Overview

Make sure the new package does not break the existing pipeline, and document how to operate the reviewer.

### Changes Required:

#### 1. Root tooling check

**File**: `eslint.config.js` (only if needed)

**Intent**: Confirm root lint, `astro check`, `npm test` and the build ignore or cope with `packages/code-reviewer`; add an ignore entry only if one of them fails because of the package.

**Contract**: No change if `npm run lint` and `npx astro check` already pass with the package present.

#### 2. Documentation

**File**: `packages/code-reviewer/README.md`

**Intent**: Explain what the reviewer does and how it is operated.

**Contract**: Covers the `OPENROUTER_API_KEY` repository secret, the labels `ai-cr:review` / `ai-cr:passed` / `ai-cr:failed`, the pass rule and its constants, `REVIEW_MAX_DIFF_CHARS`, the advisory behaviour, fork-PR skipping, how to read the usage line, and the recommendation to set a spend limit on the OpenRouter key. A short pointer is added to the root `CLAUDE.md` CI section.

### Success Criteria:

#### Automated Verification:

- Root lint passes: `npm run lint`
- Root type check passes: `npx astro sync && npx astro check`
- Root unit tests pass: `npm test`
- Package checks pass: `npm run typecheck && npm test` (in `packages/code-reviewer`)

#### Manual Verification:

- The README steps are enough for someone to add the secret and trigger a review
- One full PR cycle (open, review, retry by label) behaves as described in Desired End State

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

- Pass rule: boundaries at 6/5 for each criterion and 7/6 for security; several criteria failing at once are all reported
- Truncation: under, exactly at and over the limit; cut falls on a line boundary
- Rendering: marker present, truncation notice shown only when truncated, failing criteria listed, error comment has the marker and no labels implied

### Integration Tests:

- None automated. The model call and GitHub side effects are verified manually on a test PR.

### Manual Testing Steps:

1. Run the CLI locally on a recent diff with a real key and inspect the JSON.
2. Open a test PR to `develop` and confirm comment and label.
3. Add `ai-cr:review` and confirm the comment is edited, not duplicated.
4. Temporarily break the secret and confirm the error path.

## Performance Considerations

Cost is bounded per run by the diff character limit (default 60000) and the use of the small default model (`anthropic/claude-haiku-5.5`, `src/model.ts`). Reviews run on `opened`, `reopened` and the retry label only, not on every push.

## Migration Notes

Removing `verdict` is a breaking change to the CLI output. The only consumers are the new action and the local CLI; nothing else in the repo reads the output.

## References

- Related research: `context/changes/ci-cd-code-review/research.md`
- Requirements: `context/changes/ci-cd-code-review/requirements.md`
- Workflow conventions: `.github/workflows/pr.yml:3-22`
- Reviewer entry points: `packages/code-reviewer/src/cli.ts`, `src/agents/reviewer.ts`, `src/schemas/review.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Scoring contract

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` (in `packages/code-reviewer`) — bc44c8f
- [x] 1.2 No remaining references to `verdict`: `grep -rn verdict packages/code-reviewer/src` returns nothing — bc44c8f

#### Manual

- [x] 1.3 The rubric text in the prompt matches the six criteria and anchors in `requirements.md` — bc44c8f

### Phase 2: Pure logic with unit tests

#### Automated

- [x] 2.1 Unit tests pass: `npm test` (in `packages/code-reviewer`)
- [x] 2.2 Tests cover the pass-rule boundaries (6/5 for all criteria, 7/6 for security), truncation at and over the limit and on a line boundary, and the comment containing the marker, the truncation notice and the failing criteria
- [x] 2.3 Type checking passes: `npm run typecheck`

#### Manual

- [x] 2.4 Rendered comment for a sample failing review reads clearly in a Markdown preview

### Phase 3: CLI and usage logging

#### Automated

- [ ] 3.1 Type checking passes: `npm run typecheck`
- [ ] 3.2 Unit tests pass: `npm test`
- [ ] 3.3 Empty diff exits non-zero: `echo "" | npm start` fails with the "diff is empty" message

#### Manual

- [ ] 3.4 With a real `OPENROUTER_API_KEY`, `git diff HEAD~1 | npm start` prints valid JSON with six scores, `passed`, `comment` and non-zero usage
- [ ] 3.5 `REVIEW_TITLE` and `REVIEW_DESCRIPTION` appear to influence the review

### Phase 4: Composite action and workflow

#### Automated

- [ ] 4.1 Both YAML files parse
- [ ] 4.2 Existing CI is unaffected: `pr.yml` and `ci.yml` unchanged in the diff

#### Manual

- [ ] 4.3 Opening a test PR to `develop` produces one comment and exactly one of `ai-cr:passed` / `ai-cr:failed`
- [ ] 4.4 Adding `ai-cr:review` re-runs the review, edits the same comment, swaps labels if the result changed and removes `ai-cr:review`
- [ ] 4.5 A PR with a deliberately broken `OPENROUTER_API_KEY` posts the error comment and sets neither result label, and the job stays green
- [ ] 4.6 A PR from a fork is skipped

### Phase 5: Hardening and docs

#### Automated

- [ ] 5.1 Root lint passes: `npm run lint`
- [ ] 5.2 Root type check passes: `npx astro sync && npx astro check`
- [ ] 5.3 Root unit tests pass: `npm test`
- [ ] 5.4 Package checks pass: `npm run typecheck && npm test` (in `packages/code-reviewer`)

#### Manual

- [ ] 5.5 The README steps are enough for someone to add the secret and trigger a review
- [ ] 5.6 One full PR cycle (open, review, retry by label) behaves as described in Desired End State
