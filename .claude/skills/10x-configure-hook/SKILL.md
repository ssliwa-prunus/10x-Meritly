---
name: 10x-configure-hook
description: >
  Turn the quality gates from context/foundation/test-plan.md into working
  agent hooks and prove them before handing off. Detects the harness from the
  repo (Claude Code, Cursor, Codex, GitHub Copilot), audits existing hook
  config, maps each gate to a moment (per edit, end of turn, commit, push,
  CI), generates config and scripts in that harness's signal protocol, and
  runs every script against a deliberately broken file. Trigger phrases:
  "configure hooks", "set up agent hooks", "lint after every edit", "hook
  fires but the agent ignores it", "skonfiguruj hooki", "hook po edycji",
  "agent nie widzi błędów z hooka". Use AFTER /10x-test-plan (M3L1). Does
  not write git pre-commit/pre-push config — it only recommends it.
---

# 10x Configure Hook — quality gates as agent hooks, proven

This skill turns the gates a project already decided on into hooks the agent actually hears. A hook is only useful when its message reaches the agent through the channel the harness reads for that event. Most broken hooks run fine and print to a channel nobody listens to — so this skill never hands off a hook it has not run.

Work in this order. Each step has an output that the next step consumes; the final report (Step 8) collects them.

## Load-bearing rules

1. **Interview the repo, not the user.** Everything visible on disk — harness, toolchain, existing hooks, test plan — is read, not asked. Ask only what the repo cannot answer.
2. **The signal channel is per harness, per event.** Never assume that exit codes, stderr, stdout or a JSON field mean the same thing in two harnesses. The facts live in `references/<harness>.md`; use them, and prefer the live doc when you can browse and it disagrees.
3. **Per-edit means the edited file.** A per-edit hook reads the edited path from the payload and checks only that file. Whole-project checks move to end of turn or later.
4. **Prove, then hand off.** Every generated script is run with a sample payload on a deliberately broken file and on a clean one before the report is written.
5. **Merge, never clobber.** Existing hook config is audited and merged; the diff is shown before it is written.

---

## Step 1 — Preconditions: read the test plan

Look for `context/foundation/test-plan.md`. Find its quality-gates section **by title** ("Quality Gates" or a close variant) — never by section number; numbering drifts between schema versions.

From the gates table, record one row per gate: gate name, where it runs ("local", "local (agent loop)", "CI on PR"…), required-ness ("required", "required after §3 Phase N", "recommended after…", "optional"), and what it catches. Rows that concern the agent loop — "post-edit hook", "lint + typecheck", "unit + integration" — are the primary input.

Also record **explicit deferrals**: any gate or row marked "deferred", "not v1", "later", "out of scope" or similar, with the quoted wording and the reason the plan gives. Deferrals are decisions, not gaps.

If the file is missing, or has no quality-gates section: derive candidate gates from the repo's own scripts (Step 3) and state in the report "No test plan found — gates derived from the toolchain". Suggest `/10x-test-plan` for a real gate decision, but do not stop.

## Step 2 — Detect the harness(es)

Each reference file opens with a **Detection signals** section. Read those sections for every file in `references/` and match them against the repo. Typical signals:

- Claude Code: a `.claude/` directory (`settings.json`, `settings.local.json`, `skills/`), `CLAUDE.md`.
- Cursor: `.cursor/` (`hooks.json`, `rules/`, `skills/`), `.cursor/rules/10x-course.mdc`.
- Codex: `.codex/` (`hooks.json`, `config.toml`), `.agents/skills/`, `AGENTS.md`.
- GitHub Copilot: `.github/hooks/`, `.github/skills/`, `.github/copilot-instructions.md`.
- 10x-cli manifest: `.claude/`, `.cursor/`, `.github/` or `.agents/.10x-cli-manifest.json` — its `"tool"` field names the harness the course artifacts were installed for.

Harness-specific config dirs and the manifest are strong signals. `AGENTS.md` and `.agents/skills/` are weak: many harnesses read `AGENTS.md`, and the 10x-cli also writes `.agents/skills/` into Claude Code repos.

**Tie-break:** the directory this skill was loaded from decides the harness you configure. List every other harness you found with its evidence path; ask once — offering the detected options — only if another harness is also wanted or already has hook config.

## Step 3 — Detect the toolchain

Read the manifest and config, not memory. For each gate record the exact command this repo uses:

- **Lint / format** — the project's linter and whether it accepts a single file path (ESLint, Biome, Ruff, golangci-lint, RuboCop…). Prefer the local binary (`npx`, `pnpm exec`, `uv run`, …) the repo already uses. Derive the checked file extensions from the lint config, not from the examples (e.g. add `.astro` when `eslint-plugin-astro` is configured, `.vue` / `.svelte` likewise). **No linter at all:** the per-edit check is the typechecker's diagnostics filtered to the edited file plus `node --check` for plain JavaScript (`check-edited-file.sh` in the Claude Code reference); recommend a linter in the report, do not install one.
- **Typecheck** — whole-project command (`tsc --noEmit`, `astro check`, `mypy`, `cargo check`, …) and roughly how long it takes. Frameworks with generated types need their sync step first (`tsc` fails on `astro:*` modules until `astro sync` has generated `.astro/`; `astro check` syncs itself but is slower). Generated dirs are usually gitignored, so a sync that fixes the baseline belongs inside the end-of-turn script, not in a one-off command.
- **Baseline** — run every end-of-turn check once on the untouched tree. If it is already red (missing generated types, a nested package with uninstalled deps pulled in by a root `**/*` include, …): fix the prerequisite (generate the types), or scope the command (project tsconfig, path filter, diagnostics limited to changed files), or report it as a blocker. Never hand off a Stop hook that blocks on a clean tree.
  **Red because of the host, not the code** (a test pinned to an exact tool version, a file-mode test that depends on `umask`, a shared local service): the script detects that condition, skips only the affected part, and says so in its output (the `SKIPPED` pattern in the reference). Fix the environment outside the hook if you can; a silent skip is never acceptable.
- **Tests** — the runner and whether it has a related-tests mode (`vitest related <file> --run`, `jest --findRelatedTests <file> --passWithNoTests`, `pytest` with a path, …). Note what the runner does when no test matches (exit 0 or not). **No related mode** (`node --test`, `bun test`): select the test files that import the edited module with `git grep` over the test files (`related-tests-by-import.sh` in the Claude Code reference); one import level, the end-of-turn sweep and the commit gate cover the rest. Time the whole unit suite once: if it finishes in about 30 s or less, the end-of-turn script runs all of it (it then also catches a red test in a module the agent only imported); otherwise it runs the tests related to the changed files.
- **Git-hook manager** — Husky, lint-staged, Lefthook, pre-commit, or none. Existing git hooks are never modified by this skill.
- **Script prerequisites** — `jq` for bash scripts, or Node/Python if a non-bash script is safer (Windows without Git Bash).

## Step 4 — Map gates to moments; audit what exists

**Moments**, cheapest signal first:

| Moment      | Belongs here                                                              | Reaches the agent |
| ----------- | ------------------------------------------------------------------------- | ----------------- |
| Per edit    | Lint/format of the edited file; related tests when they finish in seconds | Yes               |
| End of turn | Lint + tests for every file changed this turn; whole-project typecheck    | Yes               |
| Pre-commit  | Lint + tests on staged files (catches edits made without the agent)       | No                |
| Pre-push    | Heavier suites, local e2e                                                 | No                |
| CI          | Integration, shared state, infra you do not have locally                  | No                |

Speed heuristic: **the slower the check, the rarer the moment.** A few seconds fits per edit; tens of seconds or whole-project scope belongs to end of turn; minutes belongs to commit, push or CI.

The per-edit moment only sees the harness's edit tools. Agents also rewrite files through shell commands (`cat > file <<EOF`, `sed -i`), which no per-edit hook receives. End of turn is therefore the safety net for the whole turn, not only the typecheck moment: it re-checks every changed file from `git diff`.

**Deferrals.** When the test plan explicitly defers a gate that would become a hook (for example "post-edit hook — deferred, not v1"), quote the deferral and its reason to the user, then ask **once**: configure it anyway, or respect the deferral? Record the answer as `override` or `skip` in the report. Do not re-ask for each hook.

**Audit existing hook config before proposing anything.** Read the harness's hook config files (paths in the reference) and every script in its hooks dir, including scripts no config references (e.g. an orphan `.claude/hooks/run-related-tests.mjs` that prints to stdout only). For each existing hook, name concrete defects, for example:

- whole-project lint or `--fix .` on every edit (slow, touches files the agent did not edit, reports old errors as noise);
- a command whose failure exits with a code the harness treats as non-blocking, or prints to a channel that never reaches the agent (e.g. exit 1 + stdout where the harness only forwards stderr on exit 2);
- timeouts that look like milliseconds (`10000`, `30000`) where the harness expects seconds;
- whole-project typecheck per edit instead of end of turn;
- an end-of-turn hook with no retry guard (can loop until the harness cap);
- the same check registered twice (Cursor and Copilot can import `.claude/settings*.json` — see their references).

Present the moment map and the audit findings together as the proposal. Wait for the user's go-ahead before writing files — **unless the request already is that go-ahead**: the user asked to configure specific hooks in this repo and the proposal adds nothing they did not ask for (no deferral override, no replaced hook, no change outside the hooks dir and config). Then state the proposal and continue; ask only about what goes beyond the request.

## Step 5 — Load the harness reference

Read `references/<harness>.md` for every harness you will configure:

- `references/anthropic.md` — Claude Code
- `references/cursor.md`
- `references/codex.md`
- `references/copilot.md`
- `references/other-harnesses.md` — Devin Desktop, Gemini CLI, OpenCode, Kiro, Junie: links and capability notes only. For these, explain the limitation and point to the doc instead of generating config you cannot prove.

Each reference starts with `Verified on:` and the canonical doc URLs. If you can browse, open the linked doc and re-check the payload field for the edited file, the channel that reaches the agent, and the timeout unit. On conflict, follow the live doc and record the discrepancy in the report ("reference says X, doc now says Y").

## Step 6 — Generate config and scripts

Follow the reference's minimal examples; adapt commands to the toolchain from Step 3.

- **Per-edit script** — reads the payload from stdin, extracts the edited path with the field(s) the reference names, exits successfully when the path is missing or the file type is not checked, and runs the check on **that file only**. On failure it sends a short header plus the tool output on the channel that reaches the agent.
- **End-of-turn script** — sweeps the turn: collects changed and new files (`git diff --name-only HEAD` plus untracked), exits early when there are none, runs the per-edit checks on all of them (lint on the covered files; related tests, or the whole unit suite when Step 3 found it fast), then the whole-project typecheck, and reports every failure in one message. It honours the harness's retry flag (`stop_hook_active` in Claude Code, or the equivalent the reference names) so the agent gets **one** chance to fix, then is allowed to finish. What it cannot fix is left to the commit gate. Keep its total under the timeout (120 s by default); if the sweep is slower, drop the tests to related-only first.
- **Plain output** — hook output is read by a model, not a terminal: `tsc --pretty false`, `grep --color=never`, `NO_COLOR=1 FORCE_COLOR=0` for everything else. Scripts inherit the user's shell env (e.g. `GREP_OPTIONS=--color=always` breaks a grep filter), so set these explicitly.
- **Payloads are untrusted input shapes.** Accept every documented shape: tolerate missing fields, empty stdin and alternative field names; never fail the hook because a field is absent. A missing path means "nothing to check", not an error.
- **Timeouts** in the unit the harness expects (usually seconds): roughly 30 for per-edit lint, 60 for related tests, 120 for typecheck — then tune.
- **Paths** — resolve the checkout the way the reference shows, never by `cd` into a project-dir variable alone. In Claude Code `$CLAUDE_PROJECT_DIR` is the directory the session started in and goes stale after `EnterWorktree`, and an edit in a sibling worktree belongs to neither that variable nor `cwd`: the command finds the script via `git rev-parse --show-toplevel`, the per-edit script takes the checkout from the edited file (relative paths resolved against `cwd`; files of other repositories skipped), and the end-of-turn script sweeps the payload `cwd` plus every checkout registered for the `session_id`. Make scripts executable (`chmod +x`).
- **No silent success** — exit 0 means "checked and clean" or "nothing to check". A missing tool (`jq`, an uninstalled linter), a typechecker that did not run, or a wrapper like `[ -x script ] && exec script; exit 0` must fail visibly (the feedback channel, or a user-visible message), never pass.
- **Committed config** — check that the hook files are not ignored (`git check-ignore -v .claude/settings.json`). An ignored hooks dir exists only on one disk; propose the re-include from the reference and show the `.gitignore` diff.
- **Windows** — note the shell the harness uses (Git Bash, PowerShell, a per-OS command field). If bash or `jq` is unavailable, generate a Node script instead.
- **Existing config** — merge into it, keep unrelated hooks, replace only the defective entries named in Step 4, and show the diff before writing. A script left behind by a replaced or orphaned hook stays on disk: list it in the report and recommend deletion; never delete it silently.
- **Double registration** — `.claude/settings*.json` hooks are also run by Cursor (import on by default), by Copilot CLI, and by VS Code when `chat.useClaudeHooks` is on. If one of those is in use and `.claude/settings*.json` already holds hooks, do not register the same check again in its native config without addressing the import (see `references/cursor.md`, `references/copilot.md`).

## Step 7 — Prove before handing off, as a committed test

The proof is a **test file committed to the repo**, run by the repo's own test runner, not a one-off sequence of shell commands. Hooks change; a proof nobody can re-run stops proving anything after the first edit.

Name it `agent-hooks.test.*` and put it next to the repo's existing tooling tests (under `scripts/__tests__/`, `tools/ci/` or `tests/`, …) in the runner the repo already uses. Each case pipes a payload (shape from the reference) into the real script and asserts the exit code and the output channel. Work on a temporary copy or a throwaway git repo/worktree, never on files in the developer's tree. Stub only what is slow or absent in the test environment (a linter binary on `PATH` that flags a marker), keep git, `jq` and the scripts real.

Cases:

1. **Broken file** — a deliberate, obvious error in a file the check covers (unused variable, wrong type). Expect the blocking or feedback signal the reference documents and a message that names the file and the problem. For test-running scripts the error must be behavioural (a failing assertion): type-only errors do not fail Vitest, which strips types.
2. **Clean file** — expect success and no blocking output. For end-of-turn scripts this requires the green baseline from Step 3.
3. **Skipped type** — a file the check does not cover (e.g. `README.md`). Expect success.
4. **Nonexistent file** — a payload naming a path that does not exist. Expect success.
5. **Empty payload** — `{}`, and an unparseable or path-less payload (e.g. `not json`, a tool call without a path). Expect success.
6. **End of turn with the retry flag set** — expect success even while the error is present.
7. **Edit that bypassed the per-edit hook** — a lint error written directly on disk, no per-edit payload, end-of-turn script. Expect it to block and name that file. With no changed files at all, expect success without running any check.
8. **Checkout resolution** — the project-dir variable pointing at another checkout that holds an error: the hooks check the session's checkout and stay green. A relative path resolves against `cwd`. A broken file of another repository is skipped. An edit in a sibling worktree is swept by the end-of-turn script. Every `command` from the config, run from the worktree with the project-dir variable set to a nonexistent path, reaches an executable script.
9. **No silent success** — the linter or typechecker missing: expect the failure signal, not success.
10. **Harness-specific shapes** — the extra cases the reference lists (e.g. Codex: non-patch payload, multi-file patch, `cwd` in a subdirectory).

Deliberate-break the test itself once: revert one fix in a script (e.g. drop the retry guard) and watch the matching case go red, then restore it. Hook the test into the gate the repo already runs (unit suite, `verify`, pre-push), scoped to changes under the hooks dir if the suite is slow. Do not add a CI job.

Revert every deliberate error and confirm `git status` shows only the files you meant to create or change. If a case fails, fix the script and re-run the test. Never report a hook as working on the strength of the config alone.

## Step 8 — Report

Print a compact report:

- **Inputs** — test plan path (or "No test plan found — gates derived from the toolchain"), harness(es) with evidence paths, toolchain commands, end-of-turn baseline (green, fixed, scoped or blocker).
- **Deferrals** — each quoted deferral and the user's answer (`override` / `skip`).
- **Audit** — defects found in existing hook config and what replaced them; scripts left behind (orphaned or replaced) with a deletion recommendation.
- **Configured** — per harness: config file(s), scripts, events, timeouts; the merged diff.
- **Proof** — the committed test file, the command that runs it, its result, and the deliberate break you watched go red.
- **Still required from the user** — trust or approval steps (e.g. Codex `/hooks` review, Cursor workspace trust, restarting the session), and how to confirm the hook is loaded (the harness's hooks menu or debug log).
- **Reference drift** — any discrepancy between the reference and the live doc.
- **Out of reach** — what these hooks cannot prove: behaviour of the running app (a client component that never hydrates, routing, database policies, side effects). Lint, types and unit tests can all pass while the feature is broken. Name the repo's surfaces at risk and point to E2E or browser verification; do not configure it here.
- **Recommended git gates (not written)** — what belongs in pre-commit and pre-push for this repo, with the existing hook manager if there is one. Do not create or edit git-hook config.
- **Next step** — ask the agent to edit a file with a lint error, then a type error, and watch it fix both in the same session. Then ask it to rewrite a file through a shell command with a lint error and watch the end-of-turn hook send it back.

## What this skill does NOT do

- Change the gates or the risk strategy — that is `/10x-test-plan`.
- Write tests for the application, E2E scenarios or CI pipelines (the only test it writes is the hook test from Step 7).
- Install or reconfigure git-hook managers (Husky, Lefthook, pre-commit).
- Generate config for harnesses it cannot prove (see `references/other-harnesses.md`).

## Interactive prompts — host-agnostic

Whenever this skill says "ask the user", use whichever question tool the host exposes; if none exists, ask in plain text with labelled options. Ask at most: which harness (only if ambiguous), whether to override a deferral (once), and the go-ahead after the proposal (skipped when the request already is that go-ahead, Step 4).

## Tone

Terse, imperative, concrete. Name files, commands and exit codes. No marketing language.
