---
change_id: testing-route-gating-notification
title: Test rollout Phase 3 — route gating, approval notification and HTTP IDOR
status: impl_reviewed
created: 2026-10-10
updated: 2026-10-10
archived_at: null
---

## Notes

Open a change folder for rollout Phase 3 of context/foundation/test-plan.md: "Route gating & approval notification".
Risks covered: #5 (approval email reaches the wrong person, is sent for a Draft milestone, is sent repeatedly incl. re-send flooding, or approval reports success while the notification is silently lost), #6 (a new page or API route escapes role gating, or the sign-in return target becomes an open redirect). Test types planned: Vitest (already configured in Phase 2 — extend it, no fresh bootstrap) + integration + smoke extension + HTTP IDOR check (moved from Phase 1).
Risk response intent:

- #5: prove only Approved milestones notify, each recipient gets only their own amount, a repeated send is a no-op, and a delivery failure is visible rather than reported as success — integration against local Mailpit; do not mock the mailer so heavily that recipient↔amount pairing is never checked.
- #6: prove a role × route matrix (anonymous, employee, supervisor, admin) yields the expected redirect / 403 / 503 and that `next` rejects off-site targets — and that a newly added, unlisted route is caught by a rule, not by enumerating today's routes.
- HTTP IDOR (from #1): Employee B gets 403 or a not-found page for Employee A's results and for Draft milestones when changing IDs in URLs.
  After creating the folder, follow the downstream continuation rule.
