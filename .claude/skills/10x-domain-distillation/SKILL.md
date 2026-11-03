---
name: 10x-domain-distillation
description: >
  Distil the business domain of an existing codebase into one map
  (context/domain/domain-distillation.md): the ubiquitous language with
  sources in the docs and in the code, subdomains classified as Core,
  Supporting or Generic, aggregate candidates and policies with their
  invariants and whether the code enforces them, the model-vs-code drift list,
  a ranking of what to fix first with a "done when" per item, owner-routed
  questions, and a compact glossary for agents (context/domain/glossary.md).
  Findings carry stable IDs and are diffed against the previous run.
  Tech-stack agnostic; works with or without requirement documents. Use when
  the user wants to discover or name the domain of a grown
  codebase, build a ubiquitous language or glossary from the repo, check
  whether the code matches the product documents, find the model-vs-code
  drift, classify subdomains, or asks for "domain distillation", "destylacja
  domeny", "słownik domeny", "DDD map of this repo".
argument-hint: "[--root <path>] [--docs <path>...] [--lang <code>] [--replace]"
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

# Domain distillation: the domain the code never named

Produce one report, `context/domain/domain-distillation.md`, that answers:
**what is this product's domain made of, which words name it, does the code
use the same words and the same rules, and where has the code drifted from
the business?**

The product is a **map of the domain, not code and not a refactoring plan**.
Assume nothing up front: no entity names, no aggregates, no paths, no
requirement numbers. Discover them, and cite where each one comes from.

**The domain is discovered, not given.** The skill takes no target term or
area. It distils the whole product (or the `--root` subtree) and ends with a
ranking; choosing what to change next stays with the user.

## Outputs

All outputs live under `<repo-root>/context/domain/`, also when `--root`
narrows the code scope.

| Path                                           | What                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| `context/domain/domain-distillation.md`        | **The report** — the only file meant to be read by people and later work           |
| `context/domain/glossary.md`                   | Compact glossary for agents and people: term, meaning, name in code, don't call it |
| `context/domain/evidence/0-sources.md`         | Code scope, stack and layers, exclusions — no domain vocabulary                    |
| `context/domain/evidence/0-documents.md`       | Domain documents and product goals                                                 |
| `context/domain/evidence/1-docs-language.md`   | Terms, definitions, lifecycles, rules and goals stated in the documents            |
| `context/domain/evidence/2-code-language.md`   | Domain names in the code: types, tables, states, operations, events                |
| `context/domain/evidence/3-code-rules*.md`     | Business rules the code guards: where, at which layer, how strictly                |
| `context/archive/<stamp>-domain-distillation/` | Earlier report, glossary and evidence, moved here on replace                       |

## 1. Preflight

- If `context/domain/domain-distillation.md` exists: with `--replace`, or when
  there is nobody to ask (an orchestrated or CI run), move it to
  `context/archive/<stamp>-domain-distillation/domain-distillation.md`, with
  `glossary.md` and the old `evidence/` next to it
  — `<stamp>` is the report's modification time as `YYYY-MM-DD-HHMM` — point
  the archived report's `evidence:` field at its new `evidence/`, and
  continue; otherwise ask once whether to replace it. That is the only
  question.
- **Scope.** Without `--root`, the code scope is the whole repository. In a
  monorepo whose requirements documents describe one application, set the
  code scope to that application and list the other packages as excluded,
  with a one-line reason each. Documents are always discovered from the
  repository root (and `--docs`), whatever the code scope.
- Report language: `--lang`, else the language of the user's request, else
  English. Domain terms stay in the language the sources use; never
  translate a term the code or the documents spell in another language.
- `mkdir -p context/domain/evidence`. List files with
  `git ls-files --cached --others --exclude-standard` in a git repository,
  so ignored and generated trees stay out and untracked documents stay in.
- Paths in every file are repository-relative. When the code scope is deep,
  the report header may define one alias (`app/` = `apps/shop/src/`).
- Record the short HEAD and whether the worktree has uncommitted changes.

## 2. Source inventory (main agent)

Build the shared ground truth before dispatch, following
[references/source-inventory.md](references/source-inventory.md). It has two
files on purpose:

- `evidence/0-sources.md` — the code scope, stack, where each layer lives,
  exclusions. **No domain vocabulary**: the code agents read it, and
  document terms reaching them would turn their findings into confirmation
  of what they were told.
- `evidence/0-documents.md` — the domain documents by kind, the product goals
  and their quotes. Read by the docs agent and the synthesis only.

Read headings and short passages; leave full reading to the sub-agents.

## 3. Dispatch the evidence sub-agents in parallel

Spawn them in **one message**. Each prompt contains: the absolute path of this
skill directory (`<loaded-skill-dir>` in the briefs), its brief path, the
repository root, the code scope, the inventory files it may read, its output
path, the report language and the rules below. Tell each sub-agent to read its
brief first.

| Sub-agent     | Brief                                                                  | Reads                | Question                                                   |
| ------------- | ---------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------- |
| docs-language | [references/agent-docs-language.md](references/agent-docs-language.md) | both inventory files | Which words, lifecycles and rules does the business state? |
| code-language | [references/agent-code-language.md](references/agent-code-language.md) | `0-sources.md` only  | Which words does the code use, and for what?               |
| code-rules    | [references/agent-code-rules.md](references/agent-code-rules.md)       | `0-sources.md` only  | Which rules does the code actually guard, and where?       |

**Large code scope.** When the code scope holds more than ~1,500 source
files, split code-rules into one agent per group of layers or top-level
areas from `0-sources.md` (at most four), each writing
`evidence/3-code-rules-<group>.md`. Coverage beats depth: an area no agent
searched is an unknown, never "no rules".

In Claude Code dispatch with the `Agent` tool (`Task` in older versions),
`subagent_type: "general-purpose"` — they need Write. In other hosts use the
native equivalent. Without sub-agent support, run the briefs sequentially
yourself, code agents first, before reading any document.

The split is deliberate: the language agents never see each other's output,
and the rules agent inventories guards without being told which rules to
look for. Agreement found later in synthesis is then real agreement.

Rules to pass to every sub-agent:

1. Cite every term, rule and guard as `path:line`, verified in this session.
   Never invent a term, a definition or a location.
2. Quote the source's own wording for definitions and rules; paraphrase only
   in a clearly marked explanation.
3. Label findings `evidence`, `inference` or `unknown`. A search that found
   nothing is reported with the scope searched, never as "does not exist".
4. Read-only: no code changes, no builds, no installs.
5. Return to the main agent at most 15 lines: the strongest findings, the
   gaps, and coverage.

Wait for all of them. A failed or partial sub-agent is a stated gap in the
report; retry once only if the failure was mechanical.

## 4. Synthesize the report

Cross the evidence files and write `context/domain/domain-distillation.md`
following [references/report.md](references/report.md): the ubiquitous
language with a code location or an explicit **missing in code** for every
Core and Supporting term, context boundaries, subdomains, aggregate
candidates and policies with each invariant's status (**enforced**,
**declared**, **ignored**, **contradicted**; **undocumented** for
exposures no document covers), the model-vs-code drift list,
and the ranking — then make it operational as `report.md` describes: stable
IDs, a fix side for every drift row, a _done when_ for every ranked item,
questions with an owner, changes since the previous run, and
`context/domain/glossary.md`.

Before calling a documented rule _ignored_ or a term _missing in code_, run a
targeted search yourself (`rg` over the term, its variants and synonyms in
the layer where it should live). Batch them per layer and cite each batch's
scope once.

## 5. Verify, then present

Run the verification pass in
[references/report.md](references/report.md#verification). Then present in
5–8 sentences: the report path, the number of Core and Supporting terms and
how many are missing in code, the Core subdomain(s), the strongest drift,
the #1 candidate and why, the drift counts by fix side (code / docs /
decision), the open questions, and the main limitation. Point to the glossary
as the file to reference from agent instructions. Stop there; the
distillation does not design or start a refactor.
