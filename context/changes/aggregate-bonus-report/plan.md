# Aggregate Bonus Report Implementation Plan

## Overview

Roadmap S-07 / PRD FR-015 (nice-to-have): a Supervisor or Admin can view, and export as CSV, a report of each employee's total approved bonus and approved-milestone count, optionally limited to an approval-date range. Aggregation runs in Postgres through a new `security invoker` RPC under the existing RLS, so a Supervisor sees only figures from milestones they own and an Admin sees everything.

## Current State Analysis

- Approved per-employee figures live only in `public.milestone_result_lines`, the frozen approval snapshot (`supabase/migrations/20261005120000_milestone_approval.sql:93-118`): `employee_id`, `employee_name` (snapshot), `milestone_id`, `approved_at`, `bonus numeric(12,2)`, `unique (milestone_id, employee_id)`, index on `employee_id`. Draft figures are not stored; they are recomputed per milestone by `milestone_payout_lines` / `milestone_payout_summary`, which refuse Approved milestones (`20261009120000_payout_rpcs_refuse_approved.sql`).
- RLS on the lines: `_select_supervisor` = `owns_milestone(milestone_id)`, `_select_admin` = `is_admin()`, `_select_employee` = own lines of approved milestones (`20261005120000_milestone_approval.sql:198-217`). The Supervisor/Admin policies do **not** require an approved milestone; `listEmployeeHistory` therefore filters `milestones.status = 'approved'` explicitly (`src/lib/services/approvals.ts:490-503`), and `rls_matrix` carries an injected Draft line (`...0751` on `MA_draft ...0722`) that the owner and Admin can see.
- No aggregate view or RPC exists. S-06 aggregates in TypeScript (`groupHistory`, `src/lib/history.ts:20`), but `supabase/config.toml:18` sets `max_rows = 1000`, so a raw-line select would be silently truncated for a company-wide report; `context/foundation/infrastructure.md` (risk register) also names the FR-015 report as a Workers Free 10 ms CPU risk and advises aggregating in Postgres.
- An employee can have approved lines on milestones of several Supervisors (transfer via `employees.supervisor_id`, project owner change). Each Supervisor's report is then partial by design; the Admin's report is complete.
- No file export exists anywhere (no CSV, `Content-Disposition`, or GET API route); every API route is a POST form handler.
- Route gating lives in `src/lib/route-access.ts:29-76` (`PROTECTED_ROUTES`, `PROJECT_ROUTES`, prefix match). `src/lib/__tests__/route-classification.test.ts` requires every page/endpoint to be classified; `src/lib/__tests__/route-access.test.ts:45-95` is the role × route matrix.
- Token-based page pattern to copy: `src/pages/employees/[id].astro` (shadcn `Card`, `Table`, `Alert`; in `CLEAN_PATHS` at `scripts/check-ui-literals.mjs:25`). Navigation is `src/components/Topbar.astro` (`canSeeProjects` block). Money formatting: `formatPln` in `src/lib/format.ts:1-6` (pl-PL in both languages).

## Desired End State

- `/reports/bonuses` (Supervisor/Admin; 403 for Employee, sign-in redirect for anon) lists one row per employee: name (link to `/employees/[id]`), approved milestone count, total approved bonus; plus a grand total. A form with optional `from` / `to` dates (approval date, Europe/Warsaw, inclusive) filters it; an invalid filter shows a validation Alert and no table. Empty result shows an empty state. The page states the scope ("your projects" for a Supervisor, "all projects" for an Admin).
- `GET /api/reports/bonuses.csv?from=&to=` returns the same rows as a CSV that opens directly in Polish Excel: UTF-8 BOM, `;` separator, CRLF, comma decimal without currency or grouping, headers in the UI language, formula-injection-safe text cells, `Content-Disposition: attachment`, `Cache-Control: no-store`; 400 on an invalid filter, 500 on a load error.
- Verified by pgTAP (`supabase test db`), unit tests, `npm run smoke` and a Playwright spec.

### Key Discoveries:

- Approved-only must be enforced in the read, not trusted to RLS: `src/lib/services/approvals.ts:484-503`; fixture `supabase/tests/rls_matrix.test.sql:236-244`.
- PostgREST row cap `max_rows = 1000`: `supabase/config.toml:18`.
- Invoker RPC grant pattern: `revoke execute … from public, anon; grant execute … to authenticated;` (`20261009120000_payout_rpcs_refuse_approved.sql:144-145`).
- Definer allowlist in `supabase/tests/rls_catalog_guard.test.sql:177-202` lists definer functions only; an invoker function is not on it.
- Load errors: `mapLoadError` logs `{code, message}` and returns `load_failed` (`src/lib/services/approvals.ts:201-205`).
- e2e residue: each `us-01` run leaves an approved milestone for the seeded employees (`tests/e2e/us-01-approved-bonus-visible-only-to-its-employee.spec.ts:1-30`), so totals for seeded employees grow per run unless the DB is reset.

## What We're NOT Doing

- No Draft / provisional figures (FR-018: Draft stays milestone-view-only).
- No cross-Supervisor totals for a Supervisor (no security-definer RPC); a transferred employee's total is partial in each Supervisor's report.
- No filter by milestone end date, project, or employee; no pagination or column sorting controls.
- No XLSX/PDF export and no standard-comma CSV variant.
- No per-project breakdown in the report (that is `/employees/[id]` history, S-06).
- No change to `milestone_result_lines` RLS policies or to existing pages beyond the Topbar link.
- No migration of `Topbar.astro` to design tokens (only a link added in its existing style).

## Implementation Approach

Postgres does the aggregation (one row per employee, below the row cap, Worker CPU stays low); the app layer only validates the filter, formats and serialises. Pure helpers (filter parsing, CSV building, grand total) carry the logic that can be unit- and mutation-tested; the page and endpoint are thin. Access is proven where it is enforced: RLS cells in pgTAP, route gating in the route-access matrix and smoke, the user journey in Playwright.

## Critical Implementation Details

- **Approved filter and date boundary**: the RPC must join `milestone_result_lines → milestone_results → milestones` and keep `milestones.status = 'approved'`, and compare `(approved_at at time zone 'Europe/Warsaw')::date` against `p_from`/`p_to` inclusively, each bound ignored when null. Filtering on the raw `timestamptz` would shift a late-evening approval into the next/previous day.
- **Employee name**: group by `employee_id`; take `employee_name` from the line with the latest `approved_at` (tie: smaller `milestone_id`), mirroring `groupHistory`'s naming rule. Do not join `employees` for the name: a Supervisor may not be able to read that row after a transfer.
- **CSV formula injection**: any text cell starting with `=`, `+`, `-`, `@`, tab or CR is prefixed with `'`; cells containing `;`, `"`, CR or LF are quoted with `"` doubled. Numbers are written by the helper, never through `formatPln` (it emits NBSP and "zł").

## Phase 1: Database — `bonus_report` RPC

### Overview

Add the aggregate RPC and prove its per-actor scope in pgTAP.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20261015120000_bonus_report.sql`

**Intent**: Aggregate approved result lines per employee for the caller's RLS scope, optionally limited to an approval-date range.

**Contract**: `public.bonus_report(p_from date default null, p_to date default null) returns table (employee_id uuid, employee_name text, milestone_count integer, total_bonus numeric)`; `language sql stable security invoker set search_path = ''`; approved milestones only; `milestone_count = count(*)` (one line per milestone and employee; 0 zł lines count); ordered by `employee_name, employee_id`; `revoke execute … from public, anon; grant execute … to authenticated`. A header comment states the scope semantics (Supervisor: own milestones only, possibly partial; Admin: all) and why it is invoker.

#### 2. pgTAP — RLS matrix

**File**: `supabase/tests/rls_matrix.test.sql`

**Intent**: Pin what each actor gets from `bonus_report`, including the injected Draft line being excluded and the date boundaries.

**Contract**: new "S-07 aggregate bonus report" block: anon → `throws_ok` 42501; U → empty; E2 → only own row (RLS scope, route blocks the page); SB → no rows for SA's milestones (and only SB-owned lines if the fixture reassigns `MR_appr`); SA → exact `results_eq` (E1 and E2 rows with counts/totals from SA's approved milestones, `MA_draft` line excluded); AD → exact rows over every approved line; a `p_from`/`p_to` pair that includes the fixture approval date returns the rows, a range ending the day before returns none; `p_from > p_to` returns none. Bump `select plan(…)`.

#### 3. pgTAP — catalog guard

**File**: `supabase/tests/rls_catalog_guard.test.sql`

**Intent**: The migration adds a grant, so pin that the new function stays invoker and is not executable by anon (a later switch to definer would widen pay visibility).

**Contract**: two assertions on `bonus_report(date, date)`: `not prosecdef`; `not has_function_privilege('anon', …, 'EXECUTE')`. Bump `plan(…)`.

### Success Criteria:

#### Automated Verification:

- Migration applies: `npx supabase migration up --local`
- pgTAP passes including the new cells: `npx supabase test db`

#### Manual Verification:

- In Supabase Studio (local), calling `bonus_report()` as the seeded supervisor returns the two seeded employees from "Approved Demo Project" and nothing from Draft milestones

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Service and pure helpers

### Overview

Typed service over the RPC, plus pure, unit-tested helpers for filter parsing, CSV and the grand total.

### Changes Required:

#### 1. Types

**File**: `src/types.ts`

**Intent**: Shared DTOs for the report.

**Contract**: `BonusReportRow { employee_id: string; employee_name: string; milestone_count: number; total_bonus: number }`; `BonusReportFilter { from: string | null; to: string | null }` (ISO `YYYY-MM-DD`).

#### 2. Pure helpers

**File**: `src/lib/bonus-report.ts`

**Intent**: Keep all logic outside Astro so it is testable without the Astro pipeline.

**Contract**:

- `parseBonusReportFilter(params: URLSearchParams): { data: BonusReportFilter } | { error: "invalid_date" | "range_reversed" }` — zod; empty strings mean null; real calendar dates only (`2026-02-30` rejected); `from > to` → `range_reversed`.
- `reportGrandTotal(rows): number` — summed in integer grosze (reuse the `toGrosze` idea from `src/lib/history.ts:10`).
- `buildBonusReportCsv(rows, headers: { name: string; milestones: string; total: string }): string` — BOM + `;` + CRLF, comma decimal with two places, no grouping, injection-safe and quoted text per Critical Implementation Details.
- `bonusReportFilename(filter): string` — `meritly-bonus-report[-from][-to].csv`.

#### 3. Service

**File**: `src/lib/services/reports.ts`

**Intent**: One call to the RPC; numeric normalisation; error mapping consistent with other services.

**Contract**: `getBonusReport(supabase, filter): Promise<ServiceResult<BonusReportRow[]>>` — `supabase.rpc("bonus_report", { p_from, p_to })`; `Number()` on numeric columns; errors through a logged `load_failed` mapping (extract or mirror `mapLoadError` from `approvals.ts:201`, context `"getBonusReport"`).

#### 4. Unit tests

**Files**: `src/lib/__tests__/bonus-report.test.ts`, `src/lib/services/__tests__/reports.test.ts`

**Intent**: Prove the helpers and the service mapping.

**Contract**: filter — empty, valid range, single bound, invalid format, impossible date, reversed range, equal bounds allowed; CSV — BOM, separator, CRLF, `1234.5 → 1234,50`, `0 → 0,00`, name with `;`/`"`/newline quoted, `=SUM(...)`, `+`, `-`, `@` prefixed, header row from the passed labels; grand total — `0.10 + 0.20 = 0.30` exactly, empty → 0; filename variants; service — passes null bounds through, maps numeric strings, `load_failed` on error (using the `fakeClient` pattern from `src/lib/services/__tests__/approvals.test.ts:25`).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Mutation score for the helper is reviewed: `npm run test:mutation -- --mutate src/lib/bonus-report.ts`

**Implementation Note**: After automated verification passes, continue to Phase 3 (no manual step in this phase).

---

## Phase 3: Page, CSV endpoint and routing

### Overview

The user-facing report, the export endpoint, gating, navigation and copy.

### Changes Required:

#### 1. Route access

**File**: `src/lib/route-access.ts`

**Intent**: Gate the new prefixes to Supervisor/Admin.

**Contract**: add `"/reports"` and `"/api/reports"` to `PROTECTED_ROUTES` and `PROJECT_ROUTES`; update the `PROJECT_ROUTES` doc comment.

#### 2. Page

**File**: `src/pages/reports/bonuses.astro`

**Intent**: Render the report with token-based shadcn components, following `src/pages/employees/[id].astro`.

**Contract**: parse filter from `Astro.url.searchParams`; invalid → `Alert` with the PL/EN message, no table, no RPC call; else `getBonusReport`; `load_failed` → destructive `Alert`; GET form with two `Input type="date"` (prefilled), submit and "clear" link; scope line (Supervisor/Admin wording); `Table` with name link to `/employees/${employee_id}`, count, `formatPln(total)`; footer grand total; empty state; "Download CSV" link to `/api/reports/bonuses.csv` carrying the current query string.

#### 3. CSV endpoint

**File**: `src/pages/api/reports/bonuses.csv.ts`

**Intent**: Stream the same rows as a file.

**Contract**: `export const GET: APIRoute`; invalid filter → 400 text body with the error code; `load_failed` → 500; success → 200 `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="<bonusReportFilename>"`, `Cache-Control: no-store`; headers from `getMessages(locals.locale)`.

#### 4. Navigation and copy

**Files**: `src/components/Topbar.astro`, `src/lib/i18n/messages/pl.ts`, `src/lib/i18n/messages/en.ts`

**Intent**: Reach the report from the Topbar; all text through the dictionaries.

**Contract**: `t.layout.nav.reports` link inside the `canSeeProjects` block (existing link styling); new `reports` namespace in `pl.ts` first, then `en.ts` (title, scope lines, filter labels, CSV column headers, download, empty state, validation and load-error messages).

#### 5. Guards and tests

**Files**: `scripts/check-ui-literals.mjs`, `src/lib/__tests__/route-access.test.ts`

**Intent**: Keep the new view on tokens; pin gating.

**Contract**: add `src/pages/reports/bonuses.astro` to `CLEAN_PATHS`; matrix rows for `/reports/bonuses` and `/api/reports/bonuses.csv` × anon (redirect; API without `next`), employee (forbidden), supervisor/admin (allow), profile error (unavailable). `route-classification.test.ts` passes without edits once the prefixes are listed.

### Success Criteria:

#### Automated Verification:

- Unit tests pass (route matrix, classification, i18n): `npm test`
- Lint and UI literal check pass: `npm run lint` and `npm run lint:ui`
- Type check and build pass: `npx astro check` and `npm run build`

#### Manual Verification:

- As the seeded supervisor: Topbar shows "Raporty", the report lists both seeded employees with counts and totals, the grand total equals their sum, names open `/employees/[id]`
- A date range excluding today shows the empty state; a reversed range shows the validation Alert
- The downloaded CSV opens in Polish Excel with three separate columns and correct `,` decimals
- As the seeded employee: `/reports/bonuses` and the CSV URL return 403; the Topbar has no Reports link
- The page is usable at phone width

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 4.

---

## Phase 4: Smoke, e2e and docs

### Overview

Prove gating and the journey against a running server; document the new route group.

### Changes Required:

#### 1. Smoke cells

**File**: `scripts/smoke.mjs`

**Intent**: Role × route and content checks for the new endpoints.

**Contract**: employee and employee2 → 403 on `/reports/bonuses` and `/api/reports/bonuses.csv`; anon → redirect to sign-in; supervisor and admin → 200 on both; page HTML links `/employees/<EMPLOYEE_1>` and `/employees/<EMPLOYEE_2>`; CSV has `text/csv` content type, `attachment` disposition and starts with the BOM; `?from=2026-02-30` → 400 on the CSV. No exact totals (local residue from e2e runs).

#### 2. Playwright spec

**File**: `tests/e2e/s-07-aggregate-bonus-report.spec.ts`

**Intent**: The Supervisor journey in a real browser, with an oracle that survives residue.

**Contract**: signed in as the seeded supervisor (`lang=pl` pinned, as in `us-01`): open the report from the Topbar; the seeded employee's row shows count ≥ 1 and a total ≥ 600,00 zł; click "Pobierz CSV" and capture the download: filename matches, the employee's CSV row (count, `,`-decimal total) equals the on-screen row; apply a range ending yesterday → empty state. Header comment records the risk, the seed and the residue rationale.

#### 3. Docs

**File**: `CLAUDE.md`

**Intent**: Keep the auth-flow route-group description accurate.

**Contract**: `PROJECT_ROUTES` sentence lists `/reports` and `/api/reports`.

### Success Criteria:

#### Automated Verification:

- Smoke passes against a local preview: `npm run smoke`
- E2E passes: `npm run test:e2e`
- Full unit suite still passes: `npm test`

#### Manual Verification:

- The Playwright report shows the new spec green with a captured CSV

**Implementation Note**: After automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- Filter parsing (valid/invalid/impossible/reversed/equal bounds), CSV serialisation (BOM, separator, CRLF, decimal, quoting, formula injection), grand total in grosze, filename, service mapping and error path, route-access matrix rows.

### Integration Tests:

- pgTAP `rls_matrix` per actor for `bonus_report`, including the injected Draft line and date boundaries; catalog guard pins invoker + no anon execute.
- Smoke: gating and response shape of page and CSV against a running server.
- Playwright: Supervisor opens report, downloads CSV, CSV matches screen, empty range.

### Manual Testing Steps:

1. Sign in as `supervisor@meritly.local`, open Raporty, verify both seeded employees and the grand total.
2. Filter with a range excluding today → empty state; reversed range → validation Alert.
3. Download CSV, open in Polish Excel, check columns and decimals.
4. Sign in as admin → scope line says all projects; as employee → 403.

## Performance Considerations

The RPC returns one row per employee, well below `max_rows`; the Worker only formats rows. The existing `employee_id` index and the `milestone_results` primary key cover the join; no new index unless the manual check on a seeded dataset shows otherwise.

## Migration Notes

Additive: one new function, no table or policy changes, no data backfill. Rollback is `drop function public.bonus_report(date, date)`.

## References

- Roadmap item: `context/foundation/roadmap.md` (S-07), PRD FR-015 `context/foundation/prd.md:124`
- Similar implementation: `context/archive/2026-10-12-navigate-to-employee-detail-and-history/plan.md`, `src/lib/history.ts:20`, `src/pages/employees/[id].astro`
- Snapshot and policies: `supabase/migrations/20261005120000_milestone_approval.sql:93-217`
- CPU risk: `context/foundation/infrastructure.md` (risk register, FR-015 row)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database — `bonus_report` RPC

#### Automated

- [x] 1.1 Migration applies: `npx supabase migration up --local` — fa83003
- [x] 1.2 pgTAP passes including the new cells: `npx supabase test db` — fa83003

#### Manual

- [x] 1.3 In Supabase Studio (local), calling `bonus_report()` as the seeded supervisor returns the two seeded employees from "Approved Demo Project" and nothing from Draft milestones — fa83003

### Phase 2: Service and pure helpers

#### Automated

- [x] 2.1 Unit tests pass: `npm test` — 7c421d8
- [x] 2.2 Lint passes: `npm run lint` — 7c421d8
- [x] 2.3 Type check passes: `npx astro check` — 7c421d8
- [x] 2.4 Mutation score for the helper is reviewed: `npm run test:mutation -- --mutate src/lib/bonus-report.ts` — 7c421d8

### Phase 3: Page, CSV endpoint and routing

#### Automated

- [x] 3.1 Unit tests pass (route matrix, classification, i18n): `npm test`
- [x] 3.2 Lint and UI literal check pass: `npm run lint` and `npm run lint:ui`
- [x] 3.3 Type check and build pass: `npx astro check` and `npm run build`

#### Manual

- [x] 3.4 As the seeded supervisor: Topbar shows "Raporty", the report lists both seeded employees with counts and totals, the grand total equals their sum, names open `/employees/[id]`
- [x] 3.5 A date range excluding today shows the empty state; a reversed range shows the validation Alert
- [x] 3.6 The downloaded CSV opens in Polish Excel with three separate columns and correct `,` decimals
- [x] 3.7 As the seeded employee: `/reports/bonuses` and the CSV URL return 403; the Topbar has no Reports link
- [x] 3.8 The page is usable at phone width

### Phase 4: Smoke, e2e and docs

#### Automated

- [ ] 4.1 Smoke passes against a local preview: `npm run smoke`
- [ ] 4.2 E2E passes: `npm run test:e2e`
- [ ] 4.3 Full unit suite still passes: `npm test`

#### Manual

- [ ] 4.4 The Playwright report shows the new spec green with a captured CSV
