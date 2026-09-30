---
date: 2026-09-29T17:08:54+02:00
researcher: Claude (Opus 5.5) for ssliwa
git_commit: 92b03dd3a5c486a3b1071867d412275af941397b
branch: develop
repository: 10x-Meritly
topic: "S-03 supervisor-assigns-employee-engagement — what the codebase already provides for employee registration (FR-007), milestone engagement (FR-008) and the >100% time-share flag (FR-011)"
tags: [research, codebase, supabase, rls, profiles, job_roles, milestones, engagement, middleware, services]
status: complete
last_updated: 2026-09-29
last_updated_by: Claude (Opus 5.5) for ssliwa
last_updated_note: "Follow-up 2026-09-29 — user decision on employee onboarding (Supervisor adds employees; employee only logs in and sets a password); external research on Supabase invite vs signup-allowlist mechanisms. Supersedes Open Question 1 options (a) and (c)."
---

# Research: S-03 supervisor-assigns-employee-engagement

**Date**: 2026-09-29T17:08:54+02:00
**Researcher**: Claude (Opus 5.5) for ssliwa
**Git Commit**: 92b03dd3a5c486a3b1071867d412275af941397b (local only, no remote configured, so there are no permalinks)
**Branch**: develop
**Repository**: 10x-Meritly

## Research Question

What does the codebase already provide, and which conventions and prior decisions constrain the S-03 slice? The slice has three parts (`context/foundation/roadmap.md:115-126`, `context/foundation/prd.md:88-100`):

- A Supervisor registers an employee with a job role that carries a weight (FR-007).
- The Supervisor assigns that employee to a milestone with a time-share (0-1) and a contribution rating (1-5) (FR-008).
- The Supervisor sees a flag when the employee's total time-share across active milestones exceeds 100% (FR-011, informational only).

## Summary

- **Nothing for S-03 exists yet.** A grep of `supabase/migrations/`, `supabase/tests/` and `src/` found no employee, engagement, assignment or time-share table, column, type, route or page. The only related artifacts:
  - the `rating_factor_1..5` columns (`supabase/migrations/20260926120000_bonus_rules_config.sql`)
  - `AppRole` / `Profile` in `src/types.ts:2-10`
- **An "employee" today is an auth user with a `profiles` row** whose `role = 'employee'` (`20260925120000_role_and_rls_scaffold.sql:7,12-18`). Profiles are created only by the `on_auth_user_created` trigger. No API role has an insert or delete policy, and the migration says this is deliberate (`…role_and_rls_scaffold.sql:90-96`).
  - So under current rules a Supervisor cannot create an employee record for someone without an account.
  - Only `SUPABASE_URL`/`SUPABASE_KEY` are Worker secrets (`context/foundation/infrastructure.md:80`) and `CLAUDE.md` confines the service-role key to server-side code, never user-facing handlers, which rules out `auth.admin.createUser` / invite flows from the app.
  - **This is the main open decision for `/10x-plan`.**
- **The "role" in FR-007 is a job role (`public.job_roles`), not the access role (`app_role`).** They are separate by decision (`context/archive/2026-09-25-role-and-rls-scaffold/plan.md:40`). S-01 handed S-03 the job for "adding the FK to `job_roles`" (`context/archive/2026-09-26-admin-configures-bonus-rules/plan.md:49`). Nothing links a profile to a job role yet (`src/types.ts:5-10`).
- **Engagement access has a ready-made anchor.** `public.owns_project(project_id)` exists: SECURITY DEFINER, `search_path=''`, granted to authenticated (`20260927120000_projects_and_milestones.sql:100-118`). Milestone RLS is written in terms of it, and engagement RLS can follow milestone → project the same way.
- **"Active milestone" is not defined anywhere for FR-011.** Milestone status is `text` with the check `('planned','active','completed','cancelled')` (`20260927120000_projects_and_milestones.sql:83`). S-05 plans to add `approved`. S-02 recommends exclusion filters (`<> 'cancelled'`) so a new status is not silently dropped (`20260927120000_projects_and_milestones.sql:365`).
- **The app layer has one uniform pattern to copy:** a plain HTML form, then a `POST` APIRoute, then `parseForm` + a zod schema in the service file, a service call with the user-scoped Supabase client, and a 302 redirect with `?saved=` / `?error=<code>&field=`. Engagement routes nested under `/api/projects/[id]/milestones/[milestoneId]/…` inherit the existing Supervisor/Admin middleware guard. A top-level `/employees` route does not.

## Detailed Findings

### Identity: profiles and access roles (F-01)

- `public.app_role` enum is `('admin','supervisor','employee')` (`20260925120000_role_and_rls_scaffold.sql:7`).
- `public.profiles` columns: `id` (PK, FK `auth.users` on delete cascade), `email`, `display_name`, `role default 'employee'`, `created_at`. There is no `updated_at` (`…role_and_rls_scaffold.sql:12-18`).
- Rows are inserted by `handle_new_user()` via trigger `on_auth_user_created`, which is SECURITY DEFINER with `search_path=''` (`…role_and_rls_scaffold.sql:28-45`). Every signup therefore starts as `employee`.
- Helpers `current_app_role()`, `is_admin()` and `is_supervisor()` are granted to authenticated (`…role_and_rls_scaffold.sql:52-87`). There is no `is_employee()`.
- Select policies on `profiles`:
  - own row (`…:98-102`)
  - **supervisor sees every profile** (`…:104-108`)
  - admin sees every profile (`…:110-114`)
- Only Admin has an update policy (`…:116-121`).
- Supervisor-sees-all was chosen so that "S-03 can list employees to assign without rewriting F-01's policy" (`context/archive/2026-09-25-role-and-rls-scaffold/plan-brief.md:24`). Consequence: any employee picker must filter `role = 'employee'` itself, because RLS also returns admin and supervisor rows.
- Guard `profiles_block_owner_role_change` (MR005) blocks demoting a Supervisor who owns projects (`20260927120000_projects_and_milestones.sql:248-277`).
- In local development, users are seeded directly into `auth.users` + `auth.identities` (`supabase/seed.sql:18-91`). The seed employee user is `…0003`. `supabase/config.toml` has `enable_signup = true` and `enable_confirmations = false`, so self-signup works locally.

### Job roles and rating factors (S-01)

- `public.job_roles` (`20260926120000_bonus_rules_config.sql:15-27`):
  - columns: `id`, `name`, `weight numeric(4,2)` with a check `> 0 and <= 3`, `description`, `archived_at`, audit fields
  - unique `lower(name)` (`…:30`)
  - 8 seeded rows (`…:179-188`)
- `…:12-13` states: "new assignments must pick only rows with archived_at is null". Archived rows stay readable for existing references.
- The rating→factor mapping is in singleton `public.bonus_settings`: `rating_factor_1..5 numeric(4,2)`, non-decreasing, defaults 0.80/0.90/1.00/1.10/1.20 (`…:39-76,177`). S-03 stores only the integer rating 1-5. Turning a rating into a factor is S-04's job.
- Freezing contract: config is not versioned; "S-04/S-05 must snapshot the values they used onto their own result rows" (`…:8-9`). S-03's links to `job_role_id` hold the current value and need no snapshot.
- RLS: Supervisors can select `job_roles`, Employees see nothing, and neither table has a delete policy (`…:108-159`).

### Projects and milestones (S-02)

- `projects.supervisor_id` is the owner, `not null default auth.uid()`, with `on delete restrict` (`20260927120000_projects_and_milestones.sql:36-54`).
- `milestones` has `project_id` (immutable, MR006), `status` text with the four-value check, and `target_pool numeric(12,2)` (`…:68-86`).
- Milestones RLS:
  - Supervisor select, insert and update via `public.owns_project(project_id)`
  - Admin select only
  - no delete policy for any role (`…:335-358`)
- Guard trigger `milestones_check_parent`: SECURITY DEFINER, reads the parent `for share`, raises MR002/MR003/MR006 (`…:167-207`).
  - The redefinition in `20260927130000_milestones_guard_ownership.sql:23-26` first raises `42501` when `auth.uid() is not null and not owns_project(new.project_id)`. This stops the definer trigger leaking foreign-project data before RLS runs.
  - Any S-03 guard trigger that reads a milestone or project should repeat this ordering.
- SQLSTATE catalog MR001-MR006 is at `…projects_and_milestones.sql:5-11`. The next free code is MR007.
- View `project_budget_exposure` uses `security_invoker = true` (`…:368-392`). This is the precedent for any time-share aggregate view.
- `money_floor_mul` is at `…:20-30`. Not needed by S-03.

### App layer: services, routes, pages, middleware

**Services** (`src/lib/services/projects.ts`):

- error catalog `PROJECTS_ERROR_MESSAGES` (`:13-34`)
- zod field builders (`:71-125`) and schemas (`:137-159`)
- `parseForm` wrapper (`:167-172`)
- redirect helpers `projectUrl(id, section, flash, milestoneId?)` (`:199-203`)
- `ServiceResult` / `WriteResult` (`:211-219`)
- `mapPostgrestError`: 23505 → duplicate, 23514 → rule_violation, 42501 → not_found, MR* → guard code (`:224-240`)
- `listSupervisors` (`:346-357`) is the direct template for a `listEmployees`.

**Decimal validation** (`src/lib/services/bonus-config.ts:76-95`):

- `decimalField()` accepts at most 2 decimals.
- `kpiWeight()` is a [0,1] range check in integer hundredths. It is the closest template for `time_share`.
- These helpers are module-private today, so reuse means exporting them or moving them to `src/lib/forms.ts`.
- Aggregate comparisons should use integer hundredths, following the comment at `bonus-config.ts:69-74` (0.3+0.3+0.25+0.15 ≠ 1 in floating point). This applies to the >100% check.

**Form helpers** (`src/lib/forms.ts:9-40`): `FormError`, `firstIssueError` and `parseForm`, which turns a non-form body into `invalid_form` rather than a 500.

**Types** (`src/types.ts`, 70 lines): `Profile`, `JobRole`, `BonusSettings`, `WorkStatus`, `Project`, `Milestone`, `ProjectExposure`. There is no Employee or Engagement type.

**Routes:**

- Each route exports only `POST` and follows the sequence `createClient` → id `safeParse` → optional role check → `parseForm` → service → `context.redirect`.
- Example: `src/pages/api/projects/[id]/milestones/index.ts:13-40`, which includes an Admin early `admin_read_only` redirect "RLS is the real enforcement" (`:24-27`).
- `src/pages/api/auth/signup.ts` is an older pattern without zod. Don't copy it.

**Pages:**

- `src/pages/projects/[id].astro` renders milestones as one `<tbody>` per milestone, with data, notes and edit `<details>` rows (`:177-221`).
- Engagement UI could go in:
  - another `<details>` row per milestone, or
  - a new sub-page `src/pages/projects/[id]/milestones/[milestoneId].astro`. Astro allows a folder beside the `[id].astro` file.
- The over-budget pill in `src/pages/projects/index.astro:143-147` is the ready-made red-flag style for >100%.
- `src/lib/format.ts` has only `formatPln`. A percent formatter would be new.
- Only shadcn `button` is installed. The other app pages have no React islands; React is used on auth pages only.

**Middleware** (`src/middleware.ts:5-10`):

- `PROTECTED_ROUTES` = `/dashboard, /admin, /api/admin, /projects, /api/projects`
- `ADMIN_ROUTES` = `/admin, /api/admin`
- `PROJECT_ROUTES` (supervisor or admin) = `/projects, /api/projects`
- Matching is `startsWith` (`:10`).
- A new top-level `/employees` / `/api/employees` must be added to `PROTECTED_ROUTES` and to `PROJECT_ROUTES` or a new role list. Otherwise signed-in employees reach it and only RLS stops them.
- Navigation links live in `src/components/Topbar.astro:14-18` and `src/pages/dashboard.astro:85-92`.

**Tests:**

- pgTAP suites: `supabase/tests/{profiles,bonus_config,projects}_rls.test.sql`. Fixture UUID ranges `…01xx`-`…03xx` are taken, so `…04xx` is presumably next.
- `scripts/smoke.mjs` covers 8 auth steps only and does not touch `/projects`.

## Code References

- `supabase/migrations/20260925120000_role_and_rls_scaffold.sql:12-18,28-45,90-121`: profiles table, signup trigger, policies (no insert/delete)
- `supabase/migrations/20260926120000_bonus_rules_config.sql:8-13,15-30,39-76`: freezing note, job_roles, rating factors
- `supabase/migrations/20260927120000_projects_and_milestones.sql:5-11`: MR SQLSTATE catalog
- `supabase/migrations/20260927120000_projects_and_milestones.sql:83`: milestone status values
- `supabase/migrations/20260927120000_projects_and_milestones.sql:100-118`: `owns_project`
- `supabase/migrations/20260927120000_projects_and_milestones.sql:335-358`: milestones RLS
- `supabase/migrations/20260927120000_projects_and_milestones.sql:365-392`: exclusion-filter note, security_invoker view
- `supabase/migrations/20260927130000_milestones_guard_ownership.sql:23-26`: 42501-first guard ordering
- `src/lib/services/projects.ts:224-240,346-357`: error mapping, `listSupervisors` template
- `src/lib/services/bonus-config.ts:69-95`: hundredths arithmetic, decimal/[0,1] validators
- `src/lib/forms.ts:9-40`: `parseForm`, `firstIssueError`
- `src/middleware.ts:5-10`: route guard lists
- `src/pages/projects/[id].astro:177-221`: per-milestone table rows
- `src/types.ts:2-19`: `AppRole`, `Profile`, `JobRole`
- `docs/reference/contract-surfaces.md`: register new table, route and error-code names here (per S-02 plan)

## Architecture Insights

- **RLS conventions:**
  - RLS is enabled in the creating migration, followed by `revoke all … from anon` (S-02 also revokes truncate/references/trigger from authenticated).
  - One policy per operation per role, named `<table>_<op>_<role>`, all `to authenticated`.
  - Helpers are wrapped as `(select public.fn())`.
  - Deliberately absent policies are documented in a comment.
- **No delete policies:** mistakes are handled by status or `archived_at`, never by deleting rows (S-02 `plan.md:69`). Whether engagements follow this rule is open (see below).
- **Status columns** are `text` + named check (`<table>_<col>_<rule>`), not enums.
- **Numeric types:** money `numeric(12,2)`, weights and factors `numeric(4,2)`. No time-share precedent exists; `numeric(3,2)` would match the 2-decimal app validation.
- **SECURITY DEFINER** is used only where a check must see past RLS, always with `search_path=''`. Guard triggers use BEFORE row triggers, raise the 42501 ownership check first, read the parent `for share`, and use custom `MRxxx` codes mapped in the service's `GUARD_ERROR_CODES`.
- **Audit fields:** `created_at`, `updated_at`, `updated_by → profiles on delete set null`, set by trigger function `set_config_audit_fields()` (`20260926120000_bonus_rules_config.sql:86`), attached `before insert or update` (`20260927120000_projects_and_milestones.sql:123-129`).
- **Every service call runs as the signed-in user**, so RLS is the source of truth. Page and route role checks only give friendlier errors.

## Historical Context (from prior changes)

- `context/archive/2026-09-25-role-and-rls-scaffold/plan.md:40`: access roles ≠ job roles, separate concept and table. **Supported** by the M1/M2 schemas.
- `context/archive/2026-09-25-role-and-rls-scaffold/plan-brief.md:24`: Supervisors select all profiles so S-03 can list employees. **Supported** (`…role_and_rls_scaffold.sql:104-108`).
- `context/archive/2026-09-26-admin-configures-bonus-rules/plan.md:49` and `plan-brief.md:7,22,43`: S-03 adds the employee → `job_roles` FK. Archiving a job role never orphans linked employees. **Supported**: `archived_at` soft delete, no delete policy.
- `context/archive/2026-09-27-supervisor-creates-project-and-milestones/plan.md:68`: "No employee engagement or time-share (S-03), and no employee access to projects or milestones (S-05/S-06 add employee select policies)." S-03 therefore should not add employee select policies on projects or milestones.
- `context/archive/2026-09-27-supervisor-creates-project-and-milestones/plan.md:70`: Admin reads but does not write milestones. Whether this extends to engagements is undecided.
- S-02 `reviews/impl-review.md:39-59` (F1, fixed): a SECURITY DEFINER guard leaked foreign data before RLS. Fix pattern: 42501 first, plus pgTAP for foreign and employee inserts.
- S-02 `reviews/plan-review.md:34-47` (F1): race between trigger and concurrent write. Read the parent `FOR SHARE`.
- S-01 `reviews/impl-review.md:48-59` (F1, fixed): unguarded `formData()` gave a raw 500. Use `parseForm`.
- S-01 `reviews/impl-review.md:98-107` (F5): URLs carry only catalog error codes, never free text.
- `context/foundation/lessons.md` does not exist; the roadmap Done entries record "Lesson: —".

## Related Research

- `context/archive/2026-09-27-supervisor-creates-project-and-milestones/research.md`: S-02 research. Its milestone-status and exclusion-filter findings are reused above.

## Open Questions

These are decisions `/10x-plan` must settle. The inspected sources settle none of them.

1. **How to register an employee who has no account (FR-007).** _Partly settled by the user; see Follow-up below. Options (a) and (c) are superseded._ Current constraints: no profile insert policy, no service role in the app, and login is required for FR-012 later. Candidate shapes:
   - **(a) Link existing accounts.** The person signs up, becomes a default `employee` profile, and the Supervisor picks from `role = 'employee'` profiles. No new identity table is needed. The cost is that someone must sign up before they can be assigned.
   - **(b) Separate `employees` table.** It has name, email and job role, owned or created by a Supervisor, with a nullable `profile_id` linked later. This could use a signup-trigger match on email, which would be a SECURITY DEFINER extension of `handle_new_user`. Registration no longer depends on signup, but the plan must design the linking step and the email-match trust model.
   - **(c) Provisioning via SQL/Studio.** Out of the app, so it conflicts with FR-007's "Supervisor can register".
2. **Where the job role lives.** _Settled 2026-09-29: on the employee; see Follow-up._ A `job_role_id` on the employee (profile or employee table, global) or on each engagement row (per milestone). PRD FR-007 reads "register an employee with a role", which suggests an employee-level link. The S-01 hand-off says "employees → job_roles FK".
3. **Definition of "active milestone" for FR-011.** _Settled 2026-09-29: status not in (completed, cancelled), no date overlap; see Follow-up._ Options:
   - `status = 'active'`
   - `status not in ('completed','cancelled')`, which follows the exclusion-filter precedent but also needs a decision on the future `approved` status
   - either of the above combined with a date-overlap test
     The PRD's success metric wording "never exceeds 100%" (`prd.md:46`) conflicts with FR-011/US-01's "flagged" (`prd.md:63,99-100`). The Socrates resolution at `prd.md:100` makes it informational and non-blocking.
4. **Admin write access.** _Settled 2026-09-29: Admin read-only on engagements; Admin can register/invite employees and sees the flag; see Follow-up._ FR-007 says "Admin/Supervisor can register" (`prd.md:88`). The roadmap outcome names only the Supervisor (`roadmap.md:117`), and the S-02 precedent is Admin read-only on milestones.
5. **Removing or cancelling engagements.** _Settled 2026-09-29: hard delete while open; see Follow-up._ No delete policies exist anywhere so far. A mis-assigned employee needs some path out, such as a delete policy restricted to non-closed milestones or a status flag.
6. **Edits on closed parents.** _Settled 2026-09-29: blocked by a guard trigger; see Follow-up._ Should engagement writes be blocked when the milestone or project is `completed`/`cancelled` (an MR003-style guard, next code MR007)? Once S-05 adds `approved`, those milestones are frozen by invariant.
7. **Uniqueness.** _Settled 2026-09-29: unique (milestone, employee); see Follow-up._ One engagement row per (milestone, employee) looks natural but is not stated in any source.
8. **Supervisor visibility of engagements on other Supervisors' milestones.** _Settled 2026-09-29: own milestones only; see Follow-up._ The FR-011 aggregate spans every active milestone an employee is on (`roadmap.md:124`), including milestones owned by other Supervisors, which owner-scoped RLS would hide. The flag may need a SECURITY DEFINER aggregate that returns only the total per employee, or it may be limited to the Supervisor's own milestones. This affects the privacy invariant, so decide it explicitly.

## Follow-up 2026-09-29: employee onboarding decision

### User decision (settled)

The user decided that **the Supervisor adds employees to the app, and the employee only logs in and sets a password**. The employee does not self-register or fill in their own data.

- **Superseded:** Open Question 1 option (a), "people sign up first, the Supervisor picks existing profiles".
- **Superseded:** option (c), SQL/Studio provisioning.

The Supervisor must be able to create the employee record before any auth account exists.

### External evidence (Supabase docs via Context7, `/websites/supabase_guides`)

- **Invite API** (supabase.com/docs/guides/auth/users):
  - `auth.admin.inviteUserByEmail(email, { data, redirectTo })` creates an unconfirmed user and sends the _Invite user_ email template.
  - The link confirms the email and lets the user finish setup, e.g. by setting a password.
  - It is an admin action that needs the project **secret key** (`sb_secret_…`, the successor of the legacy `service_role` key), "only ever on a trusted server".
  - Inviting an already-confirmed email returns an error.
  - `redirectTo` must be in the allowed redirect URLs, otherwise it is silently ignored.
  - Links expire after the Email OTP Expiration (default 1 h). Locally `otp_expiry = 3600` (`supabase/config.toml:217`).
- **SSR invite link handling** (supabase.com/docs/guides/auth/auth-email-templates):
  - The template can point at a server route with `token_hash={{ .TokenHash }}&type=invite`.
  - That route calls `verifyOtp({ token_hash, type })` to get a session.
  - The user then sets a password with `auth.updateUser({ password })`.
  - The app has no such route today. `src/pages/auth/` holds only `signin`, `signup` and `confirm-email`, and nothing calls `verifyOtp` or `exchangeCodeForSession`.
- **Before-user-created hook** (supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook):
  - A Postgres function (or HTTP endpoint) receives the pending `user.email`.
  - It can reject signup with `{ error: { message, http_code: 403 } }`.
  - It must be granted to `supabase_auth_admin` and revoked from `anon`/`authenticated`/`public`.
  - Locally it is configured via `[auth.hook.before_user_created]`, currently commented out (`supabase/config.toml:261-264`).
- **Email delivery:** SMTP is not configured (`supabase/config.toml:219-222` is commented). Locally, emails go to the Inbucket/Mailpit test inbox. FR-016 (S-05) needs production SMTP anyway.

### Mechanisms that satisfy the decision

- **(I) Supabase invite.** The Supervisor adds an employee (name, email, job role). The server calls `inviteUserByEmail`. The employee clicks the email link, lands on a new `/auth/…` confirm route, and sets a password.
  - This matches "only log in and set password" most literally.
  - **Conflict:** it requires the secret key. `CLAUDE.md` confines that key to server-side code, never user-facing route handlers, and only `SUPABASE_URL`/`SUPABASE_KEY` are Worker secrets (`context/foundation/infrastructure.md:80`). Placement options:
    - **(I-a)** A Worker route with the secret key. This means explicitly amending the CLAUDE.md rule and the infrastructure secret list.
    - **(I-b)** A Supabase Edge Function that holds the key. It is called with the Supervisor's JWT and re-checks `is_supervisor()` before inviting. The key stays out of the Worker, but a new Deno runtime and deploy target enter the stack.
  - Both variants need SMTP in production, a confirm/set-password route, the invite template, and redirect-URL config.
- **(II) Pre-registration + signup allowlist.** The Supervisor inserts an `employees` row (name, email, job role) under normal RLS.
  - The employee opens the signup page and enters only a password; the email must match a pre-registered row.
  - A before-user-created hook rejects any email that is not pre-registered.
  - `handle_new_user` links the new profile to the `employees` row by email.
  - No secret key, and no email is needed for the MVP flow.
  - **Risk:** without email confirmation, anyone who knows a pre-registered address can claim that account first and then see that employee's Approved bonuses. This is the core privacy invariant. Enabling confirmation removes the risk but needs SMTP, so the email dependency returns. Confirmation is off locally (`config.toml:209`).
  - The existing signup/smoke flow must keep working. `scripts/smoke.mjs` signs up an arbitrary email, so an allowlist hook would break it unless the smoke script pre-registers the email or the hook exempts it.

### Implications common to (I) and (II)

- An `employees` record must exist before `auth.users`. It needs a nullable link to `profiles.id` that gets filled when the account is created.
- Engagements should reference that record, not `profiles.id`, so a Supervisor can assign someone who hasn't activated yet.
- `handle_new_user` (`…role_and_rls_scaffold.sql:28-39`) is where the link would be made. It is already SECURITY DEFINER with `search_path=''`.
- **Email trust:** link only on a confirmed email (the invite flow confirms by construction). The match should be case-insensitive and unique (`lower(email)` unique index).

### Mechanism decision (user, 2026-09-29)

The user chose **(I-b) Supabase invite via an Edge Function**. (I-a) and (II) are rejected.

- The Edge Function holds the secret key.
- It is called with the Supervisor's JWT.
- It re-checks `is_supervisor()` (and probably that the `employees` row belongs to the caller) before calling `inviteUserByEmail`.
- The Worker keeps only `SUPABASE_URL`/`SUPABASE_KEY`, so the `CLAUDE.md` service-role rule stands unchanged.

Items for `/10x-plan` to scope:

- **The Edge Function itself:**
  - Supabase Functions (Deno), under `supabase/functions/`
  - local run through `supabase functions serve`
  - a deploy step, a CI/smoke impact check, and function secrets
- **An `/auth/confirm` route** that handles `token_hash` + `type=invite` via `verifyOtp`.
- **A set-password page** that calls `auth.updateUser({ password })`.
- **Configuration:**
  - the invite email template
  - allowed redirect URLs
  - production SMTP, which is shared with FR-016
- **Re-sending invites:** links expire in 1 h, so a Supervisor needs a re-invite action. Inviting an already-confirmed email returns an error.
- **Linking** the new `auth.users`/`profiles` row to the `employees` record. Candidates: extend `handle_new_user`, or pass the `employees.id` in the invite's `data` (`user_metadata`). Note the `CLAUDE.md` rule: `user_metadata` is user-editable, so treat it as a hint and verify it against the email, never as authority.
- **External research still to do:** confirm the current Supabase Edge Function auth pattern (JWT verification, secret-key env name) before the plan fixes those names.

### "Active milestone" decision (user, 2026-09-29): settles Open Question 3

For FR-011, **an active milestone is any milestone whose status is not `completed` or `cancelled`**. With today's check constraint (`20260927120000_projects_and_milestones.sql:83`) that means `planned` and `active`.

- **No date-overlap test.** In the user-confirmed example, an `active` milestone (0.6) and a `planned` milestone (0.3) both count, giving a total of 0.9. The flag rule is total > 1.00, compared in integer hundredths.
- **Write the filter as an exclusion:** `status not in ('completed','cancelled')`, following the S-02 precedent (`…projects_and_milestones.sql:365`).
  - Consequence: the future S-05 `approved` status would count toward the total unless S-05 adds it to the exclusion.
  - The user has not ruled on `approved`. S-05 should revisit this rule when it adds the status.

### Cross-Supervisor visibility decision (user, 2026-09-29): settles Open Question 8

For FR-011, **the flag adds up only the milestones the signed-in Supervisor owns** (`owns_project(project_id)` via the milestone). The rest of the definition is unchanged: status not in (`completed`, `cancelled`), total > 1.00.

- **Accepted tradeoff:** an employee over-allocated only across different Supervisors' milestones is not flagged. For example, 0.6 on Supervisor A's milestone and 0.6 on Supervisor B's milestone flags for neither. This is narrower than the roadmap's "every active milestone they're on" wording (`context/foundation/roadmap.md:124`).
- **Consequence:** the aggregate can run as the signed-in user under the ordinary owner-scoped engagement RLS. That could be a `security_invoker = true` view or a service-side sum. No SECURITY DEFINER aggregate is needed, and no other Supervisor's data is exposed.
- **Admin:** by the same RLS, an Admin sees every engagement, so an Admin-facing total would span all Supervisors. Whether Admins see the flag is part of Open Question 4.

### Job-role placement and Admin engagement access (user, 2026-09-29): settles Open Questions 2 and 4

- **Q2: the job role belongs to the employee.** `employees.job_role_id` is a FK to `public.job_roles`, one global job role per employee, not per engagement.
  - This matches FR-007 ("register an employee with a role") and the S-01 hand-off (`context/archive/2026-09-26-admin-configures-bonus-rules/plan.md:49`).
  - New or changed links pick only non-archived job roles (`20260926120000_bonus_rules_config.sql:12-13`).
  - A later job-role change applies to future computations only. S-04/S-05 snapshot the weight onto result rows (`…bonus_rules_config.sql:8-9`).
- **Q4: Admins cannot add or edit engagements.** On the engagement table, Admin gets a select policy only, with no insert or update. This mirrors the S-02 milestone precedent (`context/archive/2026-09-27-supervisor-creates-project-and-milestones/plan.md:70`). The app layer should repeat the `admin_read_only` early redirect (`src/pages/api/projects/[id]/milestones/index.ts:24-27`).
- **Still open:**
  - Whether Admins can register or invite _employees_. FR-007 says "Admin/Supervisor can register", and the user's ruling covers engagements only.
  - Whether Admins see the >100% flag. Under Admin select-all it would span all Supervisors.

### Uniqueness decision (user, 2026-09-29): settles Open Question 7

**There is at most one engagement per (milestone, employee).**

- Enforce it with a unique constraint on `(milestone_id, employee_id)`.
- A duplicate insert raises 23505. The existing `mapPostgrestError` maps 23505 to `duplicate_name` (`src/lib/services/projects.ts:231-240`), so engagements need their own catalog code, for example `already_assigned`, instead of reusing the name-specific message.
- To change a time-share or rating, the Supervisor updates the existing row rather than adding a second one.

### Closed-parent decision (user, 2026-09-29): settles Open Question 6

**Engagement writes are blocked while the parent milestone or its project has status `completed` or `cancelled`.** This covers inserts, updates, and any removal path chosen for Open Question 5.

- **Enforce it in the database:** a BEFORE row guard trigger on the engagement table, following `milestones_check_parent`:
  - raise `42501` first when `auth.uid() is not null and not owns_project(...)` (`20260927130000_milestones_guard_ownership.sql:23-26`);
  - read the milestone and project rows `for share`, per the S-02 plan-review race note;
  - raise a new SQLSTATE, `MR007` for a closed milestone/project. It could reuse the MR003 meaning or be a distinct `milestone_closed` code, which the plan decides.
- **Add the code** to `GUARD_ERROR_CODES` (`src/lib/services/projects.ts:224-229`) and `docs/reference/contract-surfaces.md`.
- **The UI should hide or disable engagement forms** on closed parents, like `canEditMilestones` (`src/pages/projects/[id].astro:73`). The trigger remains the real enforcement.
- **Caveat:** milestone status transitions are not enforced (S-02 `plan.md:72`). A Supervisor can move a milestone back from `completed` to `active`, which unlocks its engagements. This is consistent with current S-02 behavior; the frozen-after-`approved` invariant arrives with S-05.

### Admin employee registration and flag visibility (user, 2026-09-29): closes the rest of Open Question 4

- **Admins can register and invite employees**, as FR-007 says ("Admin/Supervisor can register").
  - `employees` gets insert and update policies for both the Supervisor and the Admin role, one policy per operation per role.
  - The invite Edge Function must accept a caller for whom `is_supervisor()` **or** `is_admin()` is true.
  - The employee pages and routes must be reachable by both roles. A top-level `/employees` + `/api/employees` needs adding to `PROTECTED_ROUTES` and `PROJECT_ROUTES`, or to a new list with the same supervisor|admin rule (`src/middleware.ts:5-8`).
- **Admins see the >100% flag.** Admins can select every engagement (select-only, per Q4), so the Admin total spans all Supervisors' milestones. A Supervisor's total covers only their own milestones (Q8).
  - The same query or view works for both roles: RLS decides the scope, and no role branching is needed.
  - The same employee can therefore show different totals to an Admin and to a Supervisor. The UI should label the scope, for example "across your milestones" versus "across all milestones".
- **Surfaced by this decision, for `/10x-plan`:**
  - **Employee visibility.** Can every Supervisor see and assign every employee, or only the ones they registered? Assigning someone registered by another Supervisor or an Admin suggests a shared employee list.
  - **Who may edit** an employee's name or job role.

### Undo decision (user, 2026-09-29): settles Open Question 5

**A wrong assignment is hard-deleted** while its milestone and project are open.

- **This is the project's first delete policy.** Every table so far has none, and mistakes use `cancelled`/`archived_at` (S-02 `plan.md:69`).
  - Add `<engagement_table>_delete_supervisor` using `public.owns_project(...)` through the milestone.
  - Add no Admin delete policy (Q4: Admin is read-only on engagements) and no Employee delete policy. Document both absences in the migration comment, per convention.
- **The closed-parent guard (Q6) must also fire on DELETE:** `before insert or update or delete`, reading `OLD` on delete, and returning `OLD` from a BEFORE DELETE trigger, not `NEW`. It should still check ownership first (42501).
- **pgTAP expectation** (S-01 plan-review F3): a denied delete affects 0 rows and raises no error. Tests should assert the row still exists, not expect an exception, except where the guard trigger raises for an owned but closed parent.
- **App layer:** a `POST` delete route, since the app uses only POST routes with HTML forms (for example `…/engagements/[engagementId]/delete.ts`). Use the `.select("id")` zero-rows → `not_found` pattern from updates.
- **Freeze interaction:** deleting is harmless before S-04/S-05, because nothing is stored downstream yet. Once S-05 adds `approved`, deleting on approved milestones must be blocked, either by extending the closed-status guard or by S-05's freeze.

### Employee ownership and edit rights (user, 2026-09-29)

- **Each employee record is owned by one Supervisor.** A Supervisor sees and assigns only the employees they registered.
  - `employees` needs an owner column, for example `supervisor_id uuid not null default auth.uid()` referencing `profiles`, mirroring `projects.supervisor_id` (`20260927120000_projects_and_milestones.sql:36-54`).
  - Supervisor select policy: `supervisor_id = (select auth.uid()) and (select public.is_supervisor())`.
  - Admin select policy: all rows.
- **Only the Supervisor and the Admin can edit employees.** "Supervisor" means the owning Supervisor, consistent with the ownership rule above.
  - `employees_update_supervisor` uses the owner predicate in both `using` and `with check`.
  - `employees_update_admin` uses `(select public.is_admin())`.
  - Employees have no insert, update or delete rights on `employees`, not even on their own row.
- **Consequences for `/10x-plan`:**
  - **An Admin-registered employee needs an owner.** Otherwise no Supervisor can see or assign them. Follow the S-02 precedent:
    - the Admin picks the owning Supervisor (`adminProjectInputSchema`, `src/lib/services/projects.ts:140-142`; `listSupervisors`, `:346-357`);
    - a guard checks that the owner is a Supervisor (MR001 pattern, `…projects_and_milestones.sql:138-162`);
    - demoting a Supervisor who owns employees is blocked or handled (the MR005 pattern at `:248-277` currently checks projects only).
  - **Cross-owner assignment must be blocked in the database.** The engagement's employee must be owned by the Supervisor who owns the milestone's project.
    - RLS `with check` alone cannot see an employee row hidden from the caller. Checking `exists (select 1 from employees where id = employee_id and supervisor_id = auth.uid())` inside the insert policy works under the invoker's RLS, because a hidden row yields false.
    - Alternatively, add the check to the engagement guard trigger, ownership first (42501).
  - **Email uniqueness versus privacy.** Each auth account is unique per email, so `employees.email` should be unique case-insensitively.
    - A second Supervisor registering an email already owned by someone else gets a duplicate error on a row they cannot see. That leaks existence, a minor information disclosure.
    - It also means one person cannot be assigned by two Supervisors: owner-scoped employees plus a global unique email equals exactly one owner per person. An employee who moves between Supervisors needs an Admin reassignment (Admin update policy).
    - This is compatible with the Q8 decision (own milestones only).
  - **The >100% flag (Q8) simplifies.** A Supervisor's employees can only be on that Supervisor's milestones, so the per-Supervisor total equals the employee's full total. The only exception is engagements created before an Admin reassigns the employee: those stay on the old owner's milestones. The plan should decide whether reassignment is allowed while active engagements exist.
- **Invite Edge Function:** a Supervisor caller may invite only employees they own. An Admin caller may invite any employee.
- **`profiles` supervisor-select-all** (`…role_and_rls_scaffold.sql:104-108`) is unaffected, but pickers should read from `employees`, not `profiles`.

### Admin-registered employee ownership (user, 2026-09-29): confirmed

The user confirmed consequence 1 above as written; no further decision is needed:

- When an Admin registers an employee, the Admin picks the owning Supervisor. This follows the S-02 `adminProjectInputSchema` + `listSupervisors` precedent.
- A guard checks that the owner is a Supervisor (MR001 pattern).
- Demoting a Supervisor who still owns employees is blocked. This extends the MR005 `profiles_block_owner_role_change` check (`20260927120000_projects_and_milestones.sql:248-277`) from projects to employees.

### Duplicate-email message and reassignment rule (user, 2026-09-29)

- **The duplicate-email message stays generic.**
  - A 23505 on the employees email unique index maps to a catalog message that does not reveal that another Supervisor already registered the address. Example: "Could not register this employee. Check the email or contact an Admin."
  - It must not reuse `duplicate_name` wording (`src/lib/services/projects.ts:231-240`), and it must not echo the email back.
  - An Admin, who sees all employees, may get a specific message. The plan decides that.
- **An Admin cannot move an employee to another Supervisor while the employee is assigned to a milestone of a Supervisor other than the new owner.**
  - Enforce it in the database with a guard on `employees` update of `supervisor_id` (BEFORE UPDATE; new code `MR0xx`; ownership/role check first). It should reject when `exists` an engagement for this employee on a milestone whose project's `supervisor_id <> new.supervisor_id`.
  - Because of the ownership rule, every engagement sits on the current owner's milestones. In practice the rule therefore means an employee with any engagement cannot be moved until those engagements are deleted. Deletes are possible only on open milestones (Q5/Q6).
  - **Interpretation gap, for `/10x-plan` to confirm with the user:** the user's wording does not say whether engagements on `completed`/`cancelled` milestones also block the move.
    - If they do, an employee with any past closed-milestone history can never be reassigned, because closed engagements cannot be deleted.
    - Restricting the check to open milestones (`status not in ('completed','cancelled')`, matching the Q3 active definition) avoids the permanent lock but leaves history on the old owner's milestones. That is harmless for S-04, which computes per milestone.

### Reassignment scope (user, 2026-09-29): resolves the interpretation gap above

**Only engagements on open milestones block the move.** An open milestone is one whose status is not in (`completed`, `cancelled`), the same definition as Q3.

- The guard rejects an `employees.supervisor_id` change when an engagement exists for the employee on a milestone that is open (`m.status not in ('completed','cancelled')`) and whose project's `supervisor_id <> new.supervisor_id`.
- Engagements on closed milestones stay on the old owner's milestones as history and do not block the move.
- **Display consequence:** after a move, the old owner cannot see the moved employee. The old owner's closed-milestone engagements still reference that employee. The plan must decide how the old owner's milestone pages display an engagement whose employee row is no longer visible to them. For example, a join may return null for the name, so the page needs a fallback label, or engagement rows could carry a denormalized display name.
