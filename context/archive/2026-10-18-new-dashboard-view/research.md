---
date: 2026-10-18T20:13:14+02:00
researcher: Claude (Opus 5.5) for ssliwa
git_commit: d39dfc5c0f4a3784dfc95108c369de3d3369d057
branch: develop
repository: 10x-Meritly
topic: "Restyle /dashboard to the supervisor and employee mockups: UI audit charges and data sources"
tags: [research, ui, dashboard, tokens, topbar, rls, approvals, budget-exposure]
status: complete
last_updated: 2026-10-18
last_updated_by: Claude (Opus 5.5)
---

# Research: Restyle /dashboard to the supervisor and employee mockups

**Date**: 2026-10-18T20:13:14+02:00
**Researcher**: Claude (Opus 5.5) for ssliwa
**Git Commit**: d39dfc5c0f4a3784dfc95108c369de3d3369d057
**Branch**: develop
**Repository**: 10x-Meritly

## Research Question

Audit `src/pages/dashboard.astro` against `reports/design/project/Dashboard.dc.html` (supervisor) and `reports/design/project/DashboardEmployee.dc.html` (employee). The audit runs in two directions (source → view and view → source) and produces 3–5 charges. For every mockup section, it answers whether existing code already supplies the data or whether this would be new feature work.

## Summary

- **The page today is a placeholder.** `dashboard.astro:12-58` renders one centred card: the email, a role pill, nav buttons and a sign-out form. None of the mockup's figures are on it. The PRD and roadmap never mention a dashboard: `grep -niE "dashboard|panel"` over `context/foundation/prd.md` and `roadmap.md` returns nothing. The mockup content is therefore new scope, not a restyle of existing content.
- **Data availability splits three ways.**
  - Reusable without change:
    - the employee's approved lines (`listMyBonuses`, `src/lib/services/approvals.ts:492-514`)
    - project budget exposure (`listProjectExposure`, `src/lib/services/projects.ts:405-416`)
    - per-employee over-allocation (view `employee_time_share_totals`, `supabase/migrations/20261009130000_time_share_excludes_closed_projects.sql:21-22`)
  - Needs new queries:
    - a cross-project milestone list
    - "awaiting approval"
    - "paid out this year"
    - KPI multiplier per table row
- **The employee mockup has a privacy conflict.** It shows "Pula do wypłaty" (payout pool) in the latest-bonus breakdown. That conflicts with an explicit privacy decision: the pool lives only in `milestone_results`, which has no employee policy (`supabase/migrations/20261005120000_milestone_approval.sql:18-26,169-187`), and `rls_matrix.test.sql:675` asserts this. The row has to be dropped or replaced, for example with the KPI multiplier, which the employee can already read.
- **Making the dashboard use `Topbar.astro` restyles all 8 pages that render it** (listed below). That has been deferred twice before. The mockup app bar also needs things Topbar lacks: a logo, `aria-current`, an inline language switch and an avatar chip.
- **No token exists for warning/pending (peach) or info/active (periwinkle).** The nearest values are the `--illustration-*` artwork tokens, which are named for SVG artwork.

## Charges

| #   | Category                       | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Effect on the user                                                                                                                                                                                                                                |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Accidental architecture        | `src/pages/dashboard.astro:12-58`: a centred card with its own nav buttons (`:24-49`) and sign-out (`:50-57`). It repeats Topbar's role logic (`:7-8` vs `Topbar.astro:5-6`) and does not render `<Topbar />`, which 8 other pages do.                                                                                                                                                                                                                                   | Right after sign-in or set-password (redirect targets `src/middleware.ts:79`, `src/pages/api/auth/set-password.ts:36`), a supervisor lands on a page that tells them nothing about their work and looks like a different app than the next click. |
| C2  | Missing tokens                 | `dashboard.astro` has 10 scan hits, on lines 13, 14, 17, 18, 19, 23, 28, 34, 44 and 53 (`bg-white/10`, `from-blue-200 to-purple-200`, `text-blue-100/80`, `hover:bg-white/20`).                                                                                                                                                                                                                                                                                          | The page ignores the lilac `primary` that every token-clean page uses, so the main landing page after login is the only blue/purple-gradient screen.                                                                                              |
| C3  | Missing tokens                 | The mockups use peach `#f5c38a` for "Do zatwierdzenia" and "Zakończony", periwinkle `#a5b4fc` for "Aktywny", and blush `#f19a9a`/`#f4a3a3` for over-budget. `global.css` has no `warning` or `info` role. `--destructive` in `.dark` is `oklch(0.704 0.191 22.216)` (`global.css:80`), a saturated red, not the mockup's blush.                                                                                                                                          | Without a role token, status colours either borrow the artwork palette (`--illustration-peach`, `global.css:51`) or end up as literals. "Waiting for you" and "over budget" also lose their visual distinction.                                   |
| C4  | Missing shared component       | Buttons built from copied class strings at `dashboard.astro:26-29,32-35,42-45,51-53` instead of `ui/button.tsx`. There's no stat tile or progress bar anywhere: the closest is the `dl` tile grid in `BudgetExposurePanel.astro:43-57`. There's no milestone status badge helper: only Approved gets `<Badge className="bg-success …">` (`MilestonesSection.astro:120-124`, `ApprovalSection.astro:71`, `PayoutSection.astro:53,57`), and other statuses are plain text. | The mockup repeats a stat tile 4 + 3 times and a status pill 5 times. Without shared components, each copy drifts, and the dashboard's badges won't match the project page's.                                                                     |
| C5  | Missing tokens / shared chrome | `src/components/Topbar.astro` has 11 scan hits on lines 10, 13, 15, 20, 23, 26, 32, 37, 45, 47 and 50 (`text-purple-300`, `text-blue-100/70`, `bg-white/5`). It is not in `CLEAN_PATHS` (`scripts/check-ui-literals.mjs:9-36`), although 5 token-clean pages render it.                                                                                                                                                                                                  | Every signed-in page still shows the old purple/blue bar above token-clean content. The mockup app bar (logo, active-state pills, inline PL/EN, avatar) can't be reached without touching it.                                                     |

Candidate deferral: if the plan keeps the Topbar out of scope, C5 stays in this list marked **deferred** with that reason. In that case C1 can only be fixed partially (dashboard renders the existing Topbar).

## Detailed Findings

### Mockup section → data source (supervisor/admin)

| Mockup section                                                            | Source                                                                                                                                                                                                                                                                                                                                                                   | Status                                                                                                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Greeting sentence ("N milestones await approval, M projects over budget") | Derived from the counts below. New i18n strings with Polish plural forms in `src/lib/i18n/messages/{pl,en}.ts`                                                                                                                                                                                                                                                           | new (derived)                                                                                                                                       |
| Tile: active projects                                                     | `listProjects` (`src/lib/services/projects.ts:363`) filtered on `status === 'active'`                                                                                                                                                                                                                                                                                    | existing                                                                                                                                            |
| Tile: "N milestones in progress"                                          | `listMilestones` filters by `project_id` (`projects.ts:387-401`). A `.from("milestones")` without that filter returns every milestone visible under RLS in one call.                                                                                                                                                                                                     | new small service function                                                                                                                          |
| Tile: "Do zatwierdzenia"                                                  | Not stored anywhere. Statuses are `planned, active, completed, cancelled, approved` (`20261005120000_milestone_approval.sql:45`). `approve_milestone` and the UI accept approval "from any open status" once the milestone is scored, has engagements and the project is open (`src/pages/projects/[id]/milestones/[milestoneId].astro:153-172`).                        | new definition + query                                                                                                                              |
| Tile: "Zarezerwowane z budżetu"                                           | `project_budget_exposure` view: one row per project, `reserved_total` = approved payout_pool or target_pool, cancelled milestones excluded (`20261005120000_milestone_approval.sql:590-618`). Read through `listProjectExposure` (`projects.ts:405-416`) in one query. No cross-project sum exists, so add a pure TS helper. The view does not filter on project status. | existing + new aggregate                                                                                                                            |
| Tile: "Wypłacone premie w <rok>"                                          | `milestone_results` (supervisor/admin RLS, `20261005120000_milestone_approval.sql:177-187`) filtered on `approved_at` in the year, Europe/Warsaw (as `bonus_report` does, `20261015120000_bonus_report.sql:18-20`). Sum `payout_total` and count rows. `bonus_report` is per employee and has no milestone count.                                                        | new query                                                                                                                                           |
| Milestones table: name, project, dates, target pool, status               | Cross-project `milestones` select with a `projects(name)` embed. The embed's behaviour under the current grants is not verified.                                                                                                                                                                                                                                         | new query                                                                                                                                           |
| Milestones table: KPI "x / max"                                           | Unapproved rows: `milestone_payout_summary` RPC per milestone (`getMilestonePayout`, `src/lib/services/payouts.ts:282-311`, 2 RPCs per call). Approved rows: the `milestone_results` snapshot. Both live RPCs raise MR015 for approved milestones (`20261009120000_payout_rpcs_refuse_approved.sql:63,190`).                                                             | N+1 risk unless a new set-returning view/RPC is added. A new view or RPC means updating `rls_catalog_guard` and `rls_matrix` (CLAUDE.md RLS rules). |
| Table action: Zatwierdź / Otwórz / Wyniki                                 | URL `/projects/{id}/milestones/{mid}` (`approvalUrl`, `approvals.ts:162`). Admins cannot approve (`[milestoneId].astro:159`), so admins get "Open".                                                                                                                                                                                                                      | new presentation logic                                                                                                                              |
| "Wymaga uwagi": awaiting approval with pool and headcount                 | `milestone_payout_summary` gives `payout_pool` and `engagement_count` for unapproved milestones only, one call per milestone                                                                                                                                                                                                                                             | new (per-row RPC or new view)                                                                                                                       |
| "Wymaga uwagi": projects over budget                                      | `project_budget_exposure.over_budget` via `listProjectExposure`                                                                                                                                                                                                                                                                                                          | existing                                                                                                                                            |
| "Wymaga uwagi": employees above 100%                                      | `employee_time_share_totals.over_allocated = sum(time_share) > 1` (`20261009130000_…sql:21-22`). Names come from `listEmployees` (`src/lib/services/employees.ts:270-305`) called without `ownerId`.                                                                                                                                                                     | existing, with caveats below                                                                                                                        |
| "Budżety projektów"                                                       | `listProjects` + `listProjectExposure` joined by id, as `src/pages/projects/index.astro:30-45` already does (2 parallel queries)                                                                                                                                                                                                                                         | existing; new compact row component                                                                                                                 |

Caveats:

- `employee_time_share_totals` is `security_invoker`. A supervisor's total covers only engagements on their own milestones (`employees.ts:265-266`), so an employee shared with another supervisor can look under 100% to each of them. "Open" includes `planned` milestones.
- Admin `select` policies return every row. The same queries therefore give an admin a company-wide dashboard.

### Mockup section → data source (employee)

| Mockup section                                                                                                    | Source                                                                                                                                                                                                  | Status                |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Lines: project, milestone, period, approved_at, time_share, role_weight, rating, rating_factor, multiplier, bonus | `listMyBonuses` (`approvals.ts:492-514`, columns `:466-467`). It is sorted `approved_at desc`, filters on `employee_id` on top of RLS, and returns `not_linked: true` when there is no employee record. | existing              |
| Tile: total in the current year + count                                                                           | Filter lines on `approved_at` year in Europe/Warsaw (`formatDate` uses that zone, `src/lib/format.ts:24-31`)                                                                                            | new pure helper       |
| Tile: latest bonus                                                                                                | `lines[0]`                                                                                                                                                                                              | existing              |
| Tile: projects with a bonus                                                                                       | `groupHistory` (`src/lib/history.ts:20-54`), `groups.length` and names                                                                                                                                  | existing              |
| Breakdown: time share, role weight, rating → factor, bonus                                                        | Line fields                                                                                                                                                                                             | existing              |
| Breakdown: "Pula do wypłaty" (payout pool)                                                                        | **Not readable by the employee, by design** (`20261005120000_milestone_approval.sql:18-26`). It would let an employee derive colleagues' bonuses.                                                       | **must not be added** |
| History + total + "see all"                                                                                       | Lines + `groupHistory(...).total`. The full history with per-line breakdowns already lives at `/my-bonuses` (`EmployeeHistory.astro:30-103`), so the dashboard shows the latest N and links there.      | existing              |
| Dashed "new bonuses appear…" note                                                                                 | No existing string. The existing empty, not-linked and load-error states are in `my-bonuses.astro:41-57`.                                                                                               | new i18n              |

Employees have no policy on `milestones` or `projects` (`20260927120000_projects_and_milestones.sql:335-345`). Every employee figure must therefore come from `milestone_result_lines`.

### Tokens and fonts

- `.dark` surfaces (`global.css:68-84`): `--card` 10% white, `--muted` 5% white, `--border` 10% white, `--muted-foreground` `oklch(0.932 0.032 255.585 / 70%)`. The landing change mapped the mockup's translucent surfaces and both greys (`#c3c9d8`, `#aeb5c6`) onto these (`context/archive/2026-10-18-new-landingpage-view/research.md:70`).
- Mockup → token: `#d2b1f7` → `primary`, `#34d39a` → `success` (`context/archive/2026-10-18-new-landingpage-view/tokens.md:7-25`).
- The status colours (peach, periwinkle, blush) exist only as `--illustration-*` (`global.css:51-53`). `global.css:42` describes these as the "landing artwork palette".
- There is no warning, info or pending role. `chart-1..5` exist but are not semantic.
- Fonts: `font-heading`, `font-body` and `font-figures` are declared in `@theme inline` (`global.css:158-160`). They load as self-hosted `@fontsource` imports in `src/pages/index.astro:2-9`, and the comment at `index.astro:14` limits them to that page. The landing plan assumed other pages load no web fonts.
- Google Fonts links were removed for GDPR reasons (landing `reviews/impl-review.md` F1). The mockup's Google Fonts `<link>` must not be copied.
- Guard gap F5 (queued in `context/archive/2026-10-18-new-landingpage-view/follow-ups/review-fixes.md`): the literal regex misses arbitrary values without px/rem, such as `w-[58%]`. The mockup's percentage bar widths would pass the guard unchecked.

### Components

- `ui/badge.tsx` variants: default, secondary, destructive, outline, ghost, link. There is no success, warning or info variant.
- `ui/alert.tsx` variants: default, destructive, success.
- `ui/button.tsx`, `ui/card.tsx`, `ui/table.tsx`: standard new-york shadcn components.
- `Topbar.astro` takes no props; it reads `Astro.locals` (`Topbar.astro:4`). Pages that render it:
  - `admin/settings.astro:57`
  - `employees/index.astro:85`
  - `employees/[id].astro:61`
  - `my-bonuses.astro:38`
  - `projects/index.astro:56`
  - `projects/[id].astro:84`
  - `projects/[id]/milestones/[milestoneId].astro:189`
  - `reports/bonuses.astro:66`
- `LanguageSwitch` is fixed bottom-right in Layout (`Layout.astro:46`) and supports `placement="inline"`. It was kept out of Topbar so it wouldn't collide with sign-out (`context/archive/2026-10-13-language-switch-pl-en/plan.md:221`).
- Kitchen-sink pattern: `src/pages/dev/projects-kitchen-sink.astro`.
  - Dev-only 404 at `:28-31`, with the template wrapped in `{isDev && …}` (`:282,:681`).
  - Typed inline fixtures at `:33-243` and a `states` matrix at `:245-276`.
  - A dashboard sink needs the sections componentised with props, because the page reads `locals` directly today.

### Tests that constrain the change

- `scripts/smoke.mjs:163,179,185` checks only `/dashboard` status codes (302 anon, 200 signed in, 302 after sign-out). No test asserts dashboard markup or text.
- If Topbar changes, these assertions must still hold:
  - `tests/e2e/s-07-aggregate-bonus-report.spec.ts:61-64` (link named "Raporty", exact)
  - `tests/e2e/seed.spec.ts:40` ("Wyloguj się" button on `/projects`)
- Employee reads are covered by `supabase/tests/rls_matrix.test.sql:675-697` (own approved lines only, no header).
- There is no dashboard IDOR check. If the dashboard shows figures, smoke should assert that employee2's dashboard doesn't contain employee1's amounts, the way `/my-bonuses` is checked at `smoke.mjs:286-300`.

## Code References

- `src/pages/dashboard.astro:1-60`: current view
- `src/components/Topbar.astro:1-55`: shared app bar (11 literal hits)
- `src/styles/global.css:42-53,65-84,158-160`: illustration palette, `.dark` values, font families
- `src/lib/services/approvals.ts:466-514`: `listMyBonuses`
- `src/lib/history.ts:20-54`: `groupHistory`
- `src/lib/services/projects.ts:331,363,387-416`: milestone columns, `listProjects`, `listMilestones`, `listProjectExposure`
- `src/lib/services/payouts.ts:282-311`: `getMilestonePayout` (per milestone)
- `src/lib/services/employees.ts:265-305`: time-share totals with names
- `supabase/migrations/20261005120000_milestone_approval.sql:18-26,45,169-187,590-618`: privacy split, status check, results policies, exposure view
- `supabase/migrations/20261009120000_payout_rpcs_refuse_approved.sql:63,190`: MR015 on approved
- `src/pages/projects/[id]/milestones/[milestoneId].astro:153-172`: approval gating
- `src/pages/dev/projects-kitchen-sink.astro:25-31,245-276`: kitchen-sink pattern
- `scripts/check-ui-literals.mjs:9-36`: `CLEAN_PATHS`

## Architecture Insights

- Results and approval logic live in SQL: `kpi_multiplier` and `capped_payout_pool` are the single source of truth. Duplicating the multiplier formula in TS to avoid N+1 goes against that. The options are a per-row RPC (acceptable for a short list) or a new `security_invoker` view/RPC with RLS test updates.
- Approved figures come only from the frozen snapshot (`milestone_results` / `milestone_result_lines`). Live payout RPCs refuse approved milestones.
- Pages that use Topbar share one shell (`bg-cosmic` + `max-w-*` + `<Topbar />`). The dashboard is the only page reachable from the nav that doesn't.

## Historical Context (from prior changes)

- `context/archive/2026-10-01-ui-projects-panel/plan.md:38`: Topbar migration deferred because it "renders on every page". The deferral reason still holds: there are 8 consumers today.
- `context/archive/2026-10-05-supervisor-approves-milestone-employee-sees-bonus/plan.md:71,402-406`: Topbar deferred again. Dashboard nav buttons were added alongside the Topbar links.
- `context/archive/2026-10-18-new-landingpage-view/reviews/impl-review.md:39-56` (F1, self-hosted fonts), `:58-66` (F2, illustration utilities kept for future views), `:68-76` (F3, the signed-in role nav stays on the dashboard, not `/`).
- `context/archive/2026-10-01-ui-projects-panel/tokens.md`: contrast measurements, used as a method for any new `warning`/`info` tokens.

## Related Research

- `context/archive/2026-10-18-new-landingpage-view/research.md`
- `context/archive/2026-10-01-ui-projects-panel/research.md`

## Open Questions (product decisions for /10x-plan)

1. **Scope of data work.** Options:
   - (a) Restyle plus only data that already exists: exposure, budgets, over-allocation and the employee's lines.
   - (b) The full mockup, including the new cross-project milestone query, "awaiting approval", the year payout total and KPI per row.
   - (c) Split into two changes.
2. **Definition of "Do zatwierdzenia".** Either `status = 'completed'` only, or any open, scored milestone with engagements on an open project (what the Approve button allows).
3. **Employee breakdown.** Drop "Pula do wypłaty" or replace it with the KPI multiplier. Adding it is ruled out by the privacy design.
4. **Topbar.** Migrate it in this change (restyles 8 pages, adds the inline language switch and `aria-current`, re-checks the e2e names) or defer it (C5 stays deferred).
5. **Fonts.** Load the landing fonts app-wide (Layout) or on the dashboard only. Either reverses the "only `/` loads web fonts" note at `index.astro:14`.
6. **Status tokens.** Add `warning`/`info` roles, with contrast measured, or reuse `--illustration-peach`/`--illustration-periwinkle`.
7. **"Wypłacone premie"** sums `payout_total` (paid bonuses) or `payout_pool`. Should the "Zarezerwowane" aggregate exclude completed or cancelled projects?
8. **Admin dashboard.** Company-wide figures (what RLS returns) or a reduced variant.
