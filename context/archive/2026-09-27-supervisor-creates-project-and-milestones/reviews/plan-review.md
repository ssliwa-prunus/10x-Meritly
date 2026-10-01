<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Supervisor Creates Project and Milestones

- **Plan**: context/changes/supervisor-creates-project-and-milestones/plan.md
- **Mode**: Deep
- **Date**: 2026-09-27
- **Verdict**: SOUND
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

## Grounding

- **Paths**: 10/10 ✓.
- **Symbols**: 5/5 ✓ (parseForm/firstIssueError with their 5 importers, set_config_audit_fields, ADMIN_ROUTES, the structural pgTAP guards).
- **Progress↔Phase**: 23/23 ✓.
- **Brief↔plan**: ✓ except F2.
- **Deep check**:
  - No existing pgTAP assertion breaks, provided the new tables enable RLS and the view uses `security_invoker = true`.
  - The existing tests' role updates don't hit the new role-change trigger.
  - Astro 7.3.2 middleware also runs for unmatched routes.

## Findings

### F1 — Cross-table triggers can be raced by concurrent writes

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Migration, Triggers
- **Detail**:
  - Three guarantees rely on a trigger on one table reading another table:
    - `milestones_check_parent`;
    - `projects_check_period`;
    - the pair `projects_check_owner` / `profiles_block_owner_role_change`.
  - Postgres runs each transaction at READ COMMITTED by default, so two concurrent transactions can each pass their check before either commits. Example: a milestone insert racing a project date shrink. The foreign key's FOR KEY SHARE lock does not conflict with a non-key update of the project row.
- **Fix**: `milestones_check_parent` reads the parent project `FOR SHARE`, and `projects_check_owner` reads the owner profile `FOR SHARE`. Add a comment explaining why. pgTAP cannot test concurrency; note it as covered by design.
- **Decision**: SKIPPED

### F2 — Brief's CI risk misstates the branches

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: plan-brief.md — Open Risks & Assumptions
- **Detail**: `master` exists and is the remote default (`10x-Meritly/HEAD → master`). CI runs on push/PR to master, so it runs on the develop→master PR but not on develop pushes. The brief says the repo works on "develop / main".
- **Fix**: Reword the risk so it names master and tells the implementer to rely on local `npx supabase test db` plus the develop→master PR.
- **Decision**: SKIPPED

### F3 — "Down-migration" isn't a Supabase concept

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Migration Notes
- **Detail**: Supabase CLI migrations are forward-only.
- **Fix**: Before deploy, edit the migration and run `npx supabase db reset`. After deploy, add a new forward migration that drops the objects in reverse order.
- **Decision**: FIXED (Migration Notes rollback sentence replaced)
