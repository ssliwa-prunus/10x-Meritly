# Supervisor Creates Project and Milestones Implementation Plan

## Overview

S-02 lets a Supervisor create projects (name, period, status, total bonus budget, notes) and milestones inside them (name, period, target bonus pool, status, notes). Admins can create, edit and reassign projects, and can read milestones but not change them. Each project shows its worst-case payout exposure (FR-017): every non-cancelled milestone reserves `floor(target_pool × multiplier_max)`, rounded down to the grosz. The reservation is computed in a SQL view at read time and is informational only. This is the only part of the variant-A bonus algorithm that S-02 implements (research Part 1, Part 2 Summary).

## Current State Analysis

- There are no project or milestone tables, types, routes or pages yet. `supabase/migrations/` holds two migrations: F-01 profiles/roles and S-01 bonus config.
- Role helpers `public.is_admin()` and `public.is_supervisor()` check the role only; nothing checks ownership ([20260925120000_role_and_rls_scaffold.sql:62-87](../../../supabase/migrations/20260925120000_role_and_rls_scaffold.sql)).
- `bonus_settings.multiplier_max` is `numeric(4,2)`, with `0 < min < max <= 3` enforced by CHECK and a default of 1.30. Supervisors and Admins can read it under RLS ([20260926120000_bonus_rules_config.sql:45-46,62-64,142-152,177](../../../supabase/migrations/20260926120000_bonus_rules_config.sql)).
- The middleware guards only `/admin` and `/api/admin` by role (admin only). Routes outside `PROTECTED_ROUTES` get no sign-in redirect ([src/middleware.ts:5-6,43-56](../../../src/middleware.ts)).
- The app pattern is established by S-01:
  - native `<form method="POST">` to `POST: APIRoute` endpoints;
  - zod issue messages are error codes;
  - every response is a 302 redirect with `?saved=` / `?error=&field=&section=`, and the page resolves codes from a fixed catalog;
  - a request-scoped Supabase client, so RLS always applies.

  See [src/lib/services/bonus-config.ts:12-66,164-225](../../../src/lib/services/bonus-config.ts) and [src/pages/api/admin/job-roles/[id].ts](../../../src/pages/api/admin/job-roles/[id].ts).

- `parseForm` and `firstIssueError` are generic in behaviour but hard-wired to the settings error catalog ([bonus-config.ts:58-59,164-185](../../../src/lib/services/bonus-config.ts)).
- The existing decimal check tolerates floating-point noise ([bonus-config.ts:77](../../../src/lib/services/bonus-config.ts)), and S-01 impl-review F3 left it unfixed. Money needs a strict string regex instead.
- pgTAP suites run in CI (`supabase test db`, [.github/workflows/ci.yml:43-44](../../../.github/workflows/ci.yml)). A structural guard fails when a public table lacks RLS or a public view lacks `security_invoker` ([supabase/tests/profiles_rls.test.sql:180-205](../../../supabase/tests/profiles_rls.test.sql)). Free fixture range: `…03xx`.
- `seed.sql` creates `supervisor@meritly.local` (`…0002`) and `admin@meritly.local` (`…0001`) with one shared password ([supabase/seed.sql:5-9,49-51,83-84](../../../supabase/seed.sql)).
- No page links to `/admin` or any feature page; `Topbar.astro` only has Dashboard and Sign out ([src/components/Topbar.astro](../../../src/components/Topbar.astro)).

## Desired End State

- A signed-in Supervisor can:
  - open **/projects** and see their own projects, each with budget, reserved amount, remaining amount and an over-budget flag;
  - create a project;
  - open **/projects/[id]** to edit it and to add or edit its milestones.
- A signed-in Admin sees all projects with their owners, can create a project for any Supervisor, can edit or reassign any project, and sees milestones read-only.
- An Employee gets 403 on these routes, and RLS returns no rows even if the routes are bypassed.
- The database guarantees:
  - money has two decimals and is above 0;
  - every period has `end ≥ start`, and a milestone's period lies inside its project's period;
  - a project's owner is always a current Supervisor;
  - a completed or cancelled project's milestones cannot be inserted or edited;
  - a Supervisor who owns projects cannot have their role changed;
  - project names are unique company-wide, and milestone names are unique within their project (both case-insensitive);
  - nothing is deleted.
- `project_budget_exposure` returns, per visible project:

  | Column           | Definition                                                                     |
  | ---------------- | ------------------------------------------------------------------------------ |
  | `reserved_total` | Σ `money_floor_mul(target_pool, multiplier_max)` over non-cancelled milestones |
  | `remaining`      | `total_budget − reserved_total`                                                |
  | `over_budget`    | `reserved_total > total_budget`                                                |

  Example: a 10 000.00 budget with milestones 3 000.00 (active), 3 000.00 (active) and 2 000.00 (cancelled), at multiplier_max 1.30, gives `reserved_total` 7 800.00, `remaining` 2 200.00 and `over_budget` false.

- Verified by: the pgTAP suite passing in `supabase test db`, lint, `astro check`, build and smoke, plus the manual walkthrough in Testing Strategy.

### Key Discoveries:

- Supervisors can already select every profile ([role_and_rls_scaffold.sql:104-108](../../../supabase/migrations/20260925120000_role_and_rls_scaffold.sql)), so project rows need their own ownership predicate.
- Deliberately absent policies carry a header comment ([bonus_rules_config.sql:108-116](../../../supabase/migrations/20260926120000_bonus_rules_config.sql)); follow that.
- `set_config_audit_fields()` sets `updated_at` and `updated_by = auth.uid()`, and its body is table-agnostic ([bonus_rules_config.sql:86-106](../../../supabase/migrations/20260926120000_bonus_rules_config.sql)). Reuse it rather than add a twin.
- PostgREST returns a custom SQLSTATE raised in PL/pgSQL unchanged in the error `code` field. Codes prefixed `PT` are reserved for HTTP status mapping, so use an `MR…` prefix ([PostgREST errors docs](https://docs.postgrest.org/en/v14/references/errors.html)).
- A Postgres `numeric(p,2)` cast rounds half away from zero. Computed money must be floored explicitly before it is stored or compared, and input must be rejected, not rounded, above two decimals (research "Follow-up: money representation").
- Under RLS, a denied insert raises `42501` and a denied update affects 0 rows (archive pgTAP conventions, research Historical Context).

## What We're NOT Doing

- No KPI scores, multiplier computation, `payout_pool`, per-employee split or residual (S-04).
- No `approved` status, frozen payout pools or approval flow (S-05). S-02 statuses are `planned`, `active`, `completed`, `cancelled`.
- No employee engagement or time-share (S-03), and no employee access to projects or milestones (S-05/S-06 add employee select policies).
- No deletion of projects or milestones, by any role. Mistakes are set to `cancelled`.
- No milestone writes by Admins; an Admin reassigns the project to a Supervisor instead.
- No blocking of saves by the budget check. FR-017 stays an informational flag.
- No enforced status transitions beyond the closed-project lock. Project and milestone status can be set freely.
- No role-management UI. Role changes still happen in Studio or SQL; the new trigger guards them.
- No moving a milestone to another project (`project_id` is immutable).
- No smoke-test extension. `scripts/smoke.mjs` stays auth-only; project flows are covered by pgTAP and manual checks.
- No fixes to the S-01 settings validation (F3 on `decimalField`). Only the shared form helpers move.

## Implementation Approach

The design is database first: every guarantee lives in Postgres (CHECKs, unique indexes, RLS policies, triggers, one view), and phase 1 proves it with pgTAP before any UI depends on it. Phase 2 adds a thin, typed service and form routes that follow the S-01 pattern and translate each DB error code into a fixed message. Phase 3 renders shared pages that branch on `locals.profile.role`: Admins get the owner field and read-only milestones.

The single rounding function `money_floor_mul` is the seam S-04 will reuse for `payout_pool`, so `payout_pool ≤ reservation` holds by construction.

## Critical Implementation Details

- **Custom error codes (contract with phase 2).** Triggers raise with these SQLSTATEs; the service maps each to a catalog code.

  | SQLSTATE | Catalog code                         | Raised when                                                                        |
  | -------- | ------------------------------------ | ---------------------------------------------------------------------------------- |
  | `MR001`  | `owner_not_supervisor`               | a project's `supervisor_id` does not reference a Supervisor                        |
  | `MR002`  | `milestone_outside_project`          | a milestone's period falls outside its project's period                            |
  | `MR003`  | `project_closed`                     | a milestone is inserted or updated while its project is `completed` or `cancelled` |
  | `MR004`  | `project_period_excludes_milestones` | a project date change would leave any of its milestones outside                    |
  | `MR005`  | `supervisor_owns_projects`           | the role of a Supervisor who owns projects is changed                              |
  | `MR006`  | not user-reachable                   | a milestone's `project_id` is changed; maps to `save_failed`                       |

- **Security definer only where the check must see past the caller's RLS.** That means `owns_project`, and the four trigger functions (owner, milestone parent, project period, role block). Use `set search_path = ''` and schema-qualified names. `money_floor_mul` and the view **must** stay security invoker; a definer would bypass RLS.
- **Seed ordering.** `seed.sql` promotes the supervisor profile before inserting the sample project, otherwise the owner trigger raises `MR001`. It also sets `supervisor_id` explicitly, because `auth.uid()` is null without a JWT.

## Phase 1: Schema, Security and pgTAP

### Overview

One migration creates both tables, the rounding function, the ownership helper, four guard triggers, the RLS policies and the exposure view. A new pgTAP suite proves every guarantee. The contract registry is updated.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20260927120000_projects_and_milestones.sql`

**Intent**: Create the S-02 data model with all value rules, ownership and exposure enforced in the database, following the F-01/S-01 conventions:

- RLS enabled in the same migration;
- `revoke all … from anon`;
- one policy per operation per role, with helpers called as `(select public.is_x())`;
- an explicit comment for deliberately absent policies.

**Contract**:

- **`public.projects`**:
  - `id uuid pk default gen_random_uuid()`
  - `name text not null`, 1–100 chars, `name = btrim(name)`
  - `start_date date not null`, `end_date date not null`, `check (end_date >= start_date)`
  - `status text not null default 'planned'`, with named constraint `projects_status_valid` for `in ('planned','active','completed','cancelled')`
  - `total_budget numeric(12,2) not null check (total_budget > 0)`
  - `notes text` (nullable, ≤ 2000 chars)
  - `supervisor_id uuid not null default auth.uid() references public.profiles (id) on delete restrict`
  - `created_at`, `updated_at` (timestamptz, not null, default now), `updated_by uuid references public.profiles (id) on delete set null`
  - unique index on `lower(name)`; index on `supervisor_id`
- **`public.milestones`**:
  - `id`
  - `project_id uuid not null references public.projects (id) on delete restrict`
  - `name`, `start_date`, `end_date`, `status`, `notes`, audit columns: same rules as projects (named constraint `milestones_status_valid`)
  - `target_pool numeric(12,2) not null check (target_pool > 0)`
  - unique index on `(project_id, lower(name))`; index on `project_id`
- **Grants**: `revoke all … from anon` on both tables and the view. `revoke truncate, references, trigger … from authenticated` on both tables (S-01 impl-review F2).
- **`public.money_floor_mul(amount numeric, multiplier numeric) returns numeric`**:
  - `immutable`, security invoker, `set search_path = ''`
  - returns `floor(amount * multiplier * 100) / 100`
  - execute revoked from `public` and `anon`, granted to `authenticated`
  - comment: the single rounding rule for money; S-04 reuses it for `payout_pool`
- **`public.owns_project(p_project_id uuid) returns boolean`**:
  - `stable`, `security definer`, `set search_path = ''`
  - true when the project's `supervisor_id = auth.uid()` and `public.is_supervisor()`
  - execute granted to `authenticated` only
- **Triggers**:
  - `set_config_audit_fields()` fires `before insert or update` on both tables.
  - `projects_check_owner`: `before insert or update of supervisor_id`; raises `MR001` unless the referenced profile's role is `supervisor`.
  - `milestones_check_parent`: `before insert or update`. It raises:
    - `MR006` if `project_id` changed on update;
    - `MR003` if the parent project's status is `completed` or `cancelled`;
    - `MR002` if `start_date < project.start_date` or `end_date > project.end_date`.
  - `projects_check_period`: `before update of start_date, end_date`; raises `MR004` if any milestone of the project (any status) falls outside the new period.
  - `profiles_block_owner_role_change` on `public.profiles`: `before update of role`; raises `MR005` when `old.role = 'supervisor'`, `new.role is distinct from old.role`, and the user owns at least one project. The message names the project count.
  - All four trigger functions: execute revoked from `public`, `anon` and `authenticated`.
- **Policies on `projects`**:

  | Policy                       | Operation                   | Predicate                                                                 |
  | ---------------------------- | --------------------------- | ------------------------------------------------------------------------- |
  | `projects_select_supervisor` | select                      | `supervisor_id = (select auth.uid()) and (select public.is_supervisor())` |
  | `projects_select_admin`      | select                      | `(select public.is_admin())`                                              |
  | `projects_insert_supervisor` | insert (with check)         | same as select_supervisor                                                 |
  | `projects_insert_admin`      | insert (with check)         | `(select public.is_admin())`                                              |
  | `projects_update_supervisor` | update (using + with check) | same as select_supervisor                                                 |
  | `projects_update_admin`      | update (using + with check) | `(select public.is_admin())`                                              |

  No delete policy (commented).

- **Policies on `milestones`**:

  | Policy                         | Operation                   | Predicate                         |
  | ------------------------------ | --------------------------- | --------------------------------- |
  | `milestones_select_supervisor` | select                      | `public.owns_project(project_id)` |
  | `milestones_select_admin`      | select                      | `(select public.is_admin())`      |
  | `milestones_insert_supervisor` | insert (with check)         | `public.owns_project(project_id)` |
  | `milestones_update_supervisor` | update (using + with check) | `public.owns_project(project_id)` |

  No Admin insert or update policy and no delete policy (commented).

- **View `public.project_budget_exposure`** `with (security_invoker = true)`:
  - columns: `project_id`, `total_budget`, `reserved_total`, `remaining`, `over_budget`
  - `projects` cross join the singleton `bonus_settings`, left join `milestones`
  - `reserved_total = coalesce(sum(money_floor_mul(m.target_pool, s.multiplier_max)) filter (where m.status <> 'cancelled'), 0)`
  - the filter is written as an exclusion (`<> 'cancelled'`), so S-05's `approved` is not silently dropped
  - `select` granted to `authenticated`
  - comment: S-05 replaces Approved milestones' amount with their stored `payout_pool`

#### 2. pgTAP suite

**File**: `supabase/tests/projects_rls.test.sql`

**Intent**: Prove every S-02 guarantee against the live local database with the existing isolation model: `begin … rollback`, fixtures in the `…03xx` range with `@pgtap.test` emails, impersonation via `set local role authenticated` plus `request.jwt.claims`, and no absolute row counts.

**Contract**:

- **Fixtures**: users `…0301` employee, `…0302` Supervisor A, `…0303` Supervisor B, `…0304` admin, `…0305` Supervisor C (owns nothing). Projects and milestones in the `…031x` / `…032x` ranges.
- **Structure**: both tables have RLS enabled, and the view has `security_invoker` (the existing structural guard covers it too). `money_floor_mul`: `(10.01, 1.30) → 13.01` and `(3000.00, 1.30) → 3900.00`.
- **Ownership and RLS**:
  - A inserts, selects and updates own project;
  - B gets 0 rows on select and update of A's project;
  - A's insert with `supervisor_id` = B → `42501`;
  - A changing `supervisor_id` to B → `42501` (with check);
  - the employee sees 0 projects, 0 milestones and 0 exposure rows.
- **Milestones**:
  - A inserts into own project;
  - A's insert into B's project → `42501`;
  - an Admin selects any project's milestones;
  - an Admin milestone insert → `42501`;
  - an Admin milestone update → 0 rows;
  - a `project_id` change → `MR006`.
- **Admin project writes**:
  - an Admin creates a project for B, and B can select it;
  - an Admin reassigns A → B: A then gets 0 rows, and B sees the project, its milestones and its exposure row;
  - an Admin assigning to the employee → `MR001`.
- **Values**:
  - `total_budget` or `target_pool` of 0 → `23514`;
  - `end_date < start_date` → `23514`;
  - an invalid status → `23514`;
  - a name > 100 chars → `23514`;
  - a duplicate project name differing only in case → `23505`;
  - a duplicate milestone name in the same project → `23505`, while the same name in another project is accepted.
- **Periods and lock**:
  - a milestone outside the project period → `MR002`;
  - shrinking the project period past a milestone → `MR004`;
  - with the project `completed`, a milestone insert → `MR003` and an update → `MR003`;
  - reopening the project to `active` allows the update again.
- **Exposure**:
  - the 10 000 / 3 000 active / 3 000 active / 2 000 cancelled example gives `reserved_total` 7800.00, `remaining` 2200.00, `over_budget` false;
  - un-cancelling gives 10400.00 and true;
  - `reserved_total` equal to the budget → false, while 0.01 over → true;
  - a project with no milestones → 0;
  - updating `bonus_settings.multiplier_max` (as owner, inside the transaction) changes `reserved_total` on the next read;
  - B and the employee get no exposure row for A's project.
- **Role block**:
  - changing A's role (owns projects) → `MR005`;
  - after an Admin reassigns A's projects, the same change succeeds;
  - changing C's role succeeds;
  - updating A's `display_name` succeeds.

#### 3. Local seed data

**File**: `supabase/seed.sql`

**Intent**: Give manual testing a ready project owned by `supervisor@meritly.local`, plus a second Supervisor to reassign to.

**Contract**:

- Add a fourth account, `supervisor2@meritly.local` (`…0004`, display name "Local Supervisor 2", same local password), to the users, identities and promotion blocks, and to the header comment.
- After the role promotions, insert one project `…0011` (supervisor_id `…0002`, budget 10000.00, a 2026 period, status `active`) and two `active` milestones `…0021`/`…0022` inside it (targets 3000.00 and 3000.00).
- Use explicit IDs in the seed range `…00xx`.

#### 4. Contract registry

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Register the new load-bearing DB names so later slices reuse them unchanged.

**Contract**:

- New rows for `public.projects`, `public.milestones`, `public.money_floor_mul()`, `public.owns_project()`, `public.project_budget_exposure`, the four trigger functions, and the `MR001`–`MR006` SQLSTATE table.
- Update the `set_config_audit_fields()` row: it now also fires on projects and milestones.
- Add a "Money rule" note: two decimals, floor to the grosz via `money_floor_mul`, never rely on the `numeric(p,2)` cast.

### Success Criteria:

#### Automated Verification:

- Migration and seed apply cleanly from scratch: `npx supabase db reset`
- All pgTAP suites pass, including the new `projects_rls.test.sql` and the existing structural guard: `npx supabase test db`

#### Manual Verification:

- In Supabase Studio, the seeded project shows in `project_budget_exposure` with `reserved_total` 7800.00 and `over_budget` false
- In Studio, changing `supervisor@meritly.local`'s role to `employee` is rejected with the "reassign first" message

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Services, Routes and Middleware

### Overview

Add the typed domain layer: shared form helpers, the projects service with its error catalog, entity types, the middleware guard and four form endpoints.

### Changes Required:

#### 1. Shared form helpers

**File**: `src/lib/forms.ts` (new), `src/lib/services/bonus-config.ts`

**Intent**: Make `parseForm` and `firstIssueError` catalog-agnostic so the projects service reuses them. S-01 routes and imports must keep working unchanged.

**Contract**:

- `forms.ts` exports generic `firstIssueError(error, isCode)` and `parseForm(request, schema, isCode)`, returning `{ code, field? }` for the caller's catalog. Behaviour is unchanged: the first issue wins, and an unparseable body becomes `invalid_form`.
- `bonus-config.ts` keeps exporting `parseForm` and `firstIssueError` with their current signatures, as thin wrappers bound to `isSettingsErrorCode`.

#### 2. Entity types

**File**: `src/types.ts`

**Intent**: Handwritten mirrors of the new DB shapes, in the existing style (doc comment naming the table; numerics as `number`).

**Contract**:

- `WorkStatus = "planned" | "active" | "completed" | "cancelled"`
- `Project { id, name, start_date, end_date, status: WorkStatus, total_budget: number, notes: string | null, supervisor_id }`
- `Milestone { id, project_id, name, start_date, end_date, status: WorkStatus, target_pool: number, notes: string | null }`
- `ProjectExposure { project_id, total_budget, reserved_total, remaining: number; over_budget: boolean }`

#### 3. Projects service

**File**: `src/lib/services/projects.ts` (new)

**Intent**: Validation, error catalog, redirect helpers and data access for projects and milestones, mirroring `bonus-config.ts`. All calls use the request-scoped client.

**Contract**:

- **Error catalog**: `required`, `name_too_long`, `notes_too_long`, `invalid_money`, `invalid_date`, `period_order`, `invalid_status`, `invalid_id`, `invalid_owner`, `invalid_form`, `duplicate_name`, `rule_violation`, `owner_not_supervisor`, `milestone_outside_project`, `project_closed`, `project_period_excludes_milestones`, `admin_read_only`, `not_found`, `save_failed`, `not_configured`. Field labels cover every form field. `projectsErrorMessage(code, field)` returns only catalog text.
- **Money field**: a trimmed string matching `^\d{1,10}(\.\d{1,2})?$`, then a number > 0, checked in integer grosze. It rejects `12.555`, `0x1` and `1e3` (S-01 F3). Error code `invalid_money`.
- **Dates**: `YYYY-MM-DD` strings (`invalid_date`). A cross-field `superRefine` requires `end_date >= start_date` (`period_order`).
- **Schemas**:
  - `projectInputSchema`: name ≤ 100, dates, status enum, `total_budget` money, notes ≤ 2000 or null.
  - `adminProjectInputSchema`: the same plus required `supervisor_id: z.uuid("invalid_owner")`.
  - `milestoneInputSchema`: name, dates, status, `target_pool` money, notes. There is no `project_id` field; it comes from the route param.
- **`mapPostgrestError`**: `23505` → `duplicate_name`, `23514` → `rule_violation`, `42501` → `not_found`, `MR001`–`MR004` → their catalog codes (table in Critical Implementation Details), anything else is logged → `save_failed`.
- **Reads**: `listProjects`, `getProject(id)`, `listMilestones(projectId)`, `listProjectExposure()`, `getProjectExposure(id)`, and `listSupervisors()` (profiles with `role = 'supervisor'`, for the Admin owner select).
- **Writes**:
  - `createProject(input) → { id }` uses insert + select id.
  - `updateProject(id, input)`, `createMilestone(projectId, input)` and `updateMilestone(projectId, id, input)` use update + select id; 0 rows → `not_found`.
- **Numerics** are converted with `Number()` for display only. TS does no money arithmetic.
- **Redirect helpers**: `projectsUrl({ saved | error })` and `projectUrl(id, section, { saved | error })`, with the same URL shape as `settingsErrorUrl`.

#### 4. Middleware guard

**File**: `src/middleware.ts`

**Intent**: Sign-in plus a role guard for the shared project pages.

**Contract**:

- Add `/projects` and `/api/projects` to `PROTECTED_ROUTES`.
- New `PROJECT_ROUTES = ["/projects", "/api/projects"]` with `profileError` → 503; role not in `supervisor`/`admin` → 403 `Forbidden`.
- `ADMIN_ROUTES` is unchanged.

#### 5. Form endpoints

**Files**: `src/pages/api/projects/index.ts`, `src/pages/api/projects/[id].ts`, `src/pages/api/projects/[id]/milestones/index.ts`, `src/pages/api/projects/[id]/milestones/[milestoneId].ts` (all new)

**Intent**: The S-01 endpoint shape: client or `not_configured` → validate params → `parseForm` → service call → 302 redirect.

**Contract**:

- `POST /api/projects` creates a project. Admins use `adminProjectInputSchema` and Supervisors use `projectInputSchema`, chosen by `locals.profile.role`. On success it redirects to `/projects/{id}?saved=project`; errors go to `/projects?error=…`.
- `POST /api/projects/[id]` updates a project with the same role branch. The Supervisor schema has no owner field, so the owner is untouched.
- `POST /api/projects/[id]/milestones` and `POST /api/projects/[id]/milestones/[milestoneId]` handle milestones. An Admin is redirected with `admin_read_only` **before** any Supabase call; RLS remains the real enforcement.
- Both URL params are validated as UUIDs (`invalid_id`).

### Success Criteria:

#### Automated Verification:

- Types regenerate and type-check passes: `npx astro sync && npx astro check`
- Lint passes: `npm run lint`
- Production build succeeds: `npm run build`
- Existing pgTAP suites still pass: `npx supabase test db`

#### Manual Verification:

- The S-01 admin settings page still saves and still shows errors (the form-helper move caused no regression)
- Signed in as `employee@meritly.local`, `/projects` and `POST /api/projects` return 403

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Pages, Navigation and Docs

### Overview

Shared Supervisor/Admin pages for listing, creating and editing projects and milestones, with the FR-017 exposure flag. Also a navigation entry and doc updates.

### Changes Required:

#### 1. Money formatting

**File**: `src/lib/format.ts` (new)

**Intent**: One display helper for PLN amounts.

**Contract**: `formatPln(value: number): string` uses `Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' })`. Presentation only; values arrive already floored from SQL.

#### 2. Projects list page

**File**: `src/pages/projects/index.astro` (new)

**Intent**: List visible projects with name, period, status, budget, reserved, remaining and an over-budget badge, plus a "New project" form. Admins also see an owner column and an owner select in the form.

**Contract**:

- Loads `listProjects`, `listProjectExposure` and, for Admins, `listSupervisors` via `Promise.all`, merging exposure by `project_id`.
- A load error shows the single alert box pattern (`settings.astro:59-63`).
- Flash `saved`/`error` come from the query string and are resolved through `projectsErrorMessage`.

#### 3. Project detail page

**File**: `src/pages/projects/[id].astro` (new)

**Intent**: Edit the project, show exposure, list milestones and let the owner add or edit them.

**Contract**:

- **Sections**:
  - `project`: the edit form; for Admins it also has the owner select, which reassigns the project.
  - `exposure`: budget, reserved total, remaining, and an over-budget badge. It explains "worst case: non-cancelled milestones × maximum multiplier {multiplier_max}", with `multiplier_max` from `getBonusSettings`.
  - `milestones`: a table, one inline edit form per row (details/summary), and an add form.
- **Closed project**: when the project is `completed` or `cancelled`, milestone forms are hidden and a note says to reopen the project first.
- **Admins**: milestones are read-only, with no forms.
- **Unknown or invisible id**: the project fails to load, and the page shows a "not found" message, not an exception.

#### 4. Form components

**Files**: `src/components/projects/ProjectForm.astro`, `src/components/projects/MilestoneForm.astro`, `src/components/projects/BudgetExposurePanel.astro` (new)

**Intent**: Server-rendered `.astro` sections in the `KpiSettingsSection.astro` style. They reuse `buttonClass`/`inputClass` from `src/components/admin/form-classes.ts` and take `saved`/`error` props.

**Contract**:

- Money inputs are `type="text" inputmode="decimal"`, so the browser does not rewrite `12.555` before the server rejects it.
- Date inputs are `type="date"`; the status is a select of the four values.
- `ProjectForm` renders the owner select only when given a supervisors list (the Admin case).

#### 5. Navigation

**Files**: `src/components/Topbar.astro`, `src/pages/dashboard.astro`

**Intent**: Make the new pages reachable.

**Contract**: A "Projects" link to `/projects` is shown when `locals.profile.role` is `supervisor` or `admin`, in the Topbar and as a button on the dashboard.

#### 6. Docs

**Files**: `context/foundation/prd.md`, `docs/reference/contract-surfaces.md`, `CLAUDE.md`

**Intent**: Keep the specs aligned with what shipped.

**Contract**:

- `prd.md` Business Logic: one line saying every `floor` rounds down to 0.01 PLN.
- `contract-surfaces.md`: add `PROJECT_ROUTES`, the `Project` / `Milestone` / `ProjectExposure` / `WorkStatus` types, and the `src/lib/forms.ts` helpers.
- `CLAUDE.md` Auth flow: mention the `PROJECT_ROUTES` guard next to `PROTECTED_ROUTES`.

### Success Criteria:

#### Automated Verification:

- Type-check passes: `npx astro sync && npx astro check`
- Lint passes: `npm run lint`
- Production build succeeds: `npm run build`
- Auth smoke test passes against a running preview: `npm run smoke`
- pgTAP suites pass: `npx supabase test db`

#### Manual Verification:

- As `supervisor@meritly.local`: the seeded project shows 7 800,00 zł reserved and not over budget; creating a milestone with target 2 000.00 flips it to over budget (10 400,00 zł reserved)
- As the Supervisor: setting that milestone to `cancelled` clears the flag; `12.555` and `0` as a target are rejected with a readable message
- As the Supervisor: a milestone ending after the project end, and a duplicate milestone name, are each rejected with a specific message
- As the Supervisor: after setting the project to `completed`, milestone forms disappear; after reopening it to `active`, they are back
- As `admin@meritly.local`: all projects are listed with owners; the Admin creates a project for `supervisor2@meritly.local`, then reassigns the seeded project to it; `supervisor@meritly.local` no longer sees it and `supervisor2` does
- As the Admin: milestones are read-only, and a direct `POST` to a milestone route returns the "read-only for Admins" message
- As the Admin: changing the budget of the seeded project so reserved > budget shows the over-budget badge on both the list and detail pages
- The pages are usable at phone width (list and forms wrap, no horizontal scroll)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- There is no TS unit framework (per `CLAUDE.md`). All rule and arithmetic tests live in pgTAP (`supabase/tests/projects_rls.test.sql`), which is why the rounding and exposure logic sits in SQL.
- Key edge cases:
  - rounding down to the grosz (10.01 × 1.30 → 13.01);
  - equality with the budget is not over budget;
  - cancelled milestones excluded;
  - a project with no milestones;
  - a read-time `multiplier_max` change;
  - case-insensitive name collisions;
  - the closed-project lock and reopening;
  - the role block before and after reassignment.

### Integration Tests:

- `npx supabase test db` exercises RLS as each role through `request.jwt.claims`, the same path PostgREST uses.
- `npm run smoke` guards the auth flow after the middleware change.

### Manual Testing Steps:

1. `npx supabase db reset`, `npm run dev`, then sign in as `supervisor@meritly.local` (password in `supabase/seed.sql`).
2. Walk through the Phase 3 Supervisor checks: exposure 7 800,00 zł → add 2 000.00 → over budget → cancel → cleared.
3. Try the invalid inputs: `12.555`, `0`, end before start, milestone outside the project, duplicate names.
4. Close the project, confirm the milestone lock, then reopen it.
5. Sign in as `admin@meritly.local`: list with owners, create for the Supervisor, reassign, read-only milestones, budget-edit flag.
6. Sign in as `employee@meritly.local`: `/projects` returns 403.
7. In Studio, try changing the Supervisor's role while they own projects; it must be rejected.

## Performance Considerations

The exposure view aggregates milestones per project on each read. Indexes on `milestones.project_id` and `projects.supervisor_id` keep this trivial at MVP scale (tens of projects). `owns_project` is `stable`, and role helpers are wrapped in `(select …)` so they are evaluated once per statement.

## Migration Notes

This is an additive migration: two new tables, one view, two functions and four triggers. The only change to an existing table is the new `before update of role` trigger on `profiles`, which does nothing until projects exist. Supabase CLI migrations are forward-only, and there is no data to migrate. Rollback before deploy: edit the migration and run `npx supabase db reset`. Rollback after deploy: add a new forward migration that drops the view, triggers, functions and tables, in that order (the reverse of creation).

## References

- Related research: `context/changes/supervisor-creates-project-and-milestones/research.md` (Parts 1–2 and all follow-ups)
- Pattern to copy for endpoints and services: `src/lib/services/bonus-config.ts:12-225`, `src/pages/api/admin/job-roles/[id].ts`
- Pattern for policies and triggers: `supabase/migrations/20260926120000_bonus_rules_config.sql:82-159`, `supabase/migrations/20260925120000_role_and_rls_scaffold.sql:28-87`
- pgTAP conventions: `supabase/tests/bonus_config_rls.test.sql:1-16`, structural guard `supabase/tests/profiles_rls.test.sql:180-205`
- PRD: FR-004, FR-005, FR-017, Business Logic (`context/foundation/prd.md`)
- PostgREST custom SQLSTATE: https://docs.postgrest.org/en/v14/references/errors.html

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema, Security and pgTAP

#### Automated

- [x] 1.1 Migration and seed apply cleanly from scratch: `npx supabase db reset` — 32ad3a3
- [x] 1.2 All pgTAP suites pass, including the new `projects_rls.test.sql` and the existing structural guard: `npx supabase test db` — 32ad3a3

#### Manual

- [x] 1.3 In Supabase Studio, the seeded project shows in `project_budget_exposure` with `reserved_total` 7800.00 and `over_budget` false — 32ad3a3
- [x] 1.4 In Studio, changing `supervisor@meritly.local`'s role to `employee` is rejected with the "reassign first" message — 32ad3a3

### Phase 2: Services, Routes and Middleware

#### Automated

- [x] 2.1 Types regenerate and type-check passes: `npx astro sync && npx astro check` — 3dd048b
- [x] 2.2 Lint passes: `npm run lint` — 3dd048b
- [x] 2.3 Production build succeeds: `npm run build` — 3dd048b
- [x] 2.4 Existing pgTAP suites still pass: `npx supabase test db` — 3dd048b

#### Manual

- [x] 2.5 The S-01 admin settings page still saves and still shows errors (the form-helper move caused no regression) — 3dd048b
- [x] 2.6 Signed in as `employee@meritly.local`, `/projects` and `POST /api/projects` return 403 — 3dd048b

### Phase 3: Pages, Navigation and Docs

#### Automated

- [x] 3.1 Type-check passes: `npx astro sync && npx astro check`
- [x] 3.2 Lint passes: `npm run lint`
- [x] 3.3 Production build succeeds: `npm run build`
- [x] 3.4 Auth smoke test passes against a running preview: `npm run smoke`
- [x] 3.5 pgTAP suites pass: `npx supabase test db`

#### Manual

- [x] 3.6 As `supervisor@meritly.local`: the seeded project shows 7 800,00 zł reserved and not over budget; creating a milestone with target 2 000.00 flips it to over budget (10 400,00 zł reserved)
- [x] 3.7 As the Supervisor: setting that milestone to `cancelled` clears the flag; `12.555` and `0` as a target are rejected with a readable message
- [x] 3.8 As the Supervisor: a milestone ending after the project end, and a duplicate milestone name, are each rejected with a specific message
- [x] 3.9 As the Supervisor: after setting the project to `completed`, milestone forms disappear; after reopening it to `active`, they are back
- [x] 3.10 As `admin@meritly.local`: all projects are listed with owners; the Admin creates a project for `supervisor2@meritly.local`, then reassigns the seeded project to it; `supervisor@meritly.local` no longer sees it and `supervisor2` does
- [x] 3.11 As the Admin: milestones are read-only, and a direct `POST` to a milestone route returns the "read-only for Admins" message
- [x] 3.12 As the Admin: changing the budget of the seeded project so reserved > budget shows the over-budget badge on both the list and detail pages
- [x] 3.13 The pages are usable at phone width (list and forms wrap, no horizontal scroll)
