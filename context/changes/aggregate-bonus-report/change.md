---
change_id: aggregate-bonus-report
title: Aggregate bonus report
status: impl_reviewed
created: 2026-10-15
updated: 2026-10-15
archived_at: null
---

## Notes

Roadmap slice S-07 (PRD FR-015).

### Implementation notes (deviations from plan.md)

- **Employees get no rows from `bonus_report`** (plan Phase 1: "E2 → only own row"). The approved filter joins `milestone_results` and `milestones`, on which employees have no select policy, so the invoker function returns nothing to them. Stricter than planned; the page and CSV are Supervisor/Admin only anyway. Pinned by the E2 `rls_matrix` cell.
- **CSV filename labels each bound**: `meritly-bonus-report[-from-<date>][-to-<date>].csv` (plan: `[-from][-to]`), so a from-only and a to-only export never share a name.
- **e2e empty state uses a future start date** (plan: "a range ending yesterday"). Approvals are stamped `now()` and e2e/seed runs leave approvals on earlier days, so only a range in the future is guaranteed empty.
- **`.gitignore` `reports/` → `/reports/`** (not in plan). The unanchored rule, meant for Stryker's `reports/mutation`, also ignored `src/pages/reports/` and `src/pages/api/reports/`.
- **Truncation guard** (impl-review F1): `getBonusReport` requests `count: "exact"` and fails with a logged `load_failed` when PostgREST's `max_rows` cap cut the result short.
