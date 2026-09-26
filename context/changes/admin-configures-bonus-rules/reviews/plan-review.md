<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Admin Configures Bonus Rules

- **Plan**: context/changes/admin-configures-bonus-rules/plan.md
- **Mode**: Deep
- **Date**: 2026-09-26
- **Verdict**: SOUND
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

## Grounding

Grounding: 6/6 existing paths ✓ (the 4 new directories are correctly absent), 4/4 symbols ✓, brief↔plan ✓, Progress↔Phase ✓ (14/14 rows).

A verification agent confirmed:

- The current guard does not cover `/api/admin`.
- Astro's `checkOrigin` is on by default, so same-origin form POSTs are safe.
- A trigger function with EXECUTE revoked still fires.
- The anon revoke matches F-01.
- `[id].ts` and `[id]/archive.ts` can coexist.
- `numeric` columns come back as JSON numbers.
- The existing structural pgTAP guards pass with the new tables.
- The blast radius is minimal.

## Findings

### F1 — Audit trigger skips inserts

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Migration (set_config_audit_fields)
- **Detail**: The trigger was `before update` only. A role created by an admin had `updated_by = null` until its first edit.
- **Fix**: Attach the trigger to `job_roles` as `before insert or update`, and add a pgTAP assertion that an admin insert sets `updated_by`.
- **Decision**: FIXED

### F2 — Role name uniqueness can be bypassed with whitespace

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Migration (job_roles.name)
- **Detail**: Nothing required the stored name to be trimmed. A direct PostgREST write could store "Senior " next to "Senior", defeating the `lower(name)` unique index.
- **Fix**: Add `check (name = btrim(name))` and a pgTAP assertion that rejects `'Senior '`.
- **Decision**: FIXED

### F3 — Employee write expectations in pgTAP are vague

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — pgTAP suite
- **Detail**: "No effect or raise" was ambiguous. Under RLS an insert raises 42501, while an update or delete silently affects 0 rows.
- **Fix**: Specify `throws_ok 42501` for insert and `is_empty(... returning id)` for update and delete.
- **Decision**: FIXED

### F4 — A validation error wipes the admin's input

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — API routes / settings page
- **Detail**: After a rejected save, the error redirect re-renders the forms from stored values, so the admin retypes their change.
- **Fix**: Record this as an accepted MVP limitation in "What We're NOT Doing" (plan and brief).
- **Decision**: FIXED
