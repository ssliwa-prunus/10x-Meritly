# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-10-09

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

| Risk | What would prove protection                                                                                                                                                                                                                                     | Must challenge                                              | Context `/10x-research` must ground                                                                                                                       | Likely cheapest layer                                                               | Anti-pattern to avoid                                                                                                                                                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1   | Employee B, signed in, gets zero rows (database) — or 403 / a "not found" page with HTTP 200 (app) — for Employee A's lines and for any Draft milestone's lines, on every read path employees can reach                                                         | "The page filters by the current user, so the data is safe" | Every read surface employees can hit (tables, views, approval snapshot, history reads); which views are `security_invoker`; the Draft→Approved transition | pgTAP as a linked, activated employee (exists in CI); HTTP checks belong to Phase 3 | Testing the page output instead of querying the database as the employee; testing only the own-row happy path; using an employee-role user with no linked employee record as the attacker (it sees nothing for the wrong reason) |
| #2   | A role × table × operation matrix where every cell outside the role's scope fails, including a second Supervisor as the attacker; a catalog guard fails when a table, policy, grant or definer function appears that nobody classified                          | "Existing RLS tests pass, so the new policy is safe"        | Full policy inventory per table and operation; tables or operations with no test today; ownership-transfer guards                                         | pgTAP matrix + pgTAP catalog guard                                                  | Asserting only the operations the policy author intended to allow                                                                                                                                                                |
| #3   | Σ bonuses ≤ payout pool ≤ target pool for boundary cases (min/max multiplier, single employee, equal weights, grosz rounding, large pools); different KPI scores with identical engagement yield different totals; out-of-range inputs are rejected server-side | "Rounding down makes it safe by construction"               | Where the computation runs (TS vs SQL) and where inputs are validated server-side vs only in the form                                                     | unit (Vitest) or pgTAP, wherever the computation lives                              | Expected values copied from the implementation (oracle problem) — derive them by hand from the PRD formula                                                                                                                       |
| #4   | Approve, then edit role weights / KPI weights / factor mapping, then the Approved milestone's figures and the employee's view are unchanged, while Draft milestones reflect the new config                                                                      | "It is frozen because nothing recomputes it"                | What approval persists as a snapshot; whether any read path recomputes from live config                                                                   | pgTAP or integration                                                                | Asserting only that the config edit succeeded                                                                                                                                                                                    |
| #5   | Only Approved milestones notify; each recipient receives only their own amount; a repeated send is a no-op; a delivery failure is visible, not reported as success                                                                                              | "A 200 from the function means the right mail went out"     | The notification claim / `notified_at` semantics, caller authorization, re-send path, failure surfacing                                                   | integration against local Mailpit                                                   | Mocking the mailer so heavily that recipient↔amount pairing is never checked                                                                                                                                                     |
| #6   | A role × route matrix (anonymous, employee, supervisor, admin) yields the expected redirect / 403 / 503; `next` rejects off-site targets                                                                                                                        | "The route sits under a protected prefix, so it is covered" | Route-list matching semantics; `next` validation; behaviour when the profile lookup fails                                                                 | unit/integration on the gating logic + smoke extension                              | Enumerating only today's routes with no rule that catches a new unlisted one                                                                                                                                                     |
| #7   | Flags trip exactly at the boundary (100 % time share, budget equality) across mixes of Approved and non-Approved milestones                                                                                                                                     | "An informational flag can't hurt anyone"                   | How worst-case exposure is aggregated; the definition of an "active" milestone                                                                            | unit or pgTAP                                                                       | Testing only the comfortably-under-limit case                                                                                                                                                                                    |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                           | Goal (one line)                                                                                                                                  | Risks covered | Test types                                                                              | Status        | Change folder              |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | --------------------------------------------------------------------------------------- | ------------- | -------------------------- |
| 1   | Data isolation & RLS matrix          | Prove no employee or foreign Supervisor can read or write outside their scope, Draft results included                                            | #1, #2        | pgTAP matrix + catalog guard                                                            | complete      | testing-rls-matrix         |
| 2   | Payout correctness & approval freeze | Prove the PRD formula's ceilings, boundary cases, the approval freeze and the flag boundaries against hand-computed oracles                      | #3, #4, #7    | pgTAP                                                                                   | change opened | testing-payout-correctness |
| 3   | Route gating & approval notification | Prove the role × route matrix and once-only, own-figure-only approval email                                                                      | #5, #6        | Vitest bootstrap + integration + smoke extension + HTTP IDOR check (moved from Phase 1) | not started   | —                          |
| 4   | US-01 e2e & gates wiring             | One e2e for approve → employee sees only their own result; make the new suites required CI gates; recommended local post-edit hook on migrations | cross-cutting | e2e + gates + post-edit hook                                                            | not started   | —                          |

## 4. Stack

| Layer                   | Tool                                                                               | Version                | Notes                                                             |
| ----------------------- | ---------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------- |
| database / RLS          | pgTAP via `supabase test db`                                                       | Supabase CLI ^2.23     | Exists — 9 test files, runs in CI `smoke` job                     |
| unit + integration (TS) | Vitest via Astro `getViteConfig()`                                                 | none yet — see Phase 3 | Astro's documented path (Context7, checked: 2026-10-07)           |
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

| Gate                                     | Where                         | Required?                                                                                                                   | Catches                                                                                                |
| ---------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| lint + `lint:ui` + `astro check` + build | local (pre-commit) + CI       | required (wired)                                                                                                            | syntactic / type / token drift                                                                         |
| pgTAP (`supabase test db`)               | CI `smoke` job                | required (wired); includes `rls_matrix` and `rls_catalog_guard` since §3 Phase 1, and `payout_correctness` since §3 Phase 2 | RLS and payout regressions in the database; unclassified tables, policies, grants or definer functions |
| Vitest unit + integration                | local + CI                    | required after §3 Phase 3                                                                                                   | gating logic and TS input-parsing regressions                                                          |
| auth smoke                               | CI against production preview | required (wired); extended after §3 Phase 3                                                                                 | broken sign-in / role routing                                                                          |
| e2e on US-01                             | CI on PR                      | required after §3 Phase 4                                                                                                   | broken approve → employee-view path                                                                    |
| post-edit hook (migrations → pgTAP)      | local (agent loop)            | recommended after §3 Phase 4                                                                                                | RLS regressions at edit time                                                                           |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase <N>."

### 6.1 Adding an RLS / data-isolation test (new table, view, or policy)

RLS is the security boundary: a signed-in user can call PostgREST directly, so isolation is tested in the database, not through pages.

- **Where:** `supabase/tests/rls_matrix.test.sql` (behaviour per actor) and `supabase/tests/rls_catalog_guard.test.sql` (catalog: table set, exact policy inventory, no `for all` policies, grant hygiene, definer-function allowlist by signature, pinned `search_path`). Per-feature suites (`*_rls.test.sql`, `milestone_*.test.sql`) keep their own feature checks.
- **Rule:** a migration that adds or changes a table, view, policy, grant or `security definer` function updates **both** files. The guard fails by name until it is classified; the matrix then gets a row for every actor on the new surface. A migration that changes only the body of a view or `security invoker` function, keeping its name, columns, `security_invoker`, grants and definer status, adds `rls_matrix` cells for the changed behaviour and leaves the catalog guard unchanged (the catalog shape did not change).
- **Actor cast** (fixtures in the `…07xx` UUID range, `@pgtap.test` emails): Supervisors SA (owner) and SB (foreign), two linked **and activated** employees E1/E2, an employee-role user with no employee record (U), an Admin (AD), anon. Never use U as the only employee attacker — it sees nothing for the wrong reason.
- **Expected values** come from the decided matrix (PRD visibility rule + recorded decisions), never from reading the policy under test.
- **Denial shapes:** RLS-denied insert → `throws_ok(…, '42501')`; RLS-denied update/delete → `is_empty($$ … returning id $$)` followed by an owner-side "row unchanged" check; a missing table/column privilege → `42501`; guard triggers may answer with a business code first (e.g. `MR007` on a frozen milestone). Assert allow cells too, so a deny-everything database cannot pass.
- **Harness:** `begin; … plan(N) … finish(); rollback;`; switch identity with `set local role authenticated; set local request.jwt.claims = '{"sub":"…"}'`; claims survive `reset role`, so clear them when reading as owner.
- **Prove it can fail:** break the policy in a scratch migration (`supabase/migrations/2099…_scratch_break.sql`), `npx supabase db reset --local`, confirm the named assertion goes red, delete the scratch file and reset again.
- **Run:** `npx supabase db reset --local && npx supabase test db` (Docker + `npx supabase start`); CI runs the same step in the `smoke` job.

### 6.2 Adding a payout / formula test

All payout, freeze and flag arithmetic lives in SQL (`kpi_multiplier`, `capped_payout_pool`, `milestone_payout_lines`, `milestone_payout_summary`, the views `project_budget_exposure` and `employee_time_share_totals`), so these tests are pgTAP, run as the signed-in role like §6.1.

- **Where:** `supabase/tests/payout_correctness.test.sql`, one section per risk (`#3` ceilings, `#4` freeze, `#7` flags). Fixtures in the `…08xx` UUID range; the suite header keeps the fixture map, including which ids are still free. Add a case to the matching section rather than a new file.
- **Oracle:** derive every expected literal by hand from PRD Business Logic in integer grosze — M = min + (Σ wₖ·Sₖ)·0.01·(max − min); pool = floor₀.₀₁(target·M/max); bonusᵢ = floor₀.₀₁(pool·eᵢ/Σe), eᵢ = time_share·role_weight·rating_factor — and write the derivation in a comment above the assertion. Never compute it by calling the function under test, and never with floating point (it disagrees by a grosz).
- **Config:** `bonus_settings` is a global singleton. Set it explicitly as the owner at the top of each section (and before any config edit), so no literal depends on the seeded defaults.
- **Shape:** exact literals per case (summary and lines), plus the generic property assertion over the section's Draft milestones: Σ line bonus = `payout_total` ≤ `payout_pool` ≤ `target_pool`, with a row count so it cannot pass vacuously.
- **Freeze pattern:** approve → edit the config as the owner → the Approved snapshot (`milestone_results` / `milestone_result_lines`) still equals the pre-edit literals, read as the Supervisor and as a linked, activated employee; a Draft milestone with the same inputs shows the new literals; `milestone_payout_lines` / `milestone_payout_summary` on the Approved id raise `MR015` for the owner and Admin and return no rows for anyone who cannot see it.
- **Flag pattern:** both flags are strict `>`. Assert at equality (not flagged) and one grosz / 0.01 over (flagged); pin closed milestones and closed projects explicitly. Status changes between assertions run as the owner (`reset role`, claims cleared), and engagement writes happen before a milestone closes (MR007).
- **Prove it can fail:** break the rule in a scratch migration (e.g. `round` instead of `div` in `capped_payout_pool`, drop the MR015 guard, `>=` in a flag view), `npx supabase db reset --local`, confirm the named assertion goes red, delete the scratch file and reset again.
- **Run:** `npx supabase db reset --local && npx supabase test db`; CI runs it in the `smoke` job.

### 6.3 Adding a test for a new page or API route

- TBD — see §3 Phase 3 (role × route matrix pattern; rule for catching unlisted routes).

### 6.4 Adding a test for an Edge Function side effect (email)

- TBD — see §3 Phase 3 (Mailpit-backed recipient ↔ amount and once-only pattern).

### 6.5 Adding an e2e test

- TBD — see §3 Phase 4 (only for flows that cross auth cookie + RLS + page; US-01 is the reference).

### 6.6 Per-rollout-phase notes

(Appended by each phase's final sub-phase.)

- **Phase 1 — Data isolation & RLS matrix** (`testing-rls-matrix`, 2026-10-07). The matrix found two real holes, fixed in `20261007120000_rls_tighten_profiles_and_grants.sql`: Supervisors could read every profile (F1), and `authenticated` still held TRUNCATE/REFERENCES/TRIGGER on three tables (F2). Accepted and documented: the unscoped `is_approved_milestone` boolean (F4). Pinned as intended: after a project reassignment, the new owner sees the approved history and the previous owner loses it (F3). The HTTP IDOR check moved to Phase 3: `/my-bonuses` takes no ID, and foreign IDs return HTTP 200 with a "not found" body. Mutation checks confirmed that both suites fail for the right reason.
- **Phase 2 — Payout correctness & approval freeze** (`testing-payout-correctness`, 2026-10-09). The new suite closed two gaps. Live payout functions recomputed Approved milestones from the current config, so the freeze held only by page convention; they now raise `MR015` for a visible Approved milestone (`20261009120000_payout_rpcs_refuse_approved.sql`), while an invisible one still returns no rows. The time-share flag counted engagements in cancelled or completed projects; the view now excludes them (`20261009130000_time_share_excludes_closed_projects.sql`). Pinned as intended: budget exposure ignores project status, so a closed project still shows its exposure. Vitest moved to Phase 3: none of the payout, freeze or flag logic is TS, and Phase 3's route gating is the first TS logic worth a runner. Mutation checks (floor → round, dropped MR015 guard, `>` → `>=`) each turned the named assertions red. Known divergence, left for a later change: the owner-change guards MR008/MR012 still treat a milestone as open by its own status only, so an engagement on an active milestone in a closed project still blocks an owner change while no longer counting toward the time-share total (the guards are the stricter side).

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
