---
date: 2026-10-15T18:35:01Z
researcher: Claude (claude-opus-5-5)
git_commit: d771e60
branch: develop
repository: 10x-Meritly
topic: "One shared error-logging helper that keeps code, message, details, hint, status and the relevant ids"
tags: [research, observability, logging, services, supabase, edge-functions]
status: complete
last_updated: 2026-10-15
last_updated_by: Claude (claude-opus-5-5)
---

# Research: shared error-logging helper (log-mapped-errors)

**Date**: 2026-10-15T18:35:01Z
**Researcher**: Claude (claude-opus-5-5)
**Git Commit**: d771e60 (main tree clean apart from untracked `context/audits/` and this change folder)
**Branch**: develop
**Repository**: 10x-Meritly

## Research Question

From `change.md`: "one shared error-logging helper that keeps code, message, details, hint, status and the relevant ids". This is fix-order step 1 of `context/audits/observability/2026-10-15_projects-milestones-employees.md` (root causes RC1 "mapped means unlogged" and RC4 "no shared serializer or context").

Concretely:

1. What does the helper replace (every mapper and log site)?
2. What can it read from each Supabase error type?
3. Which of those fields are safe to log?
4. Which ids are in scope at each call site?
5. What constraints (privacy rules, lint, tests, mutation) must it respect?

## Summary

- **Today:**
  - 13 per-service copies of two mappers, `mapLoadError` ×7 and `mapPostgrestError` ×6, log `{ code, message }` and nothing else.
  - The `mapPostgrestError` copies return silently for every mapped code (`23505`, `23514`, `42501`, the `MRxxx` guard codes). Only the fall-through logs.
  - The two Edge Function wrappers log `{ name }` only, and only for unmapped codes.
  - No PostgREST log site in `src` logs `details`, `hint`, `status` or any id (inspected: all of `src/lib/services`, `src/middleware.ts`, `src/pages/api/**`).
- **PostgREST errors** (postgrest-js 2.116.0) are a **plain parsed object, not a `PostgrestError` instance**. `instanceof` fails and there is no `name` or `stack`.
  - `status` exists only on the response object, not on the error.
  - A transport failure has `code: ""`, `message: "TypeError: …"`, the stack and cause in `details`, and `status: 0` on the response.
  - **`details` and `message` can contain PII** for some codes, so "keep `details`" cannot be unconditional.
- **Edge Function errors** carry no `status` or `code` field.
  - `FunctionsHttpError` / `FunctionsRelayError` hold the raw, unconsumed `Response` in `context`.
  - `FunctionsFetchError.context` holds the fetch rejection.
  - The app's `functionErrorCode` consumes the body, so a logger needs `clone()` before it, or status and headers only.
- **Auth errors** have `name`, `status` and `code`.
  - `getUser()` distinguishes anonymous (`AuthSessionMissingError`, status 400, no network call) from unavailable (`AuthRetryableFetchError`, status 0 or 5xx).
  - Classify by `name`, not by `status`.
- **Ids in scope:** services receive the client and entity ids, never the user.
  - The user id is available as `locals.user.id` at every page and route that calls a service, but it is not passed in.
  - Entity ids are in scope at most mapper call sites (table in Detailed Findings §4). Several list loaders have no id at all.
  - No request id or cf-ray is read anywhere.
- **Constraints:**
  - Keep the user-facing codes unchanged.
  - The "no existence leak" mapping of `42501` → `not_found` stays.
  - No emails or figures in logs.
  - `no-console` is a warning that call sites silence with a reasoned disable comment.
  - The helper must not import `astro:*`.
  - It sits in Stryker's mutate scope.
  - 9 unit-test assertions pin the exact `{ code, message }` payload, and 2 more pin the message string.

## Detailed Findings

### 1. Mapper and log-site inventory (what the helper replaces)

**`mapLoadError(error, context): LoadErrorCode`**

- Seven identical copies. Each always logs `` `${context} failed` `` with `{ code, message }`.
- Locations (declaration / `console.error` line):
  - `src/lib/services/approvals.ts:201/203`
  - `bonus-config.ts:265/267`
  - `employees.ts:229/231`
  - `engagements.ts:216/218`
  - `payouts.ts:177/179`
  - `projects.ts:304/306`
  - `reports.ts:16/18`

**`mapPostgrestError(error, context)`**

- Six copies with the same branch order: `23505` → `23514` → `42501` → `GUARD_ERROR_CODES` → log `{ code, message }` → `save_failed`.
- Codes each copy maps **without logging**:

| File (decl / log)                          | Silent codes                                                         |
| ------------------------------------------ | -------------------------------------------------------------------- |
| `projects.ts:293/300` (guard table `:283`) | 23505, 23514, 42501, MR001, MR002, MR003, MR004, MR012, MR014, MR015 |
| `bonus-config.ts:257/261`                  | 23505, 23514 (42501 **not** mapped, so it is logged)                 |
| `employees.ts:218/225` (guard `:211`)      | 23505, 42501, MR001, MR008, MR009, MR010                             |
| `engagements.ts:205/212` (guard `:199`)    | 23505, 42501, MR007, MR011, MR015                                    |
| `payouts.ts:168/173` (guard `:162`)        | 42501, MR003, MR013, MR015                                           |
| `approvals.ts:192/197` (guard `:186`)      | 42501, MR003, MR014, MR015                                           |

**`functionErrorCode(response)`**

- Two identical copies: `approvals.ts:350` and `employees.ts:386`.
- Each reads `{ code }` with `response.json()` and returns `null` on a parse failure through a silent catch (`approvals.ts:357`, `employees.ts:393`).
- The callers map known codes silently through:
  - `NOTIFY_ERROR_CODES` (`approvals.ts:339`): invalid_request, forbidden, not_found, not_approved, email_not_configured, send_failed, notify_failed
  - `INVITE_ERROR_CODES` (`employees.ts:376`): invalid_request, forbidden, not_found, already_active, email_unavailable, invite_failed
- The callers log `{ name }` only on the fall-through (`approvals.ts:413`, `employees.ts:410`).

**Other `console.error` sites in `src`.** There are no `console.warn` or `console.log` calls in `src`.

- `middleware.ts:33`: `{userId, code, message}`
- `pages/api/locale.ts:35`: `{userId, code, message}`
- `pages/api/auth/signin.ts:33`: `{code, message}`
- `pages/api/auth/set-password.ts:23`: `{status, code}`
- `pages/api/reports/bonuses.csv.ts:22`: no payload
- `reports.ts:50`: truncation, `{code: "truncated", message}`
- `pages/projects/[id]/milestones/[milestoneId].astro:103`: `{milestoneId}`

**Unlogged Auth mappers.** These are outside this change's core scope, but they are the same pattern:

- `src/lib/auth-errors.ts:19` (`signupErrorCode`)
- `pages/api/auth/signin.ts:20-24`
- `pages/auth/confirm.ts:22,27,38`
- `pages/api/auth/set-password.ts:29-33`
- `src/lib/set-password.ts:76`
- `pages/api/auth/signout.ts:8`
- `src/middleware.ts:17-20`, where the `getUser` error is ignored

**Edge Functions** (Deno, outside `tsconfig` and ESLint):

- `supabase/functions/invite-employee/index.ts` logs on 4 of its 500 paths, but not on its 400/403/404/409 replies (`:45,48,56,68,70,73,85`). Its role and employee lookup logs (`:53,:65`) omit `employeeId`.
- `notify-milestone-approved/index.ts` does not log its 400/403/404/409 replies (`:227,230,238,251,253`). Its role lookup log (`:235`) has `{code}` only.

### 2. What each error type carries (supabase-js 2.116.0, installed)

**PostgREST** (`node_modules/@supabase/postgrest-js/dist/index.mjs`)

- Error shape:
  - In the default mode the `error` is `JSON.parse(body)` (`:512`), or `{ message: body }` for a non-JSON body (`:524`), e.g. a Cloudflare HTML 5xx page.
  - `new PostgrestError` is constructed only when `throwOnError` is set (`:506`, `:527`). The class (`:26-55`) has `name`, `message`, `details`, `hint` and `code`.
  - The helper must therefore read the fields duck-typed and take `status` from the response (`:533-535`), because the error object has no `status`.
- Transport failures (fetch rejection, `:417-458`):
  - `message` is `` `${name}: ${message}` ``.
  - `details` holds the cause chain and stack (`:421-432`).
  - `code` is `""`.
  - `hint` is set for an abort/timeout (`:435-438`) or a header overflow (`:439-442`).
  - The response `status` is `0`.
- Retries (`fetchWithRetry`, `:196-232`):
  - 3 retries (`:62`) with 1 s / 2 s / 4 s backoff (`:71`), only for status 503 or 520 (`:77`) and only for GET/HEAD/OPTIONS (`:81-85`).
  - `.rpc()` and other POST/PATCH/DELETE requests are not retried.
  - This matches the probe's ~7 s on the profile GET during a 503 (audit §3, P4).
  - It can be disabled per query (`.retry(false)`) or per client (`db: { retry: false }`). The count and delays are fixed.

**Edge Functions** (`node_modules/@supabase/functions-js/dist/module/`)

- `FunctionsHttpError` (`types.js:67`) and `FunctionsRelayError` (`:52`):
  - Fixed messages, no `status` or `code` field.
  - `context` is the raw `Response`, thrown before any body read (`FunctionsClient.js:266-271`).
  - `context.status` and `headers` are readable without consuming the body.
- `FunctionsFetchError` (`types.js:37`): `context` is the fetch rejection (`FunctionsClient.js:263-264`). Its own `cause` and message live on `context`, not on `.cause`.
- `JSON.stringify(error)` renders a `Response` context as `{}`, so the helper has to pull `status` out explicitly.

**Auth** (`node_modules/@supabase/auth-js/dist/module/lib/errors.js`, `fetch.js`)

- `AuthError` (`errors.js:11`) has `name`, `message`, `status` and `code`.
- How `fetch.js` maps failures:
  - A fetch rejection becomes `AuthRetryableFetchError(msg, 0)`, keeping only the message string (`fetch.js:28`, `:115-120`).
  - A 5xx or 520-530 response becomes `AuthRetryableFetchError(msg, status)` (`:35-43`).
- `getUser()` (`GoTrueClient.js:2670-2725`):
  - With no token it returns `AuthSessionMissingError` (status 400) without a network call (`:2704-2706`). This is the anonymous case.
  - A network failure or 5xx returns `AuthRetryableFetchError`.

### 3. Which fields are safe to log

Codes reported to put user data in `details` or `message`:

- `23505`: `details` = `Key (email)=(…) already exists.`
- `23503`: `details` includes the key value.
- `23502`, `23514`, `23P01`: `details` = `Failing row contains (…)`, the whole row, which can include names, emails and amounts.
- `22P02`, `22007`, `22008`: `message` echoes the input.
- `P0001` (own raises): whatever the function puts there.
- A non-JSON 5xx body: the whole body lands in `message`.

These are Postgres/PostgREST behaviours **from the worker's knowledge, not verified against source here.**

Generally safe:

- `code`, always.
- `42501`, `42703`, `42P01`: object names only.
- `57014` and `PGRST001`/`PGRST002`: generic.
- `PGRST116` `details`: a row count.
- Transport `details`: stack, host, bundle paths.

Edge Function bodies are app-controlled: both functions reply `{ code }` only. Auth errors carry no tokens. Some GoTrue messages are reported to echo an email (unverified).

**Implication for the helper:** an allow-list approach, rather than "always keep `details`". For example:

- PostgREST: always `code` and response `status`; `message`, `details` and `hint` only for transport failures (`status` 0) or allow-listed codes.
- Auth: `name`, `status`, `code`.
- Functions: `name` plus `context.status`, or `context.name`/`context.message` for fetch errors.

This is a planning decision; see Open Questions.

### 4. Ids in scope at each mapper call site

- **Services take `(supabase, …ids)` and never receive the user.**
- `locals.user`, `locals.profile`, `locals.profileError` and `locals.locale` are typed in `src/env.d.ts:2-11` and set by `src/middleware.ts:12-35` on every request.
- Only `middleware.ts:33` and `pages/api/locale.ts:35` log a user id today.
- There is no request id: `cf-ray` / `x-request-id` have zero occurrences in `src`, `supabase/functions`, `tests` and `scripts`.

| Service           | Call sites → ids in scope                                                                                                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `projects.ts`     | `listProjects:352`, `listProjectExposure:389`, `listSupervisors:417`, `createProject:426` → none; `getProject:364`, `getProjectExposure:404`, `updateProject:432` → projectId; `listMilestones:378`, `createMilestone:446` → projectId; `updateMilestone:463` → projectId, milestoneId           |
| `employees.ts`    | `listEmployees:275-276` → ownerId (optional); `getEmployeeDetail:311-312`, `updateEmployee:370`, `inviteEmployee:405` → employeeId; `listOpenAssignments:341` → employeeId; `createEmployee:357` → none                                                                                          |
| `engagements.ts`  | `listEngagements:252,262` → milestoneId; `listAssignableEmployees:316-317` → ownerId, milestoneId; `isMilestoneInProject:338` → projectId, milestoneId; `createEngagement:351` → milestoneId (+ `input.employee_id`); `updateEngagement:368`, `deleteEngagement:384` → milestoneId, engagementId |
| `payouts.ts`      | `updateKpiScores:266` → projectId, milestoneId; `getMilestonePayout:284-285` → milestoneId                                                                                                                                                                                                       |
| `approvals.ts`    | `approveMilestone:269`, `getApprovedPayout:309-310`, `notifyMilestoneApproved:408` → milestoneId; `listMyBonuses:473` → none, `:477` → employeeId; `listEmployeeHistory:501` → employeeId                                                                                                        |
| `bonus-config.ts` | `listJobRoles:294`, `getBonusSettings:310`, `createJobRole:332`, `updateKpiSettings:360`, `updateRatingFactors:367` → none; `updateJobRole:338`, `setJobRoleArchived:353` → jobRoleId                                                                                                            |
| `reports.ts`      | `getBonusReport:43` → none (filter dates only)                                                                                                                                                                                                                                                   |

Callers of the notify service: `pages/api/projects/[id]/milestones/[milestoneId]/approve.ts:58` and `notify.ts:41`, both with `projectId` and `milestoneId` in scope.

### 5. Constraints on the helper

**Privacy and contract**

- Errors travel to the UI as codes in `?error=` and `?notice=` and are resolved per locale at render time. That contract must not change (`context/archive/2026-10-13-language-switch-pl-en/plan.md:14,53`).
- `42501` → `not_found` is a deliberate "no existence leak" rule:
  - Code comment: `projects.ts:296`.
  - Test comment: `approvals.test.ts:118-120`.
  - `context/archive/2026-10-12-navigate-to-employee-detail-and-history/plan-brief.md:40,77`.
- No figures or email addresses in logs:
  - `context/archive/2026-10-05-supervisor-approves-milestone-employee-sees-bonus/plan.md:102`
  - `context/foundation/infrastructure.md:94`
  - Duplicate-email messages never echo the email (`context/archive/2026-09-29-supervisor-assigns-employee-engagement/plan.md:53`, `research.md:398-401`).
- Outage logs include the user id (`context/archive/2026-09-25-role-and-rls-scaffold/plan.md:182`).

**Lint, hooks, mutation**

- `eslint.config.js`:
  - `no-console` is `"warn"` (`:25`). Every call site carries `// eslint-disable-next-line no-console -- intentional: …`.
  - `strictTypeChecked` and `stylisticTypeChecked` apply (`:18`).
  - `restrict-template-expressions` allows numbers only besides strings (`:36`).
  - `supabase/functions/` and `.claude/` are ignored (`:91-93`).
- Hooks: per edit, `eslint --quiet`, the UI check and `vitest related` (`.claude/hooks/check-edited-file.mjs:55-63`); at end of turn, the full unit suite and `astro check`.
- Unit tests run without the Astro pipeline, so the helper must not import `astro:*` (CLAUDE.md).
- Stryker mutates `src/lib/**/*.ts` excluding `src/lib/supabase.ts` (`stryker.config.mjs:12`), so a `src/lib` helper's branches need killing tests.

**Tests pinned to today's payload** (all in `src/lib/services/__tests__/`)

- Exact `{ code, message }` objects:
  - `projects.test.ts:66`
  - `employees.test.ts:68`
  - `engagements.test.ts:74`
  - `payouts.test.ts:68`
  - `bonus-config.test.ts:72`
  - `reports.test.ts:65-68`
  - `reports.test.ts:86` (its fixture already includes `details: ""` and `hint: ""` at `:84`)
- Message string pinned, payload `expect.any(Object)`: `approvals.test.ts:149`, `:217`.
- `not.toHaveBeenCalled()`: `bonus-config.test.ts:81`, `reports.test.ts:80`.
- No test spies on `console.warn`.
- Integration, e2e and smoke tests do not assert on log output.

## Code References

- `src/lib/services/projects.ts:283-308`: guard table, `mapPostgrestError`, `mapLoadError` (template for the other copies)
- `src/lib/services/approvals.ts:339-414`: `NOTIFY_ERROR_CODES`, `functionErrorCode`, `notifyMilestoneApproved` error handling
- `src/lib/services/employees.ts:376-411`: `INVITE_ERROR_CODES`, `functionErrorCode`, `inviteEmployee`
- `src/lib/services/reports.ts:16-19, 47-55`: load mapper and truncation log (added by aggregate-bonus-report F1)
- `src/middleware.ts:12-35`: locals population, the only profile-lookup log with a user id
- `src/env.d.ts:2-11`: `App.Locals` typing
- `src/types.ts:20`: `LoadErrorCode` (the only shared error-code type)
- `node_modules/@supabase/postgrest-js/dist/index.mjs:26-55, 196-232, 417-458, 504-535`: error class, retries, transport failures, plain-object error
- `node_modules/@supabase/functions-js/dist/module/FunctionsClient.js:239-271` and `types.js:13-67`: function errors and `context`
- `node_modules/@supabase/auth-js/dist/module/lib/errors.js:11-217`, `lib/fetch.js:22-120`, `GoTrueClient.js:2670-2725`: Auth errors and `getUser`
- `eslint.config.js:18, 25, 36, 91-93`; `stryker.config.mjs:12`; `.claude/hooks/check-edited-file.mjs:55-63`

## Architecture Insights

- **Errors are values.** Services return `{ data } | { error: code }`, and API routes redirect with the code. There are zero `throw`s in app code (audit §8). A helper can therefore stay a side-effect-only function called from inside the mappers; no exception-handling layer is needed.
- **Duplication is per-service by convention.** `ServiceResult`, `WriteResult` and the mappers are copied into each service (`approvals.ts:173-178`, `projects.ts:266-271`, …). `src/types.ts` holds only `LoadErrorCode`. The aggregate-bonus-report change followed that convention deliberately. A shared helper would be the first cross-service error module, a natural home being `src/lib/` (CLAUDE.md "Services/helpers go in `src/lib/`").
- **Two kinds of "expected" codes.** The mapping tables mix genuine domain rejections (`MR001`–`MR013` guard rules, `23505` duplicates) with codes that also signal regressions (`42501` missing grant or policy, `23514` / `MR014` already enforced by zod, `MR014` snapshot-invariant breach). The helper's log level or decision per code is where those two meanings can be separated.
- **Plain-object payloads.** Workers renders plain-object payloads inline. An `Error` with `cause` prints its stack and cause locally (audit P9). Production Workers Logs serialisation of nested Errors is unverified, so plain JSON-serialisable fields are the safe shape.

## Historical Context (from prior changes)

- `context/archive/2026-09-27-supervisor-creates-project-and-milestones/plan.md:328,331`: origin of the mapping table (`23505` → `duplicate_name`, `23514` → `rule_violation`, `42501` → `not_found`, `MRxxx` → catalog codes, the rest logged as `save_failed`; 0-row write → `not_found`). The plan states the mapping, not the reason.
- `context/archive/2026-09-25-role-and-rls-scaffold/plan.md:182`: decided to log query errors with user id, code and message so outages show in Workers Logs.
- `context/archive/2026-10-05-supervisor-approves-milestone-employee-sees-bonus/plan.md:102`: Edge Function logs carry the milestone id and counts only, no figures or emails.
- `context/archive/2026-10-13-language-switch-pl-en/plan.md:111`: failed side writes (`set_my_locale`) are logged and the request continues.
- `context/archive/2026-10-15-aggregate-bonus-report/reviews/impl-review.md:34-44` (F1): the most recent precedent of turning a silent condition into a logged `load_failed` under the "never hide the evidence" rule.
- `context/foundation/roadmap.md:72`: structured logging was explicitly not opened as a Foundation ("not required by any PRD NFR").

## Related Research

- `context/audits/observability/2026-10-15_projects-milestones-employees.md`: the audit this change implements step 1 of. Covers RC1 and RC4 and findings X1, X5, X6, M3, E4 and P6; partly M4, E6 and E8. The probe harness is in `.claude/worktrees/agent-a21ec667f2c72fffb` (`probe/suite.mjs`), usable for before/after proof.

## Open Questions

These are decisions for `/10x-plan`, not missing evidence.

1. **Field allow-list versus "keep everything":**
   - The change title asks to keep `details` and `hint`, but those fields carry PII for `23505`, `23503`, `23502`, `23514` and `22P02`.
   - Options include:
     - keep them only for transport failures (`status` 0) and allow-listed codes;
     - keep `details` and `hint` but redact key values;
     - drop them for the 23xxx and 22xxx classes.
2. **Log level per mapped code.** Which mapped codes become `warn`?
   - Candidates: `42501`, `23514`, `MR014`, unmapped function codes, function 4xx such as `forbidden`.
   - Should genuine domain rejections (`MR001`–`MR013`, `23505`) stay silent or become info-level?
3. **Where the user id comes from.** Options:
   - thread `userId` through every service signature;
   - pass a small context object (`{ userId, … }`);
   - log the user id only at the route level, keeping services id-only.
4. **Scope.**
   - Should this change also cover the Edge Function side (Deno, outside ESLint and `tsconfig`)?
   - What about the Auth routes (`signin`, `signup`, `confirm`, `set-password`, middleware `getUser`)?
   - Or only the Worker service mappers plus the two function wrappers?
5. **Request id.** Read `cf-ray` (header) now, or leave it to fix-order step 7?
6. **Test churn.** The 9 exact-payload assertions will be updated either way. Should the helper get its own unit tests with the service tests asserting via a shared matcher, or keep per-service exact payloads?

Unverified facts the plan should treat as assumptions:

- The exact Postgres `details` formats (worker knowledge).
- The GoTrue email-echo messages.
- How production Workers Logs serialise nested Errors.
