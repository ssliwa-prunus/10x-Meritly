# Move remaining direct console.error calls onto the shared helper — Implementation Plan

## Overview

The log-mapped-errors change routed every Supabase and Edge Function error in the services through `logError` / `mapLoadError` (`src/lib/error-log.ts`). Six direct `console.error` calls in `src` still bypass it. That means they skip the helper's PII allow-list, including the class-22 `message` drop, and they log no `status`, `requestId` and, at sign-in, no user id. This change moves all six onto `logError`. Five of them keep their log line text. Redirects, the middleware 503 and every other user-facing behaviour stay unchanged. Source: review F4 (`context/changes/log-mapped-errors/reviews/impl-review.md:105-112`).

## Current State Analysis

Direct calls at de10bb4 (`research.md`, Summary). The only other `console.*` calls are the helper's own writes at `error-log.ts:141,144`.

| Site                                                         | Today                                                     | Error value |
| ------------------------------------------------------------ | --------------------------------------------------------- | ----------- |
| `src/middleware.ts:34`                                       | `Profile lookup failed {userId, code, message}`           | PostgREST   |
| `src/pages/api/auth/signin.ts:33`                            | `set_my_locale at sign-in failed {code, message}`         | PostgREST   |
| `src/pages/api/locale.ts:35`                                 | `set_my_locale failed {userId, code, message}`            | PostgREST   |
| `src/pages/api/auth/set-password.ts:23`                      | `Set password failed {status, code}`                      | AuthError   |
| `src/pages/api/reports/bonuses.csv.ts:24`                    | `bonus report CSV: Supabase is not configured`            | none        |
| `src/pages/projects/[id]/milestones/[milestoneId].astro:105` | `Approved milestone has no snapshot header {milestoneId}` | none        |

## Desired End State

- No `console.*` call remains in non-test `src` code outside `src/lib/error-log.ts`, and no `eslint-disable … no-console` comment remains outside it either.
- Each of the six sites calls `logError("error", …)` with `log` request context (`userId` where a user exists, `requestId` from `cf-ray`). The PostgREST sites also pass the result `status`.
- Line texts:
  - Unchanged for the first four sites (`` `${operation} failed` `` reproduces them).
  - The two message-only sites change to `bonus report CSV failed {code: "not_configured", …}` and `getApprovedPayoutHeader failed {code: "no_snapshot_header", milestoneId, …}`.
- Behaviour is unchanged: the same redirects, the same 503 from the middleware, the same CSV `500 not_configured`, the same `load_failed` on the milestone page. The smoke and E2E suites still pass.

### Key Discoveries:

- `logError` writes `` `${operation} failed` `` (`src/lib/error-log.ts:138-151`), so choosing the operation name equal to today's prefix keeps the text.
- PostgREST errors carry no `status`; it must be read from the result and passed as `meta.status` (`error-log.ts:34-35,101-118`). Without it, a transport failure (status 0) loses `details`/`hint` (`error-log.ts:74-76`).
- `logContextFrom(locals, request)` (`error-log.ts:163-170`) gives `userId` from `locals.user` and `requestId` from `cf-ray`.
  - In the middleware, `locals.user` is set at `src/middleware.ts:21`, before the lookup.
  - At sign-in it is still `null` (the middleware ran before `signInWithPassword`, `signin.ts:18`).
- Synthetic-error precedent: `logError("warn", operation, { code: "no_rows" }, …)` at `src/lib/services/bonus-config.ts:273-275`. A plain object with a string `code` is logged as `{code, …context}` (`error-log.ts:101-118`).
- Auth errors log `{name, status, code}` and never `message` (`error-log.ts:127-129`), a strict superset of today's `set-password` payload.
- These sites aren't unit-testable: `@/lib/supabase` imports `astro:env/server`, and the middleware imports `astro:middleware` (CLAUDE.md, `npm test`). The helper's behaviour is pinned by `src/lib/__tests__/error-log.test.ts`.
- `no-console` is `"warn"` for app code (`eslint.config.js:25`).

## What We're NOT Doing

- **X2:** the middleware still ignores the `getUser()` error (`src/middleware.ts:18-20`), and no 503 is added on Auth outage. That goes in its own change.
- **Sentry:** `logError` does not report to Sentry. That goes in its own change.
- **E10, second half:** no new log for the follow-up `signInWithPassword` failure in `set-password.ts:31-34`. Only the existing line moves.
- No change to `src/lib/error-log.ts`, its tests, any service, any user-facing code or message, or any status code.
- No change under `supabase/` (the 15 `console` calls in Edge Functions are a different runtime and out of scope).
- No new behaviour for a missing Supabase config (X3) beyond the CSV line's new shape.

## Implementation Approach

A mechanical swap at each site that follows the services' pattern: build `log` once with `logContextFrom`, keep the result's `status`, and call `logError("error", <operation>, error, { status, log })`. Each removed `console.error` takes its `eslint-disable-next-line no-console` comment with it. Level stays `"error"` everywhere, matching today. Phase 1 covers the sites that log a real error value. Phase 2 covers the two message-only sites, which use synthetic codes, and adds the repo-wide guard.

## Phase 1: Sites that log an error value

### Overview

Move the profile lookup, both `set_my_locale` saves and the set-password update onto `logError`. Line text stays the same, and `status`, `requestId` and `userId` are added.

### Changes Required:

#### 1. Middleware profile lookup

**File**: `src/middleware.ts`

**Intent**: Log the failed profile query through the helper, so the PostgREST allow-list applies and the line gains `status` and `requestId`. The user id comes from `locals.user`, which is already set. `profileError = true` and the resulting 503 stay as they are.

**Contract**: Destructure `status` alongside `{ data, error }` from the `profiles` query (`:25-29`). In the error branch, call `logError("error", "Profile lookup", error, { status, log: logContextFrom(context.locals, context.request) })`. The import comes from `@/lib/error-log`.

#### 2. Locale save at sign-in

**File**: `src/pages/api/auth/signin.ts`

**Intent**: Log a failed `set_my_locale` through the helper, with the signed-in user's id taken from the sign-in result. `locals.user` is still null at this point. Sign-in must never be blocked.

**Contract**:

- Destructure `data` (alongside `error`) from `signInWithPassword` (`:18`) and `status` from the `set_my_locale` RPC result (`:30`).
- Call `logError("error", "set_my_locale at sign-in", localeError, { status, log: { ...logContextFrom(context.locals, context.request), userId: data.user?.id } })`.
- `compact` drops an undefined `userId` (`error-log.ts:55-61`).

#### 3. Language switch

**File**: `src/pages/api/locale.ts`

**Intent**: Same move for the language-switch save. `locals.user` is set on this path, so `logContextFrom` supplies the id.

**Contract**:

- The ternary at `:32` must carry `status` on both branches: keep the RPC result whole, and give the no-client fallback `{ error: null }` a `status` field or restructure it.
- Call `logError("error", "set_my_locale", error, { status, log: logContextFrom(context.locals, context.request) })`.

#### 4. Set password

**File**: `src/pages/api/auth/set-password.ts`

**Intent**: Log the Auth update failure through the helper, so it gains `name`, `userId` and `requestId`. `message` stays excluded, as the helper does for Auth errors. The redirect stays `update_failed`.

**Contract**: Call `logError("error", "Set password", error, { log: logContextFrom(context.locals, context.request) })` at `:21-24`. There is no `status` meta, because Auth errors carry their own `status` (`error-log.ts:127-129`). The follow-up sign-in failure at `:31-34` is left unlogged (out of scope).

### Success Criteria:

#### Automated Verification:

- No `console.` call remains in `src/middleware.ts`, `src/pages/api/auth/signin.ts`, `src/pages/api/locale.ts`, `src/pages/api/auth/set-password.ts`
- Lint passes: `npm run lint`
- Type check passes: `npx astro sync && npx astro check`
- Unit tests pass: `npm test`
- Build passes: `npm run build`

#### Manual Verification:

- With the probe harness (`.claude/worktrees/agent-a21ec667f2c72fffb`, `node probe/suite.mjs`) or an equivalent forced PostgREST failure on `profiles`, the 503 is unchanged and the Workers line reads `Profile lookup failed { code, status, userId, … }` (plus `requestId` when a `cf-ray` header is sent)
- Sign-in, language switch (signed in and signed out) and set-password behave as before in the running app

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Message-only sites and the guard

### Overview

Move the two logs that carry no error value onto `logError` with synthetic codes, so every log line in `src` goes through the helper. Then check that no direct call remains and that behaviour is unchanged end to end.

### Changes Required:

#### 1. CSV export without Supabase config

**File**: `src/pages/api/reports/bonuses.csv.ts`

**Intent**: Log the missing configuration through the helper with the `log` already built at `:21`, so the line gains `userId` and `requestId`. The response stays `500 not_configured`.

**Contract**: At `:22-25`, call `logError("error", "bonus report CSV", { code: "not_configured" }, { log })`. The line text becomes `bonus report CSV failed {code: "not_configured", …}`.

#### 2. Approved milestone without snapshot header

**File**: `src/pages/projects/[id]/milestones/[milestoneId].astro`

**Intent**: Log the broken invariant through the helper with the milestone id and the `log` already built at `:55`. The operation is named after the header read that came back empty, matching the service's own `getApprovedPayoutHeader` log (`src/lib/services/approvals.ts:329`), so one search finds both. The page still shows `load_failed`.

**Contract**:

- At `:101-106`, call `logError("error", "getApprovedPayoutHeader", { code: "no_snapshot_header" }, { ids: { milestoneId: milestoneId.data }, log })`.
- Keep the explanatory comment about the invariant and drop the `eslint-disable` line.
- Add the `logError` import next to `logContextFrom` (`:13`).

### Success Criteria:

#### Automated Verification:

- Guard: this command prints nothing: `grep -rnE "console\.|no-console" src --include=*.ts --include=*.tsx --include=*.astro | grep -v "\.test\.ts" | grep -v "^src/lib/error-log\.ts:"`
- Lint passes: `npm run lint`
- UI literal check passes: `npm run lint:ui`
- Type check passes: `npx astro sync && npx astro check`
- Unit tests pass: `npm test`
- Build passes: `npm run build`
- Smoke passes against the preview with local Supabase: `npm run smoke`
- E2E passes: `npm run test:e2e`

#### Manual Verification:

- The CSV export without Supabase config (empty `SUPABASE_URL` in `.dev.vars`) still answers `500 not_configured` and logs `bonus report CSV failed { code: "not_configured", … }`
  - _Review note (impl-review F1):_ this can't be observed over HTTP. Without config, `createClient` returns `null`, so there's no user, and the middleware redirects `/api/reports` (a protected route) to sign-in before the handler runs. The branch and its line are correct by lint and the type check only. Queued for X3 in `follow-ups/review-fixes.md`.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- None added. The six sites import `astro:*` modules and can't load under the plain Vitest config. The helper's field rules are already covered by `src/lib/__tests__/error-log.test.ts`: the class-22 drop (`:80-82`), Auth fields and the synthetic `{ code }` shape through the `no_rows` service tests (`src/lib/services/__tests__/bonus-config.test.ts:172-176`).

### Integration Tests:

- Smoke and E2E cover sign-in, the language switch, role gating (middleware) and the milestone page. They prove the behaviour didn't change. They don't assert on log output.

### Manual Testing Steps:

1. Rerun probe P4 (profile lookup fails → 503) and compare its Workers line with `probe/results.md`: the same text, plus `status` and `requestId`.
2. In the running app, sign in, switch the language both ways, and complete an invite set-password. All of them redirect as before.
3. Blank `SUPABASE_URL` in `.dev.vars`, request `/api/reports/bonuses.csv`, and check the 500 response and the new line.

## Performance Considerations

None. Each site makes the same single log call.

## Migration Notes

Saved Workers Logs searches on `bonus report CSV: Supabase is not configured` or `Approved milestone has no snapshot header` must switch to `bonus report CSV failed` / `getApprovedPayoutHeader failed` with the `code` field.

## References

- Research: `context/changes/f4-console-error-helper/research.md`
- Origin: `context/changes/log-mapped-errors/reviews/impl-review.md:105-112`, `context/changes/log-mapped-errors/follow-ups/review-fixes.md:5-20`
- Helper: `src/lib/error-log.ts:101-170`
- Synthetic-code precedent: `src/lib/services/bonus-config.ts:273-275`
- Audit: `context/audits/observability/2026-10-15_projects-milestones-employees.md` (X2, X3, E10 stay open)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Sites that log an error value

#### Automated

- [x] 1.1 No `console.` call remains in middleware, signin, locale and set-password — db9e04e
- [x] 1.2 Lint passes — db9e04e
- [x] 1.3 Type check passes — db9e04e
- [x] 1.4 Unit tests pass — db9e04e
- [x] 1.5 Build passes — db9e04e

#### Manual

- [x] 1.6 Probe P4 shows unchanged 503 and the new Profile lookup payload — db9e04e
- [x] 1.7 Sign-in, language switch and set-password behave as before — db9e04e

### Phase 2: Message-only sites and the guard

#### Automated

- [x] 2.1 Guard grep finds no console call or no-console disable outside error-log.ts — 32cf67d
- [x] 2.2 Lint passes — 32cf67d
- [x] 2.3 UI literal check passes — 32cf67d
- [x] 2.4 Type check passes — 32cf67d
- [x] 2.5 Unit tests pass — 32cf67d
- [x] 2.6 Build passes — 32cf67d
- [x] 2.7 Smoke passes — 32cf67d
- [x] 2.8 E2E passes — 32cf67d

#### Manual

- [x] 2.9 CSV export without config answers 500 not_configured and logs the new line — 32cf67d
