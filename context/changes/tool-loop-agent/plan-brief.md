# Tool Loop Agent (modular code reviewer) — Plan Brief

> Full plan: `context/changes/tool-loop-agent/plan.md`

## What & Why

Convert the demo `packages/code-reviewer/src/index.ts` into a modular code review agent on the AI SDK `ToolLoopAgent`, with schemas and prompts extracted into their own modules. The agent must be reusable and exported so promptfoo evals can import it later (eval setup is not part of this change).

## Starting Point

One file with import-time side effects (key check, a toy `greet("world")` call). Dependencies (`ai@7`, OpenRouter provider, zod 4, tsx, TypeScript) are installed and `npm start` works.

## Desired End State

Importing the package has no side effects and needs no API key. `npm start -- <diff>` or `git diff | npm start` prints a schema-validated structured review.

## Key Decisions Made

| Decision              | Choice                                                                               | Why (1 sentence)                                                           |
| --------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Agent input and tools | Diff text (+ optional title/description), no tools                                   | Deterministic and easy to eval; tools can be added to the same agent later |
| Output schema         | `{ summary, verdict, findings[] }` with severity, category, optional line/suggestion | Familiar review shape that is easy to assert on in promptfoo               |
| Entry point           | `index.ts` barrel + `cli.ts` behind `npm start`                                      | Importable without side effects, still runnable by hand                    |
| Model                 | Keep `anthropic/claude-haiku-5.5` via OpenRouter, created lazily                     | The key is only needed when a review runs                                  |

## Scope

**In scope:** schema module, prompt module, lazy model factory, `ToolLoopAgent` reviewer with `reviewDiff`, barrel, CLI, script updates.

**Out of scope:** promptfoo install/config/datasets, agent tools, test framework, lint/CI, `.gitignore` changes, streaming or PR integration.

## Architecture / Approach

`schemas` and `prompts` are pure; `model` is a lazy factory; `agents/reviewer` composes them into `createReviewer()` and `reviewDiff()`; `index.ts` re-exports; `cli.ts` is the only file doing I/O.

## Phases at a Glance

| Phase                      | What it delivers                           | Key risk                                              |
| -------------------------- | ------------------------------------------ | ----------------------------------------------------- |
| 1. Schemas and prompts     | `schemas/review.ts`, `prompts/reviewer.ts` | Prompt and schema wording quality                     |
| 2. Reviewer agent module   | `model.ts`, `agents/reviewer.ts`           | Exact `ToolLoopAgent` / `LanguageModel` typings in v7 |
| 3. Entry points and wiring | Barrel, `cli.ts`, scripts, live run        | Stdin and file handling on Windows                    |

**Prerequisites:** `OPENROUTER_API_KEY` in `.env` (already set).
**Estimated effort:** ~1 session across 3 small phases.

## Open Risks & Assumptions

- Model-reported line numbers may be wrong, so `line` is optional.
- No automated tests exist; correctness rests on typecheck plus a live run.

## Success Criteria (Summary)

- Importing the package is side-effect free and key-free.
- The CLI returns a schema-valid structured review for a real diff.
- The agent is exported in a form promptfoo can wrap later.
