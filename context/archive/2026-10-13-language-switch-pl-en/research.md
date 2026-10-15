---
date: 2026-10-13T19:50:43+02:00
researcher: Claude (Opus 5.5) for ssliwa
git_commit: aa3a917
branch: develop
repository: 10x-Meritly
topic: "Where user-facing text lives and what a PL/EN switch reachable from the first page has to touch"
tags: [research, codebase, i18n, layout, middleware, route-access, services, edge-functions, e2e, smoke]
status: complete
last_updated: 2026-10-13
last_updated_by: Claude (Opus 5.5) for ssliwa
---

# Research: PL translation + PL/EN language switch

**Date**: 2026-10-13T19:50:43+02:00
**Researcher**: Claude (Opus 5.5) for ssliwa
**Git Commit**: aa3a917
**Branch**: develop
**Repository**: 10x-Meritly

## Research Question

From `change.md`: "Translate all application text to Polish. Enable switch from EN to PL and PL to EN directly from first page of application." What text exists, where it lives, how it flows to the screen, and which contracts (routing, auth gate, tests, emails) a locale switch would touch.

## Summary

- **No i18n exists today.** `astro.config.mjs` has no `i18n` block, `package.json` has no i18n package, `src/layouts/Layout.astro:14` hardcodes `<html lang="en" class="dark">`, and `App.Locals` (`src/env.d.ts`) carries only `user`, `profile`, `profileError`.
- **The app is mostly English with some Polish already mixed in**: the config banner (`Layout.astro:22,28`, `src/lib/config-status.ts:15`), KPI labels Termin/Budżet/Jakość/Ryzyko (`KpiScoresSection.astro:31-34`, `KpiSettingsSection.astro:14-17`, `payouts.ts:30-35`), and seeded job-role names (`supabase/migrations/20260926120000_bonus_rules_config.sql:181-188`, user data).
- **Number formatting is already pl-PL whatever the language**: `src/lib/format.ts:1,8,15,35` (PLN, percent, multiplier, share). Dates use `en-CA` deliberately for `YYYY-MM-DD` (`format.ts:23`). Prior plans settled pl-PL money formatting (see Historical Context).
- **Errors and success messages already travel as codes.** API routes redirect with `?error=<code>&field=…` / `?saved=<code>` / `?notice=<code>`, and pages resolve them through per-service English maps in `src/lib/services/*.ts`. That makes the catalogs the natural place to translate. One exception passes free text: `src/pages/api/auth/signup.ts:11,16` puts `"Supabase is not configured"` and Supabase's raw `error.message` into `?error=`.
- **DB `raise exception` messages never reach the UI.** The services map SQLSTATE/MR codes to their own strings and only log `error.message` (e.g. `src/lib/services/projects.ts:232-254`). SQL needs no translation.
- **Statuses are rendered as raw enum values** (`planned|active|completed|cancelled|approved`) with CSS `capitalize`, including inside English sentences (`MilestonesSection.astro:71`, `[milestoneId].astro:137,152,323-324`) and `<option>{status}</option>` (`ProjectForm.astro:78`, `MilestoneForm.astro:52`). A label map is needed; none exists.
- **Cookie locale is much cheaper than a URL prefix.** `decideAccess` matches with `pathname.startsWith` and has **no deny-by-default** (`src/lib/route-access.ts:8-9,49-50,81`), so `/pl/dashboard` would be allowed through the gate unless the prefix is stripped first. A prefix would also break `route-classification.test.ts` (walks `src/pages`), the hard-coded redirect targets, and URL assertions in smoke/e2e. A `lang` cookie doesn't collide with Supabase's `sb-*` cookies (`src/lib/supabase.ts:11-17`).
- **Placement for "switch from the first page"**: `/` renders `Welcome` (starter boilerplate) with `Topbar`. Anonymous users also land on `/auth/signin`, which has no Topbar. Only `Layout.astro` is rendered by every page, so a switch there shows up on every page including the first one.
- **Tests pin English copy** in e2e (`auth.setup.ts`, `seed.spec.ts`, `us-01…spec.ts`), smoke (`scripts/smoke.mjs`, about 10 needles), and one unit test (`approvals.test.ts:141`). The default locale decides whether these keep passing unchanged.
- **Emails**: the invite email is a Supabase Auth template (`supabase/templates/invite.html`, subject at `supabase/config.toml:232`, hosted copy configured separately in the dashboard). The approval email is built in `supabase/functions/notify-milestone-approved/index.ts:109-147`. Both are English. **No per-user language preference is stored anywhere** (`profiles` = id, email, display_name, role, created_at; `employees` has no locale). Employees without an account also get the approval email.

## Detailed Findings

### First page, layout, where a switch is visible

- `src/pages/index.astro:6-8` renders `<Layout><Welcome/></Layout>` for every user, with no redirect for signed-in users.
- `src/components/Welcome.astro` is starter copy ("10x Astro Starter" `:23`, Sign In/Up CTAs `:30-41`, feature cards `:62-109`). It is a candidate to replace, not translate.
- `src/components/Topbar.astro`:
  - signed in (`:8-36`): email, Dashboard, role links, Sign out;
  - anonymous (`:37-48`): "Not signed in", Sign in, Sign up.
- Topbar is rendered by Welcome, admin/settings, employees/_, my-bonuses and projects/_. It is **not** rendered by auth/*, dashboard.astro, admin/index.astro or the dev kitchen sink.
- Every page uses `Layout.astro`, which has the default title "10x Astro Starter" (`:10`) and `lang="en"` (`:14`).
- Landing paths for anonymous users:
  - protected route → `/auth/signin?next=…` (`route-access.ts:63-67`);
  - sign-out → `/` (`api/auth/signout.ts:9`);
  - sign-in success → `next ?? "/"` (`api/auth/signin.ts:26`).

### Middleware, routing and the auth gate

- `src/middleware.ts`:
  - builds the Supabase client (`:9`), resolves the user (`:18`) and selects the profile `id, email, display_name, role` (`:23-27`);
  - calls `decideAccess` (`:39-44`);
  - on refusal returns plain-text English `"Forbidden"` (`:50`) and `"Service temporarily unavailable"` (`:52`).
- `src/lib/route-access.ts`:
  - `PUBLIC_ROUTES` are exact paths (`:13-24`), and the protected/role lists are prefixes (`:27-46`).
  - `matchesRoute` is `startsWith` (`:49-50`).
  - Unlisted paths are allowed (`:8-9` comment, `:81` `return { kind: "allow" }`).
- `src/lib/__tests__/route-classification.test.ts` walks `src/pages` and requires every page to be classified. Duplicate pages under `src/pages/pl/` or a `[locale]` folder would fail it or need new entries.
- Redirect targets are hard-coded and unprefixed: `route-access.ts:67`, `middleware.ts:60`, `api/auth/signin.ts:15,23,26`, `api/auth/signup.ts:19`, `set-password.ts:33,36`, `auth/confirm.ts:41`.
- Astro i18n (Context7, `/withastro/docs`): `i18n.routing: "manual"` disables Astro's i18n middleware. `Astro.preferredLocale` is computed from `Accept-Language` for on-demand pages. `Astro.currentLocale` is derived from a URL `/[locale]/` prefix and otherwise defaults to `defaultLocale`. In other words, Astro's built-in locale model is URL-based, and a cookie approach is custom middleware code.

### Text inventory in `src/` (counts approximate; ±20% for files searched rather than read)

| Area           | Files (approx. visible strings)                                                                                                                                                                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout/landing | `Topbar.astro` (~7), `Welcome.astro` (~10, boilerplate), `dashboard.astro` (~8, shows raw role `:18`), `Layout.astro` (title + Polish banner)                                                                                                                                             |
| Auth           | `auth/signin.astro` (~9, `SIGNIN_ERROR_MESSAGES` `:8-14`), `signup.astro` (~4), `confirm-email.astro` (~6, `content` object `:9-17`), `set-password.astro` (~7), `SignInForm.tsx` (~8), `SignUpForm.tsx` (~14, hand-built English plural `:60-61`), `PasswordToggle.tsx:14` (aria-labels) |
| Projects       | `projects/index.astro` (~18), `projects/[id].astro` (~7), `ProjectForm.astro` (~14), `MilestoneForm.astro` (~9), `MilestonesSection.astro` (~13), `BudgetExposurePanel.astro` (~7)                                                                                                        |
| Milestones     | `projects/[id]/milestones/[milestoneId].astro` (~45, largest), `KpiScoresSection.astro` (~9), `PayoutSection.astro` (~22), `ApprovalSection.astro` (~12), `EngagementForm.astro` (~9)                                                                                                     |
| Employees      | `employees/index.astro` (~30), `employees/[id].astro` (~25), `EmployeeForm.astro` (~8); `STATUS_LABELS` duplicated at `employees/index.astro:68-72` and `employees/[id].astro:45-49`                                                                                                      |
| Admin          | `admin/index.astro` (~5), `admin/settings.astro` (~6), `JobRolesSection.astro` (~14), `KpiSettingsSection.astro` (~8), `RatingFactorsSection.astro` (~5)                                                                                                                                  |
| History        | `EmployeeHistory.astro` (~10, English plural helper `:18`), `my-bonuses.astro` (~8)                                                                                                                                                                                                       |
| UI primitives  | `components/ui/*`: no visible strings found                                                                                                                                                                                                                                               |
| Dev            | `dev/projects-kitchen-sink.astro` (~40 plus fixtures; copies catalog strings, 404 in production)                                                                                                                                                                                          |

Total: roughly 450 strings across about 40 files, with an equal amount again in the service catalogs below.

**Label-as-logic hazards** (strings used as control values, which break once translated):

- `BudgetExposurePanel.astro:49`: `figure.label !== "Budget"` decides the destructive styling (verified).
- `PayoutSection.astro:19,76`: `UNSCORED = "Enter KPI scores"` is also used as a sentinel.

### Service catalogs (`src/lib/services/*`, `src/lib/set-password.ts`)

All six service modules follow the same shape: `X_ERROR_MESSAGES` (code → English with `{field}`), `FIELD_LABELS`, `GENERIC_ERROR_MESSAGE`, a resolver doing `.replace("{field}", label)` with a `"Value"` fallback, and a free-text `mapLoadError` ("Could not load X. Please try again.").

| Module            | Error map | Field labels                      | Load error | Extra                                                          |
| ----------------- | --------- | --------------------------------- | ---------- | -------------------------------------------------------------- |
| `projects.ts`     | `:13-37`  | `:41-50`                          | `:255`     |                                                                |
| `employees.ts`    | `:22-39`  | `:43-48`                          | `:189`     |                                                                |
| `engagements.ts`  | `:19-36`  | `:40-44`                          | `:178`     |                                                                |
| `payouts.ts`      | `:14-26`  | `:30-35` (Polish)                 | `:148`     |                                                                |
| `bonus-config.ts` | `:18-36`  | `:40-50` (mixed: "Termin weight") | `:212`     | "Bonus settings are missing" `:253`                            |
| `approvals.ts`    | `:13-29`  | none                              | `:159`     | `APPROVAL_NOTICE_MESSAGES` `:51-56`, which names button labels |

- `set-password.ts:9-21` follows the same pattern.
- `src/lib/forms.ts:55-59`: zod issue messages are codes, and `firstIssueError` maps unknown ones to `invalid_form`. Zod never produces visible text.
- Load errors come back as strings rather than codes (e.g. shown at `projects/index.astro:66`, `my-bonuses.astro:24`). To translate them, the services need either a locale argument or to return codes.

### React islands

- Only `SignInForm.tsx`, `SignUpForm.tsx` and `PasswordToggle.tsx` hardcode text: labels, placeholders, client-side validation and aria-labels.
- `SubmitButton.tsx` receives its label and `pendingText` from Astro (e.g. `ProjectForm.astro:124-125`).
- The forms get `serverError` already resolved by the page (`signin.astro:34`, `signup.astro:14`).
- So the islands need their strings passed in as props, or a small client dictionary.

### Database and seed

- `raise exception` messages are English with SQLSTATEs MR001–MR015, e.g. `20260927120000_projects_and_milestones.sql:151`, `20261005120000_milestone_approval.sql:235-555`. Each service in the inspected set maps codes and logs messages (`projects.ts:232-254`, `employees.ts:169-188`, `engagements.ts:159-177`, `payouts.ts:131-147`, `approvals.ts:142-158`, `bonus-config.ts:202-211`).
- Seed data names are English ("Approved Demo Project", "Local Employee 2", "Approved Milestone", `supabase/seed.sql:107,182,193,203-204`). Smoke and e2e depend on them (`scripts/smoke.mjs:158-264`, `us-01…spec.ts:15`). These are user data, not UI text.

### Emails

- **Invite.** Supabase Auth `inviteUserByEmail` (`supabase/functions/invite-employee/index.ts:75-78`, `data: { display_name }` only). Template `supabase/templates/invite.html:1-9` (English); subject "You're invited to Meritly" at `supabase/config.toml:232`. The production template lives in the hosted dashboard (`config.toml:229-230` comment). A single Supabase template can't switch language unless it branches on `{{ .Data.* }}` metadata.
- **Approval.** `notify-milestone-approved/index.ts`:
  - subject `:116`, text `:118-130`, HTML `:133-144`, `NO_ACCOUNT_LINE` `:42-43`;
  - amounts in pl-PL (`:107`), period as raw ISO (`:113`);
  - recipients from `milestone_result_lines` joined to `employees` (`:320-326`).
- Both functions return code-only error JSON that the app maps to text (`employees.ts:37,337-338`, `approvals.ts:13-27,298-300`).
- No tests assert email subject or body text. The notify integration test asserts pl-PL amounts only (`tests/integration/notify-milestone-approved.integration.test.ts:40-41,326-331`).

### Tests coupled to English copy

| File                                               | English UI assertions                                                                                                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/e2e/auth.setup.ts:17-24`                    | 4 distinct names: "Email", "Password", "Sign in", "Sign out"                                                                                                                           |
| `tests/e2e/seed.spec.ts:20-35`                     | 6 distinct names: heading "Sign in", "Email", "Password", button "Sign in", "Projects", "Sign out"                                                                                     |
| `tests/e2e/us-01-…spec.ts:150-160`                 | 4: "Approved bonuses", /I understand this is final/, "Approve milestone", "Milestone approved."                                                                                        |
| `scripts/smoke.mjs`                                | "This page is only for admins." (`:30`), "All approved bonuses" (`:264`), "Employee not found." (`:269,274`), "Approved bonuses on your projects" / "Current assignments" (`:248-256`) |
| `src/lib/services/__tests__/approvals.test.ts:141` | 1 exact notice message                                                                                                                                                                 |

Inspected but containing no English UI text assertions: forms.test, route-access.test, safe-next.test, route-classification.test, assignments.test, history.test, and the notify integration test. `scripts/check-ui-literals.mjs` checks colours and px values only.

## Code References

- `src/layouts/Layout.astro:10,14,22-33`: default title, `lang="en"`, Polish config banner.
- `src/middleware.ts:23-27,39-62`: profile select, access decision, plain-text 403/503.
- `src/env.d.ts`: `App.Locals` (user, profile, profileError).
- `src/lib/route-access.ts:8-9,49-50,81`: prefix matching, no deny-by-default.
- `src/lib/format.ts:1-35`: pl-PL number formats, en-CA date.
- `src/pages/api/auth/signup.ts:11,16`: free-text error in URL.
- `src/components/projects/BudgetExposurePanel.astro:49`: label used as logic.
- `src/components/milestones/PayoutSection.astro:19,76`: label used as sentinel.
- `src/lib/services/*.ts`: code→message catalogs (table above).
- `supabase/templates/invite.html`, `supabase/config.toml:229-233`: invite email.
- `supabase/functions/notify-milestone-approved/index.ts:41-147`: approval email.
- `supabase/migrations/20260925120000_role_and_rls_scaffold.sql:12-18`: `profiles` columns (no locale).

## Architecture Insights

- **The code-in-URL, map-at-render design is already the i18n seam.** Each catalog lookup can take a locale and pick from a `{ en, pl }` dictionary without changing any API route or redirect contract.
- **SSR pages render once per request.** Resolving the locale in middleware (cookie → `Accept-Language` → default) into `context.locals.locale` lets every `.astro` page and service resolver read it synchronously. React islands get strings as props, consistent with how `SubmitButton` already works.
- **A switch can be a plain form POST** to a new public endpoint that sets the cookie and redirects back (validated with `safeNext`). It works without JS, fits the existing POST-redirect pattern, and needs a `PUBLIC_ROUTES` entry plus route-classification coverage.
- Adding a `profiles.locale` column (only needed for per-user email language or cross-device persistence) triggers the CLAUDE.md RLS rule: update `rls_catalog_guard.test.sql` and `rls_matrix.test.sql`.

## Historical Context (from prior changes)

- `context/archive/2026-09-27-supervisor-creates-project-and-milestones/plan.md:393`: `formatPln` uses pl-PL. Still current (`format.ts:1`).
- `context/archive/2026-09-29-supervisor-assigns-employee-engagement/plan.md:384`: `formatPercent` uses pl-PL. Still current (`format.ts:8`).
- `context/archive/2026-10-04-supervisor-scores-milestone-and-sees-computed-bonuses/plan.md:217`: `formatMultiplier` in the Polish locale ("1,1875"). Still current (`format.ts:15`).
- `context/archive/2026-10-05-supervisor-approves-milestone-employee-sees-bonus/plan.md:487`: email amounts use pl-PL PLN. Still current (`notify-milestone-approved/index.ts:107`).
- `context/archive/2026-10-10-testing-route-gating-notification/plan.md:69`: tests normalise the pl-PL non-breaking space. Relevant if number formats ever follow the UI locale.
- No foundation doc (`prd.md`, `tech-stack.md`, `roadmap.md`, `shape-notes.md`, `infrastructure.md`) mentions i18n, locale or UI language. `prd.md:84` uses Polish KPI names, and `prd.md:146` sets PLN rounding.

## Related Research

Not applicable. No earlier research covers localisation.

## Open Questions (product decisions for /10x-plan)

1. **Default locale.** PL by default (matching "translate all to Polish"), or `Accept-Language` with EN as the fallback? Either way, the e2e and smoke English assertions either need updating or need to pin a locale (cookie or `Accept-Language` in the test context).
2. **Persistence.** A cookie only (anonymous-friendly, works on the first page before sign-in), or also a `profiles.locale` column (follows the user across devices, needed for per-user emails, costs a migration plus RLS test updates)?
3. **Emails in scope?**
   - The approval email can be localised in the edge function only if the recipient's language is known. Employees without accounts have no profile, so a column on `employees` or a fixed language would be needed.
   - The invite template is single-language unless it branches on user metadata, and the hosted dashboard copy is updated by hand.
4. **Number and date formats.** Keep pl-PL numbers in EN mode (current settled decision), or switch them to `en-US`/`en-GB` in EN mode? The second option affects tests that assert "400,00 zł".
5. **Welcome page.** Translate the starter boilerplate or replace it with a real Meritly landing page that carries the switch?
6. **Middleware plain-text 403/503 and the dev kitchen sink**: in scope or not?
7. **Supabase Auth error text on signup** (`signup.ts:16`): map known Supabase error codes to catalog codes like signin does, or show a generic localised message?

## Inspection scope and gaps

- Read in full: Layout, Topbar, Welcome, dashboard, auth pages and components and API routes, projects pages and components, `forms.ts`, `set-password.ts`, `format.ts`, `config-status.ts`, `route-access.ts`, `middleware.ts`, `astro.config.mjs`, both edge functions, `invite.html`, `seed.sql`, all test files under `tests/`, `src/**/__tests__`, `scripts/smoke.mjs`.
- Covered by targeted search only: the milestones, employees, admin and history components, the service modules beyond the cited maps, and the kitchen sink. String counts there are estimates.
- Not inspected: the hosted Supabase dashboard invite template; whether Supabase Auth exposes stable error codes for signup failures.
