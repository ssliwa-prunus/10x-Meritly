<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Supervisor Assigns Employee Engagement

- **Plan**: context/changes/supervisor-assigns-employee-engagement/plan.md
- **Scope**: Phases 1–4 of 5 (Phase 5 docs/rollout in progress, not reviewed)
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-09-30
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 5 warnings, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

Automated checks re-run on 2026-09-30: `astro sync && astro check` 0 errors, `eslint .` exit 0, `npm run build` exit 0. `supabase test db` and `npm run smoke` could not run because Docker/local Supabase was down. They are recorded as passing in Progress at c3a964c.

## Findings

### F1 — Admin project reassignment bypasses the employee-ownership invariant

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architecture
- **Location**: supabase/migrations/20260927120000_projects_and_milestones.sql:319 (projects_update_admin); supabase/migrations/20260929120000_employees_and_engagements.sql:212-223, 292
- **Detail**: MR008 blocks moving an _employee_ who has open engagements under another Supervisor, and MR011 checks team membership only on engagement INSERT. Nothing guards a change to `projects.supervisor_id`. An Admin can move a project whose open milestones hold engagements for the old owner's employees. After that, the new owner can update or delete engagements for employees they do not own, and `employee_time_share_totals` splits those employees' load across two Supervisors. The plan did not address this path, and pgTAP does not cover it.
- **Fix A ⭐ Recommended**: Add a guard (new SQLSTATE, e.g. MR012) on `projects` `before update of supervisor_id`. It raises while any engagement on an open milestone of that project belongs to an employee whose `supervisor_id <> new.supervisor_id`. Add pgTAP cases for the blocked and allowed moves.
  - Strength: Mirrors MR008 on the other side of the relationship; closes the invariant in the database, as CLAUDE.md requires.
  - Tradeoff: Admins must move the employees first (or together), which adds a new migration and an error-catalog entry in projects.ts.
  - Confidence: HIGH — same shape as the existing MR008 guard.
  - Blind spot: Whether an Admin workflow "move project and team together" is expected soon.
- **Fix B**: Document the behaviour as intended (an Admin move carries the engagements along) and add a pgTAP case that pins it.
  - Strength: No schema change.
  - Tradeoff: It breaks the "a Supervisor assigns only their own employees" rule, and totals are split across Supervisors.
  - Confidence: MED — depends on the product intent for Admin moves.
  - Blind spot: How S-05 bonus computation treats engagements whose employee has another owner.
- **Decision**: FIXED via Fix A — migration 20260930120000_projects_guard_engaged_owner_change.sql (MR012), projects.ts mapping, 2 pgTAP tests (plan 74), contract-surfaces rows. Verified: `supabase db reset` + `supabase test db` pass (4 files, 222 tests). Follow-up: milestone reopen is still unguarded (see follow-ups/review-fixes.md).

### F2 — Invite links the auth user without re-checking the row

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/functions/invite-employee/index.ts:97-100
- **Detail**: The function reads the employee (line 59), calls `inviteUserByEmail`, then updates `profile_id`/`invited_at` filtered only by `id`. The email is still editable until `invited_at` is set. If it changes between the read and the link, the invite goes to the old address, but the row with the new email is linked to the old address's auth user. The unconditional update also overwrites an existing `profile_id` on a re-invite.
- **Fix**: Add `.eq("email", employee.email).is("activated_at", null)` to the link update with `.select("id")`, and return 409 `invite_failed` (logged) when zero rows are updated.
  - Strength: A small, local change that makes the link conditional on the state the invite was based on.
  - Tradeoff: If the race does fire, an orphan invited auth user remains, but it is harmless and never linked.
  - Confidence: HIGH — standard optimistic-concurrency filter.
  - Blind spot: Whether `inviteUserByEmail` on a re-invite returns the same user id (probably yes), so overwriting `profile_id` may be a no-op in practice.
- **Decision**: SKIPPED

### F3 — set-password lets any session change the password without the current one

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/set-password.ts; supabase/config.toml:211 (`secure_password_change = false`)
- **Detail**: `/api/auth/set-password` is only behind `PROTECTED_ROUTES`. Any signed-in user, not only a freshly invited one, can set a new password without the current one. A stolen session cookie therefore becomes a permanent account takeover.
- **Fix A ⭐ Recommended**: Have `/auth/confirm` set a short-lived, httpOnly `invite_pending` cookie. The set-password page and API require it and clear it on success.
  - Strength: Limits the route to the flow it was built for; small change in 3 files.
  - Tradeoff: If the cookie expires before the password is set, the user needs a fresh invite link.
  - Confidence: HIGH — straightforward cookie gate.
  - Blind spot: Future "change password" or reset flows will need their own route.
- **Fix B**: Enable `secure_password_change` (local config and hosted dashboard).
  - Strength: Supabase-native reauthentication.
  - Tradeoff: It requires a recent sign-in or nonce, which may break the invite flow right after `verifyOtp`, and it needs manual testing.
  - Confidence: LOW — interaction with invite sessions not verified.
  - Blind spot: Supabase's exact semantics for a session created via OTP.
- **Decision**: FIXED differently — instead of a forgeable cookie, the middleware gate `SET_PASSWORD_ROUTES` admits only sessions whose verified JWT `amr` latest method is invite/otp (`isInviteSession` in src/lib/set-password.ts, via getClaims); after updateUser the API signs in with the new password so the invite session cannot be reused. No time window (confirming the invite sets activated_at, so an expired window would strand the employee). Verified against a local preview: a password session is redirected from GET/POST set-password to /dashboard; a generated invite link → /auth/confirm → set-password 200 → POST → /dashboard, then set-password redirects away (session swapped).

### F4 — Engagement routes: inconsistent milestone/project check and masked errors

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/projects/[id]/milestones/[milestoneId]/engagements/index.ts:36-39; [engagementId].ts; [engagementId]/delete.ts; index.ts:20,25
- **Detail**: The create route verifies that the milestone belongs to the URL project, but update and delete do not, so a crafted mismatched URL redirects to the wrong page. RLS still protects the data. In the create route, a `listMilestones` failure is reported as `not_found` rather than `save_failed`. `milestoneId` is validated with `projectIdSchema`, and `invalid_id` is hard-coded where siblings use `firstIssueError`.
- **Fix**: Map a `listMilestones` error to `save_failed`, and apply the same milestone∈project check (a single targeted lookup) in the update and delete routes.
- **Decision**: FIXED — new `isMilestoneInProject()` in engagements.ts (single targeted lookup); create, update and delete routes all use it, load errors map to save_failed.

### F5 — DB tests and smoke not re-verified in this review

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: N/A
- **Detail**: Docker was not running, so `npx supabase test db` (Phases 1, 2, 4) and `npm run smoke` (Phases 2–4) could not be re-run. Progress records them as passing at c3a964c, and the other automated checks pass now.
- **Fix**: Start Docker and run `npx supabase start && npx supabase test db`, then `npm run smoke` against a preview, before merging (CI will also run both).
- **Decision**: FIXED — Docker started; `supabase db reset`, `supabase test db` (4 files, 222 tests PASS, incl. new MR012 cases), `npm run build`, `npm run smoke` against the production preview (all steps PASS), astro check 0 errors, eslint clean.

### F6 — activated_at goes stale when the auth account is deleted

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260929120000_employees_and_engagements.sql:36, 351-371
- **Detail**: `profile_id` is `on delete set null`, but `activated_at`/`invited_at` stay set. The employee then shows "Active", and the function returns `already_active` forever, so the employee can never be re-invited.
- **Fix**: Derive "active" from `profile_id is not null and activated_at is not null` (service and Edge Function), or clear the stamps with a trigger when `profile_id` becomes null.
- **Decision**: FIXED — migration 20260930130000_employees_clear_invite_on_unlink.sql (before update of profile_id trigger), pgTAP case (plan 75), contract-surfaces row. `db reset` + `test db` pass.

### F7 — Residual account-existence oracle for Supervisors

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/functions/invite-employee/index.ts:84-86; src/lib/services/employees.ts:169, 278
- **Detail**: The messages are generic as planned, but success versus `registration_failed` still tells a Supervisor whether an email already has an auth account (invite), or is registered by another Supervisor (23505). Only Supervisors and Admins can reach this.
- **Fix**: Accept it and note it in the plan or contract-surfaces as a known limitation.
- **Decision**: SKIPPED

### F8 — Admins pay a per-row definer call in the employees select policy

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260929120000_employees_and_engagements.sql:139-149, 390
- **Detail**: `employee_engaged_on_own_milestone(id)` is OR-ed into `employees_select_supervisor` and runs an EXISTS per row even for Admins. The plan accepts this at MVP scale (Performance Considerations).
- **Fix**: Short-circuit inside the helper with `public.is_supervisor() and exists(...)` when this is next touched.
- **Decision**: SKIPPED

### F9 — Benign unplanned extras

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/lib/set-password.ts; src/components/employees/EmployeeForm.astro:57-60; supabase/snippets/
- **Detail**:
  - `src/lib/set-password.ts` extracts the catalog and schema, and adds a 72-character bcrypt maximum. It was not in the plan but follows the services pattern.
  - The edit form keeps showing the employee's current job role after it is archived ("(archived)"), which differs from the plan's "active roles only". It is justified because MR010 fires only on change.
  - `supabase/snippets/` (a Studio query saved as a file) is untracked.
- **Fix**: Note the first two in the plan's Phase 3 as addenda; add `supabase/snippets/` to `.gitignore` or delete it.
- **Decision**: SKIPPED

### F10 — Auth-page rough edges

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/auth/confirm.ts:30; src/pages/auth/signin.astro:14
- **Detail**: `/auth/confirm` silently replaces an existing session: a Supervisor who opens an invite link becomes the employee. `signin.astro` still renders unknown `?error=` values as free text (escaped, so not XSS, but usable for phishing text). This predates the change, and the new pages use fixed catalogs.
- **Fix**: Map sign-in errors through a fixed catalog like set-password, and optionally sign out explicitly before `verifyOtp` when `locals.user` is set.
- **Decision**: FIXED — /api/auth/signin now redirects with fixed codes (invalid_credentials, email_not_confirmed, not_configured, signin_failed) and signin.astro maps every value through a fixed catalog (unknown → generic); /auth/confirm signs out the existing session (scope local) before verifyOtp. Verified on preview: smoke passes, crafted ?error= shows the generic text, confirm while signed in as a Supervisor ends as the invitee.

## Triage summary (2026-09-30)

- Fixed: F1 (Fix A), F3 (fixed differently: amr gate), F4, F5, F6, F10
- Skipped: F2, F7, F8, F9
- Follow-ups: `follow-ups/review-fixes.md` (milestone reopen guard)
- Final checks: `supabase test db` 4 files PASS, `npm run smoke` PASS on the production preview, `astro check` 0 errors, eslint clean, build OK
