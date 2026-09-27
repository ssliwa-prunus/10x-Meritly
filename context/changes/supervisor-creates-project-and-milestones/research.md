---
date: 2026-09-27T17:15:21+02:00
researcher: ssliwa (with Claude Code)
git_commit: a602669
branch: develop
repository: 10x-Meritly
topic: "Can the variant-A bonus algorithm be implemented in the current codebase, scoped to S-02?"
tags: [research, codebase, bonus-model, projects, milestones, rls, budget-check]
status: complete
last_updated: 2026-09-27
last_updated_by: ssliwa (with Claude Code)
last_updated_note: "Added Part 2 (internal codebase feasibility for S-02). Part 1 (external research) kept unchanged. Follow-up: user decided money representation (Open Question 1) — złoty with grosze, 2 decimals, rounded down to the grosz; ownership (Open Question 2) — one owner per project; budget check location (Open Question 4) — SQL; Admin can create, edit and reassign projects; milestone statuses (Open Question 3) — cancelled excluded from the reservation, approved added in S-05; Admin cannot edit milestones; shared Supervisor/Admin pages; role change blocked while a Supervisor owns projects."
---

# Research: bonus model (variant A) and its feasibility for S-02

Part 1 is the original external research (Exa web search), unchanged. Part 2 adds the internal codebase research requested with `/10x-research`: can this algorithm be implemented in our application, and what does S-02 need for it?

---

# Part 1 — External research: KPI multiplier placement (variant A)

Date: 2026-09-27. Sources gathered with Exa web search. Decision already applied to `context/foundation/prd.md` (Guardrails, US-01, FR-002, FR-005, FR-006, FR-010, FR-017, Business Logic), `context/foundation/roadmap.md` (S-02, S-04) and `CLAUDE.md` (invariants).

## Problem found

The original PRD formula split a fixed milestone pool proportionally by `time share × role weight × rating factor × milestone multiplier`. The multiplier is the same for everyone in a milestone, so it cancels out:

```
bonus_i = Pool × (e_i × M) / Σ(e_j × M) = Pool × e_i / Σ e_j
```

KPI scores never changed any payout, and `multiplier_max > 1` (default 1.30) could never take effect under a hard "payouts ≤ pool" cap.

## Options considered

| Variant                                       | Formula                                                         | Consequence                                                                                                                           |
| --------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Pool is a target, M scales it (chosen)** | `payout_pool = floor(target_pool × M)`, then proportional split | `M < 1` returns the difference to the budget; `M > 1` pays above target, so the project budget must reserve `target × multiplier_max` |
| B. Pool is a hard cap, M only reduces         | `M_eff = min(M, 1)`                                             | Budget-safe and simple, but `multiplier_max` is meaningless and KPIs only ever penalise                                               |
| C. No pool, target bonus per person           | `bonus = target_i × M × factor_i`                               | Common corporate model, but breaks the core pool invariant                                                                            |

## Chosen model (variant A)

```
M           = clamp(Σ KPI weight_k × KPI score_k → multiplier, multiplier_min, multiplier_max)
payout_pool = floor(target_pool × M)
e_i         = time_share_i × role_weight_i × rating_factor_i
bonus_i     = floor(payout_pool × e_i / Σ e_j)
residual    = payout_pool − Σ bonus_i
```

Invariants: `Σ bonus_i ≤ payout_pool ≤ target_pool × multiplier_max`.

## What this means for S-02 (this change)

- **FR-005:** the milestone field is the **target** bonus pool, i.e. the payout at `M = 1.0`. Name the column accordingly (e.g. `target_pool`), not `bonus_pool`.
- **FR-017:** the project budget check uses worst-case exposure, not the plain sum of pools:
  - Approved milestone → its actual `payout_pool` (frozen at approval).
  - Any other milestone → `target_pool × current multiplier_max` from `bonus_settings` (S-01).
  - Until S-05 (approval) exists, every milestone is reserved at `target_pool × multiplier_max`.
- The check stays an informational flag, as in the PRD; it does not block saving.
- `multiplier_max` can change later (prospectively only, FR-002), so compute the worst case at read time instead of storing it.

## Supporting findings

- Splitting a milestone pool by role, time on project and criticality weights is an established pattern for project/milestone bonuses — [TRWiki: Project-Based and Professional Services](https://trwiki.com/knowledge/5.3.3_Project-Based_and_Professional_Services).
- Pool allocation calculators use the same `e_i = basis × rating × service`, `A_i = Pool × e_i / Σe`, and surface the rounding residual explicitly — [simplified.tools bonus pool calculator](https://www.simplified.tools/calculate_bonus_pool_allocation).
- Rating project characteristics (deadline, budget, labour) 1–5 with weights and a floor rule ("any rating of 1 ⇒ total 1") — [PMI: Result-driven project bonus system](https://www.pmi.org/learning/library/result-driven-project-bonus-system-8070).
- Team/company results should size the pot, individual results should set the share — decouple the two multipliers — [Better than Random: The lazy bonus system](https://betterthanrandom.substack.com/p/the-lazy-bonus-system); funding-factor model in [TRWiki: Sample Team/Department Incentive Plans](https://trwiki.com/knowledge/Sample_TeamDepartment_Incentive_Plans).
- Multiplicative designs amplify good and bad periods; typical leverage 70–130% of target (matches the 0.70–1.30 defaults) — [Pearl Meyer: bonus plan design](https://pearlmeyer.com/insights-and-research/article/designing-an-effective-bonus-plan-for-early-stage-biotech-companies).
- Linked designs (hurdles, multipliers, matrices) stop one strong metric from masking a failed one — [WorldatWork: Linked Formula Design](https://worldatwork.org/publications/workspan-daily/linked-formula-design-proceed-with-care).
- Narrow individual spread is a feature: forced distribution cuts knowledge sharing in teams ([ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0167268121001827)); large relative rewards crowd out cooperation ([SSRN, Irlenbusch & Lünser](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=947075)); equal sharing matched or beat piece rate on team output ([NBER w30427](https://www.nber.org/system/files/working_papers/w30427/w30427.pdf)); wide supervisor discretion raises influence activities ([Elsinger 2026](https://exa.ai/library/publication/d39g79ndvfm)). This supports the narrow 0.8–1.2 rating factor and formula-driven (not discretionary) allocation.

## Open ideas (not in scope, not in PRD)

- KPI hurdle: a failing score on any single KPI floors the multiplier (PMI pattern).
- Base share: e.g. 20–30% of the payout pool split by `time share × role weight` only, the rest by the full formula.
- Show employees the breakdown (time share, role weight, rating factor, M) next to their Approved bonus — transparency is the most cited fairness factor.

---

# Part 2 — Internal research: can variant A be implemented here, and what S-02 needs

**Date**: 2026-09-27T17:15:21+02:00
**Git Commit**: a602669 (working tree has uncommitted changes to skills, `CLAUDE.md`, `prd.md`, `roadmap.md`; anchors below are to local files)
**Branch**: develop
**Repository**: 10x-Meritly

## Research Question

"Please review our codebase and decide whether the algorithm from research.md could be implemented in our application. We want to implement S-02."

## Summary

**Verdict: yes, variant A fits the current codebase, and nothing that exists today has to change for it.** The two things S-02 needs from variant A are available now:

1. **The column meaning (FR-005):** no `projects` or `milestones` table exists yet. In the inspected paths (`supabase/migrations/` has two files; the grep over `src/` found no project, milestone, `target_pool` or budget entity), S-02 can create `milestones.target_pool` from scratch with no migration of old data.
2. **The worst-case reservation (FR-017):** `bonus_settings.multiplier_max` exists as `numeric(4,2)` with `0 < multiplier_min < multiplier_max <= 3` enforced by a CHECK constraint ([20260926120000_bonus_rules_config.sql:45-46,62-64](../../../supabase/migrations/20260926120000_bonus_rules_config.sql)). Supervisors can read it under RLS through the `bonus_settings_select_supervisor` policy ([same file:148-152](../../../supabase/migrations/20260926120000_bonus_rules_config.sql)). So the check can run as the signed-in Supervisor with the public key, as `CLAUDE.md` requires.

The rest of the formula (KPI scores → `M`, `payout_pool`, the split, the residual) belongs to S-04, and freezing belongs to S-05. The contract that gets them there is already written: S-04/S-05 result rows must store the multiplier and weights they used ([docs/reference/contract-surfaces.md:33-37](../../../docs/reference/contract-surfaces.md)). S-02 only has to leave room for that. In practice this means a milestone status that can become Approved, plus a later nullable `payout_pool` column.

S-02 still has to settle four things that no archived plan decides: how money is represented, how project ownership is modelled, a guard on supervisor routes, and which milestone statuses count toward the reservation. Details are under Open Questions.

## Detailed Findings

### Database: what S-02 builds on

- `public.is_supervisor()` / `public.is_admin()` are `security definer`, `stable`, `set search_path = ''`, and callable by `authenticated` only ([20260925120000_role_and_rls_scaffold.sql:62-87](../../../supabase/migrations/20260925120000_role_and_rls_scaffold.sql)). They check the role only. They know nothing about ownership.
- F-01 explicitly left "Supervisor sees own team" to "project ownership in S-02/S-03" (`context/archive/2026-09-25-role-and-rls-scaffold/plan.md:39`). So S-02 must add an owner column (e.g. `projects.supervisor_id → profiles.id`) and ownership-scoped policies. No `owns_project()`-style helper exists in the two inspected migrations.
- Supervisors can already select every profile ([role_and_rls_scaffold.sql:104-108](../../../supabase/migrations/20260925120000_role_and_rls_scaffold.sql)). That does not reveal figures, but it does mean project rows need their own ownership predicate rather than relying on profile visibility.
- Established table conventions (bonus_rules migration, and `contract-surfaces.md:26-31`):
  - RLS enabled in the creating migration.
  - `revoke all … from anon` ([bonus_rules_config.sql:34,80](../../../supabase/migrations/20260926120000_bonus_rules_config.sql)).
  - One policy per operation per role, calling helpers as `(select public.is_x())`.
  - Operations that are not allowed get no policy, with a comment saying so ([bonus_rules_config.sql:108-116](../../../supabase/migrations/20260926120000_bonus_rules_config.sql)).
  - Value rules live in CHECK constraints ([bonus_rules_config.sql:1-6](../../../supabase/migrations/20260926120000_bonus_rules_config.sql)).
- Audit trigger `set_config_audit_fields()` sets `updated_at` and `updated_by = auth.uid()` ([bonus_rules_config.sql:86-106](../../../supabase/migrations/20260926120000_bonus_rules_config.sql)). It could be reused for projects and milestones, but its name says "config". Whether to reuse it or add a generic twin is a plan choice.
- Config is not versioned. Freezing is S-04/S-05's job, done by copying values onto result rows ([bonus_rules_config.sql:8-9](../../../supabase/migrations/20260926120000_bonus_rules_config.sql), `contract-surfaces.md:33-37`). This matches the Part 1 decision to compute the worst case at read time rather than store it.

### The algorithm against the existing numeric types

- `multiplier_max` is `numeric(4,2)`, so in SQL `target_pool × multiplier_max` is exact decimal arithmetic when `target_pool` is an integer or numeric column.
- In TypeScript, `getBonusSettings()` converts every numeric column with `Number(...)` (`src/lib/services/bonus-config.ts:241,264-288`, per the app-layer sweep). The module's own rule is to compare decimals in whole hundredths, never as raw floats (`bonus-config.ts:69-77`: `toHundredths = v => Math.round(v * 100)`). A TS implementation of the reservation should therefore compute `Math.floor(target × round(max × 100) / 100)` using integer operations, not `target * max` as floats.
- **Rounding the reservation.** Variant A pays `payout_pool = floor(target_pool × M)` with `M ≤ multiplier_max` (Part 1, PRD Business Logic `prd.md:137-143`). `floor` never decreases as its input grows, so `payout_pool ≤ floor(target_pool × multiplier_max)`. Reserving `floor(target_pool × multiplier_max)` per non-Approved milestone is therefore a tight, safe upper bound. Reserving the unrounded product is also safe, but can over-flag by a fraction of the smallest money unit. This holds only while `multiplier_max` is unchanged between the check and computation. Because the check runs at read time, a later Admin increase raises the reservation on the next read, which is the intended behaviour.
- There is no money, integer-amount or floor helper anywhere in the inspected `src/lib/` (`supabase.ts`, `utils.ts`, `config-status.ts`, `services/bonus-config.ts`). S-02 is the first slice with money.

### Where the check should live: SQL view vs TS service

- `CLAUDE.md` states there is no unit-test framework; `npm run smoke` covers only the auth flow (`scripts/smoke.mjs:38-59`, per the app-layer sweep). pgTAP suites in `supabase/tests/` run in CI via `supabase test db` (`contract-surfaces.md:31`).
- So the reservation arithmetic can only be tested automatically if it lives in SQL, i.e. a view (with `security_invoker = true`, `contract-surfaces.md:30`) or a SQL function. The existing structural pgTAP guard fails CI when a view lacks `security_invoker` (`role-and-rls-scaffold/plan.md:109`, per the archive sweep).
- A TS service computation would follow the existing service pattern, but would ship with only manual verification. This is a genuine choice for `/10x-plan`. The evidence (the `quality` main goal in `roadmap.md:8`, and S-04 reusing the same arithmetic) favours SQL.

### App layer: patterns S-02 must follow

- **Route guard.**
  - `PROTECTED_ROUTES = ["/dashboard", "/admin", "/api/admin"]` and `ADMIN_ROUTES = ["/admin", "/api/admin"]` ([src/middleware.ts:5-6](../../../src/middleware.ts)). There is no supervisor route list.
  - Paths outside `PROTECTED_ROUTES` (e.g. a new `/projects`) get no sign-in redirect ([middleware.ts:43-47](../../../src/middleware.ts)). S-02 must add its prefixes to `PROTECTED_ROUTES` and add a supervisor role guard, mirroring `ADMIN_ROUTES` ([middleware.ts:49-56](../../../src/middleware.ts): 503 on `profileError`, 403 on wrong role).
  - RLS still enforces access. The guard only keeps other roles off the pages.
- **Forms.** Native `<form method="POST">` into `POST: APIRoute` endpoints that always 302-redirect with `?saved=`/`?error=<code>&field=` flash params. Zod issue messages are error codes, looked up in a fixed message catalog (`bonus-config.ts:12-30,62-66,164-201`; `src/pages/api/admin/bonus-settings/kpi.ts:11-28`). `parseForm()` handles malformed bodies (`bonus-config.ts:172-185`; impl-review F1). No JSON API and no `fetch`-based islands exist.
- **Page data loading.** Service functions return `{data?, error?}`, loaded with `Promise.all` in the `.astro` page (`src/pages/admin/settings.astro:26-36,59-63`).
- **DB error mapping.** `mapPostgrestError` maps `23505` to `duplicate_name` and `23514` to `rule_violation`; anything else becomes `save_failed` (`bonus-config.ts:219-225`). A period CHECK (`end_date >= start_date`, the PRD acceptance criterion noted in `roadmap.md:112`) would surface as `rule_violation` unless a specific code is added.
- **Types.** Handwritten in `src/types.ts` (`AppRole`, `Profile`, `JobRole`, `BonusSettings` at `:2-34`); no generated DB types. New `Project` / `Milestone` interfaces go there and must be added to `contract-surfaces.md`.

## Code References

- `supabase/migrations/20260925120000_role_and_rls_scaffold.sql:52-87` — role helpers (`current_app_role`, `is_admin`, `is_supervisor`)
- `supabase/migrations/20260925120000_role_and_rls_scaffold.sql:104-108` — supervisors select all profiles
- `supabase/migrations/20260926120000_bonus_rules_config.sql:8-9` — freezing deferred to S-04/S-05 snapshots
- `supabase/migrations/20260926120000_bonus_rules_config.sql:45-46,62-64` — `multiplier_min/max` type and bounds
- `supabase/migrations/20260926120000_bonus_rules_config.sql:148-152` — supervisor select policy on `bonus_settings`
- `supabase/migrations/20260926120000_bonus_rules_config.sql:177` — default `multiplier_max = 1.30`
- `src/middleware.ts:5-6,43-56` — route lists and the admin-only guard
- `src/lib/services/bonus-config.ts:69-77,164-225,264-288` — hundredths rule, form/zod/error helpers, settings read (anchors from the app-layer sweep)
- `docs/reference/contract-surfaces.md:26-37` — policy conventions and config snapshot rule

## Architecture Insights

- The algorithm splits across slices cleanly. S-02 owns **exposure** (`target_pool`, reservation at `multiplier_max`), S-04 owns **computation** (`M`, `payout_pool`, split, residual), and S-05 owns **freezing** (Approved status, stored `payout_pool`). The reservation formula is the only piece of variant A that S-02 implements.
- Keeping `floor(target × multiplier)` in one SQL place (a function reused by S-02's exposure view and S-04's compute) would make the invariant `payout_pool ≤ reservation` hold by construction, not by two implementations agreeing.
- The existing security model (role in `profiles`, `security definer` helpers, RLS as the enforcement point, middleware as UX guard) extends to ownership without redesign. It needs one new predicate: the caller owns the project.

## Historical Context (from prior changes)

- `context/archive/2026-09-25-role-and-rls-scaffold/plan.md:39` — team visibility deferred to S-02/S-03 project ownership. **Supported** by the current migration (no ownership helper exists).
- `context/archive/2026-09-26-admin-configures-bonus-rules/plan.md:47` and `contract-surfaces.md:33-37` — no config versioning; S-04/S-05 snapshot values. **Supported** ([bonus_rules_config.sql:8-9](../../../supabase/migrations/20260926120000_bonus_rules_config.sql)).
- `context/archive/2026-09-26-admin-configures-bonus-rules/plan.md:65` — decimal validation compares whole hundredths. **Supported** (`bonus-config.ts:69-77`).
- `context/archive/2026-09-26-admin-configures-bonus-rules/reviews/impl-review.md`. These findings apply to S-02's new tables and inputs:
  - F2 (skipped): `authenticated` still holds TRUNCATE, REFERENCES and TRIGGER; revoke them on new tables.
  - F3 (skipped): zod accepts `"0x1"` and noise below one hundredth; use a strict decimal regex for money inputs.
  - F4 (skipped): text fields have no length caps; cap names and notes in both zod and the database.
- pgTAP conventions (archive sweep): `begin … rollback`; impersonation via `set local role authenticated` + `request.jwt.claims`; a denied insert raises `42501`, while a denied update or delete affects 0 rows. The next free fixture UUID range is `…03xx` (`supabase/tests/bonus_config_rls.test.sql:5`).

## Related Research

- Part 1 of this document (external, Exa).
- No `research.md` exists in `context/archive/2026-09-25-role-and-rls-scaffold/` or `context/archive/2026-09-26-admin-configures-bonus-rules/`.
- `context/foundation/lessons.md` does not exist.

## Open Questions (for `/10x-plan`; none block feasibility)

1. ~~**Money representation.**~~ **Decided 2026-09-27 by the user:** amounts are złoty with grosze (two decimals, e.g. `12.55`), rounded down to the grosz. See "Follow-up: money representation" below.
2. ~~**Ownership model.**~~ **Decided 2026-09-27 by the user:** one owner per project. See "Follow-up: project ownership" below. **Admin sub-question decided 2026-09-27:** an Admin can create, edit and reassign projects. See "Follow-up: Admin writes and reassignment" below.
3. ~~**Milestone status set, and which statuses count toward the reservation.**~~ **Decided 2026-09-27 by the user:** `cancelled` milestones reserve nothing, and `approved` is added in S-05, not S-02. See "Follow-up: milestone statuses" below.
4. ~~**Where the check lives.**~~ **Decided 2026-09-27 by the user:** in SQL. See "Follow-up: budget check in SQL" below.
5. **Employee access to projects/milestones.** S-02 needs no employee policy. S-05/S-06 will need employees to read project/milestone names for their own Approved results. Leaving employee select policies absent in S-02 is consistent with the "no policy = denied" convention.

## Follow-up: money representation (2026-09-27)

**User decision:** money is stored as złoty with grosze, two decimal places (e.g. `12.55`), and every computed amount is rounded **down** to the grosz.

**What this changes in earlier findings:**

- **"floor" means to the grosz, not to the złoty.** This supersedes the Part 2 line that said `floor()` implies an integer unit. The formula's `floor(x)` reads as `floor(x × 100) / 100` for every money output: the S-02 reservation here, and later S-04's `payout_pool` and `bonus_i`. The PRD Business Logic block (`prd.md:137-143`) writes plain `floor`. It is worth adding a one-line note there saying "rounded down to 0.01 PLN", so S-04 does not read it as whole złoty.
- **The reservation bound still holds.** `floor₀.₀₁(target_pool × M) ≤ floor₀.₀₁(target_pool × multiplier_max)` for `M ≤ multiplier_max`, for the same reason as before: floor to a fixed step never decreases as its input grows.

**Implementation consequences for `/10x-plan`:**

- **DB type.** Use a `numeric(p, 2)` column for `projects` budget and `milestones.target_pool`. `p` is a plan choice; for example, `numeric(12,2)` holds up to 9 999 999 999.99. Add CHECKs for amount `>= 0` (or `> 0`).
- **Postgres rounds on cast, and it does not round down.** Postgres documents that a value with more decimals than a `numeric(p,2)` column allows is rounded to that scale, half away from zero. It does not truncate. The S-01 review saw the same effect on `numeric(4,2)` (impl-review F3: sub-hundredth input silently rounded). Two consequences:
  - **Input:** zod must reject more than two decimals with a strict regex (e.g. `^\d+(\.\d{1,2})?$`, the F3 fix). Otherwise `12.555` is stored as `12.56`, which is rounded up.
  - **Computed values:** SQL must apply `floor(x * 100) / 100` explicitly before any value is written to or compared as `numeric(p,2)`. For S-02 this is the reservation; for S-04 it is `payout_pool` and `bonus_i`. Never rely on the column cast.
- **SQL arithmetic is exact.** Both `target_pool` (`numeric(p,2)`) and `multiplier_max` (`numeric(4,2)`) are decimal, so `floor(target_pool * multiplier_max * 100) / 100` computes without float error. This is one more reason to keep the reservation in SQL (Open Question 4).
- **TS arithmetic must go through integer grosze.** PostgREST can return `numeric` as a string or a number, and the existing service converts with `Number()` (`bonus-config.ts:241`). Do not multiply the resulting floats. If TS ever computes money, convert to grosze first (`Math.round(amount * 100)`), multiply by `multiplier_max` in hundredths (the existing `toHundredths`, `bonus-config.ts:75`), then `Math.floor(grosze * maxHundredths / 100)`. The result stays exact while `grosze × 300 < 2⁵³`, which holds for budgets up to roughly 3 × 10¹¹ PLN. Display it with two decimals.
- **Display and input (money).** Form inputs are `type="number" step="0.01"` (the existing pattern, `KpiSettingsSection.astro`), and values render with `toFixed(2)` or `Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' })`. Formatting is presentation only, applied after flooring.

## Follow-up: project ownership (2026-09-27)

**User decision:** each project has exactly one owner, a Supervisor.

**Implementation consequences for `/10x-plan`:**

- **Column.** Add `projects.supervisor_id uuid not null references public.profiles (id)`, with `default auth.uid()` so the form never sends it. Index it, since every Supervisor policy filters on it.
- **On delete.** `profiles` rows are removed by cascade from `auth.users` ([role_and_rls_scaffold.sql:13](../../../supabase/migrations/20260925120000_role_and_rls_scaffold.sql)). `on delete cascade` would silently delete projects and milestones, and `set null` conflicts with `not null`. `on delete restrict` blocks deleting a user who still owns projects. That is the safest default; handing a project to another owner is a separate Admin action (see Open Question 2).
- **Policies on `projects`** (one per operation per role, `contract-surfaces.md:29`):
  - select: `supervisor_id = (select auth.uid()) and (select public.is_supervisor())`.
  - insert: `with check` using the same predicate, so a Supervisor cannot create a project for someone else.
  - update: `using` and `with check` both use the predicate, so the owner cannot hand the project to another user by changing `supervisor_id`.
  - delete: absent (archive by status), following the "no policy = denied" convention, unless the plan decides otherwise.
  - Admin: at least a select policy using `(select public.is_admin())`. Write access for Admins is still open.
  - Requiring `is_supervisor()` as well as ownership means a Supervisor who is later changed to another role loses access to their projects. That matches "roles live in `profiles`" and needs no extra code.
- **Policies on `milestones`.**
  - Ownership comes from the parent: `exists (select 1 from public.projects p where p.id = milestones.project_id and p.supervisor_id = (select auth.uid()))`.
  - The sub-select is itself filtered by the `projects` RLS policies. That is correct here, and there is no recursion because the `projects` policies never reference `milestones`. A `security definer` helper (e.g. `public.owns_project(uuid)`, same style as `is_supervisor()`) is an alternative and avoids re-running the `projects` policies. That is a plan choice.
  - The update `with check` must re-check ownership of the **new** `project_id`, so a Supervisor cannot move a milestone into someone else's project. Alternatively, make `project_id` unchangeable after insert.
- **Worst-case check.** Because ownership is one Supervisor per project, the exposure view or function (Open Question 4) groups by `project_id` only. With `security_invoker = true`, each Supervisor sees exposure for their own projects and an Admin sees all, with no extra filter.
- **pgTAP cases to cover** (conventions from the archive sweep; next fixture range `…03xx`):
  - an owner can select, insert and update their own project;
  - a second Supervisor gets 0 rows on select and update, and `42501` on an insert with a foreign `supervisor_id`;
  - an owner cannot change `supervisor_id` to another user;
  - an Employee sees nothing;
  - milestone insert into a foreign project → `42501`;
  - moving a milestone to a foreign project is blocked.

## Follow-up: budget check in SQL (2026-09-27)

**User decision:** the FR-017 worst-case check is computed in SQL, not in the TS service.

**Implementation consequences for `/10x-plan`:**

- **One shared rounding function.** Add something like `public.money_floor_mul(amount numeric, multiplier numeric) returns numeric` that returns `floor(amount * multiplier * 100) / 100`. Mark it `immutable`, `set search_path = ''`, and make it security invoker (the default). S-02 uses it for the reservation; S-04 should reuse it for `payout_pool`. Then the rule `payout_pool ≤ reservation` depends on one implementation, not two that must agree (Architecture Insights).
- **The exposure view.** For example, `public.project_budget_exposure`, created `with (security_invoker = true)` (required by `contract-surfaces.md:30` and enforced by the structural pgTAP guard). Suggested columns: `project_id`, `budget`, `reserved_total`, `remaining`, `over_budget`.
  - It reads `projects`, `milestones` and the singleton `bonus_settings`.
  - Use a left join to milestones and `coalesce(sum(...), 0)`, so a project with no milestones still shows up.
  - Until S-05: every counted milestone reserves `money_floor_mul(target_pool, multiplier_max)`. S-05 changes Approved milestones to their stored `payout_pool`, via `create or replace view` in a later migration.
  - Which statuses are counted: every status except `cancelled` (decided; see "Follow-up: milestone statuses").
  - `over_budget = reserved_total > budget`. FR-017 says "exceeds", so equality is **not** over budget.
- **RLS flows through the view.** Because the view runs as the caller, a Supervisor sees only their own projects' rows (ownership policies), an Admin sees all, and an Employee sees nothing: they have no project policy, and no `bonus_settings` policy either ([bonus_rules_config.sql:108-159](../../../supabase/migrations/20260926120000_bonus_rules_config.sql)). **Do not** make the view or the function `security definer`: that would bypass RLS, which the `CLAUDE.md` RLS rules forbid.
- **Read path.** The Astro page selects from the view like a table (`supabase.from("project_budget_exposure")`), converting numerics with `Number()` for display only (`bonus-config.ts:241` pattern). TS does no money arithmetic, so the integer-grosze note in the money follow-up applies only if that changes.
- **Informational only.** The PRD makes FR-017 a flag, not a block (Part 1). The view must not become a CHECK or trigger that rejects saves.
- **pgTAP cases**, in addition to the ownership cases (fixture range `…03xx`):
  - rounding down to the grosz, e.g. `target_pool = 10.01`, `multiplier_max = 1.30` → `13.013` → reserved `13.01`;
  - the sum across several milestones;
  - a project with no milestones → `reserved_total = 0`;
  - `over_budget` false when equal to the budget, true at 0.01 PLN over;
  - updating `bonus_settings.multiplier_max` inside the test transaction changes `reserved_total` on the next read, showing it is computed at read time and not stored;
  - a second Supervisor and an Employee get 0 rows from the view.

## Follow-up: Admin writes and reassignment (2026-09-27)

**User decision:** an Admin can create, edit and reassign projects, i.e. change `supervisor_id` to another Supervisor.

**What this changes in the ownership follow-up:** the rule "the owner cannot hand the project to another user" still applies to Supervisors. Reassignment becomes an Admin-only operation. `on delete restrict` on `supervisor_id` now has a clear workflow: an Admin reassigns the projects, and then the user can be deleted.

**Implementation consequences for `/10x-plan`:**

- **Policies.** Add Admin policies next to the Supervisor ones, one per operation per role (`contract-surfaces.md:29`):
  - `projects_insert_admin`: `with check ((select public.is_admin()))`.
  - `projects_update_admin`: `using` and `with check` both `(select public.is_admin())`.
  - ~~Matching `milestones_insert_admin` and `milestones_update_admin`.~~ **Superseded 2026-09-27:** Admins cannot edit milestones; see "Follow-up: final plan-level choices".
  - Delete stays absent for both roles unless the plan decides otherwise.
- **The owner must actually be a Supervisor.** Neither a policy nor a CHECK constraint enforces this today:
  - An Admin could assign a project to an Employee, or to another Admin.
  - A CHECK constraint cannot look at `profiles`.
  - Policies must not sub-select `profiles` inline (`contract-surfaces.md:28`).

  Options:
  - (a) A `before insert or update of supervisor_id` trigger that raises unless the referenced profile has `role = 'supervisor'`. The trigger function is `security definer` with `set search_path = ''`, like `handle_new_user()` ([role_and_rls_scaffold.sql:28-41](../../../supabase/migrations/20260925120000_role_and_rls_scaffold.sql)). This covers both roles' write paths and any future one.
  - (b) A `security definer` helper, e.g. `public.is_supervisor_profile(uuid)`, called from the Admin `with check` clauses.

  (a) is the stronger guarantee. Map the raised error to its own code in `mapPostgrestError` (`bonus-config.ts:219-225`) rather than letting it fall through to `save_failed`.

- **Later role changes.** If an Admin changes an owning Supervisor's role, their projects keep a non-supervisor `supervisor_id`. That user loses access at once, because the Supervisor policies also require `is_supervisor()`, and the projects become reachable only by Admins until reassigned. Blocking the role change while projects are owned is a possible guard; flag it as a plan choice, not a requirement.
- **Admin project form.**
  - `supervisor_id` defaults to `auth.uid()`. An Admin-created project would then be owned by the Admin, and the trigger in (a) would reject it. So the Admin form must send `supervisor_id` explicitly: a select list of profiles with `role = 'supervisor'`, which Admins can already read ([role_and_rls_scaffold.sql:110-114](../../../supabase/migrations/20260925120000_role_and_rls_scaffold.sql)).
  - The zod schema needs `supervisor_id: z.uuid()` on the Admin path only.
  - On the Supervisor path the field must not be accepted from the form. The column default and the `with check` policy make a sent value harmless anyway.
- **Routes.** Either the supervisor pages also let Admins in (the middleware role check allows `supervisor` or `admin`), or Admins get their own pages under `/admin/projects`, which `ADMIN_ROUTES` already covers ([middleware.ts:6](../../../src/middleware.ts)). Shared pages with a role-dependent owner field avoid duplicating forms. Pick one in the plan.
- **Effect of reassignment on milestones and exposure.** Milestone access follows the parent project (the ownership follow-up), so reassigning a project moves all its milestones to the new owner, and moves its `project_budget_exposure` row with it, with no data migration. Audit fields show who did it (`updated_by = auth.uid()` via the audit trigger).
- **Extra pgTAP cases:**
  - an Admin inserts a project for Supervisor B → B can select it;
  - an Admin reassigns A → B → A gets 0 rows, B sees the project and its milestones and exposure;
  - an Admin assigning a project to an Employee → raises;
  - a Supervisor trying to reassign their own project → 0 rows updated, or a `with check` violation.

## Follow-up: milestone statuses (2026-09-27)

**User decision** (accepting the recommendation):

1. A `cancelled` milestone reserves nothing in the FR-017 budget check. Every other status reserves `money_floor_mul(target_pool, multiplier_max)`.
2. `approved` is **not** part of S-02. S-05 adds it, together with the stored `payout_pool` column and the view change, because S-02 has no way to reach that status correctly. Approval computes and freezes results and triggers the email (FR-018).

**Worked example (the basis of the decision).** Budget 10 000.00 PLN, `multiplier_max` 1.30.

- M1 `active`, target 3 000.00, reserves 3 900.00.
- M2 `active`, target 3 000.00, reserves 3 900.00.
- M3 `cancelled`, target 2 000.00, reserves 0.
- `reserved_total` = 7 800.00, so the project is not over budget. If M3 were counted, the total would be 10 400.00: a false over-budget flag for a milestone that will never pay out.

**Implementation consequences for `/10x-plan`:**

- **Status set for S-02.** The plan picks the exact labels. A suggested set is `planned`, `active`, `completed`, `cancelled`, with default `planned`. The only rule the check depends on is "`cancelled` is excluded". Write the view filter as `status <> 'cancelled'`, not as a list of statuses to include. Then a status S-05 adds later (`approved`) is not silently dropped from the check; S-05 replaces its per-milestone amount with `payout_pool`.
- **Make the list easy for S-05 to extend.** Either:
  - a Postgres enum: S-05 runs `alter type … add value 'approved'`. The new value cannot be used in the same transaction that adds it, so S-05 must put the view change that references it in a later migration file;
  - or `text` plus a named CHECK constraint: S-05 drops and re-creates the constraint in one migration.

  Either works. The CHECK route avoids the transaction caveat.

- **Cancelling and un-cancelling.** A Supervisor (or Admin) can move a milestone into and out of `cancelled` with an ordinary update. The check is computed at read time, so the reservation disappears and reappears on the next read, with nothing stored to update.
- **Status transitions are not enforced in S-02.** No PRD FR restricts transitions among these four. Keep status a free choice in S-02; S-05 adds the rule that an `approved` milestone is frozen.
- **Extra pgTAP cases:**
  - a cancelled milestone contributes 0 to `reserved_total`;
  - un-cancelling it restores the reservation on the next read;
  - a project whose only milestone is cancelled → `reserved_total = 0`, `over_budget = false`.

With this, all open questions that affect the budget algorithm are settled. The remaining items are plan-level choices listed in the Admin follow-up: whether Admins may edit milestones, shared vs separate Admin pages, and whether to block a role change for a Supervisor who owns projects.

## Follow-up: final plan-level choices (2026-09-27)

**User decisions:**

1. **Admins cannot edit milestones.** Admins can create, edit and reassign **projects**, but only **read** milestones. This supersedes the `milestones_insert_admin` / `milestones_update_admin` suggestion in "Follow-up: Admin writes and reassignment".
2. **Shared pages.** Supervisors and Admins use the same project pages; there is no separate `/admin/projects`.
3. **Block role changes for owning Supervisors.** A Supervisor who still owns at least one project cannot have their role changed until their projects are reassigned.

**Implementation consequences for `/10x-plan`:**

- **Milestone policies.**
  - `milestones_select_admin`: `using ((select public.is_admin()))`.
  - Insert and update: owner-only (the ownership follow-up predicate).
  - No Admin insert, update or delete policy, with a header comment saying the absence is deliberate (convention at [bonus_rules_config.sql:108-116](../../../supabase/migrations/20260926120000_bonus_rules_config.sql)).
  - Under RLS an Admin milestone insert raises `42501`, and an Admin update affects 0 rows. The pgTAP suite asserts both.
  - Consequence: to change milestones on a project, an Admin reassigns the project to a Supervisor who then edits them. Reassignment moves milestone access along with the project.
- **Shared pages and routes.**
  - Add the new prefixes (e.g. `/projects`, `/api/projects`) to `PROTECTED_ROUTES`, plus a new list such as `PROJECT_ROUTES` whose guard allows `role in ('supervisor', 'admin')`. Keep the same 503 (`profileError`) and 403 behaviour as `ADMIN_ROUTES` ([src/middleware.ts:5-6,49-56](../../../src/middleware.ts)).
  - The project form branches on `locals.profile.role`:
    - An Admin sees a required owner select, listing profiles with `role = 'supervisor'`. Admins can read every profile ([role_and_rls_scaffold.sql:110-114](../../../supabase/migrations/20260925120000_role_and_rls_scaffold.sql)).
    - A Supervisor sees no owner field.
  - The API route uses two zod schemas: the Admin schema requires `supervisor_id: z.uuid()`; the Supervisor schema has no such field, so the column default `auth.uid()` applies.
  - Milestone pages: for an Admin, the page hides milestone create and edit controls. Milestone write routes (e.g. `/api/projects/[id]/milestones…`) return 403 for Admins **before** calling Supabase, so the Admin sees a clear message rather than a generic `save_failed` from an RLS denial. RLS stays the real enforcement; the route check is UX.
  - The budget-exposure display is the same for both roles, because the `security_invoker` view already scopes the rows.
- **Role-change block (decision 3).**
  - No app code changes roles today. In the inspected `src/`, the only `from("profiles")` call is the middleware read ([src/middleware.ts:25-29](../../../src/middleware.ts)). Roles are changed outside the app (Supabase Studio or SQL, often as a role that bypasses RLS). So the block **must** be a database trigger: triggers fire even when RLS is bypassed, while policies and app checks would not.
  - Suggested shape: a `before update of role on public.profiles` trigger. It raises when `old.role = 'supervisor'`, `new.role is distinct from old.role`, and `exists (select 1 from public.projects where supervisor_id = old.id)`. Use `security definer` with `set search_path = ''` (same style as `handle_new_user()`, [role_and_rls_scaffold.sql:28-41](../../../supabase/migrations/20260925120000_role_and_rls_scaffold.sql)), so the existence check sees every project regardless of the caller's RLS. Revoke execute from `public`, `anon` and `authenticated`.
  - Use a clear message, e.g. "Supervisor still owns N project(s); reassign them first", and a dedicated SQLSTATE or `errcode`, so a future role-management UI can map it.
  - This trigger lives on `profiles` (an F-01 table) but belongs in S-02's migration, because it references `projects`. Record it in `docs/reference/contract-surfaces.md`.
  - Together with the ownership trigger from the Admin follow-up, this guarantees `projects.supervisor_id` always points to a current Supervisor. The earlier caveat, "a demoted owner's projects become Admin-only until reassigned", no longer applies.
- **Extra pgTAP cases:**
  - an Admin selects milestones of any project;
  - an Admin milestone insert → `42501`;
  - an Admin milestone update → 0 rows;
  - changing the role of a Supervisor who owns a project → raises;
  - after reassigning their projects, the same role change succeeds;
  - changing the role of a Supervisor with no projects → succeeds;
  - an unrelated profile update (e.g. `display_name`) of an owning Supervisor → succeeds.

**Status:** every open question in this research is now decided by the user. Nothing remains that blocks `/10x-plan`.
