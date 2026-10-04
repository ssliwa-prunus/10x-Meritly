<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Supervisor scores milestone and sees computed bonuses

- **Plan**: context/changes/supervisor-scores-milestone-and-sees-computed-bonuses/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-10-04
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | WARNING |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Automated criteria were re-run at HEAD 7cb0266, and all pass:

- `supabase db reset`;
- `supabase test db`: 277 tests;
- `lint:ui`: 11 files clean;
- `lint`;
- `astro check`: 0 errors;
- `build`;
- `smoke`.

All 45 Progress rows are `[x]`. Row 4.8 is closed by 5.9, as the Phase 5 note records.

Several manual checks are backed by observed evidence (curl and HTML renders, recorded in session):

- KPI route redirects for valid, invalid, Admin, non-owner and cancelled requests;
- milestone …0021 at 2 740,38 zł with a 91,3% share of the target pool;
- project exposure at 6 000,00 zł.

## Findings

### F1 — Payout figures come from two RPC snapshots, and the split runs twice

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/payouts.ts:245-248; supabase/migrations/20261004130000_milestone_payout_hard_cap.sql:214-217
- **Detail**:
  - `getMilestonePayout` calls `milestone_payout_summary` and `milestone_payout_lines` as two parallel RPCs, so they run as separate statements with separate snapshots.
  - If config, role weights or engagements change between the two calls, the displayed total and residual may not equal the sum of the displayed lines.
  - The summary also calls `milestone_payout_lines()` internally, so every page load computes the split twice.
  - Draft figures are self-correcting on reload, but S-05's approval snapshot must not copy this pattern.
- **Fix A ⭐ Recommended**: Load both from one statement. Either add a `milestone_payout(p_milestone_id)` RPC that returns the summary row with its lines as JSON, or derive the summary totals in the page from a single lines call plus a summary call that no longer sums the lines.
  - Strength: One snapshot and one split per load, and the same single-statement shape S-05 needs for freezing.
  - Tradeoff: A new migration and contract change; touches the service, types and pgTAP.
  - Confidence: MED — the single-RPC JSON shape is new to this repo.
  - Blind spot: How PostgREST typing handles a composite/JSON return in this untyped client.
- **Fix B**: Keep it as is for Draft, and record "single-snapshot computation" as a hard requirement in the S-05 plan.
  - Strength: No rework now; the risk is cosmetic and transient while results are Draft.
  - Tradeoff: The double computation stays, and the inconsistency window stays until S-05.
  - Confidence: HIGH — the figures are recomputed on every read.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix B — kept for Draft; single-snapshot computation and the multiplier_max snapshot queued as hard S-05 requirements in follow-ups/review-fixes.md

### F2 — CLAUDE.md invariant still describes the superseded payout rule

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: CLAUDE.md:13; supabase/migrations/20260927120000_projects_and_milestones.sql:205-206 (comment)
- **Detail**:
  - CLAUDE.md still says the payout pool is "target pool × KPI multiplier" and that the worst case is "target pool × current maximum multiplier for the rest".
  - Since 20261004130000 the pool is floor(target × M / max), never above the target pool, and exposure reserves the target pool. The PRD, roadmap and contract registry were updated; CLAUDE.md was not, and agents treat it as authoritative.
  - The `money_floor_mul` comment ("S-04 reuses it for payout_pool") is also stale. Leave that comment alone: the migration is already applied, so edit only where safe or note it in the registry.
  - CLAUDE.md currently has unrelated uncommitted edits by the user, so commit only the invariant line.
- **Fix**: Rewrite the CLAUDE.md invariant to "payouts never exceed the payout pool = target pool × M / max multiplier, which never exceeds the target pool; worst case = actual payout pool for Approved milestones, target pool for the rest".
- **Decision**: FIXED — CLAUDE.md:13 rewritten to the hard-cap rule (only that line; the user's other uncommitted CLAUDE.md edits untouched)

### F3 — A payout load error hides the whole milestone page

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/projects/[id]/milestones/[milestoneId].astro:63-69
- **Detail**: `payoutResult.error` feeds the page-level `loadError`. If `milestone_payout_lines` raises one of its guard exceptions (an unresolvable role weight, or invisible bonus settings), the details, KPI form and assignments disappear too, including the means to fix the data. This is unlikely for owners and Admins.
- **Fix**: Show payout load errors inside the bonuses card only, and keep the rest of the page.
- **Decision**: FIXED — payout load errors render inside a 'Computed bonuses' card; details and assignments keep rendering

### F4 — The "raise instead of shrinking the split" guard has no pgTAP test

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/migrations/20261004120000_milestone_kpi_and_payouts.sql:180-195
- **Detail**: The plan's Critical Implementation Details require `milestone_payout_lines` to raise rather than split among fewer people when a role weight is unresolvable. The code does this, but no assertion covers it, so a regression would go unnoticed.
- **Fix**: Add a `throws_ok` case to milestone_payouts.test.sql: as a caller who sees the engagements but not the employee/job role (or with a fixture made unreadable), expect the raise.
- **Decision**: FIXED — throws_ok case with a rolled-back restrictive job_roles policy (plan 54→55); break-check: went red with the guard disabled, green after restore

### F5 — Plan text out of date with the accepted deviations

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/supervisor-scores-milestone-and-sees-computed-bonuses/plan.md (Phase 1 contract, Phase 2 catalog)
- **Detail**: The plan says:
  - MR012 (the code uses MR013; MR012 was taken);
  - fixtures in `…0004xx` (they use `…0005xx`);
  - "another Supervisor gets 42501 on update" (RLS filters the row, so 0 rows change; the 42501 ordering is proven via an insert instead).

  It also omits the justified copy fix in src/pages/projects/index.astro. S-05's planner will read this plan.

- **Fix**: Add a short "Deviations during implementation" note to the plan's Overview listing these four items.
- **Decision**: FIXED — 'Deviations during implementation' note added under the plan Overview

### F6 — Multiplier and weighted contribution display rounds 6-decimal values to 4

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/format.ts:21; src/components/milestones/PayoutSection.astro
- **Detail**: M and `weighted_contribution` can carry up to 6 decimals, but `formatMultiplier` shows at most 4 (half-up). The display can differ slightly from the value used in SQL. This is display-only; bonuses are computed in SQL.
- **Fix**: Allow up to 6 fraction digits in `formatMultiplier`, which is still trimmed when shorter.
- **Decision**: FIXED — formatMultiplier allows up to 6 fraction digits

### F7 — KPI route hardcodes `invalid_id` where siblings use `firstIssueError`

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/projects/[id]/milestones/[milestoneId]/kpi.ts:15,20
- **Detail**: The behaviour is equivalent to `src/pages/api/projects/[id]/milestones/[milestoneId].ts`; only the style differs.
- **Fix**: Use `firstIssueError(parsed.error)` like the sibling route.
- **Decision**: FIXED — kpi.ts uses firstIssueError like the sibling route
