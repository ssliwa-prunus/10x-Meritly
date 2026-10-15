<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Shared Error-Logging Helper

- **Plan**: context/changes/log-mapped-errors/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-15
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | WARNING |

**Drift review**

- No DRIFT or MISSING items.
- All disclosed deviations are present exactly as described: 12 zero-row sites, relay errors' code logged but not mapped, unknown function code → warn, `status` on the truncation log, `logFunctionError` without `status`, `null` → `"null"`, and the grep criterion run excluding tests.
- All 34 mapper call sites forward `status`. The ids match research §4. The level table is respected per code and per service.
- All 48 page/route calls pass `log`, and `logContextFrom` is called once in each of the 27 files.
- Nothing changed under `supabase/`, `src/middleware.ts`, the auth routes, i18n or components. User-facing return codes are unchanged.

**Safety review**

- No CRITICAL issues. The change logs _less_ than the code it replaces: the old mappers logged `message` for class 22 too.
- Every custom `raise exception` in the migrations interpolates only ids, status words, dates or counts.
- Ids logged are always zod-validated UUIDs.
- Logging cannot throw.

**Automated criteria re-run at b2dc720**

- Helper and service tests: 293 ✓. Full suite: 602 ✓.
- No `console` call in service source ✓.
- `lint`, `lint:ui` and `astro check` (0/0) ✓.
- 27/27 files call `logContextFrom` ✓.
- `npm run build` failed. The cause is the environment (Node 26 vs `.nvmrc` 22.22.3); see F6. It passed during Phase 3 on the same code.
- Smoke passed earlier in the session against the preview and was not re-run.
- Phase mutation runs in-session: helper 80/80 killed; services had 0 survivors on logging lines.

**Manual criteria**

- 3.6–3.8 were confirmed by the user in session.
- The probe before/after evidence is in `.claude/worktrees/agent-a21ec667f2c72fffb/probe/results.md` and `results-before.md`.
- 3.8 was vacuous: the smoke run logged no errors at all.

## Findings

### F1 — A non-JSON 2xx body can put row data into the log

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/error-log.ts:104 (raw-body branch); source of the shape: node_modules/@supabase/postgrest-js/dist/index.mjs:476-480
- **Detail**:
  - When a **2xx** response body fails `JSON.parse`, postgrest-js returns `error = { message: body }` with status 200. The no-`code` branch then logs the first 200 characters of that body.
  - For a malformed or truncated success payload (for example bonus lines), that excerpt can contain employee names or amounts, which breaks the no-PII/no-figures rule.
  - Non-2xx raw bodies (gateway or HTML pages) are harmless and useful.
- **Fix**: In the raw-body branch, when `status` is 2xx log `bodyLength` (a number) instead of `message`. Add a test with a truncated `[{"employee_id":…,"full_name":"…"` body at status 200 asserting no excerpt is logged.
- **Decision**: FIXED — 2xx raw body logs `{ status, bodyLength }` only; tests pin the truncated-payload case and the 199/300 boundaries

### F6 — `npm run build` fails under Node 26 with an existing `dist/`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: node_modules/astro/dist/core/fs/index.js:34,79 (environment, not this change)
- **Detail**:
  - The machine runs Node v26.9.0, while `.nvmrc` pins 22.22.3.
  - Astro's `emptyDir` calls `fs.rmdirSync(…, { recursive: true })`, which Node 26 rejects, so any rebuild over an existing `dist/` exits 1 ("The property 'options.recursive' is no longer supported").
  - The Phase 3 build gate passed on identical code.
- **Fix**: Use Node 22.22.3 (`nvm use`). The repo already pins it, so no code change is needed. Until then, delete `dist/` before building.
- **Decision**: FIXED via the Astro upgrade (user's choice). astro 7.4.0 replaced the `rmdirSync({ recursive: true })` fallback with `fs.rmSync` (`astro/dist/core/fs/index.js:83`); the rebuild over an existing `dist/` passes on Node 26. The upgrade's side effect, a miniflare proxy regression after early-403 POSTs, is fixed in `src/lib/request-body.ts` and `src/middleware.ts`. Original notes: Root cause: Astro 7.3.2's Windows `EPERM` fallback (`fixWinEPERMSync` → `rmdirSync({ recursive: true })`, `astro/dist/core/fs/index.js:34,79`) is rejected by Node 26.9.0. `.nvmrc` (22.22.3, used by CI) is unchanged.

### F2 — `readFunctionError` leaves the original response body unread

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/error-log.ts:175
- **Detail**:
  - The body is read from `response.clone()` and the original branch is never consumed or cancelled.
  - No caller reads the original afterwards. The phase 2 migration removed `functionErrorCode`, the only other reader.
  - workerd may warn about an unread tee branch (reviewer's recollection, unverified).
- **Fix**: Read `response.json()` directly (drop the clone and the "stays readable" test), or `cancel()` the original body after reading the clone.
- **Decision**: FIXED — body read directly (no clone); test now asserts `bodyUsed === true`

### F3 — `cf-ray` is taken at face value

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/error-log.ts:160-161
- **Detail**: In production Cloudflare sets the header. Locally (wrangler or Node preview) it is whatever the client sends, of any length. Logs are structured, so this is only noise.
- **Fix**: `slice(0, 64)` (or validate the cf-ray format) before logging.
- **Decision**: FIXED — `requestId` capped at 64 chars (`REQUEST_ID_LIMIT`); test with a 65-char header

### F4 — Remaining direct `console.error` calls bypass the helper

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/middleware.ts:33, src/pages/api/auth/signin.ts:33, src/pages/api/locale.ts:35
- **Detail**: These still log the PostgREST/Auth `message` directly, skipping the class-22 filter and the shared context. They were out of scope for this change, which covered audit steps 2 and 5. The risk today is low.
- **Fix**: Move them to `logError` in the Auth/middleware follow-up change.
- **Decision**: FIXED (queued) — written to `follow-ups/review-fixes.md` for the Auth/middleware change; no code change here

### F5 — An undeployed Edge Function logs at warn, not error

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/approvals.ts (notify fall-through), src/lib/services/employees.ts (invite fall-through)
- **Detail**:
  - The Supabase gateway answers a missing function with 404 and body code `NOT_FOUND` (upper case). That isn't in the code tables, so it counts as an "unknown function code" and logs at **warn** (probe PEDGE404 / PEDGE404n).
  - An undeployed function is an outage for every invite or approval email, arguably error-level.
  - The same applies to a function 5xx that happens to carry an unknown code.
- **Fix A ⭐ Recommended**: Warn on an unknown code only when the status is 4xx and not 404; log error for 5xx and for a 404 whose code is not in the table.
  - Strength: An outage-class response (gateway 404, 5xx) reaches error level, while genuine contract drift (unknown 4xx code) stays warn as decided.
  - Tradeoff: A small extra rule in two wrappers plus tests; it slightly refines the decided level table.
  - Confidence: MED. Gateway 404 bodies were observed only via the fake Supabase in the probe; the real gateway's 404 body format is unverified.
  - Blind spot: Other gateway codes (e.g. 546 resource limits) not enumerated.
- **Fix B**: Keep as is; document that undeployed functions surface as warn.
  - Strength: No change; the decided table is followed literally.
  - Tradeoff: A broken deploy of a function shows up only as warn lines.
  - Confidence: HIGH. Behaviour is pinned by tests today.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A) — new `functionFallbackLevel(error, info)` in `src/lib/error-log.ts` used by both wrappers: warn only for an unknown code on a 4xx ≠ 404 from a `FunctionsHttpError`; error for 5xx, 404 (gateway `NOT_FOUND`), no code, relay and network. Boundary tests (399/400/404/499/500) + service tests updated; helper mutation 109/109 killed
