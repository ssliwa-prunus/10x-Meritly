# Review fixes — follow-ups

From `reviews/impl-review.md` triage (2026-09-30).

- [ ] F1 follow-up: guard reopening a completed/cancelled milestone (status back to open) when it has an engagement whose employee is no longer owned by the project's Supervisor. MR012 covers only project owner changes; the pgTAP fixture's EX setup (employees_rls.test.sql, the milestone 0424 close/move/reopen) relies on this gap and would need adjusting.
- [x] F1 verify: `npx supabase db reset && npx supabase test db` — 222 tests pass.
