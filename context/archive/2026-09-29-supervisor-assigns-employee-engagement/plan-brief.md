# Supervisor Assigns Employee Engagement — Plan Brief

> Full plan: `context/changes/supervisor-assigns-employee-engagement/plan.md`
> Research: `context/changes/supervisor-assigns-employee-engagement/research.md`

## What & Why

This is roadmap slice S-03 (FR-007, FR-008, FR-011). Supervisors (and Admins) register employees and invite them by email. Supervisors assign their own employees to milestones with a time-share and a 1–5 contribution rating, and see a flag when someone's open-milestone time-share goes over 100%. S-04's bonus calculation needs this engagement data, and later slices need employees to have real accounts so they can see their own results.

## Starting Point

There are no employee or engagement tables yet. Profiles appear only when someone signs up. The app never holds the Supabase secret key, so it cannot create accounts. Projects and milestones already have owner-scoped access rules, guard triggers and a pgTAP suite (S-02) to copy.

## Desired End State

- On `/employees`, a Supervisor registers and edits their employees and sends or resends invites.
- An invited employee clicks the email link, sets a password and can sign in.
- On a new milestone page, the Supervisor adds, edits and deletes assignments for open milestones, and sees each employee's open total with a red flag above 100%.
- Admins see and manage all employees, and view assignments read-only.
- The database enforces every rule, and the rollout reaches production with real email delivery through Resend.

## Key Decisions Made

| Decision                | Choice                                                                                                             | Why (1 sentence)                                                              | Source          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | --------------- |
| Onboarding              | Supervisor/Admin adds the employee; the employee only accepts the invite and sets a password                       | The user's product requirement                                                | Research        |
| Invite mechanism        | `invite-employee` Supabase Edge Function holds the secret key                                                      | The CLAUDE.md rule "no secret key in user-facing handlers" stays intact       | Research        |
| Invite timing           | Separate Send/Resend button; registering never sends email                                                         | Registration can't half-fail, and a resend is needed anyway (1 h link expiry) | Plan            |
| Employee ownership      | One owning Supervisor; Supervisors see and assign only their own                                                   | Keeps each team's data private                                                | Research        |
| After an employee moves | The old Supervisor still sees the name read-only on past assignments                                               | History stays readable without duplicating data                               | Plan            |
| Job role                | On the employee (global), active roles only                                                                        | Matches FR-007 and the S-01 hand-off                                          | Research        |
| Email                   | Unique, lowercase, locked after the first invite; the duplicate message is generic                                 | The login email can't drift, and no other Supervisor's data leaks             | Research + Plan |
| Admin rights            | Register, edit and move employees; engagements read-only; sees the flag                                            | FR-007 plus the S-02 milestone precedent                                      | Research        |
| Moving an employee      | Blocked while they have assignments on open milestones                                                             | Avoids orphaned active work under the wrong owner                             | Research        |
| Assignments             | One per (milestone, employee); time-share above 0 and at most 1; rating 1–5; hard delete while open                | A simple undo, with no duplicate rows                                         | Research        |
| Closed parents          | Writes blocked on completed/cancelled milestones or projects (MR007)                                               | A finished milestone's data stays fixed                                       | Research        |
| ">100%" flag            | Open = status not completed/cancelled; the Supervisor's own milestones (Admin: all); flag when strictly above 1.00 | Informational only, per the PRD                                               | Research        |
| Assignment UI           | New `/projects/[id]/milestones/[milestoneId]` page                                                                 | Room for S-04's bonus table                                                   | Plan            |
| Production scope        | Full rollout with Resend SMTP                                                                                      | The feature is live at close                                                  | Plan            |
| Testing                 | New pgTAP suite in CI plus a manual local invite test                                                              | The rules are automated where they are enforced                               | Plan            |

## Scope

**In scope:**

- `employees` and `milestone_engagements` tables, their access rules, helpers, 5 new guard codes (MR007–MR011), MR001/MR005 extended to employees, the flag view and the activation trigger
- The invite Edge Function, the invite template, `/auth/confirm` and `/auth/set-password`
- The `/employees` page, the milestone assignment page, navigation and middleware
- Seed data, a pgTAP suite, and docs (contract registry, README runbook, CLAUDE.md)
- Production: Resend, SMTP, the template, the URLs, `db push`, function deploy, Worker deploy, and a real invite test

**Out of scope:**

- Employees seeing their own data (S-05/S-06), bonus computation (S-04), approval and the `approved` status (S-05)
- Deleting or archiving employees, email changes after an invite, closing public self-signup
- A blocking over-allocation rule, date-overlap logic, an automated end-to-end invite test, the approval email (FR-016)

## Architecture / Approach

Postgres is the single enforcement point. Owner-scoped access rules go through SECURITY DEFINER helpers (`owns_milestone`, `employee_engaged_on_own_milestone`), which avoid circular access-rule checks. Column grants keep the link and invite fields writable only by system code. BEFORE guard triggers check permission first. A `security_invoker` view computes the totals, so each role's scope comes from its own access rules. The Astro Worker calls the Edge Function with the signed-in user's JWT. The function (`withSupabase({ auth: 'user' })`) re-checks ownership, calls `inviteUserByEmail` and links `profile_id`. An `auth.users` trigger stamps `activated_at` when the invite is accepted.

## Phases at a Glance

| Phase                               | What it delivers                                        | Key risk                                                                                              |
| ----------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1. Database, access rules and tests | Schema, rules, guards, view, seed, pgTAP suite          | Circular access-rule checks, or seeing an employee being mistaken for owning them                     |
| 2. Invite and activation            | Edge Function, template, confirm and set-password pages | Whether the SSR client passes the user's JWT to `functions.invoke`; Deno files breaking `astro check` |
| 3. Employees UI                     | `/employees` list, register, edit, move, invite, flag   | Leaking another Supervisor's employee through error messages                                          |
| 4. Assignment UI                    | Milestone page with assignment CRUD and the flag        | The UI getting out of sync with the MR007 closed rule                                                 |
| 5. Docs and production rollout      | Registry, runbook, Resend SMTP, deploys, real invite    | Domain DNS verification time; production missing earlier migrations                                   |

**Prerequisites:**

- Local Docker with the Supabase CLI.
- For Phase 5: a domain you control for Resend, hosted Supabase dashboard access, and Cloudflare `wrangler` auth.

**Estimated effort:** about 4–5 implementation sessions across 5 phases. Phase 5 depends on DNS propagation.

## Open Risks & Assumptions

- The `@supabase/server` `withSupabase` API is new. Confirm its current signature via Context7 when implementing Phase 2.
- An invite to an email that already has a self-signed-up confirmed account fails with a generic message. Linking such accounts is deferred.
- The "open" definition counts a future `approved` status unless S-05 excludes it, and S-05 must also block assignment deletes on approved milestones.
- The flag is narrower than the roadmap wording: it counts only the Supervisor's own milestones. Because of employee ownership, in practice it covers an employee's whole open workload.

## Success Criteria (Summary)

- A Supervisor can register, invite and assign their employees, and sees a correct flag above 100%. Nobody can see or change another Supervisor's employees or assignments, including through crafted requests.
- An invited employee sets a password from a real email in production and signs in.
- The pgTAP suite proves every ownership, closed-milestone, uniqueness and range rule in CI.
