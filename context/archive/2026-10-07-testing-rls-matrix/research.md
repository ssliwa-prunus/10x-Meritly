---
date: 2026-10-07T16:55:33+02:00
researcher: Claude (Opus 5.5) for ssliwa
git_commit: 7d09db3
branch: develop
repository: 10x-Meritly
topic: "Ground test-plan rollout Phase 1 — data isolation & RLS matrix (risks #1, #2)"
tags: [research, testing, rls, pgtap, supabase, data-isolation, test-plan-phase-1]
status: complete
last_updated: 2026-10-07
last_updated_by: Claude (Opus 5.5) for ssliwa
---

# Research: Ground test-plan rollout Phase 1 — data isolation & RLS matrix

**Date**: 2026-10-07T16:55:33+02:00
**Researcher**: Claude (Opus 5.5) for ssliwa
**Git Commit**: 7d09db3
**Branch**: develop
**Repository**: 10x-Meritly

## Research Question

Ground rollout Phase 1 of `context/foundation/test-plan.md` (risks #1 and #2) against current code:

- **#1** — an employee sees another employee's bonus, or any Draft milestone result, via page, API, changed URL ID, or the upcoming history view. Prove: Employee B gets nothing for Employee A's lines and for Draft lines on every employee-reachable read path. Challenge: "the page filters by the current user, so the data is safe".
- **#2** — a new or replaced RLS policy lets the wrong role through (a Supervisor reads/modifies another Supervisor's projects, milestones, employees, engagement). Prove: a role × table × operation matrix where every out-of-scope cell fails, second Supervisor included. Challenge: "existing RLS tests pass, so the new policy is safe".

For each: ground the failure path, inventory read surfaces and policies, locate existing tests, pick the cheapest useful layer, and flag speculative risks or misleading evidence.

Scope inspected: all 11 files in `supabase/migrations/` (final effective state), all 6 files in `supabase/tests/`, `src/middleware.ts`, `src/lib/supabase.ts`, every page and API route under `src/pages/` that reads Supabase, `src/lib/services/`, both Edge Functions in `supabase/functions/`, `scripts/smoke.mjs`, `supabase/seed.sql`, `supabase/config.toml`, `.github/workflows/ci.yml`, PRD visibility lines. Tests were not run.

## Summary

1. **No current leak of bonus figures was found.** In the final migration state, an employee has exactly two `select` policies — `profiles_select_own` and `milestone_result_lines_select_employee` — and no write policy anywhere (`20260925120000_role_and_rls_scaffold.sql:98-102`, `20261005120000_milestone_approval.sql:210-216`). The result-lines policy requires both `employee_id = current_employee_id()` (an _activated_ employee row linked to `auth.uid()`, `…approval.sql:133-143`) and `is_approved_milestone(milestone_id)` (`…approval.sql:150-163`). Draft figures are never stored; they are computed by security-invoker RPCs that return nothing to an employee because employees cannot read `milestones` (`20261004130000_milestone_payout_hard_cap.sql:79-81`). Both views are `security_invoker = true` (`…approval.sql:569,591`). No policy reads `auth.jwt()` or user metadata.
2. **The app layer is not the boundary, and is not the weak point.** Every app read uses the public key with the user's cookie session (`src/lib/supabase.ts:3,6-20`); no secret key exists in `src/`. The one employee page, `/my-bonuses`, takes no ID from the URL and relies on RLS, with the `employee_id` filter as defence in depth (`src/lib/services/approvals.ts:370-388`). Because a signed-in employee holds a JWT and can call PostgREST/RPC directly, **the real attack surface is the database**, and pgTAP with `set local role authenticated` + `request.jwt.claims` exercises the same path PostgREST uses.
3. **Existing tests are weaker than they look for #1.** Outside `milestone_approval.test.sql`, every "employee sees nothing" assertion uses an employee-role user **with no `employees` row** (e.g. `projects_rls.test.sql:358-367`, `employees_rls.test.sql:415-428`, `milestone_payouts.test.sql:466-477`). That user would see nothing even if a policy wrongly keyed on `current_employee_id()`. Only one linked, activated employee (E1) exists in the suite, and **no second activated employee ever acts as the attacker** (`milestone_approval.test.sql:628-666`).
4. **Existing tests cover #2 partially.** Second-Supervisor cases exist for select on most tables and for inserts, but several out-of-scope write cells are never asserted (list in Detailed Findings §4). Employee write attempts are almost entirely unasserted except via privilege checks.
5. **Four findings the matrix will surface or must decide on** (details §5): (F1) `profiles_select_supervisor` lets any Supervisor read every profile's email and role; (F2) `TRUNCATE` is still granted to `authenticated` on `profiles`, `job_roles`, `bonus_settings`; (F3) visibility follows the _current_ project owner, so a reassigned project hands its approved history to the new Supervisor; (F4) `is_approved_milestone(uuid)` is callable by any authenticated user for any id.
6. **Response-guidance corrections for the test plan:** the planned "one HTTP-level IDOR check" carries little signal for these two risks (the only employee page has no ID parameter; cross-supervisor pages return HTTP 200 with a "not found" body), and "403 / 404" is not what the app returns. The cheapest high-signal layer for both risks is pgTAP, plus a catalog-driven guard so a new table or policy cannot ship unclassified.

## Detailed Findings

### 1. Policy inventory — final effective state (risk #2 context)

No policy is ever dropped or altered after creation; later migrations replace only functions and views. There are no `for all` policies. Every policy is `to authenticated`; `anon` has no table grants (`revoke all … from anon` on every table).

| Table                    | select                                                                                                                                         | insert                              | update                                                   | delete                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------- | ----------------------- |
| `profiles`               | own (`id = auth.uid()`, all roles) `…scaffold.sql:98`; **supervisor: all rows** `:104`; admin `:110`                                           | — (trigger only, `:92-96`)          | admin `:116`                                             | —                       |
| `job_roles`              | admin `…bonus_rules_config.sql:117`; supervisor `:123`                                                                                         | admin `:129`                        | admin `:135`                                             | —                       |
| `bonus_settings`         | admin `:142`; supervisor `:148`                                                                                                                | —                                   | admin `:154`                                             | —                       |
| `projects`               | supervisor: `supervisor_id = auth.uid() AND is_supervisor()` `…projects_and_milestones.sql:288`; admin `:294`                                  | same predicate `:300`; admin `:306` | same in USING + CHECK (no hand-off) `:312`; admin `:319` | —                       |
| `milestones`             | `owns_project(project_id)` `:335`; admin `:341`                                                                                                | `owns_project` `:347`               | `owns_project` both sides `:353`                         | —                       |
| `employees`              | `(supervisor_id = auth.uid() AND is_supervisor()) OR employee_engaged_on_own_milestone(id)` `…employees_and_engagements.sql:384`; admin `:393` | supervisor own `:399`; admin `:405` | supervisor own both sides `:411`; admin `:418`           | —                       |
| `milestone_engagements`  | `owns_milestone` `:435`; admin `:441`                                                                                                          | `owns_milestone` `:447`             | `owns_milestone` `:453`                                  | `owns_milestone` `:460` |
| `milestone_results`      | `owns_milestone` `…approval.sql:177`; admin `:183`; **no employee policy (intentional, `:168-176`)**                                           | —                                   | —                                                        | —                       |
| `milestone_result_lines` | `owns_milestone` `:198`; admin `:204`; employee: own + approved `:210-216`                                                                     | —                                   | —                                                        | —                       |

"—" means no policy, so denied. Column-level grants narrow writes further on `employees` (`…employees_and_engagements.sql:59-61`, `profile_id`/`invited_at`/`activated_at` not writable) and `milestone_engagements` (`:89-90`). `milestone_results` and `milestone_result_lines` grant `authenticated` select only (`…approval.sql:85-86,123-124`).

Guards that turn ownership into hard errors before RLS `WITH CHECK`: `milestones_check_frozen` (MR006/42501/MR014/MR015, `…approval.sql:227-272`), `milestones_check_parent` (42501 before MR002/MR003, `20260927130000_milestones_guard_ownership.sql:7-48`), `milestone_engagements_check_parent` (42501, MR007, MR011, `…approval.sql:473-536`), `employees_check_rules` (42501, MR001/8/9/10, `…approval.sql:406-470`), `projects_check_engaged_owner_change` (MR012, `…approval.sql:539-562`), `profiles_block_owner_role_change` (MR005, `…employees_and_engagements.sql:312-344`).

Security-definer functions callable by `authenticated` (all `search_path = ''`, revoked from `public`/`anon`): `current_app_role`, `is_admin`, `is_supervisor`, `owns_project`, `owns_milestone`, `employee_engaged_on_own_milestone`, `current_employee_id`, `is_approved_milestone`, `approve_milestone`. All except `is_approved_milestone` are scoped to the caller; `approve_milestone` checks `owns_milestone` first and raises 42501 otherwise (`…approval.sql:292`).

Role resolution: `public.profiles.role` read through definer helpers (`…scaffold.sql:52-87`); the signup trigger always takes the column default `'employee'` and reads only `display_name` from metadata (`…scaffold.sql:28-45`). Employee _data_ access is decided by `current_employee_id()` (linked + activated employee row), not by the profile role.

### 2. Employee-reachable read surfaces (risk #1 context)

**App routes** (all API routes are POST-only writes; the only GET handler is `src/pages/auth/confirm.ts:16`):

| Route                                                                                  | Middleware roles                                                | Reads                                                                                           | URL IDs                           | Effective protection                                                                                                                                                                             |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/my-bonuses` (`src/pages/my-bonuses.astro:15-26`)                                     | employee (`src/middleware.ts:24,91-98`)                         | `rpc current_employee_id` + unfiltered `milestone_result_lines` select (`approvals.ts:370-381`) | none                              | RLS `…approval.sql:210-216`; page filter `approvals.ts:388` is defence in depth                                                                                                                  |
| `/projects`, `/projects/[id]`, `/projects/[id]/milestones/[milestoneId]`, `/employees` | supervisor/admin (`middleware.ts:22,81-89`) → employee gets 403 | projects, milestones, engagements, results, payout RPCs, views                                  | `params.id`, `params.milestoneId` | RLS (`owns_*` policies); a foreign Supervisor gets HTTP **200** with "Project not found." / "Milestone not found." (`src/pages/projects/[id].astro:57,103`, `…/[milestoneId].astro:112-114,209`) |

**Direct database surface for an employee JWT**: two select policies (above), the callable definer helpers (booleans/uuid only), and the invoker payout RPCs `kpi_multiplier`, `capped_payout_pool`, `milestone_payout_lines`, `milestone_payout_summary`, which return nothing/null to an employee because employees cannot read `milestones` or `bonus_settings` (`…payout_hard_cap.sql:79-81,95-98`).

**Edge Functions** (secret key; `verify_jwt = true`, `supabase/config.toml:373-378`): `notify-milestone-approved` requires role supervisor (`supabase/functions/notify-milestone-approved/index.ts:232-237`), loads the milestone under the user's RLS (`:240-244`), checks project ownership (`:249-251`) and `approved` status (`:252`) before any secret-key read; each mail goes to the line's own employee (`:108-145`). `invite-employee` requires supervisor/admin and ownership (`supabase/functions/invite-employee/index.ts:51-71`) and returns no figures. Neither is exercised in CI (edge-runtime excluded, `.github/workflows/ci.yml:42`) — that is Phase 3 territory (risk #5), not Phase 1.

**Upcoming history view (roadmap S-06)**: no code yet. Any new read surface it adds (a view, an RPC, a new table) is exactly what the catalog guard in §6 must catch.

### 3. Existing test harness and coverage

Harness (each file rolls its own; no shared helpers): `begin; … select plan(N); … select * from finish(); rollback;`. Users inserted into `auth.users` as owner (fires `handle_new_user`), roles set via `update public.profiles`, identity switched with:

```sql
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000101"}';
```

(`profiles_rls.test.sql:63-64`). Fixture UUID ranges are reserved per file (`…01xx` profiles … `…06xx` approval, `profiles_rls.test.sql:3-7`); the `seed.sql` header lists ranges only up to `05xx` (stale). Counts are scoped to fixture IDs, so the suite runs against the seeded DB. Pitfall: claims persist across `reset role`; `milestone_approval.test.sql:545-548` clears them explicitly. Denials are asserted as `throws_ok(…,'42501')` for inserts/guards and `is_empty($$ update/delete … returning id $$)` for RLS-filtered writes (0 rows).

A structural guard already exists: every public table has RLS enabled and every public view has `security_invoker` (`profiles_rls.test.sql:180-205`).

Second-Supervisor coverage that exists: select/insert probes on projects and milestones (`projects_rls.test.sql:127-165,340-351,465-476`); employees select/update and engagement insert/update/delete (`employees_rls.test.sql:192-206,305-319,397-408`); KPI scoring and payout RPCs (`milestone_payouts.test.sql:412-435`); `approve_milestone` and result reads (`milestone_approval.test.sql:567-586`).

Employee coverage that exists: profiles own-only (`profiles_rls.test.sql:66-97`); config tables denied (`bonus_config_rls.test.sql:92-115`); linked E1 sees exactly their own approved line, not colleagues' lines even by ID, no header, no milestone row, cannot approve (`milestone_approval.test.sql:628-652`); unactivated E3 sees nothing (`:657-666`); E1 sees nothing for an injected Draft snapshot (`:671-707`) — the only direct test of the `is_approved_milestone` half of the employee predicate.

### 4. Matrix cells with no assertion today

Second Supervisor (B) against A's rows:

- update / delete A's milestones (projects_rls only has A-inserts-into-B probes);
- delete A's employees; update / delete A's engagements from B's side;
- `employee_time_share_totals` for A's employees;
- reads of A's approved snapshot after an Admin reassigns the project (`milestone_approval.test.sql:555-558` reassigns but never checks).

Linked, activated employee:

- select on `employees` (own and others), `milestone_engagements`, `projects`, `milestones` (other than E1's single check), both views, payout RPCs, config tables;
- every write: update/delete on `milestone_result_lines` (only `has_table_privilege` at `milestone_approval.test.sql:156-162`; the `throws_ok` at `:611-616` runs as admin), update/delete own `employees` row incl. `profile_id`, insert/update/delete engagements, insert/update/delete projects and milestones, KPI scoring.

Second activated employee (E2) as attacker: does not exist — E2 has no auth account in the suite.

Delete on `job_roles`, `bonus_settings`, `profiles`, `projects`, `milestones` is asserted only as "0 rows" behaviour, with no check that no delete policy exists.

### 5. Findings to surface (not bugs in tests — decisions for `/10x-plan`)

- **F1 — Supervisors read every profile.** `profiles_select_supervisor` is `using (is_supervisor())` with no scope (`20260925120000_role_and_rls_scaffold.sql:104-108`); `profiles` holds `email`, `display_name`, `role` (`:12-18`). No bonus figures, so PRD:129 ("no user can retrieve another employee's bonus data") is not violated, but risk #2 names "reads another Supervisor's … employees" and this exposes their names and emails. A matrix test written to the risk wording would fail here. Needs a decision: intended (owner reassignment / admin-like lookup) or narrow it.
- **F2 — TRUNCATE still granted.** `profiles`, `job_roles`, `bonus_settings` revoke all from `anon` only (`…scaffold.sql:22`, `…bonus_rules_config.sql:34,80`), while `projects`/`milestones` revoke `truncate, references, trigger` from `authenticated` (`…projects_and_milestones.sql:62,94`). TRUNCATE is not subject to RLS. PostgREST cannot issue it, so exploitability through the API is low (inference); the inconsistency is real and a privilege-matrix test would fail on it.
- **F3 — Visibility follows the current project owner.** `owns_milestone` resolves the _current_ owner (`…employees_and_engagements.sql:110-127`); MR012 treats approved milestones as closed (`…approval.sql:539-562`), so an Admin can reassign a project and the new Supervisor reads its whole approved history, including foreign employees' rows via `employee_engaged_on_own_milestone` (ignores status, `…employees_and_engagements.sql:133-152`). Probably intended; not stated in PRD or archive. Test must assert whichever behaviour is decided, not the current one by default (oracle problem).
- **F4 — `is_approved_milestone(uuid)` is unscoped** (`…approval.sql:150-166`): any authenticated user learns whether an arbitrary milestone UUID exists and is approved. Minor (UUIDs not guessable); worth an explicit "accepted" note in the matrix rather than silence.

Also observed, outside Phase 1 scope: CI triggers only on push/PR to `master` (`.github/workflows/ci.yml:3-7`) while work happens on `develop`; whether a failing `supabase test db` (`ci.yml:44-45`) blocks merges depends on branch protection not visible in the repo. The seed has no approved milestone (`supabase/seed.sql`), so no HTTP-level check of employee figures is possible without approving one first.

### 6. Verified / corrected response guidance

| Risk            | Test-plan guidance                                      | Verdict                   | Grounded correction                                                                                                                                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1 prove        | "gets zero rows / 403 / 404 … on every read path"       | **partial**               | At DB level "zero rows" is right. At HTTP level the app returns 403 (middleware, wrong role) or **200 + "not found" body** (foreign IDs) — never 404.                                                                                                                                                               |
| #1 challenge    | "the page filters by the current user"                  | **supported**             | Page filter exists (`approvals.ts:388`) but RLS is the real gate; a test must query as the employee JWT, not read the page.                                                                                                                                                                                         |
| #1 layer        | "pgTAP as employee + one HTTP IDOR check"               | **corrected**             | pgTAP is the cheapest real signal and already runs in CI. The HTTP IDOR check adds little for #1: `/my-bonuses` has no ID parameter, and an employee is 403'd from every route with IDs. Fold HTTP role/ID checks into Phase 3 (route gating, risk #6), where the smoke script is extended anyway.                  |
| #1 anti-pattern | page output; own-row-only                               | **supported + sharpened** | Also: using an _unlinked_ employee-role user as the attacker — it sees nothing for the wrong reason. Attackers must be linked, activated employees (two of them).                                                                                                                                                   |
| #2 prove        | role × table × operation matrix incl. second Supervisor | **supported**             | Cells missing today are listed in §4.                                                                                                                                                                                                                                                                               |
| #2 challenge    | "existing RLS tests pass"                               | **supported**             | Existing suites are per-feature and assert what each slice intended; no file enumerates all cells.                                                                                                                                                                                                                  |
| #2 anti-pattern | asserting only intended operations                      | **supported + mechanism** | Add a catalog guard over `pg_policies` / table privileges that fails when a public table, policy or grant appears that the matrix does not classify — extending the existing structural guard at `profiles_rls.test.sql:180-205`. This is what catches the _next_ migration, which is the actual likelihood driver. |

Hot-spot evidence check: `supabase/migrations/` and `supabase/tests/` churn is accurate likelihood evidence — 11 migrations in 12 days, two of them follow-up guards (`20260927130000_…`, `20260930120000_…`). Not misleading.

Speculative-risk check: neither risk is speculative. #1's code currently holds; the risk is regression (S-06 adds read paths) and weak tests. #2 has concrete untested cells and two findings (F1, F2) a matrix would turn red today.

## Code References

- `supabase/migrations/20261005120000_milestone_approval.sql:133-166` — `current_employee_id()`, `is_approved_milestone()`
- `supabase/migrations/20261005120000_milestone_approval.sql:168-216` — result/result-line policies (employee policy `:210-216`)
- `supabase/migrations/20261005120000_milestone_approval.sql:282-396` — `approve_milestone` (ownership check `:292`)
- `supabase/migrations/20261005120000_milestone_approval.sql:568-619` — final views, `security_invoker`
- `supabase/migrations/20260925120000_role_and_rls_scaffold.sql:98-121` — profiles policies (unscoped supervisor select `:104-108`)
- `supabase/migrations/20260927120000_projects_and_milestones.sql:288-357` — project/milestone policies
- `supabase/migrations/20260929120000_employees_and_engagements.sql:110-152,384-465` — ownership helpers, employee/engagement policies
- `supabase/tests/profiles_rls.test.sql:180-205` — structural guard (RLS on, `security_invoker`)
- `supabase/tests/milestone_approval.test.sql:619-707` — only linked-employee and Draft-snapshot assertions
- `src/lib/services/approvals.ts:370-388` — `/my-bonuses` query, RLS-first with defence-in-depth filter
- `src/middleware.ts:20-28,72-98` — route lists, `startsWith` matching
- `.github/workflows/ci.yml:3-7,42-45` — CI triggers, pgTAP step

## Architecture Insights

- Database-first security: every guarantee lives in Postgres (policies, guard triggers raising `42501`/`MRxxx`, CHECKs); the app maps codes to messages. Phase 1 tests belong in pgTAP, matching the established pattern (`context/archive/2026-09-27-supervisor-creates-project-and-milestones/plan.md:80,493`).
- Two denial shapes matter for assertions: an RLS-denied insert raises `42501`; an RLS-denied update/delete silently affects 0 rows (`…/plan.md:62`). Guard triggers convert some 0-row cases into `42501` before business errors (MR002/MR003).
- Employee identity is two-step: profile role `employee` **and** an activated `employees` row linked by `profile_id`. Tests must model both to be meaningful.

## Historical Context (from prior changes)

- `context/archive/2026-09-27-supervisor-creates-project-and-milestones/plan.md:487` — impl-review F1 added `20260927130000_milestones_guard_ownership.sql` so a non-owner gets `42501` before MR002/MR003: supported, the guard is present (`…guard_ownership.sql:1-48`) and tested (`projects_rls.test.sql:131-151`).
- `context/archive/2026-09-27-supervisor-creates-project-and-milestones/plan.md:23` — "a structural guard fails when a public table lacks RLS or a public view lacks `security_invoker`": supported (`profiles_rls.test.sql:180-205`).
- `context/archive/2026-09-27-supervisor-creates-project-and-milestones/plan.md:97` — "security definer only where the check must see past the caller's RLS; views must stay invoker": supported for views; the later `is_approved_milestone` is a definer helper without caller scoping (F4).
- `20260930120000_projects_guard_engaged_owner_change.sql:12-13` documents a known gap (reopening a completed milestone can leave a foreign employee engaged on an open milestone) — relevant to F3 fixtures.

## Related Research

- `context/archive/2026-10-05-supervisor-approves-milestone-employee-sees-bonus/` — approval snapshot and employee policy design (S-05).
- `context/archive/2026-09-29-supervisor-assigns-employee-engagement/` — employee/engagement ownership helpers (S-03).

## Open Questions

1. **F1** — should Supervisors keep read access to every profile, or only to their own employees' and fellow Supervisors' profiles? (Decides whether the matrix asserts allow or deny.)
2. **F2** — revoke `truncate, references, trigger` from `authenticated` on the three config/profile tables in a migration as part of this phase, or record it as accepted?
3. **F3** — after an Admin reassigns a project, should the new Supervisor see its approved history, and should the previous one lose it? Needs a product answer before a test pins it.
4. **F4** — accept the unscoped `is_approved_milestone` oracle, or scope it to `owns_milestone OR employee line exists`?
5. Placement: one new matrix file (e.g. a dedicated `…07xx` fixture range) vs. extending the six per-feature files. Research leans to one new file plus the catalog guard, so the matrix is readable in one place; `/10x-plan` decides.
