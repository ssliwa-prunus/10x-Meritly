<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Supervisor Creates Project and Milestones

- **Plan**: context/changes/supervisor-creates-project-and-milestones/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-09-27
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Success criteria evidence

- `npx astro sync && npx astro check`: 0 errors.
- `npm run lint`: exit 0.
- `npm run build`: exit 0. A first run failed with EBUSY on `dist/` because the preview server was still running; it passed after the preview was stopped.
- `npx supabase test db`: PASS, 3 files, 145 tests.
- `npm run smoke`: all steps passed against the preview. The preview reads `.dev.vars`, which points at local Supabase.
- Manual: 23/23 Progress rows checked, each confirmed by the user at its phase's manual gate.

## Notes

- Commit 32ad3a3 also carries workspace changes that existed before this change began (`.claude/skills`, `CLAUDE.md`, `prd.md`, `roadmap.md`). They were staged at the user's explicit request, so this is not a scope finding.
- The 23503 candidate was dismissed: RLS returns 42501, which maps to `not_found`, before the FK check can run for API users.

## Findings

### F1 — Guard trigger leaks a foreign project's status and period

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260927120000_projects_and_milestones.sql:167-207 (message at :195)
- **Detail**:
  - `milestones_check_parent` is security definer and runs before the RLS WITH CHECK on insert. For a project the caller can't see, it still raises MR003 (project closed) or MR002 (outside period). MR002's message includes both project dates.
  - An ex-owner who kept the UUID after a reassignment, or any authenticated user calling the API directly, can learn another project's status and exact period. That includes employees, because `authenticated` keeps INSERT on `milestones` and the middleware doesn't cover direct API calls.
  - No money figures leak. The pgTAP foreign-insert case uses dates inside B's period on an active project, so it can't catch this.
- **Fix A ⭐ Recommended**: Early ownership check in the trigger. At the top of `milestones_check_parent`, add `if auth.uid() is not null and not public.owns_project(new.project_id) then raise exception using errcode = '42501'`. Add pgTAP cases for a foreign insert with out-of-period dates, a foreign insert into a closed project, and an employee insert, all expecting `42501`.
  - Strength: A one-line change in a new forward migration (`create or replace function`), and seed/Studio inserts (no JWT) keep full guards.
  - Tradeoff: Duplicates the RLS predicate inside the trigger, so it must stay in sync with the policy.
  - Confidence: HIGH — the same helper is already used by the milestone policies.
  - Blind spot: None significant.
- **Fix B**: Move the MR002/MR003 checks to an AFTER ROW trigger, which runs after the RLS check.
  - Strength: No duplicated predicate; RLS denies first by construction.
  - Tradeoff: Splits the logic across two triggers. The `for share` lock and the MR006 check would need re-homing, and the error then comes after the row is written (rolled back).
  - Confidence: MED — ordering semantics hold, but the refactor is larger.
  - Blind spot: Interaction with the audit trigger ordering has not been re-verified.
- **Decision**: FIXED (Fix A) — new migration 20260927130000_milestones_guard_ownership.sql + 3 pgTAP cases (plan 75); break-check: removing the check fails tests 14, 15, 48

### F2 — Shared form classes live under the admin folder

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/projects/ProjectForm.astro:2, src/components/projects/MilestoneForm.astro:2
- **Detail**: The Supervisor-facing project forms import `buttonClass`/`inputClass` from `@/components/admin/form-classes`, whose comment scopes it to the admin settings forms.
- **Fix**: Move `form-classes.ts` to `src/components/form-classes.ts` (neutral location), update its comment, and update its four importers.
- **Decision**: FIXED — moved to src/components/form-classes.ts; 5 importers updated

### F3 — Minor plan drift in component props and list flash

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/projects/MilestoneForm.astro:6-11, src/pages/projects/index.astro:158, src/lib/services/projects.ts:189-203
- **Detail**:
  - The plan said the form components take `saved`/`error` props. `MilestoneForm` takes only `error`, and the "saved" line is rendered by `[id].astro`.
  - The list page never shows a saved flash, because a create redirects to the detail page.
  - The redirect helpers gained optional `section`/`milestone` params.
  - Behaviour is equivalent or better; this is documentation drift only.
- **Fix**: Add a short "Implementation notes" line to plan.md recording these adaptations. No code change.
- **Decision**: FIXED — Implementation Notes section added to plan.md

### F4 — Per-row `owns_project()` in milestone policies

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260927120000_projects_and_milestones.sql:337, 349, 355-356
- **Detail**: Each milestone row evaluates `owns_project(project_id)`, a project lookup plus a role lookup, which can't be cached per statement like `(select auth.uid())`. This is fine at MVP scale (tens of milestones) and is the first place to look if milestone lists or the exposure view slow down.
- **Fix**: None now. If needed later, rewrite as `project_id in (select id from public.projects where supervisor_id = (select auth.uid()))`, relying on the projects RLS.
- **Decision**: ACCEPTED — no change at MVP scale; revisit if milestone lists slow down

### F5 — Deleting an auth user who owns projects fails with a raw FK error

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260927120000_projects_and_milestones.sql:44
- **Detail**: `supervisor_id … on delete restrict`, combined with `profiles.id … on delete cascade` from `auth.users`, blocks deleting such a user with a generic FK violation. This is intended (reassign first), but only the role-change path (MR005) documents it.
- **Fix**: Add one sentence to the migration's role-block comment and to contract-surfaces.md: "Deleting a user who owns projects fails (FK restrict); reassign their projects first."
- **Decision**: FIXED — note in migration role-block comment and contract-surfaces.md
