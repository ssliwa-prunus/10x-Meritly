# Move remaining direct console.error calls onto the shared helper — Plan Brief

> Full plan: `context/changes/f4-console-error-helper/plan.md`
> Research: `context/changes/f4-console-error-helper/research.md`

## What & Why

Six `console.error` calls in `src` still bypass `logError`. Three of them log a Supabase `message` directly, which skips the helper's PII filter (class-22 errors echo user input). None of the six carries `status` or `requestId`, and the sign-in line carries no user id. This is review finding F4 from log-mapped-errors.

## Starting Point

`src/lib/error-log.ts` already provides `logError`, `logContextFrom` and the allow-list, and every service uses them. The six leftovers are in the middleware, three Auth/locale routes, the CSV export and the milestone page.

## Desired End State

Every log line in `src` goes through `logError`, and a grep guard finds no other `console` call. The four sites that log a real error value keep their line text and gain `status`, `userId` and `requestId`. The two message-only lines become `bonus report CSV failed {code: not_configured}` and `getApprovedPayoutHeader failed {code: no_snapshot_header, milestoneId}`. Users see no difference.

## Key Decisions Made

| Decision                             | Choice                                                                                                          | Why (1 sentence)                                                                       | Source          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------- |
| Scope                                | All 6 sites, not just the 3 in F4                                                                               | Makes "no console outside the helper" enforceable and gives every line request context | Plan            |
| Message-only sites                   | Synthetic codes `not_configured`, `no_snapshot_header`                                                          | Follows the `{ code: "no_rows" }` precedent in `bonus-config.ts:273-275`               | Research + Plan |
| Sign-in user id                      | Taken from `signInWithPassword`'s `data.user`                                                                   | `locals.user` is still null at that point                                              | Research + Plan |
| Operation names                      | Equal to today's prefixes (4 sites), `bonus report CSV`, `getApprovedPayoutHeader` (matches `approvals.ts:329`) | `` `${op} failed` `` keeps existing log text                                           | Plan            |
| Level                                | `"error"` at every site                                                                                         | Matches today; no level change in a pure migration                                     | Plan            |
| Extras (X2, Sentry, E10 second half) | Out; each gets its own change                                                                                   | Keeps this change free of behaviour changes                                            | Plan            |
| Unit tests                           | None added                                                                                                      | The sites import `astro:*`; the helper is already tested                               | Research        |

## Scope

**In scope:**

- `src/middleware.ts`, `src/pages/api/auth/signin.ts`, `src/pages/api/locale.ts`, `src/pages/api/auth/set-password.ts`
- `src/pages/api/reports/bonuses.csv.ts`, `src/pages/projects/[id]/milestones/[milestoneId].astro`
- A grep guard criterion

**Out of scope:**

- X2: the `getUser` outage becoming a 503
- Sentry capture in `logError`
- A new log line for the set-password follow-up sign-in failure (E10)
- Edge Functions under `supabase/`
- Any change to the helper, user-facing text or status codes

## Architecture / Approach

The same pattern as the services: `log = logContextFrom(locals, request)`, keep the PostgREST result's `status`, and call `logError("error", op, error, { status, log })`. The two sites without an error value pass `{ code }` plus `ids`. Each call drops its `eslint-disable no-console` comment.

## Phases at a Glance

| Phase                               | What it delivers                                           | Key risk                                                                        |
| ----------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1. Sites that log an error value    | 4 sites on `logError` with `status`, `userId`, `requestId` | The `locale.ts` ternary fallback losing `status`; no unit test can catch a slip |
| 2. Message-only sites and the guard | 2 synthetic-code lines, grep guard, smoke + E2E            | Two line texts change; saved log searches need updating                         |

**Prerequisites:** Local Supabase for smoke/E2E; optionally the probe worktree for P4.
**Estimated effort:** About 1 short session across 2 phases.

## Open Risks & Assumptions

- No automated test checks log output at these sites. Correctness rests on lint, the type check, the guard and the manual probe.
- The probe harness worktree predates the Astro 7.4 upgrade and may need a rebuild before P4 reruns.

## Success Criteria (Summary)

- The guard grep finds nothing outside `src/lib/error-log.ts`
- Smoke and E2E pass unchanged (no behaviour change)
- The probe P4 line shows the same text with `status` and `requestId` added
