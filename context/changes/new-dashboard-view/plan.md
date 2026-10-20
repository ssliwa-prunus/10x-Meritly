# Restyle /dashboard to the supervisor and employee mockups — Implementation Plan

## Overview

Rebuild `/dashboard` from a placeholder welcome card into the two mockups: `reports/design/project/Dashboard.dc.html` (supervisor/admin) and `reports/design/project/DashboardEmployee.dc.html` (employee). The page is built only from tokens in `src/styles/global.css` and shared components. `Topbar.astro` is migrated to the mockup app bar for every signed-in page. The data comes from new read-only TypeScript service queries over existing tables and views, with no new SQL and no RLS changes.

## Current State Analysis

From `context/changes/new-dashboard-view/research.md`:

- **The page:** `src/pages/dashboard.astro:12-58` is a centred card with the email, a role pill, buttons built from copied class strings, and its own sign-out. It has 10 literal-scan hits. It is the only nav-reachable page that does not render `<Topbar />`.
- **The Topbar:** `src/components/Topbar.astro` has 11 literal-scan hits and is rendered on 8 pages. It has no logo, no `<nav>`/`aria-current`, no language switch (Layout pins `LanguageSwitch` bottom-right, `Layout.astro:46`) and no avatar.
- **Tokens:** no `warning` or `info` role exists. The peach and periwinkle used by the mockups exist only as artwork tokens (`global.css:51-52`).
- **Fonts:** `font-heading`, `font-body` and `font-figures` load only on `/` (`src/pages/index.astro:2-9,14`).
- **Data:** budget exposure, over-allocation and the employee's lines can be reused as they are. The cross-project milestone list, "awaiting approval", KPI per row and the year payout total are new queries.
- **Privacy:** the payout pool is deliberately unreadable by employees (`supabase/migrations/20261005120000_milestone_approval.sql:18-26`).

## Desired End State

- **Supervisor** lands on `/dashboard` and sees:
  - the shared app bar
  - a greeting with a role badge and a dynamic sentence
  - four stat tiles
  - a milestones table across their projects with status badges and Approve/Open/Results actions
  - a "Wymaga uwagi" list
  - project budget bars
- **Admin** sees the same layout company-wide, with no Approve action.
- **Employee** sees:
  - a greeting with the "Moje premie" CTA
  - three stat tiles
  - the breakdown of their latest bonus, with the KPI multiplier instead of the payout pool
  - a short history with a total and a link to `/my-bonuses`
  - the dashed "new bonuses appear…" note
- **A user without a role** sees a token-clean fallback card.
- **States:** every section has an empty state and a load-error state, all shown in `/dev/dashboard-kitchen-sink`.
- **Guards:** `dashboard.astro`, `Topbar.astro` and the new components are in `CLAUDE.md`'s guarded paths (`CLEAN_PATHS`). `npm run lint:ui`, `npm test`, `npx astro check` and `npm run smoke` pass.

### Key Discoveries:

- `milestone_payout_summary` returns `scored`, `multiplier`, `payout_pool` and `engagement_count` (`src/types.ts:148-164`). `getMilestonePayout` always also runs the lines RPC (`src/lib/services/payouts.ts:282-311`).
- Both live payout RPCs raise MR015 on approved milestones (`supabase/migrations/20261009120000_payout_rpcs_refuse_approved.sql:63,190`). Approved figures must come from `milestone_results` (`…milestone_approval.sql:52-72`: `multiplier`, `multiplier_max`, `payout_pool`, `payout_total`, `engagement_count`, `approved_at`).
- Approval rule: not approved, not cancelled, project open, scored, at least one engagement. Admins never approve (`src/pages/projects/[id]/milestones/[milestoneId].astro:153-172`).
- `milestones` has `kpi_schedule/budget/quality/risk`, which are either all null or all set (`20261004120000_milestone_kpi_and_payouts.sql:45-54`). "Scored" can therefore be decided before any RPC.
- `project_budget_exposure` returns one row per visible project (`listProjectExposure`, `src/lib/services/projects.ts:405-416`).
- `employee_time_share_totals.over_allocated` with names comes through `listEmployees` without `ownerId` (`src/lib/services/employees.ts:269-305`).
- `listMyBonuses` (`src/lib/services/approvals.ts:492-514`) is sorted `approved_at desc, milestone_name asc`. `groupHistory` is at `src/lib/history.ts:20-54`.
- `plural(locale, n, forms)` exists (`src/lib/i18n/index.ts:67-69`), and so does `formatDate` in Europe/Warsaw (`src/lib/format.ts:24-31`).
- Layout already has `languageSwitch={false}`, and `LanguageSwitch` already supports `placement="inline"` (`Layout.astro:11-17`, `LanguageSwitch.astro:9-13`).
- Kitchen-sink pattern: `src/pages/dev/projects-kitchen-sink.astro:25-31` for the dev-only 404, `:245-276` for the state matrix.
- These e2e assertions depend on Topbar names: `tests/e2e/s-07-aggregate-bonus-report.spec.ts:61-64` (link "Raporty", exact) and `tests/e2e/seed.spec.ts:40` ("Wyloguj się" button on `/projects`).

## What We're NOT Doing

- No new migration, view, RPC, policy or grant. `rls_catalog_guard` and `rls_matrix` stay unchanged.
- No payout pool, share or colleague figure on the employee dashboard. The breakdown's fourth tile is the KPI multiplier.
- No restyle of page bodies other than the dashboard. The other 8 pages change only through the shared Topbar and the app-wide body font.
- No reduced admin variant and no admin-specific tiles.
- No client-side fetching or React islands. The dashboard stays server-rendered `.astro`.
- No Google Fonts link (GDPR decision, landing `reviews/impl-review.md` F1). No mockup accent picker.
- No fix for guard gap F5 (arbitrary values without px/rem). Bar widths use an inline `style` width percentage, documented in the component.
- The over-allocation figure is not made global for supervisors. It is the RLS-scoped total (own milestones), and the copy says "na Twoich kamieniach milowych" where needed.

## Implementation Approach

Follow the 10x-ui order: environment and library, then token values, then the one view, then states.

1. **Primitives first:** tokens, fonts, Badge variants and the three shared components land before anything uses them.
2. **Topbar second,** in its own phase, because it touches 8 pages and two e2e assertions.
3. **Data layer third, test-first:** every number on the dashboard comes from a pure helper with a unit test, fed by thin service functions that follow the existing `ServiceResult` + `mapLoadError` pattern.
4. **View fourth:** prop-driven section components, so the kitchen sink in phase 5 can render every state from fixtures.

Definitions (decided in planning; they apply everywhere the term appears):

- **Awaiting approval (`isAwaitingApproval`):** all of the following hold. Mirrors the Approve button.
  - status not in {`approved`, `cancelled`}
  - project status not in {`completed`, `cancelled`}
  - all four `kpi_*` non-null
  - payout summary `engagement_count > 0`
- **Aktywne projekty:** project `status = 'active'`.
- **Kamienie w toku:** milestone `status = 'active'` (in any visible project).
- **Zarezerwowane z budżetu:** the sums of `reserved_total` and `total_budget` over projects whose status is not `completed`/`cancelled`. Percent = `floor(reserved / budget × 100)`; 0 when the budget sum is 0.
- **Wypłacone premie w <rok>:** the sum of `milestone_results.payout_total` where `approved_at` falls in the current calendar year in Europe/Warsaw, plus the count of those rows.
- **Employee year total:** the sum of `bonus` over lines whose `approved_at` falls in the current Warsaw year, plus the count.
- **Latest bonus:** `lines[0]` in `listMyBonuses` order (`approved_at desc`, then `milestone_name asc`).
- **Milestones table rows:**
  - Included: every non-cancelled milestone of an open project, plus milestones approved in the current Warsaw year.
  - Order: awaiting approval first, then `active`, `planned`, other `completed`, then `approved` by `approved_at desc`. Ties within each group are broken by `start_date asc`, then `name asc`.
  - Cap: 8 rows. The header link "Wszystkie projekty →" goes to `/projects`.
- **Table KPI cell:**
  - approved rows: snapshot `multiplier / multiplier_max`
  - scored, unapproved rows: summary `multiplier / bonus_settings.multiplier_max`
  - otherwise "—"
- **Table action:**
  - awaiting approval and role supervisor: "Zatwierdź" (primary button) linking to the milestone page's approval section
  - approved: "Wyniki"
  - everything else, and every admin row: "Otwórz"

## Critical Implementation Details

- **Performance constraint:** call `milestone_payout_summary` only for scored, unapproved, non-cancelled milestones of open projects (known from the `kpi_*` columns before any RPC). Call them in parallel with `Promise.all`. One failed summary degrades only that row: its KPI shows "—" and it is not flagged as awaiting. It is logged through `mapLoadError` and never swallowed.
- **Year boundary:** the "current year" is computed in Europe/Warsaw, not UTC. An approval at `2026-12-31T23:30Z` belongs to 2027. The Supabase filter uses the Warsaw-year bounds converted to `timestamptz` (`[YYYY-01-01 00:00 Europe/Warsaw, (YYYY+1)-01-01 00:00 Europe/Warsaw)`).
- **Topbar ordering:** each page that renders `<Topbar />` must pass `languageSwitch={false}` to Layout in the same commit that adds the inline switch to the Topbar. Otherwise two switches render.

## Phase 1: Tokens, fonts and primitives

### Overview

Add the missing status roles and the app-wide font loading, then the shared building blocks the dashboard and Topbar need. Nothing visible changes on existing pages except the body font.

### Changes Required:

#### 1. Status tokens

**File**: `src/styles/global.css`

**Intent**: Add semantic `warning` (peach, for "awaiting/completed") and `info` (periwinkle, for "active") roles, so status colours stop borrowing artwork tokens or literals.

**Contract**:

- New `--warning`, `--warning-foreground`, `--info`, `--info-foreground` in `:root` and `.dark`, published as `--color-*` in `@theme inline`.
- `.dark` values are derived from `#f5c38a` / `#a5b4fc` (sRGB → OKLCH, 3 decimals, as in `context/archive/2026-10-18-new-landingpage-view/tokens.md`).
- Over-budget keeps `destructive`.
- A source comment next to the block names the mockup.

#### 2. Token record

**File**: `context/changes/new-dashboard-view/tokens.md` (new)

**Intent**: Record where each value came from and its contrast, so the next session doesn't invent them again.

**Contract**:

- Mockup hex → token → value table, covering the new roles and the reused ones: `primary`, `success`, `destructive`, `card`, `muted`, `muted-foreground`, `border`.
- WCAG contrast of `warning`/`info` text on `card` and on their own 15–18% tint, in the `.dark` theme, measured as in `context/archive/2026-10-01-ui-projects-panel/tokens.md`. Pill text must be at least 4.5:1.

#### 3. Fonts app-wide

**File**: `src/layouts/Layout.astro`, `src/pages/index.astro`, `src/styles/global.css`

**Intent**: Load the self-hosted landing fonts once for every page, so the migrated Topbar and the dashboard share them.

**Contract**:

- The 8 `@fontsource` imports move from `index.astro:2-9` to `Layout.astro`.
- The `index.astro:14` comment is updated: fonts now load in Layout; the landing still renders its own language switch.
- `body` uses `font-body` in the base layer.

#### 4. Badge variants

**File**: `src/components/ui/badge.tsx`

**Intent**: Give status pills token-driven variants instead of per-call `className` overrides.

**Contract**:

- New `success`, `warning` and `info` variants: tinted background + role foreground, for example `bg-warning/15 text-warning`.
- Existing variants are unchanged.
- The current call sites using `className="bg-success text-success-foreground"` are left alone (out of scope).

#### 5. Shared dashboard primitives

**File**: `src/components/ui/StatTile.astro`, `src/components/ui/ProgressBar.astro`, `src/components/MilestoneStatusBadge.astro` (new)

**Intent**: One stat tile, one bar and one status badge, reused by both dashboard variants (7 tiles, 5+ bars, 5 pills in the mockups).

**Contract**:

- `StatTile` props: `label`, `value`, `hint?`, `tone?: "default" | "warning" | "success"`, plus an optional slot for a bar. The value is set in `font-figures`.
- `ProgressBar` props: `value` (0–100, clamped), `tone?: "primary" | "destructive"`, `label` (accessible name). It renders `role="progressbar"` with `aria-valuenow`; the width goes through `style`.
- `MilestoneStatusBadge` props: `status: MilestoneStatus`, `awaiting?: boolean`, `locale`. Variants map:

  | Status                     | Variant     |
  | -------------------------- | ----------- |
  | `approved`                 | `success`   |
  | `completed`, or `awaiting` | `warning`   |
  | `active`                   | `info`      |
  | `planned`                  | `secondary` |
  | `cancelled`                | `outline`   |

  The label comes from `t.status.milestone.*`.

#### 6. Guard

**File**: `scripts/check-ui-literals.mjs`

**Intent**: Keep the new primitives clean from the start.

**Contract**: add `StatTile.astro`, `ProgressBar.astro` and `MilestoneStatusBadge.astro` to `CLEAN_PATHS`.

### Success Criteria:

#### Automated Verification:

- `npm run lint` and `npm run lint:ui` pass with the three new components in `CLEAN_PATHS`
- `npx astro sync && npx astro check` passes
- `npm test` passes
- `context/changes/new-dashboard-view/tokens.md` lists `warning`/`info` values with contrast of at least 4.5:1 for pill text

#### Manual Verification:

- The landing page `/` still renders the same fonts and its inline language switch, with no visual regression
- `/projects` renders in IBM Plex Sans with nothing broken

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Topbar migration

### Overview

Rebuild the shared app bar to the mockup header on tokens and components, and make every signed-in page use its inline language switch.

### Changes Required:

#### 1. Topbar

**File**: `src/components/Topbar.astro`

**Intent**: Match the mockup app bar (`Dashboard.dc.html:21-49`) using tokens only.

**Contract**:

- Full-width `header` with a bottom `border-border`, content capped at the page width:
  - `MeritlyLogo` (existing illustration component) + the "Meritly" wordmark in `font-heading`
  - `<nav aria-label>` with pill links (min height 40px via the spacing scale); the current page gets `aria-current="page"` and a `bg-primary/15` pill
  - `LanguageSwitch placement="inline"`
  - an avatar chip: the email's first letter on `bg-primary text-primary-foreground`, plus the email in `text-muted-foreground`
  - sign-out as `Button variant="outline"` in the existing form POST
- New optional prop `current?: "dashboard" | "projects" | "employees" | "reports" | "myBonuses" | "admin"`. Without it, no link is marked current.
- Role logic, link targets and accessible names stay the same. "Raporty" and "Wyloguj się" must not change.
- The signed-out variant is kept.
- Wraps on mobile; no horizontal scroll at 375px.

#### 2. Pages rendering Topbar

**File**: `src/pages/admin/settings.astro`, `src/pages/employees/index.astro`, `src/pages/employees/[id].astro`, `src/pages/my-bonuses.astro`, `src/pages/projects/index.astro`, `src/pages/projects/[id].astro`, `src/pages/projects/[id]/milestones/[milestoneId].astro`, `src/pages/reports/bonuses.astro`

**Intent**: Avoid two language switches, and mark the active nav item.

**Contract**:

- Each page passes `languageSwitch={false}` to `Layout` and the matching `current` to `<Topbar />`.
- Nothing else in these pages changes.

#### 3. Guard

**File**: `scripts/check-ui-literals.mjs`

**Intent**: Lock the shared chrome onto tokens.

**Contract**: add `src/components/Topbar.astro` to `CLEAN_PATHS`.

### Success Criteria:

#### Automated Verification:

- `npm run lint:ui` passes with `Topbar.astro` in `CLEAN_PATHS` (0 hits, down from 11)
- `npx astro check` and `npm test` pass
- `npm run smoke` passes (role × route, sign-out)
- `npm run test:e2e` passes, including `s-07-aggregate-bonus-report` ("Raporty" link) and `seed` ("Wyloguj się")

#### Manual Verification:

- On each of the 8 pages, the app bar matches the mockup header and exactly one PL/EN switch is visible
- Keyboard tab order: logo → nav → PL/EN → sign-out, each with a visible `ring` focus
- At 375px the bar wraps without horizontal scroll

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Dashboard data layer (TDD)

### Overview

Every figure on the dashboard is computed by a pure, unit-tested helper. Thin service functions fetch the inputs under RLS with the signed-in user's client.

### Changes Required:

#### 1. Pure helpers

**File**: `src/lib/dashboard.ts` (new), `src/lib/__tests__/dashboard.test.ts` (new)

**Intent**: Encode the planning definitions (Implementation Approach) once, test-first.

**Contract**:

- `warsawYearBounds(now: Date): { year: number; fromIso: string; toIso: string }`
- `isAwaitingApproval(milestone, projectStatus, summary | null): boolean`
- `reservedBudget(projects, exposures): { reserved: number; budget: number; percent: number }` (open projects only, sums in grosze like `history.ts`)
- `supervisorStats(...)`: active projects, active milestones, awaiting count, paid-this-year sum and count
- `dashboardRows(milestones, summaries, approvedResults, role): DashboardMilestoneRow[]` (order, cap 8, KPI cell, action kind)
- `attentionItems(awaiting, exposures, projects, overAllocated)`
- `employeeStats(lines, now)`: year total and count, latest line, project names
- Tests cover:
  - the Warsaw year boundary (`2026-12-31T23:30Z` → 2027)
  - the awaiting predicate on each failing condition (unscored, no engagements, closed project, cancelled, approved)
  - admin rows never get "approve"
  - cap and ordering, including ties
  - percent with a zero budget
  - an empty input for each helper

#### 2. Services

**File**: `src/lib/services/dashboard.ts` (new), `src/lib/services/__tests__/dashboard.test.ts` (new)

**Intent**: Fetch the cross-project inputs without N+1 on unscored rows, following the `ServiceResult` + `mapLoadError` pattern of `projects.ts`.

**Contract**:

- `listVisibleMilestones(supabase, log?)`: `milestones` with `MILESTONE_COLUMNS` + `kpi_*` + a `projects(name, status)` embed, under RLS.
- `getPayoutSummary(supabase, milestoneId, log?)`: the summary RPC only (no lines). It returns null when the milestone is not visible.
- `listApprovedResults(supabase, { fromIso, toIso }, log?)`: `milestone_results` (`milestone_id, multiplier, multiplier_max, payout_total, approved_at`) in the window.
- Reuses `listProjects`, `listProjectExposure`, `listEmployees` (no `ownerId`), `getBonusSettings`, `listMyBonuses` and `groupHistory` unchanged.
- Tests (mocked client, like `services/__tests__/projects.test.ts`): the error mapping and log codes for each new function, and that the embed and window filters are requested.

### Success Criteria:

#### Automated Verification:

- `npx vitest run src/lib/__tests__/dashboard.test.ts src/lib/services/__tests__/dashboard.test.ts` passes, and each test was seen failing before its helper existed
- `npm test` and `npx astro check` pass
- `npm run test:mutation -- --mutate src/lib/dashboard.ts` reports no surviving mutant in `isAwaitingApproval`, `warsawYearBounds` or `reservedBudget`

#### Manual Verification:

- Against the seeded local Supabase, a scratch call of `listVisibleMilestones` as the seeded supervisor returns rows with project names, confirming the `projects(...)` embed works under RLS

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Dashboard view

### Overview

Replace the placeholder with prop-driven section components for each role, all on tokens and shared components, with every string in the PL/EN catalogs.

### Changes Required:

#### 1. Section components

**File**: `src/components/dashboard/` (new):

- `DashboardGreeting.astro`
- `SupervisorStats.astro`
- `MilestonesTable.astro`
- `AttentionList.astro`
- `ProjectBudgets.astro`
- `EmployeeStats.astro`
- `LatestBonusBreakdown.astro`
- `BonusHistoryPreview.astro`

**Intent**: Render the mockup sections from props only (no `Astro.locals` reads except `locale`), so the kitchen sink can feed fixtures.

**Contract**:

- Each component takes its data, plus `error?: boolean` and `locale`, and renders:
  - its own empty state (copy from the catalog)
  - a `destructive` `Alert` when `error` is set
- Markup:
  - `ui/card` for the panels
  - `ui/table` for milestones, inside an `overflow-x-auto` wrapper
  - `StatTile`, `ProgressBar`, `MilestoneStatusBadge`
  - `ui/button` (`asChild`-style links) for the CTAs and "Zatwierdź"
  - figures in `font-figures` via `formatPln`
- `LatestBonusBreakdown` shows time share, role weight, rating → factor and KPI multiplier (no payout pool), the bonus highlighted in a `primary`-tinted bar, and the frozen-results note.
- `BonusHistoryPreview` shows at most 5 lines, the total, and "Zobacz wszystkie →" linking to `/my-bonuses`.
- The greeting reuses the existing `SupervisorAvatar` (supervisor), `AdminAvatar` (admin) and `EmployeeAvatar` (employee) from `src/components/landing/illustrations/`. No new artwork in this change.

#### 2. Page

**File**: `src/pages/dashboard.astro`

**Intent**: Use the shared shell and pick the variant by role.

**Contract**:

- Layout with `languageSwitch={false}` → `bg-cosmic` shell → `<Topbar current="dashboard" />` → `main` capped at the mockup width.
- Supervisor and admin: fetch in parallel, compute with `src/lib/dashboard.ts`, and pass `role`. Admin rows never offer "Zatwierdź", and the greeting uses the admin sentence.
- Employee: `listMyBonuses` + `groupHistory` + `employeeStats`. When `not_linked` is set, show the existing `t.myBonuses.notLinked` copy.
- No role: a token-clean card with `t.dashboard.noRole`.
- Each fetch failure sets only its section's `error`; the page still returns 200.

#### 3. Messages

**File**: `src/lib/i18n/messages/pl.ts`, `src/lib/i18n/messages/en.ts`

**Intent**: All new copy goes through the catalogs.

**Contract**:

- Extend the `dashboard` section with keys for the greeting sentences (plural forms via `plural()`), tile labels and hints, table headers and actions, attention items, budget panel, employee tiles, breakdown, history and the dashed note, plus the empty and error copy for each section.
- Unused keys (`authOnly`) are removed.
- Number formats stay pl-PL.

#### 4. Approval anchor

**File**: `src/components/milestones/ApprovalSection.astro`

**Intent**: "Zatwierdź" lands on the approval form, not the top of the milestone page.

**Contract**: the section root carries a stable `id` (add one if missing). The dashboard links to `/projects/{projectId}/milestones/{milestoneId}#<id>`.

#### 5. Guard

**File**: `scripts/check-ui-literals.mjs`

**Intent**: The dashboard becomes a guarded clean path.

**Contract**: add `src/pages/dashboard.astro` and every file in `src/components/dashboard/` to `CLEAN_PATHS`.

### Success Criteria:

#### Automated Verification:

- `npm run lint:ui` passes with `dashboard.astro` and `src/components/dashboard/*` in `CLEAN_PATHS` (dashboard hits 10 → 0)
- `npm run lint`, `npx astro check` and `npm test` pass
- `npm run smoke` passes (`/dashboard` anonymous 302, signed-in 200, after sign-out 302)

#### Manual Verification:

- Signed in as the seeded supervisor, `/dashboard` matches `Dashboard.dc.html` in layout and hierarchy at 1440px and at 375px, and the numbers agree with the project pages
- Signed in as admin: company-wide figures, and no "Zatwierdź" anywhere
- Signed in as the seeded employee, `/dashboard` matches `DashboardEmployee.dc.html`, the breakdown shows the KPI multiplier and no pool, and the history total equals `/my-bonuses`
- Switching to EN translates every dashboard string, and the figures stay pl-PL

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: States, visual gate and guard

### Overview

Prove the 7-state matrix in a kitchen sink, add the privacy smoke check, and leave the rule that keeps the next agent on the contract.

### Changes Required:

#### 1. Kitchen sink

**File**: `src/pages/dev/dashboard-kitchen-sink.astro` (new)

**Intent**: Show every dashboard section in every state on one page, as the visual gate.

**Contract**:

- Same dev-only 404 and `{isDev && …}` wrapper as `projects-kitchen-sink.astro:25-31`.
- Typed inline fixtures for the supervisor, admin and employee variants.
- A `states` table in the matrix below.

| State         | What the sink shows                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| default       | the supervisor, admin and employee variants                                                                               |
| hover         | links, buttons and table rows                                                                                             |
| focus-visible | the Topbar nav, CTAs and table actions                                                                                    |
| disabled      | N/A, with the reason that the dashboard has no disabled control: blocked approval shows "Otwórz", never a disabled button |
| error         | each section with `error`                                                                                                 |
| empty         | a supervisor with no projects, an employee with no lines, and an employee who is not linked                               |
| loading       | N/A, with the reason that the dashboard is server-rendered with no client fetch, so there is no layout jump               |

The file is added to `CLEAN_PATHS`.

#### 2. Privacy smoke check

**File**: `scripts/smoke.mjs`

**Intent**: The dashboard now shows figures, so it gets the same IDOR assertions as `/my-bonuses` (`smoke.mjs:286-300`).

**Contract**: "employee2 /dashboard shows only own Approved bonus" means `bodyIncludes [OWN_BONUS]` and `bodyExcludes [OTHER_BONUS, "Draft Milestone"]`, also with injected `?employee=…&milestone=…` query ids.

#### 3. Agent rule

**File**: `CLAUDE.md` (UI section, outside any CLI-managed block)

**Intent**: The next agent reuses the new pieces instead of re-inventing them.

**Contract**:

- Name the `warning`/`info` tokens and the Badge variants.
- Name `StatTile`, `ProgressBar` and `MilestoneStatusBadge`.
- Note that fonts load in Layout.
- Note `/dev/dashboard-kitchen-sink` as the gate for dashboard sections.
- Note that the Topbar takes `current`, and that pages rendering it pass `languageSwitch={false}`.

### Success Criteria:

#### Automated Verification:

- `npm run lint:ui` passes with the kitchen sink in `CLEAN_PATHS`
- `npm run smoke` passes, including both new employee2 `/dashboard` cases
- `npx astro check`, `npm test` and `npm run build` pass
- The literal scan on `src/pages/dashboard.astro`, `src/components/Topbar.astro` and `src/components/dashboard/*` returns 0 hits

#### Manual Verification:

- `/dev/dashboard-kitchen-sink` shows all 7 states (or N/A with a reason) for every section, with screenshots at 1440px and 375px attached to the change folder
- Focus rings are visible on every control in the sink, using the `ring` token
- `/dev/dashboard-kitchen-sink` returns 404 in `npm run build && npm run preview`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `src/lib/__tests__/dashboard.test.ts`:
  - Warsaw year bounds, including the New Year's Eve UTC case
  - the awaiting predicate, one failing condition per case
  - reserved aggregate excluding closed projects, and a zero budget
  - row ordering, ties, the 8-row cap, and the admin action never being "approve"
  - attention items
  - employee year total, latest line and project names; empty lists
- `src/lib/services/__tests__/dashboard.test.ts`: error mapping, log context and query shape for the three new service functions.

### Integration Tests:

- None new. RLS behaviour is unchanged and already covered by `supabase/tests/rls_matrix.test.sql:675-697`. The smoke IDOR cases cover the rendered page.

### Manual Testing Steps:

1. `npx supabase db reset --local`, then `npm run dev`. Sign in as the seeded supervisor and compare `/dashboard` with `Dashboard.dc.html` at 1440px and 375px.
2. On a scored, open milestone with engagements, check that it appears in "Do zatwierdzenia", in "Wymaga uwagi" and with "Zatwierdź". Approve it from the link, return, and check that it moves to `approved` with the snapshot multiplier.
3. Sign in as admin and check that the figures cover all projects and that there is no "Zatwierdź".
4. Sign in as employee1 and employee2 and check that each sees only their own amounts and that the history total equals `/my-bonuses`.
5. Tab through the Topbar and the dashboard and check that focus is visible everywhere.

## Performance Considerations

- Supervisor or admin load: 6 base queries in parallel (projects, exposure, milestones, approved results, employees with time share, bonus settings), plus one summary RPC per scored, unapproved milestone in an open project, also in parallel.
- If an admin with many scored open milestones makes this slow, the follow-up is the `security_invoker` view rejected in planning. It is recorded here, not built.

## Migration Notes

Not applicable: no schema or data change.

## References

- Research: `context/changes/new-dashboard-view/research.md`
- Mockups: `reports/design/project/Dashboard.dc.html`, `reports/design/project/DashboardEmployee.dc.html`
- Token method: `context/archive/2026-10-18-new-landingpage-view/tokens.md`, `context/archive/2026-10-01-ui-projects-panel/tokens.md`
- Kitchen-sink pattern: `src/pages/dev/projects-kitchen-sink.astro:25-31,245-276`
- Approval rule: `src/pages/projects/[id]/milestones/[milestoneId].astro:153-172`
- Privacy split: `supabase/migrations/20261005120000_milestone_approval.sql:18-26`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Tokens, fonts and primitives

#### Automated

- [x] 1.1 `npm run lint` and `npm run lint:ui` pass with the three new components in `CLEAN_PATHS` — 3e65928
- [x] 1.2 `npx astro sync && npx astro check` passes — 3e65928
- [x] 1.3 `npm test` passes — 3e65928
- [x] 1.4 `context/changes/new-dashboard-view/tokens.md` lists `warning`/`info` values with contrast of at least 4.5:1 for pill text — 3e65928

#### Manual

- [x] 1.5 The landing page `/` still renders the same fonts and its inline language switch, with no visual regression — 3e65928
- [x] 1.6 `/projects` renders in IBM Plex Sans with nothing broken — 3e65928

### Phase 2: Topbar migration

#### Automated

- [x] 2.1 `npm run lint:ui` passes with `Topbar.astro` in `CLEAN_PATHS` (0 hits, down from 11) — b5fec1a
- [x] 2.2 `npx astro check` and `npm test` pass — b5fec1a
- [x] 2.3 `npm run smoke` passes (role × route, sign-out) — b5fec1a
- [x] 2.4 `npm run test:e2e` passes, including `s-07-aggregate-bonus-report` ("Raporty" link) and `seed` ("Wyloguj się") — b5fec1a

#### Manual

- [x] 2.5 On each of the 8 pages, the app bar matches the mockup header and exactly one PL/EN switch is visible — b5fec1a
- [x] 2.6 Keyboard tab order: logo → nav → PL/EN → sign-out, each with a visible `ring` focus — b5fec1a
- [x] 2.7 At 375px the bar wraps without horizontal scroll — b5fec1a

### Phase 3: Dashboard data layer (TDD)

#### Automated

- [x] 3.1 `npx vitest run src/lib/__tests__/dashboard.test.ts src/lib/services/__tests__/dashboard.test.ts` passes, and each test was seen failing before its helper existed — 5c147bb
- [x] 3.2 `npm test` and `npx astro check` pass — 5c147bb
- [x] 3.3 `npm run test:mutation -- --mutate src/lib/dashboard.ts` reports no surviving mutant in `isAwaitingApproval`, `warsawYearBounds` or `reservedBudget` — 5c147bb

#### Manual

- [x] 3.4 Against the seeded local Supabase, a scratch call of `listVisibleMilestones` as the seeded supervisor returns rows with project names, confirming the `projects(...)` embed works under RLS — 5c147bb

### Phase 4: Dashboard view

#### Automated

- [x] 4.1 `npm run lint:ui` passes with `dashboard.astro` and `src/components/dashboard/*` in `CLEAN_PATHS` (dashboard hits 10 → 0) — 9c17fe6
- [x] 4.2 `npm run lint`, `npx astro check` and `npm test` pass — 9c17fe6
- [x] 4.3 `npm run smoke` passes (`/dashboard` anonymous 302, signed-in 200, after sign-out 302) — 9c17fe6

#### Manual

- [x] 4.4 Signed in as the seeded supervisor, `/dashboard` matches `Dashboard.dc.html` in layout and hierarchy at 1440px and at 375px, and the numbers agree with the project pages — 9c17fe6
- [x] 4.5 Signed in as admin: company-wide figures, and no "Zatwierdź" anywhere — 9c17fe6
- [x] 4.6 Signed in as the seeded employee, `/dashboard` matches `DashboardEmployee.dc.html`, the breakdown shows the KPI multiplier and no pool, and the history total equals `/my-bonuses` — 9c17fe6
- [x] 4.7 Switching to EN translates every dashboard string, and the figures stay pl-PL — 9c17fe6

### Phase 5: States, visual gate and guard

#### Automated

- [x] 5.1 `npm run lint:ui` passes with the kitchen sink in `CLEAN_PATHS`
- [x] 5.2 `npm run smoke` passes, including both new employee2 `/dashboard` cases
- [x] 5.3 `npx astro check`, `npm test` and `npm run build` pass
- [x] 5.4 The literal scan on `src/pages/dashboard.astro`, `src/components/Topbar.astro` and `src/components/dashboard/*` returns 0 hits

#### Manual

- [x] 5.5 `/dev/dashboard-kitchen-sink` shows all 7 states (or N/A with a reason) for every section, with screenshots at 1440px and 375px attached to the change folder
- [x] 5.6 Focus rings are visible on every control in the sink, using the `ring` token
- [x] 5.7 `/dev/dashboard-kitchen-sink` returns 404 in `npm run build && npm run preview`
