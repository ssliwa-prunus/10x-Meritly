# Route Gating & Approval Notification Tests (rollout Phase 3) Implementation Plan

## Overview

Rollout Phase 3 of `context/foundation/test-plan.md` covers risks #5 (approval email), #6 (route gating / open redirect) and the HTTP layer of #1 (IDOR). The plan:

- extracts the middleware's access decision into a pure module, so it can be unit-tested, and adds a filesystem rule that fails on any unclassified route;
- extends the CI smoke test with role × route and IDOR cells using seeded accounts;
- fixes the one path where the approval email reports success while nothing was sent, and proves the email guarantees against local Mailpit;
- backports the findings into the test plan and its cookbook.

## Current State Analysis

From `context/changes/testing-route-gating-notification/research.md`:

- **Gating** (`src/middleware.ts:8-106`):
  - Matching is a raw `startsWith` prefix match, and a path in no list is allowed.
  - The decision is written inline in `onRequest`, and the middleware imports `astro:middleware`, so the plain `vitest.config.ts` cannot load it.
  - The middleware is the only app-layer role check: API handlers do not re-check the role.
  - No test enumerates routes.
- **`next`** (`src/lib/safe-next.ts`): the check is sound and applied everywhere `next` is used. It is pure, and nothing tests it.
- **Path normalisation**: Astro 7.3.2 decodes the path and collapses duplicate slashes before the middleware runs (`node_modules/astro/dist/core/fetch/fetch-state.js:212-216`). Case variants (`/ADMIN`) are unverified.
- **Smoke** (`scripts/smoke.mjs`): eight steps. It uses only a freshly signed-up, unlinked employee and matches `Location` by prefix. It runs in the CI `smoke` job against the production preview.
- **Seed** (`supabase/seed.sql`):
  - Accounts: admin `…0001`, supervisor `…0002`, employee `…0003` (linked to employee row `…0031`) and supervisor2 `…0004`.
  - There is no second linked employee and no approved milestone.
  - The seed is enabled (`supabase/config.toml:60-65`).
- **Notifier** (`supabase/functions/notify-milestone-approved/index.ts`):
  - **Authorization:** role and ownership are checked (`:232-251`), and Draft milestones get 409 (`:252`).
  - **Claim and stamp:** an atomic claim (`:266-284`) and a stamp after the provider confirms (`:325-344`).
  - **Recipient and amount:** one recipient and one line per email, paired by foreign key (`:108-146`, `:305-311`).
  - **Gap:** when nothing could be claimed but lines are still unsent (another call holds the claim, or it crashed), the function returns `200 {sent:0, failed:0}` (`:280-284`). The app then reports plain success (`approve.ts:57-63`, `notify.ts:46-47`).
  - **Accepted residual:** a line whose send succeeded but whose stamp failed is released and re-sent later (archived impl-review F2).
- **App caller** (`src/lib/services/approvals.ts`):
  - It maps function responses in `notifyMilestoneApproved` (`:290-345`) and holds the notices `email_partial` and `email_failed` (`:50-53`).
  - It imports no `astro:*` module, so it is unit-testable.
  - The notice logic is duplicated in `approve.ts:57-63` and `notify.ts:46`.
- **CI**:
  - It does not run `npm test`.
  - The smoke job starts Supabase without `mailpit` or `edge-runtime` (`.github/workflows/ci.yml:42`) and saves only `API_URL` and `ANON_KEY`.
- **IDOR (#1, HTTP)**:
  - No URL an employee can reach takes a data ID: every ID-bearing route is behind a 403, and `/my-bonuses` reads no parameters (`src/pages/my-bonuses.astro:15,23`).
  - Database-level IDOR is covered by `supabase/tests/rls_matrix.test.sql`.

## Desired End State

- **Unit tests (`npm test`):**
  - Every role × route-group cell, including the profile-error (503) and missing-profile cases, is asserted against an extracted pure function.
  - A new file under `src/pages` that is neither explicitly public nor given a role decision fails the suite by name.
  - `safeNext` has a table of accepted and rejected inputs.
- **Smoke (`npm run smoke`, already in CI):** signs in as seeded admin, supervisor and employee accounts and asserts:
  - exact redirects with `next`, 403s and 200s;
  - that encoded, double-slash and uppercase paths do not bypass the gate;
  - that an off-site `next` lands on `/`;
  - that employee B cannot reach employee A's or Draft data by URL.
- **Email:**
  - A notification blocked by a claim another call still holds is reported as `pending`, and the supervisor sees a notice, not plain success.
  - `npm run test:integration` (local, with Mailpit and `functions serve`) proves wrong-role, foreign-owner and Draft calls send nothing.
  - It proves each recipient gets only their own hand-computed amount, a repeat sends nothing, concurrent calls send once, and a held claim reports pending.
- **Test plan:** reflects the real Vitest setup, names the gates, and has cookbook entries §6.3 and §6.4.

### Key Discoveries:

- `src/middleware.ts:28`: `matchesRoute` is `startsWith`, and `:106` allows by default.
- `src/middleware.ts:100-104`: the set-password check needs a Supabase client (`isInviteSession`), so it stays in the middleware. The pure decision only classifies those routes.
- `supabase/functions/notify-milestone-approved/index.ts:280-284`: an empty claim returns `{0,0}` without telling "all sent" apart from "held elsewhere".
- **The notifier sends to `employees.email`**, which the supervisor controls. An integration fixture therefore needs no linked accounts and can be built as the seeded supervisor under RLS. Only the held-claim case needs a privileged write: `notify_claimed_at` is not updatable by `authenticated` (`supabase/tests/milestone_approval.test.sql:163-167`).
- **Oracle trick:** with all four KPI scores at 100, the KPI multiplier equals the maximum, so the payout pool equals the target pool. This assumes the KPI weights sum to 1; the implementer confirms that from the PRD and the `bonus_settings` constraint. With equal role and rating, the bonuses then split by time share alone, which can be computed by hand without depending on the config.
- **Amount format:** the function formats with `Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" })` (`index.ts:106`), which uses non-breaking spaces. Test assertions must normalise whitespace or use the same formatter for presentation only.
- `stryker.config.mjs:12` mutates `src/lib/**/*.ts`, so new `src/lib` modules are covered automatically.
- Mailpit read API (Context7 `/axllent/mailpit`, checked 2026-10-10):
  - `GET /api/v1/search?query=to:<addr>` returns `messages` and `messages_count`;
  - `GET /api/v1/message/{ID}` returns the message with its `Text` and `HTML`.

## What We're NOT Doing

- No deny-by-default routing and no change to how prefixes match. Behaviour for users stays the same; the filesystem rule is the safeguard (planning decision).
- No fix for the duplicate send when the email goes out but the stamp fails. It is pinned as known behaviour (archived impl-review F2) and documented in §6.4.
- No CI YAML changes. Vitest unit and the Mailpit integration suite become required gates in rollout Phase 4. The extended smoke is gated straight away because smoke already runs in CI.
- No automated provider-down test. The `send_failed` / `email_failed` path is covered by unit tests of the mapping and by a manual Mailpit-stopped check.
- No e2e or browser tests (rollout Phase 4), no visual checks (§7), no hooks.
- No re-testing of database IDOR already covered by `rls_matrix.test.sql`.
- No fix for the never-invited employee whose email can still be edited after approval (accepted in archived plan-review F5).
- No rate limit on re-send. Flooding is bounded by the claim and `notified_at`, and the integration suite proves that.

## Implementation Approach

The work goes cheapest layer first, and the order follows dependencies:

1. The pure gate module unlocks unit tests and the filesystem rule.
2. Seed data unlocks HTTP cells that CI can run with no new secrets.
3. The email fix and the integration suite are independent of the gating work and need the local edge runtime.
4. The test-plan backport comes last.

Expected values come from independent oracles:

- the role matrix decided in the PRD and CLAUDE.md, not read back from the middleware under test;
- hand-computed bonuses;
- the Mailpit inbox, not the function's own counters.

Each new suite gets a "prove it can fail" check, as in §6.1 and §6.2 of the test plan.

## Critical Implementation Details

- **Seed approval needs JWT claims.** `approve_milestone` checks ownership through `auth.uid()`. The seed must call it inside a block that sets `request.jwt.claims` (`set_config('request.jwt.claims', '{"sub":"…0002","role":"authenticated"}', true)`, with `role` switched as the RLS tests do), then reset. It must come after the KPI scores and engagements, because approval snapshots them.
- **Integration test files must live outside `src/`.** `vitest.config.ts` includes `src/**/*.test.ts`, and Stryker mutates `src/lib`. Putting integration tests in `tests/integration/` keeps `npm test` and Stryker free of network-dependent tests.
- **The smoke test must sign in sparingly.** The local auth rate limit is `sign_in_sign_ups = 30` per window (`supabase/config.toml:190`), so it signs in once per actor and reuses the cookie jar for that actor.

## Phase 1: Route gate extraction and unit rules (risk #6)

### Overview

Move the route lists and the access decision into a pure module, make the middleware use it with unchanged behaviour, and unit-test the role × route matrix, the unclassified-route rule and `safeNext`.

### Changes Required:

#### 1. Pure access module

**File**: `src/lib/route-access.ts` (new)

**Intent**: Single source of the route classification and of the decision that turns (pathname, session facts) into an outcome. The middleware and the tests both import it, so tests check the logic that actually runs.

**Contract**:

- Exports `PUBLIC_ROUTES`, an exact-path allowlist: `/`, `/auth/signin`, `/auth/signup`, `/auth/confirm-email`, `/auth/confirm`, `/api/auth/signin`, `/api/auth/signup`, `/api/auth/signout` and `/dev/projects-kitchen-sink`.
- Exports the existing `PROTECTED_ROUTES`, `ADMIN_ROUTES`, `PROJECT_ROUTES`, `EMPLOYEE_ROUTES` and `SET_PASSWORD_ROUTES`, with the same values and comments moved from the middleware.
- Exports a new `ANY_SIGNED_IN_ROUTES = ["/dashboard"]`, an explicit "any role" decision.
- Exports `matchesRoute` with unchanged `startsWith` semantics.
- Exports `decideAccess(pathname, { signedIn, role, profileError })`. It returns one of:
  - `{ kind: "allow" }`
  - `{ kind: "redirect", location }`
  - `{ kind: "forbidden" }` (403)
  - `{ kind: "unavailable" }` (503)

  The order and outcomes match `src/middleware.ts:63-98` exactly, including:
  - the `next` target on pages, built with `safeNext` and `encodeURIComponent`;
  - no `next` on `/api/*`.

  `decideAccess` receives the path and the search string separately, or the full path plus search, so `next` keeps the query.

- No `astro:*` imports.

#### 2. Middleware uses the module

**File**: `src/middleware.ts`

**Intent**: Replace the inline lists and checks with `decideAccess`, keeping the profile lookup, the `locals` assignment and the `isInviteSession` check (which needs a client) in place.

**Contract**:

- Maps `redirect` to `context.redirect`, `forbidden` to `new Response("Forbidden", { status: 403 })` and `unavailable` to `new Response("Service temporarily unavailable", { status: 503 })`.
- Runs the set-password check only when the decision is `allow`.
- Observable behaviour is unchanged; the existing smoke test must stay green.

#### 3. Role × route matrix unit test

**File**: `src/lib/__tests__/route-access.test.ts` (new)

**Intent**: Assert the decided matrix from research §6.2: anonymous, employee, supervisor and admin, plus profile error and missing profile, across one representative path per group.

**Contract**:

- Table-driven test. Expected outcomes are written from the role rules in CLAUDE.md and the PRD, not copied from the code.
- Includes boundary cases:
  - `/projectsX` and `/administrator` are gated (fails closed);
  - `/` and `/auth/signin` are allowed when signed out;
  - anonymous on a page redirects with exactly `/auth/signin?next=%2Fprojects%3Ftab%3Dx`;
  - anonymous on an API path redirects with exactly `/auth/signin`.
- Includes an unknown role string and `role: null`, both forbidden.

#### 4. Unclassified-route rule

**File**: `src/lib/__tests__/route-classification.test.ts` (new)

**Intent**: Catch a newly added page or endpoint that nobody classified. The rule is evaluated over the file system, not over a hand-written list of today's routes.

**Contract**:

- Walks `src/pages/**/*.{astro,ts,md,mdx}` with `node:fs`, from `process.cwd()`, and skips `_`-prefixed files and folders.
- Maps each file to a URL path: strip the extension and `index`, and replace `[param]` / `[...rest]` with a sample segment.
- Fails, naming the file, unless the path is either:
  - (a) an exact member of `PUBLIC_ROUTES`; or
  - (b) matched by `PROTECTED_ROUTES` and by exactly one role decision (`ADMIN_ROUTES`, `PROJECT_ROUTES`, `EMPLOYEE_ROUTES`, `ANY_SIGNED_IN_ROUTES` or `SET_PASSWORD_ROUTES`).
- Also asserts:
  - every role-list prefix is covered by `PROTECTED_ROUTES`;
  - every `PUBLIC_ROUTES` entry exists as a page, so the allowlist cannot rot.

#### 5. `safeNext` table

**File**: `src/lib/__tests__/safe-next.test.ts` (new)

**Intent**: Pin the open-redirect defence.

**Contract**:

- **Accepted:** `/projects`, `/projects?tab=x`, `/%2F%2Fevil.com` (stays same-origin).
- **Rejected (`null`):**
  - `//evil.com`, `/\evil.com`, `https://evil.com`, `javascript:alert(1)`, `/javascript:x`;
  - tab, CR and LF variants, a space, non-ASCII;
  - 513 characters;
  - `undefined`, a number, the empty string.
- The known false positive `/foo:bar` is pinned as rejected, with a comment saying it is intended.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type check and lint pass: `npx astro sync && npx astro check && npm run lint`
- Existing smoke still passes against a running dev or preview server: `npm run smoke`
- Scoped mutation run on the new module and `safeNext` leaves no surviving mutant in `decideAccess` branch logic: `npm run test:mutation -- --mutate src/lib/route-access.ts,src/lib/safe-next.ts`

#### Manual Verification:

- Prove the rule can fail: add a scratch `src/pages/reports.astro`. `route-classification.test.ts` fails, naming it. Delete the file.
- Prove the matrix can fail: temporarily drop `"/api/admin"` from `ADMIN_ROUTES`. The named matrix cells fail. Revert.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Seed fixture and smoke extension (risk #6 HTTP, risk #1 IDOR)

### Overview

Seed a second linked employee and a project with one Approved and one Draft milestone. Then extend the dependency-free smoke test with role × route cells, path-normalisation cells, `next` cells and IDOR cells, so CI enforces them straight away.

### Changes Required:

#### 1. Seed data

**File**: `supabase/seed.sql`

**Intent**: Give local development and CI a second linked, activated employee and an Approved milestone, so HTTP checks can use a real attacker and a real victim. No privileged key is needed in tests.

**Contract**:

- New auth user `employee2@meritly.local` (`…0005`, same password and pattern as `seed.sql:21-89`), with role `employee` from the signup trigger.
- New employee row `…0033` owned by supervisor `…0002`, linked to `…0005`, with `invited_at` and `activated_at` set.
- New project `…0012` "Approved Demo Project", owned by `…0002`, with:
  - milestone `…0023` (KPI 100/100/100/100, target 1000.00), with engagements for `…0031` at 0.60 and `…0033` at 0.40, same role and rating;
  - milestone `…0024` (Draft, scored), with an engagement for `…0033`.
- `…0023` is approved through `approve_milestone` under supervisor claims (see Critical Implementation Details).
- A header comment derives the expected bonuses by hand (600.00 and 400.00 PLN), including the reason the multiplier equals the maximum.
- Existing demo rows (`…0011`, `…0021`, `…0022`) are untouched.

#### 2. Smoke extension

**File**: `scripts/smoke.mjs`

**Intent**: Turn smoke into the HTTP gate for #6 and #1 while staying dependency-free.

**Contract**:

- **Mechanics:**
  - One cookie jar per actor.
  - Steps accept `exact` (full `Location` equality) and `bodyIncludes` / `bodyExcludes` (normalised text of a 200 response).
  - Existing steps keep working.
- **Role × route cells (seeded accounts):**
  - Anonymous `/projects?tab=x` gets exactly `/auth/signin?next=%2Fprojects%3Ftab%3Dx`; anonymous `/api/projects` gets exactly `/auth/signin`.
  - The employee gets 403 on `/projects`, `/employees` and `/admin`, plus POST `/api/admin/job-roles`, and 200 on `/my-bonuses`.
  - The supervisor gets 200 on `/projects` and 403 on `/admin` and `/my-bonuses`.
  - The admin gets 200 on `/admin` and 403 on `/my-bonuses`.
- **Normalisation cells:**
  - The employee gets 403 on `/%61dmin` and `//admin`.
  - The employee gets a non-200 on `/ADMIN`. The implementer records the actual status (expected 404) and pins it.
- **`next` cells:**
  - POST `/api/auth/signin` with a valid login and `next=//evil.com` lands on exactly `/`.
  - With `next=/projects`, it lands on exactly `/projects`.
- **IDOR cells as `employee2`:**
  - 403 on `/projects/…0012`, `/projects/…0012/milestones/…0023` and POST `/api/projects/…0012/milestones/…0023/notify`.
  - `/my-bonuses` returns 200 and includes the 400,00 zł amount (as the page formats it, whitespace normalised) and the "Approved Demo Project" milestone name.
  - It excludes the 600,00 zł amount and the Draft milestone `…0024`'s name.
  - The same assertions hold for `/my-bonuses?employee=…0031&milestone=…0024`.

### Success Criteria:

#### Automated Verification:

- Seed applies and every pgTAP suite still passes: `npx supabase db reset --local && npx supabase test db`
- Extended smoke passes against a build preview (as in CI): `npm run build && npm run preview -- --port 4321` and, separately, `npm run smoke`
- Lint and type check pass: `npm run lint && npx astro check`

#### Manual Verification:

- Prove smoke can fail: temporarily remove `"/my-bonuses"` from `EMPLOYEE_ROUTES`. The supervisor and admin `/my-bonuses` cells fail. Revert.
- Prove the IDOR content cell can fail: temporarily swap the expected amounts. The `bodyIncludes` / `bodyExcludes` cells fail with readable output. Revert.
- The CI `smoke` job is green on the pushed branch. This confirms that the fresh `supabase start` loads the seed (research open question 6).
- The seeded `/my-bonuses` view as `employee2@meritly.local` shows one Approved line of 400,00 zł.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Notification pending fix and Mailpit integration suite (risk #5)

### Overview

Make the function and the app report lines that another call still holds, instead of reporting success. Extract the notice logic into a unit-testable function. Add a local integration suite that runs the real function against Mailpit.

### Changes Required:

#### 1. Function reports pending lines

**File**: `supabase/functions/notify-milestone-approved/index.ts`

**Intent**: When the claim returns no rows, tell "everything already sent" apart from "unsent lines held by another or a crashed call", so the caller never mistakes the second case for success.

**Contract**:

- After an empty claim, count the milestone's lines with `notified_at is null` using the admin client, and return `200 { sent: 0, failed: 0, pending: <count> }`.
- Successful paths return `pending: 0`. Error codes and statuses are unchanged.
- A failed count query logs and returns 500 `notify_failed`.

#### 2. App mapping and one notice rule

**File**: `src/lib/services/approvals.ts`, `src/pages/api/projects/[id]/milestones/[milestoneId]/approve.ts`, `src/pages/api/projects/[id]/milestones/[milestoneId]/notify.ts`

**Intent**: Carry `pending` through, and decide the notice in one pure function used by both routes.

**Contract**:

- `notifyMilestoneApproved` returns `{ sent, failed, pending }`; `pending` defaults to 0 when absent.
- A new `APPROVAL_NOTICE_MESSAGES.email_pending` reads: "Bonus emails are still being sent by another request. Check “Emails sent” in a few minutes; if it does not change, use “Re-send unsent emails”."
- A new exported `emailNotice(result)` returns:
  - `"email_failed"` for an error;
  - `"email_partial"` when `failed > 0`;
  - `"email_pending"` when `pending > 0`;
  - otherwise `undefined`.
- `approve.ts` uses it. `notify.ts` uses it for the success branch, and its error branch is unchanged.

#### 3. Unit tests for the mapping

**File**: `src/lib/services/__tests__/approvals.test.ts` (new)

**Intent**: Pin how function responses map to app outcomes without the network.

**Contract**:

- Uses a fake `functions.invoke` client:
  - `{sent:2, failed:0}` gives no notice;
  - `{sent:1, failed:1}` gives `email_partial`;
  - `{sent:0, failed:0, pending:2}` gives `email_pending`;
  - a missing `pending` is treated as 0;
  - `FunctionsHttpError` with `{code:"send_failed"}` gives the error `send_failed`, and the notice `email_failed` on the approve path;
  - an unknown code or network error gives `notify_failed`.
- Also tests `approvalNoticeMessage("email_pending")`, and that an unknown notice code gives nothing.

#### 4. Integration suite config

**File**: `vitest.integration.config.ts` (new), `package.json`

**Intent**: A separate Vitest project for network-dependent suites, so `npm test` and Stryker stay hermetic.

**Contract**:

- Includes `tests/integration/**/*.integration.test.ts`, with Node environment, no file parallelism, a test timeout of at least 30 s and the same `@` alias.
- Script: `"test:integration": "vitest run --config vitest.integration.config.ts"`.
- Requires the env variables `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` (from `npx supabase status -o env`), and `MAILPIT_URL` (default `http://127.0.0.1:54324`).
- A missing variable fails with a clear message; it never skips.

#### 5. Notification integration suite

**File**: `tests/integration/notify-milestone-approved.integration.test.ts` (new)

**Intent**: Prove the #5 guarantees end to end against the real function and inbox, with hand-computed amounts.

**Contract**:

- **Fixture (per test):**
  - Signed in as seeded `supervisor@meritly.local` through supabase-js with the anon key, so RLS applies.
  - Creates a project, a milestone with target 1000.00 and KPI 100 ×4, and two employees with unique per-run addresses `notify-<runId>-a@example.test` and `-b@example.test`, with the same job role.
  - Engagements at 0.60 and 0.40 with the same rating.
  - Approves through `rpc("approve_milestone")`, except in the Draft case.
- **Expected amounts:** 600,00 zł and 400,00 zł, derived in a comment.
- **Service-role use:** the service-role client is used only to plant `notify_claimed_at` in the held-claim case. It never stands in for the supervisor.
- **Inbox reads:** Mailpit search is by unique address, and the shared inbox is never wiped.
- **Cases:**
  1. Seeded `employee@meritly.local` invokes the function and gets 403 `forbidden`. No message is sent to either address.
  2. Seeded `supervisor2@meritly.local` invokes it on the fixture and gets 404 `not_found`. No messages.
  3. The Draft fixture gets 409 `not_approved`. No messages.
  4. On the Approved fixture:
     - the response is `{sent:2, failed:0, pending:0}`;
     - exactly one message reaches each address;
     - A's text includes 600,00 zł and not 400,00 zł, and B's text the reverse;
     - each message has a single `To`;
     - both lines show `notified_at` when read as the supervisor.
  5. Invoking again gives `{sent:0, failed:0, pending:0}`, and there is still exactly one message per address.
  6. On a fresh Approved fixture, four concurrent invokes give Σ`sent` = 2 and exactly one message per address.
  7. Held claim, on a fresh Approved fixture:
     - With the service role, set `notify_claimed_at = now()` on both lines, then invoke: `{sent:0, failed:0, pending:2}` and no messages.
     - Set `notify_claimed_at = now() − 11 min`, then invoke: `{sent:2}` and one message each (stale-claim takeover).

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the new mapping tests: `npm test`
- Type check and lint pass: `npx astro sync && npx astro check && npm run lint`
- With `npx supabase start` and `npx supabase functions serve` running (and `supabase/functions/.env` set for Mailpit), the integration suite passes: `npm run test:integration`
- Scoped mutation run on approvals leaves no surviving mutant in `emailNotice` or the response mapping: `npm run test:mutation -- --mutate src/lib/services/approvals.ts`

#### Manual Verification:

- Prove the suite can fail: temporarily remove the `status !== "approved"` guard in the function. Case 3 fails. Then drop `.is("notified_at", null)` from the claim. Case 5 fails. Revert both.
- Provider down: stop Mailpit (or point `MAILPIT_URL` at a closed port and restart `functions serve`), then approve a milestone in the UI. The page shows the "could not be sent" notice and "Emails sent 0 of N". After restoring Mailpit, "Re-send unsent emails" delivers one email per employee.
- Pending notice: with a claim planted as in case 7, re-send in the UI. The page shows the `email_pending` notice, not plain success.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Test-plan backport and cookbook

### Overview

Bring `context/foundation/test-plan.md` and CLAUDE.md in line with what Phase 3 delivered, and fill in the cookbook entries this phase owns.

### Changes Required:

#### 1. Rollout, stack and gates

**File**: `context/foundation/test-plan.md`

**Intent**: Remove the stale Vitest wording and name the gates truthfully.

**Contract**:

- **§2 Risk Response Guidance, #1 row:** state that the HTTP check is "403 on ID-bearing URLs for a linked employee + `/my-bonuses` shows only own Approved lines and ignores injected params", because no employee URL takes a data ID.
- **§3, row 3:** Test types become "Vitest unit (extend Phase 2 setup) + Vitest integration (Mailpit) + smoke extension + HTTP IDOR cells". The Status column is left to the orchestrator.
- **§4:**
  - Vitest row: plain `vitest.config.ts`, `^4`, set up in Phase 2.
  - Add a row for `vitest.integration.config.ts` (local; needs Mailpit and `functions serve`).
  - Mailpit row: "used by `npm run test:integration`".
  - Smoke row: "extended in Phase 3".
- **§5:**
  - Vitest unit becomes "required after §3 Phase 4 (CI wiring); local + pre-merge until then".
  - Add a row for the Vitest integration suite: local, "required after §3 Phase 4 if CI starts mailpit + edge-runtime".
  - Auth smoke becomes "required (wired); role × route, `next`, path-normalisation and IDOR cells since §3 Phase 3".
- **§8:** update the "last reviewed" and "last verified" dates.

#### 2. Cookbook

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.3 and §6.4 placeholders with the patterns established here, and append the §6.6 note for this phase.

**Contract**:

- **§6.3 (new page or API route):** classify the route in `src/lib/route-access.ts`, add matrix rows to `route-access.test.ts`, and the classification rule enforces this. Add a smoke cell when the route is a new top-level group or carries data an employee must not see. Also cover:
  - expected values come from the role rules, not the code;
  - the prove-it-can-fail recipe;
  - the run commands.
- **§6.4 (Edge Function email):** cover:
  - the integration config and location;
  - the fixture recipe (supervisor under RLS, unique addresses, KPI 100 oracle);
  - the Mailpit search-by-address rule;
  - that the service role is for fault planting only;
  - the case list (role, owner, Draft, pairing, repeat, concurrency, held claim);
  - that the provider-down check is manual;
  - the known stamp-failure duplicate;
  - the run commands.
- **§6.6:** add a Phase 3 note. It records:
  - the success-shaped held-claim path, now fixed;
  - the duplicate path, pinned;
  - that the HTTP IDOR check was reframed;
  - the Astro path-normalisation finding;
  - the `/ADMIN` status pinned by smoke;
  - the outcome of the mutation checks.

#### 3. Commands in CLAUDE.md

**File**: `CLAUDE.md`

**Intent**: Make the new command discoverable.

**Contract**:

- Under Commands, add `npm run test:integration`: local only, its prerequisites and env variables, and that it is not part of `npm test`.
- Note that the smoke test now uses seeded accounts (`supabase db reset` restores them).

### Success Criteria:

#### Automated Verification:

- Formatting passes on the edited docs: `npx prettier --check context/foundation/test-plan.md CLAUDE.md`
- No §6.3 or §6.4 placeholders remain: `grep -c "TBD — see §3 Phase 3" context/foundation/test-plan.md` returns 0

#### Manual Verification:

- §6.3 and §6.4 read as a complete "how do I add a test for X" answer for someone who did not take part in this change.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `route-access.test.ts`: the role × route-group matrix, plus profile error, missing profile, unknown role, prefix over-match and `next` shaping.
- `route-classification.test.ts`: every file under `src/pages` is classified, and the allowlist entries exist.
- `safe-next.test.ts`: open-redirect vectors.
- `approvals.test.ts`: function response → result and notice mapping, including `pending`.

### Integration Tests:

- `tests/integration/notify-milestone-approved.integration.test.ts`: the real Edge Function and Mailpit, cases 1–7 in Phase 3.
- `scripts/smoke.mjs`: the production preview with seeded accounts, covering role × route, `next`, path normalisation and IDOR.

### Manual Testing Steps:

1. Run the scratch-route and dropped-list checks (Phase 1).
2. Run the swapped-amount and dropped-employee-route checks (Phase 2).
3. Run the provider-down and pending-notice UI checks (Phase 3).
4. Check that the CI smoke job is green on the branch.

## Performance Considerations

The smoke job grows by roughly 25 requests and four sign-ins, well within the auth rate limit. The integration suite is local only.

## Migration Notes

No schema migration. Behaviour changes in production:

- the notifier's success body gains `pending`, which the app treats as optional;
- one new notice code.

Seed changes affect local and CI databases only.

## References

- Research: `context/changes/testing-route-gating-notification/research.md`
- Test plan: `context/foundation/test-plan.md` §2 (#1, #5, #6), §3 row 3, §5, §6.1–§6.2 (patterns to mirror)
- Prior phases: `context/archive/2026-10-07-testing-rls-matrix/`, `context/archive/2026-10-09-testing-payout-correctness/`
- Notifier origin: `context/archive/2026-10-05-supervisor-approves-milestone-employee-sees-bonus/reviews/impl-review.md` (F2, F6), `reviews/plan-review.md` (F5)
- Mailpit API: Context7 `/axllent/mailpit` (checked 2026-10-10)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Route gate extraction and unit rules (risk #6)

#### Automated

- [x] 1.1 Unit tests pass: `npm test`
- [x] 1.2 Type check and lint pass: `npx astro sync && npx astro check && npm run lint`
- [x] 1.3 Existing smoke still passes against a running dev or preview server: `npm run smoke`
- [x] 1.4 Scoped mutation run on the new module and `safeNext` leaves no surviving mutant in `decideAccess` branch logic

#### Manual

- [x] 1.5 Prove the rule can fail with a scratch `src/pages/reports.astro`
- [x] 1.6 Prove the matrix can fail by dropping `"/api/admin"` from `ADMIN_ROUTES`

### Phase 2: Seed fixture and smoke extension (risk #6 HTTP, risk #1 IDOR)

#### Automated

- [ ] 2.1 Seed applies and every pgTAP suite still passes
- [ ] 2.2 Extended smoke passes against a build preview
- [ ] 2.3 Lint and type check pass

#### Manual

- [ ] 2.4 Prove smoke can fail by removing `"/my-bonuses"` from `EMPLOYEE_ROUTES`
- [ ] 2.5 Prove the IDOR content cell can fail by swapping expected amounts
- [ ] 2.6 CI `smoke` job is green on the pushed branch (seed loads in CI)
- [ ] 2.7 Seeded `/my-bonuses` as `employee2@meritly.local` shows one Approved line of 400,00 zł

### Phase 3: Notification pending fix and Mailpit integration suite (risk #5)

#### Automated

- [ ] 3.1 Unit tests pass, including the new mapping tests
- [ ] 3.2 Type check and lint pass
- [ ] 3.3 Integration suite passes against local Supabase, `functions serve` and Mailpit: `npm run test:integration`
- [ ] 3.4 Scoped mutation run on approvals leaves no surviving mutant in `emailNotice` or the response mapping

#### Manual

- [ ] 3.5 Prove the suite can fail (Draft guard and `notified_at` filter removed)
- [ ] 3.6 Provider down shows the failure notice and 0 of N; re-send delivers after restore
- [ ] 3.7 Planted claim shows the `email_pending` notice on re-send

### Phase 4: Test-plan backport and cookbook

#### Automated

- [ ] 4.1 Formatting passes on the edited docs
- [ ] 4.2 No §6.3 or §6.4 placeholders remain

#### Manual

- [ ] 4.3 §6.3 and §6.4 read as a complete "how do I add a test for X" answer
