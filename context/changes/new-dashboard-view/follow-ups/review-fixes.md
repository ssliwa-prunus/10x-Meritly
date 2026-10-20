# Review follow-ups: new-dashboard-view

Source: `reviews/impl-review.md` (2026-10-20).

## F2 — Bound the dashboard's milestone read and batch the payout summaries

- **Where**: `src/lib/services/dashboard.ts` (`listVisibleMilestones`, `listPayoutSummaries`)
- **Problem**: `listVisibleMilestones` reads every visible milestone with no filter or limit (an Admin gets all of them, ever), and `listPayoutSummaries` then calls `milestone_payout_summary` once per scored, unapproved milestone in an open project, all in parallel. The table shows at most 8 rows.
- **Decided fix (Fix A)**: in a new change, add a set-returning `security invoker` RPC such as `get_payout_summaries(p_milestone_ids uuid[])`, and filter the milestone read in SQL to live milestones plus this Warsaw year's approvals.
- **Constraints**: a new migration must update `supabase/tests/rls_catalog_guard.test.sql` and `supabase/tests/rls_matrix.test.sql` (CLAUDE.md, test-plan §6.1). Keep the `failed` count contract that F1 added.
- **Start with**: `/10x-new dashboard-summaries-batch`
