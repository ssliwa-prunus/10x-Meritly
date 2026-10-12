# Claude Code — hooks reference

Verified on: 2026-09-25

- https://code.claude.com/docs/en/hooks (reference; raw markdown at `hooks.md`)
- https://code.claude.com/docs/en/hooks-guide

If you can browse, re-check the payload field, exit-code table and timeout defaults there. Prefer the doc on conflict and note the discrepancy in the report.

## Detection signals

- `.claude/` directory: `settings.json`, `settings.local.json`, `skills/`, `hooks/`
- `CLAUDE.md` at the repo root (the 10x-cli writes the course rule there for Claude Code)
- `.claude/.10x-cli-manifest.json` with `"tool": "claude-code"`
- This skill loaded from `.claude/skills/` (wins the tie-break)

`.agents/skills/` and `AGENTS.md` are weak evidence: the 10x-cli writes `.agents/skills/` into Claude Code repos too.

## Config locations

| File                                                     | Scope                                         |
| -------------------------------------------------------- | --------------------------------------------- |
| `~/.claude/settings.json`                                | All your projects                             |
| `.claude/settings.json`                                  | This project, committed with `.claude/hooks/` |
| `.claude/settings.local.json`                            | This project, local only (gitignored)         |
| Managed policy settings                                  | Organisation, admin-controlled                |
| Plugin `hooks/hooks.json`, skill or subagent frontmatter | While the plugin / skill / subagent is active |

Hooks from different levels **merge**; they do not replace each other. Shape:

```json
{
  "hooks": {
    "PostToolUse": [{ "matcher": "Write|Edit", "hooks": [{ "type": "command", "command": "...", "timeout": 30 }] }]
  }
}
```

## Events that matter here

- **Per edit:** `PostToolUse` with matcher `Write|Edit` (regex on the tool name; `Edit.*` also catches `NotebookEdit`). There is no `MultiEdit` tool. `PostToolBatch` fires once after a batch of parallel tool calls (no matcher). A `Bash` command that rewrites a file does **not** trigger a `Write|Edit` hook.
- **End of turn:** `Stop` (no matcher). The docs list 33 events in total.

## Payload

JSON on stdin. `PostToolUse` fields include `session_id`, `cwd`, `hook_event_name`, `tool_name`, `tool_input`, `tool_response`. For `Write`/`Edit`, the edited path is **`tool_input.file_path`**, always absolute (on Windows with backslashes, even under Git Bash).

`Stop` includes **`stop_hook_active`** — `true` when Claude is already continuing because a Stop hook blocked.

## Signal channel — what reaches the agent

| Exit code         | PostToolUse                                                                               | Stop                                                           |
| ----------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `0`               | Success. stdout goes to the debug log only; stderr is never seen by Claude                | Agent stops normally                                           |
| `2`               | **stderr is shown to Claude** next to the tool result (the edit already happened)         | **Agent does not stop**; stderr is the reason it keeps working |
| other (incl. `1`) | Non-blocking error: the user sees "hook error" in the transcript, **Claude sees nothing** | Same                                                           |

Most linters and test runners exit `1` and print to stdout, so a raw `npx eslint .` hook reaches nobody. Scripts must redirect output to stderr (`>&2`) and turn any failure into `exit 2`.

JSON alternative (exit 0, stdout): `{"decision": "block", "reason": "..."}` or `hookSpecificOutput.additionalContext`. stderr + exit 2 is enough for linter and test output.

Stop block cap: after **8** consecutive blocks Claude Code ends the turn anyway (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` raises it). Use the `stop_hook_active` guard instead of relying on the cap.

## Timeouts

`timeout` is in **seconds**. Defaults: 600 for `command`/`http`/`mcp_tool`, 30 for `prompt`, 60 for `agent`. `10000` means almost three hours, not ten seconds.

## Paths, shell, Windows

- Hook commands run in the session's current directory; the payload's `cwd` is that directory too.
- `$CLAUDE_PROJECT_DIR` is the directory the session **started** in. Started with `--worktree` or inside a worktree, it is that worktree. After `EnterWorktree` in a running session it **still points at the start checkout** while `cwd` already is the worktree (observed live 2026-10-04). And when the agent edits a file in a sibling worktree, neither the variable nor `cwd` names that checkout.
- So the scripts never `cd "$CLAUDE_PROJECT_DIR"`:
  - the **command** finds the script through `git rev-parse --show-toplevel` from the hook's cwd, with the variable only as a fallback (`settings.json` below);
  - the **per-edit** script takes the checkout from the edited file (`git -C "$(dirname "$FILE")"`), resolves a relative path against `cwd`, and skips files whose repository differs from the session's (`--git-common-dir` guard: `~/.claude`, other projects);
  - the **Stop** script takes the checkout from the payload `cwd`, plus every checkout the per-edit script registered for this `session_id` (`$TMPDIR/claude-hooks/<session_id>.roots`), so edits in a sibling worktree are swept too.
- No fail-open wrapper (`[ -x "$d/..." ] && exec ...; exit 0`): a missing script must surface as a hook error, not vanish. Commands run with `sh -c` on macOS/Linux and Git Bash on Windows. The per-hook `shell` field accepts `"bash"` or `"powershell"` (default PowerShell on Windows without Git Bash). Without Git Bash or `jq`, generate a Node script instead.
- `.claude/` in `.gitignore` (`git check-ignore -v .claude/settings.json` prints the rule): hooks that are not committed exist only on your disk. A re-include under an ignored _directory_ does not work, so replace `.claude/` with `.claude/*`, `!.claude/settings.json`, `!.claude/hooks/` (keep `settings.local.json` ignored). Show the user that diff; do not commit it unasked.

## Trust and debugging

- No approval step: hooks in settings files run once the session loads them. Restart the session after editing settings.
- `/hooks` — read-only list of loaded hooks with their source file. Missing? Check the JSON (a trailing comma breaks it).
- `claude --debug-file /tmp/claude.log` (or `claude --debug`, log at `~/.claude/debug/<session-id>.txt`) shows which hooks matched, their exit code and output. Ctrl+O shows hook output in the transcript.

## Gotchas

- `eslint --fix .` per edit: slow, rewrites files the agent did not touch, reports old errors as noise.
- `eslint --fix "$FILE"` rewrites the file the agent just edited, so its next `Edit` can fail with "file modified since read" and cost a re-read. Drop `--fix` (`npx eslint --quiet "$FILE"`) to report only and let the agent fix.
- The `case` extension list is an example: derive it from the lint config (add `*.astro` with `eslint-plugin-astro`, `*.vue`, `*.svelte` likewise).
- Generated types: `tsc --noEmit` fails on `astro:*` modules until `astro sync` has generated `.astro/`; `astro check` syncs itself but is slower. Any framework with generated types needs its sync step before the typecheck.
- Red baseline: run the Stop script once on the untouched tree. If it blocks there, fix the prerequisite or scope it (the commented variant in `end-of-turn.sh`: a project tsconfig, or diagnostics in changed files only).
- Red baseline caused by the host, not the code (a test pinned to an exact npm version, a `umask`-sensitive file mode, a service on a port the host shares): detect the condition in the script, skip only that part, and put the skip into `SKIPPED` — `end-of-turn.sh` names it in the block message, and on a green turn prints it as `systemMessage` for the user. Never narrow the scope without a message.
- No silent `exit 0`. Exit 0 means "checked, clean" or "nothing to check" (no path, uncovered type, other repo, no changes). A missing `jq`, an uninstalled linter (`npx --no-install`, `pnpm exec`) or a typechecker that did not run is a failure the agent or the user must see. `[ -x node_modules/.bin/eslint ] || exit 0` turns a broken hook into a green one.
- Plain output: hooks inherit the user's shell env (`GREP_OPTIONS=--color=always`, `FORCE_COLOR`); the scripts set `NO_COLOR=1 FORCE_COLOR=0`, `tsc --pretty false` and `grep --color=never`.
- Whole-project `tsc` per edit: mid-refactor type errors the agent is about to fix anyway. Move it to `Stop`.
- `Stop` fires at the end of every response, including pure Q&A. The end-of-turn script exits early when nothing changed.
- A file rewritten through `Bash` (`cat > f <<EOF`, `sed -i`) never reaches a `Write|Edit` hook, and agents do this. The end-of-turn script lints and tests every changed file from `git diff`, so those edits are still checked once per turn.
- `vitest related <file> --run` exits 0 when no test depends on the file (also for `.md`, a deleted file or an empty path); editing `package.json` runs the whole suite. Jest needs `--findRelatedTests <file> --passWithNoTests`. Vitest detects Claude Code on its own (`CLAUDECODE`), no `AI_AGENT=1` needed.
- `node --test` and `bun test` have no related mode. Per edit, select the tests that import the edited module (`related-tests-by-import.sh`); at end of turn, run the whole suite when it is fast, or the same import grep over the changed files. Under `node --test`, unset `NODE_TEST_CONTEXT` when a test spawns another `node --test`, or the child reports into the parent.
- Cursor imports `.claude/settings*.json` hooks (on by default) — see `cursor.md` before adding Cursor-native hooks to the same repo. The Stop script below also honours Cursor's `loop_count` so it stays safe when imported.

## Minimal example

`.claude/settings.json` (merge into existing `hooks`, do not replace them):

<!-- proof: settings.json -->

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "\"$(git rev-parse --show-toplevel 2>/dev/null || echo \"$CLAUDE_PROJECT_DIR\")\"/.claude/hooks/lint-edited-file.sh",
            "timeout": 30
          },
          {
            "type": "command",
            "command": "\"$(git rev-parse --show-toplevel 2>/dev/null || echo \"$CLAUDE_PROJECT_DIR\")\"/.claude/hooks/related-tests.sh",
            "timeout": 60
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"$(git rev-parse --show-toplevel 2>/dev/null || echo \"$CLAUDE_PROJECT_DIR\")\"/.claude/hooks/end-of-turn.sh",
            "timeout": 120
          }
        ]
      }
    ]
  }
}
```

`.claude/hooks/lint-edited-file.sh` — lint only the edited file, in its own checkout:

<!-- proof: lint-edited-file.sh -->

```bash
#!/usr/bin/env bash
# PostToolUse (Write|Edit): lint the file the agent just edited.
# Exit 2 + stderr is the only combination Claude sees.
export NO_COLOR=1 FORCE_COLOR=0
command -v jq >/dev/null || { echo "Hook lint-edited-file.sh needs jq: install it or port the hook to Node." >&2; exit 2; }

INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
[ -n "$FILE" ] || exit 0
case "$FILE" in /*) ;; *) FILE="${CWD:-$PWD}/$FILE" ;; esac

# Only files the linter covers (derive the list from the lint config) that still exist.
case "$FILE" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) ;;
  *) exit 0 ;;
esac
[ -f "$FILE" ] || exit 0

# Checkout of the edited file, not $CLAUDE_PROJECT_DIR (after EnterWorktree, or for a
# sibling worktree, that variable names another checkout). Files of other repositories
# (~/.claude, other projects) are skipped; any worktree of this repository is checked.
ROOT=$(git -C "$(dirname "$FILE")" rev-parse --show-toplevel 2>/dev/null) || exit 0
REPO=$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
SESSION_REPO=$(git -C "${CWD:-$PWD}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
[ -n "$REPO" ] && [ "$REPO" = "$SESSION_REPO" ] || exit 0
cd "$ROOT" || exit 0

# Register the checkout so the Stop hook sweeps it too, even when it is not the session cwd.
SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null | tr -cd 'A-Za-z0-9_-')
if [ -n "$SID" ] && mkdir -p "${TMPDIR:-/tmp}/claude-hooks"; then
  printf '%s\n' "$ROOT" >>"${TMPDIR:-/tmp}/claude-hooks/$SID.roots"
fi

# --no-install: a linter that is not installed fails here (exit 2) instead of passing.
if ! OUTPUT=$(npx --no-install eslint --quiet "$FILE" 2>&1); then
  echo "ESLint reported errors in $FILE:" >&2
  echo "$OUTPUT" >&2
  exit 2
fi
exit 0
```

`.claude/hooks/end-of-turn.sh` — at end of turn: lint and related tests for every changed file, then a whole-project typecheck, in every checkout this session touched; one retry:

<!-- proof: end-of-turn.sh -->

```bash
#!/usr/bin/env bash
# Stop: sweep everything this turn changed before the agent finishes, one retry.
export NO_COLOR=1 FORCE_COLOR=0
command -v jq >/dev/null || { echo "Hook end-of-turn.sh needs jq: install it or port the hook to Node." >&2; exit 2; }

INPUT=$(cat)

# Already sent back once by this hook: let it finish. The commit gate catches the rest.
# (loop_count covers Cursor, which imports this hook from .claude/settings.json.)
ACTIVE=$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
LOOPS=$(printf '%s' "$INPUT" | jq -r '.loop_count // 0' 2>/dev/null)
if [ "$ACTIVE" = "true" ] || [ "${LOOPS:-0}" != "0" ]; then
  exit 0
fi

# Checkouts to sweep: the session's (payload cwd follows EnterWorktree, $CLAUDE_PROJECT_DIR
# does not) plus every checkout lint-edited-file.sh registered for this session.
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null | tr -cd 'A-Za-z0-9_-')
REGISTRY="${TMPDIR:-/tmp}/claude-hooks/${SID:-none}.roots"
ROOTS=()
while IFS= read -r r; do
  [ -n "$r" ] && [ -d "$r" ] && ROOTS+=("$r")
done <<EOF
$({ git -C "${CWD:-$PWD}" rev-parse --show-toplevel 2>/dev/null; [ -n "$SID" ] && cat "$REGISTRY" 2>/dev/null; } | sort -u)
EOF
if [ "${#ROOTS[@]}" -eq 0 ]; then
  # Not silent: the user sees why nothing was checked.
  jq -cn --arg m "end-of-turn.sh: no git checkout at ${CWD:-$PWD}, nothing checked." '{systemMessage: $m}'
  exit 0
fi

# Red on this host only (a test pinned to a tool version, umask, a service the host lacks)?
# Detect it, skip only that part, and say so; never let the gate shrink silently. Example:
SKIPPED=""
# if [ "$(npm -v 2>/dev/null)" != "11.12.1" ]; then
#   SKIPPED="$SKIPPED npm-pinned audit tests (host npm $(npm -v 2>/dev/null), need 11.12.1);"
# fi

REPORT=""
for ROOT in "${ROOTS[@]}"; do
  cd "$ROOT" || continue

  # Changed and new files. Nothing changed (a Q&A turn): nothing to check here.
  CHANGED=$({ git diff --name-only HEAD; git ls-files -o --exclude-standard; } 2>/dev/null | sort -u)
  [ -n "$CHANGED" ] || continue

  # Changed files the linter covers (derive the list from the lint config) that still exist.
  # This also catches files rewritten through a shell command, which never reach a per-edit hook.
  FILES=()
  while IFS= read -r f; do
    case "$f" in *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) [ -f "$f" ] && FILES+=("$f") ;; esac
  done <<EOF
$CHANGED
EOF

  if [ "${#FILES[@]}" -gt 0 ]; then
    OUT=$(npx --no-install eslint --quiet "${FILES[@]}" 2>&1 </dev/null) || REPORT="$REPORT
ESLint errors in changed files ($ROOT):
$OUT
"
    # Whole unit suite runs in seconds? Use `npx vitest run` instead: it also catches
    # a red test in a module this turn only imported. No related mode (node --test,
    # bun test)? Select the tests by import, as related-tests-by-import.sh does.
    OUT=$(npx --no-install vitest related "${FILES[@]}" --run 2>&1 </dev/null) || REPORT="$REPORT
Tests related to changed files fail ($ROOT):
$OUT
"
  fi

  # Generated types are gitignored, so regenerate them in the hook, not once by hand:
  # [ -f .astro/types.d.ts ] || npx astro sync >/dev/null 2>&1
  if ! OUT=$(npx --no-install tsc --noEmit --pretty false 2>&1 </dev/null); then
    # Red on the untouched tree? Scope it: `-p <app tsconfig>`, drop a nested package
    # pulled in by `**/*`:
    # OUT=$(printf '%s\n' "$OUT" | grep --color=never -v '^packages/')
    # or keep only changed files:
    # OUT=$(printf '%s\n' "$OUT" | grep --color=never -F "$CHANGED")
    [ -n "$OUT" ] && REPORT="$REPORT
Typecheck fails ($ROOT):
$OUT
"
  fi
done

if [ -n "$REPORT" ]; then
  [ -n "$SKIPPED" ] && REPORT="$REPORT
Skipped on this host:$SKIPPED
"
  echo "Fix these before you finish:$REPORT" >&2
  exit 2
fi
# Green: the registered checkouts are clean, start the next turn with an empty registry.
[ -n "$SID" ] && : >"$REGISTRY" 2>/dev/null
[ -n "$SKIPPED" ] && jq -cn --arg m "end-of-turn.sh passed, but skipped on this host:$SKIPPED" '{systemMessage: $m}'
exit 0
```

`.claude/hooks/related-tests.sh` — tests that depend on the edited file (optional, per edit; for runners with a related mode):

<!-- proof: related-tests.sh -->

```bash
#!/usr/bin/env bash
# PostToolUse (Write|Edit): run the tests related to the edited file.
export NO_COLOR=1 FORCE_COLOR=0
command -v jq >/dev/null || { echo "Hook related-tests.sh needs jq: install it or port the hook to Node." >&2; exit 2; }

INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
[ -n "$FILE" ] || exit 0
case "$FILE" in /*) ;; *) FILE="${CWD:-$PWD}/$FILE" ;; esac

case "$FILE" in
  *.ts|*.tsx|*.js|*.jsx) ;;
  *) exit 0 ;;
esac
[ -f "$FILE" ] || exit 0

# Same checkout rules as lint-edited-file.sh.
ROOT=$(git -C "$(dirname "$FILE")" rev-parse --show-toplevel 2>/dev/null) || exit 0
REPO=$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
SESSION_REPO=$(git -C "${CWD:-$PWD}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
[ -n "$REPO" ] && [ "$REPO" = "$SESSION_REPO" ] || exit 0
cd "$ROOT" || exit 0

if ! OUTPUT=$(npx --no-install vitest related "$FILE" --run 2>&1); then
  echo "Tests related to $FILE fail:" >&2
  echo "$OUTPUT" >&2
  exit 2
fi
exit 0
```

`.claude/hooks/related-tests-by-import.sh` — the same for runners **without** a related mode (`node --test`, `bun test`): select the test files that import the edited module, by grep:

<!-- proof: related-tests-by-import.sh -->

```bash
#!/usr/bin/env bash
# PostToolUse (Write|Edit): run the tests that import the edited file.
# For runners without a related mode. One import level only: a test that reaches the
# module through another module is left to the end-of-turn sweep and the commit gate.
RUN=(node --test)        # or (bun test): the repo's runner as its test script calls it
TEST_FILES='*.test.*'    # pathspec of the files that runner picks up
export NO_COLOR=1 FORCE_COLOR=0
command -v jq >/dev/null || { echo "Hook related-tests-by-import.sh needs jq: install it or port the hook to Node." >&2; exit 2; }

INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
[ -n "$FILE" ] || exit 0
case "$FILE" in /*) ;; *) FILE="${CWD:-$PWD}/$FILE" ;; esac

case "$FILE" in
  *.ts|*.tsx|*.mts|*.cts|*.js|*.jsx|*.mjs|*.cjs) ;;
  *) exit 0 ;;
esac
[ -f "$FILE" ] || exit 0

# Same checkout rules as lint-edited-file.sh.
ROOT=$(git -C "$(dirname "$FILE")" rev-parse --show-toplevel 2>/dev/null) || exit 0
REPO=$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
SESSION_REPO=$(git -C "${CWD:-$PWD}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
[ -n "$REPO" ] && [ "$REPO" = "$SESSION_REPO" ] || exit 0
cd "$ROOT" || exit 0

REL=${FILE#"$ROOT"/}
TESTS=()
case "$REL" in
  *.test.*) TESTS=("$REL") ;;
  *)
    # Import specifiers ending in /<basename>, with or without an extension:
    # '../src/math', "./math.js", '@/lib/math.ts'. Tracked and untracked tests.
    BASE=$(basename "${REL%.*}" | sed 's/[][\.*^$+?(){}|]/\\&/g')
    while IFS= read -r t; do
      [ -n "$t" ] && TESTS+=("$t")
    done <<EOF
$(git grep --untracked -lE "['\"][^'\"]*/${BASE}(\.[cm]?[jt]sx?)?['\"]" -- "$TEST_FILES" 2>/dev/null)
EOF
    ;;
esac
[ "${#TESTS[@]}" -gt 0 ] || exit 0

if ! OUTPUT=$("${RUN[@]}" "${TESTS[@]}" 2>&1 </dev/null); then
  echo "Tests importing $REL fail (${TESTS[*]}):" >&2
  echo "$OUTPUT" >&2
  exit 2
fi
exit 0
```

`.claude/hooks/check-edited-file.sh` — per-edit check for a repo **without a linter**: the typechecker's diagnostics for the edited file only, `node --check` for plain JavaScript:

<!-- proof: check-edited-file.sh -->

```bash
#!/usr/bin/env bash
# PostToolUse (Write|Edit): no linter in this repo, so check the edited file with what exists:
# TypeScript diagnostics filtered to this file, a syntax check for JavaScript.
export NO_COLOR=1 FORCE_COLOR=0
command -v jq >/dev/null || { echo "Hook check-edited-file.sh needs jq: install it or port the hook to Node." >&2; exit 2; }

INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
[ -n "$FILE" ] || exit 0
case "$FILE" in /*) ;; *) FILE="${CWD:-$PWD}/$FILE" ;; esac

case "$FILE" in
  *.ts|*.tsx|*.mts|*.cts|*.js|*.mjs|*.cjs) ;;
  *) exit 0 ;;
esac
[ -f "$FILE" ] || exit 0

# Same checkout rules as lint-edited-file.sh.
ROOT=$(git -C "$(dirname "$FILE")" rev-parse --show-toplevel 2>/dev/null) || exit 0
REPO=$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
SESSION_REPO=$(git -C "${CWD:-$PWD}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
[ -n "$REPO" ] && [ "$REPO" = "$SESSION_REPO" ] || exit 0
cd "$ROOT" || exit 0
REL=${FILE#"$ROOT"/}

case "$REL" in
  *.js|*.mjs|*.cjs)
    if ! OUTPUT=$(node --check "$REL" 2>&1); then
      echo "Syntax error in $REL:" >&2
      echo "$OUTPUT" >&2
      exit 2
    fi
    ;;
  *)
    # tsc has no single-file mode that keeps the project config: run the project and keep
    # the edited file's diagnostics. Other files' errors are the end-of-turn hook's job.
    OUTPUT=$(npx --no-install tsc --noEmit --pretty false 2>&1)
    RC=$?
    MINE=$(printf '%s\n' "$OUTPUT" | grep --color=never -F "$REL(")
    if [ -n "$MINE" ]; then
      echo "Type errors in $REL:" >&2
      echo "$MINE" >&2
      exit 2
    fi
    # Failed without any TS diagnostic: the typechecker itself did not run. Say so.
    if [ "$RC" -ne 0 ] && ! printf '%s\n' "$OUTPUT" | grep -q 'error TS'; then
      echo "Typecheck could not run for $REL:" >&2
      printf '%s\n' "$OUTPUT" | head -n 20 >&2
      exit 2
    fi
    ;;
esac
exit 0
```

`chmod +x .claude/hooks/*.sh`. Manual proof (the committed hook test from SKILL.md Step 7 automates these):

```bash
echo '{"tool_name":"Edit","cwd":"'"$PWD"'","tool_input":{"file_path":"'"$PWD"'/src/lib/auth.ts"}}' | .claude/hooks/lint-edited-file.sh; echo "exit: $?"
echo '{"cwd":"'"$PWD"'","stop_hook_active":false}' | .claude/hooks/end-of-turn.sh; echo "exit: $?"
echo '{"cwd":"'"$PWD"'","stop_hook_active":true}'  | .claude/hooks/end-of-turn.sh; echo "exit: $?"   # expect 0
```
