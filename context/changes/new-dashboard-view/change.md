---
change_id: new-dashboard-view
title: Restyle /dashboard to the supervisor and employee mockups
status: impl_reviewed
created: 2026-10-18
updated: 2026-10-20
archived_at: null
---

## Notes

**View (one):** `src/pages/dashboard.astro` (route `/dashboard`). It has two role variants in a single file: supervisor/admin and employee.

**Mockups:** `reports/design/project/Dashboard.dc.html` ("Panel — Przełożony") and `reports/design/project/DashboardEmployee.dc.html` ("Panel — Pracownik"). `Main.dc.html` is the landing page, already delivered in `context/archive/2026-10-18-new-landingpage-view`.

**Token source:** `src/styles/global.css` (`:root` / `.dark`, published through `@theme inline`). The mockup hexes map onto it the same way as in `context/archive/2026-10-18-new-landingpage-view/tokens.md`: `#d2b1f7` → `primary`, `#34d39a` → `success`, font families → `font-heading` / `font-body` / `font-figures`. Deposit any new values in `context/changes/new-dashboard-view/tokens.md`.

**Contract variant:** existing design system. Extend the tokens and `src/components/ui/` (Card, Badge, Button, Table, Alert). Use `Topbar.astro` for the app bar. No second palette and no `shadcn init`.

**Scope caveat for research:** most of the mockup content isn't on the current page. The page today is a centered card with the email, the role, nav links and a sign-out button. The supervisor variant adds stat tiles, a milestones table, a "Wymaga uwagi" list and project budget bars. The employee variant adds bonus totals, a breakdown of the latest bonus and a history. Research must find which of these figures existing services or RLS-safe queries already provide (`BudgetExposurePanel`, `EmployeeHistory`, `/my-bonuses`). Anything needing new queries is feature work: the plan either scopes it in explicitly or defers it.

**Pre-audit (2026-10-18):** the literal scan finds 10 hits in `dashboard.astro` and 11 in `Topbar.astro`. Neither file is in `CLEAN_PATHS`.
