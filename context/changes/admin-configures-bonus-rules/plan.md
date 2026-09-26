# Admin Configures Bonus Rules Implementation Plan

## Overview

Roadmap S-01 (FR-001, FR-002, FR-003): an Admin maintains the global parameters of the bonus formula on one page, `/admin/settings`. The parameters are job roles with weights (add, edit, archive, restore), the four KPI weights with the min/max milestone-multiplier bounds, and the contribution-rating (1–5) → factor mapping. The values live in RLS-protected tables pre-filled with the validated spreadsheet defaults. Supervisors can read them, so S-03 (assigning roles) and S-04 (computing bonuses) can run as the signed-in user.

## Current State Analysis

- F-01 is done. `public.profiles` holds the access role (`admin`/`supervisor`/`employee`), and the `security definer` helpers `public.is_admin()` / `public.is_supervisor()` exist (`supabase/migrations/20260925120000_role_and_rls_scaffold.sql:52-86`). Policies call them as `(select public.is_admin())` (`docs/reference/contract-surfaces.md` › Policy conventions).
- The pgTAP suite `supabase/tests/profiles_rls.test.sql` already fails CI if any `public` table lacks RLS or any `public` view lacks `security_invoker` (`:187`, `:201`). CI runs `supabase test db` in the `smoke` job (`.github/workflows/ci.yml:44`).
- The middleware guards `/admin` via `ADMIN_ROUTES = ["/admin"]` with a `startsWith` match (`src/middleware.ts:5-8`). **`/api/admin/...` does not match that prefix.**
- `src/pages/admin/index.astro` is a placeholder admin page. There is no config UI and no `src/lib/services/` directory.
- Form pattern in use: an HTML `<form method="POST">` posts to an API route that redirects back with `?error=` (`src/components/auth/SignInForm.tsx:43`, `src/pages/api/auth/signin.ts`). zod `^4.6.5` is installed but not used yet.
- The source of truth for default values is `docs/Model Premiowania/Model_premiowania.xlsx`, sheet `Ustawienia`:
  - Multiplier min 0.7, max 1.3.
  - KPI weights Termin 0.30, Budżet 0.30, Jakość 0.25, Ryzyko 0.15 ("suma=1").
  - Rating→factor 1→0.8, 2→0.9, 3→1.0, 4→1.1, 5→1.2.
  - Eight roles (name / weight / description):
    - Lider projektu / Architekt 1.25 "Kluczowe decyzje, odpowiedzialność za integrację"
    - Senior 1.10 "Duży wpływ techniczny, mentoring"
    - Specjalista 1.00 "Standardowy wkład"
    - Junior 0.85 "Wkład pod nadzorem"
    - Tester/QA 1.00 "Jakość i kryteria akceptacji"
    - Inż. elektroniki 1.10 "Projektowanie, uruchomienia, EMC"
    - Inż. firmware 1.15 "Sterowniki, RTOS, bezpieczeństwo"
    - Inż. oprogramowania 1.05 "Backend/frontend, integracje"

## Desired End State

- A seeded admin opens `/admin/settings`, which shows three sections pre-filled with the spreadsheet defaults.
- The admin can add a job role, edit its name, weight or description, archive it (hidden from future pickers but kept for existing references) and restore it.
- The admin can edit the KPI weights and multiplier bounds, and the five rating factors.
- Invalid input comes back as a readable error and changes nothing. Examples: KPI weights not summing to 1.00, min ≥ max, decreasing factors, a duplicate role name.
- In the database, admins can read and write the config, supervisors can only read it, and employees see nothing. The pgTAP suite proves this.
- `/api/admin/*` returns 403 to non-admins.
- `docs/reference/contract-surfaces.md` records the new tables. It also records the snapshot contract: S-04/S-05 must store the config values they used on their own result rows, which keeps Approved milestones frozen.

### Key Discoveries:

- `ADMIN_ROUTES` prefix matching does not cover `/api/admin` (`src/middleware.ts:6,8`). It must be added explicitly, or the API is guarded by RLS alone.
- Existing policies are one per operation per role, with no `delete` policy where the operation is not allowed. That absence is documented in the migration comment (`20260925120000_role_and_rls_scaffold.sql:88-97`), and this plan mirrors it.
- The pgTAP fixture UUID ranges are `...0000000000xx` for seed and `...0000000001xx` for the profiles suite. This suite uses `...0000000002xx`.
- In the spreadsheet's multiplier formula (`Milestones!M2`), Ryzyko enters as `(1 − Ryzyko/100)`, but the instructions document says 100 = no problems. This is S-04's concern and does not change what S-01 stores (see Open Risks in the brief).

## What We're NOT Doing

- No config versioning or effective dating. Freezing is achieved by S-04/S-05 snapshotting the values they used (only the contract is documented here).
- No hard delete of job roles, and no `delete` policy on either config table.
- No linking of employees to job roles. That is S-03, which adds the FK to `job_roles`.
- No multiplier computation or use of the Ryzyko direction. That is S-04.
- No change-history or audit log beyond `updated_at` / `updated_by` on each row.
- No employee read access to config.
- No React islands or live client-side validation (for example a live KPI-sum counter). All validation happens server-side through the forms.
- No new `npm run smoke` steps, and no generated Supabase DB types.
- No optimistic-concurrency handling between two admins: last write wins.
- No re-filling of rejected form input. After a validation error, the redirect re-renders the forms from the stored values, so the admin retypes their change. This is an accepted MVP limitation for a handful of numeric fields.

## Implementation Approach

The database is the guarantee and the app is a thin form layer. Phase 1 ships the schema, its constraints, RLS and the seeded defaults, together with pgTAP proof, so no commit carries RLS without tests (same rule as F-01). Phase 2 adds zod validation at the edge (friendly messages), a service module that talks to Supabase as the signed-in user, POST-redirect API routes and a server-rendered Astro page. Database `CHECK` constraints repeat every zod rule, so a bypassed form still cannot store bad config.

## Critical Implementation Details

- **Middleware guard ordering**: add `/api/admin` to both `PROTECTED_ROUTES` and `ADMIN_ROUTES`. Otherwise an unauthenticated POST reaches the route handler, and only RLS stops it (with a confusing DB error instead of 403).
- **Decimal comparison**: the KPI sum = 1.00 rule must be compared in integer hundredths in zod (e.g. `Math.round(w * 100)`), because `0.3 + 0.3 + 0.25 + 0.15` is not exactly `1` in floating point. In SQL the columns are `numeric`, so `= 1` is exact.
- **Seeded values in the migration, not `seed.sql`**: the `bonus_settings` row and the eight roles must exist in production too. The pgTAP suite must not assume absolute role counts (an admin may add roles). It checks that the seeded names and values are present.

## Phase 1: Schema, defaults, RLS and pgTAP tests

### Overview

Create the two config tables with DB-enforced value rules, per-role policies, an `updated_at`/`updated_by` trigger and the spreadsheet defaults, and prove access and validation with pgTAP.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20260926120000_bonus_rules_config.sql`

**Intent**: Store the formula configuration where RLS guards it and where invalid values cannot exist, pre-filled so every environment starts with a valid config.

**Contract**:

- `public.job_roles`:
  - `id` uuid PK default `gen_random_uuid()`.
  - `name` text not null, length 1–100, with `check (name = btrim(name))` so whitespace variants cannot bypass the unique index.
  - `weight` numeric(4,2) not null, `> 0 and <= 3`.
  - `description` text, nullable.
  - `archived_at` timestamptz, nullable; null means active.
  - `created_at`, `updated_at` timestamptz not null default `now()`.
  - `updated_by` uuid nullable, FK `public.profiles(id) on delete set null`.
  - Unique index on `lower(name)`, which covers archived rows too, so a restore can never collide.
- `public.bonus_settings`, a singleton:
  - `id` boolean PK default `true` with `check (id)`.
  - `kpi_weight_schedule`, `kpi_weight_budget`, `kpi_weight_quality`, `kpi_weight_risk`: numeric(3,2) not null, each `>= 0 and <= 1`, with a table check that the four sum to `1`.
  - `multiplier_min`, `multiplier_max`: numeric(4,2) not null, with `check (multiplier_min > 0 and multiplier_min < multiplier_max and multiplier_max <= 3)`.
  - `rating_factor_1` … `rating_factor_5`: numeric(4,2) not null, each `> 0 and <= 3`, with `check (rating_factor_1 <= rating_factor_2 and … and rating_factor_4 <= rating_factor_5)`.
  - `updated_at` timestamptz not null default `now()`, and `updated_by` as above.
- RLS is enabled on both tables in this migration, and all privileges are revoked from `anon`.
- Policies (to `authenticated`, helpers wrapped in `(select …)`):
  - `job_roles_select_admin`, `job_roles_select_supervisor`, `job_roles_insert_admin`, `job_roles_update_admin`.
  - `bonus_settings_select_admin`, `bonus_settings_select_supervisor`, `bonus_settings_update_admin`.
  - A header comment states that there is deliberately **no** delete policy on either table and no insert policy on `bonus_settings` (the row is seeded here), mirroring the profiles comment.
- A trigger function `public.set_config_audit_fields()` (`set search_path = ''`) sets `updated_at = now()` and `updated_by = auth.uid()`. It is attached `before insert or update` on `job_roles` (so admin-created roles record their creator; the migration's seed rows get `null`) and `before update` on `bonus_settings`. Execute is revoked from `public`, `anon` and `authenticated`, following the `handle_new_user` precedent.
- Seed inserts: the single `bonus_settings` row (0.30/0.30/0.25/0.15, 0.70/1.30, 0.80/0.90/1.00/1.10/1.20) and the eight job roles with the weights and descriptions listed in Current State Analysis.

#### 2. pgTAP suite

**File**: `supabase/tests/bonus_config_rls.test.sql`

**Intent**: Prove the access matrix and the value rules at the layer where they are enforced.

**Contract**: The isolation model is the same as `profiles_rls.test.sql`: `begin … rollback`, fixtures in the UUID range `00000000-0000-4000-8000-0000000002xx` with `@pgtap.test` emails, and no absolute row-count assertions. Assertions:

- **Seeded defaults:** the settings row equals the spreadsheet values, and all eight named roles are present with their weights.
- **Employee:** sees 0 rows in both tables.
- **Supervisor:** sees the settings row and the job roles, including archived ones.
- **Employee and supervisor writes** (exact outcomes under RLS):
  - An insert into `job_roles` raises `42501` (`throws_ok`).
  - An update on either table affects 0 rows (`is_empty(update … returning id)`).
- **Admin:**
  - Can insert a role, and the new row's `updated_by` equals the admin's id.
  - Can update its weight, archive it (`archived_at` set) and update the settings row.
  - After an update, `updated_by` equals the admin's id.
- **Nobody, including admin:** can delete. `is_empty(delete … returning id)` holds for a role and for the settings row, and both rows still exist afterwards.
- **Constraint violations raise `23514`/`23505`:**
  - KPI weights summing to 0.99.
  - `multiplier_min >= multiplier_max`.
  - `rating_factor_3 < rating_factor_2`.
  - Role weight 0.
  - A duplicate role name differing only in case.
  - A role name with surrounding whitespace (`'Senior '`).
  - A second `bonus_settings` row.

#### 3. Contract registry

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Register the new load-bearing names and the freezing contract so S-03 to S-05 build on them.

**Contract**:

- Add registry rows for `public.job_roles` and `public.bonus_settings` (columns and rules as above) and for `public.set_config_audit_fields()`.
- Add a "Config snapshot rule" note: computations must read `bonus_settings` and `job_roles` at compute time, and S-04/S-05 result rows must persist the role weight, rating factor, milestone multiplier and bonus they used, so later config edits never change Approved milestones. Also: archived roles stay readable, and new assignments must pick only rows with `archived_at is null`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly on a fresh local DB: `npx supabase db reset`
- pgTAP suites pass, including the existing structural RLS guards: `npx supabase test db`
- Lint passes: `npm run lint`

#### Manual Verification:

- In Supabase Studio (local), `bonus_settings` has exactly one row with the spreadsheet defaults, and `job_roles` lists the eight spreadsheet roles

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Admin settings app

### Overview

Wire the config into the app: shared types, a validated service layer, admin-only POST routes and the `/admin/settings` page with three form sections.

### Changes Required:

#### 1. Shared types

**File**: `src/types.ts`

**Intent**: One typed shape for config rows, reused by the service, pages and later slices.

**Contract**:

- `JobRole { id, name, weight: number, description: string | null, archived_at: string | null }`.
- `BonusSettings { kpi_weight_schedule, kpi_weight_budget, kpi_weight_quality, kpi_weight_risk, multiplier_min, multiplier_max, rating_factor_1 … rating_factor_5: number }`.
- Numeric columns arrive from PostgREST as numbers or strings depending on precision, so the service normalises them with `Number()`.

#### 2. Validation and data service

**File**: `src/lib/services/bonus-config.ts`

**Intent**: Keep zod schemas and Supabase access in one module so the routes stay thin and the rules sit next to each other.

**Contract**:

- zod schemas that coerce `FormData` strings:
  - `jobRoleInputSchema`: trimmed name 1–100 characters, weight > 0 and ≤ 3 with at most 2 decimals, and an optional description where an empty string becomes null.
  - `kpiSettingsInputSchema`: four weights 0–1, sum = 1.00 compared in hundredths, and 0 < min < max ≤ 3.
  - `ratingFactorsInputSchema`: five factors > 0 and ≤ 3, non-decreasing.
- Functions that take the request-scoped `SupabaseClient` (never the service role):
  - `listJobRoles` returns active roles first, then archived ones, each group ordered by name.
  - `getBonusSettings`, `createJobRole`, `updateJobRole`, `setJobRoleArchived(id, archived: boolean)`, `updateKpiSettings` and `updateRatingFactors`.
- Each function returns `{ error?: string }`.
- Postgres code `23505` maps to "A role with this name already exists", and `23514` maps to a generic "Values violate configuration rules".
- An update that affects 0 rows, for example an unknown id, maps to "Not found".

#### 3. API routes

**Files**:

- `src/pages/api/admin/job-roles/index.ts` (create)
- `src/pages/api/admin/job-roles/[id].ts` (update)
- `src/pages/api/admin/job-roles/[id]/archive.ts` (archive/restore through the `archived` field `"true"`/`"false"`)
- `src/pages/api/admin/bonus-settings/kpi.ts`
- `src/pages/api/admin/bonus-settings/rating-factors.ts`

**Intent**: Admin-only form endpoints following the existing POST-redirect pattern.

**Contract**:

- Each route exports an uppercase `POST` that parses `formData()` with the matching zod schema and calls the service with `createClient(context.request.headers, context.cookies)`.
- Each route redirects to `/admin/settings?saved=<roles|kpi|factors>` on success, or `/admin/settings?error=<urlencoded message>&section=<…>` on failure.
- The `[id]` param is validated as a uuid.
- If Supabase is not configured, the route redirects with an error, as `signin.ts` does.

#### 4. Middleware guard

**File**: `src/middleware.ts`

**Intent**: Return 403 for non-admin calls to admin APIs before any handler runs.

**Contract**: Add `"/api/admin"` to `PROTECTED_ROUTES` and `ADMIN_ROUTES`. The existing branches then apply: unauthenticated → redirect to sign-in, `profileError` → 503, non-admin → 403. Update the `ADMIN_ROUTES` row in `docs/reference/contract-surfaces.md` to list both prefixes.

#### 5. Settings page and sections

**Files**:

- `src/pages/admin/settings.astro`
- `src/components/admin/JobRolesSection.astro`
- `src/components/admin/KpiSettingsSection.astro`
- `src/components/admin/RatingFactorsSection.astro`
- `src/pages/admin/index.astro` (link)

**Intent**: A server-rendered page, with no hydration, where the admin sees and edits all three config groups, and which stays usable on a phone.

**Contract**:

- `settings.astro` loads the roles and settings through the service and renders each section with its data plus the `saved`/`error` message scoped by `section`.
- If a load fails, the page shows a clear error instead of empty forms.
- Sections:
  - Job roles: a list with one inline edit form per role, an Archive or Restore button, archived roles visually muted and grouped after the active ones, and an "Add role" form.
  - KPI: four weight inputs labelled Termin / Budżet / Jakość / Ryzyko with the "must sum to 1.00" hint, plus the min/max multiplier inputs.
  - Rating factors: five inputs labelled 1–5 with the "non-decreasing" hint.
- Inputs use `type="number"` with `step="0.01"`. Classes are merged with `cn()`. shadcn `input`, `label` and `table` may be added with `npx shadcn@latest add` and rendered statically.
- The layout stacks on narrow screens (PRD mobile NFR).
- `admin/index.astro` gets a link to `/admin/settings`.

### Success Criteria:

#### Automated Verification:

- Astro types regenerate and type-check passes: `npx astro sync && npx astro check`
- Lint passes: `npm run lint`
- Production build succeeds: `npm run build`
- Existing auth smoke test still passes against a running dev server: `npm run smoke`
- pgTAP suites still pass: `npx supabase test db`

#### Manual Verification:

- Signed in as `admin@meritly.local`, `/admin/settings` shows the eight roles, KPI weights 0.30/0.30/0.25/0.15, bounds 0.70/1.30 and factors 0.80–1.20
- Admin can add a role, edit its weight, archive it (it moves to the muted archived group) and restore it; each save shows a success message and persists after reload
- Saving KPI weights that sum to 0.95, a min ≥ max, a decreasing factor list or a duplicate role name (different case) shows a readable error and leaves the stored values unchanged
- Signed in as supervisor or employee, `/admin/settings` returns 403, and a POST to `/api/admin/bonus-settings/kpi` also returns 403
- The page is usable at phone width (no horizontal scroll, forms stack)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- None: the repo has no unit-test framework (CLAUDE.md). Value rules are proven in pgTAP at the DB layer, and zod rules are exercised manually through the forms.

### Integration Tests:

- `supabase/tests/bonus_config_rls.test.sql`: the per-role access matrix, all DB constraints, seeded defaults, the audit trigger and the absence of delete.
- The existing structural guard in `profiles_rls.test.sql` automatically covers RLS being enabled on the two new tables.

### Manual Testing Steps:

1. `npx supabase db reset`, then `npm run dev`, then sign in as `admin@meritly.local`.
2. Open `/admin/settings` and confirm the defaults.
3. Add "Test role" with weight 1.2, rename it, archive it, restore it, and try adding "test ROLE" (expect a duplicate error).
4. Set the KPI weights to 0.30/0.30/0.25/0.10 (expect a sum error), then back to valid values.
5. Set factor 3 to 0.85 (expect a non-decreasing error).
6. Sign in as the supervisor and as the employee: `/admin/settings` returns 403.
7. Narrow the browser to about 375px and confirm the forms stack.

## Performance Considerations

None: a single-digit number of rows, read once per page load.

## Migration Notes

- This is an additive migration, with no changes to existing tables. Defaults are inserted in the migration, so the hosted project gets them on `supabase db push`.
- Rollback before S-03 exists is `drop table public.job_roles, public.bonus_settings; drop function public.set_config_audit_fields();`.

## References

- Roadmap item: `context/foundation/roadmap.md` › S-01
- Requirements: `context/foundation/prd.md` › FR-001, FR-002, FR-003
- Default values: `docs/Model Premiowania/Model_premiowania.xlsx` › `Ustawienia`, `Milestones!M2`
- Pattern precedent: `context/archive/2026-09-25-role-and-rls-scaffold/plan.md`, `supabase/migrations/20260925120000_role_and_rls_scaffold.sql`, `supabase/tests/profiles_rls.test.sql`
- Form/redirect pattern: `src/pages/api/auth/signin.ts`, `src/components/auth/SignInForm.tsx:43`
- Guard: `src/middleware.ts:5-8`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema, defaults, RLS and pgTAP tests

#### Automated

- [x] 1.1 Migration applies cleanly on a fresh local DB: `npx supabase db reset`
- [x] 1.2 pgTAP suites pass, including the existing structural RLS guards: `npx supabase test db`
- [x] 1.3 Lint passes: `npm run lint`

#### Manual

- [x] 1.4 In Supabase Studio (local), `bonus_settings` has exactly one row with the spreadsheet defaults, and `job_roles` lists the eight spreadsheet roles

### Phase 2: Admin settings app

#### Automated

- [ ] 2.1 Astro types regenerate and type-check passes: `npx astro sync && npx astro check`
- [ ] 2.2 Lint passes: `npm run lint`
- [ ] 2.3 Production build succeeds: `npm run build`
- [ ] 2.4 Existing auth smoke test still passes against a running dev server: `npm run smoke`
- [ ] 2.5 pgTAP suites still pass: `npx supabase test db`

#### Manual

- [ ] 2.6 Signed in as `admin@meritly.local`, `/admin/settings` shows the eight roles, KPI weights 0.30/0.30/0.25/0.15, bounds 0.70/1.30 and factors 0.80–1.20
- [ ] 2.7 Admin can add a role, edit its weight, archive it (it moves to the muted archived group) and restore it; each save shows a success message and persists after reload
- [ ] 2.8 Saving KPI weights that sum to 0.95, a min ≥ max, a decreasing factor list or a duplicate role name (different case) shows a readable error and leaves the stored values unchanged
- [ ] 2.9 Signed in as supervisor or employee, `/admin/settings` returns 403, and a POST to `/api/admin/bonus-settings/kpi` also returns 403
- [ ] 2.10 The page is usable at phone width (no horizontal scroll, forms stack)
