---
project: "Meritly"
version: 1
status: draft
created: 2026-09-17
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 7
  hard_deadline: 2026-11-04
  after_hours_only: true
---

## Vision & Problem Statement

A budget-holding supervisor (Project Manager, Team Leader, Team Manager, or Department Head — any level that receives a bonus budget to distribute among subordinates) today calculates project bonuses in a multi-tab spreadsheet workbook driven by a weighted formula (time share × role weight × contribution rating × milestone KPI multiplier). The process is manual and error-prone at every milestone close, spreads related information (an employee's project history, past bonuses) across disconnected tabs with no way to drill from a result into an employee's detail or history, and gives employees no way to see their own outcome without someone sending them the file.

The organization runs R&D projects that frequently span 12+ months; the team already has a validated, in-practice weighted formula for splitting a milestone's bonus pool proportionally without ever exceeding it, but no tool that applies this formula while also making each milestone's outcome transparent to the employees it affects and supporting more than one supervisor level dividing a budget.

## User & Persona

**Primary persona:** Budget-holding supervisor — a manager at any organizational level (Project Manager, Team Leader, Team Manager, Department Head) who receives a bonus budget and is responsible for dividing it among the people working under them, entering milestone KPI scores and each person's engagement/contribution.

### Secondary persona

Employee — participates in one or more projects/milestones and needs to see their own computed bonus and their history of past projects and bonuses, without being able to see others' figures or edit inputs.

## Success Criteria

### Primary
- The 6-step flow works end to end: Admin configures global settings → Supervisor creates a project and its milestones → Supervisor records employee engagement (time share, contribution rating) → Supervisor enters milestone KPI scores → the system computes each employee's bonus for the milestone → the employee can view their own computed result.

### Secondary
- A Supervisor/Admin can view or export an aggregate report of total bonus and milestone count per employee (equivalent to the workbook's Raport tab).

### Guardrails
- The sum of bonus payouts for a milestone never exceeds that milestone's bonus pool.
- An employee can see only their own bonus results and history — never another employee's figures, including via direct URL manipulation.
- An employee's total engagement (time share) across active milestones never exceeds 100%.

## User Stories

### US-01: Supervisor closes out a milestone and the employee sees their bonus

- **Given** a milestone with its four KPI scores entered and every assigned employee's time-share and contribution rating recorded
- **When** the Supervisor reviews the computed results and marks the milestone Approved
- **Then** each employee's bonus is computed per the formula, the total never exceeds the milestone's pool, and the affected employee can independently view their own result and receives an email notification of it

#### Acceptance Criteria
- The sum of all computed bonuses for the milestone is ≤ the milestone's bonus pool
- An employee viewing results sees only their own bonus, never another employee's
- Before the Supervisor marks the milestone Approved, no employee can see or is emailed its results
- If any employee's total time-share across active milestones exceeds 100%, this is flagged to the Supervisor

## Functional Requirements

### Administracja i konfiguracja
- FR-001: Admin can add, edit, and remove role entries and their associated role weight. Priority: must-have
  > Socrates: Counter-argument considered: changing a role's weight would retroactively change already-computed historical bonuses. Resolution: kept; a role-weight change applies only to future computations — milestones whose results are already Approved (see FR-018) keep their historical figures frozen.
- FR-002: Admin can define/edit KPI weights and the min/max milestone-multiplier bounds. Priority: must-have
  > Socrates: Counter-argument considered: same retroactivity risk as FR-001. Resolution: kept; same rule — changes apply prospectively only, Approved milestones are not recalculated.
- FR-003: Admin can define/edit the contribution-rating (1-5) → factor (0.8-1.2) mapping. Priority: must-have
  > Socrates: Counter-argument considered: same retroactivity risk. Resolution: kept; same prospective-only rule applies.

### Projekty i etapy
- FR-004: Supervisor can create a project (name, period, status, total bonus budget, free-text notes describing what it's for and who it's for). Priority: must-have
  > Socrates: Counter-argument considered: without validating that the period's end date is not before its start date, inconsistent project periods become possible. Resolution: kept, with that validation added as an explicit acceptance criterion.
- FR-005: Supervisor can create a milestone within a project (name, period, bonus pool, status, free-text notes). Priority: must-have
  > Socrates: Counter-argument considered: nothing checks whether the sum of a project's milestone pools stays within that project's total bonus budget (a gap inherited from the spreadsheet, which has no project-level budget field at all). Resolution: closed via new FR-017 below — the project now carries a total bonus budget (added to FR-004) and its milestone pools are checked against it.
- FR-006: Supervisor can enter/update a milestone's four KPI scores (Termin, Budżet, Jakość, Ryzyko), from which the system computes the milestone multiplier. Priority: must-have
  > Socrates: Counter-argument considered: manual 0-100 scoring without guidance is subjective and may be inconsistent across supervisors. Resolution: kept as-is; this subjectivity is an inherent, unchanged property of the model already validated in the spreadsheet in use today — no new mechanism added in MVP.

### Pracownicy i zaangażowanie
- FR-007: Admin/Supervisor can register an employee with a role, from which the role weight derives. Priority: must-have
  > Socrates: No counter-argument raised; stands as written.
- FR-008: Supervisor can assign an employee to a milestone with a time-share (0-1) and a contribution rating (1-5). Priority: must-have
  > Socrates: No counter-argument raised; stands as written — manual entry is the accepted MVP tradeoff since RCP (automatic time capture) is explicitly out of scope (see Non-Goals).

### Wyliczenie i wyniki
- FR-009: Supervisor can view, for any milestone, the computed bonus for every assigned employee, per the formula. Priority: must-have
  > Socrates: No counter-argument raised; stands as written — visibility into one's own team's bonuses is inherent to the Supervisor role.
- FR-010: Supervisor can view a milestone summary showing the pool, the computed payout total, and the remaining/unallocated amount, flagged against whether the total stays within the pool. Priority: must-have
  > Socrates: Counter-argument considered: an informational flag alone doesn't prevent exceeding the pool. Resolution: kept as informational; the proportional-split formula (rounded down) mathematically cannot exceed the pool by construction, so this flag is confirmatory, not preventive — the real guardrail is the formula itself.
- FR-011: Supervisor can view, per employee, whether their total time-share across active milestones exceeds 100%. Priority: must-have
  > Socrates: Counter-argument considered: >100% engagement is sometimes legitimate (overtime, multiple concurrent projects), so a rigid rule could cry wolf. Resolution: kept as an informational flag only, not a blocking rule — same as the spreadsheet's Kontrola tab; Supervisor judgment prevails.
- FR-012: Employee can view their own computed bonus for a milestone once its results are Approved (see FR-018). Priority: must-have
  > Socrates: Counter-argument considered: an employee could see draft/not-yet-final data before the Supervisor confirms it. Resolution: closed via new FR-018 — a Draft/Approved state gates employee visibility.

### Nawigacja i historia
- FR-013: Supervisor can navigate from a milestone's results directly to an employee's detail view. Priority: must-have
  > Socrates: Counter-argument considered: this is navigational convenience, not a new business capability, and could be deferred. Resolution: kept as must-have; it directly answers the reported pain (information trapped across disconnected tabs).
- FR-014: Supervisor/Employee can view an employee's history of their own past projects/milestones and the bonuses received in each. Priority: must-have
  > Socrates: Counter-argument considered: "full employee history" could balloon into browsing every project company-wide. Resolution: kept, scoped explicitly to the employee's own participation history only — not a company-wide project browser.

### Powiadomienia i zatwierdzanie
- FR-016: The system can send an employee an email with their computed bonus for a milestone once it is Approved (see FR-018), removing the need for a supervisor to manually copy and send it. Priority: must-have
  > Socrates: No counter-argument raised; stands as written — this directly answers a need the user raised explicitly.
- FR-017: Supervisor can view, for a project, whether the sum of its milestones' bonus pools exceeds the project's total bonus budget. Priority: must-have
  > Socrates: This FR exists specifically to close the gap surfaced by FR-005's Socrates round — the spreadsheet has no project-level budget check at all.
- FR-018: Supervisor can mark a milestone's computed results as Approved; before approval, results are Draft and are visible only to the Supervisor — not to the affected employees, and no email notification is sent. Priority: must-have
  > Socrates: This FR exists specifically to close the gap surfaced by FR-012's Socrates round — employees must not see or be emailed unconfirmed figures.

### Raport (drugorzędne)
- FR-015: Supervisor/Admin can view or export an aggregate report of total bonus and milestone count per employee. Priority: nice-to-have
  > Socrates: Counter-argument considered: as a nice-to-have, should it be in MVP scope at all? Resolution: kept as nice-to-have — attempted if time allows, never blocking the release.

## Non-Functional Requirements

- Bonus and compensation figures are visible only to the role entitled to see them (Admin: all; Supervisor: their own team; Employee: only themselves) — no user can retrieve another employee's bonus data under any circumstance, including by manipulating a URL.
- A Supervisor viewing a milestone's computed results for a typical team sees them within 2 seconds of opening the view.
- The product remains fully usable — including all Supervisor and Employee flows — on both desktop browsers and a smartphone's mobile browser, without requiring a dedicated native app.
- The product works on the standard browser already deployed inside the company, without requiring a specific non-standard browser or plugin.

## Business Logic

Meritly computes each employee's project bonus by splitting a milestone's fixed bonus pool proportionally among the employees engaged in it, according to each employee's weighted contribution (time share × role weight × contribution rating), scaled by a milestone performance multiplier derived from schedule, budget, quality, and risk scores, and rounded down so the total payout never exceeds the pool.

The rule consumes: the milestone's bonus pool amount; each engaged employee's time-share and contribution rating for that milestone; each employee's role (which carries a weight); and the milestone's four performance scores (schedule, budget, quality, risk). Its output is an approved, per-employee bonus amount for that milestone, alongside a check that the milestone's total payout stays within its pool and a check that the project's total milestone pools stay within its overall budget. The Supervisor encounters this rule by reviewing the computed per-employee table before marking a milestone Approved; the employee encounters it as their own bonus figure, visible in-app and delivered by email, only once approved.

## Access Control

Login (email + password or OAuth). Company single sign-on integration was raised as a future option but is a downstream tech-stack decision, not locked here.

Three roles:

- **Admin** — manages global configuration (role weights, KPI weights, contribution-score → factor mapping); can see everything.
- **Supervisor** — a budget-holding manager at any level (PM, Team Leader, Team Manager, Department Head); operates on their own projects, milestones, and the employees engaged in them (enters KPI scores, engagement, contribution ratings).
- **Employee** — sees only their own computed bonus results and their own history across projects/milestones; no edit rights, no visibility into others' figures.

An unauthenticated user hitting any route is redirected to login.

## Non-Goals

- No built-in time-tracking (RCP) module — employee engagement (time share) is entered manually by the Supervisor. A dedicated daily time-registration module is a deliberate later step, once a rule exists for converting logged hours into a time-share.
- No automatic import of employee time from an external work-management tool — manual entry is the accepted MVP tradeoff.
- No embedding inside an external collaboration platform, and no notifications through one — the MVP is a standalone web app reached via a normal browser, with email as the only notification channel. Running inside such a platform and notifying through it are long-term targets, not part of this MVP.

## Open Questions

None. The shape-notes quality cross-check (`quality_check_status: accepted`) found no unresolved gaps prior to PRD generation.
