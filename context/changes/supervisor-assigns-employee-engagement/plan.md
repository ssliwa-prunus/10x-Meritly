# Supervisor Assigns Employee Engagement Implementation Plan

## Overview

This plan delivers roadmap slice S-03 (FR-007, FR-008, FR-011). A Supervisor or Admin registers an employee, and each employee has an owning Supervisor, a job role and a unique email. The employee is invited by email through a Supabase Edge Function and only has to accept the invite and set a password. A Supervisor assigns their own employees to open milestones, each assignment with a time-share (0–1] and a contribution rating (1–5). The Supervisor sees a flag when an employee's time-share across open milestones exceeds 100%.

## Current State Analysis

Nothing for S-03 exists yet: no table, type, route or page (research Summary). The building blocks it uses:

- **Identity.**
  - `public.profiles` rows are created only by `handle_new_user()` on `auth.users` insert, and every new profile gets role `employee` (`supabase/migrations/20260925120000_role_and_rls_scaffold.sql:28-45`).
  - No API role can insert or delete profiles (`:90-96`).
  - The app never holds the secret key. Only `SUPABASE_URL`/`SUPABASE_KEY` are Worker secrets (`context/foundation/infrastructure.md:80`, `CLAUDE.md`).
- **Job roles.** `public.job_roles` holds the weights and uses soft-archive. New assignments must pick only non-archived roles (`supabase/migrations/20260926120000_bonus_rules_config.sql:12-30`).
- **Ownership.**
  - `public.owns_project()` is SECURITY DEFINER (`supabase/migrations/20260927120000_projects_and_milestones.sql:100-118`), and milestone access rules use it (`:335-358`).
  - Guard triggers raise MR001–MR006 (`:5-11`) and check permission (42501) before anything else (`supabase/migrations/20260927130000_milestones_guard_ownership.sql:23-26`).
  - The MR005 check that blocks demoting a Supervisor counts only projects (`20260927120000_projects_and_milestones.sql:248-277`).
- **App pattern.** A plain HTML form posts to a `POST` APIRoute. The route runs `parseForm` with a zod schema and calls a service with the user-scoped client, then redirects 302 with `?saved=`/`?error=` (`src/lib/forms.ts:9-40`, `src/lib/services/projects.ts`, `src/pages/api/projects/[id]/milestones/index.ts:13-40`).
- **Middleware.** It guards `/projects` and `/api/projects` for Supervisors and Admins. Matching is `startsWith` (`src/middleware.ts:5-10`).
- **Tooling.**
  - `tsconfig.json` includes `**/*` and would type-check Deno files.
  - CI starts Supabase with `-x …mailpit,edge-runtime…` and runs `supabase test db` (`.github/workflows/ci.yml:41-44`).
  - `supabase/config.toml:154` has `site_url = "http://127.0.0.1:3000"`, a starter leftover; the app runs on 4321.
  - `[auth.email.template.invite]` is commented out (`:230-232`).
  - No `supabase/functions/` or `supabase/templates/` directory exists.
- **Seed** (`supabase/seed.sql`): admin `…0001`, supervisor `…0002` (owns project `…0011`, whose milestones `…0021` and `…0022` are both `active`), employee user `…0003`, and supervisor2 `…0004`.

## Desired End State

**Supervisor and Admin:**

- The Supervisor opens `/employees`. From there they register an employee (name, email, job role), edit the employee, and send or resend the invite.
- The invite email links to `/auth/confirm`. The link signs the employee in and leads to `/auth/set-password`, and after that the employee signs in normally.
- An Admin can do the same for any employee, can choose or change the owning Supervisor, and sees every employee.
- On `/projects/[id]/milestones/[milestoneId]` the owning Supervisor adds, edits and deletes assignments for their own employees while the milestone and project are open.
- Every assignment row and every employee row shows the employee's total across open milestones, with a red flag when it is above 100%.

**Database enforcement:** every rule in "Key Discoveries / Decisions" below is enforced by access rules or triggers and covered by `supabase/tests/employees_rls.test.sql`.

**Production:** a real invite reaches an external mailbox through Resend SMTP, and the recipient can set a password and sign in.

### Key Discoveries / Decisions:

**Employees** (research Follow-up; plan interview):

- An employee is owned by exactly one Supervisor (`employees.supervisor_id`).
- A Supervisor sees and assigns only the employees they own. They also see read-only the employees who have assignments on the Supervisor's own milestones, which keeps the names visible after an employee moves.
- Admins see, register, edit and move all employees. When an Admin registers an employee, the Admin picks the owning Supervisor.
- The job role lives on the employee (one global role). Only non-archived job roles may be chosen.
- An email belongs to exactly one employee and is stored lowercase. It can be edited until the first invite and is locked after that.
- The message for a duplicate email is generic: it neither reveals another Supervisor's employee nor repeats the email back.
- An employee cannot be moved to a new owner while they have an assignment on an open milestone owned by another Supervisor. Closed-milestone history does not block the move.

**Invites:**

- A separate "Send invite" / "Resend invite" action calls the `invite-employee` Edge Function, which holds the secret key. Registering an employee never sends email.
- The function runs as `withSupabase({ auth: 'user' })` (Context7 `/websites/supabase_guides`, functions/auth) and re-checks that the caller owns the employee or is an Admin.

**Assignments:**

- At most one assignment per (milestone, employee). Time-share is above 0 and at most 1, with 2 decimals. The rating is a whole number from 1 to 5.
- Only the owning Supervisor may insert, update and delete, and hard delete is allowed. Admins are read-only.
- All writes are blocked while the milestone or project is `completed`/`cancelled`.

**The >100% flag:**

- "Open" means `status not in ('completed','cancelled')`, with no date-overlap test.
- A Supervisor's total covers only milestones they own. An Admin's total covers every milestone.
- The flag shows when the total is strictly above 1.00.

## What We're NOT Doing

- **No employee access to their own data.** No employee select policies on employees, engagements, projects or milestones; those come in S-05/S-06 per S-02 `plan.md:68`.
- **No bonus computation, KPI scores or approval**, and no `approved` milestone status. Those are S-04/S-05. S-05 must revisit the "open" definition and block deletes on approved milestones.
- **No deleting or archiving employees.** No delete policy on `employees`.
- **No changing an employee's email after the first invite**, and no syncing an email change into `auth.users`. A wrong post-invite email is an Admin fix in Studio.
- **No closing public self-signup and no linking of self-signed-up accounts** to employee records. An invite to an email that already has a confirmed account fails with a generic message.
- **No blocking rule on >100%.** The flag is informational (PRD FR-011 Socrates note).
- **No date-overlap logic.**
- **No automated end-to-end invite test.** CI keeps `-x edge-runtime,mailpit`; the invite flow is verified manually.
- **No approval-email work (FR-016).** Resend is only configured as Supabase Auth's SMTP here.

## Implementation Approach

The order is database first, then invite plumbing, then the two UIs, then docs and the production rollout.

- **Database.** Every privacy and ownership rule lives in Postgres: owner-scoped access rules, column-level grants so users can never write the link/invite fields or immutable keys, and BEFORE guard triggers that check permission first.
- **The flag** is a `security_invoker` view, so each role's own access rules give the Supervisor-only or all-milestones scope with no role branching.
- **Invites.** The Worker never holds the secret key. It calls the Edge Function with the signed-in user's JWT via `supabase.functions.invoke`. The function uses its admin client only for `inviteUserByEmail` and for stamping `profile_id`/`invited_at`.
- **Activation.** A SECURITY DEFINER trigger on `auth.users` stamps `activated_at` when the invited email is confirmed.

## Critical Implementation Details

- **Access-rule recursion.** The Supervisor select policy on `employees` must not query `milestone_engagements` directly, because the engagements' insert check reads `employees`. Put the "engaged on my milestone" test in a SECURITY DEFINER helper, and scope the engagement policies through a SECURITY DEFINER `owns_milestone()`, so no access-rule cycle is formed.
- **Visible is not owned.** The widened Supervisor select means seeing an employee does not imply owning them. The assign check (MR011), the invite ownership check in the Edge Function and the assignable-employee picker must compare `supervisor_id` explicitly, never rely on visibility.
- **Race-free reassignment.** The engagement guard reads the employee row `FOR SHARE`, and a reassignment `UPDATE` takes the row lock. That serializes "assign" against "move owner", so the MR008 check cannot be raced (S-02 plan-review F1 pattern).
- **Deno files and tooling.** `tsconfig.json` (`include: **/*`) and ESLint would process the Deno function and fail on `npm:` imports and `Deno` globals. Exclude `supabase/functions` from both.
- **Invite template link.** The link must use `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`. Local `site_url` becomes `http://localhost:4321`. Production Site URL stays `https://meritly.meritly.workers.dev` (`context/changes/deployment/deployment-plan.md` step B.4).

## Phase 1: Database, access rules and tests

### Overview

A migration adds the employees and engagements tables, the access rules, helper functions, guards, the flag view and the activation trigger. Seed data and a pgTAP suite prove every rule.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20260929120000_employees_and_engagements.sql`

**Intent**: Create the S-03 schema and enforce every ownership, privacy and closed-parent rule in the database, following the S-02 conventions: RLS in the same migration, `revoke all … from anon`, one policy per operation per role named `<table>_<op>_<role>`, commented deliberate absences, `search_path = ''`, and SECURITY DEFINER only where a check must see past RLS.

**Contract**:

- **Header comment:** extend the SQLSTATE catalog with:
  - MR001 is reused for `employees` (owner must be a Supervisor);
  - MR007 `engagement_parent_closed`
  - MR008 `employee_has_open_engagements`
  - MR009 `employee_email_locked`
  - MR010 `job_role_archived`
  - MR011 `employee_not_on_team`
- **`public.employees`:**
  - `id uuid pk default gen_random_uuid()`
  - `supervisor_id uuid not null default auth.uid() references profiles on delete restrict`
  - `full_name text` with a 1–100 length check and a `btrim` check
  - `email text not null`, with the check `email = lower(btrim(email))` plus a basic `^[^@\s]+@[^@\s]+\.[^@\s]+$` format check, and a unique index on `email`
  - `job_role_id uuid not null references job_roles on delete restrict`
  - `profile_id uuid unique references profiles on delete set null`
  - `invited_at timestamptz`, `activated_at timestamptz`
  - audit columns (`created_at`, `updated_at`, `updated_by`) with the `set_config_audit_fields()` trigger
  - an index on `supervisor_id`
- **`public.milestone_engagements`:**
  - `id`
  - `milestone_id uuid not null references milestones on delete restrict`
  - `employee_id uuid not null references employees on delete restrict`
  - `time_share numeric(3,2) not null`, check `> 0 and <= 1`
  - `rating smallint not null`, check `between 1 and 5`
  - audit columns and trigger
  - `unique (milestone_id, employee_id)`, plus an index on `employee_id`
- **Column privileges:**
  - `employees`: `revoke insert, update on public.employees from authenticated`, then `grant insert (full_name, email, job_role_id, supervisor_id)` and `grant update (full_name, email, job_role_id, supervisor_id)`. `profile_id`, `invited_at` and `activated_at` are never writable by `authenticated`.
  - `milestone_engagements`: grant `insert (milestone_id, employee_id, time_share, rating)` and `update (time_share, rating)`, so the keys are immutable.
  - Revoke `truncate, references, trigger` from `authenticated` on both tables.
- **Helpers** (SECURITY DEFINER, stable, execute granted to `authenticated` only):
  - `public.owns_milestone(p_milestone_id uuid) returns boolean`: `owns_project` of the milestone's project.
  - `public.employee_engaged_on_own_milestone(p_employee_id uuid) returns boolean`: true when an engagement of that employee sits on a milestone the caller owns.
- **`employees` policies:**
  - `select_supervisor`: `(supervisor_id = (select auth.uid()) and (select public.is_supervisor())) or public.employee_engaged_on_own_milestone(id)`
  - `select_admin`
  - `insert_supervisor`: with check `supervisor_id = (select auth.uid()) and (select public.is_supervisor())`
  - `insert_admin`
  - `update_supervisor`: owner predicate in both using and with check
  - `update_admin`
  - No delete policy for any role, and no Employee-role policy. Comment both as intentional.
- **`milestone_engagements` policies:**
  - `select_supervisor`, `insert_supervisor`, `update_supervisor` and `delete_supervisor`, all on `public.owns_milestone(milestone_id)`
  - `select_admin`
  - No Admin insert, update or delete, and no Employee-role policy. Comment both as intentional; this is the project's first delete policy.
- **Guard `employees_check_rules()`:**
  - Trigger: `before insert or update of supervisor_id, email, job_role_id`.
  - (a) Raise 42501 when `auth.uid() is not null`, the caller is not an Admin, and `new.supervisor_id <> auth.uid()`.
  - (b) MR001 when the owner is not a Supervisor.
  - (c) MR010 when `job_role_id` (on insert, or on change) points to an archived role.
  - (d) MR009 when `email` changes while `old.invited_at is not null`.
  - (e) MR008 when `supervisor_id` changes while an engagement exists on a milestone with `status not in ('completed','cancelled')` whose project's `supervisor_id <> new.supervisor_id`.
- **Guard `milestone_engagements_check_parent()`:**
  - Trigger: `before insert or update or delete`. It uses `old` on delete and returns `old` there.
  - (a) Raise 42501 when `auth.uid() is not null and not owns_milestone(milestone_id)`.
  - (b) Lock the milestone, its project and the employee rows `for share`.
  - (c) MR007 when the milestone or project status is `completed`/`cancelled`.
  - (d) On insert, MR011 when `employee.supervisor_id <> project.supervisor_id`.
- **Replace `profiles_block_owner_role_change()`:** MR005 now also counts `employees.supervisor_id = old.id`, and the message says "reassign projects and employees first".
- **`public.handle_employee_activation()`:** SECURITY DEFINER, execute revoked from everyone. Trigger `on_auth_user_confirmed`: `after update of email_confirmed_at on auth.users` when the old value is null and the new value is not null. It sets `employees.activated_at = now()` where `profile_id = new.id`.
- **View `public.employee_time_share_totals`** (`with (security_invoker = true)`):
  - columns `employee_id`, `open_total numeric`, `over_allocated boolean` (`open_total > 1`)
  - aggregates `milestone_engagements` joined to `milestones` where `status not in ('completed','cancelled')`
  - revoke from `anon`; grant select to `authenticated`

#### 2. Seed data

**File**: `supabase/seed.sql`

**Intent**: Give local development a realistic S-03 state, including a visible flag.

**Contract**:

- Employee `…0031` "Local Employee", `employee@meritly.local`:
  - owner `…0002`, job role looked up by name `'Senior'`
  - `profile_id = …0003`, `invited_at` and `activated_at = now()`
- Employee `…0032` "Pending Invitee", `pending@meritly.local`: owner `…0002`, not invited.
- Engagements (`…0041`, `…0042`) for `…0031`:
  - milestone `…0021`: 0.60, rating 4
  - milestone `…0022`: 0.50, rating 3
  - The open total is 1.10, so the flag shows.
- Pass `supervisor_id` explicitly, because seed inserts run without a JWT.

#### 3. pgTAP suite

**File**: `supabase/tests/employees_rls.test.sql`

**Intent**: Prove every Phase 1 rule under real role impersonation, in the `…04xx` fixture range with the `projects_rls.test.sql` structure (`begin`/`rollback`, `set local role authenticated` + `request.jwt.claims`, `throws_ok` for 42501/MR*, `is_empty(… returning id)` for silent denials).

**Contract**: fixtures are two Supervisors (A, B), an Admin, an employee-role user, a project per Supervisor with open and closed milestones, and employees owned by A and by B. Assertions:

- Structure:
  - RLS is enabled on both tables.
  - The view has `security_invoker`.
  - `authenticated` has no update privilege on `employees.profile_id`, `invited_at` or `activated_at`, nor on `milestone_engagements.milestone_id`/`employee_id`.
- `employees`:
  - A sees own rows and not B's, until B's employee is engaged on A's milestone; then A sees it read-only.
  - A cannot update a visible-but-not-owned employee.
  - A cannot insert with `supervisor_id = B` (42501).
  - The Admin sees all, can insert with an explicit owner, and gets MR001 for a non-Supervisor owner.
  - The employee-role user sees nothing and cannot write (42501).
  - Anon is denied.
  - A duplicate email raises 23505.
  - An uppercase email fails the check (23514).
- Guards:
  - MR010 for an archived job role on insert and on change.
  - MR009 for an email change after `invited_at` is set (set as owner in the test).
  - MR008 when the Admin moves an employee who has an open-milestone engagement on the old owner's project.
  - The move succeeds when the only engagements are on closed milestones.
  - Demoting a Supervisor who owns employees but no projects raises MR005.
- `milestone_engagements`:
  - A inserts, updates and deletes on an open milestone they own.
  - A duplicate (milestone, employee) raises 23505.
  - `time_share` 0 and 1.01 and rating 0 and 6 raise 23514.
  - Inserting B's employee on A's milestone raises MR011.
  - A insert on B's milestone raises 42501.
  - A's update and delete on B's rows are empty.
  - Insert, update and delete on a completed milestone and on a cancelled project raise MR007.
  - The Admin select works; Admin insert raises 42501, and Admin update/delete are empty.
  - The employee-role user sees nothing.
- View:
  - A sees the open total counting only A's milestones and excluding completed ones.
  - The Admin sees the total across A's and B's milestones.
  - The flag is true at 1.10 and false at exactly 1.00.
- Activation: setting `auth.users.email_confirmed_at` on a linked profile stamps `activated_at`.

### Success Criteria:

#### Automated Verification:

- Migration and seed apply cleanly: `npx supabase db reset`
- All pgTAP suites pass, including the new one: `npx supabase test db`
- Existing suites unchanged and green (profiles, bonus_config, projects), including the global "every view is security_invoker" check

#### Manual Verification:

- In Studio, the seeded employee `…0031` shows `open_total = 1.10` / `over_allocated = true` in `employee_time_share_totals` when queried as the seed Supervisor

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Invite and account activation

### Overview

This phase adds the Edge Function that sends invites, the local auth configuration and template, and the two auth pages that turn an invite link into a signed-in user with a password.

### Changes Required:

#### 1. Edge Function

**File**: `supabase/functions/invite-employee/index.ts` (+ `supabase/functions/invite-employee/deno.json` if needed for imports)

**Intent**: The only code path that uses the secret key. It sends or re-sends a Supabase invite for one employee and links the created auth user to the employee row.

**Contract**:

- `export default { fetch: withSupabase({ auth: 'user' }, handler) }` from `npm:@supabase/server@^1`. Confirm the current API via Context7 at implement time.
- Request: `POST` JSON `{ employee_id: uuid }`.
- Responses:
  - `200 { ok: true }`
  - `400 { code: "invalid_request" }`
  - `403 { code: "forbidden" }`: caller role is not supervisor or admin, read via `ctx.supabase.rpc('current_app_role')`
  - `404 { code: "not_found" }`: the row is not visible through `ctx.supabase`, or the caller is a Supervisor and `supervisor_id ≠ ctx.userClaims.id`
  - `409 { code: "already_active" }`: `activated_at` is set
  - `409 { code: "email_unavailable" }`: `inviteUserByEmail` rejected the email, for example an existing confirmed account
  - `500 { code: "invite_failed" }`: logged
- On success:
  - call `ctx.supabaseAdmin.auth.admin.inviteUserByEmail(email, { data: { display_name: full_name } })`;
  - update the row via `ctx.supabaseAdmin` with `profile_id = invited user id` and `invited_at = now()`;
  - never touch any other table.

#### 2. Local Supabase config and invite template

**File**: `supabase/config.toml`, `supabase/templates/invite.html`

**Intent**: Make the local invite flow land on the app, and document the function.

**Contract**:

- `site_url = "http://localhost:4321"`
- `additional_redirect_urls = ["http://127.0.0.1:4321", "http://localhost:4321"]`
- `[auth.email.template.invite]` with subject "You're invited to Meritly" and `content_path = "./supabase/templates/invite.html"`
- `[functions.invite-employee]` with `verify_jwt = true`
- The template's single call-to-action link is `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`, and it states the 1-hour expiry.

#### 3. Tooling exclusions

**File**: `tsconfig.json`, `eslint.config.js` (whatever the actual `eslint.config.*` filename is)

**Intent**: Keep `astro check` and `npm run lint` from processing Deno code.

**Contract**: add `"supabase/functions"` to tsconfig `exclude`, and `supabase/functions/` to `globalIgnores`.

#### 4. Confirm route

**File**: `src/pages/auth/confirm.ts`

**Intent**: Exchange the invite `token_hash` for a session cookie.

**Contract**:

- `GET` handler that zod-validates `token_hash` (non-empty) and `type` (`z.enum(["invite"])`), then calls `supabase.auth.verifyOtp({ token_hash, type })` via `createClient(...)`.
- On success, redirect to `/auth/set-password`.
- On failure or invalid parameters, redirect to `/auth/signin?error=invite_invalid`.

#### 5. Set-password page and API

**File**: `src/pages/auth/set-password.astro`, `src/pages/api/auth/set-password.ts`, `src/pages/auth/signin.astro`

**Intent**: Let the invited, now signed-in employee set their password, following the zod + `parseForm` + catalog-code redirect pattern rather than the older `signup.ts` pattern.

**Contract**:

- The page is a plain HTML form (`password`, `confirm_password`) using `form-classes.ts`, and shows `?error=` via a small fixed message map.
- `POST` validates a password of at least 6 characters (`supabase/config.toml` `minimum_password_length = 6`) and that the two fields match.
- It calls `supabase.auth.updateUser({ password })`, then redirects to `/dashboard`. Errors redirect to `/auth/set-password?error=<code>`.
- `signin.astro` maps `invite_invalid` to the fixed text "This invite link is invalid or expired. Ask your supervisor to resend it." Any other value keeps today's behaviour.

#### 6. Middleware

**File**: `src/middleware.ts`

**Intent**: Only a signed-in user can reach set-password.

**Contract**: add `/auth/set-password` and `/api/auth/set-password` to `PROTECTED_ROUTES`. `/auth/confirm` stays public.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npx astro sync && npx astro check`
- Lint passes: `npm run lint`
- Build passes: `npm run build`
- DB tests still pass: `npx supabase test db`
- Smoke still passes against a local preview: `npm run smoke`

#### Manual Verification:

- Function call as seed Supervisor for `…0032` returns 200, invite in Inbucket, `profile_id`/`invited_at` set (run `npx supabase start` + `npx supabase functions serve`; Inbucket at `http://127.0.0.1:54324`)
- Invite link lands on `/auth/set-password` signed in; password set; re-sign-in works; `activated_at` set
- Resend before acceptance delivers a fresh email; activated employee returns 409 `already_active`
- supervisor2 gets 404 and the employee user gets 403 from the function
- Expired or reused link lands on sign-in with the fixed invite message

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Employees UI

### Overview

This phase adds the `/employees` page for Supervisors and Admins to list, register, edit, move and invite employees, showing each one's open-milestone total and flag.

### Changes Required:

#### 1. Shared helpers and types

**File**: `src/lib/forms.ts`, `src/lib/services/bonus-config.ts`, `src/lib/format.ts`, `src/types.ts`

**Intent**: Reuse the decimal validators instead of duplicating them, and add the S-03 types.

**Contract**:

- Move `toHundredths`, `hasAtMostTwoDecimals` and `decimalField` from `bonus-config.ts:76-87` into `forms.ts` as exports; `bonus-config.ts` imports them, with no behaviour change.
- Add `formatPercent(value: number)` using `Intl.NumberFormat("pl-PL", { style: "percent", maximumFractionDigits: 0 })`.
- Add types:
  - `Employee`: id, supervisor_id, full_name, email, job_role_id, profile_id, invited_at, activated_at
  - `InviteStatus = "not_invited" | "invited" | "active"`
  - `EmployeeTimeShare`: employee_id, open_total, over_allocated
  - `Engagement`: id, milestone_id, employee_id, time_share, rating

#### 2. Employees service

**File**: `src/lib/services/employees.ts`

**Intent**: Validation, the error catalog, reads and writes for employees, and the invite call, mirroring `projects.ts`.

**Contract**:

- Catalog `EMPLOYEES_ERROR_MESSAGES`, with these codes:
  - `invalid_form`, `invalid_id`, `required`, `too_long`, `invalid_email`, `not_found`, `save_failed`, `not_configured`
  - `owner_not_supervisor` (MR001), `employee_has_open_engagements` (MR008), `email_locked` (MR009), `job_role_archived` (MR010)
  - `registration_failed`: generic, used for 23505 on email and for `email_unavailable`. Text: "Could not register this employee. Check the email or contact an Admin."
  - `already_active`, `invite_failed`
- `employeeInputSchema` (full_name, email lowercased and trimmed, job_role_id), plus `adminEmployeeInputSchema` which adds `supervisor_id`.
- Functions:
  - `listEmployees(sb, { ownerId? })`: Supervisors pass their own id so read-only engaged rows are excluded. Results are joined with the job role name and `employee_time_share_totals`.
  - `createEmployee`, `updateEmployee`
  - `inviteEmployee(sb, id)`: calls `sb.functions.invoke("invite-employee", { body: { employee_id } })` and maps the function's `code` to the catalog.
  - `inviteStatus(employee)`: derives an `InviteStatus`.
- `employeesUrl(flash, employeeId?)` redirect helper.

#### 3. Routes

**File**: `src/pages/api/employees/index.ts`, `src/pages/api/employees/[id].ts`, `src/pages/api/employees/[id]/invite.ts`

**Intent**: `POST`-only handlers for create, update and invite, following the existing route sequence. The schema depends on role, as in `api/projects/index.ts:19`.

**Contract**: each redirects 302 to `/employees?saved=…` or `/employees?error=<code>&field=…&employee=<id>`.

#### 4. Page and component

**File**: `src/pages/employees/index.astro`, `src/components/employees/EmployeeForm.astro`

**Intent**: One page with the employees table and a register form below it.

**Contract**:

- Table columns:
  - name, email, job role
  - owner (Admin only)
  - status badge (Not invited / Invited / Active)
  - open total as a percentage, with the red pill (`src/pages/projects/index.astro:143-147` style) when `over_allocated`
  - actions: an Edit `<details>` row, and a Send/Resend invite form that is hidden when Active
- The total's column header says "Open total (your milestones)" for Supervisors and "Open total (all milestones)" for Admins.
- The email input is disabled once invited.
- The owner select appears for Admins only (`listSupervisors`), and the job-role select lists active roles only.

#### 5. Middleware and navigation

**File**: `src/middleware.ts`, `src/components/Topbar.astro`, `src/pages/dashboard.astro`

**Intent**: Only Supervisors and Admins reach employees; add an "Employees" link beside "Projects".

**Contract**: add `/employees` and `/api/employees` to `PROTECTED_ROUTES` and `PROJECT_ROUTES`, and update the constant's doc comment to "Supervisor/Admin pages".

### Success Criteria:

#### Automated Verification:

- Type check passes: `npx astro sync && npx astro check`
- Lint passes: `npm run lint`
- Build passes: `npm run build`
- Smoke passes: `npm run smoke`

#### Manual Verification:

- Seed Supervisor sees `…0031` (Active, 110% flagged) and `…0032` (Not invited)
- Register and edit an employee; archived job role not offered; email locked after invite; Send invite works via Inbucket
- supervisor2 sees none of supervisor1's employees; duplicate email (e.g. `employee@meritly.local`) shows only the generic message
- Admin sees all with owner column, registers for supervisor2, and moving `…0031` is refused with the open-engagements message
- Employee user gets 403 on `/employees`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Assignment UI

### Overview

This phase adds the milestone page where the owning Supervisor manages assignments and sees each employee's open total and flag. The project page gets links to it.

### Changes Required:

#### 1. Engagements service

**File**: `src/lib/services/engagements.ts`

**Intent**: Validation, the error catalog, reads and writes for engagements.

**Contract**:

- Catalog codes:
  - `invalid_form`, `invalid_id`, `required`, `not_found`, `save_failed`, `not_configured`
  - `time_share_range`, `rating_range`
  - `already_assigned` (23505), `milestone_closed` (MR007)
  - `employee_not_available` (MR011, and also used when the employee is not in the assignable list)
  - `admin_read_only`
- Schemas:
  - `timeShareField`: `decimalField`, > 0 and ≤ 1.00 in hundredths
  - `ratingField`: integer 1–5
  - `engagementInputSchema` (employee_id, time_share, rating) and `engagementUpdateSchema` (time_share, rating)
- Functions:
  - `listEngagements(sb, milestoneId)`: with employee name, job role and totals.
  - `listAssignableEmployees(sb, ownerId)`: owned employees not yet on this milestone.
  - `createEngagement`, `updateEngagement`
  - `deleteEngagement`: uses `.select("id")`, and zero rows map to `not_found`.
- Map MR007 and MR011 through the same `GUARD_ERROR_CODES` approach as `projects.ts:224-229`.

#### 2. Routes

**File**: `src/pages/api/projects/[id]/milestones/[milestoneId]/engagements/index.ts`, `…/engagements/[engagementId].ts`, `…/engagements/[engagementId]/delete.ts`

**Intent**: `POST` create, update and delete. Admins get an early `admin_read_only` redirect, while RLS remains the real enforcement (`api/projects/[id]/milestones/index.ts:24-27` pattern).

**Contract**: each redirects to `/projects/[id]/milestones/[milestoneId]?saved=…|error=…&engagement=<id>`.

#### 3. Milestone page and component

**File**: `src/pages/projects/[id]/milestones/[milestoneId].astro`, `src/components/engagements/EngagementForm.astro`

**Intent**: The milestone header plus the engagements table and forms.

**Contract**:

- Header: the milestone's name, period, status and target pool, with a back link to the project.
- Table: employee, job role, time share (%), rating, open total (%) with the red pill when `over_allocated`, then Edit (`<details>`) and Delete (a small POST form).
- The add form shows `listAssignableEmployees`.
- Forms are hidden when the viewer is an Admin, or when the milestone or project is `completed`/`cancelled`. The UI mirrors MR007, and the trigger is the real enforcement.
- A milestone that isn't visible returns the not-found state, like `projects/[id].astro`.

#### 4. Project page links

**File**: `src/pages/projects/[id].astro`

**Intent**: Each milestone row's name links to its milestone page.

**Contract**: the name cell in the data row (`:177-221`) becomes a link to `/projects/${id}/milestones/${milestone.id}`.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npx astro sync && npx astro check`
- Lint passes: `npm run lint`
- Build passes: `npm run build`
- Smoke passes: `npm run smoke`
- DB tests pass: `npx supabase test db`

#### Manual Verification:

- Milestone 1 shows `…0031` at 60%, rating 4, total 110% flagged; add (`…0032` at 0.30, rating 3), edit (to 0.25), range errors (0 and 1.5) and delete for `…0032` work; no duplicate offer
- Completing Milestone 2 hides its forms, drops the total to 60% unflagged, and crafted POSTs return the closed message
- supervisor2 gets not-found on the milestone URL; Admin sees assignments read-only with all-milestone totals

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Docs and production rollout

### Overview

This phase documents the new surfaces and runbook, then rolls the feature out to the hosted Supabase project and the Worker using Resend as the SMTP provider, finishing with a real invite.

### Changes Required:

#### 1. Contract registry

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Register every new contract surface.

**Contract**:

- Registry rows:
  - both tables and the view (`security_invoker`)
  - `owns_milestone` and `employee_engaged_on_own_milestone` (definer, stable)
  - the three trigger functions and their triggers, including `on_auth_user_confirmed` on `auth.users`
  - the replaced MR005 function
  - the new TS types and the `forms.ts` exports
  - the middleware constants
  - the `invite-employee` Edge Function (request/response codes)
- Custom SQLSTATEs table: MR007–MR011, plus the note that MR001/MR005 now also cover employees.
- Policy conventions: the first delete policy (engagements), and column-level grants as the pattern for system-written columns.

#### 2. README and CLAUDE.md

**File**: `README.md`, `CLAUDE.md`

**Intent**: Keep onboarding and agent guidance accurate.

**Contract**:

- **README, local dev:** `npx supabase functions serve` for invites, Inbucket at `http://127.0.0.1:54324`, the seed's four accounts plus the seeded employees (this also fixes the stale "three local accounts" line).
- **README, production deploy runbook** (the Phase 5 steps below).
- **CLAUDE.md:**
  - Auth-flow bullets for `/auth/confirm` + `/auth/set-password`.
  - An `invite-employee` Edge Function note: the only secret-key code, running in Supabase, not the Worker.
  - `/employees` in the middleware description.

#### 3. Production rollout (human-run steps, recorded in the README runbook)

**File**: none (hosted Supabase project, Resend, Cloudflare); record outcomes in this plan's Progress

**Intent**: Make invites work for real employees in production.

**Contract** (ordered):

1. **[HUMAN]** Create a Resend account, add a domain you control, and publish its SPF/DKIM DNS records until Resend shows the domain as verified. Create an API key.
2. **[HUMAN]** Supabase dashboard → Authentication → SMTP Settings. Enable custom SMTP with host `smtp.resend.com`, port `465`, user `resend`, the password set to the Resend API key, and a sender address on the verified domain.
3. **[HUMAN]** Set up the Invite email template with the same link as `supabase/templates/invite.html`. Confirm the Site URL is `https://meritly.meritly.workers.dev` and that it is in Redirect URLs.
4. **[AGENT/HUMAN]** Run `npx supabase link --project-ref <ref>`, then `npx supabase db push`, which applies all pending migrations including S-01/S-02 if they were never pushed. Verify with `npx supabase migration list`.
5. **[AGENT/HUMAN]** Run `npx supabase functions deploy invite-employee`.
6. **[AGENT/HUMAN]** Run `npm run build && npx wrangler deploy`.
7. **[HUMAN]** In the production SQL editor, promote your own account to `supervisor` (roles have no UI, per F-01).
8. **[HUMAN]** Register an employee with an external mailbox you control, send the invite, accept it, set a password and sign in. Check that the employee lands on the dashboard and that `activated_at` is set.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint` (covers the README/CLAUDE.md prettier hook scope)
- Type check and build still pass: `npx astro check && npm run build`
- Remote migrations match local: `npx supabase migration list` shows no pending migrations

#### Manual Verification:

- The Resend domain shows verified and the Supabase SMTP test succeeds
- A production invite reaches an external mailbox from the verified sender; set-password and sign-in work on the production URL
- In production the promoted Supervisor sees only their own employees, and the employee account gets 403 on `/employees`

**Implementation Note**: This phase contains human-only steps. Pause after the docs changes and walk through the rollout checklist with the human.

---

## Testing Strategy

### Unit Tests:

- None. The repo has no unit-test framework (`CLAUDE.md`). zod schema behaviour is verified through the manual form checks.

### Integration Tests:

- `supabase/tests/employees_rls.test.sql` is the automated proof of every privacy, ownership and guard rule, and it runs in CI's `smoke` job (`ci.yml:43-44`).
- `npm run smoke` guards against auth regressions from the middleware and signin changes.

### Manual Testing Steps:

1. Local: `db reset` and `supabase start`, then `functions serve` and `npm run dev`. Sign in as `supervisor@meritly.local`.
2. Invite `…0032` from `/employees`, open the email in Inbucket, set a password, then sign in as that employee. `/employees` and `/projects` return 403.
3. Assign, edit and delete on Milestone 1, and check the flag at 110% versus after completing Milestone 2.
4. Repeat the cross-owner checks as `supervisor2@meritly.local` and the Admin checks as `admin@meritly.local`.
5. Production: the Phase 5 steps 1–8.

## Performance Considerations

- The `owns_milestone()` / `employee_engaged_on_own_milestone()` per-row calls in access rules are acceptable at MVP scale, the same accepted tradeoff as S-02 impl-review F4.
- Indexes on `employees.supervisor_id`, `milestone_engagements.employee_id` and the unique `(milestone_id, employee_id)` cover the helper lookups and the view.

## Migration Notes

- The migration is additive. Replacing `profiles_block_owner_role_change()` keeps MR005 semantics for projects.
- Production has had no migrations applied under S-03 before. `db push` also applies any earlier unapplied migrations in order.
- A rollback before production use is to drop the two tables, the view, the helpers, the triggers and the `auth.users` trigger, and restore the previous MR005 function body.

## References

- Research (all user decisions, dated follow-ups): `context/changes/supervisor-assigns-employee-engagement/research.md`
- Guard pattern: `supabase/migrations/20260927130000_milestones_guard_ownership.sql:23-26`
- Owner and MR005 guards: `supabase/migrations/20260927120000_projects_and_milestones.sql:138-162,248-277`
- Service and route pattern: `src/lib/services/projects.ts:13-240,346-357`, `src/pages/api/projects/[id]/milestones/index.ts:13-40`
- Decimal helpers: `src/lib/services/bonus-config.ts:69-95`
- pgTAP pattern: `supabase/tests/projects_rls.test.sql`
- Supabase docs (Context7 `/websites/supabase_guides`):
  - auth/users (inviteUserByEmail)
  - auth-email-templates (`token_hash` + `verifyOtp`)
  - functions/auth (`withSupabase`, `auth: 'user'`)
  - getting-started/api-keys (`SUPABASE_SECRET_KEYS`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database, access rules and tests

#### Automated

- [x] 1.1 Migration and seed apply cleanly: `npx supabase db reset`
- [x] 1.2 All pgTAP suites pass, including the new one: `npx supabase test db`
- [x] 1.3 Existing suites unchanged and green (profiles, bonus_config, projects), including the global "every view is security_invoker" check

#### Manual

- [x] 1.4 In Studio, the seeded employee `…0031` shows `open_total = 1.10` / `over_allocated = true` in `employee_time_share_totals` when queried as the seed Supervisor

### Phase 2: Invite and account activation

#### Automated

- [ ] 2.1 Type check passes: `npx astro sync && npx astro check`
- [ ] 2.2 Lint passes: `npm run lint`
- [ ] 2.3 Build passes: `npm run build`
- [ ] 2.4 DB tests still pass: `npx supabase test db`
- [ ] 2.5 Smoke still passes against a local preview: `npm run smoke`

#### Manual

- [ ] 2.6 Function call as seed Supervisor for `…0032` returns 200, invite in Inbucket, `profile_id`/`invited_at` set
- [ ] 2.7 Invite link lands on `/auth/set-password` signed in; password set; re-sign-in works; `activated_at` set
- [ ] 2.8 Resend before acceptance delivers a fresh email; activated employee returns 409 `already_active`
- [ ] 2.9 supervisor2 gets 404 and the employee user gets 403 from the function
- [ ] 2.10 Expired or reused link lands on sign-in with the fixed invite message

### Phase 3: Employees UI

#### Automated

- [ ] 3.1 Type check passes: `npx astro sync && npx astro check`
- [ ] 3.2 Lint passes: `npm run lint`
- [ ] 3.3 Build passes: `npm run build`
- [ ] 3.4 Smoke passes: `npm run smoke`

#### Manual

- [ ] 3.5 Seed Supervisor sees `…0031` (Active, 110% flagged) and `…0032` (Not invited)
- [ ] 3.6 Register and edit an employee; archived job role not offered; email locked after invite; Send invite works via Inbucket
- [ ] 3.7 supervisor2 sees none of supervisor1's employees; duplicate email shows only the generic message
- [ ] 3.8 Admin sees all with owner column, registers for supervisor2, and moving `…0031` is refused with the open-engagements message
- [ ] 3.9 Employee user gets 403 on `/employees`

### Phase 4: Assignment UI

#### Automated

- [ ] 4.1 Type check passes: `npx astro sync && npx astro check`
- [ ] 4.2 Lint passes: `npm run lint`
- [ ] 4.3 Build passes: `npm run build`
- [ ] 4.4 Smoke passes: `npm run smoke`
- [ ] 4.5 DB tests pass: `npx supabase test db`

#### Manual

- [ ] 4.6 Milestone 1 shows `…0031` at 60%, rating 4, total 110% flagged; add, edit, range errors and delete for `…0032` work; no duplicate offer
- [ ] 4.7 Completing Milestone 2 hides its forms, drops the total to 60% unflagged, and crafted POSTs return the closed message
- [ ] 4.8 supervisor2 gets not-found on the milestone URL; Admin sees assignments read-only with all-milestone totals

### Phase 5: Docs and production rollout

#### Automated

- [ ] 5.1 Lint passes: `npm run lint`
- [ ] 5.2 Type check and build still pass: `npx astro check && npm run build`
- [ ] 5.3 Remote migrations match local: `npx supabase migration list` shows no pending migrations

#### Manual

- [ ] 5.4 The Resend domain shows verified and the Supabase SMTP test succeeds
- [ ] 5.5 A production invite reaches an external mailbox from the verified sender; set-password and sign-in work on the production URL
- [ ] 5.6 In production the promoted Supervisor sees only their own employees, and the employee account gets 403 on `/employees`
