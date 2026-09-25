---
name: 10x-implement
description: Implement technical plans from context/changes/<change-id>/plan.md with verification
allowed-tools:
  - Read
  - Glob
  - Grep
  - Write
  - Edit
  - Bash
  - Agent
  - Task
  - AskUserQuestion
  - TaskCreate
  - TaskUpdate
  - TaskList
  - TaskGet
---

# Implement Plan

You are tasked with implementing an approved technical plan from `context/changes/<change-id>/plan.md`. These plans contain phases with specific changes and a canonical `## Progress` section at the bottom that drives execution state (see `references/progress-format.md`).

## Initial Setup

When this command is invoked:

1. **Resolve the plan**:
   - If invoked as `/10x-implement <change-id> [phase N]`, resolve to `context/changes/<change-id>/plan.md`.
   - If invoked with `@context/changes/<change-id>/plan.md` or a full path, accept it.
   - **Refuse if the resolved path starts with `context/archive/`** — print "This change is archived. Open a new change with `/10x-new` instead." and STOP.
   - If nothing was provided, respond with the message below and **STOP and wait**:

```
I'll help you implement an approved technical plan. Please provide:

1. A change-id (e.g., `/10x-implement oauth-login phase 1`), or
2. A full path (e.g., `@context/changes/oauth-login/plan.md`).

You can list active changes with: `ls context/changes/`

Tip: Make sure the plan has been reviewed and approved before implementation.
```

## Getting Started

When given a plan path:

- Read the plan completely. The `## Progress` section at the bottom is authoritative for execution state — checkmarks (`- [x]`) live ONLY there. Phase blocks contain plain `- ` bullets (no checkboxes).
- Read `context/foundation/lessons.md` if present and internalize each entry before starting any phase — these are the team's accepted recurring rules and must shape every implementation choice you make in this run.
- Read all files mentioned in the plan (referenced research, frame, source files in the same change folder)
- **Read files fully** - never use limit/offset parameters, you need complete context
- Think deeply about how the pieces fit together
- **Preflight the gates**: collect the commands from every phase's Automated success criteria and check each is runnable here — the binary or package script exists (`package.json` scripts, `command -v`, `Makefile` targets). A criterion whose command cannot run is a mismatch for the phase that needs it, and it is far cheaper to say so now than to discover it after the code is written. Report each unrunnable command on entry (`PREFLIGHT: <command> not runnable — Phase <N> will need this`). Never silently drop an unverifiable criterion.
- **Update `change.md`**: on entry, set `status: implementing` (only if currently in `{planned, plan_reviewed}`) and `updated: <today>`.
- **Sync the roadmap** (best effort, once on entry): if `context/foundation/roadmap.md` carries an item whose `Change ID` equals `<change-id>`, flip that item to `Status: in-progress`. See "## Roadmap status sync" below. This is the open-work counterpart to `/10x-archive`'s `done` flip; it never blocks, and most changes won't trace to a roadmap.
- Count total phases (from `## Phase N:` headers) and create one TaskCreate entry per phase (these appear in the user's status bar):
  - For each phase, create a task with `subject: "Phase N: [Phase Name]"` and `activeForm: "Implementing Phase N"`
  - Set the current phase to `in_progress` via TaskUpdate before starting work
  - Mark each phase `completed` via TaskUpdate when its success criteria pass
- **Find the next pending step** by scanning the `## Progress` section: the first `- [ ]` line in document order is where you start. If a `phase N` argument was passed, jump to the first `- [ ]` inside `### Phase N:` instead.
- Start implementing if you understand what needs to be done

## Per-phase execution mode

Writing a phase's code is the expensive part of this session: reading the source files fully, reasoning through the changes, applying the edits. Run that in a subagent and the main context stays lean across a long plan; run it here and the user can watch and interrupt mid-phase. Both are legitimate — the user picks per phase.

**Ask before the first phase of the run** (the first pending phase, or the one named by a `phase N` argument):

AskUserQuestion:

- question: "Phase [N] — how should I implement it?"
  header: "Exec mode"
  options:
  - label: "Delegate to a subagent (Recommended)"
    description: "A subagent writes the code; I keep the gates, staging, commit and Progress here. Keeps this context lean across a long plan — you see the touched files, adaptations and gate verdicts when it returns."
  - label: "Implement in this context"
    description: "I write the code here so you can watch the edits land and redirect me mid-phase. Costs context — a long plan may need a clear between phases."
    multiSelect: false

For every later phase the choice rides along with the "Next phase decision" prompt at the end of the commit ritual — no separate question. If the user asked for several phases consecutively (so that prompt is skipped), carry the last chosen mode forward.

Whichever mode is in force, **everything the user has to decide or review stays here**: gate execution and verdict lines, staging, the commit ritual, `## Progress` flips, mismatch questions. Delegation moves the typing, never a decision.

### Dispatching the implementation subagent

When the phase is delegated, make one `Task` call (`subagent_type: general-purpose`) before the gate stack, whose prompt carries:

- The change-id and the phase number + title.
- The phase's full plan section verbatim — Overview, Changes Required, Success Criteria. (Success Criteria is context so the subagent knows the target; it does NOT run the gates — you do.)
- **The implementation discipline to follow.** Resolve `references/implementation-discipline.md` (it sits next to this `SKILL.md`) to an **absolute path** and tell the subagent to Read and apply it. A spawned `Task` agent has no notion of this skill's directory, so a relative path or "read this skill's reference" will not resolve. Point at the file; do not restate it inline.
- Every entry from `context/foundation/lessons.md`, if present — the subagent cannot read the file unless you paste the entries.
- The mismatch taxonomy from "Implementation Philosophy": adapt **Minor** mismatches directly and report them; on a **Structural** mismatch, stop and report rather than adapting or redesigning.
- Hard boundaries: implement code changes ONLY. Do not run the gate stack, do not stage, do not commit, do not touch the `## Progress` section or any checkbox, do not edit Phase blocks, do not go outside the plan's scope. Do not call `AskUserQuestion` — the user is talking to you, not to the subagent; an open question comes back in the return message instead.

Require this structured final message as the return value, not a human-facing note:

```
STATUS: completed | structural-mismatch
TOUCHED: <repo-relative path>, <path>, ...      # every file created or edited
ADAPTATIONS: <one line each, or none>
STRUCTURAL: <plan assumption vs. what exists — only when STATUS is structural-mismatch>
UNCERTAINTIES: <ambiguous decisions, or none>
```

On return:

- **`completed`** → seed the phase's touched-file set from `TOUCHED` (see "Tracking files touched during a phase"), relay `ADAPTATIONS` and `UNCERTAINTIES` to the user in your own words — a silent adaptation is the one that bites later — and proceed to the gate stack. Never trust `TOUCHED` blindly; the `git status --porcelain` reconciliation at staging is the cross-check for a file the subagent touched but left off the list.
- **`structural-mismatch`** → do not run gates. Present the issue block from "Implementation Philosophy" using the subagent's `STRUCTURAL` detail and ask the mismatch question. Then:
  - **Adapt and continue** → the subagent that held the phase's context is gone, so dispatch a fresh one for the remainder, carrying the user's decision, the `STRUCTURAL` detail and the partial `TOUCHED` list. It re-reads what it needs; that re-read is the honest price of this path and it only occurs on structural mismatches. If the phase was nearly finished, just complete it here instead.
  - **Skip this part** / **Stop and re-plan** → as described in "Implementation Philosophy". Leave the partial work in the worktree; do not stage or commit it.

A gate fix may be delegated the same way — dispatch a focused subagent carrying the failing gate's output and the offending files, and union its returned `TOUCHED` into the phase's set before re-staging. Trivial mechanical fixes (a stray import, a rename) are faster applied here. Either way the two-attempt budget is unchanged, and **the deliberate-break check always runs here** — its worktree-only edit and unconditional restore are never delegated.

## Implementation Philosophy

Plans are carefully designed, but reality can be messy. Your job is to:

- Follow the plan's intent while adapting to what you find
- Implement each phase fully before moving to the next
- Verify your work makes sense in the broader codebase context
- Update checkboxes in the plan as you complete sections

[references/implementation-discipline.md](references/implementation-discipline.md) is the craft layer for the editing itself — read referenced code fully, adapt without redesigning, make the change fit its neighbors, honor the team's accepted rules, search before editing unfamiliar territory. Read it before the first phase you implement here; when a phase is delegated, the subagent reads it instead (by absolute path — see "Dispatching the implementation subagent"). This section covers only what to do when the plan and reality disagree.

When things don't match the plan exactly, think about why and communicate clearly. The plan is your guide, but your judgment matters too.

**Classify the mismatch before you interrupt.** Not every gap deserves a question:

- **Minor** — a moved file, a renamed symbol, import drift, a trivial API or config delta. The plan's intent is intact; only a coordinate changed. Adapt the implementation to reality, say so in one line (`ADAPT: plan says src/auth.ts, file is now src/auth/index.ts`), and keep going. Do not stop for these; a question per import path buries the ones that matter.
- **Structural** — a missing dependency, an architecture that differs from what the plan assumes, a referenced file or API that does not exist, a phase that depends on output a prior phase never produced. The plan cannot be followed as written and adapting would mean redesigning it. Stop and take the structural path below.

When in doubt between the two, treat it as structural. A wrong "ask" costs one exchange; a wrong "adapt" can ship a redesign nobody approved.

On a structural mismatch:

- STOP and think deeply about why the plan can't be followed
- Present the issue clearly as text:

  ```
  Issue in Phase [N]:
  Expected: [what the plan says]
  Found: [actual situation]
  Why this matters: [explanation]
  ```

- Then use `AskUserQuestion` to get a structured decision:

  AskUserQuestion:
  - question: "How should I handle this mismatch?"
    header: "Mismatch"
    options:
    - label: "Adapt and continue"
      description: "Adjust the implementation to match reality. I'll explain the adaptation."
    - label: "Skip this part"
      description: "Move on to the next section/phase. This change isn't needed."
    - label: "Stop and re-plan"
      description: "This mismatch is too significant. We need to update the plan first."
      multiSelect: false

## Tracking files touched during a phase

The phase-end commit ritual (see "Verification Approach" below) stages files from a **touched-file set** that you maintain in working memory throughout each phase. This set is the canonical input to `git add` — never fall back to `git status` heuristics for staging decisions.

**Discipline**:

- Every time you call `Edit` or `Write` on a file during the current phase, add its repo-relative path to the touched-file set.
- When a phase is delegated, seed the set from the subagent's returned `TOUCHED` list, and union in any path a delegated gate fix returns. Files you edit here directly — the `## Progress` checkboxes, a `change.md` flip — go in as usual.
- The set always contains `context/changes/<change-id>/plan.md` because each phase produces at least one Edit to its `## Progress` section. Add it on entry to a phase even before any checkboxes flip.
- **Phase 1 bootstrap**: on the first phase of a change, also seed the touched-file set with all untracked or modified files inside `context/changes/<change-id>/` — typically `change.md`, `research.md`, `plan.md`, and any other context files created during planning. These files are part of the change and should land in the first commit rather than being left as untracked stragglers.
- The set **resets at each phase boundary**. After the phase-end commit completes, clear it before starting the next phase.
- This list overrides any heuristic from `git status`. If the touched set is `{a.md, b.md, plan.md}` but `git status --porcelain` also reports `c.md` dirty, `c.md` is unrelated — handle it via the dirty-path prompt in the ritual, never silently bundle it into the commit.

## Tracking issue/task references for commits

Before proposing any phase-end or epilogue commit message, scan the conversation context for tracking-system issue or task references tied to this implementation work, including Jira keys (for example `ABC-123`), Linear issue IDs (for example `ENG-123`), GitHub issue/PR references (for example `#123`, `GH-123`, or full GitHub issue/PR URLs), or explicit task links from Jira, Linear, or GitHub.

- If one or more references are present, include them in the commit message body under a `Refs:` line, preserving the exact identifiers/URLs the user provided where possible.
- If multiple references apply, list them comma-separated on one `Refs:` line.
- Do not invent or infer tracking references from the change-id, branch name, or filenames. Only use references visible in the current conversation context or explicitly provided by the user.
- Apply the same `Refs:` line to every phase-end commit and to the epilogue commit, unless the user narrows a reference to a specific phase.

## Roadmap status sync

`context/foundation/roadmap.md` (produced by `/10x-roadmap`) indexes each Foundation/Slice by a stable **Change ID**. `/10x-archive` already closes the loop on the far end — when a change archives, it flips the matching roadmap item to `Status: done`. This step wires the near end: when implementation _starts_, mark the matching item **`in-progress`** so the roadmap shows live work instead of jumping straight from `ready` to `done`.

Run it **once, on entry** to the change (right after the `change.md` → `implementing` stamp) — not per phase. The lookup is **mandatory**; "best effort" scopes only the _edits_ — a missing roadmap or a not-found target is skipped silently and never blocks, prompts, rolls back, or aborts the run. Do not skip the check on the assumption there's no roadmap.

1. `test -f context/foundation/roadmap.md`. If absent, skip this step silently.
2. Capture whether the file is already dirty: `ROADMAP_PREDIRTY=$(git status --porcelain context/foundation/roadmap.md 2>/dev/null)` — used in step 5 to decide staging.
3. Read the file. Look for `<change-id>` used as a `Change ID`:
   - in the `## At a glance` table — the row whose **Change ID** column cell equals `<change-id>` exactly;
   - and in the `## Foundations` / `## Slices` bodies — the `### <ID>: …` block that contains a `- **Change ID:** <change-id>` line.

   `<ID>` is that item's roadmap-local id (`F-NN` or `S-NN`). Match is exact-string only — a slice can spawn several changes, so a near-miss is intentionally _not_ touched. **No match** → print `ℹ context/foundation/roadmap.md has no item with Change ID "<change-id>" — roadmap left untouched.` and skip the rest of this step.

4. **Match found** → read the item's current `- **Status:**`. If it is already `in-progress` or `done`, leave it untouched (**forward-only**: never regress a more-advanced status) and skip to step 5. Otherwise apply both edits with the Edit tool — each independent and best effort; if a target isn't where the `/10x-roadmap` template puts it (hand-edited or older-format roadmap), skip that sub-edit, keep going, and note what was skipped. Touch only the `Status` field; leave `Outcome`, `Prerequisites`, `Change ID`, etc. alone.
   1. **`## At a glance`** — in the matched row, set the **Status** column cell to `in-progress`.
   2. **Item body** — rewrite the item's `- **Status:**` line to `- **Status:** in-progress`.

   Then bump the roadmap frontmatter `updated:` to `<today>` (leave every other key alone; skip this if the file has no frontmatter).

5. **Fold the flip into this change's history.** If `git` is available **and** `ROADMAP_PREDIRTY` (step 2) was empty, add `context/foundation/roadmap.md` to the current phase's touched-file set so the status flip lands in the phase's commit rather than lingering dirty. If `ROADMAP_PREDIRTY` was non-empty, the file already had uncommitted edits: leave the flip in the working tree, keep `context/foundation/roadmap.md` OUT of the touched-file set, and print `⚠ context/foundation/roadmap.md had pre-existing uncommitted changes — flipped roadmap item <ID> to in-progress in the working tree but did NOT stage it. Commit it yourself.` If `git` is unavailable, the edit simply stays in the working tree.

## Verification Approach

After implementing a phase, run this fixed sequence — the canonical order for everything between "code written" and "commit landed." Gates run cheap-first, staging sits where the break-check needs it, and the commit ritual is the tail. Print a one-line verdict after each gate — `GATE <name>: PASS` or `GATE <name>: FAIL (<summary>, attempt <k>/2)` — so the user can see what actually ran without rereading the scrollback.

1. **(a) Plan criteria** — run the phase's `#### Automated` success-criteria commands from the plan, in order. Each command is its own gate with its own verdict line.

2. **Stage the touched-file set** — run steps 2–4 of the commit ritual below ("Compute the staging set", "Detect unrelated dirty paths", "Stage explicitly by path") _here_, not at commit time. Staging before the break-check is what makes its restore exact: `git checkout -- <file>` resets the worktree to the staged version, so a deliberate break can never leak into the commit.

3. **(b) Deliberate-break check** — only for phases that add or change tests. With the phase's files staged, verify the new or changed test actually protects something:

   1. Invert or weaken the protected behavior in production code — a worktree-only edit, never staged.
   2. Run the relevant test (a scoped run, e.g. the single test file).
   3. Confirm it fails. Red here is the pass condition: `GATE break-check: PASS (test went red on broken code)`.
   4. Restore unconditionally via `git checkout -- <file>` — this resets the worktree to the staged version exactly, so the break can never leak into the commit.
   5. Report the sequence (what was broken, that the test went red, that the file was restored).

   If the test **stays green** on broken code, the assertion protects nothing — that is a gate failure. Fix it by strengthening the assertion, never by weakening the production code or skipping the check. The break edit must never be committed; the restore in step 4 is unconditional, including on the failure path.

4. **(c) Repo-wide checks** — full test suite, lint, typecheck, wherever the plan or the repository defines them (e.g. a `ci:local` script, `make check test`). One verdict line each.

5. **(d) Commit** — the commit-only-on-green invariant: never start the commit ritual while any gate above is red. There is no override, and "I'll fix it in the next phase" is not one. If a fix to gate (b) or (c) changed files, re-run step 2 to capture them, then run the phase-end commit ritual below — its staging steps are a no-op when nothing has changed since.

**When a gate fails**, fix it yourself at most twice; number the attempts in the verdict lines (`attempt 1/2`, `attempt 2/2`). If the same gate fails a third time, stop fixing and hand it to the user with the failing output — the problem is deeper than mechanical drift, and a third blind attempt usually makes the diff worse. Never weaken an assertion, delete a test, or relax a lint or typecheck rule to make a gate pass unless the plan explicitly says so: fix the code to meet the check, not the check to meet the code. When a test's expected value is genuinely ambiguous — the plan and the implementation disagree and there is no independent source for the right answer — do not guess; leave the verdict honest and ask.

Alongside the sequence:

- Update your progress in your todos and in the plan's `## Progress` section
- **Mutate ONLY the `## Progress` section.** Phase blocks (Overview, Changes Required, Success Criteria) are read-only. Use Edit to flip `- [ ] N.M <title>` → `- [x] N.M <title>` in Progress as each step completes. Do NOT edit Phase block bullets, do NOT add HTML comment progress markers at the bottom of the plan, and do NOT write any state-file sidecar.
- **Run the phase-end commit ritual**: gate (d) above. Once every gate is green, walk through this sequenced ritual to author one Conventional-Commits commit and write the closing short SHA back into every Progress row flipped during the phase.

  1. **Manual confirmation gate.** Inform the human that automated verification passed and list the manual verification items from the plan. Pause here. Do not proceed until the human confirms manual testing succeeded. Use this format:

     ```
     Phase [N] Complete - Ready for Manual Verification

     Automated verification passed:
     - [List automated checks that passed]

     Please perform the manual verification steps listed in the plan:
     - [List manual verification items from the plan]

     Let me know when manual testing is complete so I can proceed to the commit step.
     ```

     **Cross-phase manual rollup (final phase only).** Before printing the gate message, determine whether the current phase is the final phase: scan the `## Progress` section for `### Phase M:` headings and treat the current phase as final iff no heading with `M > N` exists in document order. If the current phase is **not** final, the gate message is exactly the format above — no rollup. If the current phase **is** final, after the "Please perform the manual verification steps listed in the plan:" block, scan the entire Progress section for `- [ ]` rows that sit under a `#### Manual` subsection in any phase **other than the current one**. If any such rows exist, append the following block to the gate message (in document order, one row per line, formatted as `<phase>.<index> <title>` — strip any `- [ ]` prefix and any trailing ` — <sha>` suffix):

     ```
     Pending manual checks from earlier phases:
     - [phase.index title]
     ```

     If no earlier-phase manual rows are pending, omit the rollup block entirely. The gate still pauses for human confirmation; this is informational, not a hard block. Mid-stream phases (any phase that is not the final one) keep the original gate format with no rollup.

  2. **Compute the staging set.** Steps 2–4 already ran once as gate-stack step 2; re-run them here so anything a gate fix touched gets captured. When nothing changed since, they are a no-op. Take the touched-file set maintained during the phase (see "Tracking files touched during a phase" above) and union it with `{context/changes/<change-id>/plan.md}`. The plan file is always staged because each phase produces at least one Edit to its `## Progress` section.

  3. **Detect unrelated dirty paths.** Run `git status --porcelain` and intersect with paths _outside_ the staging set. If the dirty-but-untouched set is non-empty, present the offending paths and use `AskUserQuestion`:

     - question: "<N> unrelated path(s) are dirty. How should I handle them?"
       header: "Dirty paths"
       options:
       - label: "Continue — stage only the planned set (Recommended)"
         description: "Commit only files this phase touched. Leave the unrelated paths dirty for you to handle separately."
       - label: "Stage all"
         description: "Add the unrelated paths to this commit. You take responsibility for the broader scope."
       - label: "Abort"
         description: "Stop the phase commit. Resolve the dirty paths first, then re-run the ritual."
         multiSelect: false

     If the dirty-but-untouched set is empty, skip this step.

  4. **Stage explicitly by path.** `git add` each file in the chosen set by name. Do NOT use `git add -A` or `git add .` — explicit paths only.

  5. **Check empty diff.** Run `git diff --cached --quiet`. Exit code 0 means no staged diff. If empty, print:

     ```
     Phase [N] had no diff to commit; rows remain SHA-less; archive warn-only will surface them.
     ```

     Set `SHA=""` and skip to step 8.

  6. **Propose a Conventional-Commits message.** Build a subject line in the form `<type>(<change-id>): <phase title> (p<N>)`, where `<type>` is one of `feat / fix / chore / refactor / docs` chosen from the phase's nature (e.g., `feat` for new user-visible behavior, `chore` for prompt/doc edits, `refactor` for restructuring without behavior change). The phase title is the meaningful part and leads; the `(p<N>)` suffix carries the phase index. Build a short body listing the touched files, plus the `Refs:` line from "Tracking issue/task references for commits" when applicable. Use `AskUserQuestion`:

     - question: "Approve commit message?"
       header: "Commit msg"
       options:
       - label: "Approve as proposed (Recommended)"
         description: "Use the message as drafted."
       - label: "Edit subject line"
         description: "Override the subject; keep the body."
       - label: "Override entirely"
         description: "Replace both subject and body."
         multiSelect: false

  7. **Commit via heredoc.** Run `git commit` per the global commit-message protocol:

     ```bash
     git commit -m "$(cat <<'EOF'
     <type>(<change-id>): <phase title> (p<N>)

     <short body listing touched files>
     <Refs: issue/task references, if applicable>
     EOF
     )"
     ```

     Never pass `--no-verify`, `--amend`, or signing-bypass flags. If a pre-commit hook fails, fix the underlying issue and create a NEW commit — the original commit did NOT happen, so amending would touch the previous phase's commit instead.

  8. **Capture the short SHA.** Run `git rev-parse --short HEAD` and store as `SHA`. Skip this step if `SHA=""` was set by step 5.

  9. **Write the SHA back into Progress.** For every Progress row flipped during this phase, run a targeted Edit:

     - Find: `- [x] N.M <title>` (no existing ` — <sha>` suffix at end of line)
     - Replace with: `- [x] N.M <title> — <SHA>`

     Skip rows that already carry a SHA suffix (resume safety: if the ritual is re-entered after a partial run, do not double-append). If `SHA=""`, skip the append entirely — the rows stay SHA-less and `/10x-archive` will surface them as informational warnings under its missing-SHA soft-warning check.

  10. **Update `change.md`.** Set `updated: <today>`; keep `status: implementing` (idempotent until the final phase). On the final phase, set `status: implemented` after the SHA write-back lands (see "After all phases" below).

  11. **Reset the touched-file set.** Clear it before starting the next phase. The ritual is self-contained per phase.

- **Next phase decision**: If there is a next phase, help the user decide whether to continue or start fresh.

  Use `AskUserQuestion` to present the decision:

  AskUserQuestion:
  - question: "Phase [N] complete. How to proceed?"
    header: "Next phase"
    options:
    - label: "Continue to Phase [N+1] — delegate"
      description: "Proceed to the next phase with a subagent writing the code. Keeps this context lean; you see the touched files, adaptations and gate verdicts when it returns."
    - label: "Continue to Phase [N+1] — in context"
      description: "Proceed to the next phase and write the code here, where you can watch the edits land and redirect mid-phase."
    - label: "Clear context first"
      description: "Copy resume command to clipboard. Start fresh for Phase [N+1]."
    - label: "Review this phase first"
      description: "Run /10x-impl-review to verify implementation against the plan before proceeding."
      multiSelect: false

  **If user chooses to review**: Run `/10x-impl-review @[path-to-plan] phase [N]` to review the just-completed phase. After the review completes, re-present the continue/clear decision (without the review option this time).

  **If user chooses either continue option**: Proceed directly to the next phase — read the plan section for the next phase, set the task to `in_progress`, and implement in the chosen execution mode (see "Per-phase execution mode"). No need to re-read the entire plan or already-loaded files; a delegated phase still gets its own plan section verbatim in the dispatch prompt.

  **If user chooses to clear**: Copy the resume command to clipboard and display it:
  1. Copy:

     ```bash
     echo -n "/10x-implement <change-id> phase [next-phase-number]" | pbcopy 2>/dev/null || echo -n "/10x-implement <change-id> phase [next-phase-number]" | clip.exe 2>/dev/null || echo -n "/10x-implement <change-id> phase [next-phase-number]" | xclip -selection clipboard 2>/dev/null || true
     ```

     ```powershell
     # PowerShell (Windows)
     Set-Clipboard "/10x-implement <change-id> phase [next-phase-number]"
     ```

  2. Display:
     ```
     → /10x-implement <change-id> phase [next-phase-number] (✓ copied)
     ```

If instructed to execute multiple phases consecutively, skip the AskUserQuestion between phases and carry the last chosen execution mode forward.

do not check off items in the manual testing steps until confirmed by the user.

## State Tracking

**The `## Progress` section in `plan.md` is the single source of truth.** No state file. No comment markers. See `references/progress-format.md` for the format contract.

### After each step

Use Edit to flip exactly one Progress line at a time:

- Find: `- [ ] N.M <title>`
- Replace with: `- [x] N.M <title>`

Do not append the SHA suffix on a per-step Edit — the SHA is written back at phase end by the commit ritual (see "Verification Approach" above), and only the closing commit's SHA goes onto every row that flipped during the phase. Mid-phase, completed rows sit `[x]` without a SHA suffix; this is a valid intermediate state.

### After each phase

When all `- [ ]` items inside `### Phase N:` are now `- [x]`:

1. Run the phase-end commit ritual (see "Verification Approach" above): manual confirmation → staging → dirty-path prompt → commit → SHA write-back.
2. `change.md.updated` is bumped as part of step 10 of the ritual.

Empty-diff phases (manual-verification-only or no-op adapted phases) commit nothing and leave their rows SHA-less; `/10x-archive` will surface them as informational warnings under its missing-SHA soft-warning check. This is intentional — not every phase produces code.

### After all phases

When every `- [ ]` in the entire `## Progress` section is now `- [x]`:

1. **Defensive pending-items surface.** Re-scan the entire `## Progress` section one last time for any `- [ ]` rows. Under normal flow this is a no-op — the trigger condition for "After all phases" is already "every `- [ ]` is `- [x]`", so the surface should find nothing. It exists to make any unexpected stragglers explicit rather than silently lost (e.g., if a partial run, a manual edit, or a resume path bypassed the trigger). If the count is non-zero, list each row as `<phase>.<index> <title>` grouped by Automated vs Manual subsection in document order, then ask via `AskUserQuestion`:

   - question: "<N> Progress item(s) still pending. How to proceed?"
     header: "Stragglers"
     options:
     - label: "Pause (Recommended)"
       description: "STOP without flipping change.md.status. Address the stragglers manually, then re-enter the epilogue path."
     - label: "Proceed to epilogue"
       description: "Flip status: implemented and run the epilogue commit anyway. Stragglers will surface as warnings under /10x-archive."
       multiSelect: false

   On "Pause": STOP immediately. Do NOT update `change.md`, do NOT run the epilogue commit. On "Proceed to epilogue": continue with steps 2–4 below. If the count is zero, skip this step and continue.

2. Update `change.md`: set `status: implemented`, `updated: <today>`. (Do NOT set `archived_at` — that belongs to `/10x-archive`.)
3. Do NOT write any HTML comment progress marker at the bottom of the plan.
4. **Run the epilogue commit.** The final phase's commit cannot contain its own SHA (chicken-and-egg), so the SHA write-back into the final phase's Progress rows plus the `change.md` status flip both sit dirty in the working tree after the final phase ritual returns. Author one closing commit to land them — otherwise `/10x-archive`'s hard-refusal gate (uncommitted paths inside the change folder) will block. Steps:
   1. Stage exactly `context/changes/<change-id>/plan.md` and `context/changes/<change-id>/change.md` (explicit paths, no `git add -A`).
   2. Run `git diff --cached --quiet`; if exit code 0, skip the epilogue (nothing trailing to commit) and stop here.
   3. Propose subject `chore(<change-id>): close out plan (epilogue)` with a short body noting the plan's final SHA write-back + change.md → implemented, plus the `Refs:` line from "Tracking issue/task references for commits" when applicable. Use AskUserQuestion to approve as proposed / edit subject / override entirely (same options as the phase ritual).
   4. Commit via heredoc per the global protocol (never `--no-verify` / `--amend`).
   5. Do NOT write the epilogue's own SHA back into the plan — its only job is to land the trailing edits cleanly.

### "Where am I?" — derived, not stored

Parse the `## Progress` section. The first `- [ ]` line is the next step. The current phase is the `### Phase N:` heading immediately above it. Completion is `count([x]) / count([ ] + [x])`. No JSON, no markers, no sidecar — just the Progress section.

## Plan Completion

When ALL phases are implemented and verified (every Progress checkbox is `[x]`):

1. Confirm `change.md.status` is now `implemented`.
2. Present completion summary, then offer a final review:

```
All phases implemented! 🎉

Summary:
- Phases completed: [N]
- Files changed: [list key files]
```

Use AskUserQuestion:

```
question: "Plan complete. Would you like a final implementation review?"
header: "Plan Complete"
options:
  - label: "Run full review (/10x-impl-review)"
    description: "Comprehensive review of all phases against the plan. Catches cross-phase issues."
  - label: "Skip review — I'm satisfied"
    description: "No review needed. Mark the plan as done."
multiSelect: false
```

If user chooses review → run `/10x-impl-review <change-id>` (no phase number = full plan review).

## If You Get Stuck

When something isn't working as expected:

- First, make sure you've read and understood all the relevant code
- Consider if the codebase has evolved since the plan was written
- Present the mismatch clearly and ask for guidance

See "When you're stuck or in unfamiliar territory" in [references/implementation-discipline.md](references/implementation-discipline.md) for the search-then-reason sequence and what to do when the right value is genuinely ambiguous.

Beyond a delegated phase (see "Per-phase execution mode"), reach for a sub-task when it earns its keep — targeted debugging, or exploring unfamiliar territory:

- **Explore** (`subagent_type: "Explore"`) — Fast search for files, patterns, similar code
- **general-purpose** (`subagent_type: "general-purpose"`) — Deep analysis requiring multi-step reasoning

## Resuming Work

If the plan's `## Progress` section has existing `[x]` marks:

- Trust that completed work is done
- Pick up from the first `- [ ]` line
- Verify previous work only if something seems off

Remember: You're implementing a solution, not just checking boxes. Keep the end goal in mind and maintain forward momentum.
