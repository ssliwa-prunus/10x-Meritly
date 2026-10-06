# Supervisor Approves Milestone, Employee Sees Bonus Implementation Plan

## Overview

Roadmap S-05 (FR-012, FR-016, FR-018, US-01). A Supervisor approves a scored, staffed milestone, and approval cannot be undone. Approval saves a frozen snapshot of the computed result in a single statement, and from then on the database rejects every change to that milestone. Each affected employee sees only their own Approved result on a new `/my-bonuses` page, enforced by RLS, and receives an email with their bonus. Until approval, results stay Draft and visible only to the Supervisor.

## Current State Analysis

The research is in `context/changes/supervisor-approves-milestone-employee-sees-bonus/research.md`.

- **No approval and no stored results.** `milestones_status_valid` allows only `planned/active/completed/cancelled` (`supabase/migrations/20260927120000_projects_and_milestones.sql:83`). Payouts are recomputed from live config on every read by four security-invoker functions (`supabase/migrations/20261004130000_milestone_payout_hard_cap.sql:28-222`).
- **Nothing is frozen.**
  - Status transitions are unguarded.
  - `target_pool`, the KPI scores and the engagements stay editable on `completed` milestones.
  - Five filters would treat a new status as open: MR007 (`20260929120000_employees_and_engagements.sql:287`), MR008 (`:218`), MR012 (`20260930120000_projects_guard_engaged_owner_change.sql:30`), `employee_time_share_totals` (`20260929120000_employees_and_engagements.sql:482`) and `project_budget_exposure` (`20261004130000_milestone_payout_hard_cap.sql:245`).
- **Employees can read nothing but their own `profiles` row.**
  - The live functions read `bonus_settings` and `job_roles`, which employees cannot see, and would raise for them (`…hard_cap.sql:83-98`).
  - The link from a login to an employee is `employees.profile_id`, unique and written only by `invite-employee`. `activated_at` is stamped when the invite is accepted (`20260929120000_employees_and_engagements.sql:30-46, 351-371`).
- **No transactional email.** The only mail path is Supabase Auth's invite in `supabase/functions/invite-employee/index.ts`. Workers Free allows 50 subrequests per request (`context/foundation/infrastructure.md:61, 91, 98`).
- **App patterns to follow:**
  - Route: `src/pages/api/projects/[id]/milestones/[milestoneId]/kpi.ts`.
  - Section with saved/error/read-only states: `src/components/milestones/KpiScoresSection.astro`.
  - Error catalogs that carry only codes, plus MRxxx mapping: `src/lib/services/payouts.ts:14-141`.
  - pgTAP suites: `supabase/tests/milestone_payouts.test.sql`. Fixture range 06xx is free.

## Desired End State

**Supervisor**

- On a scored milestone with at least one engagement, in any open status (`planned`, `active` or `completed`) of a project that is not closed, the Supervisor ticks "I understand this is final" and clicks Approve.
- The milestone becomes `approved`, and its page shows the frozen figures with an Approved badge.
- KPI scores, assignments and the milestone edit form become read-only. The database rejects any write to them, so a crafted request fails too.
- The project's budget panel counts the milestone at its frozen payout pool.
- Approved milestones drop out of the >100% time-share total.

**Employees**

- Each engaged employee gets an email with their own bonus and a link to `/my-bonuses`.
- Once their account is linked and activated, `/my-bonuses` lists their Approved results with a breakdown.
- Querying anyone else's lines, any milestone header, or any non-approved result returns nothing, whatever IDs are put in the URL or the query.

**Freeze**

- Changing the config later (weights, factors, multiplier bounds), a job role or a name never changes an Approved milestone.

**Verification**

- A new pgTAP suite and the existing suites pass (`npx supabase test db`).
- The seed walkthrough in Testing Strategy works end to end, with the email visible in Mailpit.

### Key Discoveries:

- Stable functions take the snapshot of the query that calls them, and that includes the plpgsql `milestone_payout_lines`. So one data-modifying CTE statement that reads it gives a single consistent snapshot. That meets the S-04 hard requirement (`context/archive/2026-10-04-supervisor-scores-milestone-and-sees-computed-bonuses/follow-ups/review-fixes.md:5-13`).
- Exposing the pool, the payout total, the residual or an employee's `share` would let an employee work out colleagues' bonuses: pool minus own bonus, or own bonus divided by own share. Employee-readable rows must leave these out (CLAUDE.md invariant).
- `share = e_scaled / total_scaled` (`…hard_cap.sql:149`) is the same as `weighted_contribution / Σ weighted_contribution`. The Supervisor view can therefore rebuild it from the stored lines without storing it on employee-readable rows.
- Trigger functions use the next free SQLSTATEs, MR014 and MR015. The 42501 ownership check always runs before any MR guard (`docs/reference/contract-surfaces.md`, Policy conventions).
- `src/middleware.ts:24` matches routes by prefix. An employee page must not start with `/employees` or `/projects`.
- No dialog component exists (`src/components/ui/`). Confirmation uses a required checkbox.
- Resend's `POST /emails/batch` takes up to 100 emails per call and supports `Idempotency-Key` (1–256 chars, 24h). Mailpit has `POST /api/v1/send` (JSON `From`, `To`, `Subject`, `Text`, `HTML`). Both were checked via Context7.

## What We're NOT Doing

- Un-approving or correcting an Approved milestone. Approval is terminal, and a mistake needs an operator fix in the database.
- Employee history across projects, the detail drill-down, and links from the milestone table to an employee (S-06). S-06 extends `/my-bonuses`.
- The aggregate report (S-07).
- Changing the Draft read path. Unapproved milestones keep the live two-RPC `getMilestonePayout`; the optional single-RPC refactor is skipped.
- Employee select policies on `projects`, `milestones`, `employees`, `milestone_engagements`, `job_roles` or `bonus_settings`. Employees read only snapshot lines.
- Automatic email retries. Unsent lines are re-sent manually from the milestone page.
- Automated email tests in CI, which excludes `edge-runtime` and `mailpit` (`.github/workflows/ci.yml:42`). The Edge Function is verified manually.
- A breakdown in the email. It contains project, milestone, period, bonus and link only.
- Migrating `dashboard.astro` or `Topbar.astro` onto tokens. They get the minimal link addition only.

## Implementation Approach

1. **Database first.** One migration adds:
   - the `approved` status and two snapshot tables: a Supervisor/Admin-only header and employee-readable lines;
   - a security-definer `approve_milestone()` that writes the snapshot and flips the status atomically;
   - employee helpers, a freeze guard, revised open/closed filters, and a budget view that uses stored pools.

   Everything is enforced in the database, so app checks only give readable messages.

2. **App flow.** Approve route, snapshot rendering on the milestone page, employee page.
3. **Email last.** A second Edge Function that, like `invite-employee`, holds the secrets inside Supabase. The Worker calls it after approval has committed, so sending is separate from approval and can be retried idempotently through a per-line `notified_at`.

## Critical Implementation Details

**State sequencing in `approve_milestone`:**

1. Lock the milestone row `for update`.
2. Run the checks.
3. Insert the header and lines in **one** CTE statement. The header's totals are aggregated from the same CTE rows that are inserted as lines, never from a second call.
4. Only then update `status` to `approved`.

The freeze trigger allows the move to `approved` only when a header row exists, and never on insert, so neither the generic edit form nor a crafted insert can set it. The trigger must run its own MR006 and ownership checks first, because its name sorts before `milestones_check_parent`.

**Email ordering:**

- Approval commits in its own RPC before the Edge Function is called. An email failure must never roll back or block approval; it shows as "N of M emails sent" with a re-send action.
- `notified_at` is stamped only after the provider confirms a batch.
- The `Idempotency-Key` is derived from the milestone id plus the sorted line ids of that batch, so a retry of the same unsent set cannot double-send within 24h.

**Debug and observability:** the Edge Function logs the milestone id and counts (sent, failed) only, never figures or email addresses (`infrastructure.md:94`).

## Phase 1: Database: approval, snapshot, freeze and RLS

### Overview

Everything S-05 (and S-06/S-07 later) builds on, enforced in the database and covered by pgTAP.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20261005120000_milestone_approval.sql`

**Intent**: Add the `approved` state, the frozen snapshot, the atomic approve operation, employee visibility and the freeze, and adapt every existing open/closed filter. The header comment documents:

- the catalog codes MR014 and MR015;
- the privacy split;
- the one-statement snapshot rule;
- that approval is irreversible.

**Contract**:

- **Status.** Drop and re-create `milestones_status_valid` with `('planned','active','completed','cancelled','approved')`.
- **`public.milestone_results`** (header, one row per approved milestone; Supervisor/Admin only):
  - `milestone_id` (PK, FK to milestones);
  - `project_id`, `project_name`, `milestone_name`, `start_date`, `end_date`;
  - `target_pool`, the four `kpi_*` scores;
  - `multiplier`, `multiplier_min`, `multiplier_max`, `budget_share`;
  - `payout_pool`, `payout_total`, `residual`, `engagement_count`;
  - `approved_at` (default now()), `approved_by` (FK to profiles).
- **`public.milestone_result_lines`** (one row per engagement at approval; employee-readable):
  - `id`, `milestone_id` (FK to the header), `engagement_id`, `employee_id`;
  - snapshot display fields: `employee_name`, `job_role_name`, `project_id`, `project_name`, `milestone_name`, `start_date`, `end_date`, `approved_at`;
  - figures: `time_share`, `role_weight`, `rating`, `rating_factor`, `weighted_contribution`, `multiplier`, `bonus` (not null);
  - `notified_at` (nullable).
  - **It deliberately has no `share`, pool, total or residual.**
  - Unique (`milestone_id`, `employee_id`).
- **Invariant constraints**, so the pool rules hold in the database (CLAUDE.md), not only by construction:
  - Money columns (`target_pool`, `payout_pool`, `payout_total`, `residual`, `bonus`) are `numeric(12,2) not null`.
  - Header CHECKs:
    - `payout_pool >= 0`;
    - `payout_pool <= target_pool`;
    - `payout_total >= 0 and payout_total <= payout_pool`;
    - `residual = payout_pool - payout_total`.
  - Lines CHECK: `bonus >= 0`.
- **Grants and RLS on both tables.**
  - RLS is enabled.
  - `revoke all … from anon`.
  - `revoke insert, update, delete, truncate, references, trigger … from authenticated`.
  - `grant select … to authenticated`.
  - No client write policies. Only `approve_milestone` (security definer) and the Edge Function (secret key) write.
- **Policies, one per role and operation:**
  - `milestone_results_select_supervisor` (`owns_milestone(milestone_id)`) and `_select_admin` (`(select public.is_admin())`). **No employee policy on the header.**
  - `milestone_result_lines_select_supervisor`, `_select_admin`, and `_select_employee`. The employee predicate is `employee_id = (select public.current_employee_id()) and public.is_approved_milestone(milestone_id)`.
- **Helpers.** Security definer, `search_path=''`, execute revoked from public/anon and granted to authenticated:
  - `public.current_employee_id() returns uuid`: the `employees.id` where `profile_id = auth.uid() and activated_at is not null`, else null.
  - `public.is_approved_milestone(uuid) returns boolean`.
- **`public.approve_milestone(p_milestone_id uuid) returns void`.** Security definer, `search_path=''`. In order:
  1. 42501 unless `owns_milestone` (Admins included, since they are read-only).
  2. Lock the milestone `for update`.
  3. MR015 if already `approved`.
  4. MR014 if `cancelled`, unscored, or with zero engagements.
  5. One CTE statement that inserts the header and lines from `milestone_payout_lines(p_milestone_id)`, `kpi_multiplier`, `capped_payout_pool`, `bonus_settings` (min/max) and the project and milestone rows. `payout_total` and `engagement_count` are aggregated from the same line rows.
  6. `update milestones set status = 'approved'`. MR003 (closed project) still fires from `milestones_check_parent` and rolls everything back.
- **Freeze trigger `milestones_check_frozen`.** Before **insert or update**. In order:
  1. On update, MR006 if `project_id` changes. This keeps the existing precedence of `milestones_check_parent`, which now fires after this trigger.
  2. 42501 ownership check, as in `milestones_check_scores` (`auth.uid() is not null and not owns_project(new.project_id)`).
  3. On insert, MR014 `milestone_not_approvable` if `new.status = 'approved'`. A new milestone can never have a snapshot.
  4. On update, MR015 `milestone_approved` if `old.status = 'approved'`.
  5. On update, MR014 if `new.status = 'approved'` and no `milestone_results` row exists.
- **Closed set.** `create or replace` the MR007 (`milestone_engagements_check_parent`), MR008 (`employees_check_rules`) and MR012 functions, plus the `employee_time_share_totals` view (keeping `security_invoker = true`), so that `approved` counts as closed alongside `completed` and `cancelled`.
- **`project_budget_exposure`.** `create or replace`, keeping `security_invoker = true` and the same columns. Left-join `milestone_results`. For non-cancelled milestones, reserve `coalesce(payout_pool, target_pool)` when `status = 'approved'` and `target_pool` otherwise. The coalesce is defence in depth: an approved milestone without a snapshot must never reserve 0.

#### 2. pgTAP suite

**File**: `supabase/tests/milestone_approval.test.sql`

**Intent**: Prove every guarantee and every raise path, using fixture range 06xx and the conventions of `milestone_payouts.test.sql`: the skeleton, impersonation through `request.jwt.claims`, and pinned `bonus_settings`.

**Contract**:

- **Structural:**
  - RLS is enabled on both tables.
  - No insert/update/delete privilege for `authenticated`.
  - `security_invoker` is set on both views.
  - Execute grants on the helpers and on `approve_milestone`.
  - As the owner, header inserts that violate each invariant CHECK (pool above target, total above pool, residual mismatch) raise `23514`.
- **Happy path:**
  - The header and lines equal `milestone_payout_summary` and `milestone_payout_lines` figures taken just before approval.
  - Σ bonus = `payout_total` ≤ `payout_pool`.
  - Status is `approved`.
- **Freeze:**
  - After approval, change `bonus_settings` weights, factors and `multiplier_max`, a job-role weight, the employee's job role and names. The stored figures stay unchanged.
  - Updating the approved milestone's `target_pool`, KPI scores, status or name raises MR015.
  - Inserting, updating or deleting an engagement raises MR007.
  - The generic `update … set status='approved'` raises MR014.
  - A direct `insert` of a milestone with `status = 'approved'` raises MR014.
  - Moving a milestone to a project the caller does not own still raises MR006, as `projects_rls.test.sql:166-172` expects.
- **Raise paths:**
  - MR014 for cancelled, unscored, and no engagements.
  - MR015 for a second approval.
  - MR003 for a closed project.
  - 42501, not MR014/MR015, for another Supervisor and for an Admin.
- **Filters:**
  - The budget view uses `payout_pool` for the approved milestone.
  - The time-share total excludes it.
  - MR008 and MR012 no longer count it as open.
- **Employee visibility:**
  - An activated linked employee sees exactly their own line.
  - They see 0 header rows and 0 lines of a colleague on the same milestone.
  - A line inserted by the owner for a non-approved milestone is invisible to them.
  - A linked employee who is not activated sees 0 rows.
  - Anon gets 42501.

#### 3. Contracts and types

**File**: `docs/reference/contract-surfaces.md`, `src/types.ts`

**Intent**: Register the new load-bearing names and mirror them as TypeScript types.

**Contract**:

- `contract-surfaces.md`:
  - rows for both tables, both helpers, `approve_milestone` and `milestones_check_frozen`;
  - MR014 and MR015 in the SQLSTATE table;
  - the revised exposure and time-share rows;
  - the privacy split written down as a rule.
- `src/types.ts`:
  - `MilestoneStatus = WorkStatus | "approved"`, used by `Milestone.status`;
  - `MilestoneResult` (header);
  - `MilestoneResultLine` (line, including `notified_at`).

### Success Criteria:

#### Automated Verification:

- Migrations and seed apply cleanly: `npx supabase db reset`
- All pgTAP suites pass, including the new `milestone_approval.test.sql`: `npx supabase test db`
- Break-check: disabling the employee `approved` predicate in a worktree-only edit turns the suite red; the edit is then reverted
- Type check passes: `npx astro sync && npx astro check`
- Lint passes: `npm run lint`

#### Manual Verification:

- In Supabase Studio as the seed supervisor, `select public.approve_milestone('…0021')` (via SQL with the JWT claim set) produces one header and one line whose bonus is 2740.38, and the milestone status is `approved`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Supervisor approve flow (no email yet)

### Overview

The Supervisor can approve from the milestone page. Approved milestones render their frozen snapshot and every edit surface becomes read-only with a clear reason.

### Changes Required:

#### 1. Approval service

**File**: `src/lib/services/approvals.ts` (new)

**Intent**: Own the approval error catalog, the approve call and the snapshot read, following the `payouts.ts` pattern (codes only, MRxxx mapping, 42501 → `not_found`).

**Contract**:

- `APPROVAL_ERROR_MESSAGES` contains `invalid_form`, `invalid_id`, `confirm_required`, `not_found`, `not_approvable`, `already_approved`, `project_closed`, `admin_read_only`, `save_failed` and `not_configured`.
- `approvalErrorMessage(code)` falls back to a generic message for unknown codes.
- `approveInputSchema` requires the `confirm` checkbox.
- `approveMilestone(supabase, milestoneId)` calls the `approve_milestone` RPC.
- `getApprovedPayout(supabase, milestoneId)` reads the header and lines and maps them onto the existing `MilestonePayoutSummary` / `MilestonePayoutLine` shapes. `share` is computed as `weighted_contribution / Σ weighted_contribution`, so `PayoutSection` renders both Draft and Approved data. It also returns `approved_at`.
- `approvalUrl(projectId, milestoneId, flash)`.

#### 2. Approve route

**File**: `src/pages/api/projects/[id]/milestones/[milestoneId]/approve.ts` (new)

**Intent**: A `POST` with the same sequence as `kpi.ts`, plus `isMilestoneInProject` before writing (S-03 review F4).

**Contract**: The route runs in this order:

1. Client.
2. Both ids, validated with `projectIdSchema`.
3. Admin early exit with `admin_read_only`.
4. `isMilestoneInProject`.
5. `parseForm(approveInputSchema)`.
6. `approveMilestone`.

It redirects to `/projects/{p}/milestones/{m}?saved=approved` on success, or `?section=approval&error=<code>` on failure.

#### 3. Approval section and milestone page

**File**: `src/components/milestones/ApprovalSection.astro` (new), `src/components/milestones/PayoutSection.astro`, `src/pages/projects/[id]/milestones/[milestoneId].astro`

**Intent**:

- `ApprovalSection` renders three states:
  - approvable: form with the required "I understand this is final; figures are frozen and employees are notified" checkbox, plus `SubmitButton`;
  - not approvable: the reason, derived from page data (unscored, no engagements, cancelled, project closed, Admin);
  - approved: Approved badge and the approval date.

  It also shows saved and error flashes.

- The page:
  - loads `getApprovedPayout` instead of `getMilestonePayout` when the status is `approved`;
  - adds `approved` to the closed states that drive `canEdit`. `isClosedStatus` (`[milestoneId].astro:79`) takes `MilestoneStatus` instead of `WorkStatus`; otherwise it is a type error once `Milestone.status` widens;
  - adds an "Approved milestones are frozen" KPI read-only reason;
  - replaces the assignments hint at `:226-230`, "Reopen it (set it to planned or active)…", with approved-specific copy ("Approved milestones are frozen; assignments can no longer change"). The reopen hint stays for completed and cancelled milestones;
  - shows the status as a badge.
- `PayoutSection` takes an optional `approvedAt`. When set, the badge and description switch from "Draft figures…" to "Approved on … — frozen; each employee sees their own bonus."

**Contract**:

- `ApprovalSection` props: `projectId`, `milestoneId`, `status: MilestoneStatus`, `canApprove: boolean`, `blockedReason: string | null`, `approvedAt: string | null`, `saved: boolean`, `error: string | null`.
- `PayoutSection` gains `approvedAt?: string | null`.
- The section order on the page is: details, KPI, payout, approval, assignments.

#### 4. Project page and the existing services

**File**: `src/components/projects/MilestonesSection.astro`, `src/components/projects/MilestoneForm.astro`, `src/lib/services/projects.ts`, `src/lib/services/payouts.ts`, `src/lib/services/engagements.ts`

**Intent**:

- Approved milestones show an Approved badge on the project page.
  - Their rows are muted like cancelled ones (`MilestonesSection.astro:92-96`).
  - `MilestonesSection.astro:119-136` renders the edit row only when `canEditMilestones && milestone.status !== "approved"`.
- The status select keeps the four work statuses (`WORK_STATUSES` unchanged, so zod rejects `approved`). `MilestoneForm` is therefore never rendered for an approved milestone. Otherwise no option would be preselected (`MilestoneForm.astro:23,50`), and a submit would send `planned` and hit MR015.
- MR015 maps to a new `milestone_approved` code in the projects, payouts and engagements catalogs, with "This milestone is approved and frozen" text. MR014 maps to `invalid_status` in projects.
- The engagements `milestone_closed` text mentions approved milestones.

**Contract**: The catalog entries above, plus the `GUARD_ERROR_CODES` additions.

#### 5. Kitchen sink and UI guard

**File**: `src/pages/dev/projects-kitchen-sink.astro`, `scripts/check-ui-literals.mjs`

**Intent**: Add an approved `PayoutSection` variant and the `ApprovalSection` states (approvable, blocked, approved, error, pending/disabled) to the matrix. Add `ApprovalSection.astro` to `CLEAN_PATHS`.

**Contract**: New `ks-approval` group. `CLEAN_PATHS` gains one entry.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npx astro sync && npx astro check`
- Lint and UI literal guard pass: `npm run lint && npm run lint:ui`
- Build succeeds: `npm run build`
- pgTAP still passes: `npx supabase test db`

#### Manual Verification:

- As `supervisor@meritly.local`, Milestone 2 (unscored) shows a blocked reason and no Approve button
- Approving Milestone 1 without ticking the checkbox shows the confirm error; with it ticked, the page shows Approved, frozen figures (bonus 2740.38), read-only KPI and assignments
- The project page shows Milestone 1 as Approved with no edit row, and the budget panel reserves 2740.38 for it instead of 3000.00
- Posting the old milestone edit form or a KPI form for the approved milestone (e.g. replayed via devtools) shows the frozen error, not a 500
- Kitchen sink `/dev/projects-kitchen-sink` shows all new approval states correctly

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Employee `/my-bonuses` page

### Overview

An activated employee sees their own Approved results with a breakdown.

### Changes Required:

#### 1. Service and route guard

**File**: `src/lib/services/approvals.ts`, `src/middleware.ts`

**Intent**:

- `listMyBonuses` reads the caller's lines.
- The page is limited to the employee role, so a Supervisor cannot use it as an unfiltered view of the team lines RLS lets them read.
- The query also filters on `current_employee_id()` as defence in depth.

**Contract**:

- `listMyBonuses(supabase)` calls the `current_employee_id` RPC.
  - If the result is null, it returns an empty list plus a `not_linked` flag.
  - Otherwise it selects from `milestone_result_lines` where `employee_id = <id>`, ordered by `approved_at desc`.
- Middleware:
  - add `/my-bonuses` to `PROTECTED_ROUTES`;
  - add a new `EMPLOYEE_ROUTES = ["/my-bonuses"]` that requires role `employee`;
  - otherwise return 403, or 503 when the profile lookup failed (same pattern as `PROJECT_ROUTES`).

#### 2. Page

**File**: `src/pages/my-bonuses.astro` (new)

**Intent**: A token-only page in the milestone-page shell (`bg-cosmic`, `max-w-4xl`, `Topbar`, Card plus Table). It has one row per Approved result: project, milestone, period, approved date and bonus. Under each row is a breakdown: time share, role weight, rating → factor, KPI multiplier. It covers an empty state ("No approved bonuses yet"), a not-linked state ("Your account isn't linked to an employee record yet; ask your supervisor to invite you"), and a load-error Alert.

**Contract**: Formatting uses `formatPln`, `formatShare`, `formatMultiplier` and the like from `src/lib/format.ts`. No share, pool or colleague data appears.

#### 3. Navigation, guard list, roadmap note

**File**: `src/components/Topbar.astro`, `src/pages/dashboard.astro`, `scripts/check-ui-literals.mjs`, `context/foundation/roadmap.md`

**Intent**:

- Add a "My bonuses" link for role `employee` in the Topbar and on the dashboard, following each file's existing link style.
- Add `src/pages/my-bonuses.astro` to `CLEAN_PATHS`.
- Note in the S-06 roadmap entry that it extends `/my-bonuses` and reads `milestone_result_lines`.

**Contract**: Link visibility is `profile?.role === "employee"`. The S-06 note goes in its Unknowns/Risk text.

#### 4. Return to the requested page after sign-in

**File**: `src/middleware.ts`, `src/pages/auth/signin.astro`, `src/components/auth/SignInForm.tsx`, `src/pages/api/auth/signin.ts`

**Intent**: An employee who opens the email's `/my-bonuses` link while signed out should land on `/my-bonuses` after signing in, not on `/`. Today the middleware redirects to a bare `/auth/signin` (`src/middleware.ts:59-62`) and the API always redirects to `/` (`src/pages/api/auth/signin.ts:22`). The fix benefits every protected route.

**Contract**:

- The middleware's unauthenticated redirect becomes `/auth/signin?next=<pathname+search>`.
- `signin.astro` passes `next` to `SignInForm`, which posts it as a hidden field.
- `api/auth/signin.ts` validates `next` with zod as a same-origin path: it starts with `/`, does not start with `//` or `/\`, and contains no scheme.
  - Valid: redirect to `next` on success.
  - Missing or invalid: fall back to `/`.
  - On error, the error redirect keeps `next`.

  The default (no `next`) stays `/`, so `npm run smoke` keeps passing.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npx astro sync && npx astro check`
- Lint and UI literal guard pass: `npm run lint && npm run lint:ui`
- Build succeeds: `npm run build`
- Smoke test still passes against the preview: `npm run build && npm run preview` then `npm run smoke`

#### Manual Verification:

- As `employee@meritly.local` (after Phase 2's approval of Milestone 1), `/my-bonuses` lists Local Demo Project / Milestone 1 with bonus 2740.38 and the breakdown; the Topbar shows "My bonuses"
- As the supervisor, `/my-bonuses` returns 403 and the link is absent
- As the employee, a hand-crafted Supabase query for another milestone id, or for `milestone_results`, returns nothing (e.g. browser console with the session, or Studio with the employee's JWT)
- Before approving a milestone, its result does not appear for the employee
- Signed out, opening `/my-bonuses` goes to sign-in; signing in as the employee lands on `/my-bonuses` (also after one failed password attempt)
- A crafted `next` (`//evil.example`, `https://evil.example`, `/\evil.example`) falls back to `/` after sign-in

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Approval email

### Overview

Every engaged employee is emailed their own bonus after approval, through a new Edge Function that sends with Resend's batch API in production and with Mailpit locally. Unsent emails can be re-sent.

### Changes Required:

#### 1. Edge Function

**File**: `supabase/functions/notify-milestone-approved/index.ts` (new), `supabase/config.toml`, `supabase/functions/.env.example` (new)

**Intent**: Mirror `invite-employee`'s structure and response-code header: `withSupabase({ auth: "user" })`, a role check, an RLS-visible load, and an explicit owner check. It sends one message per unsent line and stamps `notified_at` for each confirmed batch.

**Contract**:

- **Request:** `POST { milestone_id }` with the user's JWT. `[functions.notify-milestone-approved] verify_jwt = true`.
- **Responses:**
  - `200 { sent, failed }`;
  - `400 invalid_request`;
  - `403 forbidden` (not a Supervisor; Admins are read-only);
  - `404 not_found` (not visible, or not the owner);
  - `409 not_approved`;
  - `500 email_not_configured`;
  - `502 send_failed`, when no batch succeeded.
- **Data:**
  - Lines where `notified_at is null` are read with the admin client.
  - Each line is joined to `employees.email`, `full_name` and `profile_id`/`activated_at` for the address and invite state.
  - Only that employee's own figures go into each message.
- **Transport, chosen by env:**
  - `RESEND_API_KEY` + `MAIL_FROM`: `POST https://api.resend.com/emails/batch` in chunks of ≤100, with `Idempotency-Key: milestone-approved/<milestone_id>/<hash of sorted line ids>`.
  - Otherwise `MAILPIT_URL`: `POST <MAILPIT_URL>/api/v1/send` per message (local dev only).
  - Otherwise `email_not_configured`.
  - `APP_URL` builds the `/my-bonuses` link.
- **Content:**
  - Subject: "Your bonus for <milestone> — <project>".
  - Text and HTML bodies with greeting, project, milestone, period, bonus in pl-PL PLN, and the link. All interpolated values are HTML-escaped.
  - Recipients without an activated account also get the line: "You don't have a Meritly account yet — ask your supervisor to send you an invite to see this in the app."
  - Known risk, accepted with the all-recipients decision: a never-invited employee's address is unverified Supervisor input, so a typo sends that one bonus figure to a stranger.
- **Logging:** milestone id and counts only.
- **`.env.example`:** documents `RESEND_API_KEY`, `MAIL_FROM`, `APP_URL`, and `MAILPIT_URL=http://host.docker.internal:54324`.

#### 2. App wiring and re-send

**File**: `src/lib/services/approvals.ts`, `src/pages/api/projects/[id]/milestones/[milestoneId]/approve.ts`, `src/pages/api/projects/[id]/milestones/[milestoneId]/notify.ts` (new), `src/components/milestones/ApprovalSection.astro`, `src/pages/projects/[id]/milestones/[milestoneId].astro`, `src/pages/dev/projects-kitchen-sink.astro`

**Intent**:

- After a successful approval, the route invokes the function. Approval stands regardless of the result.
- `ApprovalSection` (approved state) shows "Emails sent: N of M" from the lines' `notified_at`. When N < M it shows a "Re-send unsent emails" form, which posts to `notify.ts`.
- The kitchen sink gains the all-sent and partially-sent variants.

**Contract**:

- `notifyMilestoneApproved(supabase, milestoneId)` uses `functions.invoke("notify-milestone-approved")` with `FunctionsHttpError` code mapping, as in `employees.ts:273-309`.
- The approve route redirects:
  - `?saved=approved` when all sends succeed;
  - `?saved=approved&notice=email_partial` or `&notice=email_failed` otherwise.
- `notify.ts` runs the same guard sequence as approve, minus confirm, and redirects with `saved=notified` or an error code.
- `getApprovedPayout` also returns `notified_count` and `line_count`.

#### 3. Docs

**File**: `README.md`, `CLAUDE.md`, `docs/reference/contract-surfaces.md`

**Intent**:

- **README:**
  - local setup: copy `supabase/functions/.env.example` to `.env`, then `npx supabase functions serve`, and mail appears at :54324;
  - production: `npx supabase secrets set RESEND_API_KEY=… MAIL_FROM=… APP_URL=…`, then `npx supabase functions deploy notify-milestone-approved`;
  - prerequisite: Resend domain verification (S-03 items 5.4–5.6).
- **CLAUDE.md:** the auth/Edge Function bullets now name both functions as the only secret-key code, and the middleware bullet names `EMPLOYEE_ROUTES`.
- **contract-surfaces.md:** a row for the function contract.

**Contract**: The README deploy section and the CLAUDE.md Architecture section are updated.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npx astro sync && npx astro check`
- Lint and UI literal guard pass: `npm run lint && npm run lint:ui`
- Build succeeds: `npm run build`
- pgTAP still passes: `npx supabase test db`

#### Manual Verification:

- Local: with `npx supabase functions serve` running and `MAILPIT_URL` set (verify `host.docker.internal:54324` reaches Mailpit from the edge runtime; otherwise use the inbucket container name on port 8025 and record it in `.env.example`), approving a seeded milestone delivers one email per engaged employee to `http://127.0.0.1:54324`, each containing only that employee's bonus and a working `/my-bonuses` link
- With the functions server stopped, approval still succeeds and the page shows "Emails sent: 0 of 1" with the re-send form; after starting the server, re-send delivers and the count becomes 1 of 1; re-sending again sends nothing
- No email is sent for an unapproved milestone (calling `notify.ts` on one shows the not-approved error)
- Edge Function logs show milestone id and counts only, with no figures or addresses

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- There is no unit-test framework. Database behaviour is covered by pgTAP in `supabase/tests/milestone_approval.test.sql`; the cases are listed in Phase 1.

### Integration Tests:

- `npx supabase test db` runs all six suites in CI.
- `npm run smoke` covers the auth flow on the production preview and must stay green.

### Manual Testing Steps:

1. `npx supabase db reset`, then `npm run dev` and `npx supabase functions serve`.
2. As `supervisor@meritly.local`, open Local Demo Project → Milestone 2. Approval is blocked as unscored.
3. Open Milestone 1, tick the confirm box and approve. Check: Approved badge, frozen bonus 2740.38, read-only sections, "Emails sent: 1 of 1".
4. In Mailpit (`http://127.0.0.1:54324`), one email to `employee@meritly.local` with 2740,38 zł and the link.
5. As Admin, change a role weight and `multiplier_max` in `/admin/settings`. Milestone 1's figures are unchanged, and Milestone 2's Draft figures change.
6. Sign in as `employee@meritly.local` via the link and open `/my-bonuses`: one row with the breakdown, and no other data.
7. The project page budget panel reserves 2740.38 + 3000.00. The employee's time-share flag no longer counts Milestone 1.

## Performance Considerations

- Approval is one RPC plus one Edge Function call from the Worker: 2 subrequests, whatever the team size. The function sends ≤100 emails per Resend call.
- `milestone_result_lines` needs an index on `employee_id` for `/my-bonuses`, plus the (`milestone_id`, `employee_id`) unique index.
- Inside RLS, `is_approved_milestone` is evaluated per row. Volumes are small (an employee's own lines), so this is acceptable.

## Migration Notes

- This is an additive migration. Existing milestones keep their statuses, and none is approved, so the budget view and time-share totals return the same numbers as before until the first approval.
- Rollback before any approval: drop the new objects and restore the previous function and view bodies. After approvals there is no supported rollback, because approval is irreversible by design.
- Production needs, in order:
  1. `npx supabase db push`;
  2. Edge Function secrets and `functions deploy notify-milestone-approved`;
  3. Resend domain verification;
  4. `wrangler deploy`.

## References

- Research: `context/changes/supervisor-approves-milestone-employee-sees-bonus/research.md`
- S-04 snapshot requirement: `context/archive/2026-10-04-supervisor-scores-milestone-and-sees-computed-bonuses/follow-ups/review-fixes.md:5-13`
- Config snapshot rule: `docs/reference/contract-surfaces.md:107-111`
- Live payout functions: `supabase/migrations/20261004130000_milestone_payout_hard_cap.sql:28-249`
- Route pattern: `src/pages/api/projects/[id]/milestones/[milestoneId]/kpi.ts`
- Section pattern: `src/components/milestones/KpiScoresSection.astro`
- Edge Function pattern: `supabase/functions/invite-employee/index.ts`, `src/lib/services/employees.ts:273-309`
- pgTAP pattern: `supabase/tests/milestone_payouts.test.sql`
- Infra email guidance: `context/foundation/infrastructure.md:61, 91, 94, 98`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database: approval, snapshot, freeze and RLS

#### Automated

- [x] 1.1 Migrations and seed apply cleanly: `npx supabase db reset` — b8a987e
- [x] 1.2 All pgTAP suites pass, including the new `milestone_approval.test.sql`: `npx supabase test db` — b8a987e
- [x] 1.3 Break-check: disabling the employee `approved` predicate in a worktree-only edit turns the suite red; the edit is then reverted — b8a987e
- [x] 1.4 Type check passes: `npx astro sync && npx astro check` — b8a987e
- [x] 1.5 Lint passes: `npm run lint` — b8a987e

#### Manual

- [x] 1.6 Seed supervisor's `approve_milestone('…0021')` produces one header and one line with bonus 2740.38 and status `approved` — b8a987e

### Phase 2: Supervisor approve flow (no email yet)

#### Automated

- [x] 2.1 Type check passes: `npx astro sync && npx astro check`
- [x] 2.2 Lint and UI literal guard pass: `npm run lint && npm run lint:ui`
- [x] 2.3 Build succeeds: `npm run build`
- [x] 2.4 pgTAP still passes: `npx supabase test db`

#### Manual

- [x] 2.5 Milestone 2 (unscored) shows a blocked reason and no Approve button
- [x] 2.6 Approve requires the checkbox; approved Milestone 1 shows frozen figures and read-only sections
- [x] 2.7 Project page shows Approved with no edit row; budget panel reserves 2740.38
- [x] 2.8 Replayed edit/KPI forms on the approved milestone show the frozen error, not a 500
- [x] 2.9 Kitchen sink shows all new approval states correctly

### Phase 3: Employee `/my-bonuses` page

#### Automated

- [ ] 3.1 Type check passes: `npx astro sync && npx astro check`
- [ ] 3.2 Lint and UI literal guard pass: `npm run lint && npm run lint:ui`
- [ ] 3.3 Build succeeds: `npm run build`
- [ ] 3.4 Smoke test still passes against the preview: `npm run smoke`

#### Manual

- [ ] 3.5 Employee sees Milestone 1 with bonus 2740.38 and breakdown; Topbar shows "My bonuses"
- [ ] 3.6 Supervisor gets 403 on `/my-bonuses` and no link
- [ ] 3.7 Hand-crafted queries for other milestones or `milestone_results` return nothing for the employee
- [ ] 3.8 An unapproved milestone's result does not appear for the employee
- [ ] 3.9 Signed-out `/my-bonuses` returns to `/my-bonuses` after sign-in, including after a failed attempt
- [ ] 3.10 Crafted off-site `next` values fall back to `/`

### Phase 4: Approval email

#### Automated

- [ ] 4.1 Type check passes: `npx astro sync && npx astro check`
- [ ] 4.2 Lint and UI literal guard pass: `npm run lint && npm run lint:ui`
- [ ] 4.3 Build succeeds: `npm run build`
- [ ] 4.4 pgTAP still passes: `npx supabase test db`

#### Manual

- [ ] 4.5 Local approval delivers one email per engaged employee to Mailpit with only their bonus and a working link
- [ ] 4.6 With functions stopped, approval succeeds showing 0 of 1; re-send delivers once and is idempotent
- [ ] 4.7 No email for an unapproved milestone (notify shows not-approved error)
- [ ] 4.8 Edge Function logs contain milestone id and counts only
