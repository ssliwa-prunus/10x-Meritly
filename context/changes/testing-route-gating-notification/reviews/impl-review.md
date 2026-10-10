<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Route Gating & Approval Notification Tests (rollout Phase 3)

- **Plan**: context/changes/testing-route-gating-notification/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-10
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Notes:

- **Accepted deviations (not findings).** The user accepted these during implementation:
  - `//admin` is pinned at 200, with `bodyExcludes` on the admin text;
  - integration case 5 ages the claim with the service role;
  - each test uses its own fixture addresses;
  - the §4 Vitest row is split into two rows;
  - the Lesson-2 section of `CLAUDE.md` and the `.claude/skills` changes are committed alongside.
- **What We're NOT Doing:** all boundaries were respected. There is no CI YAML change, no deny-by-default gate, prefix matching is unchanged, and there is no fix for the stamp-failure duplicate.
- **Middleware:** behaviour is unchanged compared with `5ca85b1`, in both order and outcomes.
- **Service-role key:** it appears only in the Edge Function and in the integration test's `plantClaim`.
- **Success criteria re-run on 2026-10-10:**
  - `npm test` passes 184 tests.
  - `astro check` reports 0 errors, and `lint` is clean.
  - `prettier --check` is clean on both docs, and no placeholders remain (count 0).
  - `supabase test db` passes 660 tests.
  - `test:integration` passes 7 of 7.
  - Smoke passed 32 of 32 in CI on PR #15 (run 38055545981).
  - The Stryker runs were not repeated; the results recorded during implementation stand.

## Findings

### F1 — §6.6 still says the CI smoke job is unconfirmed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md:207
- **Detail**: The §6.6 Phase 3 note ends with "Still open: the CI `smoke` job has not yet been confirmed green with the seeded fixture." Since then, CI run 38055545981 on PR #15 passed every seeded smoke step, and Progress 2.6 is checked. The test plan now contradicts the plan's Progress section.
- **Fix**: Replace the sentence with "The CI `smoke` job passed with the seeded fixture on PR #15 (run 38055545981)."
- **Decision**: FIXED — the §6.6 sentence now records the green CI smoke run on PR #15 (run 38055545981).

### F2 — The stale-claim plant has only a one-minute margin over the timeout

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/integration/notify-milestone-approved.integration.test.ts:351, :383
- **Detail**: Cases 5 and 7 plant `notify_claimed_at = Date.now() − 11 min` using the clock of the machine running the tests. The function judges staleness against `CLAIM_TIMEOUT_MS = 10 min` (`index.ts:40`) using the clock of the edge-runtime container. Docker/WSL2 clocks on Windows often drift by more than a minute after the machine sleeps. When that happens, the second half of case 7 sees the claim as still held and returns `pending: 2` instead of `sent: 2`, which is a flaky failure. Case 5's ageing would also no longer exercise the takeover path.
- **Fix**: Plant a claim far past the timeout, such as `Date.now() − 24 h`, in both places, and keep the comment explaining why.
- **Decision**: FIXED — both plants use STALE_CLAIM_AGE_MS (24 h), with a comment explaining the clock skew; the integration suite passes 7/7.

### F3 — Smoke `bodyExcludes` lacks a positive control, against its own cookbook rule

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: scripts/smoke.mjs:195, :204
- **Detail**:
  - The two IDOR checks for employee2 on `/my-bonuses` assert that `600,00 zł` and `Draft Milestone` are absent. No cell shows that these strings would ever appear in that format; for example, `employee@meritly.local` should see `600,00 zł`.
  - The §6.3 cookbook says to pair every exclude with a cell where the text is present. Without that pairing, a change in formatting would leave the exclude passing without testing anything.
  - The `bodyIncludes` on the same response limits the risk.
  - The 403 cells named "IDOR" are actually answered by the role gate. Only the `/my-bonuses` cells exercise RLS.
- **Fix**: Add a cell where `employee@meritly.local` gets `/my-bonuses` and its body includes `600,00 zł`. This needs one more sign-in, which the rate limit allows.
- **Decision**: FIXED (variant) — the existing `employee 200 on /my-bonuses` cell now includes `600,00 zł` and `Approved Milestone`, and a new supervisor cell shows `Draft Milestone` on project …0012; no extra sign-in. Smoke passes 33/33.

### F4 — The error-code table in the approvals test repeats `NOTIFY_ERROR_CODES`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/**tests**/approvals.test.ts:94-105
- **Detail**: The table copies the existing code mapping row by row, including `forbidden` → `not_found`. No PRD or plan source backs those rows, so a wrong mapping copied into both places would pass. It is a mild mirror test. The plan only required `send_failed` and an unknown code or network error to map to `notify_failed`.
- **Fix**: Keep only the rows the plan or PRD requires, or add a comment citing the source of each mapping, such as `forbidden` → `not_found` so ownership does not leak.
- **Decision**: FIXED — the rows are annotated with their oracle: the function contract from the archived S-05 plan and the payouts.ts rule that permission failures read as not_found.

### F5 — The classification rule ignores `.js`, `.mjs` and `.html` page files

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/**tests**/route-classification.test.ts:20
- **Detail**: `ROUTE_FILE` matches `astro|ts|md|mdx`, which covers every file in `src/pages` today. Astro also routes `.js`, `.mjs` and `.html` files, so an endpoint added in one of those formats would get past the unclassified-route safeguard without anyone noticing.
- **Fix**: Widen the pattern to `astro|ts|js|mjs|md|mdx|html`.
- **Decision**: FIXED — ROUTE_FILE now matches astro|ts|js|mjs|md|mdx|html; a scratch src/pages/reports.js fails the rule by name (removed afterwards).

### F6 — `PUBLIC_ROUTES` reads like an allowlist the gate enforces

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/lib/route-access.ts:11
- **Detail**: `PUBLIC_ROUTES` and `ANY_SIGNED_IN_ROUTES` are read only by `route-classification.test.ts`. `decideAccess` still allows any path it doesn't list, which is the design the plan chose. A reader could take the list as a deny-by-default gate.
- **Fix**: Add a one-line comment saying the classification test enforces these lists and `decideAccess` allows unlisted paths.
- **Decision**: FIXED — the route-access.ts header now says the classification test enforces these lists and decideAccess allows unlisted paths.

### F7 — Integration fixtures pile up in the local database

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/integration/notify-milestone-approved.integration.test.ts:153-231
- **Detail**: Each run adds 7 projects and 14 employees under the seeded supervisor, 6 of them on frozen Approved milestones. They clutter the supervisor's `/projects` and `/employees` views. `CLAUDE.md` already documents that `npx supabase db reset --local` clears them. Test isolation is not affected.
- **Fix**: Accept as documented, or add an `afterAll` cleanup through the service client limited to the fixture project ids.
- **Decision**: ACCEPTED — documented in CLAUDE.md: `npx supabase db reset --local` clears the leftover fixtures, and test isolation is not affected.
