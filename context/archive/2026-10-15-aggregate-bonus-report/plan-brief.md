# Aggregate Bonus Report — Plan Brief

> Full plan: `context/changes/aggregate-bonus-report/plan.md`

## What & Why

Roadmap S-07 / PRD FR-015 (nice-to-have): Supervisors and Admins need one view, and a spreadsheet export, of how much approved bonus each employee received and across how many milestones, e.g. for payroll per quarter or year.

## Starting Point

Approved figures exist only in the frozen snapshot `milestone_result_lines`, readable under RLS (Supervisor: own milestones; Admin: all). S-06 shows one employee's history at a time, aggregated in TypeScript. There is no cross-employee report, no file export and no GET API route in the app.

## Desired End State

`/reports/bonuses` lists every employee in the caller's scope with approved milestone count, total approved bonus and a grand total, filterable by approval date. "Pobierz CSV" downloads the same rows as a file that opens directly in Polish Excel. Employees get 403.

## Key Decisions Made

| Decision         | Choice                                                                            | Why (1 sentence)                                                                                                             | Source   |
| ---------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------- |
| Supervisor scope | Lines from milestones in projects they own                                        | What RLS already returns, consistent with S-06; a transferred employee's total is partial per Supervisor, complete for Admin | Plan     |
| What counts      | Approved milestones only; a 0 zł line counts as a milestone                       | Final, frozen figures; count means "took part in"                                                                            | Plan     |
| Period           | Optional from/to on approval date (Europe/Warsaw, inclusive), default all-time    | Supports per-period payroll; export honours the same filter                                                                  | Plan     |
| Export           | CSV for Polish Excel: BOM, `;`, comma decimal, formula-injection-safe             | Opens by double-click in PL Excel with no dependency                                                                         | Plan     |
| Aggregation      | `security invoker` RPC `bonus_report(p_from, p_to)` in Postgres                   | Avoids the silent `max_rows = 1000` truncation and Worker CPU risk; no definer allowlist change                              | Research |
| Routes           | `/reports/bonuses` + `GET /api/reports/bonuses.csv` in PROTECTED + PROJECT routes | Clear home for reports; `/api` convention for non-page endpoints                                                             | Plan     |
| Tests            | Unit + pgTAP + smoke + Playwright e2e                                             | RLS proven in DB, gating on a server, journey and real download in a browser                                                 | Plan     |
| Employee label   | Name from the latest approved line, grouped by `employee_id`                      | Never group by name; no dependency on reading the `employees` row                                                            | Plan     |

## Scope

**In scope:**

- `bonus_report` RPC with `rls_matrix` and catalog-guard cells
- Filter parsing, CSV builder, grand total helpers with unit tests; `getBonusReport` service
- Report page, CSV endpoint, route gating, Topbar link, PL/EN copy, `CLEAN_PATHS`
- Smoke cells, Playwright spec, CLAUDE.md route-group note

**Out of scope:**

- Draft/provisional figures; cross-Supervisor totals for a Supervisor
- Other filters (project, employee, milestone end date), pagination, sorting controls
- XLSX/PDF or comma-CSV export; per-project breakdown; Topbar token migration

## Architecture / Approach

Page and endpoint parse the filter (zod) → `getBonusReport` calls the invoker RPC as the signed-in user → Postgres joins lines to approved milestones, filters by Warsaw approval date and groups by employee under RLS → the page formats with `formatPln`, the endpoint serialises with the pure CSV builder.

## Phases at a Glance

| Phase                | What it delivers                                      | Key risk                                                    |
| -------------------- | ----------------------------------------------------- | ----------------------------------------------------------- |
| 1. DB RPC            | `bonus_report` + pgTAP per-actor cells                | Missing the approved filter lets the injected Draft line in |
| 2. Service + helpers | Filter parsing, CSV, grand total, service, unit tests | CSV escaping/formula injection edge cases                   |
| 3. Page + endpoint   | `/reports/bonuses`, CSV download, gating, nav, i18n   | First GET API route; route classification                   |
| 4. Smoke, e2e, docs  | Server-level gating and browser journey               | e2e residue makes exact totals non-deterministic            |

**Prerequisites:** S-05 done (approval snapshot); local Supabase for pgTAP, smoke and e2e.
**Estimated effort:** ~2 sessions across 4 phases.

## Open Risks & Assumptions

- A Supervisor's totals for a transferred employee are partial; the page wording ("your projects") must make that clear.
- The e2e oracle compares page vs CSV and lower bounds, not exact totals, because `us-01` leaves approved milestones behind; exact totals are pinned in pgTAP.
- Date boundary uses Europe/Warsaw; a different payroll timezone would need a change.

## Success Criteria (Summary)

- A Supervisor sees and downloads approved totals and counts for employees on their own projects; an Admin for everyone.
- An Employee can never reach the report or its CSV, and no Draft figure appears in either.
- The CSV opens correctly in Polish Excel and is safe against formula injection.
