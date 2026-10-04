# Supervisor scores milestone and sees computed bonuses Implementation Plan

## Overview

Roadmap S-04 (north star; FR-006, FR-009, FR-010). A Supervisor enters a milestone's four KPI scores (Termin, Budżet, Jakość, Ryzyko, whole numbers 0–100). The system derives the milestone multiplier M from them, scales the target pool into the payout pool, and splits that pool among the milestone's engaged employees by weighted contribution, rounded down to the grosz. The milestone page shows a summary (target pool, M, payout pool, payout total, rounding residual, within-pool check) and the per-employee bonus table. All results are Draft and computed live on read; S-05 adds approval, freezing and employee visibility.

## Current State Analysis

- `bonus_settings` (singleton) holds KPI weights (sum exactly 1, DB CHECK), `multiplier_min/max` and `rating_factor_1..5`; `job_roles.weight` holds role weights (`supabase/migrations/20260926120000_bonus_rules_config.sql:15-76`). Supervisors and Admins can read both; Employees read nothing.
- `milestones` has `target_pool numeric(12,2)` and a `planned/active/completed/cancelled` status, with no KPI storage yet (`supabase/migrations/20260927120000_projects_and_milestones.sql:256-274`). The owning Supervisor updates the table; Admins only read it (`:523-546`). `milestones_check_parent` raises 42501 for non-owners and MR003 when the project is closed (`20260927130000_milestones_guard_ownership.sql:587-626`).
- `money_floor_mul(amount, multiplier)` is the single money-rounding rule and is reserved for `payout_pool` (`20260927120000_projects_and_milestones.sql:204-218`). The TypeScript side does no money arithmetic (`src/lib/format.ts:3-6`).
- `milestone_engagements` stores `time_share numeric(3,2)` in (0,1] and `rating smallint` 1–5, one row per (milestone, employee). Supervisors keep read access to an engaged employee's row even after an owner change (`employee_engaged_on_own_milestone`, `20260929120000_employees_and_engagements.sql:761-778`), so every engagement's role weight stays readable by the milestone's owner.
- The KPI→multiplier mapping is undefined in the PRD (`context/foundation/prd.md:138`, an unspecified `→`). Its only source is `Milestones!M` in `docs/Model Premiowania/Model_premiowania.xlsx`: `M = clamp(min + (w_T·T/100 + w_B·B/100 + w_J·J/100 + w_R·(1 − R/100))·(max − min))`. The spreadsheet then caps the effective multiplier at 1 (`Wyniki!I`), which the PRD deliberately drops. Ryzyko direction contradicts itself across the docs (the formula says higher = worse; the instruction doc's scale "70–90 = lekkie ryzyko, <30 = chaos" says higher = better).
- pgTAP suites live in `supabase/tests/*.test.sql` and run in CI via `supabase test db` (`.github/workflows/ci.yml:45`). Isolation: own fixtures in a reserved UUID range, rolled back, settings pinned in-transaction (`supabase/tests/projects_rls.test.sql:1-12`).
- The milestone page `src/pages/projects/[id]/milestones/[milestoneId].astro` and `src/components/engagements/EngagementForm.astro` still use literal palette classes and `form-classes.ts`; the project detail page and its sections are already on tokens/shadcn and listed in `CLEAN_PATHS` (`scripts/check-ui-literals.mjs:9-17`).
- Load-bearing names are registered in `docs/reference/contract-surfaces.md`.

## Desired End State

- `milestones` carries four nullable KPI score columns (whole numbers 0–100, all four set or none).
- `public.milestone_payout_summary(milestone_id)` and `public.milestone_payout_lines(milestone_id)` compute, exactly and at read time, M, the payout pool, each bonus, the total and the residual. They return nothing to callers who cannot see the milestone.
- pgTAP proves the worked example, the multiplier effect, the pool guardrail, the unscored and empty states, the guards and RLS.
- A Supervisor scores a non-cancelled milestone of an open project from the milestone page and immediately sees the summary and the per-employee table. Admins see the same figures read-only. Before scoring, the table shows weighted contributions and shares but no PLN amounts.
- The whole milestone page is on tokens and shadcn components and guarded by `npm run lint:ui`. The new sections render in the kitchen sink.

Verify: `npx supabase db reset && npx supabase test db`, `npm run lint`, `npm run lint:ui`, `npx astro check`, `npm run build`, `npm run smoke`, then the manual checks per phase.

### Key Discoveries:

- Worked example with the default config (weights 0.30/0.30/0.25/0.15, bounds 0.70/1.30, factors 0.8…1.2), Ryzyko higher = better:
  - Scores 80/90/85/60 give inner = 0.8125, M = 0.70 + 0.8125 × 0.60 = **1.1875**.
  - Target 10 000.00 gives a payout pool of **11 875.00**.
  - Engagements (0.50, weight 1.25, rating 4), (0.50, 1.10, 4) and (0.30, 1.00, 3) give e = 0.6875 / 0.605 / 0.30, Σe = 1.5925.
  - Bonuses are **5 126.56 / 4 511.38 / 2 237.04**, total **11 874.98**, residual **0.02**.
  - The same engagements scored 0/0/0/0 give M = 0.70 and a payout pool of 7 000.00. Scored 100/100/100/100 they give M = 1.30 and a pool of 13 000.00.
- KPI weights sum to exactly 1 and scores are in [0,100], so the inner term is in [0,1] and M lands in [min, max] without clamping. Keep a `greatest/least` clamp anyway as a guard.
- Inputs have at most 2 decimals each (time share, role weight, rating factor, KPI weights). Scaled by 100 they become integers, so the whole split can be done in exact integer grosze.
- Milestone row triggers fire in name order. A new guard named alphabetically before `milestones_check_parent` would run before its 42501 ownership check.

## What We're NOT Doing

- No Approved status, no freezing or snapshot of config onto result rows, no employee visibility, no email (all S-05).
- No change to `project_budget_exposure`. Every non-cancelled milestone stays reserved at target × max until S-05 counts Approved milestones at their payout pool.
- No persisted result table. Draft figures follow the current config, role weights and engagements on every read.
- No computed figures on the project detail page's milestones table; they appear on the milestone page only.
- No clearing of KPI scores once set (they can be changed, not removed), and no partial scoring.
- No fractional KPI scores, only whole numbers 0–100.
- No reproduction of the spreadsheet's `MIN(M,1)` cap or its inverted Ryzyko. M above 1.0 pays out more than the target pool (PRD Business Logic).
- No CSV/export and no per-employee drill-down link (S-06/S-07).

## Implementation Approach

Database first, proven before the app depends on it. Phase 1 lands the columns, the guard and both computation functions together with their pgTAP suite, so the formula is verified in exact numeric arithmetic before any UI exists. Phase 2 adds the thin TS layer (zod schema, error catalog, RPC loaders, one POST route) following the engagements/projects service pattern. Phase 3 migrates the existing milestone page onto tokens with no behaviour change, so restyle regressions are isolated. Phase 4 adds the two new sections as components, renders them in the kitchen sink and runs the state pass.

## Critical Implementation Details

- **Exact split, never numeric division before the floor.** Postgres numeric division rounds at its own scale, so `floor(pool × e_i / Σe)` can round a value just below a grosz boundary up to it and overpay by 0.01. Compute each bonus in integer grosze as `div(pool_grosze × e_scaled_i, Σ e_scaled) / 100`. Here `e_scaled_i = (time_share·100)·(role_weight·100)·(rating_factor·100)`, `pool_grosze = payout_pool·100`, and `div` is truncating integer division (exact; inputs positive). Compute the multiplier only with multiplication and exact `* 0.01` scaling, then reuse `money_floor_mul(target_pool, M)` for the payout pool.
- **Guard ordering.** Name the new KPI guard trigger so it sorts after `milestones_check_parent` (e.g. `milestones_check_scores`), or repeat the `owns_project` 42501 check first. Otherwise a non-owner gets MR012 about a milestone they cannot see.
- **No silent shrinking of the split.** If any engagement's role weight or rating factor cannot be resolved (employee row not visible), `milestone_payout_lines` must raise rather than split the pool among fewer people.

## Phase 1: Schema, computation and pgTAP

### Overview

Store KPI scores, guard them, and compute payouts exactly in SQL, proven by a new pgTAP suite.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20261004120000_milestone_kpi_and_payouts.sql`

**Intent**: Add KPI score storage to milestones and the two read-time computation functions. All rules (range, all-or-nothing, cancelled guard) are enforced in the database, so app validation is a convenience only. A header comment documents the formula, the Ryzyko direction (higher = better, a deliberate departure from the spreadsheet formula), and that S-05 snapshots these figures on approval.

**Contract**:

- Columns on `public.milestones`: `kpi_schedule`, `kpi_budget`, `kpi_quality`, `kpi_risk`, all `smallint null`.
  - CHECK each `between 0 and 100`.
  - CHECK `milestones_kpi_all_or_none`: `num_nulls(kpi_schedule, kpi_budget, kpi_quality, kpi_risk) in (0, 4)`.
  - Milestones keep the table-level update grant, so no grant changes are needed; existing update policies cover the columns.
- Guard trigger function `public.milestones_check_scores()` (security definer, `search_path = ''`, execute revoked), on `before insert or update of kpi_schedule, kpi_budget, kpi_quality, kpi_risk`:
  - raises `42501` for a JWT caller who doesn't own the project;
  - raises new SQLSTATE `MR012` (`milestone_cancelled`) when any score is set or changed while `new.status = 'cancelled'`.
  - MR003 (closed project) already comes from `milestones_check_parent`.
- `public.kpi_multiplier(p_schedule smallint, p_budget smallint, p_quality smallint, p_risk smallint) returns numeric`:
  - stable, security invoker; reads `bonus_settings`;
  - returns `least(max, greatest(min, min + (w_s·S + w_b·B + w_q·Q + w_r·R) · 0.01 · (max − min)))`, or null if any score is null;
  - the single place the KPI→M mapping lives.
- `public.milestone_payout_lines(p_milestone_id uuid)`:
  - stable, security invoker, `search_path = ''`;
  - returns table `(engagement_id uuid, employee_id uuid, employee_name text, job_role_name text, time_share numeric, role_weight numeric, rating smallint, rating_factor numeric, weighted_contribution numeric, share numeric, bonus numeric)`, one row per visible engagement ordered by employee name;
  - `weighted_contribution` is exact e_i and `share` is e_i/Σe for display only;
  - `bonus` is null while the milestone is unscored.
- `public.milestone_payout_summary(p_milestone_id uuid)`:
  - stable, security invoker;
  - returns zero or one row `(milestone_id uuid, target_pool numeric, kpi_schedule smallint, kpi_budget smallint, kpi_quality smallint, kpi_risk smallint, scored boolean, multiplier numeric, payout_pool numeric, payout_total numeric, residual numeric, within_pool boolean, engagement_count integer)`;
  - multiplier, pool, total, residual and within_pool are null while unscored;
  - when scored with no engagements: total 0 and residual = payout pool.
- Execute on all three functions is revoked from `public, anon` and granted to `authenticated`. RLS on milestones, engagements, employees, job_roles and bonus_settings decides visibility: Employees and non-owning Supervisors get no rows, Admins get all.

#### 2. pgTAP suite

**File**: `supabase/tests/milestone_payouts.test.sql`

**Intent**: Prove the formula and its guardrails using the isolation model of the existing suites. Fixtures go in a new reserved UUID range (`…0004xx`, emails `@pgtap.test`), `bonus_settings` is pinned to the defaults inside the transaction, and everything is rolled back.

**Contract**: The suite asserts:

- The worked example from Key Discoveries: M = 1.1875, payout pool 11 875.00, bonuses 5 126.56 / 4 511.38 / 2 237.04, total 11 874.98, residual 0.02, within_pool true.
- **The multiplier is not cancelled out:** the same engagements scored 0/0/0/0 give pool 7 000.00 and a different total. Scored 100/100/100/100 they give M = 1.30 and pool 13 000.00, so M can exceed 1.0 and payout pool ≤ target × max.
- **Ryzyko higher = better:** raising only `kpi_risk` raises M.
- **Exact floor:** a fixture whose exact shares are recurring decimals (e.g. three equal engagements on a 100.00 pool) gives 33.33 each, residual 0.01, and Σ bonus ≤ payout pool.
- **Unscored state:** lines have bonus null with shares present; the summary has `scored` false and null money fields.
- **Empty milestone:** scored with no engagements gives total 0 and residual = pool.
- **Constraints:** out-of-range score (101, −1) rejected; partial scores rejected (all-or-none check); score change on a cancelled milestone gives MR012; score change while the project is closed gives MR003.
- **RLS:**
  - the owning Supervisor can update scores and read both functions;
  - another Supervisor gets 42501 on update and zero rows from both functions;
  - an Admin can read but not update (zero rows updated or denied);
  - an Employee gets zero rows from both functions.

#### 3. Seed

**File**: `supabase/seed.sql`

**Intent**: Give local dev a scored milestone so the page shows figures out of the box.

**Contract**: Set scores 80/90/85/60 on seed milestone `…0021`, leave `…0022` unscored, and keep the existing engagements.

#### 4. Shared types and contract registry

**File**: `src/types.ts`, `docs/reference/contract-surfaces.md`

**Intent**: Mirror the function outputs as TS types and register the new load-bearing names that S-05 will reuse.

**Contract**:

- `src/types.ts` gets two new types:
  - `MilestonePayoutSummary`: mirrors the summary row, numerics as `number`, nullable money fields.
  - `MilestonePayoutLine`: mirrors the lines row.
- Registry rows go in `docs/reference/contract-surfaces.md` for:
  - the four KPI columns and the `milestones_kpi_all_or_none` check;
  - `milestones_check_scores` and MR012;
  - `kpi_multiplier`, `milestone_payout_lines` and `milestone_payout_summary`;
  - the two TS types.

### Success Criteria:

#### Automated Verification:

- Migration and seed apply cleanly: `npx supabase db reset`
- pgTAP suites pass, including the new one: `npx supabase test db`
- Type check passes: `npx astro sync && npx astro check`
- Lint passes: `npm run lint`

#### Manual Verification:

- In Supabase Studio as the seed Supervisor, `select * from milestone_payout_summary('…0021')` shows M, the payout pool and a residual consistent with the seed engagements, and `…0022` shows `scored = false`
- The migration header comment states the formula, Ryzyko direction and the S-05 snapshot obligation clearly enough for the S-05 planner

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Service and API

### Overview

A thin TS layer: validate and save KPI scores, and load the computed figures via RPC.

### Changes Required:

#### 1. Payouts service

**File**: `src/lib/services/payouts.ts`

**Intent**: Own the KPI form schema, its error catalog and the data access for scores and payouts. It follows the `engagements.ts` pattern: fixed-code catalog, `parseForm`/`firstIssueError` from `@/lib/forms`, request-scoped client only, numerics converted with `Number()` for display.

**Contract**:

- `kpiScoresInputSchema`: zod object with `kpi_schedule`, `kpi_budget`, `kpi_quality`, `kpi_risk`, each a required whole number 0–100. The regex rejects `2.5`, `1e1` and blanks.
- Error catalog codes:
  - form and generic: `invalid_form`, `invalid_id`, `required`, `kpi_range`, `not_found`, `save_failed`, `not_configured`;
  - permission and guards: `admin_read_only`, `milestone_cancelled` (MR012), `project_closed` (MR003);
  - field labels Termin / Budżet / Jakość / Ryzyko.
- Functions:
  - `kpiErrorMessage(code, field)`;
  - `updateKpiScores(supabase, projectId, milestoneId, input)`: update filtered by id and project_id, zero rows → `not_found`, 42501 → `not_found`;
  - `getMilestonePayout(supabase, milestoneId)`: both RPCs → `{ summary: MilestonePayoutSummary | null, lines: MilestonePayoutLine[] }`.
- Redirect helper: `kpiUrl(projectId, milestoneId, flash)` builds the milestone page URL with `saved=kpi`, or with `error=<code>&field=<name>&section=kpi`.

#### 2. KPI route

**File**: `src/pages/api/projects/[id]/milestones/[milestoneId]/kpi.ts`

**Intent**: POST endpoint for the KPI form, mirroring `src/pages/api/projects/[id]/milestones/[milestoneId].ts`. It validates the ids, exits early for Admins (`admin_read_only`; RLS is the real enforcement), parses the form, saves, and redirects with a flash.

**Contract**: `POST` only. Each outcome redirects (302) to the milestone page via `kpiUrl`: `saved=kpi`, or a catalog error code.

#### 3. Display helper

**File**: `src/lib/format.ts`

**Intent**: Format the multiplier and share for display only.

**Contract**:

- `formatMultiplier(value)`: Polish locale, up to 4 decimals (e.g. "1,1875").
- A share formatter with one decimal percent.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npx astro check`
- Lint passes: `npm run lint`
- Build passes: `npm run build`
- Smoke test passes: `npm run smoke`

#### Manual Verification:

- Posting valid scores via the (still unstyled) form or curl as the owning Supervisor redirects with `saved=kpi`, and the summary RPC reflects them
- Posting `101`, a blank or `2.5` redirects with the matching catalog code and field, never free text
- Posting as an Admin redirects with `admin_read_only`; posting for a cancelled milestone redirects with `milestone_cancelled`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Milestone page onto tokens

### Overview

Move the existing milestone page (header, details, assignments) and `EngagementForm` onto tokens and shadcn components with no behaviour change, then guard them.

### Changes Required:

#### 1. Milestone page

**File**: `src/pages/projects/[id]/milestones/[milestoneId].astro`

**Intent**: Replace literal palette classes, arbitrary values and `form-classes.ts` usage with token classes and `ui/` components, following `src/pages/projects/[id].astro` and `src/components/projects/MilestonesSection.astro`:

- `Card` for sections;
- `Table` for assignments;
- `Alert` (`success` / `destructive`) for flashes and errors;
- `Badge` for "Over 100%";
- `Button` for delete;
- `bg-cosmic` shell.

**Contract**: The rendered structure, ids (`#assignments`), error routing (row / add form / page), admin and closed notices are unchanged. No literal colours, palette classes or arbitrary px/rem remain.

#### 2. Engagement form

**File**: `src/components/engagements/EngagementForm.astro`

**Intent**: Use `Input`, `Label`, `NativeSelect`, `Alert` and `SubmitButton` (`client:load`) instead of `form-classes.ts`, as in `MilestoneForm.astro`.

**Contract**: Same props, field names, actions and validation attributes.

#### 3. UI guard

**File**: `scripts/check-ui-literals.mjs`

**Intent**: Lock the migrated views onto the contract.

**Contract**: Add `src/pages/projects/[id]/milestones/[milestoneId].astro` and `src/components/engagements/EngagementForm.astro` to `CLEAN_PATHS`.

### Success Criteria:

#### Automated Verification:

- UI literal check passes with the two new paths: `npm run lint:ui`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Build passes: `npm run build`

#### Manual Verification:

- The milestone page looks consistent with the project detail page (dark, cosmic shell, cards) on desktop and at phone width, with no horizontal page scroll
- Assign, edit, delete and each error placement (row, add form, page) still work as before; the Admin and closed-milestone notices still show
- Focus-visible rings show on links, buttons and form controls

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: KPI and bonus sections

### Overview

Add the KPI scores card and the computed bonuses card to the milestone page, render them in the kitchen sink, and run the state pass.

### Changes Required:

#### 1. KPI scores section

**File**: `src/components/milestones/KpiScoresSection.astro`

**Intent**: A card with four labelled whole-number inputs (Termin, Budżet, Jakość, Ryzyko), each with a short hint that 100 is best, Ryzyko included. Inputs are prefilled from the summary and post to the KPI route with `SubmitButton`. Show a success flash on `saved=kpi` and the catalog error on `section=kpi`. Render read-only values with a notice for Admins, cancelled milestones and closed projects.

**Contract**: Props `projectId`, `milestoneId`, `scores` (four nullable numbers), `canEdit`, `readOnlyReason: string | null`, `saved`, `error`. Field names match `kpiScoresInputSchema`.

#### 2. Computed bonuses section

**File**: `src/components/milestones/PayoutSection.astro`

**Intent**: A card with a summary list (target pool, multiplier, payout pool, payout total, residual, and a "Within payout pool" badge) followed by the per-employee table.

**Contract**:

- Props: `summary: MilestonePayoutSummary`, `lines: MilestonePayoutLine[]`.
- Table columns: employee, job role, time share, role weight, rating → factor, weighted contribution, share, bonus.
- Unscored: money fields and the bonus column read "Enter KPI scores", and shares still show.
- No engagements: an empty-state line pointing to Assignments.
- Amounts come from SQL already floored; display uses `formatPln` / `formatMultiplier` only.

#### 3. Page wiring

**File**: `src/pages/projects/[id]/milestones/[milestoneId].astro`

**Intent**:

- Load `getMilestonePayout` in the existing `Promise.all`.
- Compute `canEditKpi`: not Admin, milestone not cancelled, project not completed/cancelled.
- Route `saved=kpi` and `section=kpi` errors to the KPI card.
- Render the cards in order: details, KPI scores, computed bonuses, assignments.

**Contract**:

- A load error from the payout RPCs shows the existing page-level load error.
- KPI errors never land in the assignments section, and engagement errors never land in the KPI card.

#### 4. Kitchen sink and guard

**File**: `src/pages/dev/projects-kitchen-sink.astro`, `scripts/check-ui-literals.mjs`

**Intent**: Render both new sections in their states as the visual gate, and guard the new components.

**Contract**:

- Kitchen sink states:
  - KPI card: editable empty, editable prefilled, error, read-only Admin, read-only cancelled;
  - payout card: unscored, scored (the worked example figures), no engagements.
- The two component paths are added to `CLEAN_PATHS`.

### Success Criteria:

#### Automated Verification:

- UI literal check passes including the new components: `npm run lint:ui`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Build passes: `npm run build`
- Smoke test passes: `npm run smoke`
- pgTAP still passes: `npx supabase test db`

#### Manual Verification:

- As the seed Supervisor, the page for milestone `…0021` shows the summary and per-employee bonuses; payout total + residual equals the payout pool to the grosz
- Entering 80/90/85/60 on a milestone that reproduces the worked example shows M 1,1875, payout pool 11 875,00 zł, bonuses 5 126,56 / 4 511,38 / 2 237,04 zł, residual 0,02 zł
- Changing only Ryzyko from 60 to 90 increases M and every bonus
- An unscored milestone shows shares but no PLN amounts; a scored milestone with no assignments shows total 0 and residual = payout pool
- Editing an assignment after scoring changes the bonuses on reload (live Draft)
- An Admin sees the figures read-only; a cancelled milestone shows read-only scores; a closed project shows the reopen notice
- Kitchen sink shows every listed state; default, hover, focus-visible, disabled (pending submit), error, empty and loading look correct; usable at phone width
- The page loads within 2 seconds for the seed milestone (NFR)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- There is no unit-test framework. Formula correctness is proven in pgTAP (`supabase/tests/milestone_payouts.test.sql`), where the computation lives.
- Key edge cases: recurring-decimal split (exact floor), M at both bounds, M > 1, Ryzyko direction, unscored, empty milestone, partial or out-of-range scores, cancelled milestone, closed project.

### Integration Tests:

- RLS matrix in pgTAP: owner Supervisor, other Supervisor, Admin, Employee against the update and both functions.
- `npm run smoke` guards the auth flow after the page changes.

### Manual Testing Steps:

1. `npx supabase db reset`, sign in as the seed Supervisor and open milestone `…0021`: figures present, total + residual = pool.
2. Score a fresh milestone with the worked-example engagements at 80/90/85/60 and compare against the Key Discoveries figures.
3. Change scores to 0/0/0/0, then 100/100/100/100: the pool moves 7 000 → 13 000 and the bonuses move with it.
4. Try 101, blank and 2.5: catalog errors on the KPI card.
5. Sign in as an Admin: read-only. Cancel the milestone as the Supervisor: scores read-only.
6. Check the page and kitchen sink at phone width.

## Performance Considerations

Two RPCs per page load over one milestone's engagements (a typical team), well inside the 2-second NFR. No caching needed.

## Migration Notes

Additive: four nullable columns, one check, one trigger and three functions. Existing milestones start unscored. Rollback is a down migration that drops these objects; no data is transformed.

## References

- Roadmap item: `context/foundation/roadmap.md` (S-04)
- PRD: `context/foundation/prd.md:95-98,133-149`
- Spreadsheet formula: `docs/Model Premiowania/Model_premiowania.xlsx` (`Milestones!M`, `Wyniki!O`); instruction doc `docs/Model Premiowania/Instrukcja_model_premiowania.docx` (Ryzyko scale)
- Config schema: `supabase/migrations/20260926120000_bonus_rules_config.sql:39-76`
- Rounding rule: `supabase/migrations/20260927120000_projects_and_milestones.sql:204-218`
- Engagement pattern: `src/lib/services/engagements.ts`, `src/pages/api/projects/[id]/milestones/[milestoneId].ts`
- Token migration pattern: `context/archive/2026-10-01-ui-projects-panel/plan.md`
- pgTAP isolation model: `supabase/tests/projects_rls.test.sql:1-12`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema, computation and pgTAP

#### Automated

- [x] 1.1 Migration and seed apply cleanly: `npx supabase db reset` — 40655e9
- [x] 1.2 pgTAP suites pass, including the new one: `npx supabase test db` — 40655e9
- [x] 1.3 Type check passes: `npx astro sync && npx astro check` — 40655e9
- [x] 1.4 Lint passes: `npm run lint` — 40655e9

#### Manual

- [x] 1.5 Studio check of `milestone_payout_summary` for scored `…0021` and unscored `…0022` — 40655e9
- [x] 1.6 Migration header documents formula, Ryzyko direction and the S-05 snapshot obligation — 40655e9

### Phase 2: Service and API

#### Automated

- [x] 2.1 Type check passes: `npx astro check` — cb49fc8
- [x] 2.2 Lint passes: `npm run lint` — cb49fc8
- [x] 2.3 Build passes: `npm run build` — cb49fc8
- [x] 2.4 Smoke test passes: `npm run smoke` — cb49fc8

#### Manual

- [x] 2.5 Valid scores save and redirect with `saved=kpi` — cb49fc8
- [x] 2.6 Invalid input redirects with the matching catalog code and field — cb49fc8
- [x] 2.7 Admin gets `admin_read_only`; cancelled milestone gets `milestone_cancelled` — cb49fc8

### Phase 3: Milestone page onto tokens

#### Automated

- [x] 3.1 UI literal check passes with the two new paths: `npm run lint:ui`
- [x] 3.2 Lint passes: `npm run lint`
- [x] 3.3 Type check passes: `npx astro check`
- [x] 3.4 Build passes: `npm run build`

#### Manual

- [x] 3.5 Page consistent with project detail on desktop and phone width, no horizontal scroll
- [x] 3.6 Assign, edit, delete and all error placements and notices behave as before
- [x] 3.7 Focus-visible rings show on links, buttons and controls

### Phase 4: KPI and bonus sections

#### Automated

- [ ] 4.1 UI literal check passes including the new components: `npm run lint:ui`
- [ ] 4.2 Lint passes: `npm run lint`
- [ ] 4.3 Type check passes: `npx astro check`
- [ ] 4.4 Build passes: `npm run build`
- [ ] 4.5 Smoke test passes: `npm run smoke`
- [ ] 4.6 pgTAP still passes: `npx supabase test db`

#### Manual

- [ ] 4.7 Seed milestone shows summary and bonuses; total + residual = pool
- [ ] 4.8 Worked example reproduces M 1,1875, pool 11 875,00 zł, bonuses 5 126,56 / 4 511,38 / 2 237,04 zł, residual 0,02 zł
- [ ] 4.9 Raising only Ryzyko increases M and every bonus
- [ ] 4.10 Unscored shows shares without PLN; scored with no assignments shows total 0 and residual = pool
- [ ] 4.11 Editing an assignment after scoring changes bonuses on reload
- [ ] 4.12 Admin read-only, cancelled milestone read-only, closed project notice
- [ ] 4.13 Kitchen sink shows every listed state across the 7-state matrix, usable at phone width
- [ ] 4.14 Page loads within 2 seconds for the seed milestone
