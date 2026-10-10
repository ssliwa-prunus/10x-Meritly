# Route Gating & Approval Notification Tests — Plan Brief

> Full plan: `context/changes/testing-route-gating-notification/plan.md`
> Research: `context/changes/testing-route-gating-notification/research.md`

## What & Why

Rollout Phase 3 of the test plan protects against three failures:

- **#6:** a new page or API route escapes role gating, or sign-in's `next` becomes an open redirect.
- **#5:** an approval email goes to the wrong person, goes out for a Draft, is sent twice, or is lost while the app reports success.
- **#1 at the HTTP layer:** an employee reaches another employee's or Draft figures by URL.

## Starting Point

- **Gating:** the middleware is the only role check in the app. It matches path prefixes, lets unlisted paths through, and can't be unit-tested.
- **`next`:** the check is sound but untested.
- **Smoke:** CI's smoke test only covers sign-in.
- **Approval email:** the notifier is well designed. One path is wrong: when another call still holds the send, it returns "sent 0, failed 0" and the app shows plain success. Nothing tests the notifier.
- **IDOR:** no URL an employee can reach takes a data ID.

## Desired End State

- **Unit tests:** the role × route matrix, a rule that fails on any unclassified file in `src/pages`, and the `next` table.
- **CI smoke:** checks the role cells, encoded, double-slash and uppercase paths, an off-site `next`, and employee B's isolation from A's and Draft data, using seeded accounts.
- **Email:** a held send shows a "still being sent" notice. A local integration suite proves the email guarantees against Mailpit with hand-computed amounts.
- **Test plan:** the cookbook now covers new routes and email side effects.

## Key Decisions Made

| Decision                 | Choice                                                                                        | Why (1 sentence)                                                                                                  | Source   |
| ------------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------- |
| Catching unlisted routes | Extract a pure `decideAccess` and add a filesystem classification rule; keep allow-by-default | Catches the omission by rule, with no behaviour change for users                                                  | Plan     |
| Notifier gaps            | Fix the held-claim false success (`pending`); pin the stamp-failure duplicate                 | Closes "reports success while lost" with a small change; the duplicate is rare and was already accepted (S-05 F2) | Plan     |
| IDOR fixture             | Extend `seed.sql` (second linked employee, Approved and Draft milestones)                     | No service-role key in CI, no new dependency; works with a fresh `supabase start`                                 | Plan     |
| Mail suite shape         | Separate `vitest.integration.config.ts`, `tests/integration/`, `npm run test:integration`     | Keeps `npm test` and Stryker hermetic; reuses Vitest                                                              | Plan     |
| CI wiring                | None here; deferred to rollout Phase 4                                                        | Phase 4 owns the gates; smoke is already in CI, so its new cells are enforced now                                 | Plan     |
| HTTP IDOR shape          | 403 on ID-bearing URLs plus `/my-bonuses` content checks, not "foreign ID gives 404"          | No employee-reachable URL takes a data ID                                                                         | Research |
| Amount oracle            | KPI 100 ×4 makes the pool equal the target; equal role and rating split by time share         | Hand-computable and independent of the config                                                                     | Plan     |

## Scope

**In scope:**

- `src/lib/route-access.ts` and the middleware refactor
- Three unit test files and a unit test for the approvals mapping
- Seed additions and the smoke extension
- The notifier `pending` field and the `email_pending` notice
- The integration config and suite
- The test-plan and CLAUDE.md backport

**Out of scope:**

- Deny-by-default routing and segment-boundary matching
- A fix for the stamp-failure duplicate
- Re-send rate limiting and the editable email of a never-invited employee
- CI YAML changes
- An automated provider-down test
- e2e and visual tests

## Architecture / Approach

- `decideAccess` holds the route classification and the decision. The middleware maps its result to a redirect, 403 or 503, and keeps only the invite-session check.
- The tests take expected values from the role rules in CLAUDE.md and the PRD, the hand-computed bonuses and the Mailpit inbox, never from the code under test.
- The integration fixtures run as the seeded supervisor under RLS. The service-role key is used only to plant a held claim.

## Phases at a Glance

| Phase                           | What it delivers                                                                                 | Key risk                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 1. Gate extraction + unit rules | Pure `decideAccess`, matrix test, unclassified-route rule, `safeNext` table                      | Refactor drifts from current behaviour (guarded by the existing smoke)                                |
| 2. Seed + smoke extension       | Seeded employee2 and Approved/Draft milestones; role, normalisation, `next` and IDOR cells in CI | Seed approval under JWT claims; seed must load in CI's fresh start                                    |
| 3. Pending fix + Mailpit suite  | `pending` in function and app, `emailNotice`, seven integration cases                            | Edge runtime and Mailpit setup are local only; the pl-PL currency format needs whitespace normalising |
| 4. Backport + cookbook          | §2, §3, §4, §5 and §8 corrected; §6.3, §6.4 and §6.6 written; CLAUDE.md command                  | —                                                                                                     |

**Prerequisites:**

- Docker with `npx supabase start`.
- For Phase 3: `supabase/functions/.env` set for Mailpit and `npx supabase functions serve`.

**Estimated effort:** about 3–4 sessions across 4 phases.

## Open Risks & Assumptions

- KPI weights sum to 1, so KPI 100 ×4 gives the maximum multiplier. The implementer confirms this from the PRD and `bonus_settings` before relying on it.
- `/ADMIN` is expected to return 404 under Astro 7.3.2. The smoke test pins whatever status is observed.
- The CI smoke job's fresh `supabase start` loads `seed.sql`. Item 2.6 verifies this.
- The Vitest gates stay local and pre-merge until rollout Phase 4 wires CI.

## Success Criteria (Summary)

- A route added under `src/pages` without a classification fails `npm test` by name.
- CI fails if any role reaches a route outside its scope, if `next` leaves the site, or if employee B sees A's or Draft figures.
- Locally, each recipient gets only their own amount, exactly once. Draft, wrong-role and foreign-owner calls send nothing. A held send is reported, not hidden.
