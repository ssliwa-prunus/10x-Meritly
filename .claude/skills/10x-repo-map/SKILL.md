---
name: 10x-repo-map
description: >
  Build a Project Map (context/map/repo-map.md) of an unfamiliar or legacy
  repository in one run, organised around business capabilities — checkout,
  billing, sign-in, search, notifications, whatever the product actually
  does — and ranked by criticality × buzz: where change, fixes, reverts and
  discussion concentrate. A capability inventory from entry points, data
  model and commit vocabulary feeds four parallel evidence sub-agents
  (history, discussion, structure, people); the main agent synthesizes one
  decision-ready report with risk zones, a first-day reading list and
  explicit unknowns. Tech-stack agnostic; works on git alone, richer with the
  GitHub CLI. Use when the user wants to get up to speed in, map or
  understand a large or inherited codebase, asks "where do I start in this
  repo", "what are the hot areas here", "zbuduj mapę projektu", "wide scan",
  "repo map", or wants to refresh an existing context/map/repo-map.md.
argument-hint: "[--root <path>] [--since <git-date>] [--lang <code>] [--replace]"
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Write
  - Agent
  - Task
  - AskUserQuestion
---

# Project Map: where the business lives and where it hurts

Produce one report, `context/map/repo-map.md`, that answers for a repository
nobody explained to you: **what does this product do, which of its
capabilities matter most, where is the most buzz — change, fixes, reverts,
discussion — and where must I be careful before a bigger change?**

The method is a **Wide Scan**: never read the repository; let cheap,
deterministic tools (git history, the forge, a dependency graph) collect
evidence outside the context window, and interpret only their condensed
output. The unit of analysis is a **business capability**, not a folder.
Folders and imports explain a capability's problems; they do not rank them.

**Breadth, not depth — the map takes no target.** It is for getting up to
speed in a whole repository (or the `--root` subtree): a new team member,
someone back after a long break, a team inheriting a repo. The skill
discovers the capabilities itself; it takes no feature, module or question to
focus on and never narrows the scan. Its risk zones and unknowns are where a
deeper, focused investigation should start.

## Outputs

| Path                                   | What                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| `context/map/repo-map.md`              | **The report** — the only file meant to be read by people and by later work        |
| `context/map/evidence/1-history.md`    | Change activity, fix pressure and co-change per capability                         |
| `context/map/evidence/2-discussion.md` | PRs, reviews, reverts, issues, planning artifacts and debt markers per capability  |
| `context/map/evidence/3-structure.md`  | Dependency graph between and inside capabilities: blast radius, cycles, boundaries |
| `context/map/evidence/4-people.md`     | Who carries each capability, against the team-size baseline                        |
| `context/archive/<stamp>-repo-map/`    | Earlier report and its evidence, moved here on replace                             |
| `context/map/.work/`                   | Disposable intermediate data, git-ignored by its own `.gitignore`                  |

## 1. Preflight

- Confirm a git repository. Note the first commit date: when history is
  shorter than the window (default `12 months ago`, `--since` to change), the
  whole history is the window. A shallow clone gets a warning —
  history-based evidence will be partial.
- If `context/map/repo-map.md` exists in the working tree: with `--replace`,
  or when there is nobody to ask (an orchestrated or CI run), move it and
  `context/map/evidence/` to `context/archive/<stamp>-repo-map/` — `<stamp>`
  is the report's `generated` date as `YYYY-MM-DD`, with `-2`, `-3` … when
  that folder exists — and continue; otherwise ask once whether to replace
  it. That is the only question.
- Report language: `--lang`, else the language of the user's request, else
  English.
- `mkdir -p context/map/evidence context/map/.work`, and write
  `context/map/.work/.gitignore` containing `*` so raw data never gets
  committed. Scaffold nothing else.
- Run every git command with `-c core.quotepath=off`, and list files with
  `git ls-files` — never `find` — so worktrees, caches and ignored files stay
  out.
- Check once whether the GitHub CLI is usable for this repo
  (`gh repo view --json nameWithOwner` succeeds). Record the answer; the
  discussion agent adapts.

## 2. Scan contract and capability inventory (main agent)

Build the shared ground truth every sub-agent uses, following
[references/scan-contract.md](references/scan-contract.md): window, buckets,
module roots, the noise filter, excluded commits and the counting rules — and
the **capability inventory** from
[references/capability-inventory.md](references/capability-inventory.md),
the backbone of the whole report. Write `context/map/.work/scan-contract.md`
and `context/map/.work/capabilities.tsv`.

Cheap commands only: git, file listings, `rg` over names and schema, the
headings of the project's own README and docs. Do not read source files.

## 3. Dispatch four evidence sub-agents in parallel

Spawn all four in **one message**. Each prompt contains: the absolute path of
this skill directory (`<loaded-skill-dir>` in the briefs), its brief path, the
scan contract and capabilities paths, its output path, the false-signal list
path, and the rules below. Tell each sub-agent to read its brief first.

| Sub-agent  | Brief                                                            | Question                                              |
| ---------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| history    | [references/agent-history.md](references/agent-history.md)       | What changes, what gets fixed, what changes together? |
| discussion | [references/agent-discussion.md](references/agent-discussion.md) | Where do attention, friction and second attempts go?  |
| structure  | [references/agent-structure.md](references/agent-structure.md)   | How far does a change reach; which boundaries break?  |
| people     | [references/agent-people.md](references/agent-people.md)         | Who carries each capability?                          |

In Claude Code dispatch with the `Agent` tool (`Task` in older versions),
`subagent_type: "general-purpose"` — they need Bash and Write. In other hosts
use the native equivalent. Without sub-agent support, run the four briefs
sequentially yourself.

Rules to pass to every sub-agent:

1. Evidence before interpretation. Every number, ranking or dependency comes
   from a command run in this session. No exploratory reading of source files;
   open a file only to confirm what a command pointed at.
2. Attribute everything to capabilities through `capabilities.tsv` and the
   counting rules in the scan contract; report unattributed volume instead of
   hiding it. Never invent a private attribution or counting scheme.
3. Apply [references/false-signals.md](references/false-signals.md) before
   calling anything a risk; mark mechanical signals as such.
4. Raw output stays in `context/map/.work/`; the evidence file holds condensed
   tables. Label findings `evidence`, `inference` or `unknown`; a blind spot is
   `unknown`, never "no dependencies".
5. Read-only and **install nothing** — locally and on the forge. When a better
   tool would need installing, use the fallback and recommend the tool under
   Unknowns.
6. Return to the main agent at most 15 lines: top findings per capability,
   unknowns, coverage and confidence.

Wait for all four. A failed or partial sub-agent is a stated gap in the
report; retry once only if the failure was mechanical.

## 4. Synthesize the report

Read the four evidence files and write `context/map/repo-map.md` following
[references/report.md](references/report.md): rank capabilities by
**criticality × buzz**, count only independent buzz signals, apply the
false-signal list, and keep its seven sections.

## 5. Verify, then present

Run the verification pass in
[references/report.md](references/report.md#verification). Then present: the
report path, the capability table, the risk zones, which evidence sources
were available (git only, or git plus the forge), graph coverage per
language, and the gaps. Stop there; the map does not start follow-up work.
