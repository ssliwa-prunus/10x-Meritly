---
date: 2026-10-05T20:19:54+02:00
researcher: Claude (Opus 5.5) for ssliwa
git_commit: a5733f5c2026e9596900c3f1a06bdc31b2849201
branch: develop
repository: ssliwa-prunus/10x-Meritly
topic: "S-05: what the codebase provides and requires for milestone approval, frozen results, employee visibility and approval email"
tags: [research, codebase, s-05, approval, rls, snapshot, email, milestones, payouts]
status: complete
last_updated: 2026-10-05
last_updated_by: Claude (Opus 5.5)
---

# Research: S-05, Supervisor approves milestone and employee sees bonus

**Date**: 2026-10-05T20:19:54+02:00
**Researcher**: Claude (Opus 5.5) for ssliwa
**Git Commit**: a5733f5c2026e9596900c3f1a06bdc31b2849201
**Branch**: develop
**Repository**: ssliwa-prunus/10x-Meritly

## Research Question

Roadmap slice S-05 (`supervisor-approves-milestone-employee-sees-bonus`; FR-012, FR-016, FR-018, US-01): what does the current codebase provide, what does it lack, and which prior obligations and constraints bind it? Four areas:

- the data layer: status, snapshot, freezing, RLS and the budget view;
- the app layer: routes, services, pages and middleware;
- email delivery;
- recorded decisions and deferrals.

## Summary

- **Nothing about approval exists yet.**
  - `milestones.status` allows `planned/active/completed/cancelled` only (`supabase/migrations/20260927120000_projects_and_milestones.sql:83`).
  - Payouts are recomputed from live config on every read by four security-invoker SQL functions. Nothing is stored (`20261004120000_milestone_kpi_and_payouts.sql:30-34`).
  - No employee `select` policy exists on any table except the employee's own `profiles` row (`20260925120000_role_and_rls_scaffold.sql:98-102`).
  - There is no employee-facing page (`src/middleware.ts:20` returns 403 to employees on `/projects` and `/employees`).
  - No code anywhere can send a transactional email.
- **Snapshot is an explicit, multiply-recorded obligation.** S-05 must persist, at approval:
  - M, `multiplier_max`, the payout pool, and each line's role weight, rating factor and bonus (`docs/reference/contract-surfaces.md:107-111`; `20261004130000_milestone_payout_hard_cap.sql:19-21`);
  - the summary and the lines, computed **in one statement**, never two independent RPCs (`context/archive/2026-10-04-supervisor-scores-milestone-and-sees-computed-bonuses/follow-ups/review-fixes.md:5-13`). Today `getMilestonePayout` uses two parallel RPCs (`src/lib/services/payouts.ts:241-265`).
- **The live functions cannot serve employees.**
  - They are security invoker and read `bonus_settings` and `job_roles`, which employees cannot select.
  - With milestone visibility, `milestone_payout_lines` would raise (`20261004130000_milestone_payout_hard_cap.sql:83-98`).
  - Employee reads must therefore come from stored snapshot rows, gated by "own employee row AND parent milestone approved" (`CLAUDE.md` RLS rules).
  - The link from a login to an employee is `employees.profile_id = auth.uid()`, unique (`20260929120000_employees_and_engagements.sql:30-46`).
  - No helper resolves it yet.
- **Freezing is not enforced anywhere today.**
  - Status transitions are unguarded in every direction.
  - `target_pool`, the KPI scores and the engagements stay editable on `completed` milestones. Only MR003 (closed project), MR007 (completed/cancelled milestone, engagements only) and MR013 (cancelled milestone, scores only) apply.
  - Three "open milestone" filters use `not in ('completed','cancelled')` and would treat `approved` as open: MR007 at `20260929120000_employees_and_engagements.sql:287`, MR008 at `:218`, and `employee_time_share_totals` at `:482`. MR012 (`20260930120000_projects_guard_engaged_owner_change.sql:30`) uses the same filter. The S-03 header says S-05 must revisit this (`20260929120000_employees_and_engagements.sql:19-20`).
  - The live payout path also reads an employee's _current_ `job_role_id`, so a role reassignment would change a completed milestone's figures.
- **The budget view needs one swap.** `project_budget_exposure` reserves `target_pool` for every milestone with `status <> 'cancelled'` (`20261004130000_milestone_payout_hard_cap.sql:232-249`). S-05 must count Approved milestones at their stored payout pool (FR-017, `context/foundation/prd.md:116`).
- **Email is fully open.**
  - Resend exists only as Supabase Auth's SMTP relay, set up for invites. The production verification items for that setup are unchecked (`context/archive/2026-09-29-supervisor-assigns-employee-engagement/plan.md:748-750`).
  - `context/foundation/infrastructure.md` warns that Workers Free allows 50 subrequests per request (`:61`). It recommends: a batch API or Supabase-side sending; an idempotent approval kept separate from sending (`:91`); HTTP, not SMTP, from the Worker (`:98`); and logging approval events without figures (`:94`).
  - CI starts Supabase with `mailpit` and `edge-runtime` excluded (`.github/workflows/ci.yml:42`).
- **Unresolved product choices** (see Open Questions):
  - whether approval is a status value or a separate flag;
  - un-approve and correction;
  - whether `approved` counts toward time share;
  - the email mechanism and its content;
  - the employee route name;
  - whether the employee sees a breakdown.

## Detailed Findings

### 1. Milestones: schema, triggers, and what an `approved` state collides with

**Columns**

- `id`, `project_id`, `name`, `start_date`, `end_date`, `status` (text, default `planned`), `target_pool numeric(12,2) > 0`, `notes`, and the audit columns (`20260927120000_projects_and_milestones.sql:68-86`).
- `kpi_schedule`, `kpi_budget`, `kpi_quality`, `kpi_risk`: smallint, 0–100, all four or none (`20261004120000_milestone_kpi_and_payouts.sql:44-55`).
- There are no approval or snapshot columns.

**Status constraint**

- The values come from a text CHECK, `milestones_status_valid` (`20260927120000_projects_and_milestones.sql:83`).
- S-02 research recorded that S-05 drops and re-creates this constraint. It also noted that an enum would force the view change into a later migration (`context/archive/2026-09-27-supervisor-creates-project-and-milestones/research.md:313-315`).

**Grants**

- `authenticated` keeps table-level UPDATE on all milestone columns (`20260927120000_projects_and_milestones.sql:93-94`; `20261004120000_milestone_kpi_and_payouts.sql:42`).
- Admins have select-only policies (`:335-345`).

**Triggers in effect**

- `milestones_check_parent` (`20260927130000_milestones_guard_ownership.sql:7-46`):
  - MR006 when `project_id` changes;
  - 42501 when the caller does not own the project;
  - MR003 when the project is completed or cancelled;
  - MR002 when the period falls outside the project's.
- `milestones_check_scores` (`20261004120000_milestone_kpi_and_payouts.sql:64-98`): ownership, then MR013 for score changes while the milestone is `cancelled`.
- `milestones_set_audit_fields`.

**Not guarded today**

- Any status transition, including reopening a milestone. S-02 research recorded "S-05 adds the rule that an `approved` milestone is frozen" (`…/2026-09-27-…/research.md:320`).
- Edits to `target_pool`, the dates and the KPI scores on `completed` milestones.

**Exclusion filters that would read `approved` as open**

| Site                            | Location                                                    | Filter                                     |
| ------------------------------- | ----------------------------------------------------------- | ------------------------------------------ |
| MR007, engagement parent closed | `20260929120000_employees_and_engagements.sql:287`          | closes only on `('completed','cancelled')` |
| MR008, employee owner change    | `20260929120000_employees_and_engagements.sql:218`          | `not in ('completed','cancelled')`         |
| MR012                           | `20260930120000_projects_guard_engaged_owner_change.sql:30` | `not in ('completed','cancelled')`         |
| `employee_time_share_totals`    | `20260929120000_employees_and_engagements.sql:482`          | `not in ('completed','cancelled')`         |
| `project_budget_exposure`       | `20261004130000_milestone_payout_hard_cap.sql:245`          | `<> 'cancelled'`                           |

`projects_check_period` (`20260927120000_projects_and_milestones.sql:224-228`) counts milestones of every status.

### 2. Payout computation: what must be snapshotted

All four functions are stable and security invoker (`20261004120000_milestone_kpi_and_payouts.sql`, superseded where noted by `20261004130000_milestone_payout_hard_cap.sql`).

**`kpi_multiplier(smallint×4)`** (KPI:105-131)

- Reads the four KPI weights, `multiplier_min` and `multiplier_max` from `bonus_settings`.
- Returns null when a score is null or the config is not visible.

**`capped_payout_pool(target, M)`** (CAP:28-42)

- Computes `div(target·100·M·1e6, multiplier_max·100·1e4)·0.01`, i.e. `floor(target·M/max)`.

**`milestone_payout_lines(uuid)`** (CAP:48-159)

- Returns: `engagement_id`, `employee_id`, `employee_name`, `job_role_name`, `time_share`, `role_weight`, `rating`, `rating_factor`, `weighted_contribution`, `share`, `bonus`.
- Reads `employees.job_role_id` live, `job_roles.weight` and `job_roles.name`, and `bonus_settings.rating_factor_1..5`.
- Splits in integer grosze.
- Raises when the config or a role weight is not visible (CAP:83-98).

**`milestone_payout_summary(uuid)`** (CAP:169-222)

- Returns: `milestone_id`, `target_pool`, the four scores, `scored`, `multiplier`, `budget_share`, `payout_pool`, `payout_total`, `residual`, `within_pool`, `engagement_count`.
- It calls `milestone_payout_lines` internally.

**Inputs that change an unapproved milestone's figures after the fact.** Nothing is stored, so editing any of these changes the computed figures:

- KPI weights, `multiplier_min`/`multiplier_max`, `rating_factor_1..5`, `job_roles.weight`;
- an employee's `job_role_id`;
- display names;
- the milestone's `target_pool` or KPI scores;
- engagements.

`bonus_settings` is a single row and `job_roles` has no versioning (`20260926120000_bonus_rules_config.sql:8-9`).

**Snapshot obligations as recorded**

- Config snapshot rule (`docs/reference/contract-surfaces.md:107-111`): persist the role weight, rating factor, M, `multiplier_max` and bonus.
- `20261004120000_milestone_kpi_and_payouts.sql:30-34`: persist the multiplier, the payout pool, and each line's role weight, rating factor and bonus.
- `review-fixes.md:5-13`:
  - compute the summary totals and every line in one statement, and persist exactly those figures;
  - also store the payout pool for the budget view;
  - optionally move the Draft page to the same single-RPC shape.

`money_floor_mul` (`20260927120000_projects_and_milestones.sql:20-30`) is no longer called on the payout path.

### 3. Employees, engagements, and the RLS surface

**Login link**

- `employees.profile_id` is a unique FK to `profiles.id`, which is `auth.users.id` (`20260929120000_employees_and_engagements.sql:30-46`).
- It is written only by the `invite-employee` function, using the secret key (`supabase/functions/invite-employee/index.ts:96-108`).
- It is not client-writable (column grants, `20260929120000_employees_and_engagements.sql:59-61`).
- No email-based mapping exists.

**Engagements**

- Columns: `milestone_id`, `employee_id`, `time_share numeric(3,2)` in (0,1], `rating` 1–5 (EE:67-79).
- Insert, update and delete belong to the owning Supervisor only (EE:447-464).
- The guard trigger raises MR007 on completed/cancelled parents (EE:241-308).
- S-03 recorded: "S-05 must also block assignment deletes on approved milestones" (`context/archive/2026-09-29-supervisor-assigns-employee-engagement/plan.md:76`).

**Helpers**

- `current_app_role`, `is_admin`, `is_supervisor`, `owns_project`, `owns_milestone` and `employee_engaged_on_own_milestone` are security definer with `search_path=''`. Execute is granted to `authenticated` only (S01:52-80, PM:100-118, EE:110-153).
- No helper resolves the caller's own `employees.id`.

**Policies.** Every policy is `to authenticated`, one per operation, none `for all`. Employee coverage today:

- `profiles_select_own` (S01:98-102) only.
- No employee policies on `projects`, `milestones`, `employees`, `milestone_engagements`, `job_roles` or `bonus_settings`.
- "Deliberately absent" comments defer employee access to S-05/S-06 (EE:380, EE:428-433; `…/2026-09-27-…/plan.md:68`).

**Conventions for new tables and policies** (`contract-surfaces.md`, Policy conventions):

- enable RLS in the creating migration;
- `revoke all … from anon`;
- `revoke truncate, references, trigger … from authenticated`;
- column-level grants for system-written columns;
- helpers wrapped as `(select public.fn())`;
- pgTAP tests in `supabase/tests/`, which currently holds 5 files: `bonus_config_rls`, `employees_rls`, `milestone_payouts`, `profiles_rls`, `projects_rls`;
- MR014 is the next free SQLSTATE;
- the 42501 ownership check runs before any MR guard.

**Budget view.** `project_budget_exposure` (CAP:232-249) is `security_invoker = true`, sums `target_pool` where `status <> 'cancelled'`, and returns no rows to employees.

**Privacy precedent.** `…/2026-09-29-…/research.md:255` notes that email confirmation is disabled. Someone could claim a pre-registered employee account and then see that employee's Approved bonuses. This is relevant now that Approved figures become visible.

### 4. App layer: routes, services, pages

**Milestone page** (`src/pages/projects/[id]/milestones/[milestoneId].astro`)

- Loads project, milestones (picked with `.find()`, :72-73), engagements, assignable employees and `getMilestonePayout` in one `Promise.all` (:55-62).
- Role gate: `isAdmin` (:21).
- Edit gates:
  - `canEdit = !isAdmin && !isClosed`, where closed means completed or cancelled (:79-82);
  - `kpiReadOnlyReason` covers admin, a cancelled milestone and a closed project (:86-92). A `completed` milestone stays scorable (:84).
- Sections:
  - details card, with status as plain text (:148-176);
  - `KpiScoresSection` (:178-188);
  - `PayoutSection summary lines` (:189);
  - assignments (:207-359).
- Payout errors render locally in the bonuses card (:190-205).
- `PayoutSection.astro:51` already reads "Draft figures; employees do not see them until the milestone is approved."

**Status editing.** Status changes only through the full milestone edit form (`src/components/projects/MilestoneForm.astro:48-52`, `NativeSelect` over `WORK_STATUSES`). That form posts to `src/pages/api/projects/[id]/milestones/[milestoneId].ts`. `milestoneInputSchema` includes `status` (`src/lib/services/projects.ts:147-156`). Any new `approved` value must be kept out of, or deliberately handled by, this generic form.

**Route template for a new action**

- `src/pages/api/projects/[id]/milestones/[milestoneId]/kpi.ts`, a `POST` that runs in this order:
  1. `createClient`, or `not_configured`;
  2. `projectIdSchema` on both ids;
  3. admin early exit (`admin_read_only`; "RLS is the real enforcement");
  4. `parseForm`;
  5. the service call;
  6. a redirect through `kpiUrl` with a code.
- Engagement routes add `isMilestoneInProject` before writing (`src/pages/api/projects/[id]/milestones/[milestoneId]/engagements/index.ts:36-42`).

**Service pattern** (`src/lib/services/payouts.ts`)

- A per-service `*_ERROR_MESSAGES` catalog (:14-25) and a code guard.
- `kpiErrorMessage` with a generic fallback (:46).
- `GUARD_ERROR_CODES` maps MR003 and MR013 (:129-132); `mapPostgrestError` maps 42501 to `not_found` (:134-141).
- Updates use `.update().eq(id).eq(project_id).select("id")`, where zero rows means `not_found` (:220-235).
- Shared helpers: `src/lib/forms.ts` (`parseForm`, `firstIssueError`).

**Types** (`src/types.ts`)

- `WorkStatus` (:37) holds the four values.
- `MilestonePayoutSummary` (:132-148) and `MilestonePayoutLine` (:155-167) are commented as Draft, computed at read time (:125).
- `Employee.profile_id` (:73-82).

**Routing and navigation**

- `PROTECTED_ROUTES` (`src/middleware.ts:7-17`) and `PROJECT_ROUTES` (:20) are matched by prefix with `startsWith` (:24).
- Under prefix matching, an employee page must not start with `/employees` or `/projects`, or employees get a 403.
- `dashboard.astro:5` and `Topbar.astro:3` show navigation only to supervisors and admins.

**UI guards and tests**

- `scripts/check-ui-literals.mjs:9-21` lists `[milestoneId].astro`, `PayoutSection.astro` and `MilestonesSection.astro` in `CLEAN_PATHS`, among others. `dashboard.astro` and `Topbar.astro` are not listed and still use palette classes.
- The kitchen sink (`src/pages/dev/projects-kitchen-sink.astro`) has 3 `PayoutSection` states at :417-425: unscored, scored, no engagements.
- `scripts/smoke.mjs:39-59` covers 8 auth steps only.

### 5. Email delivery

**Existing mail path**

- The only path is `supabase/functions/invite-employee/index.ts`:
  - `withSupabase({ auth: "user" })` (:44), with `verify_jwt = true` (`supabase/config.toml:373-374`);
  - a role check through the `current_app_role` RPC (:51-56);
  - an RLS-visible load, plus a Supervisor-owner check returning 404 (:59-71);
  - `supabaseAdmin.auth.admin.inviteUserByEmail` (:75-78);
  - `{ code }` error bodies (:1-16, :79-94).
- The app calls it through `supabase.functions.invoke`, with `FunctionsHttpError` mapping in `src/lib/services/employees.ts:273-309`.
- Supabase Auth sends only auth emails, so it cannot carry a bonus email.

**Provider status**

- Resend is configured as Auth SMTP (`smtp.resend.com:465`) per the archived S-03 plan (`plan.md:554, 600-601`). That plan scoped out approval email (`plan.md:83`).
- Production verification items 5.4–5.6 are unchecked (`plan.md:748-750`).
- `[auth.email.smtp]` is commented out in `supabase/config.toml:219-227`.
- `tech-stack.md` says nothing about email.

**Infrastructure guidance** (`context/foundation/infrastructure.md`)

- Workers Free allows 50 subrequests per request (:61, with the pre-mortem at :67).
- Mitigations (:91): a batch email API or a Supabase-side queue or function; an idempotent approval transition kept separate from sending; or Workers Paid.
- Log approval events with the milestone id and counts, never figures (:94).
- Use HTTP, not SMTP, from the Worker (:98).

**Local and CI**

- Mailpit's web UI is on port 54324. Its SMTP port 54325 is commented out (`supabase/config.toml:104`).
- An HTTP provider has no local sink.
- CI excludes `mailpit` and `edge-runtime` (`.github/workflows/ci.yml:42`) but runs `supabase test db` (:45).

**Required content.** FR-016 requires only "their computed bonus for a milestone" (`prd.md:114`), sent to the affected employee only. No template, breakdown or link is specified.

## Code References

- `supabase/migrations/20260927120000_projects_and_milestones.sql:83`: `milestones_status_valid` CHECK
- `supabase/migrations/20260927130000_milestones_guard_ownership.sql:7-46`: `milestones_check_parent` (MR006, 42501, MR003, MR002)
- `supabase/migrations/20261004120000_milestone_kpi_and_payouts.sql:30-34`: Draft-only header, S-05 snapshot obligation
- `supabase/migrations/20261004120000_milestone_kpi_and_payouts.sql:64-98`: `milestones_check_scores` (MR013)
- `supabase/migrations/20261004130000_milestone_payout_hard_cap.sql:19-21`: snapshot `multiplier_max`; swap the stored pool into exposure
- `supabase/migrations/20261004130000_milestone_payout_hard_cap.sql:48-159`, `:169-222`, `:232-249`: lines, summary, exposure view
- `supabase/migrations/20260929120000_employees_and_engagements.sql:19-20`: "S-05 must revisit" the open definition
- `supabase/migrations/20260929120000_employees_and_engagements.sql:218`, `:287`, `:482`: MR008, MR007, time-share totals filters
- `supabase/migrations/20260930120000_projects_guard_engaged_owner_change.sql:30`: MR012 filter
- `supabase/migrations/20260926120000_bonus_rules_config.sql:8-9`: config not versioned, later slices snapshot
- `docs/reference/contract-surfaces.md:107-111`: Config snapshot rule
- `src/lib/services/payouts.ts:241-265`: `getMilestonePayout` (two parallel RPCs)
- `src/pages/projects/[id]/milestones/[milestoneId].astro:79-93`: edit gates
- `src/pages/api/projects/[id]/milestones/[milestoneId]/kpi.ts`: route template
- `src/components/projects/MilestoneForm.astro:48-52`: generic status select
- `src/middleware.ts:7-24`: route arrays, prefix matching
- `src/types.ts:37`, `:125-167`: `WorkStatus`, Draft payout types
- `supabase/functions/invite-employee/index.ts:44-108`: privileged Edge Function pattern
- `context/foundation/infrastructure.md:61`, `:91`, `:94`, `:98`: fan-out limit and email guidance

## Architecture Insights

- **The database is the enforcement layer.** Every rule lives in triggers or RLS; app validation only gives readable messages. Guard SQLSTATEs follow the `MRnnn` pattern and map to fixed catalog codes. URLs carry codes, never free text.
- **Exclusion filters are deliberate.** "Open" is written as `not in (...)` so a new status is never silently dropped. That makes every filter a review point when `approved` is added.
- **Privileged work happens in Supabase.** The Worker has only the public key. Secret-key operations run in an Edge Function called with the user's JWT, which re-checks role and ownership through RLS before acting.
- **Two read paths will coexist.** Draft milestones keep the live security-invoker functions (Supervisor and Admin). Approved milestones read stored rows, which are also the only thing employees may read. The UI and types must treat these as distinct shapes or a shared DTO.
- **Every snapshot obligation lands on one statement.** The S-04 review requires approval to compute and persist the summary and lines atomically. That suggests a single database-side operation, a function or a transaction in one RPC, rather than app-side orchestration of several calls.

## Historical Context (from prior changes)

| Source                                                                                                             | Recorded claim                                                                                                                                   | Verdict at HEAD                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `context/archive/2026-09-27-supervisor-creates-project-and-milestones/research.md:184,301`; `plan.md:67`           | `approved` status, stored `payout_pool` and the view change are deferred to S-05; "Approval computes and freezes results and triggers the email" | Still unimplemented, supported                                                                                                                                                                  |
| Same, `research.md:320`                                                                                            | Status transitions are not enforced; S-05 adds the frozen rule                                                                                   | Supported                                                                                                                                                                                       |
| `context/archive/2026-09-29-supervisor-assigns-employee-engagement/research.md:296-297`                            | Whether `approved` counts toward time share is unruled                                                                                           | Still open                                                                                                                                                                                      |
| Same, `plan.md:76`                                                                                                 | S-05 must block engagement deletes on approved milestones                                                                                        | Supported: MR007 does not cover `approved`                                                                                                                                                      |
| Same, `research.md:240`                                                                                            | Production SMTP is not configured; FR-016 needs it                                                                                               | Partial. Resend SMTP was set up later in the S-03 plan (`plan.md:554`), but production verification is unchecked (`plan.md:748-750`). Locally it is still commented out (`config.toml:219-227`) |
| `context/archive/2026-10-04-supervisor-scores-milestone-and-sees-computed-bonuses/follow-ups/review-fixes.md:5-13` | Single-statement snapshot is a hard requirement                                                                                                  | Supported: two RPCs today (`payouts.ts:241-265`)                                                                                                                                                |
| S-04 `plan.md` amendment (2026-10-04)                                                                              | The pool depends on `multiplier_max`, so it is snapshotted                                                                                       | Supported (`CAP:19-21`)                                                                                                                                                                         |
| `context/archive/2026-09-29-…/follow-ups/review-fixes.md:3` (unchecked)                                            | Reopening a completed or cancelled milestone is unguarded                                                                                        | Supported. Relevant if un-approve is allowed                                                                                                                                                    |

## Related Research

- `context/archive/2026-09-27-supervisor-creates-project-and-milestones/research.md`
- `context/archive/2026-09-29-supervisor-assigns-employee-engagement/research.md`
- S-04 has no `research.md`. Its decisions are in `context/archive/2026-10-04-supervisor-scores-milestone-and-sees-computed-bonuses/plan.md` and `reviews/impl-review.md`.

## Open Questions

These are product and design choices for `/10x-plan`. The codebase does not settle them.

1. **How to model approval.**
   - **Status value:** add `approved` to `milestones_status_valid`. This is the S-02 plan's assumption, and it requires revisiting the five exclusion filters in Detailed Findings §1.
   - **Orthogonal flag:** `approved_at`/`approved_by`, keeping `status` for the work lifecycle.
   - Either way an approved milestone must be frozen. Under the status option, a generic edit form still offers status changes (`MilestoneForm.astro:48-52`).
2. **Which states may be approved.** Only `completed`? Must the milestone be scored with at least one engagement? What about `within_pool`?
3. **Un-approve and correction.** The PRD is silent. Options: irreversible; Admin-only revoke; or revoke with a re-snapshot and re-send. This interacts with the unguarded-reopen follow-up.
4. **Time share.** Does an `approved` milestone count toward `employee_time_share_totals` (FR-011)? The S-03 research records this as unruled.
5. **What the snapshot holds.** Beyond the mandatory figures, should it store display names (employee, job role, project, milestone) so history is immune to renames? S-06 history will read these rows.
6. **Email mechanism.** Choose among:
   - an Edge Function using the Resend HTTP API;
   - a database-side queue plus a function;
   - sending from the Worker.

   Also decide: idempotency and a per-recipient sent marker; behaviour when an employee has no `profile_id`, isn't activated, or has no usable email; local capture (Mailpit SMTP vs a dev log sink); whether production Resend verification must finish first; and the sender address and template.

7. **The employee page.** Route name: outside `/employees` and `/projects`, e.g. `/my-bonuses`. Contents: the bonus only, or the breakdown (time share, role weight, factor, M), as S-02 research suggested at `…/2026-09-27-…/research.md:79`. This overlaps with S-06 history, so decide whether S-05 builds the page that S-06 extends.
8. **The privacy gap.** With email confirmation disabled, a pre-registered employee's account could be claimed. Does approval visibility require the employee to be activated (`activated_at` set), or is this accepted for the MVP?
9. **Draft read path.** Adopt the optional single-RPC shape for Draft too (`review-fixes.md` optional item), so Draft and Approved share one DTO?
