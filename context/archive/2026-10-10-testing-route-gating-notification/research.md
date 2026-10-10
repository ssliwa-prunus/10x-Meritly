---
date: 2026-10-10T12:51:12+02:00
researcher: Claude (Opus 5.5)
git_commit: 5ca85b13ed9c6efe788389fad3a0014ab2ea4703
branch: develop
repository: 10x-Meritly
topic: "Ground test rollout Phase 3 — route gating (#6), approval notification (#5), HTTP IDOR (#1)"
tags: [research, test-plan, middleware, safe-next, notify-milestone-approved, my-bonuses, smoke, vitest, mailpit]
status: complete
last_updated: 2026-10-10
last_updated_by: Claude (Opus 5.5)
---

# Research: Ground test rollout Phase 3 — route gating & approval notification

**Date**: 2026-10-10T12:51:12+02:00
**Researcher**: Claude (Opus 5.5)
**Git Commit**: 5ca85b13ed9c6efe788389fad3a0014ab2ea4703 (working tree: `context/foundation/test-plan.md` modified, this change folder untracked — cited code is unmodified)
**Branch**: develop
**Repository**: 10x-Meritly

## Research Question

Ground rollout Phase 3 of `context/foundation/test-plan.md`. Verify — not blindly accept — the §2 Risk Response Guidance for:

- **#5** approval email reaches the wrong person, is sent for a Draft milestone, is sent repeatedly (incl. re-send flooding), or approval reports success while the notification is silently lost.
- **#6** a new page or API route escapes role gating, or the sign-in `next` target becomes an open redirect.
- **#1 (HTTP layer, moved from Phase 1)** Employee B reaches Employee A's results or Draft results by changing IDs in URLs.

For each: ground the real failure path, locate existing tests, name the cheapest useful layer, flag speculative risks or misleading evidence.

## Summary

| Risk      | Verdict on §2 guidance                                                                                                                                                                                                                                               | Real residual failure paths found                                                                                                                                                                                                                                                                                                 | Cheapest useful layer                                                                                                                                                                                                                               |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #6        | **Confirmed and sharpened.** Gating is allow-by-default prefix matching (`src/middleware.ts:28`, `:106`); an unlisted route is public and nothing in the repo detects it. `next` validation is sound at every consumption point; `safeNext` has zero tests.          | (a) unlisted new route = public; (b) gating logic is inline in `onRequest` and not unit-testable under the plain `vitest.config.ts`; (c) case variants (`/ADMIN`) unverified at runtime.                                                                                                                                          | Vitest on an extracted pure gating function + a filesystem rule over `src/pages`; Vitest table for `safeNext`; smoke extension for role × route HTTP cells using seeded accounts.                                                                   |
| #5        | **Confirmed, with one correction.** Wrong-caller and Draft sends are blocked twice (function + DB); recipient↔amount pairing is by FK, one line per email; claim-before-send is atomic; approval commits before and independently of notification.                   | (a) send succeeds + stamp fails → line released → re-send duplicates (always on Mailpit); (b) a held/stale claim returns `200 {sent:0, failed:0}` → re-send UI reports success with no notice (N-of-M count still truthful); (c) never-invited employee's email is editable after approval, so a re-send goes to the new address. | Integration against local Mailpit + `functions serve` — **not runnable in CI today** (CI excludes `mailpit,edge-runtime`, `.github/workflows/ci.yml:42`).                                                                                           |
| #1 (HTTP) | **Corrected.** No URL reachable by the employee role takes an ID. Every ID-bearing page/API path is behind the `PROJECT_ROUTES`/`ADMIN_ROUTES` 403; `/my-bonuses` reads no params. "Foreign ID → 403/404" is therefore not a meaningful test shape at the app layer. | None found beyond the middleware-gating risk (#6). DB-layer IDOR is already covered by `rls_matrix.test.sql` with properly linked attackers.                                                                                                                                                                                      | Smoke/HTTP cells: linked employee gets 403 on ID-bearing supervisor/admin URLs; `/my-bonuses` HTML contains only own Approved lines, ignores injected query params. Needs a second linked employee + approved milestone fixture (privileged write). |

Hot-spot evidence (`src/pages/api/` churn, middleware churn) is **not misleading**: the middleware is the only app-layer gate (API handlers do not re-check role, see §6.2), so churn there translates directly into risk #6.

## Detailed Findings

### Risk #6 — route gating

#### 6.1 Route lists and matcher

- Lists (`src/middleware.ts:8-26`): `PROTECTED_ROUTES` (10 prefixes), `ADMIN_ROUTES = ["/admin", "/api/admin"]`, `PROJECT_ROUTES = ["/projects", "/api/projects", "/employees", "/api/employees"]`, `EMPLOYEE_ROUTES = ["/my-bonuses"]`, `SET_PASSWORD_ROUTES = ["/auth/set-password", "/api/auth/set-password"]`.
- Matcher (`src/middleware.ts:28`): `routes.some((route) => pathname.startsWith(route))` — raw prefix, no segment boundary. Over-matches (`/projectsX`, `/administrator`, `/my-bonuses2`) — fails closed.
- **Default for a path in no list: allowed.** `next()` at `src/middleware.ts:106` is reached with no auth check. Nothing enforces that the role lists are subsets of `PROTECTED_ROUTES` (today they are).
- **URL normalisation (verified in Astro 7.3.2 source, `node_modules/astro/package.json`)**: the `context.url` given to middleware is built in `node_modules/astro/dist/core/fetch/fetch-state.js:212-216` — `#normalizePathname` fully decodes (`validateAndDecodePathname`, `:772-783`) and `collapseDuplicateSlashes`. So for this inspected version `/%61dmin` and `//admin` reach `matchesRoute` as `/admin`. This is framework-version-dependent — a candidate HTTP regression cell, not a unit cell.
- **Case variants** (`/ADMIN`, `/Projects/<id>`): `matchesRoute` is case-sensitive; whether Astro routes them to the lowercase page was **not verified**. Cheap smoke cell; RLS would still return no data to an employee.

#### 6.2 Outcome matrix (from code reading; anon / employee / supervisor / admin)

- Anonymous on a protected page: 302 `/auth/signin?next=<encoded>` (`src/middleware.ts:67-68`); on `/api/*`: plain 302 `/auth/signin`, **never 401** (`:66`).
- Wrong role: `403 Forbidden` (`:76-77`, `:86-87`, `:95-96`).
- Profile lookup error: `503` on the three role-gated groups (`:73-75`, `:82-84`, `:92-94`); `/dashboard` and set-password routes are not 503-gated.
- Missing profile row or unknown role: `profile = null` / role fails strict comparisons → 403 (fails closed).

| Route group                                                                                                      | Anon                                                                   | Employee                                                | Supervisor | Admin  |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------- | ---------- | ------ |
| `/`, `/auth/signin`, `/auth/signup`, `/auth/confirm-email`, `/auth/confirm`, `/api/auth/{signin,signup,signout}` | public                                                                 | public                                                  | public     | public |
| `/dashboard`                                                                                                     | 302 + next                                                             | 200                                                     | 200        | 200    |
| `/admin/**` pages                                                                                                | 302 + next                                                             | 403                                                     | 403        | 200    |
| `/api/admin/**` (POST only)                                                                                      | 302                                                                    | 403                                                     | 403        | allow  |
| `/projects/**`, `/employees` pages                                                                               | 302 + next                                                             | 403                                                     | 200        | 200    |
| `/api/projects/**`, `/api/employees/**` (POST only)                                                              | 302                                                                    | 403                                                     | allow      | allow  |
| `/my-bonuses`                                                                                                    | 302 + next                                                             | 200                                                     | 403        | 403    |
| `/auth/set-password`, `/api/auth/set-password`                                                                   | 302                                                                    | invite session only, else 302 `/dashboard` (`:100-104`) | same       | same   |
| `/dev/projects-kitchen-sink`                                                                                     | dev 200 / prod 404 (`src/pages/dev/projects-kitchen-sink.astro:25-28`) | same                                                    | same       | same   |

- **The middleware is the only app-layer role gate**: API handlers read `locals.profile.role` only to choose a schema (e.g. `src/pages/api/projects/index.ts:19`, `src/pages/api/employees/index.ts:18`), not to re-authorise. RLS is the backstop.
- Public sign-up yields role `employee` by default (`supabase/migrations/20260925120000_role_and_rls_scaffold.sql:16`, `:35`), so an employee session is obtainable by anyone — the employee column of the matrix is the realistic attacker.

#### 6.3 `next` validation

- `src/lib/safe-next.ts:13-28` (zod, max 512): starts with `/`; not `//`; no `\`; no scheme (`/^\/*[a-z][a-z0-9+.-]*:/i`); printable ASCII only.
- Checked by reasoning against the code: `//evil.com`, `/\evil.com`, `https://evil.com`, `javascript:…`, `/javascript:…`, tab/CR/LF, non-ASCII → rejected. `?next=%2F%2Fevil.com` is decoded by `searchParams.get` to `//evil.com` → rejected. `/%2F%2Fevil.com` (literal) → accepted but stays a same-origin path. `/auth/signin` → accepted (lands on the form again; no loop). False positive: `/foo:bar` rejected.
- Consumption points, all validated: middleware producer (`src/middleware.ts:67`), `src/pages/auth/signin.astro:25`, server-side re-check in `src/pages/api/auth/signin.ts:10` with final `redirect(next ?? "/")` (`:26`). `/auth/confirm` and `/api/auth/set-password` use hard-coded targets (`src/pages/auth/confirm.ts:14,41`; `src/pages/api/auth/set-password.ts:12-36`).
- **No test exists** for `safeNext` (only `src/lib/__tests__/forms.test.ts` exists).

#### 6.4 Testability

- Not importable under `vitest.config.ts` (plain config, comment at `vitest.config.ts:4-5`): `src/middleware.ts:1` (`astro:middleware`), `src/lib/supabase.ts:3` and `src/lib/config-status.ts:1` (`astro:env/server`).
- Pure today: `src/lib/safe-next.ts` (zod only), `src/lib/set-password.ts` (`isInviteSession` takes a client).
- The access decision (`src/middleware.ts:63-104`) is inline; lists and `matchesRoute` are not exported. **A unit-testable gate requires a small refactor**: move the lists + a pure `decide(pathname, { user, profile, profileError })` into `src/lib/` and call it from the middleware. This is a production-code change the plan must own.
- **Rule for unlisted routes (feasible)**: a Vitest test walks `src/pages/**/*.{astro,ts}`, maps files to route paths, and asserts each is either in an explicit public allowlist or classified by the gating lists. It needs the lists exported from an `astro:`-free module. Stronger alternative (product decision): deny-by-default for unlisted paths plus a segment-boundary matcher.

#### 6.5 Existing smoke (`scripts/smoke.mjs`, 75 lines, dependency-free)

Steps (`:38-59`): `/` 200; anon `/dashboard` → 302 sign-in (`next` not asserted); sign-up → confirm-email; wrong password → `?error=`; correct password → 302 starting with `/` (weak); `/dashboard` 200; sign-out; `/dashboard` → 302. It only creates a fresh `employee` user with no employees row; it never exercises 403/503, supervisor/admin, or `next`.

Seeded accounts usable by an extended smoke: `admin@`, `supervisor@`, `supervisor2@`, `employee@meritly.local`, password `Meritly-Local-Passw0rd!` (`supabase/seed.sql:9-14`); seed enabled (`supabase/config.toml:60-65`). Whether the CI smoke job's fresh `supabase start` loads the seed was **not verified at runtime** (likely — fresh start applies migrations and seed).

### Risk #5 — approval notification (`supabase/functions/notify-milestone-approved/index.ts`)

#### 5.1 Caller authorization

- `verify_jwt = true` (`supabase/config.toml:377-378`); handler wrapped in `withSupabase({ auth: "user" })` (`index.ts:225`).
- Role via caller's client: `current_app_role` → anything but `supervisor` gets 403 (`index.ts:232-237`); Admins are excluded.
- Ownership: milestone loaded under caller RLS, then `projects.supervisor_id !== ctx.userClaims?.id` → 404 (`index.ts:240-251`). Foreign supervisor → 404. (Meaning of `ctx.userClaims.id` assumed = JWT `sub`; not checked against `@supabase/server` docs; an undefined value fails closed.)
- App routes re-check project↔milestone and refuse Admins (`src/pages/api/projects/[id]/milestones/[milestoneId]/approve.ts:31,37-43`, `notify.ts:26,32-38`); invoke with user JWT (`src/lib/services/approvals.ts:324`).
- Accepted gap (archived impl-review F6): after an Admin reassigns a project, the new owner can re-send the previous owner's approved emails.

#### 5.2 Draft guard — enforced twice

- Function: `if (milestone.status !== "approved") return reply(409, { code: "not_approved" })` (`index.ts:252`).
- DB: result lines are written only by `approve_milestone` (security definer, same transaction as `status = 'approved'`; `supabase/migrations/20261005120000_milestone_approval.sql:282-392`); `authenticated` has no insert/update/delete on result tables (`:85`, `:123`); `milestones_check_frozen` blocks approved-on-insert, changes after approval, and approval without a snapshot (`:245`, `:252`, `:257-260`). The claim UPDATE itself (`index.ts:270-276`) does not filter by status; it relies on lines existing only post-approval.

#### 5.3 Recipient ↔ amount pairing

- Claimed lines read with the admin client joining `employees!inner(email, full_name, profile_id, activated_at)` via `milestone_result_lines.employee_id` FK (`index.ts:305-311`; migration `:97`); unique per (milestone, employee) (`:115`).
- Amount = frozen snapshot `bonus`; address/name read **live** from `public.employees` (unique email, `20260929120000_employees_and_engagements.sql:48`).
- One message per line, single recipient (`index.ts:108-146`; Resend `to: [message.to]` `:172`; Mailpit `To: [...]` `:212`). One email cannot carry another employee's figures by construction.
- **Wrong-person path**: email is locked only after the first invite (`20261005120000_milestone_approval.sql:447`, `MR009`). A never-invited employee's address remains supervisor-editable after approval, and a re-send goes to the new address. Accepted in archived plan-review F5 (mitigated by "ask for an invite" copy, `index.ts:41-42,128`).

#### 5.4 Once-only semantics

- **Claim before send, atomic** (`index.ts:266-276`): single `UPDATE … SET notify_claimed_at = now WHERE milestone_id = ? AND notified_at IS NULL AND (notify_claimed_at IS NULL OR notify_claimed_at < now-10min) RETURNING id`. A concurrent call claims nothing and returns `200 {sent:0, failed:0}` (`:280-284`). Claim timeout `CLAIM_TIMEOUT_MS = 10 min` (`:39`).
- **Stamp after provider confirmation** (`:325-344`), conditional on `notified_at IS NULL`, counting only updated rows. Mailpit: per message (`:352-354`); Resend: per batch ≤ 100, all-or-nothing, idempotency key `milestone-approved/<id>/<sha256(sorted ids)>` (`:160`).
- Unconfirmed lines are released (`:357-359`); `failed = claimed − sent` (`:361`).
- **Residual duplicate path**: send succeeds, stamp fails → line released (`:357-359`) → next re-send emails it again. On Mailpit always; on Resend after 24 h or if batch composition/body changes. Recorded as residual in archived impl-review F2 (`reviews/impl-review.md:86-89`).
- Re-send route (`notify.ts`) calls the same function; resets nothing. Form shown only when `notifiedCount < lineCount` (`src/components/milestones/ApprovalSection.astro:52`), but direct POST works any time. **No rate limit**; flooding is bounded by the claim + `notified_at` (repeated POSTs return `{0,0}` once stamped), except the stamp-failure loop.

#### 5.5 Failure surfacing

- Transport (`index.ts:89-96`): Resend when `RESEND_API_KEY` and `MAIL_FROM` are both set, else `MAILPIT_URL`, else 500 `email_not_configured`. Missing `APP_URL` → 500 before any claim (`:260-264`). If only `MAIL_FROM` is missing and `MAILPIT_URL` is set, production silently falls back to Mailpit (config hazard, not a test target).
- Provider failure: nothing confirmed → 502 `send_failed` (or 500 `notify_failed` if a stamp failed) (`:363`); partial → `200 {sent, failed>0}` (`:364`).
- App caller (`src/lib/services/approvals.ts:290-298`, `:320-345`): maps function error codes; network/relay error → `notify_failed`. `approve.ts:50-63` commits the RPC first, then redirects with `saved: "approved"` plus `notice: "email_failed" | "email_partial"` (`approvals.ts:52-53`). Approval is never undone by a notification failure. The page shows "Emails sent N of M" from `notified_at` (`ApprovalSection.astro:97`).
- **Correction to the §2 "visible failure" intent**: one success-shaped path remains — a claim held by a concurrent/crashed call (or a failed release, which only logs, `index.ts:295-301`) returns `200 {0,0}`, so approve shows no notice and re-send shows `saved: "notified"` (`notify.ts:46-47`). Only the N-of-M counter reveals the truth. Tests should assert on the counter / `notified_at`, not on the redirect notice alone.

#### 5.6 Running against Mailpit

- Local: `npx supabase start` (Mailpit on 54324, `supabase/config.toml:99-102`); copy `supabase/functions/.env.example` → `.env` with `APP_URL=http://localhost:4321`, empty `RESEND_API_KEY`/`MAIL_FROM`, `MAILPIT_URL` reachable from the edge container (values in `.env.example`); `npx supabase functions serve`.
- Assertions: Mailpit HTTP API (`/api/v1/messages`, `/api/v1/search?query=to:…`, `/api/v1/message/{id}`, `DELETE /api/v1/messages`) — endpoints from general knowledge, **not verified via Context7**.
- Fixture: seed milestone `…0021` has one engagement (employee `…0031`, `supabase/seed.sql:112-153`); a second employee + engagement must be inserted, then `approve_milestone` as the supervisor.
- Inducible failures: bad `MAILPIT_URL` → 502 + claims released; stopped `functions serve` → app `email_failed` notice with approval committed; missing `APP_URL` → 500. Stamp failure and per-recipient partial failure are **not cheaply inducible** with Mailpit (needs a fault-injecting proxy or a DB-side block).
- **CI constraint**: smoke job starts Supabase with `-x studio,imgproxy,mailpit,edge-runtime,…` (`.github/workflows/ci.yml:42`). A Mailpit integration suite is local-only unless the plan changes CI (CI YAML authoring is out of this lesson's scope; the plan may name the gate as "required after" a later phase).
- Existing coverage: no Deno test, no `deno.json`; archived plan excluded automated email tests (`plan.md:68-69`). pgTAP pins only grants and initial nulls (`supabase/tests/milestone_approval.test.sql:158-167`, `~405-416`); claim/stamp/release logic lives in TS with the admin client, so pgTAP cannot cover it.

### Risk #1 at the HTTP layer

- Reachable by the employee role after middleware: `/`, `/dashboard` (no queries), `/my-bonuses`, `/auth/*` pages, `/api/auth/*` POSTs. **None takes a data ID.** `/my-bonuses` reads no `Astro.params` or `searchParams` (`src/pages/my-bonuses.astro:15,23`).
- Every `src/pages/api/**` handler exports only `POST` (e.g. `src/pages/api/projects/[id].ts:14`, `src/pages/api/employees/[id].ts:13`); the only GET endpoint is `/auth/confirm`.
- `/my-bonuses` data path: session client with the public key (`src/lib/supabase.ts:5-20`) → `listMyBonuses` (`src/lib/services/approvals.ts:370-409`) = `rpc("current_employee_id")` + unfiltered select on `milestone_result_lines` (table, not a view), then client-side filter `row.employee_id === employeeId` (`:387`). Selected columns exclude employee names (`:361-362`). Unlinked account → `not_linked` message (`my-bonuses.astro:55-58`); DB error → destructive Alert with HTTP 200.
- RLS: employee select policy = own `employee_id` AND `is_approved_milestone(milestone_id)` (`supabase/migrations/20261005120000_milestone_approval.sql:210-216`); `milestone_results` has no employee policy (`:168-187`).
- Existing DB coverage (`supabase/tests/rls_matrix.test.sql`): two linked, activated employees E1/E2, an unlinked employee-role user, anon; Draft milestone with an injected E1 line so the empty result is meaningful; E1 sees exactly own approved lines and nothing by E2's ids or the Draft (`:372-583`), E2 mirrored (`:584-684`).
- **What an HTTP check adds**: middleware 403s on ID-bearing URLs for a _linked_ employee; `/my-bonuses` HTML contains only own Approved amounts/milestone names and ignores injected `?employee=`/`?milestone=`.
- Fixture cost: seed has one linked employee and no approved milestone. Linking requires privileged writes (`profile_id`, `activated_at` not granted to `authenticated`, `20260929120000_employees_and_engagements.sql:57-61`). Options: (a) SQL via psql/`docker exec` (pattern in `rls_matrix.test.sql:51-142`; no `pg` dependency in `package.json`); (b) supabase-js + service-role key from `supabase status -o env`, test-side only — note `auth.admin.createUser({ email_confirm: true })` does **not** fire the `on_auth_user_confirmed` activation trigger, so set `activated_at` explicitly; (c) hybrid: build via the app's supervisor POST endpoints, privileged write only to link the second employee. Invite path is unavailable in CI (no Mailpit/edge runtime).

## Code References

- `src/middleware.ts:8-28` — route lists and prefix matcher
- `src/middleware.ts:63-106` — inline access decision; allow-by-default `next()`
- `node_modules/astro/dist/core/fetch/fetch-state.js:212-216,772-783` — pathname decoded + duplicate slashes collapsed before middleware (Astro 7.3.2)
- `src/lib/safe-next.ts:13-28` — `next` validation
- `src/pages/api/auth/signin.ts:10,26` — server-side `next` re-check and redirect
- `scripts/smoke.mjs:38-59` — current smoke steps
- `supabase/seed.sql:9-14,112-153` — seeded accounts and milestone/engagement
- `supabase/functions/notify-milestone-approved/index.ts:225-252` — authz + Draft guard
- `supabase/functions/notify-milestone-approved/index.ts:266-284` — atomic claim; empty claim → `200 {0,0}`
- `supabase/functions/notify-milestone-approved/index.ts:320-364` — stamp, release, response codes
- `src/lib/services/approvals.ts:290-345` — app-side error mapping
- `src/lib/services/approvals.ts:370-409` — `listMyBonuses`
- `src/components/milestones/ApprovalSection.astro:52,97` — re-send form condition, N-of-M counter
- `supabase/migrations/20261005120000_milestone_approval.sql:210-216,447` — employee select policy; email lock after invite
- `.github/workflows/ci.yml:42` — CI excludes mailpit and edge-runtime
- `vitest.config.ts:4-5` — plain config, no `astro:*`

## Architecture Insights

- Authorization is layered: middleware prefix lists (app) → RLS (DB). The middleware is allow-by-default and is the **only** app-layer role check, so a route-list omission is caught only by RLS — which protects data but not the action surface (e.g. a new page that renders static admin UI or calls an Edge Function).
- The notifier follows a claim → send → stamp → release protocol with the admin client inside the Edge Function; correctness lives in TS, not SQL, so it can only be tested by running the function.
- Phase 2's plain Vitest config (no Astro pipeline) shapes Phase 3: anything to be unit-tested must live in an `astro:`-free module in `src/lib/`.

## Historical Context (from prior changes)

- `context/archive/2026-10-05-supervisor-approves-milestone-employee-sees-bonus/reviews/impl-review.md` — F2 (concurrency fixed by the claim; stamp-failure duplicate accepted as residual, `:86-89`) — **supported** by current code (`index.ts:357-359`). F6 (ownership-transfer re-send) — **supported**, unchanged.
- Same folder `reviews/plan-review.md` F5 — unverified-address risk accepted with invite-hint copy — **supported** (`index.ts:41-42,128`; lock only after invite, migration `:447`).
- Same folder `plan.md:68-69` — automated email tests explicitly deferred — **supported**: no function tests exist.
- `context/foundation/test-plan.md` §4 — "Vitest via Astro `getViteConfig()`, none yet — see Phase 3" — **contradicted**: Vitest ^4 with a plain config already exists (Phase 2, `vitest.config.ts`). Backport candidate. §3 row 3 "Vitest bootstrap" likewise stale.

## Related Research

- `context/archive/2026-10-07-testing-rls-matrix/` — Phase 1 (DB-layer IDOR matrix that this phase's HTTP check builds on)
- `context/archive/2026-10-09-testing-payout-correctness/` — Phase 2 (Vitest + Stryker setup)

## Open Questions

1. **Case-variant routing** (`/ADMIN`, `/Projects/<id>`) in Astro 7.3.2 — unverified; add a cheap HTTP cell rather than investigate further.
2. **Product decision for #6**: keep allow-by-default + a filesystem classification rule, or switch to deny-by-default with a segment-boundary matcher? Both need the gating lists extracted to an `astro:`-free module.
3. **Product decision for #5**: is the Mailpit integration suite local-only (documented in §6) or does a later phase add `mailpit,edge-runtime` to CI? Should the stamp-failure duplicate and the `200 {0,0}` held-claim path be fixed, or pinned as known behaviour with tests that assert the N-of-M counter?
4. **Fixture route for HTTP IDOR**: SQL via psql/docker, service-role supabase-js (test-side only), or hybrid — affects whether a new devDependency is needed.
5. Mailpit read-API endpoints and `@supabase/server` `ctx.userClaims` semantics — confirm via Context7 during planning.
6. Whether the CI smoke job's fresh `supabase start` loads `seed.sql` (needed if smoke uses seeded supervisor/admin accounts).
