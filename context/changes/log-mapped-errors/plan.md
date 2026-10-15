# Shared Error-Logging Helper Implementation Plan

## Overview

Replace the 13 per-service copies of `mapLoadError` / `mapPostgrestError` logging and the two Edge Function wrapper logs with one shared module, `src/lib/error-log.ts`. The module logs a PII-free, allow-listed set of fields at a level that depends on what the code can mean:

- `error` for the unexpected fall-through;
- `warn` for codes that can also signal a deploy regression;
- silent for genuine domain rejections.

Every line carries the operation, entity ids, the user id and the cf-ray request id. User-facing error codes do not change.

This implements fix-order step 1 of `context/audits/observability/2026-10-15_projects-milestones-employees.md`. It closes X1, X5, X6, M3, E4 and P6, and partly P2 (0-row writes).

## Current State Analysis

All facts are from `context/changes/log-mapped-errors/research.md` at `d771e60`.

**Mappers today**

- `mapLoadError` has 7 identical copies, each logging `` `${context} failed` `` with `{ code, message }`:
  - `approvals.ts:201`
  - `bonus-config.ts:265`
  - `employees.ts:229`
  - `engagements.ts:216`
  - `payouts.ts:177`
  - `projects.ts:304`
  - `reports.ts:16`
- `mapPostgrestError` has 6 copies:
  - `projects.ts:293`
  - `bonus-config.ts:257`
  - `employees.ts:218`
  - `engagements.ts:205`
  - `payouts.ts:168`
  - `approvals.ts:192`

  All six return silently for `23505`, `23514`, `42501` and the `MRxxx` guard codes; only the fall-through logs.

- 0-row writes return `NOT_FOUND` without a log (`projects.ts:433,447,464`, `employees.ts:371`).

**Edge Function wrappers**

- `notifyMilestoneApproved` (`approvals.ts:391-414`) and `inviteEmployee` (`employees.ts:399-411`) map known function codes silently through `NOTIFY_ERROR_CODES` / `INVITE_ERROR_CODES`. They log only `{ name }` on the fall-through.
- `functionErrorCode` (`approvals.ts:350`, `employees.ts:386`) consumes the response body and swallows parse errors.

**Error shapes** (supabase-js 2.116.0)

- PostgREST errors are plain parsed objects. They have no `name`, and `status` lives only on the result (`postgrest-js/dist/index.mjs:512,524,533-535`).
- A transport failure has `code: ""`, the cause and stack in `details`, and `status: 0` (`:417-458`).
- Function errors keep the raw, unconsumed `Response` in `context` (`functions-js/dist/module/FunctionsClient.js:266-271`).
- Auth errors carry `name`, `status` and `code`.

**PII**

- `details` echoes key values (`23505`) or whole rows (`23514`, `23502`).
- `message` echoes input for 22xxx.
- A non-JSON body lands whole in `message`.
- Archived decisions forbid emails and figures in logs (`context/archive/2026-10-05-supervisor-approves-milestone-employee-sees-bonus/plan.md:102`, `context/foundation/infrastructure.md:94`).

**Context**

- Services take `(supabase, …entityIds)` and never the user.
- `locals.user` is set on every request (`src/middleware.ts:12-35`, typed in `src/env.d.ts:2-11`).
- About 47 service calls in 27 page/route files.
- No `cf-ray` is read anywhere.

**Tests**

- Exact `{ code, message }` payloads are pinned at:
  - `projects.test.ts:66`
  - `employees.test.ts:68`
  - `engagements.test.ts:74`
  - `payouts.test.ts:68`
  - `bonus-config.test.ts:72`
  - `reports.test.ts:65-68,86`
- `approvals.test.ts:149,217` pin the message string.
- No test spies on `console.warn`.

## Desired End State

- One module, `src/lib/error-log.ts`, owns error serialisation and logging. No service contains its own `console.*` call for Supabase or function errors.
- A failed or mapped Supabase call logs one line `"<operation> failed"`. Its payload is built from the allow-list below plus `operation` ids, `userId` and `requestId` when known. A mapped code adds `mappedTo: "<user code>"`.
- Levels follow the agreed table (Key Discoveries). User-facing codes, redirects and messages are byte-for-byte unchanged.
- Every page and route that calls a service passes `logContextFrom(locals, request)`.
- Verified by the helper's unit tests (Stryker-clean), the updated service tests and the full gates. The probe suite, rerun in the audit worktree, shows `status`, ids and `mappedTo` on the P6 / P6b / P6e / PEDGE lines.

### Key Discoveries:

**Field allow-list** (decided, "Allow-list by class")

- PostgREST-shaped errors:
  - always: `code` and the result `status`;
  - `message` unless `code` starts with `22`;
  - a raw non-JSON body (an error object with no `code` key) is logged as `message` truncated to 200 characters;
  - `details` and `hint` only when the failure is a transport one (`code === ""` or `status === 0`), or the code starts with `42`, is `57014`, or starts with `PGRST`.
- Auth errors (`__isAuthError`): `name`, `status`, `code`.
- Function errors:
  - `name`;
  - for Http/Relay: `status` and the body `code` (if JSON);
  - for Fetch: `causeName` / `causeMessage` from `context`.
- Non-object values: `{ name: typeof value }`.

**Levels** (decided, "Warn on regression codes")

- `warn`:
  - `42501`, `23514`, `MR014`;
  - a 0-row write;
  - function `forbidden`, `not_found`, `invalid_request` and any unmapped function code.
- `error`:
  - every unexpected fall-through (as today);
  - every function failure code (`invite_failed`, `notify_failed`, `send_failed`, `email_not_configured`);
  - every `mapLoadError` call;
  - the reports truncation.
- `silent` (genuine domain rejections): `23505`, `MR001`–`MR013` except `MR014`, `MR015`, and function `already_active`, `email_unavailable`, `not_approved`.
- `bonus-config.ts` keeps logging `42501` at `error` (it is unmapped there today) and adds `warn` for `23514`.

**Context**

- `LogContext = { userId?: string; requestId?: string }` arrives as an optional trailing `log?` argument on services (decided).
- `requestId` comes from the `cf-ray` header (decided). It is absent locally, where the field is simply omitted.

## What We're NOT Doing

- No change to user-facing error codes, flash URLs, messages, redirects or status codes. That includes `42501` → `not_found`, which stays (no existence leak).
- No Edge Function (Deno) changes. Their non-2xx logging (M2, E1, E6, E8) belongs to a later change.
- No Auth routes or middleware `getUser` handling (X2, X3, X4, E2, E5, E10). That is audit steps 2 and 5.
- No approval-outcome logging in `approve.ts` / `notify.ts` (M1). That is audit step 3.
- No new SQLSTATE for the `MR014` snapshot-invariant breach (M4 stays partly open; it is now warned instead of silent).
- No info-level logs for domain rejections, and no structured-logging library, tracker or `version_metadata`.
- No `x-request-id` propagation to Edge Functions (E7). `requestId` is logged in the Worker only.
- No change to postgrest-js retry behaviour (P4 latency observation).

## Implementation Approach

Build the helper first as a pure, fully unit-tested module with structural input types and no `astro:*` imports. Then move each service onto it file by file. Each mapper keeps its own code table (the code sets differ per service) but delegates logging, so the per-service knowledge of _which_ user code a DB code maps to stays where it is. Finally, thread the log context from the call sites. Each phase leaves the suite green: the services' new `log?` parameter is optional, so Phase 2 compiles before Phase 3 wires it.

## Critical Implementation Details

- **Status must be passed in, not read off the error.** PostgREST puts `status` on the result object only. Every mapper call site has to forward `result.status` (for example `const { data, error, status } = await …`). The helper treats `code === ""` as transport even when no status is given.
- **Read the function response before anything consumes it.** `readFunctionError` must read `context.status` and `clone()` the `Response` before the existing code path reads the body. The current `functionErrorCode` copies are replaced by it, so the body is read exactly once, from the clone.
- **Omit absent keys rather than logging `undefined`.** The payload must contain only the keys that have values, so test expectations stay exact and Workers Logs stay compact.

## Phase 1: Shared error-logging helper

### Overview

Create `src/lib/error-log.ts` with its unit tests. Nothing calls it yet.

### Changes Required:

#### 1. Helper module

**File**: `src/lib/error-log.ts`

**Intent**: One place that turns any Supabase or Edge Function error into an allow-listed, PII-free payload and writes it at the right level, with ids and request context.

**Contract** (structural types only, no `astro:*` import):

- `export interface LogContext { userId?: string; requestId?: string }`
- `export type LogIds = Partial<Record<"projectId" | "milestoneId" | "employeeId" | "engagementId" | "jobRoleId" | "ownerId", string>>`
- `export function logContextFrom(locals: { user: { id: string } | null }, request: Request): LogContext`: `userId` from `locals.user?.id`, `requestId` from the `cf-ray` header. Keys are omitted when absent.
- `export function errorFields(error: unknown, status?: number): Record<string, string | number>`: the allow-list from Key Discoveries.
- `export function logError(level: "error" | "warn", operation: string, error: unknown, meta?: { status?: number; ids?: LogIds; log?: LogContext; mappedTo?: string }): void`: writes `console[level](\`${operation} failed\`, { ...errorFields, ...ids, ...log, mappedTo })`, omitting absent keys.
- `export function mapLoadError(operation: string, error: unknown, meta?): LoadErrorCode`: `logError("error", …)` and returns `"load_failed"`. This replaces the 7 copies.
- `export interface FunctionErrorInfo { name: string; status?: number; code?: string; causeName?: string; causeMessage?: string }`
- `export async function readFunctionError(error: unknown): Promise<FunctionErrorInfo>`:
  - For `FunctionsHttpError` / `FunctionsRelayError`: `status = context.status`, and `code` from `await context.clone().json()` when that is an object with a string `code`. A parse failure leaves `code` undefined, without throwing.
  - For `FunctionsFetchError`: `causeName` / `causeMessage` from `context`.
  - Otherwise: `{ name }`.
- `export function logFunctionError(level, operation, info: FunctionErrorInfo, meta?)`: same payload rules, from the `info` fields.

Each `console.*` call carries `// eslint-disable-next-line no-console -- intentional: <reason>` per repo convention.

#### 2. Unit tests

**File**: `src/lib/__tests__/error-log.test.ts`

**Intent**: Pin the allow-list, the levels and the PII exclusions so that Stryker can kill the module's mutants.

**Contract** — cases:

- **PostgREST JSON error**: payload `{code, status, message}`.
- **PII exclusion**:
  - `23505` with `details: "Key (email)=(a@b.pl) already exists."`: no `details`, and the email is absent from the serialised payload.
  - `23514` with `details: "Failing row contains (…)"`: no `details`.
  - `22P02`: no `message`.
- **Transport failure** (`code: ""`, `status: 0`): `message`, `details` and `hint` all kept. The `code === ""` path without a status is kept too.
- **Safe-detail codes**: `42501`, `42703`, `57014`, `PGRST116` keep `details`/`hint`.
- **Raw non-JSON body** (`{ message: "<html>…" }` of 500 characters): `message` truncated to 200 characters.
- **Auth error**: `{name, status, code}` only.
- **Non-object values**: `null` and a string.
- **`logError`**: level routing (`warn` vs `error`), `mappedTo`, ids and `LogContext` merged, absent keys omitted.
- **`mapLoadError`**: returns `"load_failed"` and logs at error.
- **`logContextFrom`**: with and without a user, and with and without `cf-ray`.
- **`readFunctionError`**:
  - Http error with a JSON `{code}` body;
  - Http error with an HTML body (code undefined, no throw);
  - Relay error;
  - Fetch error with a TypeError context;
  - a non-function error;
  - the body is still readable from the original `Response` afterwards (clone used).
- **`logFunctionError`**: payload.

### Success Criteria:

#### Automated Verification:

- Helper unit tests pass: `npx vitest run src/lib/__tests__/error-log.test.ts`
- Full unit suite passes: `npm test`
- Lint and type check pass: `npm run lint` and `npx astro check`
- Mutation score for the helper is reviewed (no surviving mutants without a written reason): `npm run test:mutation -- --mutate src/lib/error-log.ts`

**Implementation Note**: After automated verification passes, continue to Phase 2 (no manual step in this phase).

---

## Phase 2: Migrate the service mappers and function wrappers

### Overview

Every service logs through the helper with the agreed levels, ids and optional log context. The service tests are updated to the new payloads, with new cases for each newly-warned code.

### Changes Required:

#### 1. Load mappers

**Files**: `src/lib/services/{approvals,bonus-config,employees,engagements,payouts,projects,reports}.ts`

**Intent**: Delete the 7 local `mapLoadError` copies and call the shared one with the result `status`, the ids in scope and `log`.

**Contract**:

- Call shape: `mapLoadError("<operation>", error, { status, ids: { … }, log })`. The operation names stay the same as the current `context` strings, so log messages are unchanged.
- The ids per call site are those in research §4. Examples:
  - `getProject` → `{ projectId }`
  - `listAssignableEmployees` → `{ ownerId, milestoneId }`
  - `listProjects` → none
- `reports.ts` truncation logs via `logError("error", "getBonusReport", { code: "truncated", message }, …)`, with the same message text as today.

#### 2. Write mappers

**Files**: the six `mapPostgrestError` copies (`projects.ts:293`, `bonus-config.ts:257`, `employees.ts:218`, `engagements.ts:205`, `payouts.ts:168`, `approvals.ts:192`)

**Intent**: Keep each service's code table and return values exactly as they are; add logging per the level table.

**Contract**:

- `mapPostgrestError(error, operation, meta)`, where `meta = { status?, ids?, log? }`.
- Behaviour:
  - `42501` / `23514` / `MR014` → `logError("warn", …, { mappedTo })`, then the same return as today.
  - `23505` and the other guard codes → return without logging.
  - Fall-through → `logError("error", …)` and `save_failed`.
- `bonus-config.ts`: `23514` warns. `42501` stays in the error fall-through, because it is unmapped there.

#### 3. 0-row writes

**Files**: `projects.ts:433,447,464`, `employees.ts:371`, plus any other `data.length === 0` → `NOT_FOUND` branch in `src/lib/services` (grep to confirm the full set).

**Intent**: Warn when an update matched no row, because that is either id tampering or an RLS regression.

**Contract**: `logError("warn", "<operation>", { code: "no_rows" }, { ids, log, mappedTo: "not_found" })`.

#### 4. Function wrappers

**Files**: `src/lib/services/approvals.ts:339-414`, `src/lib/services/employees.ts:376-411`

**Intent**: Replace both `functionErrorCode` copies with `readFunctionError`, then log with the status and code according to the level table. The returned user codes do not change.

**Contract**:

- `const info = await readFunctionError(error)`.
- If `info.code` is mapped:
  - `forbidden` / `not_found` / `invalid_request` → warn with `mappedTo`;
  - failure codes (`invite_failed`, `notify_failed`, `send_failed`, `email_not_configured`) → error with `mappedTo`;
  - `already_active` / `email_unavailable` / `not_approved` → silent.
- Unmapped code, non-Http error, or Fetch/Relay error → `logFunctionError("error", …)`. Today's fall-through return stays.
- `ids`: `{ milestoneId }` or `{ employeeId }`.

#### 5. Optional log context on services

**Files**: every exported service function that reaches a mapper or a function wrapper (the research §4 table)

**Intent**: Accept `log?: LogContext` as the last parameter and forward it.

**Contract**: The trailing optional `log?: LogContext` is the only signature change. Existing callers compile unchanged.

#### 6. Service tests

**Files**: `src/lib/services/__tests__/{projects,employees,engagements,payouts,approvals,bonus-config,reports}.test.ts`

**Intent**: Keep proving real end-to-end output with console spies, updated to the new payload shape, and pin each newly-warned code.

**Contract**:

- Add a `console.warn` spy next to the existing `console.error` spy.
- Update the exact assertions listed in Current State to include `status` and ids.
- New cases per service:
  - `42501` warns with `mappedTo: "not_found"` and returns the same code;
  - `23514` warns;
  - `MR014` warns (projects, approvals);
  - `23505` and a domain guard code log nothing;
  - 0-row update warns;
  - function `forbidden` / `not_found` / `invalid_request` warn with status;
  - function failure code errors with status;
  - an unmapped HTML 502 errors with status 502;
  - a Fetch error logs `causeName`;
  - a passed `log` context appears in the payload.

### Success Criteria:

#### Automated Verification:

- Service tests pass: `npx vitest run src/lib/services/__tests__`
- Full unit suite passes: `npm test`
- No service keeps its own console call: `grep -rn "console\." src/lib/services` returns nothing
- Lint and type check pass: `npm run lint` and `npx astro check`
- Mutation score for the migrated services is reviewed: `npm run test:mutation -- --mutate "src/lib/services/*.ts"`

**Implementation Note**: After automated verification passes, continue to Phase 3 (no manual step in this phase).

---

## Phase 3: Wire the call sites and verify end to end

### Overview

Every page and route passes the log context, then the change is proved against a running build.

### Changes Required:

#### 1. Pages and API routes

**Files**: the 27 files under `src/pages` that import from `@/lib/services/` (the full list is `grep -rl 'from "@/lib/services/' src/pages`)

**Intent**: Give every service call the user id and request id.

**Contract**:

- Pages: `const log = logContextFrom(Astro.locals, Astro.request)` once in the frontmatter.
- Routes: `logContextFrom(context.locals, context.request)` once per handler.
- Pass `log` as the last argument to every service call (about 47 calls).
- No other changes to these files.

#### 2. Probe before/after

**Location**: the audit worktree `.claude/worktrees/agent-a21ec667f2c72fffb`

**Intent**: Prove with the same harness that the previously poor lines now carry `status`, ids, `userId` and `mappedTo`.

**Contract**:

- In the worktree: bring in this change's commits, then `python probe/inject.py`, `npm run build`, `node probe/suite.mjs`.
- Compare `probe/results.md` against the audit's §3 rows P6, P6b, P6e and PEDGE*.
- No commits from the worktree.

### Success Criteria:

#### Automated Verification:

- Full unit suite passes: `npm test`
- Lint, UI check and type check pass: `npm run lint`, `npm run lint:ui`, `npx astro check`
- Production build passes: `npm run build`
- Smoke passes against a local server: `npm run smoke`
- Every service call in pages passes a log context: `grep -rn "logContextFrom" src/pages | wc -l` is at least the number of files that import a service

#### Manual Verification:

- The probe suite rerun in the audit worktree shows `status`, the entity id and `userId` on P6, P6e and P6b, and status plus code on PEDGE404 / PEDGE500 (which now differ from each other).
- In `npm run dev`, a forced `42501` (or an id from another supervisor on a write) prints one `warn` line with `mappedTo: "not_found"`, while the UI still shows the same "Not found" message.
- No email address or row values appear in any line produced during the smoke run.

**Implementation Note**: After automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- **Helper:**
  - the allow-list per error class;
  - PII exclusion (`23505` email in `details`, `23514` row, `22P02` input);
  - transport keeps `details`/`hint`;
  - safe-code details;
  - raw-body truncation;
  - level routing;
  - `mappedTo`;
  - id and context merge;
  - omission of absent keys;
  - `readFunctionError` for Http (JSON and HTML), Relay and Fetch, with the clone leaving the body readable;
  - `logContextFrom`.
- **Services:**
  - exact payloads for the existing fall-through cases, now with `status` and ids;
  - new warn cases (`42501`, `23514`, `MR014`, 0-row, function `forbidden`/`not_found`/`invalid_request`);
  - silent domain cases (`23505`, guard codes, `already_active`, etc.);
  - function failure codes and HTML 5xx at error with status.

### Integration Tests:

- Smoke run against a local server; it must still pass, since user-visible behaviour is unchanged.
- Probe suite rerun in the audit worktree for before/after evidence.

### Manual Testing Steps:

1. In `npm run dev`, try saving another supervisor's project via a crafted POST and confirm a single `warn` line with `mappedTo: "not_found"` and the user id.
2. Stop local Supabase briefly, load `/projects`, and confirm the `listProjects failed` line now shows `status: 0` and a cause in `details`.
3. Rerun the probe suite and compare it with the audit's §3.

## Performance Considerations

One extra `Response.clone()` per failed function call, and a constant-size payload build per logged error. There is no effect on the success path.

## Migration Notes

The code refactor is in-process only: no schema, data or contract changes. Rollback is a revert.

## References

- Research: `context/changes/log-mapped-errors/research.md`
- Audit: `context/audits/observability/2026-10-15_projects-milestones-employees.md` (RC1, RC4, fix order step 1)
- Mapper template: `src/lib/services/projects.ts:283-308`; function wrappers: `src/lib/services/approvals.ts:339-414`, `src/lib/services/employees.ts:376-411`
- Privacy precedents: `context/archive/2026-10-05-supervisor-approves-milestone-employee-sees-bonus/plan.md:102`, `context/foundation/infrastructure.md:94`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared error-logging helper

#### Automated

- [x] 1.1 Helper unit tests pass: `npx vitest run src/lib/__tests__/error-log.test.ts` — 7e940e5
- [x] 1.2 Full unit suite passes: `npm test` — 7e940e5
- [x] 1.3 Lint and type check pass: `npm run lint` and `npx astro check` — 7e940e5
- [x] 1.4 Mutation score for the helper is reviewed (no surviving mutants without a written reason): `npm run test:mutation -- --mutate src/lib/error-log.ts` — 7e940e5

### Phase 2: Migrate the service mappers and function wrappers

#### Automated

- [x] 2.1 Service tests pass: `npx vitest run src/lib/services/__tests__` — e81b09f
- [x] 2.2 Full unit suite passes: `npm test` — e81b09f
- [x] 2.3 No service keeps its own console call: `grep -rn "console\." src/lib/services` returns nothing — e81b09f
- [x] 2.4 Lint and type check pass: `npm run lint` and `npx astro check` — e81b09f
- [x] 2.5 Mutation score for the migrated services is reviewed: `npm run test:mutation -- --mutate "src/lib/services/*.ts"` — e81b09f

### Phase 3: Wire the call sites and verify end to end

#### Automated

- [x] 3.1 Full unit suite passes: `npm test` — e5efacc
- [x] 3.2 Lint, UI check and type check pass: `npm run lint`, `npm run lint:ui`, `npx astro check` — e5efacc
- [x] 3.3 Production build passes: `npm run build` — e5efacc
- [x] 3.4 Smoke passes against a local server: `npm run smoke` — e5efacc
- [x] 3.5 Every service call in pages passes a log context: `grep -rn "logContextFrom" src/pages | wc -l` is at least the number of files that import a service — e5efacc

#### Manual

- [x] 3.6 The probe suite rerun in the audit worktree shows `status`, the entity id and `userId` on P6, P6e and P6b, and status plus code on PEDGE404 / PEDGE500 (which now differ from each other) — e5efacc
- [x] 3.7 In `npm run dev`, a forced `42501` (or an id from another supervisor on a write) prints one `warn` line with `mappedTo: "not_found"`, while the UI still shows the same "Not found" message — e5efacc
- [x] 3.8 No email address or row values appear in any line produced during the smoke run — e5efacc
