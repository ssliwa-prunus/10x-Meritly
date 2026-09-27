# Supervisor Creates Project and Milestones — Plan Brief

> Full plan: `context/changes/supervisor-creates-project-and-milestones/plan.md`
> Research: `context/changes/supervisor-creates-project-and-milestones/research.md`

## What & Why

S-02 lets Supervisors create projects with a total bonus budget, and milestones with a **target** pool (the payout at multiplier 1.0). Each project shows its **worst-case** payout against that budget (FR-004, FR-005, FR-017).

Under the chosen bonus model (variant A), a milestone's multiplier scales its pool up to `multiplier_max`. So the budget must reserve `target × multiplier_max`, not the plain target, for good KPI results never to push a project over budget.

## Starting Point

- The following already exist:
  - roles in `profiles`, with `is_admin()` / `is_supervisor()` helpers (F-01);
  - bonus settings including `multiplier_max` (1.30 by default), readable by Supervisors (S-01);
  - a form, zod and redirect pattern in `bonus-config.ts`;
  - pgTAP running in CI.
- There are no project or milestone tables, no ownership concept, no money handling and no Supervisor pages yet.

## Desired End State

- A Supervisor opens **/projects**, creates projects, and on **/projects/[id]** edits them and adds or edits milestones. Each project shows its budget, reserved amount, remaining amount and an over-budget badge.
- An Admin sees every project with its owner, creates projects for any Supervisor, reassigns them, and reads milestones.
- Employees are locked out by both the route guard and RLS.
- Example: a 10 000.00 budget with milestones 3 000 (active), 3 000 (active) and 2 000 (cancelled) reserves **7 800.00** at max multiplier 1.30, so it is not over budget. Un-cancelling the 2 000 milestone brings it to **10 400.00**, which is over budget.

## Key Decisions Made

| Decision           | Choice                                                                                               | Why (1 sentence)                                                          | Source   |
| ------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------- |
| Bonus model        | Variant A: KPI multiplier scales the target pool; S-02 only reserves `target × multiplier_max`       | A per-employee multiplier cancels out in a proportional split             | Research |
| Money              | `numeric(12,2)`, > 0, floor to the grosz via one SQL function `money_floor_mul`                      | Postgres casts round half up; one function lets S-04 reuse the exact rule | Research |
| Budget check       | SQL view `project_budget_exposure` (`security_invoker`), computed at read time, informational only   | pgTAP is the only test framework; RLS flows through the view              | Research |
| Counted milestones | Every status except `cancelled`; `approved` added in S-05                                            | Cancelled work never pays; S-02 cannot reach approval correctly           | Research |
| Ownership          | One Supervisor per project (`supervisor_id`); trigger enforces owner is a Supervisor                 | Clear RLS predicate, and reassignment is a single column change           | Research |
| Admin rights       | Create, edit and reassign projects; read-only milestones                                             | Admin oversight without competing milestone edits                         | Research |
| Role change        | Blocked by trigger while a Supervisor owns projects                                                  | Roles change in Studio or SQL, where only triggers still fire             | Research |
| Pages              | Shared `/projects` pages; the role decides the owner field and milestone forms                       | No duplicated forms                                                       | Research |
| Project status     | planned / active / completed / cancelled; completed or cancelled **locks** milestone insert and edit | Closed projects cannot drift                                              | Plan     |
| Periods            | `end ≥ start`; milestones must fit inside the project period, enforced both ways                     | Data stays consistent whichever path writes it (UI or Studio)             | Plan     |
| Deletion           | None; cancel instead                                                                                 | Matches the S-01 archive precedent and keeps history for S-06/S-07        | Plan     |
| Uniqueness         | Project names unique company-wide; milestone names unique per project (case-insensitive)             | Reassignment never collides; reports stay unambiguous                     | Plan     |
| DB error surface   | Triggers raise SQLSTATEs `MR001`–`MR006`, mapped to fixed messages                                   | PostgREST passes the SQLSTATE through in `code`                           | Plan     |

## Scope

**In scope:**

- one migration: tables, constraints, RLS, triggers, the view and the two functions;
- a pgTAP suite and seed data (a sample project and a second Supervisor);
- shared form helpers, the projects service, types, the middleware guard and four POST routes;
- the list and detail pages, navigation, and doc updates (contract registry, PRD rounding note, CLAUDE.md).

**Out of scope:**

- KPI scoring, payouts and the split (S-04), and approval/freeze (S-05);
- engagement (S-03) and employee access;
- deletion, Admin milestone edits, status workflows beyond the closed-project lock;
- a role-management UI, smoke-test extension and S-01 validation fixes.

## Architecture / Approach

Database first. Postgres enforces every rule: CHECKs, unique indexes, RLS (`owns_project()` for milestones), four `security definer` guard triggers, and the invoker view for exposure. The app layer mirrors S-01: zod with code-only errors → service → a request-scoped Supabase client → 302 redirects. Pages are server-rendered Astro and branch on `locals.profile.role`. TS never does money arithmetic; it formats values the SQL has already floored.

## Phases at a Glance

| Phase                              | What it delivers                                                                          | Key risk                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1. Schema, security and pgTAP      | Tables, view, functions, triggers, policies, seed and tests                               | Trigger and RLS interplay (definer vs invoker); a wrong `security definer` would leak rows |
| 2. Services, routes and middleware | Shared form helpers, projects service and error map, types, `PROJECT_ROUTES`, 4 endpoints | Moving the form helpers must not regress S-01 settings                                     |
| 3. Pages, navigation and docs      | /projects list and detail, exposure panel, Topbar link, docs                              | Role-dependent UI (Admin owner select, read-only milestones, closed-project lock)          |

**Prerequisites:** F-01 and S-01 merged (done); local Supabase via Docker for `db reset` / `test db`.
**Estimated effort:** ~3 sessions, one per phase.

## Open Risks & Assumptions

- The CI workflow triggers on `master` ([.github/workflows/ci.yml:3-7](../../../.github/workflows/ci.yml)), while this repo works on `develop` / `main`. pgTAP may not run in CI for this branch until that is aligned, so run `npx supabase test db` locally at each phase.
- `money_floor_mul` is assumed to become S-04's rounding rule. If S-04 chooses otherwise, `payout_pool ≤ reservation` is no longer guaranteed by construction.
- Closing a project also blocks un-cancelling its milestones. That is intended: reopen the project first.

## Success Criteria (Summary)

- A Supervisor can set up a project and milestones and immediately sees whether the worst case exceeds the budget, with amounts floored to the grosz.
- No user can see or change projects they don't own (Admins excepted for projects), and invalid data is rejected by the database on every write path.
- All pgTAP cases (ownership, Admin writes, value rules, periods and lock, exposure maths, role block) pass.
