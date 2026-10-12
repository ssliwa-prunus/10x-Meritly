---
name: 10x-e2e
description: Drive an approved plan's browser-level (E2E) phases against the running app, one risk at a time — plan → generate → review → verify. The E2E sibling of /10x-implement and /10x-tdd, sharing the same plan and Progress. Only drives risks that genuinely need a browser and whose feature is already built; redirects the rest to /10x-tdd or /10x-implement. Use when the user says "e2e", "write/generate a Playwright test", "browser test this risk", or "drive the plan's E2E phases".
argument-hint: "<change-id> [phase N] | @context/changes/<change-id>/plan.md | <risk-id>"
---

# 10x E2E — Risk-Driven E2E Plan Execution

You drive an approved technical plan from `context/changes/<change-id>/plan.md` to **browser-level coverage**, one phase at a time, one risk at a time. An agent can generate a _passing_ E2E test in seconds; the hard part is making it **protect a real risk** and **survive tomorrow's refactor**. This skill drives only the phases where that work belongs — a risk that crosses several system boundaries (auth, routing, API, DB) or exists only in the rendered UI — and for each one runs the loop:

```
PLAN     →  pick the risk, explore the running app, map the flow (or fill the prompt template)
GENERATE →  turn the flow into a test from the seed exemplar + E2E rules
REVIEW   →  check it against the five agent E2E anti-patterns; re-prompt by name
VERIFY   →  run it green, then confirm it fails when the risk actually materializes
```

This skill is the **E2E sibling of `/10x-implement` and `/10x-tdd`**. It reads the same plan, mutates the same canonical `## Progress` section, and uses the same phase-end commit ritual and clipboard handoffs. The difference is the inner loop: instead of writing production code (`/10x-implement`) or a failing unit test first (`/10x-tdd`), you generate and harden a browser-level test against the **running app**. Because the three skills share `## Progress`, you can interleave them freely — build a feature with `/10x-implement`, unit-test the next phase with `/10x-tdd`, then come back here to add the E2E layer for a cross-boundary risk, and state is never lost.

Besides this plan-driven path, `/10x-e2e` also runs **standalone** against a single risk: `/10x-e2e <risk-id>` (or no argument, when `context/foundation/test-plan.md` exists: then it picks the top uncovered browser-level risk; see Setup step 1) and produces **one** reviewed, break-verified test, then stops — no change folder, no `## Progress`, no commit ritual. Use it for a quick one-off outside a tracked change. Everything below about **Setup**, **Phase completion**, and **State tracking** applies to the plan-driven path only; a standalone run resolves its risk (Setup step 1), confirms the E2E infrastructure and reads the levers (Setup steps 3–6), goes to the gate, loops PLAN→GENERATE→REVIEW→VERIFY once, and reports the test.

The core discipline: **don't generate E2E tests from scratch.** Start from the risk the phase names, and govern the agent's output with two quality levers — a **seed test** and **E2E rules**. The prompt supplies only what those two can't encode: the specific risk, flow, and real-vs-mocked boundaries.

```
context/foundation/test-plan.md  (the risks the plan's phases trace back to)
        │
        ▼
   seed.spec.ts  +  E2E rules  →  shape every generated test
        │                          (getByRole, isolation, wait-for-state, real vs mocked)
        ▼
   PLAN → GENERATE → REVIEW → VERIFY  →  one reviewed test per risk  →  CI
```

Agents see the **accessibility tree** (roles, names, states in a YAML snapshot with element refs), not pixels — so they naturally produce `getByRole`-based tests, not CSS selectors.

Plan path: `$ARGUMENTS`

## What this skill assumes — and what it will not do

- **It consumes the E2E infrastructure that `/10x-e2e-setup` creates.** A Playwright config (with `webServer`, a `setup` project and `storageState`), a green seed test, and the `## E2E` section of `context/foundation/test-stack.md` are assumed to be in place, and the app must be runnable. This skill **discovers** them; it does **not** install Playwright, scaffold configs, write the seed, or wire up CI. If any piece is missing, it redirects you to `/10x-e2e-setup` and stops. One narrow exception: mocking an external API the app calls **server-side** may need a mock-server `webServer` entry (the array form) and a hook that points the app entry at it (`references/mocking-external-apis.md`). The app entry itself (the one serving the base URL) and every field `test-stack.md` records stay `/10x-e2e-setup`'s, so leave them unchanged.
- **The feature under test already exists.** E2E runs against a real, running app — so unlike `/10x-tdd`, the implementation must be **present**, not absent. If the phase's feature isn't built yet, there is nothing for the browser to drive; stop and redirect to `/10x-implement` (or `/10x-tdd`) to build it first, then come back.
- **It uses the two quality levers; it does not create them.** The seed test is written once per project by `/10x-e2e-setup`; the E2E rules ship with this skill (`references/e2e-quality-rules.md`), not in your agent's rules file. This skill models every generated test on them and reviews against them, but never rewrites the seed. Small test helpers a spec needs (e.g. a hydration wait under `tests/e2e/`) are fine to add.
- **It drives one reviewed test per risk, not a sweep.** Unlike "generate tests for every page," this skill writes a small, risk-tied set and hardens each one through review and a deliberate-break check. E2E is the most expensive, most flake-prone layer — coverage count is never the goal; protected risk is.
- **It gates every phase on whether E2E actually fits and whether the app is ready.** Some phases (pure logic, config, scaffolding) should never get an E2E test. Features that aren't built can't be driven in a browser. Those cases are redirected or stopped as described below.

## Phase overview

```
SETUP            →  Resolve plan, read fully, confirm the /10x-e2e-setup infrastructure (redirect if missing) + app runnable, read seed + rules, start the progress checklist
For each phase:
  ├─ GATE        →  Is this risk browser-level, AND is the feature built, AND is the E2E test absent? If not → redirect or stop
  ├─ PLAN/GENERATE/REVIEW/VERIFY  →  Loop per risk in the phase until its success criteria are met
  └─ PHASE END   →  Relevant E2E green → manual gate → commit ritual → next-phase decision (clipboard)
After all phases →  Completion summary + optional /10x-impl-review
```

Each phase ends with a user checkpoint. Never silently skip a phase or merge two phases into one commit.

---

## Setup

> Standalone (risk-driven) runs skip the plan steps (2, 7, 8, 9): step 1 resolves the risk, then run steps 3–6 and go straight to the gate.

When this skill is invoked:

1. **Resolve the argument**:
   - `/10x-e2e <change-id> [phase N]` where `context/changes/<change-id>/` exists → `context/changes/<change-id>/plan.md`.
   - `@context/changes/<change-id>/plan.md` or a full path → accept as-is.
   - **Refuse if the resolved path starts with `context/archive/`** — print "This change is archived. Open a new change with `/10x-new` instead." and STOP.
   - An argument with **no** `context/changes/<arg>/` folder is a **risk-id** (as the test plan writes it, e.g. `#2`, or a slug) → standalone run. Resolve it in `context/foundation/test-plan.md` (its risk map). If there is no test plan, match it against the `seed` line of `test-stack.md` (`## E2E`); a match means the seed's risk, so look for an uncovered facet at the gate. If neither resolves it, ask the user for the risk and the observable outcome that proves it.
   - No argument and `test-plan.md` exists → standalone run on the top **uncovered browser-level** risk: the highest-priority risk that the test plan's risk-response table (cheapest layer) or E2E rollout phase routes to e2e, that isn't the seed's risk, and that has no spec yet. A risk the rollout phase lists is **not** browser-level when its own row steers away from e2e (both hold: the cheapest layer is unit/integration **and** the anti-pattern column warns against e2e; a silent anti-pattern column doesn't exclude it) — skip it. Name the chosen risk before the gate.
   - No argument and no `test-plan.md` → print the message below and **STOP and wait**:

```
I'll drive an approved plan's browser-level (E2E) phases — plan → generate → review → verify, one risk at a time. Please provide:

1. A change-id (e.g., `/10x-e2e save-session phase 6`),
2. A full path (e.g., `@context/changes/save-session/plan.md`), or
3. One browser-level risk and the observable outcome that proves it (a standalone run).

You can list active changes with: `ls context/changes/`

Tip: the plan should already be reviewed and approved — this skill executes its E2E phases, it doesn't write the plan.
```

2. **Read the plan completely** — every phase, every Changes Required block, every Success Criteria item. Never use limit/offset; you need full context. The `## Progress` section at the bottom is **authoritative for execution state** — checkmarks (`- [x]`) live ONLY there. Phase blocks carry plain `- ` bullets, no checkboxes. Note which phases trace back to a `context/foundation/test-plan.md` risk that needs browser-level coverage; those are the ones this skill drives.

3. **Read `context/foundation/test-plan.md`** if present — it carries the risk map each E2E phase protects (impact, likelihood, the behavior that would prove protection). The risk, not a file, is the unit of work here.

4. **Read `context/foundation/lessons.md`** if present and internalize each entry before starting any phase — these are the team's accepted recurring rules and must shape every test choice in this run.

5. **Confirm the E2E infrastructure from `/10x-e2e-setup` and that the app is runnable (light check — do not research the world):**
   - If `context/foundation/test-stack.md` exists, read its `## E2E` section — it records the runner and version, config path, single-spec and full-suite commands, base URL and port, web server command, auth setup project and `storageState` path, and seed path. Use it and skip the scan. The port the run actually uses is `E2E_PORT` from the env file when it is set. Mock-server entries in an array-form `webServer` are not recorded there; read them in the config. If it looks stale (references files or configs that no longer exist), note that to the user and fall back to a quick scan.
   - Otherwise do a **quick** scan: one file search for `playwright.config.*` / `*.spec.ts`, then read the config and one spec to learn the command to run a **single** spec, the auth setup (`storageState` / a `setup` project), and how the app starts (a `webServer` block, or a dev-server command).
   - **If there is no Playwright config or no seed test**, redirect and STOP. Never scaffold either yourself — `/10x-e2e-setup` owns both. Copy `/10x-e2e-setup` to the clipboard (per the clipboard convention below) and print:

```
This E2E run needs the Playwright infrastructure that /10x-e2e-setup creates — it's incomplete here:
- [missing: playwright.config.* | seed test]

Run the one-time setup first:
→ /10x-e2e-setup (✓ copied)

Then come back with:
→ /10x-e2e [the same arguments]

(Non-browser coverage doesn't need any of this — use /10x-tdd or /10x-implement.)
```

- **Setup output not committed yet?** If `git status` shows `/10x-e2e-setup`'s files uncommitted (the config, the seed, `test-stack.md`), offer to commit them now, before this run edits any of them (`chore: set up Playwright E2E`, staged by path; Recommended). Later the config carries this run's mock entry too, and splitting it needs partial staging.

6. **Read the two quality levers.** These do the heavy lifting — the prompt stays thin. This skill reads them and never rewrites them.
   - **Seed test** (`seed.spec.ts`, path from `test-stack.md` or the scan): the exemplar every generated test is modeled on. _What you show is what you get_ — if the seed uses `getByRole`, generated tests do too; if it has `waitForTimeout`, every generated test inherits it. `references/seed-test-pattern.md` explains the four patterns a good seed carries; see also `references/browser-driven-generation.md`.
   - **E2E rules**: read `references/e2e-quality-rules.md` — the rules every generated test follows, with the reasoning behind each. They live with this skill, not in your agent's rules file. If an older setup left an E2E rules block there, this reference wins where the two differ.

7. **Update `change.md`**: set `status: implementing` (only if currently in `{planned, plan_reviewed}`) and `updated: <today>`.

8. **Start a progress checklist in the conversation**: one line per `## Phase N:` you intend to drive (`- [ ] Phase N: [Phase Name]`). Mark the current phase as in progress before starting it, and tick it when its success criteria pass. The checklist is only a view for the user — `## Progress` in `plan.md` stays the source of truth.

9. **Find the starting point**: scan `## Progress` — the first `- [ ]` in document order is where you start. If a `phase N` argument was passed, jump to the first `- [ ]` under `### Phase N:`.

> **Clipboard convention.** Wherever this skill says _copy `X` to the clipboard_, pipe the exact string `X` to the platform clipboard — try `pbcopy` (macOS), then `clip.exe` (Windows/WSL), then `xclip -selection clipboard` (Linux), or `Set-Clipboard` in PowerShell, and fall back silently if none exist. Then display the copied command on its own line suffixed with `(✓ copied)`.

> **Asking the user — host-agnostic.** Wherever this skill says _ask the user_, use whichever interactive-question tool your agent exposes; don't hard-code one tool name. Before the first question, scan your available tools for one that asks the user a structured question (a `question` parameter plus an `options`/`choices` field) and use the first match. If there is none, ask in a plain conversational message listing the labelled options and wait for the reply — never block the procedure. The first time you ask, say which tool you used (or that you fell back to plain chat). The option blocks below give the question, the labels and their descriptions; map them onto your tool's schema without changing their meaning.

---

## The E2E eligibility gate — run before every phase (plan-driven) / once (standalone)

Before you plan a single test for a phase, decide three things in this order:

1. **Browser-level fit** — the phase's risk genuinely needs end-to-end coverage.
2. **Feature presence** — the feature under test is already built and the app is runnable.
3. **Test absence** — a passing E2E test for this risk doesn't already exist.

A phase is eligible for this skill only when all three hold.

### Browser-level fit check

A risk needs E2E when it **crosses several system boundaries** (auth, routing, API, DB) or **exists only in the rendered UI**. If an isolated function, endpoint contract, or integration test could prove the risk, E2E is the wrong (slow, brittle) tool — drive it with `/10x-tdd` or `/10x-implement` instead.

| E2E-worthy — drive it here                             | Not E2E-worthy — redirect to /10x-tdd or /10x-implement     |
| ------------------------------------------------------ | ----------------------------------------------------------- |
| Full user flows across auth → routing → API → DB       | Pure functions, parsers, validators, flag computation       |
| Data survives a real SSR page reload / navigation      | A single endpoint's status/shape/auth/gating contract       |
| State that only exists in the rendered, interactive UI | Business logic with clear inputs/outputs                    |
| Multi-step journeys a unit test can't reproduce        | Anything an isolated function or integration test can prove |
| Risks that only appear when real boundaries integrate  | Config, scaffolding, infra wiring, docs                     |

### Feature-presence check (the inverse of /10x-tdd)

E2E drives a **running app**, so the feature must already exist. Inspect the phase's `Changes Required` and do a focused search for the routes, pages, components, and endpoints the flow touches, and confirm the app actually starts.

If the feature under test is **not built yet**, STOP — there is nothing for the browser to drive. Print this block, filling in the concrete evidence:

```
Phase [N]'s E2E risk needs a running feature, but the feature isn't built yet.

E2E runs against the real app; the implementation has to exist before the browser can drive it. Here I found it missing:
- [route/page/component/endpoint evidence]

Build it first, then come back for the E2E layer:
→ /10x-implement <change-id> phase [N]
```

Copy `/10x-implement <change-id> phase [N]` to the clipboard, display it with `(✓ copied)`, and STOP.

### Test-absence check

Do a quick search for an existing spec covering this risk. If a **passing** E2E test for the risk already exists, don't regenerate it: run it green, and run any deliberate break a Progress row of this phase claims. Flip only the rows whose claim you just proved, with one line of evidence each (spec + result). A row whose claim is false — it names a spec that shouldn't exist, or a break the browser can't catch (e.g. a page-level guard duplicates the middleware check) — stays `[ ]`: say why and propose the plan fix to the user; never rewrite the plan or flip it to move on. Such a phase can't complete: it gets no commit, and you go on to the next-phase decision with the phase marked **blocked on the plan fix**; the completion summary lists it. A test that covers only **part** of the risk (typically the seed) doesn't disqualify it. If a **built** facet of the risk has no test, drive that facet, and name it in the test title and the provenance header, e.g. `// risk: auth-gate-roundtrip — facet: a signed-in session reaches /dashboard; the signed-out redirect is covered by seed.spec.ts`. If only unbuilt facets are left, this is the feature-presence redirect above. If a test exists but is **failing**, that's a debugging job, not a generation job — point the user at the failing-test-to-root-cause debugging workflow rather than letting an auto-fix tool silently rewrite the assertion. (See the auto-heal boundary under E2E guidelines.)

### How to apply the gate

- If all three hold, state that in one line and proceed to the plan → generate → review → verify loop.
- If the risk is **clearly not browser-level**, run the **redirect** (below).
- If it's **mixed** but the non-browser facet **already has a test** (unit/integration), name that facet and its test in one line and proceed with the browser-level part — no question.
- If it's **mixed or ambiguous** (e.g., a phase that's partly an endpoint contract, partly a rendered-UI flow), ask the user:

  - question: "Phase [N] mixes an isolated-function risk and a browser-level flow. How should I drive it?"
    header: "E2E gate"
    options:
    - label: "E2E the browser-level part (Recommended)"
      description: "I'll plan→generate→review→verify the cross-boundary flow and redirect the isolated-function part to /10x-tdd."
    - label: "Redirect whole phase to /10x-tdd"
      description: "Hand the entire phase off — copy the resume command to the clipboard."
    - label: "E2E the whole phase anyway"
      description: "Force browser-level coverage even for the parts a unit test would prove. Slower, more brittle."
      multiSelect: false

### Redirect a non-E2E phase

State _why_ the phase isn't a browser-level fit (one or two sentences, grounded in the table above), then ask the user:

- question: "Phase [N] isn't a good E2E fit. How do you want to handle it?"
  header: "Not E2E-worthy"
  options:
  - label: "Hand off to /10x-tdd"
    description: "Copy `/10x-tdd <change-id> phase N` to the clipboard. Start a fresh session, run it, then resume E2E on the next phase."
  - label: "Hand off to /10x-implement"
    description: "Copy `/10x-implement <change-id> phase N` to the clipboard if test-first doesn't fit either."

  Mark as **(Recommended)** `/10x-tdd` when the phase adds testable logic, and `/10x-implement` when it is docs, config or scaffolding.
  - label: "E2E inline here anyway"
    description: "I'll generate a browser-level test despite the cost — then continue to the next phase's gate."
  - label: "Skip — already done"
    description: "Mark the phase's Progress rows and move to the next phase."
    multiSelect: false

**On "Hand off":** copy the chosen resume command to the clipboard, print the block below, and STOP — the other skill will flip this phase's Progress rows and run its own commit ritual. Tell the user to resume E2E afterward.

```
Phase [N] isn't browser-level material — [one-line reason].

→ /10x-<tdd|implement> <change-id> phase [N] (✓ copied)

Start a fresh session, run that, then come back with:
→ /10x-e2e <change-id> phase [next E2E phase]
```

Print the chosen skill, not always `/10x-tdd`. Print the last two lines ("Start a fresh session…" and the `/10x-e2e` command) only when a later phase is left; when this was the last phase, end with the completion summary instead.

**On "Skip":** flip the phase's `#### Automated` rows `[ ]` → `[x]` (no SHA, since nothing was committed) — only rows whose claim holds (see the covered-risk rule above). `#### Manual` rows stay for the user. Then move to the next phase. The Progress edit has no commit of its own: `plan.md` is always in the touched set, so it rides with the next phase's commit; if no later phase commits, offer a `chore(<change-id>): progress` commit of `plan.md` alone at the end.

---

## The Plan → Generate → Review → Verify cycle

Inside an eligible phase, work risk by risk. Each `#### Automated` step in the phase's Progress (or each distinct browser-level risk in its Changes Required) is one trip around the loop. Keep the loop tight — one risk, one reviewed test, verified before you move on.

### Test budget per phase

E2E is expensive and flake-prone, so the budget is **tight** — typically **one test per risk**, and rarely more than **1–3 per phase**. Pick the flow that proves the risk and would catch a real regression. You're protecting a named risk, not chasing coverage. Don't generate a test per page or per button.

### PLAN — pick the risk and map the flow

1. State the contract in one sentence: **input** = one browser-level risk; **output** = a reviewed E2E test that _fails when that risk materializes_. If the phase's risk isn't concrete, pull the observable business outcome from `test-plan.md` or the phase's Success Criteria before planning. In a standalone run whose risk or observable outcome Setup step 1 didn't resolve, ask the user for them first.
2. Choose a path — same contract either way:
   - **Browser-driven** (default): the app must be running first. Run the build, then start the preview on the port the config resolves (`E2E_PORT` from the env file, else the `test-stack.md` port) **in the background**, the same commands as the app `webServer` entry. If the flow calls an external API you mock, start the mock and point the build at it first (`references/mocking-external-apis.md`, steps 4–5), or exploring spends real money. Stop everything before VERIFY (step 8). Then explore the running app yourself with `playwright-cli` from the shell (`open`, `snapshot`, `click <ref>`, `fill`, `press`; snapshots are YAML files on disk that you read back), then plan and generate the spec from what you saw. If your tool has no shell but has a Playwright MCP server, the same steps apply through its browser tools. Explore the **accessibility snapshot** (not screenshots) and map the flow for this risk — happy path plus the edge/error case the risk implies. Model the plan on `seed.spec.ts` — **seed quality is test quality.** See `references/browser-driven-generation.md` for the commands and the full discipline (set up the page first, snapshot over screenshots, scenarios independent and any-order).
   - **Prompt-template** (no live browser, simplest): fill `references/e2e-prompt-template.md` with the risk, research anchor, business scenario, and real-vs-mocked boundaries, and write the spec from your reading of the app. Leave the template file untouched; write a _new_ prompt file for this specific risk. Use this when neither the CLI nor MCP is available, or the flow is simple and well-understood.
3. Separate **real** from **mocked** boundaries up front. **E2E ≠ zero mocking.** Internal boundaries (auth, routing, DB) stay real — that's where integration risk hides. Mock expensive or non-deterministic external APIs at the network layer. For an API the app calls **server-side**, browser-level `page.route()` won't intercept it. Use a local mock server instead, following `references/mocking-external-apis.md`; that needs a production change the user must approve.

### GENERATE — produce the test from the levers

4. Generate the test following the conventions the seed and rules already encode — don't restate them in the prompt. On the browser-driven path, **execute each step live** and write the spec from what the run actually exposed (resilient locators, real waits), not from guesses. In principle the output must use **role-based locators**, be **independently runnable** (own setup/action/assertion/cleanup), **wait for state** not time, **authenticate without the UI**, use **unique test data**, and carry a name that **binds it to the risk** (not `test('test 1', ...)`). The rules file (`references/e2e-quality-rules.md`) holds the per-tool syntax.
5. **One test per file**, placed per the project convention (default: the project-level e2e dir, e.g. `tests/e2e/<feature>.spec.ts`). The file name is the fs-friendly scenario name; the `describe` matches the top-level plan/risk item; put each plan step's text as a comment before the actions that implement it, and keep a provenance header linking the spec to its risk and seed.

### REVIEW — five anti-patterns, re-prompt by name

6. Never trust a generated E2E test on sight. Review it against the five agent E2E anti-patterns in `references/e2e-anti-patterns.md`: Naive assertion, Brittle selector, Shared state, Hardcoded wait, No cleanup. "No cleanup" includes a cleanup that exists but can fail silently: every cleanup call must assert its result, and API calls from `page.request` must pass the app's origin/CSRF check (see the anti-pattern).
7. For any anti-pattern found, **re-prompt by name** — never "fix this test." Name the specific anti-pattern, explain _why_ it doesn't protect the risk (or why it produces false failures), and give the **target pattern**. Three elements per re-prompt: what's wrong, why it doesn't protect the risk, what replaces it. See the re-prompt discipline in `references/e2e-anti-patterns.md`.

### VERIFY — green, then risk-tied

8. **Stop your servers, then run just this spec.** Stop any server you started for exploration, and any preview daemon it left behind. Confirm the port is free (`lsof -nP -iTCP:<port> -sTCP:LISTEN` or `netstat -ano | findstr :<port>` prints nothing), so the config's `webServer` builds and starts the current code. With `reuseExistingServer`, a server still running is silently reused: its build predates your deliberate break, so the break never reaches the app and the test stays **falsely green**. Run the spec with the project's single-spec invocation, and confirm it passes. Show the user the green result briefly.
9. **Control question:** _would this test fail if the `test-plan.md` risk came true?_ If not, the assertion is decorative — go back to GENERATE/REVIEW. To make this concrete, do a **deliberate break**: temporarily invert or weaken the production behavior the risk targets (or the test's key assertion's target), re-run with the port still free (so `webServer` rebuilds with the break), and confirm the test goes red on the risk's assertion (a red from a timeout, a login or a hydration race proves nothing — re-run). Prefer a break that leaves the path the cleanup drives intact; either way, the residue check below runs after this red run too. If it stays green after you break the thing it's supposed to protect, the assertion protects nothing — fix it before moving on. **Revert the deliberate break immediately**; never commit it.
   Then check the cleanup the same way — after the green run **and** after the deliberate-break run (a red run often stops mid-flow and leaves intermediate records, e.g. drafts of an unsaved session): look up the test's own data in every table the flow writes (sign-in sessions the setup project creates on every run are expected, not residue) (the same lookup the cleanup uses, the app's UI, or the database) and confirm **nothing is left**. Unique identifiers hide a broken cleanup — the next run doesn't collide, the data just accumulates. If anything remains, the cleanup is broken: fix it (REVIEW, "No cleanup") and re-run. To find the data, the test needs a findable token: record it on the test (`test.info().annotations.push({ type: 'test-data', description: token })` shows it in the report) rather than hunting server logs.
10. **Mark the step done.** Flip exactly that step's row in `## Progress`: `- [ ] N.M <title>` → `- [x] N.M <title>` (no SHA yet — the SHA lands at phase end). Then loop back to PLAN for the next risk.

Never use `test.skip()` / `test.fixme()` to "pass" a phase — a skipped test is invisible. A test that can't be made to pass against the real app is a signal to investigate (the feature, the flow, or the flake), not to silence.

Repeat PLAN→GENERATE→REVIEW→VERIFY until every `#### Automated` step in the phase is `[x]` and the phase's success criteria hold.

In a **standalone** run there's no phase and no `## Progress`: after VERIFY confirms green plus the deliberate break, run the project's lint/format on every file you touched (mock servers and helpers trip rules the specs don't), then **stop** — report the spec file and the risk it protects, list every file changed outside the test directory (production changes, config) for the user to review, and offer a commit (`test: <risk> e2e`, staged by path) without making it unasked. Skip the phase-completion ritual below.

---

## Phase completion (plan-driven only)

When all `#### Automated` rows in `### Phase N:` are `[x]`, run the phase-end ritual (this mirrors `/10x-implement` and `/10x-tdd` — one Conventional-Commits commit per phase, then write its short SHA back into the rows that flipped).

> **Hard invariant — commit only on green.** Never propose, stage, or author a commit while any test in scope is red, skipped to fake a pass, or while a deliberate break is still in the tree. A commit is offered **only after the new E2E test(s) pass against the running app** and any deliberate-break edits are reverted. The red of a deliberate break is a transient checkpoint you show the user, never a commit boundary.

Maintain a **touched-file set** throughout the phase: every file you create or edit (specs and the prompt file) goes in it, plus `context/changes/<change-id>/plan.md` (always — you edit its Progress). On the **first phase** of a change, also seed it with any untracked/modified files inside `context/changes/<change-id>/` (`change.md`, `research.md`, etc.). The set **resets at each phase boundary**.

1. **Run the phase's E2E spec(s)** against the running app and confirm green. (A _full_ E2E pass runs in CI, not per-edit — locally you confirm the spec(s) this phase added. Fix any breakage before committing.) Run the project's lint/format on the touched files too — a mock server or helper often trips rules the specs don't (Node globals in `.mjs`), and a pre-commit hook would reject the commit.

2. **Manual confirmation gate.** Tell the human automated verification passed, list the plan's manual verification items for this phase (including the deliberate-break check you ran), and pause. Do not proceed until they confirm.

```
Phase [N] Complete (E2E) — Ready for Manual Verification

Automated verification passed:
- [E2E specs now green: list them]
- [deliberate-break check: which behavior you inverted and confirmed the test caught]

Please perform the manual verification steps from the plan:
- [manual items for this phase]

Let me know when manual testing is complete so I can commit.
```

On the **final phase**, also roll up any still-pending `#### Manual` rows from earlier phases (informational; the gate still only pauses, it doesn't hard-block).

3. **Detect unrelated dirty paths.** Run `git status --porcelain`; intersect with paths **outside** the touched set. If any exist, present them and ask the user whether to commit only the planned set (Recommended), stage all, or abort. If none, skip.

4. **Stage explicitly by path** — `git add` each file in the touched set by name. Never `git add -A` / `git add .`.

5. **Empty diff check.** `git diff --cached --quiet`; if exit 0, print that the phase had no diff (rows stay SHA-less), set `SHA=""`, and skip to step 8.

6. **Propose a Conventional-Commits message** and ask the user to approve it (approve as proposed (Recommended) / edit subject / override). Subject: `test(<change-id>): <phase title> (p<N>)`. Keep the subject within 72 characters — shorten the phase title if needed. Mention the E2E/browser-level nature and the risk protected in the body. Include a `Refs:` line if the conversation contains real Jira/Linear/GitHub references (never invent them from the change-id or branch).

7. **Commit** via a single `git commit` with a heredoc body, per the global commit-message protocol: the approved subject line, then a short body listing the specs added + the risk each protects (and the `Refs:` line when applicable). Never pass `--no-verify` / `--amend` / signing-bypass flags. If a pre-commit hook fails, fix the cause and make a NEW commit.

8. **Capture and write back the SHA.** `git rev-parse --short HEAD` → `SHA`. For every Progress row flipped this phase, Edit `- [x] N.M <title>` → `- [x] N.M <title> — <SHA>` (skip rows that already carry a SHA; if `SHA=""`, skip — `/10x-archive` surfaces SHA-less rows as informational warnings).

9. **Update `change.md`**: `updated: <today>`; keep `status: implementing` until the final phase.

10. **Reset the touched-file set** before the next phase.

### Next-phase decision

Ask the user:

- question: "Phase [N] [complete | blocked on a plan fix] (E2E). How to proceed?"
  header: "Next phase"
  options:
  - label: "Continue to Phase [N+1] (Recommended)"
    description: "Stay in this context; run the E2E gate for the next phase and proceed."
  - label: "Start a fresh session first"
    description: "Copy the resume command to the clipboard. Start a fresh session for Phase [N+1]."
  - label: "Review this phase first"
    description: "Run /10x-impl-review to verify the implementation against the plan before continuing."
    multiSelect: false

**Continue:** read the next phase, mark it in progress in the checklist, run the E2E gate, proceed. No need to re-read the whole plan.

**Review:** run `/10x-impl-review @<path-to-plan> phase [N]`, then re-present the continue/fresh-session decision (without the review option).

When Phase [N] was the last phase, skip this question and go to the completion summary. If rows are still open (a phase blocked on a plan fix, a phase handed off), print the partial summary below instead of the celebration.

**Fresh session:** copy `/10x-e2e <change-id> phase [N+1]` to the clipboard (per the clipboard convention) and display it as `→ /10x-e2e <change-id> phase [N+1] (✓ copied)`.

If told to run multiple phases consecutively, skip this question between phases. Flip a **manual** row (and give it the phase's SHA) only after the user confirms that item; otherwise leave it for them.

---

## State tracking (plan-driven only)

**The `## Progress` section in `plan.md` is the single source of truth** — no state file, no comment markers. This skill mutates Progress exactly like `/10x-implement` and `/10x-tdd`: flip `[ ]` → `[x]` per step as it lands; append the closing commit's SHA to every row that flipped, in one shot at phase end. Mid-phase, completed rows sit `[x]` without a SHA — a valid intermediate state. Because all three skills write the same section identically, a change can be driven by any of them, in any order.

**"Where am I?" is derived, not stored:** the first `- [ ]` line is the next step; its enclosing `### Phase N:` is the current phase; completion is `count([x]) / count([ ] + [x])`.

---

## After all phases (plan-driven only)

When every `- [ ]` in the entire `## Progress` section is `[x]`:

1. **Defensive straggler scan.** Re-scan for any remaining `- [ ]`. Under normal flow there are none. If any exist (a manual edit or a bypassed trigger left them), list them grouped by Automated/Manual and ask the user whether to **Pause** (STOP, don't touch `change.md`) or **Proceed to epilogue**.

2. **Update `change.md`**: `status: implemented`, `updated: <today>`. (Do NOT set `archived_at` — that's `/10x-archive`.)

3. **Epilogue commit.** The final phase's SHA write-back and the `change.md` status flip sit dirty after the final ritual. Stage exactly `plan.md` + `change.md` (explicit paths), check `git diff --cached --quiet` (skip if empty), propose `chore(<change-id>): close out plan (epilogue)`, approve, and commit via heredoc. Do NOT write the epilogue's own SHA back.

4. **Completion summary + optional review:**

```
All E2E phases done! 🎉

Summary:
- Phases completed: [N]  ([k] E2E'd, [j] redirected to /10x-tdd or /10x-implement)
- E2E tests added: [count] across [files], each tied to a test-plan.md risk
- Levers in place: seed.spec.ts + E2E rules
```

Then ask the user: run `/10x-impl-review <change-id>` (full-plan review) or skip.

**Partial summary** — when the last phase is reached but rows are still open, skip steps 1–3 (`change.md` stays `implementing`, no epilogue) and print:

```
E2E pass over <change-id> finished — [k] of [N] phases complete (handed-off and blocked phases don't count).

- E2E'd: phase [a], [b] ([count] test(s))
- Handed off: phase [c] → /10x-<tdd|implement> (✓ copied)
- Blocked on a plan fix: phase [d] — [one line: the proposed fix]
```

Uncommitted `plan.md` edits (SHA write-back, flipped rows) would otherwise wait for the handed-off phase's commit, which may never come: offer a `chore(<change-id>): progress` commit of `plan.md` alone (Recommended), or leave them for that commit.

---

## E2E guidelines

Principles that govern every test here — the references carry the syntax and the full reasoning:

- **Observable user outcome** across real boundaries, not an internal call — and it **fails when its risk materializes**, confirmed by the deliberate-break check, not assumed.
- **Role-based locators**, **self-contained and isolated** (own setup/action/assertion/cleanup, unique data, auth without the UI, safe under parallel random-order runs), and **waits for state, never time**. The five ways agents violate this are in `references/e2e-anti-patterns.md`.
- **Protect the named risk, not the surface area** — no test-per-page/button, no over-mocking the internal boundaries (mock auth + DB and the test checks nothing that can break in integration), no pixel assertions for functional risks (use deterministic visual tools for those).

**Real vs mocked** is the test's core value: internal boundaries (auth, routing, DB) stay real — that's where integration risk hides; mock only expensive or non-deterministic external APIs at the network layer.

**Vision** (screenshots) is a supplement for visual-only risks (layout, z-index, animation, canvas), not the default — DOM snapshots verify function. **Auto-healing tools** help on selector/timing drift (route their output through PR review, never auto-commit) but must never "fix" a _changed business behavior_ — that masks the regression the test exists to catch. Both are detailed in `references/browser-driven-generation.md`; a failing E2E test is a debugging job, not a generation or healing job.

### File placement

Follow the convention discovered in Setup. Default if none exists: project-level e2e dir, `tests/e2e/<feature>.spec.ts`, one test per file.

### If you get stuck

Use sub-agents sparingly: for a fast file/pattern search or a multi-step analysis of unfamiliar territory, delegate to a sub-agent if your tool has one, otherwise do it inline. First make sure you've read the relevant code and the running app's actual accessibility tree; the codebase may have evolved since the plan was written.

## Other stacks

The seed, rules, and prompt-template ship tuned for Playwright, and the browser-driven path assumes `playwright-cli` (or, without a shell, a Playwright MCP server). On Cypress, WebdriverIO, or Selenium, encode your tool's idioms (its `getByRole` equivalent, its wait-for-state mechanism, its data isolation) into your own variant of these levers and drive its own runner. The principles transfer; the syntax doesn't. The mapping table in `references/e2e-quality-rules.md` (Other stacks) gives the Cypress and WebdriverIO / Selenium idiom for each principle.

## References

- `references/e2e-quality-rules.md` — the E2E rules + the governing rules + the non-Playwright mapping.
- `references/e2e-anti-patterns.md` — the five anti-patterns + re-prompt discipline.
- `references/seed-test-pattern.md` — the `seed.spec.ts` exemplar + the four patterns (the seed itself is written by `/10x-e2e-setup`).
- `references/e2e-prompt-template.md` — the paste-ready generation prompt + worked example.
- `references/mocking-external-apis.md` — mocking an external API the app calls server-side: an env-overridable base URL, a local mock server as an extra `webServer` entry, stack notes.
- `references/browser-driven-generation.md` — exploring the app with `playwright-cli` to plan and generate one spec per risk (accessibility-tree workflow, snapshot over screenshots, one test per file, write-from-real-execution, the auto-heal boundary).
