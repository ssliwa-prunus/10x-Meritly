---
change_id: testing-e2e-gates-wiring
title: Test rollout Phase 4 — wire the US-01 e2e into CI and run pgTAP on SQL edits
status: impl_reviewed
created: 2026-10-11
updated: 2026-10-11
archived_at: null
---

## Notes

Open a change folder for rollout Phase 4 of context/foundation/test-plan.md: "US-01 e2e & gates wiring".
Risks covered: cross-cutting (#1/#2 data isolation via the browser path, #5/#6 approval → employee view). Test types planned: e2e + gates + post-edit hook.
Risk response intent: prove that after a Supervisor approves a milestone, the employee sees only their own result and never another employee's figures or Draft results, and that this check blocks a PR in CI; prove that an agent editing a migration gets RLS regressions (pgTAP rls_matrix / rls_catalog_guard) reported at edit time, not first in CI.
Already shipped outside the chain (do not redo): Playwright setup (f009749, context/foundation/test-stack.md), US-01 spec tests/e2e/*approved-bonus-visible-only-to-its-employee.spec.ts (5f2e335), agent quality-gate hooks (00b4e2f: ESLint, lint:ui, unit tests, astro check; supabase/ SQL not covered).
Remaining scope: (1) run the Playwright suite as a required check in .github/workflows/pr.yml (local Supabase, build + preview, credentials without secrets) and add it to branch protection; (2) extend the .claude/hooks gates so that migration/SQL edits run `supabase test db` (or a scoped pgTAP subset) when local Supabase is reachable, with proof in scripts/**tests**/agent-hooks.test.ts; (3) update test-plan §5/§6.
After creating the folder, follow the downstream continuation rule
