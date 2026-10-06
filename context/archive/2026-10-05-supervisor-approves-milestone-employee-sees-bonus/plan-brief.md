# Supervisor Approves Milestone, Employee Sees Bonus — Plan Brief

> Full plan: `context/changes/supervisor-approves-milestone-employee-sees-bonus/plan.md`
> Research: `context/changes/supervisor-approves-milestone-employee-sees-bonus/research.md`

## What & Why

S-05 (FR-012, FR-016, FR-018, US-01) closes the core pain from the Vision: employees can't see their own bonus outcome. A Supervisor approves a milestone, which freezes its computed result. Each affected employee then sees only their own figure in the app and gets it by email. Before approval, results stay Draft and visible only to the Supervisor.

## Starting Point

S-04 computes payouts live from the current config on every read, and stores nothing. Status transitions and post-completion edits are unguarded. Employees can read nothing beyond their own profile. No code can send a non-auth email.

## Desired End State

**Approval**

- A Supervisor approves a scored, staffed milestone from its page and confirms with a checkbox.
- The milestone becomes `approved`. Its figures are frozen against later config, role or name changes, and the database rejects every further edit.

**Employees**

- Each engaged employee receives an email with their bonus.
- Once their account is activated, `/my-bonuses` lists their Approved results with a breakdown, and nobody else's figures.

**Project figures**

- The project budget counts an Approved milestone at its actual payout pool.

## Key Decisions Made

| Decision             | Choice                                                                                                         | Why (1 sentence)                                                                                                 | Source                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Approval model       | `approved` status value, set only by a dedicated action                                                        | Matches PRD/CLAUDE.md wording; one field drives every guard and filter                                           | Plan                                   |
| Preconditions        | Scored + ≥1 engagement, from any open status (planned/active/completed), project not closed                    | User preferred one-click approval from the scoring screen over requiring `completed` first                       | Plan                                   |
| Reversibility        | Irreversible in MVP                                                                                            | Employees' figures never change after they're told; no correction or re-send logic                               | Plan                                   |
| Time share           | Approved counts as closed (not in >100% total, MR008/MR012)                                                    | Approved comes after completed, which already doesn't count                                                      | Plan / Research (S-03 deferral)        |
| Snapshot contents    | Mandatory figures + `multiplier_max` + display names (employee, role, project, milestone, period)              | History is immune to renames and needs no employee policies on live tables                                       | Plan / Research (config snapshot rule) |
| Snapshot atomicity   | One security-definer RPC; header + lines in one CTE statement                                                  | S-04 review hard requirement: totals can never disagree with stored lines                                        | Research                               |
| Privacy split        | Header (pool, total, residual, share) Supervisor/Admin only; employees read lines without them                 | Pool minus own bonus, or bonus ÷ share, would reveal colleagues' figures                                         | Plan (invariant)                       |
| Employee visibility  | Own line only, `profile_id = auth.uid()` **and** `activated_at` set, milestone approved                        | Closes the claimed-pre-registered-account gap; RLS, not page filtering                                           | Plan / CLAUDE.md                       |
| Email path           | New Edge Function, Resend batch API (Mailpit locally), per-line `notified_at`, idempotency key, manual re-send | Secrets stay in Supabase; 2 subrequests per approval whatever the team size; approval kept separate from sending | Plan / Research (infra guidance)       |
| Recipients & content | Every engaged employee at `employees.email`; project, milestone, period, bonus, link                           | Meets FR-016 without requiring a login; one message per recipient                                                | Plan                                   |
| Employee UI          | `/my-bonuses` list with per-row breakdown; S-06 extends it                                                     | Gives the email a target and fixes the route S-06 builds on                                                      | Plan                                   |
| Draft read path      | Unchanged (live two-RPC)                                                                                       | Optional refactor; keeps scope tight                                                                             | Plan                                   |

## Scope

**In scope:**

- Approval status and snapshot tables.
- `approve_milestone()`.
- Freeze guards (MR014/MR015), on insert and update.
- Database CHECKs for the pool invariants on stored results.
- Revised open/closed filters and budget view.
- Employee RLS.
- pgTAP suite.
- Approve UI and the approved rendering.
- `/my-bonuses`.
- Return to the requested page after sign-in (same-origin `?next=`).
- Email Edge Function and re-send.
- Docs.

**Out of scope:**

- Un-approve or correction.
- S-06 history and drill-down.
- S-07 report.
- Draft path refactor.
- Automatic email retries.
- CI email tests.
- Breakdown in the email.
- Token migration of dashboard/Topbar.

## Architecture / Approach

1. The Worker route calls the `approve_milestone` RPC as the user. The function does its work in this order:
   1. ownership check (42501);
   2. row lock;
   3. guards;
   4. a single statement that snapshots the live `milestone_payout_lines` output into `milestone_results` (header) and `milestone_result_lines`;
   5. flip the status, which the freeze trigger then locks.
2. The route then invokes `notify-milestone-approved` with the user's JWT. The function re-checks ownership, reads the unsent lines with the secret key, and sends via Resend batch (or Mailpit locally). It stamps `notified_at` per confirmed batch.
3. `/my-bonuses` reads `milestone_result_lines` under RLS, filtered by `current_employee_id()`.

## Phases at a Glance

| Phase                      | What it delivers                                                                                | Key risk                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1. Database                | Status, snapshot tables, `approve_milestone`, freeze, filters, budget view, employee RLS, pgTAP | Snapshot consistency and the privacy split — any leak breaks the core invariant       |
| 2. Supervisor approve flow | Approve action, frozen rendering, read-only edit surfaces, kitchen-sink states                  | Generic edit form or replayed requests must fail cleanly, not 500                     |
| 3. `/my-bonuses`           | Employee-only page with breakdown, nav link, middleware rule, sign-in return to `?next=`        | Supervisor must not get an unfiltered team view; `next` must not open-redirect        |
| 4. Approval email          | Edge Function, Resend/Mailpit transport, sent counts, re-send, docs                             | Edge runtime → Mailpit reachability locally; Resend domain verification in production |

**Prerequisites:**

- Local Supabase (Docker).
- For production email: a Resend API key and a verified sending domain (S-03 checklist items 5.4–5.6 are still open).

**Estimated effort:** ~4 sessions, one per phase. Phase 1 is the largest.

## Open Risks & Assumptions

- **Mailpit reachability.** Assumes `host.docker.internal:54324` reaches Mailpit from the edge runtime on Docker Desktop. Fallback: the inbucket container name on port 8025.
- **Unverified domain.** Production email depends on Resend domain verification. Until then, approval works and the page shows unsent emails that can be re-sent.
- **Unverified addresses.** Never-invited employees are emailed at an address a Supervisor typed and no one has verified. A typo sends that one bonus figure to a stranger. Those emails carry an "ask for an invite" line.
- **Operator fixes.** An approval made by mistake needs an operator to fix it in the database, which is an accepted MVP tradeoff.
- **Snapshot assumption.** One snapshot relies on stable functions taking the snapshot of the query that calls them. pgTAP checks the stored figures against the live figures.

## Success Criteria (Summary)

- A Supervisor approves a milestone and its figures never change again. The budget panel reflects the actual payout.
- Each employee is emailed and sees exactly their own Approved bonus, never a colleague's or a Draft figure, however the request is crafted.
- All pgTAP suites, lint, the UI guard, `astro check`, build and smoke pass.
