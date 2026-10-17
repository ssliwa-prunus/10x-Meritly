---
date: 2026-10-17T18:25:31+02:00
researcher: Claude (Opus 5.5) for ssliwa
git_commit: de10bb4
branch: develop
repository: 10x-Meritly
topic: "F4: move the remaining direct console.error calls onto the shared helper"
tags: [research, observability, error-log, middleware, auth, locale]
status: complete
last_updated: 2026-10-17
last_updated_by: Claude (Opus 5.5) for ssliwa
---

# Research: move the remaining direct `console.error` calls onto the shared helper

**Date**: 2026-10-17T18:25:31+02:00
**Researcher**: Claude (Opus 5.5) for ssliwa
**Git Commit**: de10bb4 (clean tree)
**Branch**: develop
**Repository**: 10x-Meritly

## Research Question

F4 from `context/changes/log-mapped-errors/reviews/impl-review.md:105-112`, queued in
`context/changes/log-mapped-errors/follow-ups/review-fixes.md:5-20`: which `console.error` calls in
`src` still bypass `logError` / `mapLoadError` (`src/lib/error-log.ts`), what each one would log
through the helper, and what moving them changes.

## Summary

- **The follow-up names 3 sites, but `src` has 6 direct `console.error` calls outside the helper** (non-test `.ts`/`.tsx`/`.astro` under `src`, grep at de10bb4). The only other `console.*` calls are the helper's own 2 writes, `src/lib/error-log.ts:141,144`.
  - Named in F4, each logs a Supabase error's `message` directly:
    - `src/middleware.ts:34` (profile lookup)
    - `src/pages/api/auth/signin.ts:33` (`set_my_locale` at sign-in)
    - `src/pages/api/locale.ts:35` (`set_my_locale`)
  - Not named in F4:
    - `src/pages/api/auth/set-password.ts:23` logs an Auth error as `{status, code}`, which is already PII-safe but has no context.
    - `src/pages/api/reports/bonuses.csv.ts:24` and `src/pages/projects/[id]/milestones/[milestoneId].astro:105` log a message with no error object.
- **`logError` already fits the 3 named sites as-is.**
  - The line text stays the same: the helper writes `` `${operation} failed` `` (`error-log.ts:141,144`), so the operations `"Profile lookup"`, `"set_my_locale at sign-in"` and `"set_my_locale"` reproduce today's text.
  - The payload changes:
    - `status` and `requestId` are added (`error-log.ts:110-117,163-170`).
    - `message` is dropped for class-22 codes (`error-log.ts:114`).
    - `details`/`hint` are kept for transport, 42xxx, 57014 and PGRST codes (`error-log.ts:74-76`).
- **`status` is not on the error object.** Each call site has to destructure it from the PostgREST result and pass it as `meta.status`, as the 34 service mapper call sites already do (`impl-review.md:29`). Without it, a transport failure (status 0) loses its `details` (`error-log.ts:75`).
- **No helper change is needed for the 3 named sites, and no unit test can cover them directly.** Middleware and API routes import `astro:*` modules (`@/lib/supabase` uses `astro:env/server`), which the plain Vitest config can't load (CLAUDE.md, `npm test`). The helper's behaviour is already pinned by `src/lib/__tests__/error-log.test.ts`, for example the class-22 case at `:80-82`.
- **Sentry is not involved.** `sentry.server.config.ts:11-20` sets no `captureConsoleIntegration`, and `error-log.ts` does not import Sentry. Moving onto the helper changes only what reaches Workers Logs, not Sentry.

## Detailed Findings

### The shared helper (`src/lib/error-log.ts`)

- `logError(level, operation, error, meta?)` (`:149-151`) writes `` `${operation} failed` `` with `errorFields(error, meta.status)` plus `meta.ids`, `meta.log` (`userId`, `requestId`) and `mappedTo` (`:134-136`).
- `errorFields` (`:125-132`) has three branches:
  - Auth errors become `{name, status, code}` (`:127-129`).
  - Function errors become their info (`:130`).
  - Anything else goes through the PostgREST rules (`:101-119`).
- `logContextFrom(locals, request)` (`:163-170`) reads `locals.user?.id` and `cf-ray`, capped at 64 chars.
- There is precedent for logging a condition with no error object: `bonus-config.ts:273-275` passes a synthetic `{ code: "no_rows" }`. For a plain `object`, `postgrestFields` keeps `code` and drops nothing else (`:101-118`).
- There is also precedent for a call without `meta`: `src/lib/request-body.ts:22`. That file is already used by the middleware (`middleware.ts:3,60`).

### Site 1: `src/middleware.ts:31-35`, profile lookup (named in F4)

- Today it logs `{ userId: user.id, code, message }` and sets `profileError = true`. The 503 comes from `decideAccess` (`:53-67`).
- `locals.user` is assigned at `:21`, before the lookup, so `logContextFrom(context.locals, context.request)` at `:31` yields `userId` and `requestId`. The follow-up's "pass the user id" (`review-fixes.md:17`) is met by `logContextFrom` with no extra argument.
- The query result at `:25-29` destructures only `{ data, error }`. To log it, `status` has to be added to that destructuring.
- Class-22 exposure is low on this path. The only filter is `.eq("id", user.id)` with an Auth-issued UUID, so a `22P02` echo is not expected (inference).
- The audit observed this exact line under a PostgREST 503: `Profile lookup failed {userId, code: 'PGRST001', message}` (audit §3 P4). A PGRST code satisfies `detailsAreSafe` (`error-log.ts:75`), so the helper would also keep `details`/`hint` there.
- The `eslint-disable-next-line no-console` comment at `:33` goes away. `no-console` is `"warn"` for app code (`eslint.config.js:25`; it's turned off only for `scripts/**/*.mjs`, `:73-77`).

### Site 2: `src/pages/api/auth/signin.ts:30-34`, `set_my_locale` at sign-in (named in F4)

- Today it logs `{ code, message }` with no user id. Sign-in is never blocked.
- `context.locals.user` is still `null` here, because the middleware ran before `signInWithPassword` at `:18`. `logContextFrom` would therefore yield only `requestId`. A user id is available only from the `data.user` of the `signInWithPassword` result, which the route doesn't destructure today (`:18`). Whether to include it is a plan choice (see Open Questions).
- `set_my_locale` raises `42501` only when `auth.uid()` is null (`supabase/migrations/20261013120000_profiles_locale.sql:22-25`). A bad value would hit the check constraint `23514` (`:11-13`), but `parseLocale` already restricts the input (`signin.ts:28`).

### Site 3: `src/pages/api/locale.ts:30-41`, `set_my_locale` (named in F4)

- Today it logs `{ userId, code, message }`.
- `locals.user` is set on this path (the call is guarded by `:30`), so `logContextFrom` gives `userId` and `requestId`.
- The result is built by a ternary, `supabase ? await supabase.rpc(…) : { error: null }` (`:32`). Passing `status` needs that fallback object to carry it, or the result to be kept whole.
- The locale is zod-validated (`:11-13,24`), so class-22 or 23514 errors are not expected.

### Sites outside the F4 list (same pattern, different shape)

- `src/pages/api/auth/set-password.ts:21-24`: `{ status, code }` from an `AuthError`. Through the helper this becomes `{name, status, code}` plus `userId`/`requestId`, a strict superset with no `message` (`error-log.ts:127-129`). The audit's E10 (`audits/…:190`) asks for user id plus message on this path, and also for a log on the unlogged `signInWithPassword` failure at `:31-34`. That second part is a new log line, not a migration.
- `src/pages/api/reports/bonuses.csv.ts:22-25`: no error object, and `log` is already computed at `:21`. A migration would need a synthetic code such as `{ code: "not_configured" }`, which changes the line text from `"bonus report CSV: Supabase is not configured"` to `"<operation> failed"`. This is the only logged occurrence of audit X3.
- `src/pages/projects/[id]/milestones/[milestoneId].astro:101-106`: an invariant breach with no error object, logged as `{ milestoneId }`. This would also need a synthetic code plus `ids.milestoneId`. A `log` variable is already in scope on this page (`:110` passes it).

### Tests and verification surface

- No unit test covers any of the 6 sites. The `src` test files that reference `console` are the service tests, `error-log.test.ts` and `request-body.test.ts` (grep at de10bb4).
- `tests/e2e/*` and `scripts/smoke.mjs` don't assert on console output (grep at de10bb4). They exercise these paths (sign-in, language switch, middleware) only for behaviour, which must stay unchanged.
- The log-mapped-errors change verified route-level logging by hand, using the probe harness in `.claude/worktrees/agent-a21ec667f2c72fffb/probe/` (`impl-review.md:39-41`). Its P4 probe (profile lookup → 503) covers Site 1.

## Code References

- `src/lib/error-log.ts:74-76`: `detailsAreSafe` (transport, 42xxx, 57014, PGRST)
- `src/lib/error-log.ts:101-119`: PostgREST field allow-list, including class-22 `message` drop
- `src/lib/error-log.ts:149-151`: `logError`
- `src/lib/error-log.ts:163-170`: `logContextFrom`
- `src/lib/services/bonus-config.ts:273-275`: synthetic-error precedent (`{ code: "no_rows" }`)
- `src/lib/request-body.ts:22`: `logError` without meta, already imported by the middleware
- `src/middleware.ts:17-38`: `getUser` and profile lookup; direct log at `:34`
- `src/pages/api/auth/signin.ts:27-35`: locale save at sign-in; direct log at `:33`
- `src/pages/api/locale.ts:30-41`: locale save; direct log at `:35`
- `src/pages/api/auth/set-password.ts:20-34`: Auth update log at `:23`; unlogged follow-up sign-in at `:31-34`
- `src/pages/api/reports/bonuses.csv.ts:20-26`: not-configured log
- `src/pages/projects/[id]/milestones/[milestoneId].astro:101-106`: missing snapshot header log
- `sentry.server.config.ts:11-20`: Sentry init without console capture
- `supabase/migrations/20261013120000_profiles_locale.sql:11-31`: `set_my_locale` (42501 when unauthenticated; check constraint 23514)

## Architecture Insights

- The convention after log-mapped-errors: every Supabase or function error goes through `logError` / `mapLoadError` / `logFunctionError` with `status` from the result and `log = logContextFrom(locals, request)`. In `src`, only these 6 sites diverge.
- The helper owns the PII allow-list. A direct `console.error` is therefore both a consistency gap and the one place where a future error shape could leak input. That is the reason F4 cites the class-22 filter (`review-fixes.md:11-12`).
- Levels: the 3 named sites are failures that never block the user (locale) or that become a 503 (profile). The follow-up prescribes `"error"` for all 3 (`review-fixes.md:15`).

## Historical Context (from prior changes)

- `context/changes/log-mapped-errors/plan.md:126` put the Auth routes and middleware `getUser` handling out of scope (audit X2, X3, X4, E2, E5, E10). That is why these sites remained. **Still accurate.**
- `context/changes/log-mapped-errors/follow-ups/review-fixes.md:7-10` lists the 3 sites with lines `middleware.ts:33`, `signin.ts:33` and `locale.ts:35`.
  - **Partially accurate.** `signin.ts:33` and `locale.ts:35` match.
  - The middleware call is now at `:34` (`:33` is the eslint-disable comment).
  - The list is not exhaustive: 3 more direct calls exist (see above).
- `review-fixes.md:19-20` says the natural home is audit step 2/5 (the middleware `getUser` outage and Auth-route logging). This change was opened as a standalone F4, so it does **not** include X2 (`getUser` error ignored at `middleware.ts:18-20`) unless the plan pulls it in.
- The audit's line references predate log-mapped-errors (commit d771e60). Its claim "22 raw `console.error` in `src`" (`audits/…:33,259`) is **stale**: there are 8 at de10bb4, 2 of them inside the helper.

## Related Research

- `context/changes/log-mapped-errors/research.md`: design of the helper and its allow-list.
- `context/audits/observability/2026-10-15_projects-milestones-employees.md`: findings X2, X3, X4, E2, E5, E10.

## Open Questions

1. **Scope:** only the 3 F4 sites, or all 6? The other 3 need decisions:
   - Whether a synthetic code is acceptable for the CSV not-configured and missing-snapshot logs, given that it changes their line text.
   - Whether the `set-password` migration should also add the E10 log for the follow-up sign-in failure.
2. **Sign-in user id:** take `data.user.id` from `signInWithPassword` so the locale-save failure carries `userId`, or accept `requestId` only?
3. **Pull in X2?** The middleware still ignores the `getUser` error (`middleware.ts:18-20`). It is the audit's critical finding, sits next to Site 1, and is a behaviour change (503 instead of an anonymous redirect). Keep it out unless it's chosen explicitly.
4. **Sentry:** should `logError` at `"error"` level also report to Sentry? This is outside F4, but it decides whether this migration makes these failures visible in Sentry at all.
