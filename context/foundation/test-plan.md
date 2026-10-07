# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-10-07

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the
   team is worried about X, and the failure would surface somewhere in
   <area>" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Expected values in any test come from an independent oracle — the PRD
formula and guardrails, hand-computed examples, or the interview — never
from the implementation under test.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/`, `scripts/`
(32 commits in the 30 days to 2026-10-07; excludes `.claude/`, `context/`,
lockfiles, build output).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                                                                    | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | An employee sees another employee's bonus, or any Draft milestone result — via a page, an API call, an ID changed in the URL, or the upcoming history view                                                 | High   | High       | PRD Guardrails, NFR (visibility), FR-018; interview Q1; roadmap S-06 (next slice reads results); hot-spot dir `supabase/migrations/` (12 changes/30d)                                                  |
| 2   | A new or replaced RLS policy lets the wrong role through — a Supervisor reads or modifies another Supervisor's projects, milestones, employees, or engagement                                              | High   | High       | interview Q3; archive S-02, S-03 (each needed follow-up guard migrations); hot-spot dirs `supabase/migrations/`, `supabase/tests/` (12 changes/30d each)                                               |
| 3   | A milestone pays out more than its payout pool, the payout pool exceeds the target pool, or the KPI multiplier cancels out in the split — including out-of-range inputs that bypass client-side validation | High   | High       | interview Q2 (pool exceeded target before the S-04 correction); PRD Business Logic, US-01 acceptance criteria; archive S-04 (correction 2026-10-04); hot-spot dir `src/lib/services/` (18 changes/30d) |
| 4   | An Admin changes role weights, KPI weights, or the rating→factor mapping and an already Approved milestone's figures change                                                                                | High   | Medium     | interview Q4; PRD FR-001, FR-002, FR-003 (prospective-only resolutions)                                                                                                                                |
| 5   | An approval email reaches the wrong person, is sent for a Draft milestone, or is sent repeatedly (incl. re-send flooding); or approval reports success while the notification is silently lost             | High   | Medium     | PRD FR-016, FR-018; archive S-05 (impl-review fixes, re-send path added)                                                                                                                               |
| 6   | A newly added page or API route escapes role gating — an unauthenticated user or the wrong role reaches it, or the sign-in return target becomes an open redirect                                          | Medium | High       | CLAUDE.md auth flow (prefix-based route lists); hot-spot dir `src/pages/api/` (35 changes/30d); middleware churn (8 changes/30d)                                                                       |
| 7   | Supervisor flags silently under-report — the project worst-case budget check or the >100% time-share flag misses a real breach                                                                             | Medium | Medium     | PRD FR-011, FR-017; roadmap S-02 (reserve rule corrected 2026-10-04)                                                                                                                                   |

Abuse rows: #1 (IDOR), #2 (cross-tenant authorization), #3 (untrusted
input / server-side validation parity), #5 (side-effect flooding), #6
(open redirect). Response-time NFR (2 s results view) is left to
observability, not a test, at the PRD's small target scale.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                                                                                     | Must challenge                                              | Context `/10x-research` must ground                                                                                                                       | Likely cheapest layer                                                 | Anti-pattern to avoid                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| #1   | Employee B, signed in, gets zero rows / 403 / 404 for Employee A's lines and for any Draft milestone's lines, on every read path employees can reach                                                                                                            | "The page filters by the current user, so the data is safe" | Every read surface employees can hit (tables, views, approval snapshot, history reads); which views are `security_invoker`; the Draft→Approved transition | pgTAP as the employee role (exists in CI) + one HTTP-level IDOR check | Testing the page output instead of querying the database as the employee; testing only the own-row happy path |
| #2   | A role × table × operation matrix where every cell outside the role's scope fails, including a second Supervisor as the attacker                                                                                                                                | "Existing RLS tests pass, so the new policy is safe"        | Full policy inventory per table and operation; tables or operations with no test today; ownership-transfer guards                                         | pgTAP matrix                                                          | Asserting only the operations the policy author intended to allow                                             |
| #3   | Σ bonuses ≤ payout pool ≤ target pool for boundary cases (min/max multiplier, single employee, equal weights, grosz rounding, large pools); different KPI scores with identical engagement yield different totals; out-of-range inputs are rejected server-side | "Rounding down makes it safe by construction"               | Where the computation runs (TS vs SQL) and where inputs are validated server-side vs only in the form                                                     | unit (Vitest) or pgTAP, wherever the computation lives                | Expected values copied from the implementation (oracle problem) — derive them by hand from the PRD formula    |
| #4   | Approve, then edit role weights / KPI weights / factor mapping, then the Approved milestone's figures and the employee's view are unchanged, while Draft milestones reflect the new config                                                                      | "It is frozen because nothing recomputes it"                | What approval persists as a snapshot; whether any read path recomputes from live config                                                                   | pgTAP or integration                                                  | Asserting only that the config edit succeeded                                                                 |
| #5   | Only Approved milestones notify; each recipient receives only their own amount; a repeated send is a no-op; a delivery failure is visible, not reported as success                                                                                              | "A 200 from the function means the right mail went out"     | The notification claim / `notified_at` semantics, caller authorization, re-send path, failure surfacing                                                   | integration against local Mailpit                                     | Mocking the mailer so heavily that recipient↔amount pairing is never checked                                  |
| #6   | A role × route matrix (anonymous, employee, supervisor, admin) yields the expected redirect / 403 / 503; `next` rejects off-site targets                                                                                                                        | "The route sits under a protected prefix, so it is covered" | Route-list matching semantics; `next` validation; behaviour when the profile lookup fails                                                                 | unit/integration on the gating logic + smoke extension                | Enumerating only today's routes with no rule that catches a new unlisted one                                  |
| #7   | Flags trip exactly at the boundary (100 % time share, budget equality) across mixes of Approved and non-Approved milestones                                                                                                                                     | "An informational flag can't hurt anyone"                   | How worst-case exposure is aggregated; the definition of an "active" milestone                                                                            | unit or pgTAP                                                         | Testing only the comfortably-under-limit case                                                                 |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                           | Goal (one line)                                                                                                                                   | Risks covered | Test types                         | Status        | Change folder      |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------- | ------------- | ------------------ |
| 1   | Data isolation & RLS matrix          | Prove no employee or foreign Supervisor can read or write outside their scope, Draft results included                                             | #1, #2        | pgTAP matrix + one HTTP IDOR check | change opened | testing-rls-matrix |
| 2   | Payout correctness & approval freeze | Prove the PRD formula's ceilings, boundary cases and the approval freeze against hand-computed oracles; bootstrap Vitest if the logic lives in TS | #3, #4, #7    | unit + pgTAP                       | not started   | —                  |
| 3   | Route gating & approval notification | Prove the role × route matrix and once-only, own-figure-only approval email                                                                       | #5, #6        | integration + smoke extension      | not started   | —                  |
| 4   | US-01 e2e & gates wiring             | One e2e for approve → employee sees only their own result; make the new suites required CI gates; recommended local post-edit hook on migrations  | cross-cutting | e2e + gates + post-edit hook       | not started   | —                  |

## 4. Stack

| Layer                   | Tool                                                                               | Version                | Notes                                                             |
| ----------------------- | ---------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------- |
| database / RLS          | pgTAP via `supabase test db`                                                       | Supabase CLI ^2.23     | Exists — 6 test files, runs in CI `smoke` job                     |
| unit + integration (TS) | Vitest via Astro `getViteConfig()`                                                 | none yet — see Phase 2 | Astro's documented path (Context7, checked: 2026-10-07)           |
| auth smoke              | `scripts/smoke.mjs` (`npm run smoke`)                                              | n/a                    | Exists; extended in Phase 3                                       |
| email                   | Mailpit (local Supabase inbox)                                                     | bundled                | Integration target for Phase 3                                    |
| e2e                     | Playwright                                                                         | none yet — see Phase 4 | One critical flow only (US-01)                                    |
| (optional) AI-native    | post-edit hook running `supabase test db` on migration edits — checked: 2026-10-07 | n/a                    | When NOT to use: edits outside `supabase/`; never a CI substitute |

Test base profile: `sparse` — pgTAP configured with 6 files clustered in
the database layer; no TS test runner and zero TS tests.

**Stack grounding tools (current session):**

- Docs: Context7 — Astro testing guide (Vitest `getViteConfig()`, Playwright); checked: 2026-10-07
- Search: Exa.ai — available, not needed (official docs sufficed); checked: 2026-10-07
- Runtime/browser: no Playwright MCP in session; Claude-in-Chrome available — not used; checked: 2026-10-07
- Provider/platform: Cloudflare MCP available — not used; no Supabase MCP in current session; checked: 2026-10-07

## 5. Quality Gates

| Gate                                     | Where                         | Required?                                          | Catches                                    |
| ---------------------------------------- | ----------------------------- | -------------------------------------------------- | ------------------------------------------ |
| lint + `lint:ui` + `astro check` + build | local (pre-commit) + CI       | required (wired)                                   | syntactic / type / token drift             |
| pgTAP (`supabase test db`)               | CI `smoke` job                | required (wired); matrix required after §3 Phase 1 | RLS and payout regressions in the database |
| Vitest unit + integration                | local + CI                    | required after §3 Phase 2                          | formula, freeze, gating logic regressions  |
| auth smoke                               | CI against production preview | required (wired); extended after §3 Phase 3        | broken sign-in / role routing              |
| e2e on US-01                             | CI on PR                      | required after §3 Phase 4                          | broken approve → employee-view path        |
| post-edit hook (migrations → pgTAP)      | local (agent loop)            | recommended after §3 Phase 4                       | RLS regressions at edit time               |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase <N>."

### 6.1 Adding an RLS / data-isolation test (new table, view, or policy)

- TBD — see §3 Phase 1 (role × table × operation matrix pattern, employee-as-attacker and foreign-Supervisor cases).

### 6.2 Adding a payout / formula test

- TBD — see §3 Phase 2 (hand-computed oracle from the PRD formula, boundary cases, approval-freeze pattern).

### 6.3 Adding a test for a new page or API route

- TBD — see §3 Phase 3 (role × route matrix pattern; rule for catching unlisted routes).

### 6.4 Adding a test for an Edge Function side effect (email)

- TBD — see §3 Phase 3 (Mailpit-backed recipient ↔ amount and once-only pattern).

### 6.5 Adding an e2e test

- TBD — see §3 Phase 4 (only for flows that cross auth cookie + RLS + page; US-01 is the reference).

### 6.6 Per-rollout-phase notes

(Appended by each phase's final sub-phase.)

## 7. What We Deliberately Don't Test

- **UI look and feel** — no visual diffs, snapshots, or multimodal visual review. `npm run lint:ui` and the `/dev/projects-kitchen-sink` page remain the guard for tokens and component states. Re-evaluate if the app gains external users whose trust depends on presentation. (Source: Phase 2 interview Q5.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-10-07
- Stack versions last verified: 2026-10-07
- AI-native tool references last verified: 2026-10-07

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
