# Review follow-ups: log-mapped-errors

Queued from `reviews/impl-review.md`. Not part of this change; each needs its own `/10x-new`.

## F4: move the remaining direct `console.error` calls onto the shared helper

- **Where**:
  - `src/middleware.ts:33` (profile lookup)
  - `src/pages/api/auth/signin.ts:33` (`set_my_locale` at sign-in)
  - `src/pages/api/locale.ts:35` (`set_my_locale`)
- **Why**:
  - These log a PostgREST/Auth `message` directly, so they skip the class-22 input-echo filter in `src/lib/error-log.ts`.
  - They also miss the shared `requestId` / `status` context.
  - Every other Supabase error in the app now goes through `logError` / `mapLoadError`.
- **Scope**:
  - Replace each call with `logError("error", "<operation>", error, { status, log })`, where `log = logContextFrom(locals, request)`.
  - The middleware has the user id already and should pass it.
  - Keep the 503 behaviour of the middleware unchanged.
  - Natural home: the audit's step 2 / step 5 change (middleware `getUser` outage handling and the Auth-route logging; findings X2, X3, X4, E2, E5, E10 in `context/audits/observability/2026-10-15_projects-milestones-employees.md`).
