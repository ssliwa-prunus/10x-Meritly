# Tool Loop Agent (modular code reviewer) Implementation Plan

## Overview

Convert the demo `packages/code-reviewer/src/index.ts` into a modular code review agent built on the AI SDK `ToolLoopAgent`. Structured-output schemas and prompts live in their own modules, the agent module is reusable and exports the reviewer so promptfoo can import it later, and `index.ts` becomes a side-effect-free barrel with a small CLI behind `npm start`.

## Current State Analysis

- `packages/code-reviewer/src/index.ts` is one file: it throws at import time if `OPENROUTER_API_KEY` is missing, builds the OpenRouter model, defines a toy `GreetingSchema`, and runs `greet("world")` on import (top-level `await`).
- Package is ESM (`"type": "module"`), `tsc --noEmit` with NodeNext/strict, run via `node --env-file-if-exists=.env --import tsx src/index.ts`. No test runner, no lint config.
- Installed: `ai@7.0.159`, `@openrouter/ai-sdk-provider@3.1.0`, `zod@4.6.7`, `tsx`, `typescript@7`, `@types/node`.
- The repo root `.gitignore` ignores `packages/*`; not addressed in this change.

## Desired End State

`import { createReviewer, reviewDiff, ReviewSchema } from "./src/index.ts"` works with no side effects and no API key present. `npm start -- <diff-file>` (or a diff on stdin) prints a validated structured review. Verified by typecheck, an import-without-key check, and one live run on a sample diff.

### Key Discoveries:

- `ToolLoopAgent` accepts `model`, `instructions`, `tools`, `output: Output.object({ schema })`, `stopWhen`; invoke with `agent.generate({ prompt })`, structured data on `result.output` (`packages/code-reviewer/node_modules/ai/docs/03-agents/02-building-agents.mdx`, `07-reference/01-ai-sdk-core/16-tool-loop-agent.mdx`).
- `instructions` is the supported way to set the system prompt; `system` messages in `prompt` are rejected by default.
- Import-time side effects in `src/index.ts` (key check, `greet("world")`) must go, otherwise promptfoo cannot import the agent.

## What We're NOT Doing

- No promptfoo install, config, providers or eval datasets (explicitly out of scope).
- No tools for the agent (diff text only); no file-reading or repo-access tools.
- No unit-test framework, lint setup, or CI wiring for `packages/code-reviewer`.
- No changes to the root `.gitignore`, the main Meritly app, or the model choice (stays `anthropic/claude-haiku-5.5`).
- No streaming, UI, or GitHub PR integration.

## Implementation Approach

Layered modules with one-way dependencies: `schemas` and `prompts` are pure; `model` is a lazy factory; `agents/reviewer` composes them; `index.ts` re-exports; `cli.ts` is the only file that reads stdin/files and prints. The agent module exposes a `createReviewer(options?)` factory (model injectable for evals) and a `reviewDiff` helper that builds the prompt and returns the typed output.

## Phase 1: Schemas and prompts

### Overview

Pure modules with no SDK runtime or env dependencies.

### Changes Required:

#### 1. Review schema

**File**: `packages/code-reviewer/src/schemas/review.ts`

**Intent**: Define the structured review result the agent must return and the review input, with types inferred from zod.

**Contract**: Exports `ReviewSchema`, `Review`, `Finding`, `ReviewInputSchema` and `ReviewInput`. Review shape: `{ summary: string; verdict: "approve" | "request_changes" | "comment"; findings: Finding[] }`, where `Finding = { file: string; line?: number; severity: "critical" | "major" | "minor" | "nit"; category: string; message: string; suggestion?: string }`. Input shape: `{ diff: string; title?: string; description?: string }`. Every output field carries `.describe()` text since it is sent to the model. `line` and `suggestion` stay optional because model line numbers are unreliable.

#### 2. Reviewer prompts

**File**: `packages/code-reviewer/src/prompts/reviewer.ts`

**Intent**: Hold the agent's instructions text and the function that turns review input into the prompt string.

**Contract**: Exports `REVIEWER_INSTRUCTIONS` (string: role, what to look for, severity meaning, "only report issues visible in the diff", empty findings allowed) and `buildReviewPrompt(input: ReviewInput): string`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck` (in `packages/code-reviewer`)
- Modules import without any env var set: `node --import tsx -e "import('./src/schemas/review.ts'); import('./src/prompts/reviewer.ts')"`

#### Manual Verification:

- Prompt text reads sensibly and the schema field descriptions match the intended review semantics

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets; the checkboxes live in `## Progress`.

---

## Phase 2: Reviewer agent module

### Overview

Lazy model factory and the `ToolLoopAgent`-based reviewer.

### Changes Required:

#### 1. Model factory

**File**: `packages/code-reviewer/src/model.ts`

**Intent**: Create the OpenRouter language model on demand so merely importing the module never needs the API key.

**Contract**: Exports `DEFAULT_MODEL_ID = "anthropic/claude-haiku-5.5"` and `createModel(modelId = DEFAULT_MODEL_ID)`, which reads `OPENROUTER_API_KEY` at call time and throws a clear error if it is missing.

#### 2. Reviewer agent

**File**: `packages/code-reviewer/src/agents/reviewer.ts`

**Intent**: Build the code review agent from the schema, instructions and model, reusable by the CLI and future promptfoo providers.

**Contract**: Exports `createReviewer(options?: { model?: LanguageModel })` returning a `ToolLoopAgent` with `instructions: REVIEWER_INSTRUCTIONS`, `output: Output.object({ schema: ReviewSchema })` and no tools; the model defaults to `createModel()`, evaluated inside the factory. Exports `reviewDiff(input: ReviewInput, agent = createReviewer()): Promise<Review>`, which validates the input, calls `agent.generate({ prompt: buildReviewPrompt(input) })` and returns `result.output`. No module-level agent instance, so nothing needs a key at import. Confirm the exact `LanguageModel` type name and `stopWhen` default against the bundled v7 docs before settling signatures.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Importing the agent module without `OPENROUTER_API_KEY` does not throw: `node --import tsx -e "import('./src/agents/reviewer.ts')"` with the variable unset

#### Manual Verification:

- `createReviewer()` without a key throws the clear missing-key error only when called

**Implementation Note**: Pause for manual confirmation before the next phase.

---

## Phase 3: Entry points and wiring

### Overview

Side-effect-free public API plus a CLI.

### Changes Required:

#### 1. Barrel

**File**: `packages/code-reviewer/src/index.ts`

**Intent**: Replace the demo with re-exports of the public surface; no top-level code that runs.

**Contract**: Re-exports `ReviewSchema`, `Review`, `Finding`, `ReviewInputSchema`, `ReviewInput`, `REVIEWER_INSTRUCTIONS`, `buildReviewPrompt`, `createModel`, `DEFAULT_MODEL_ID`, `createReviewer`, `reviewDiff`.

#### 2. CLI

**File**: `packages/code-reviewer/src/cli.ts`

**Intent**: Run a review from the command line against a diff file argument or stdin and print the JSON result.

**Contract**: `npm start -- <path-to-diff>` or `git diff | npm start`. Prints `JSON.stringify(review, null, 2)`; on failure prints the error with its cause to stderr and exits non-zero (no swallowed errors).

#### 3. Scripts

**File**: `packages/code-reviewer/package.json`

**Intent**: Point `start` and `dev` at `src/cli.ts`.

**Contract**: `start`: `node --env-file-if-exists=.env --import tsx src/cli.ts`; `dev` analogous with `tsx watch`. `typecheck` unchanged.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Barrel imports cleanly with no key and prints nothing: `node --import tsx -e "import('./src/index.ts').then(m => console.log(Object.keys(m).sort().join()))"`
- CLI fails clearly without a key: `npm start -- sample.diff` exits non-zero with the missing-key message

#### Manual Verification:

- With a real key, the CLI on a sample diff with an obvious bug returns schema-valid JSON containing a plausible finding
- `git diff | npm start` works via stdin
- Empty or non-diff input yields a sensible result or a clear error

**Implementation Note**: Pause for manual confirmation when finished.

---

## Testing Strategy

### Unit Tests:

- None in this change (no test runner in the package). Schema and prompt modules are pure so they are easy to test later.

### Integration Tests:

- One live CLI run on a sample diff (manual, uses the real OpenRouter key).

### Manual Testing Steps:

1. Run the CLI with a diff that introduces an obvious bug and confirm a finding is returned.
2. Pipe a diff over stdin.
3. Run with no `.env` and confirm the missing-key error.

## Performance Considerations

Single model step, no tools. `stopWhen` stays at the SDK default.

## References

- Change identity: `context/changes/tool-loop-agent/change.md`
- AI SDK docs: `packages/code-reviewer/node_modules/ai/docs/03-agents/02-building-agents.mdx`
- Existing code: `packages/code-reviewer/src/index.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schemas and prompts

#### Automated

- [x] 1.1 Type checking passes — b98541a
- [x] 1.2 Modules import without any env var set — b98541a

#### Manual

- [x] 1.3 Prompt text and schema descriptions match the intended review semantics — b98541a

### Phase 2: Reviewer agent module

#### Automated

- [x] 2.1 Type checking passes — 81ae899
- [x] 2.2 Importing the agent module without the API key does not throw — 81ae899

#### Manual

- [x] 2.3 `createReviewer()` without a key throws the clear missing-key error only when called — 81ae899

### Phase 3: Entry points and wiring

#### Automated

- [x] 3.1 Type checking passes
- [x] 3.2 Barrel imports cleanly with no key and prints nothing
- [x] 3.3 CLI fails clearly without a key

#### Manual

- [x] 3.4 With a real key, the CLI returns schema-valid JSON with a plausible finding for a buggy diff
- [x] 3.5 `git diff | npm start` works via stdin
- [x] 3.6 Empty or non-diff input yields a sensible result or a clear error
