<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Move remaining direct console.error calls onto the shared helper

- **Plan**: context/changes/f4-console-error-helper/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-10-17
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | WARNING |

**Drift review** (de10bb4..3ec12dc)

- The changed files are exactly the 6 planned sources plus the change folder: no EXTRA or MISSING files.
- All six calls match their contracts: operation names, synthetic codes, `ids`, `status` and `log`.
- Two minor adaptations from the plan's wording, both behaviour-equivalent:
  - `signin.ts` uses `data.user.id`, not `data.user?.id`, because the type is non-null after the error early return and lint rejects the optional chain.
  - The `locale.ts` no-client fallback carries `status: undefined`.
- Out-of-scope items are untouched: no change to the helper, `supabase/`, user-facing text or status codes, and X2, Sentry and E10 were left alone.

**Safety review**

- The change logs less raw data than before: `message` now goes through the class-22 filter.
- `cf-ray` is capped at 64 characters by the helper.
- No new I/O, and logging cannot throw.

**Automated criteria re-run at 3ec12dc**

- Passed: the guard grep (empty), `lint`, `lint:ui` (18 files clean), `astro check` (0/0) and `npm test` (630 of 630).
- `build`, `smoke` and `test:e2e` passed earlier in the session on identical source.
- Smoke passed after `supabase db reset --local`; see F2.

## Findings

### F1 — Manual check 2.9 cannot observe the CSV `not_configured` line

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/pages/api/reports/bonuses.csv.ts:22-25; src/lib/route-access.ts:38-39; src/middleware.ts:11-21
- **Detail**:
  - `/api/reports` is a protected route. When Supabase config is missing, `createClient` returns `null`, `locals.user` stays `null`, and the middleware redirects to sign-in before the handler runs.
  - The `!supabase` branch, and therefore the new `bonus report CSV failed {code: not_configured}` line, is unreachable over HTTP. The same was true of the old line.
  - Row 2.9 was ticked on manual confirmation, but the line itself can't have been observed. Its correctness rests on lint and the type check.
  - This also contradicts the audit's X3 note that "only the reports CSV logs it": in practice nothing logs a missing config.
- **Fix**: Record this caveat against 2.9, and carry it into the X3 change (middleware logs a null client on protected routes) as evidence that the missing-config case is currently silent.
- **Decision**: FIXED — a review note is added under the Phase 2 manual criterion in `plan.md`, and the X3 follow-up is queued in `follow-ups/review-fixes.md`. No code change.

### F2 — Smoke's `OTHER_BONUS` check is a substring match

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: scripts/smoke.mjs:25 (used by the employee2 `/my-bonuses` excludes)
- **Detail**:
  - The first smoke run failed "employee2 /my-bonuses shows only own Approved line" and "…ignores injected ids". employee2's own total, `4600,00 zł`, included 5 leftover US-01 E2E projects and contains the substring `600,00 zł`.
  - It was not a data leak: the matched text was employee2's own total.
  - Any stale local data, or a future seed change that pushes a total to end in 600,00, re-triggers the false failure.
  - This is outside this change's diff and was found while verifying 2.7.
- **Fix**: Queue a follow-up to match `OTHER_BONUS` as a whole amount (bounded by a non-digit before it), not as a substring.
- **Decision**: FIXED (queued) — written to `follow-ups/review-fixes.md` for its own change; `scripts/smoke.mjs` is not changed here.
