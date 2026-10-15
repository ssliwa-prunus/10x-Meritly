---
name: 10x-observability-audit
description: >
  Audit an existing codebase for code logic that hides production errors:
  swallowed exceptions, errors turned into redirects or 200s, lost stack
  traces and causes, code paths running outside the error tracker, logs that
  never become alerts. Picks the critical user flows from
  context/foundation (shape-notes, PRD, roadmap) or asks for 2-3 areas,
  fans out full-stack subagent audits, optionally proves gaps at runtime
  with a local fake error-tracker endpoint, and writes a new dated report
  under context/audits/observability/ on every run. Use whenever the user
  asks why production errors are missing or hard to debug, wants an
  observability / monitoring / error-tracking / logging audit, asks "what
  does Sentry (or Datadog, Rollbar, CloudWatch…) miss", "audyt
  observability", "czego nie widzimy w monitoringu", or wants to re-run a
  previous observability audit. Tech-stack agnostic.
argument-hint: "[area ...] [--runtime] [--verify <report-path>] [--out <dir-or-file>]"
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Task
  - Write
  - AskUserQuestion
  - TaskCreate
  - TaskUpdate
  - TaskList
---

# Observability Audit: where do production errors disappear?

The goal is one question, asked per critical user flow: **when this breaks in
production, will anyone find out, and will they be able to tell why?**

Most codebases fail that test in a handful of systemic ways, not in hundreds
of unrelated places. Some code paths run outside the error tracker's scope.
Failures come back as ordinary responses. Error objects are dropped at the
first `catch`. Privacy filters remove the diagnostic data. Deploys aren't
labelled. The audit's job is to find those mechanisms, show the concrete
places where they hurt the flows that matter, and prove the worst of them.
It doesn't produce a lint-style list of every empty `catch`.

**The subject is application code.** The audit asks what the code does with
a failure once the monitoring pipeline exists: does it throw, catch, log,
report, flatten or drop it? Whether a logging product or error tracker is
switched on is a precondition, not the audit's question. It is often set in
a platform or vendor dashboard, so the repo can't show it.
Assume the pipeline works in production unless the user says otherwise.
Config the repo doesn't contain is **unknown, not missing**, and it never
becomes a root cause.

The skill never modifies the audited code in the main working tree. It
writes one new report per run. Runtime proof happens only in a throwaway
isolated copy.

## When to use, when to skip

**Use when** the project has code running in production (or about to) and
the user suspects errors are invisible, noisy or undiagnosable. Also use
before a launch, after an incident where "we had no logs", or to re-check
an earlier audit.

**Skip when** the user wants to fix one specific known error: that is
normal debugging. Also skip when they want to _choose_ a monitoring vendor
(`/10x-infra-research`) or run a general project health check
(`/10x-health-check`).

## Inputs

- **Foundation docs (optional, preferred):** `context/foundation/shape-notes.md`,
  `context/foundation/prd.md`, `context/foundation/roadmap.md`. They tell you
  which flows matter to users and the business, so the audit spends its
  budget there.
- **Symptom (optional, most valuable):** what the user already sees, e.g.
  "requests show up in the logs but the errors I'm looking for don't". A
  symptom like that confirms the pipeline works and points the audit at the
  code paths that lose errors. Use it to steer area selection and the
  auditor briefs.
- **Arguments (optional):** area names (e.g. `login checkout "admin import"`)
  override area selection. `--runtime` opts into runtime proof without
  asking. `--verify <report>` re-checks an earlier report's findings instead
  of hunting for new ones (see _Verify mode_). `--out <dir-or-file>`, or
  the user naming a location in words, overrides where the report is
  written (see Step 6).
- **Previous reports (optional):** `*.md` in the report directory
  (default `context/audits/observability/`).

## Workflow

Track the steps with TaskCreate/TaskUpdate. The audit is long, and the user
should see where it is.

### Step 0 — Preconditions and run identity

1. Confirm cwd is a codebase (project manifest, source dirs). If not, stop
   and say so.
2. Record the run identity. Every report is anchored to exactly what was
   audited, which is what makes reruns comparable:
   - date (`date +%Y-%m-%d`) and time (`date +%H:%M`), current commit
     (`git rev-parse --short HEAD`), branch, and whether the tree is dirty
     (`git status --porcelain`). A dirty tree is fine, but say so in the
     report.
3. List earlier reports in the report directory (default
   `context/audits/observability/`): `ls <report-dir> 2>/dev/null`.
   Read the frontmatter of the most recent one: areas covered, commit,
   open findings. Pick it by the `date` key, which includes the time; file
   names only carry the day. You will use it in Step 2 and Step 6.

### Step 1 — Discover the observability stack

Before auditing flows, build a **capture model**: a short, evidence-backed
description of how a failure travels from code to a human. Do this yourself
(it needs judgement, and it is small). Cite file:line for every claim.

- **Runtime and platform:** long-running server, serverless/edge functions,
  containers, mobile, browser SPA, SSR framework, background workers, cron,
  queues.
- **Error tracker:** Sentry, Datadog, Rollbar, Bugsnag, Honeybadger, New
  Relic, OpenTelemetry exporter, Application Insights, Crashlytics, or none.
  Find _every_ init site and note what each one covers.
- **Capture boundaries:** where does the tracker actually get a live client?
  Global process handler, per-request middleware, per-route wrapper,
  framework integration, exception filter, error boundary. The central
  question is **which code paths execute outside any boundary**. Examples:
  middleware ordered before the tracker, routes that opt out, streamed
  response bodies, background tasks after the response, worker processes
  without their own init, the client-side app.
- **Logging:** the logger(s), where the logs go (platform log service, file,
  stdout), whether log lines ever become alerts or issues, and how the
  logger serializes error objects.
- **Scrubbing and sampling:** `beforeSend`-style hooks, PII filters, sample
  rates, ignore lists, log head-sampling.
- **Deploy identity:** release/version and environment tags; source maps or
  debug symbols; whether preview/staging traffic is distinguishable from
  production.

Keep this step short. It is context for the code audit, not the audit. Tag
each claim as **in repo** (cited file:line) or **outside repo** (dashboard
or platform setting you can't see). For outside-repo pieces, write the
assumption ("assumed: platform log collection is enabled") instead of a
finding. If the whole audit depends on one of these (no tracker SDK
anywhere in the code, and the user didn't mention a symptom), ask the user
one question about what they see in production before going on. Don't guess.

Put the capture model in the report. The subagents also need it, so they
don't each rediscover it.

### Step 2 — Pick the areas (the flows that matter)

Choose **2–4 critical user flows**, each audited full-stack (UI → API →
services → data/external calls → background work). Resolve them in this
order:

1. **Arguments:** use them as given.
2. **Foundation docs:** read the three files that exist. Pick the flows
   whose failure would hurt most: the core value loop (the thing users come
   for), identity/access (login, signup, permissions), money or irreversible
   writes (payments, publishing, imports, data deletion), and anything the
   roadmap marks as in-flight or recently shipped (new code, least battle-tested).
   Present your pick with a one-line reason each, and let the user adjust
   (AskUserQuestion, with your pick as the recommended option).
3. **No foundation docs:** ask the user for 2–3 areas to review
   full-stack (AskUserQuestion). Offer 3–4 concrete candidates you inferred
   from the route/page/module structure, so they are not answering blind.

**Rotation on reruns.** If earlier reports exist, prefer flows they did not
cover, or covered at an older commit, and say so ("login and CMS were
audited on 2026-09-24; this run proposes checkout and notifications").
The user can still choose to re-audit the same areas; the report then
records how each earlier finding changed.

### Step 3 — Fan out the audits (parallel subagents)

Launch in a single message, so they run concurrently:

- **One auditor per area** (read-only).
- **One plumbing auditor** (read-only). It covers the cross-cutting _code_
  no area owns: tracker init code, boundaries and middleware order, the
  logger's error serialization, scrubbing hooks, release tagging in code,
  background/worker entry points, client-side global handlers, plus a
  repo-wide sweep with counts. It does not audit dashboard or platform
  settings.

Use the briefs in `references/auditor-briefs.md`. Paste the capture model
from Step 1 into every brief, together with the user's symptom (if any) and known issues from earlier
reports or triage docs. Classify every finding with the taxonomy and
severity rubric in `references/gap-taxonomy.md`, so that area results merge
cleanly.

While they run, prepare Step 4 if it applies.

### Step 4 — Runtime proof (optional, isolated)

Static reading says "this _should_ be invisible". A runtime probe shows it
is. Offer this step when the audit found critical coverage gaps and the app
can boot locally. Run it when the user passed `--runtime` or agreed.

Follow `references/runtime-probes.md`. The essentials:

- Work in an **isolated copy only**: a git worktree (the subagent's
  `isolation: "worktree"` option) or a temp clone. Never touch the main tree,
  never commit, never push, never deploy.
- Point the error tracker at a **local fake ingest endpoint**
  (`scripts/fake-ingest.mjs`) instead of the real service. Never send probe
  events to a production tracker, and never use production databases or
  third-party accounts.
- Inject a fixed catalog of failure shapes (thrown in handler, thrown in
  early middleware, error returned as a 5xx without throwing, ignored error
  result, unhandled rejection, background task failure, error object passed
  to the logger…) with a probe trigger (e.g. `?probe=<id>`). Record HTTP
  result / platform console output / what reached the fake tracker.
- Script the run (`suite` script), so it can be repeated identically.
  Keeping the harness is what makes before/after proof possible later.

If the app cannot boot (missing infra, secrets, paid services), report the
exact blocker. Mark the affected findings as _static-only_; never guess
runtime results.

### Step 5 — Verify, then synthesize

Subagents over-report. Before the report:

- **Spot-check** the 3–5 most surprising or most severe claims yourself
  (read the cited lines, run the regex, check the SDK source in the
  dependency folder). Drop or downgrade anything that doesn't hold, and say
  in the report that you verified it.
- **Deduplicate** across areas. Several area findings are often one
  mechanism: "12 routes don't call the reporter" is _one_ coverage gap with
  12 locations, not 12 findings.
- **Drop precondition findings.** "Logging isn't enabled in the deploy
  config", "no log forwarding", "no alert rules in the repo" or "no tracker
  key in the example env file" aren't findings when the setting can live
  outside the repo. Move them to the report's _Assumptions_ list. Keep a
  config item only when code you can cite actively degrades events (a
  scrubbing hook that drops stacks, error sampling below 100%, an ignore
  list that matches first-party errors).
- **Name the systemic root causes** (usually 3–6). These are the most
  valuable part of the report, because fixing one root cause closes many
  findings. Every root cause must be a code mechanism with file:line
  evidence: where the error is caught, converted, stripped or run outside a
  boundary. "Monitoring isn't configured" is never a root cause. It's
  unverifiable from the repo, and if it were true it would hide every
  code-level gap behind one fix that doesn't help.
- **Order the fixes** by blindness removed per unit of effort. Wide-coverage
  code fixes (one global boundary, logger serialization, scrubbing scope,
  a shared error-to-response helper that keeps the cause) usually come
  before local ones.

### Step 6 — Write the report (new file every run)

Write the report using `references/report-template.md` to:

```
<project-root>/context/audits/observability/<YYYY-MM-DD>_<slug>.md
```

- `<project-root>` is the audited project's root (`git rev-parse
--show-toplevel`, or cwd outside git), not the skill's directory.
- `<slug>` is the audited areas in kebab-case, joined with `-` (e.g.
  `login-checkout`), or `verify-<areas>` in verify mode.
- Create the directory if needed.
- **User override:** if the user passed `--out` or named another location,
  use it. A directory gets the same `<YYYY-MM-DD>_<slug>.md` file name; a
  path ending in `.md` is used as is. Use the default in every other case,
  and don't ask about it.

- **Never overwrite or edit an earlier report.** If the path exists, add
  `-2`, `-3`. Earlier reports are the history that later runs compare
  against.
- The report's frontmatter records the run identity, areas, mode, runtime
  proof status and a link to the previous report. The next run relies on
  that frontmatter, so keep its keys stable.
- If a previous report exists, fill **Changes since last audit**: for each
  earlier finding in an area you covered again, mark it `fixed`, `still
open`, `changed` or `not re-checked`, with evidence.
- Keep each finding to its location, its category, its severity, **what
  happens in production when it fails**, and a one-line fix direction. The
  production consequence is what makes a finding actionable, so never leave
  it out.

### Step 7 — Hand off

Tell the user, in a few lines: the report path, the top 3 root causes, the
count of findings by severity, what was runtime-proven vs static-only, and
the recommended first fix. Offer next steps:

- prove a specific fix with a before/after run on the same probe suite
  (see _Verify mode_);
- turn the top fix into a change with `/10x-new` + `/10x-plan`.

Mention that isolated worktrees or harness files from Step 4 still exist,
and where. Don't delete them without asking, because they are needed for
before/after proof.

## Verify mode (`--verify <report>`)

Use this after fixes land, or to prove a proposed fix works. Read the given
report and re-check each finding: re-read the cited code, and, if the report
has a probe harness, re-run the same suite. Produce a new dated report with
`mode: verify` whose body is mainly **Changes since last audit** and a
before/after table. The same probe catalog before and after is what turns
"we think it's fixed" into evidence.

## Principles

- **Code over configuration.** Assume logs and the tracker are collected in
  production. The question is what the code hands them. A missing setting
  you can't see in the repo is an assumption to confirm, not a finding.
- **Coverage first, then fidelity, then noise.** A failure the tracker never
  sees matters more than one it sees without a stack, which matters more
  than one it sees too often.
- **Judge by what a responder would get.** For each gap, ask what an
  on-call engineer would see at 3 a.m.: an alert? an issue with a stack and
  the user/route/entity? a log line they would need to already know to
  search for? nothing?
- **Graceful degradation needs its own signal.** Fallbacks that keep users
  unblocked are good. Fallbacks that also remove the only sign of the outage
  are findings.
- **Privacy is a constraint, not an excuse.** Recommend fixes that keep
  scrubbing working (hash or id instead of email, keep error names/codes and
  stacks, drop only the values). Never recommend sending PII.
- **Stack-agnostic wording.** Describe mechanisms ("route opts out of the
  reporting wrapper"), then the concrete local API. The taxonomy works for
  any language or framework.
