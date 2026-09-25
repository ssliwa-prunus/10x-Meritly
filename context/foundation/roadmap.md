---
project: Meritly
version: 1
status: draft
created: 2026-09-22
updated: 2026-09-22
prd_version: 1
main_goal: quality
top_blocker: time
milestone_id: mvp-payout-flow
milestone_seq: 1
milestone_status: open
---

# Roadmap: Meritly

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-1: MVP payout flow** — Status: open

- **Intent:** Ship the full 6-step MVP flow end to end — Admin configures global bonus rules, Supervisor sets up projects/milestones and records engagement, milestones get scored and their payouts computed under a hard guardrail, and Supervisor-approved results become visible (and emailed) to the affected employee — replacing the spreadsheet workflow described in the PRD's Vision.
- **Source materials:** `context/foundation/prd.md` (v1)
- **Done when:** every F-NN and S-NN below is `done`.
- **Scope anchors:** FR-001 through FR-018, US-01.

## Vision recap

A budget-holding supervisor today splits a milestone's bonus pool using a validated weighted formula (time share × role weight × contribution rating × milestone KPI multiplier) run manually across a multi-tab spreadsheet — slow, error-prone at every milestone close, and giving employees no way to see their own outcome without someone sending them the file. Meritly applies the same validated formula in a web app, keeps every payout provably within its pool, and makes each milestone's result visible directly to the employee it affects, once a Supervisor approves it.

## North star

**S-04: Supervisor scores a milestone and sees the computed per-employee bonus table, guaranteed never to exceed the pool.**

> A reader-facing gloss: the north star is the smallest end-to-end slice whose successful delivery would prove the core product hypothesis — placed as early as Prerequisites allow because everything else only matters if this works. Here the hypothesis is narrower and higher-stakes than "will people use this": it's "does the already-validated formula compute correctly and stay inside the pool guardrail when it's the software doing the arithmetic, not a person." Draft/Approved gating, employee visibility, email, history, and reporting all sit downstream of trusting this number.

## At a glance

| ID   | Change ID                                             | Outcome (user can …)                                                                                                                                | Prerequisites | PRD refs                         | Status   |
| ---- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------------------------------- | -------- |
| F-01 | role-and-rls-scaffold                                 | (foundation) role-based access + RLS scaffold in place                                                                                              | —             | Access Control, NFR (visibility) | ready    |
| S-01 | admin-configures-bonus-rules                          | Admin can configure role weights, KPI weights, and the rating→factor mapping                                                                        | F-01          | FR-001, FR-002, FR-003           | proposed |
| S-02 | supervisor-creates-project-and-milestones             | Supervisor can create a project (with a total bonus budget) and milestones within it, pool-checked against that budget                              | F-01          | FR-004, FR-005, FR-017           | proposed |
| S-03 | supervisor-assigns-employee-engagement                | Supervisor can register employees and assign their engagement (time-share, contribution rating) to a milestone, with >100% total time-share flagged | S-02, F-01    | FR-007, FR-008, FR-011           | proposed |
| S-04 | supervisor-scores-milestone-and-sees-computed-bonuses | Supervisor can score a milestone's four KPIs and see each employee's computed bonus, never exceeding the pool                                       | S-01, S-03    | FR-006, FR-009, FR-010           | proposed |
| S-05 | supervisor-approves-milestone-employee-sees-bonus     | Supervisor can approve a milestone; the affected employee then sees their own bonus and receives an email — never another employee's                | S-04, F-01    | FR-012, FR-016, FR-018, US-01    | proposed |
| S-06 | navigate-to-employee-detail-and-history               | Supervisor/Employee can drill into an employee's detail view and see their own history of past projects/milestones and bonuses                      | S-05          | FR-013, FR-014                   | proposed |
| S-07 | aggregate-bonus-report                                | Supervisor/Admin can view or export an aggregate report of total bonus and milestone count per employee                                             | S-05          | FR-015                           | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                                                                  | Chain                                              | Note                                                                                                                                                                                        |
| ------ | ---------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A      | Core payout pipeline (config → setup → engagement → compute → approve) | `F-01` → `S-01`, `S-02` → `S-03` → `S-04` → `S-05` | `S-01` and `S-02` only need `F-01` and run in parallel; `S-03` needs `S-02`'s milestone to assign into; `S-04` (north star) needs both `S-01`'s config values and `S-03`'s engagement data. |
| B      | Drill-down & reporting                                                 | `S-05` → `S-06`, `S-07`                            | Both are independent of each other once `S-05` lands. `S-07` is nice-to-have and the first candidate to Park if `time` pressure bites.                                                      |

## Baseline

What's already in place in the codebase as of `2026-09-22` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 7 + React 19 islands, Tailwind 4, shadcn/ui (`components.json`, new-york style, `src/components/ui/button.tsx`); file-based routing under `src/pages/`.
- **Backend / API:** partial — Astro API-route convention wired (`src/pages/api/auth/{signin,signup,signout}.ts`), but no `src/lib/services/` business-logic layer and no domain routes yet.
- **Data:** absent — Supabase JS client wired (`src/lib/supabase.ts`), but no `supabase/migrations/`, no tables, no seed data.
- **Auth:** partial — Supabase Auth + session middleware fully wired (`src/middleware.ts`, `PROTECTED_ROUTES`), signin/signup/signout pages and API done; no role-based scaffold — no `profiles` table, no role column anywhere.
- **Deploy / infra:** present — `wrangler.jsonc` (name `meritly`, Workers target, observability enabled), GitHub Actions CI (lint/check/build + local-Supabase smoke job), `astro.config.mjs` server-mode + env schema. Platform choice already resolved in `context/foundation/infrastructure.md`.
- **Observability:** partial — Cloudflare Workers observability flag enabled in `wrangler.jsonc`; no logging library, error tracking, or structured logging in middleware/API routes. Not required by any PRD NFR, so no Foundation opened for it.

## Foundations

### F-01: Role & RLS scaffold

- **Outcome:** (foundation) a `profiles` table (keyed to `auth.users`, carrying `role`) exists with RLS enabled; the established pattern (role stored server-side, not in `user_metadata`; `security_invoker = true` on any views over RLS-protected tables) is in place for every subsequent slice to build on.
- **Change ID:** role-and-rls-scaffold
- **PRD refs:** Access Control (three roles: Admin, Supervisor, Employee), NFR (bonus/compensation figures visible only to the entitled role, including via URL manipulation)
- **Unlocks:** S-01, S-02, S-03, S-04, S-05, S-06, S-07 — every downstream slice needs to know and enforce the acting user's role; reduces the core invariant risk named in the project's guardrails (an employee must never see another employee's figures).
- **Prerequisites:** — (Supabase Auth + session middleware already present per Baseline)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Highest-leverage item in the whole milestone — every other slice's access guarantee (Admin sees all, Supervisor sees own team, Employee sees only self) is unenforceable without it. Sequencing it first, ahead of any user-facing slice, avoids retrofitting RLS onto tables that already hold data — the `quality`-goal bias calls for this explicitly.
- **Status:** ready

## Slices

### S-01: Admin configures bonus rules

- **Outcome:** Admin can add/edit/remove role weights, define KPI weights and the min/max milestone-multiplier bounds, and define the contribution-rating (1-5) → factor (0.8-1.2) mapping.
- **Change ID:** admin-configures-bonus-rules
- **PRD refs:** FR-001, FR-002, FR-003
- **Prerequisites:** F-01
- **Parallel with:** S-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Straightforward CRUD-shaped slice with no data-volume concerns; sequenced early because S-04's formula consumes these values, and PRD FR-001/002/003 all note that changes must apply prospectively only — Approved milestones stay frozen.
- **Status:** proposed

### S-02: Supervisor creates project and milestones

- **Outcome:** Supervisor can create a project (name, period, status, total bonus budget, notes) and create milestones within it (name, period, bonus pool, status, notes), with milestone pools checked against the project's total budget.
- **Change ID:** supervisor-creates-project-and-milestones
- **PRD refs:** FR-004, FR-005, FR-017
- **Prerequisites:** F-01
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** PRD's own Socrates round already flagged period-validation (end date not before start date) as an explicit acceptance criterion — low residual risk otherwise.
- **Status:** proposed

### S-03: Supervisor assigns employee engagement

- **Outcome:** Supervisor can register an employee with a role and assign that employee to a milestone with a time-share (0-1) and contribution rating (1-5); the Supervisor can see when an employee's total time-share across active milestones exceeds 100%.
- **Change ID:** supervisor-assigns-employee-engagement
- **PRD refs:** FR-007, FR-008, FR-011
- **Prerequisites:** S-02, F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - The >100% flag aggregates one employee's engagement across every active milestone they're on, not just the current one — worth naming explicitly so `/10x-plan` scopes the query correctly. Owner: team. Block: no.
- **Risk:** The cross-milestone aggregation is the one subtlety in an otherwise simple assignment slice; PRD treats it as informational only (Supervisor judgment prevails), not blocking.
- **Status:** proposed

### S-04: Supervisor scores milestone and sees computed bonuses

- **Outcome:** Supervisor can enter a milestone's four KPI scores (Termin, Budżet, Jakość, Ryzyko) and see the computed per-employee bonus table, plus a milestone summary (pool, payout total, remaining) confirming the total never exceeds the pool.
- **Change ID:** supervisor-scores-milestone-and-sees-computed-bonuses
- **PRD refs:** FR-006, FR-009, FR-010
- **Prerequisites:** S-01, S-03
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** This is the north star and the highest-correctness-risk slice in the milestone — the formula (time share × role weight × contribution factor × milestone multiplier, rounded down) and the pool guardrail both live here. Per PRD, the guardrail is confirmatory (the formula mathematically cannot exceed the pool by construction), so the rounding-down logic is the detail `/10x-plan` must get exactly right.
- **Status:** proposed

### S-05: Supervisor approves milestone, employee sees bonus

- **Outcome:** Supervisor can mark a milestone's computed results Approved; before approval, results are Draft and visible only to the Supervisor — never to affected employees, and no email is sent. Once Approved, the affected employee can view their own bonus (and only their own) and receives an email notification.
- **Change ID:** supervisor-approves-milestone-employee-sees-bonus
- **PRD refs:** FR-012, FR-016, FR-018, US-01
- **Prerequisites:** S-04, F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** This is where F-01's RLS policy gets exercised end to end for the first time — an employee select policy must require both "this is my row" and "the parent milestone is Approved." It's also where the Vision's core pain (employees previously had no way to see their own outcome) actually gets closed, and where the "never another employee's figures, including via URL manipulation" guardrail is most directly tested.
- **Status:** proposed

### S-06: Navigate to employee detail and history

- **Outcome:** Supervisor can navigate from a milestone's results directly to an employee's detail view; Supervisor and Employee can each view that employee's history of their own past projects/milestones and the bonuses received in each.
- **Change ID:** navigate-to-employee-detail-and-history
- **PRD refs:** FR-013, FR-014
- **Prerequisites:** S-05
- **Parallel with:** S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Low — a read/navigation slice over data S-05 already produces. Scope is already bounded by the PRD's own Socrates resolution: an employee's own participation history only, not a company-wide project browser.
- **Status:** proposed

### S-07: Aggregate bonus report

- **Outcome:** Supervisor/Admin can view or export an aggregate report of total bonus and milestone count per employee.
- **Change ID:** aggregate-bonus-report
- **PRD refs:** FR-015
- **Prerequisites:** S-05
- **Parallel with:** S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Nice-to-have per PRD's own priority ("attempted if time allows, never blocking the release") — under `time` pressure, this is the first slice to move to Parked rather than slip the deadline.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                                             | Suggested issue title                                              | Ready for `/10x-plan` | Notes                               |
| ---------- | ----------------------------------------------------- | ------------------------------------------------------------------ | --------------------- | ----------------------------------- |
| F-01       | role-and-rls-scaffold                                 | Role & RLS scaffold (profiles table, per-role visibility)          | yes                   | No prerequisites — start here       |
| S-01       | admin-configures-bonus-rules                          | Admin: configure role weights, KPI weights, rating→factor mapping  | no                    | Needs F-01                          |
| S-02       | supervisor-creates-project-and-milestones             | Supervisor: create project + milestones with budget guardrail      | no                    | Needs F-01                          |
| S-03       | supervisor-assigns-employee-engagement                | Supervisor: register employees, assign engagement to a milestone   | no                    | Needs S-02, F-01                    |
| S-04       | supervisor-scores-milestone-and-sees-computed-bonuses | Supervisor: score milestone KPIs and compute guarded bonus payouts | no                    | North star — needs S-01, S-03       |
| S-05       | supervisor-approves-milestone-employee-sees-bonus     | Approve milestone; employee sees own bonus + gets emailed          | no                    | Needs S-04, F-01                    |
| S-06       | navigate-to-employee-detail-and-history               | Employee detail view + own history                                 | no                    | Needs S-05                          |
| S-07       | aggregate-bonus-report                                | Aggregate bonus report per employee (nice-to-have)                 | no                    | Needs S-05; first candidate to Park |

This table is the clean handoff to Jira/Linear or any MCP-backed backlog.

## Open Roadmap Questions

None currently — the PRD closed every Open Question before this roadmap was generated (`quality_check_status: accepted` in shape-notes.md; PRD `## Open Questions` reads "None" in both the shape-notes and PRD passes). Per-slice unknowns stay in the slice (see S-03).

## Parked

- **In-app RCP (time-tracking) module** — Why parked: PRD Non-Goal; a deliberate later step, once a rule exists for converting logged hours into a time-share. Manual entry (S-03) is the accepted MVP tradeoff.
- **Automatic import of employee time from an external work-management tool (e.g. MS365 Planner)** — Why parked: PRD Non-Goal; manual entry is the accepted MVP tradeoff.
- **Embedding inside MS Teams (or any external collaboration platform), and notifications through one** — Why parked: PRD Non-Goal; the MVP is a standalone web app with email as the only notification channel. (Noted in `tech-stack.md`'s "Forward" section as a long-term production target, not an MVP constraint.)

## Milestone History

(Empty — this is the first milestone.)

## Done

(Empty on first generation. `/10x-archive` appends an entry here — and flips that item's `Status` to `done` — when a change whose `Change ID` matches the item is archived.)
