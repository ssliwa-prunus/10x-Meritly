# Review follow-ups: f4-console-error-helper

Queued from `reviews/impl-review.md`. These aren't part of this change; each one needs its own `/10x-new`.

## F1: a missing Supabase config is logged nowhere (evidence for audit X3)

- **Where**:
  - `src/pages/api/reports/bonuses.csv.ts:22-25`
  - `src/middleware.ts:11-21`
  - `src/lib/route-access.ts:38-39`
- **Why**:
  - The audit (`context/audits/observability/2026-10-15_projects-milestones-employees.md`, X3) says that with config missing, "only the reports CSV logs it". In practice that branch is unreachable:
    - `createClient` returns `null`.
    - `locals.user` stays `null`.
    - The middleware redirects the protected `/api/reports` before the handler runs.
  - Today no request logs a missing config at all.
- **Scope**: in the X3 change, have the middleware log a `null` client on protected routes (once per isolate) and answer 503. After that, the CSV handler's `not_configured` branch becomes a defensive fallback; keep it or remove it.

## F2: smoke's `OTHER_BONUS` check matches a substring

- **Where**: `scripts/smoke.mjs:25` (`OTHER_BONUS = "600,00 zł"`), used by the employee2 `/my-bonuses` exclude checks.
- **Why**:
  - On 2026-10-17, smoke failed "employee2 /my-bonuses shows only own Approved line" and "…ignores injected ids".
  - employee2's own total, `4600,00 zł`, contains the substring `600,00 zł`. The total included 5 approved US-01 projects that E2E runs had left in the local database.
  - It was not a data leak. Stale local data, or a seed change that makes a total end in `600,00`, will trip the check again.
- **Scope**:
  - Match the amount as a whole value, with no digit or digit-group space immediately before it (for example a regex lookbehind on the normalised body), in both the exclude checks and their positive controls.
  - Optionally, document `npx supabase db reset --local` before a local smoke run after E2E.
