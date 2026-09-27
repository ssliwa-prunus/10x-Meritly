---
name: 10x-research
description: Investigate codebase questions with source-backed findings, scoped research and parallel sub-agents. Save research for implementation planning.
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Agent
  - Task
  - Write
  - AskUserQuestion
  - TaskCreate
  - TaskUpdate
  - TaskList
  - TaskGet
---

# Research Codebase

Answer the user's research question with current, source-backed findings. Keep
implementation, product decisions and lifecycle changes outside the research
scope unless separately requested.

## Start from the supplied request

If a question, change-id or file was supplied, begin with that context; do not ask
for the same request again. For `/10x-research <change-id>`, use the active change's
request/change/frame artifacts to establish the question. Ask for the missing
question only if neither the message nor those artifacts defines one.

Resolve the active change before any writes. An explicit archived change is
read-only: explain that a new change is needed, and stop before writing there.
If no change-id was supplied, derive one from the topic when saving the document.

## 1. Establish evidence and scope

- If the user mentions specific files (tickets, docs, JSON), read them FULLY first (no limit/offset)
- **CRITICAL**: Read these files yourself in the main context before spawning any sub-tasks

Read `context/foundation/lessons.md` if present and treat its entries as known-pattern priors when shaping the research areas — recurring rules already accepted by the team narrow what's worth re-investigating.

Keep a compact list of the questions to answer, existing evidence, unresolved
contradictions and next checks. A focused question may need one local lookup;
comprehensive scope needs coverage of every agreed area, delegated in parallel by
default (step 2).

Clarify only ambiguity that would materially change the investigation. Use the
host's actual structured question tool when available (Claude AskUserQuestion,
Codex request_user_input, OpenCode question), respecting its schema, round size and
custom input. Use short headers (at most 12 characters) and concrete options with
descriptions. In a host without that capability, ask a concise text question for
required scope clarification; do not simulate a tool call. An unambiguous research
request needs no interview or mode switch. User preferences are decisions; verify
corrected factual assertions against the indicated source.

## 2. Select and execute the investigation

Work locally for a single located fact or sequential reasoning. Comprehensive or
multi-area research is delegated by default, not as an exception. Before the first
dispatch read [references/task-orchestration.md](references/task-orchestration.md)
and use its bounded assignments, available model/capability checks, failure
fallback and evidence requirements. Spawn 2–4 workers in parallel in a single
message, each on a different research dimension and each asked for `file:line`
anchors — for example one locating every file related to X, one looking for prior
decisions about Y in `context/changes/**/` and `context/archive/**/`, one analyzing
how the Z subsystem works. Dispatch fewer only when the scope is genuinely
single-area, or when a gap depends on a prerequisite that is still unresolved.
In Claude Code, dispatch with the `Agent` tool (`Task` in older Claude Code
versions) — `subagent_type: "Explore"` for locating code, `"general-purpose"`
for analysis; in other hosts use the native equivalent. Use task tracking when it
helps coordinate several areas and the host exposes it; otherwise the working
list suffices.

The primary agent owns the question and synthesis. Children investigate read-only
and return anchors, uncertainty and actual coverage. Do not ask every worker to
read the full repository or the same large documents. Continue independent work
while they run; inspect material evidence as results arrive. Wait for ALL
dispatched workers to complete before synthesizing — a partial sweep is a stated
gap, not an answer.

On a follow-up or scope correction, update affected questions and workers, retaining
unrelated findings. A late answer based on superseded scope cannot overwrite the
new decision. Follow up on a concrete gap instead of restarting broad discovery.

## 3. Synthesize and close discovery

Connect the evidence into an answer to the original question. Distinguish observed
behavior, inference and unresolved facts. Inspect decisive/conflicting code paths
and callers; a search miss alone does not prove absence. Cite the inspected scope
when making a negative finding. Broaden only when it can resolve an agreed question
or material contradiction, not to fill an optional document section.

When recommendations are requested, preserve established requirements and reject options that weaken required guarantees. Distinguish settled decisions, genuine choices and missing evidence.

Stop when the agreed questions have adequate evidence and consequential conflicts
are resolved. Close or cancel obsolete tasks. Required evidence still missing
means a partial finding with the gap and its impact stated; do not claim completion
or continue spawning equivalent searches indefinitely. Do not run builds or tests
unless their results answer a specific research question and the host permits them.

## 4. Write and verify the research artifact

When repository writes are allowed, save
`context/changes/<change-id>/research.md`, preserving existing material and user
edits. Create the active folder and `change.md` only if missing, following
`/10x-new` semantics. Never overwrite another change or write in `context/archive/`.
Read [references/research-document.md](references/research-document.md) at this
stage for the output format; do not load it merely for source discovery.

Before writing `research.md`, apply the bounded-assertion and prose/JSON checks in
that reference. Every quantitative or universal prose claim needs an explicit
condition, a quantifier (exact set, count, or “this inspected path”), and a source
anchor. Do not write “always”, “never”, “every”, “only”, or “on the first attempt”
unless the named condition and inspected path actually have that scope. Adjudicate
each historical assertion on its own: a document that is stale on counts may still
be correct on another field; a positive list is not an exclusive set unless the
source says so.

When a structured facts file was requested (JSON or table), finish a separate
prose-versus-JSON pass before persisting either file: for each leaf, spell the
prose sentence that value would make if true, confirm the same sentence is in
`research.md`, and confirm the JSON value matches the same source. JSON agreement
does not certify the surrounding prose. Run the bundled Node checker once:

```sh
node <loaded-skill-dir>/scripts/prose-json-check.mjs <research.md> <facts.json>
```

It only verifies that each JSON number and boolean appears in the prose; it does
not prove quantifiers. Missing leaves or extra universal wording still need a
manual correction. If Node is unavailable, complete the same checklist by hand.

Gather metadata from the actual repository and current clock once; no fabricated
branch, commit, timestamp or researcher identity. Write change.md metadata
**exclusively** through bundled [scripts/metadata-guard.mjs](scripts/metadata-guard.mjs)
with Node — never rewrite existing YAML from a template or drop identity fields:

```sh
node <loaded-skill-dir>/scripts/metadata-guard.mjs inspect <change-dir>
node <loaded-skill-dir>/scripts/metadata-guard.mjs mark-researched <change-dir> --expected-sha256 <inspected-change-sha256> --date <YYYY-MM-DD>
```

`mark-researched` advances only `new` to `preparing`, sets `updated` to today, appends
missing owned fields, and preserves `change_id`, `title`, `created`, unrelated YAML,
body and later lifecycle states. It requires a saved `research.md`. A stale fingerprint
requires rereading the changed metadata. If Node is unavailable or syntax unsupported,
inspect the file and make only the same narrow status/date edit; never replace the
frontmatter. The helper uses optimistic fingerprints and atomic replacement, not a
transaction with external editors. A research document may be complete or partial
independently of change lifecycle.

Review the final artifact once to check its answer, citations, gaps and metadata:
read back persisted content, or review the complete draft when presenting it unsaved
in the conversation. In that same pass, re-run the bounded-assertion and
prose/JSON checklist (do not skip it because the first draft already existed):

- Bind a numeric example to its named inputs, units and conditions before deriving
  its result; distinguish totals from additional operations. Do not infer a value's
  meaning from a field name or familiar number alone.
- For each consequential Boolean, spell out the assertion it would make if true,
  then check whether the inspected source supports that assertion before assigning
  the value. A field describing whether a historical claim is supported answers
  that support question, not whether the historical document contains the claim.
- Correct historical claims individually. Some claims in an outdated document may
  still hold: attach a current verdict to each relevant historical assertion rather
  than labeling an entire paragraph stale. Trace relevant consumers before calling
  a shared rule exclusive to one component. Prefer the exact observed set or
  predicate to broader wording such as “all errors” or “every status in a class”.

Reuse source anchors and calculations already verified. A mismatch triggers only
the affected source/caller check and correction in each output, not a new discovery
pass. If it remains unresolved, qualify the claim and state the gap consistently.
This check requires no extra artifact, worker or test run by default.
Use compact validation output instead of repeatedly printing it. Run any applicable
repository document checks once. Add commit permalinks only if the cited bytes
match that commit and the remote is known to contain it; local uncommitted evidence
keeps local file:line references. Do not invent a permalink from a branch name.

If the host forbids writes, present the research and explicit unsaved status in the
conversation. Do not create a fallback file or delegate a write. Resume saving in
a writable mode in the same conversation after checking current target files and
available context; do not restart settled research or promise recovery of missing
conversation content.

## 5. Present findings and handle follow-ups

Lead with the answer, artifact location or unsaved state, decisive references and
material limitations. Research does not imply approval for a plan or implementation.
For a planning handoff, surface settled facts, their sources, affected contracts
and unresolved product choices so `/10x-plan` can build on them without rediscovery.

Append follow-up findings to the same research document, update `last_updated`,
`last_updated_by` and `last_updated_note`, and identify conclusions superseded by
new evidence. Reuse unaffected results; investigate only the new or invalidated
questions. Preserve scope, host permissions and any intervening human edits.
