<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Supervisor Approves Milestone, Employee Sees Bonus

- **Plan**: context/changes/supervisor-approves-milestone-employee-sees-bonus/plan.md
- **Mode**: Deep
- **Date**: 2026-10-05
- **Verdict**: REVISE → SOUND after triage (all 5 findings fixed in plan)
- **Findings**: 1 critical, 3 warnings, 1 observation

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | WARNING |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | FAIL    |
| Plan Completeness     | WARNING |

## Grounding

- **Paths:** 11/11 ✓.
- **Symbols:** 4/4 ✓ (`isMilestoneInProject`, `projectIdSchema`, `parseForm`, the `milestones_check_scores` condition).
- **Consistency:** brief↔plan ✓; Progress↔Phase 31/31 ✓; 4 of 5 contract-surfaces headings touched ✓.
- **Claims verified:**
  - Stable-function snapshot semantics (PostgreSQL 17 docs, xfunc-volatility).
  - No existing pgTAP assertion breaks.
  - No legitimate path updates an approved milestone.
  - `milestones_check_frozen` sorts before `milestones_check_parent`.

## Findings

### F1 — Milestone can be INSERTed directly as 'approved', no snapshot

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — freeze trigger + budget view
- **Detail**:
  - The freeze trigger was update-only. The new CHECK allows `approved`, and `milestones_insert_supervisor` permits inserts.
  - So a crafted insert creates an approved milestone with no `milestone_results` row.
  - The budget view then reserves `NULL`, which `sum()` ignores, so the milestone reserves 0 and FR-017 undercounts.
- **Fix**:
  - Trigger becomes `before insert or update`; an insert with `approved` raises MR014.
  - The view uses `coalesce(payout_pool, target_pool)` for approved milestones.
  - pgTAP gets both cases.
  - MR006 is raised before 42501, to keep the existing precedence.
- **Decision**: FIXED

### F2 — Email link doesn't bring a signed-out employee to /my-bonuses

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 4 manual criterion; Phase 3 middleware
- **Detail**: `src/middleware.ts:59-62` redirects to a bare `/auth/signin`, and `src/pages/api/auth/signin.ts:22` always redirects to `/`. No `next`/`redirectTo` support exists.
- **Fix A ⭐ Recommended**: same-origin `?next=` round trip
  - Strength: the link works when signed out, and all protected routes benefit.
  - Tradeoff: touches the auth flow (3 files plus `SignInForm`).
  - Confidence: HIGH.
  - Blind spot: the React island needs a hidden field.
- **Fix B**: an employee entry point on `/` and the dashboard, with no auth changes
  - Strength: no auth changes.
  - Tradeoff: one extra click.
  - Confidence: HIGH.
  - Blind spot: none significant.
- **Decision**: FIXED via Fix A (Phase 3 §4; Progress 3.9, 3.10)

### F3 — Snapshot tables don't enforce the pool invariants

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — `milestone_results` / `milestone_result_lines`
- **Detail**: CLAUDE.md requires the invariants to hold in code and in the database, but the stored figures had no CHECKs and no declared money types.
- **Fix**:
  - Money columns are `numeric(12,2) not null`.
  - Header CHECKs: pool ≥ 0, pool ≤ target, 0 ≤ total ≤ pool, residual = pool − total.
  - Lines CHECK: bonus ≥ 0.
  - pgTAP checks for `23514`.
- **Decision**: FIXED

### F4 — UI spots that break or mislead for 'approved' not listed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §3–4
- **Detail**:
  - `[milestoneId].astro:79`: `isClosedStatus(WorkStatus)` becomes a type error.
  - `:226-230`: the "Reopen it" copy is wrong for an approved milestone.
  - `MilestonesSection.astro:119-136`: renders edit rows for every milestone.
  - `MilestonesSection.astro:92-96`: mutes only cancelled rows.
  - `MilestoneForm.astro:23,50`: would preselect no option.
- **Fix**: list the four edits explicitly in Phase 2.
- **Decision**: FIXED

### F5 — Emails go to employees who were never invited

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 — Edge Function data
- **Detail**: Emailing every engaged employee is a deliberate decision. For never-invited employees, though, the address is unverified Supervisor input, and the `/my-bonuses` link cannot work for them.
- **Fix**: keep the decision; add an "ask for an invite" line for recipients without an activated account; record the typo risk in the plan and the brief's Open Risks.
- **Decision**: FIXED
