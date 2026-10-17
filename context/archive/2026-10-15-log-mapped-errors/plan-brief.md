# Shared Error-Logging Helper — Plan Brief

> Full plan: `context/changes/log-mapped-errors/plan.md`
> Research: `context/changes/log-mapped-errors/research.md`

## What & Why

Production errors in the projects, milestones and employees flows are often invisible or undiagnosable. Each service logs only `{ code, message }`. Every mapped code returns before the log, including `42501`, which can mean a broken grant after a migration. Edge Function failures are logged by class name only. This change implements step 1 of the 2026-10-15 observability audit: one shared helper that logs diagnosable, PII-free lines with ids, at a level that reflects what the code can mean.

## Starting Point

- There are 13 copied mappers (`mapLoadError` ×7, `mapPostgrestError` ×6) and 2 function wrappers in `src/lib/services`.
- PostgREST errors are plain objects whose `status` lives on the result. Function errors hold an unread `Response`.
- Services never receive the user id, though `locals.user` exists at every call site.
- 9 tests pin the current payload.

## Desired End State

Every failed or regression-capable Supabase call writes one `"<operation> failed"` line. It carries `code`, `status`, the safe parts of `message`/`details`/`hint`, entity ids, `userId`, the cf-ray `requestId`, and `mappedTo` for mapped codes. A grants regression now leaves a `warn` trail instead of silence. Users see exactly the same codes and messages as today.

## Key Decisions Made

| Decision          | Choice                                                                                                                                                                                                                                                       | Why (1 sentence)                                                                          | Source                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------- |
| Fields logged     | Allow-list by class: always `code`, `status`, `name`; `message` except 22xxx (raw bodies truncated to 200); `details`/`hint` only for transport failures and 42xxx/57014/PGRST*                                                                              | Keeps the network cause and constraint names while never logging emails or row values     | Plan (research §3)            |
| Log levels        | warn: `42501`, `23514`, `MR014`, 0-row writes, function `forbidden`/`not_found`/`invalid_request`/unmapped; error: unexpected and failure codes; silent: domain rejections (`23505`, other MR guards, `already_active`, `email_unavailable`, `not_approved`) | Surfaces regression signals without logging every user validation miss                    | Plan                          |
| User id           | Optional trailing `log?: LogContext` on services, filled by `logContextFrom(locals, request)`                                                                                                                                                                | No breaking signatures; user on every line                                                | Plan                          |
| Request id        | `cf-ray` in the same context now                                                                                                                                                                                                                             | Call sites are touched anyway; ties lines to the invocation                               | Plan                          |
| Scope             | Worker service mappers + the 2 function wrappers only                                                                                                                                                                                                        | One coherent helper; Edge Function, Auth and approval-outcome fixes are later audit steps | Plan                          |
| Tests             | Exhaustive helper tests + real console spies in service tests                                                                                                                                                                                                | Proves composed output and PII exclusion; Stryker-clean helper                            | Plan                          |
| User-facing codes | Unchanged, including `42501` → `not_found`                                                                                                                                                                                                                   | No existence leak; logging only                                                           | Research (archived decisions) |

## Scope

**In scope:**

- `src/lib/error-log.ts` and its unit tests.
- Migrating the 7 service files and 2 function wrappers onto it.
- 0-row warn lines.
- Updated and new service tests.
- Wiring about 47 page/route calls.
- Probe before/after.

**Out of scope:**

- Edge Function (Deno) logging.
- Auth routes and middleware `getUser`.
- Approval-outcome logging.
- A new SQLSTATE for the `MR014` invariant.
- Info-level domain logs, a tracker or logging library, request-id propagation to functions.
- Retry behaviour.

## Architecture / Approach

Mappers keep their per-service code tables and return values but delegate all logging to `logError` / `mapLoadError` / `logFunctionError`. `errorFields` applies the allow-list. `readFunctionError` reads status from the `Response` and the body from a clone. Pages and routes build a `LogContext` once and pass it to services, which add the entity ids they already hold.

## Phases at a Glance

| Phase         | What it delivers                                                      | Key risk                                                          |
| ------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1. Helper     | `src/lib/error-log.ts` + exhaustive unit tests                        | Allow-list edge cases (raw bodies, `code: ""`)                    |
| 2. Services   | All mappers and wrappers on the helper, `log?` param, tests rewritten | Forgetting to forward `result.status`; body consumed before clone |
| 3. Call sites | Log context at ~47 calls; probe before/after; full gates              | Missed call site (grep check)                                     |

**Prerequisites:** the audit and research above; local Supabase for smoke; the probe worktree kept for before/after.
**Estimated effort:** ~2 sessions across 3 phases.

## Open Risks & Assumptions

- The Postgres `details` formats used to justify the allow-list come from worker knowledge. The allow-list is conservative, so an unknown format is dropped rather than leaked.
- How production Workers Logs serialise payloads is unverified. The payload is flat and JSON-serialisable by design.
- The probe harness uses a fake Supabase, so it proves payload shape, not real Postgres messages.
- A legitimate id-tampering attempt now produces a `warn` line; that is accepted as useful signal.

## Success Criteria (Summary)

- A grants or RLS regression on any write in these flows leaves a `warn` line with `mappedTo`, ids and `userId`, instead of nothing.
- A network or timeout failure is logged with `status: 0` and its cause; a function 404 and a 500 are distinguishable.
- No email address or row value ever appears in a log line, and users see no difference.
