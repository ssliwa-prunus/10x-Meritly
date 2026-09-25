# Role & RLS Scaffold Implementation Plan

## Overview

Roadmap item F-01. Introduce a `profiles` table keyed to `auth.users` that carries each user's access role (`admin` / `supervisor` / `employee`), with RLS enabled and a reusable role-check pattern (SQL helper functions) that every later slice (S-01…S-07) builds its own policies on. Prove the policies with pgTAP tests that run in CI, and expose the acting user's role to the Astro app through `context.locals` with one role-guarded route as the reference pattern.

## Current State Analysis

- **Data layer is empty**: no `supabase/migrations/` directory, no tables. `supabase/config.toml:60-65` enables seeding from `./seed.sql`, which does not exist yet. Email confirmation is disabled locally (`supabase/config.toml:209`).
- **Auth is wired but role-less**: `src/middleware.ts:10-14` resolves `supabase.auth.getUser()` into `context.locals.user`; `PROTECTED_ROUTES = ["/dashboard"]` (`src/middleware.ts:4`) only checks "signed in". `App.Locals` (`src/env.d.ts:1-5`) has only `user`.
- **Signup path**: `src/pages/api/auth/signup.ts:14` calls `supabase.auth.signUp` with the public key; any new user must end up with a profile without the app doing anything extra.
- **Testing**: no unit-test framework. `scripts/smoke.mjs` signs up a fresh user on every run, then signs in and hits `/dashboard` — a broken signup trigger would fail it immediately. CI `smoke` job (`.github/workflows/ci.yml`) already runs `supabase start` (which applies migrations + seed), so adding `supabase test db` there is cheap.
- **No shared types file**: `src/types.ts` does not exist yet (CLAUDE.md names it as the home for shared entities/DTOs).
- **No `docs/reference/contract-surfaces.md`** and no `context/foundation/lessons.md`.

## Desired End State

- `public.profiles` exists with `id` (PK, FK → `auth.users.id` on delete cascade), `email`, `display_name` (nullable), `role public.app_role not null default 'employee'`, `created_at`; RLS enabled in the same migration.
- Every new auth user automatically gets exactly one `employee` profile via a DB trigger; signup keeps working.
- Role checks in policies go through `security definer` helpers (`public.current_app_role()`, `public.is_admin()`, `public.is_supervisor()`), never through `user_metadata`.
- Visibility: Employee reads only own profile row; Supervisor and Admin read all rows; only Admin can update (including `role`); no API role can insert or delete rows.
- `supabase/seed.sql` provisions local admin / supervisor / employee users; promoting a user in production is a documented one-line SQL statement.
- `supabase test db` passes locally and in CI, covering the visibility matrix, role-escalation attempts, the trigger, and two structural guards for future slices (every `public` table has RLS enabled; every `public` view has `security_invoker = true`).
- The app exposes `locals.profile` (typed via `src/types.ts`), `/dashboard` shows the signed-in user's role, and `/admin` returns 403 for non-admins. A failed profile lookup is logged and flagged (`locals.profileError`), and guarded routes answer 503 rather than 403.

Verify: `npx supabase db reset && npx supabase test db`, `npm run lint`, `npx astro check`, `npm run build`, `npm run smoke`, plus the manual checks per phase.

### Key Discoveries:

- `src/middleware.ts:10-14` — single place where the user is resolved; profile loading belongs right after it.
- `src/middleware.ts:18-22` — existing redirect pattern for protected routes; the admin guard follows the same shape.
- `supabase/config.toml:60-65` — seed runs on `db reset` / `start`, never on `db push` to the hosted project, so seeded test users stay local.
- `.github/workflows/ci.yml` smoke job — starts local Supabase with most services excluded; `supabase test db` only needs the database container.
- CLAUDE.md RLS rules: roles in `profiles` (not `user_metadata`), one policy per operation per role, no `for all` policies, `security_invoker = true` on views.

## What We're NOT Doing

- No admin UI or API route for changing roles — role changes are SQL (seed locally, documented statement in production).
- No supervisor→employee team relation; "Supervisor sees own team" for bonus data is defined by project ownership in S-02/S-03. Supervisors can read all _profiles_ (identity only, no figures).
- No link between access roles and the job roles that carry bonus weights (FR-001/FR-007, S-01/S-03) — those are a separate concept and table.
- No JWT custom-claim / auth hook.
- No syncing of `profiles.email` when a user changes their auth email.
- No guard against an admin demoting the last admin.
- No new smoke-test steps; `npm run smoke` must simply keep passing.
- No generated Supabase TypeScript types (`supabase gen types`); `Profile` is hand-written in `src/types.ts`.

## Implementation Approach

Database first, proven before the app depends on it: Phase 1 lands the migration, seed and pgTAP tests together, so no commit ever carries RLS without tests. Phase 2 wires those tests into CI and adds the thin app layer (typed profile in locals, admin guard, role on dashboard) plus the contract-surfaces registry so later slices reuse the same names.

## Critical Implementation Details

- **Trigger and helpers must not recurse through RLS.** The signup trigger and the role helpers are `security definer` with `set search_path = ''` and fully-qualified names; policies on `profiles` call the helpers (which bypass RLS as the owner) rather than sub-selecting `profiles` inline, otherwise a supervisor/admin select policy recurses into itself. Wrap helper calls as `(select public.is_admin())` so Postgres evaluates them once per statement.
- **Seeding `auth.users` directly has gotchas.** Rows need `aud`/`role` = `'authenticated'`, `encrypted_password = crypt(<pw>, gen_salt('bf'))`, `email_confirmed_at` set, and empty strings (not NULL) in `confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change`; a matching `auth.identities` row (provider `email`) is required for password sign-in. Insert users first (trigger creates `employee` profiles), then `update public.profiles set role = …` for the admin and supervisor.
- **Deliberately absent policies.** "One policy per operation per role" is satisfied by _omitting_ insert and delete policies for every API role (RLS then denies them); inserts happen only through the trigger, deletes only through the `auth.users` cascade. State this in a migration comment so later reviewers don't read it as an oversight.
- **Test isolation model: disjoint fixtures, rolled back, no reset.** `supabase test db` runs pg_prove against the _running_ database and does not reset it. The suite therefore makes no assumption about what else is in the DB:
  - **Expected starting state:** migrations applied, seed users present, and possibly any number of extra users (e.g. smoke-test signups from local runs).
  - **Own fixtures:** the suite creates its own users with UUIDs from a reserved range (`00000000-0000-4000-8000-0000000001xx`) and emails under `@pgtap.test`. The seed uses a disjoint range (`00000000-0000-4000-8000-0000000000xx`, emails under `@meritly.local`), so fixture IDs can never collide.
  - **Rollback:** the whole file runs inside `begin … rollback`, so fixtures never persist and repeated runs start from the same state.
  - **Relative counts:** "sees all rows" assertions compare the impersonated count against `count(*)` taken as the table owner in the same transaction, never against a hard-coded number. "Own row only" assertions check exactly 1 row and that its id is the caller's.

  No `db reset` is needed before the tests, locally or in CI.

## Phase 1: Schema, RLS, seed and pgTAP tests

### Overview

Create the access-role data model, its policies and helpers in one migration, seed local users, and prove the whole visibility matrix with pgTAP tests runnable via `npx supabase test db`.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20260925120000_role_and_rls_scaffold.sql`

**Intent**: Create the access-role enum, `profiles` table with RLS, the signup trigger, role helper functions and per-role policies — the foundation every later slice's policies call into.

**Contract**:

- `create type public.app_role as enum ('admin', 'supervisor', 'employee')`.
- `public.profiles(id uuid primary key references auth.users(id) on delete cascade, email text not null, display_name text, role public.app_role not null default 'employee', created_at timestamptz not null default now())`; `alter table … enable row level security` in the same file.
- `public.handle_new_user()` trigger function (`security definer`, `set search_path = ''`) + `on_auth_user_created` `after insert on auth.users for each row` — inserts `(id, email, display_name from raw_user_meta_data->>'display_name')`; role always takes the default, never read from metadata.
- Helpers, all `language sql stable security definer set search_path = ''`: `public.current_app_role() returns public.app_role` (role of `auth.uid()`, NULL if none), `public.is_admin() returns boolean`, `public.is_supervisor() returns boolean`. `revoke execute … from public, anon`; `grant execute … to authenticated`.
- Policies on `public.profiles`, all `to authenticated`: `profiles_select_own` (`id = (select auth.uid())`), `profiles_select_supervisor` (`(select public.is_supervisor())`), `profiles_select_admin` (`(select public.is_admin())`), `profiles_update_admin` (using + with check `(select public.is_admin())`). No insert/delete policies (commented as deliberate). `revoke all on public.profiles from anon`.

#### 2. Seed data

**File**: `supabase/seed.sql`

**Intent**: Give local dev and CI three ready-to-use accounts, one per role, recreated on every `supabase db reset`.

**Contract**: Users `admin@meritly.local`, `supervisor@meritly.local`, `employee@meritly.local` with a shared documented local password; fixed UUIDs from the seed range `00000000-0000-4000-8000-0000000000xx` (disjoint from the pgTAP range, see Critical Implementation Details); `auth.users` + `auth.identities` rows per the gotchas above; then role updates on `public.profiles`. Header comment: local only, never run against the hosted project.

#### 3. RLS tests

**File**: `supabase/tests/profiles_rls.test.sql`

**Intent**: Prove the visibility matrix and escalation resistance at the DB layer, and add structural guards that fail future slices which forget RLS or `security_invoker`.

**Contract**: pgTAP (`create extension if not exists pgtap with schema extensions`), wrapped in `begin; … select * from finish(); rollback;`. It follows the isolation model in Critical Implementation Details: it tolerates seed users and any other pre-existing rows, creates its own users with UUIDs in `00000000-0000-4000-8000-0000000001xx` and emails under `@pgtap.test` by inserting into `auth.users` (which exercises the trigger), and never relies on a reset or on absolute row counts. It impersonates users via impersonates via `set local role authenticated` + `set local request.jwt.claims = '{"sub":"<uuid>"}'` (and `set local role anon` for the anonymous case). Assertions:

- trigger creates exactly one profile with role `employee` for a new auth user;
- employee sees exactly 1 row (own) and 0 rows when selecting another user's id;
- supervisor and admin each see all rows (impersonated count = owner-side `count(*)` in the same transaction); anon sees 0 rows;
- employee updating own `role` to `admin` affects 0 rows and the role stays `employee`; same for a supervisor updating anyone;
- admin can update another user's role;
- insert into `profiles` as authenticated fails with `42501`; delete as authenticated removes 0 rows;
- `current_app_role()` returns the impersonated user's role;
- structural: no table in schema `public` has `relrowsecurity = false`; no view in schema `public` lacks `security_invoker=true` in `reloptions`.

#### 4. Production role promotion note

**File**: `README.md`

**Intent**: Document how to promote a user in the hosted project until an admin UI exists.

**Contract**: New short "Roles" section: roles live in `public.profiles.role`; new signups are `employee`; promote with `update public.profiles set role = 'admin' where email = '<email>';` run in the Supabase SQL editor; never store roles in `user_metadata`.

### Success Criteria:

#### Automated Verification:

- Migration and seed apply cleanly: `npx supabase db reset`
- pgTAP suite passes: `npx supabase test db`
- Smoke test still passes against a local dev server (signup trigger does not break signup): `npm run smoke`
- pgTAP suite is isolated: after the smoke run (extra users present) it passes twice in a row without a reset: `npx supabase test db && npx supabase test db`

#### Manual Verification:

- In Supabase Studio, `profiles` shows the three seeded users with roles admin / supervisor / employee, and the smoke-test signup appears as `employee`
- Signing in as `employee@meritly.local` in the app works (seeded password login is valid)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: CI gate and app wiring

### Overview

Run the RLS suite in CI, expose the acting user's profile to Astro, add the reference admin guard, and register the new load-bearing names.

### Changes Required:

#### 1. CI

**File**: `.github/workflows/ci.yml`

**Intent**: Fail the pipeline when an RLS guarantee regresses.

**Contract**: In the `smoke` job, a `Run RLS tests` step runs `supabase test db` right after `Start local Supabase` and before the build.

- **Starting state:** fresh migrations plus seed, since `supabase start` applies both. There is no explicit reset step, because the suite is isolated by design (see Critical Implementation Details).
- **Ordering:** the step runs before the smoke run, so smoke signups don't exist yet. The suite does not depend on that ordering.

#### 2. Shared types

**File**: `src/types.ts` (new)

**Intent**: One typed source for the access role used by middleware, pages and later slices.

**Contract**: `export type AppRole = "admin" | "supervisor" | "employee"`; `export interface Profile { id: string; email: string; display_name: string | null; role: AppRole }` — mirrors `public.profiles` / `public.app_role`.

#### 3. Locals typing

**File**: `src/env.d.ts`

**Intent**: Make the profile available to every page and route with types.

**Contract**: `App.Locals` gains `profile: import("@/types").Profile | null` and `profileError: boolean` (true only when the profile query itself failed, so "no role" and "lookup failed" are never conflated).

#### 4. Middleware

**File**: `src/middleware.ts`

**Intent**: Load the signed-in user's profile once per request (as that user, so RLS applies) and guard admin-only routes.

**Contract**: After resolving `user`, select `id, email, display_name, role` from `profiles` where `id = user.id` (`maybeSingle`). Three outcomes are kept distinct:

- **Row found** → `context.locals.profile = <row>`.
- **No row** (`data === null`, no error) → `profile = null`. This is the valid "no role" state (signed out, profile missing, Supabase unconfigured).
- **Query error** (`error` set) → `profile = null` and `context.locals.profileError = true`. Log with `console.error` including the user id and the error `code`/`message`, so an outage shows up in Workers observability logs instead of looking like a missing role.

New `ADMIN_ROUTES = ["/admin"]`, checked in this order:

1. Unauthenticated → the existing redirect to `/auth/signin`.
2. `profileError` → `503` response ("temporarily unavailable"). A valid admin never gets a misleading 403 during a DB failure.
3. `profile?.role !== "admin"` → `403` response.

`/admin` is added to the protected set. `App.Locals` also gains `profileError: boolean` (see change 3).

#### 5. Admin reference page

**File**: `src/pages/admin/index.astro` (new)

**Intent**: Minimal admin-only page proving the guard pattern; S-01 will build on it.

**Contract**: Uses `Layout`, shows "Admin" heading and the admin's email; matches `dashboard.astro` styling.

#### 6. Dashboard role display

**File**: `src/pages/dashboard.astro`

**Intent**: Make the resolved role visible for manual verification.

**Contract**: Shows `Astro.locals.profile?.role` next to the email.

#### 7. Contract surfaces registry

**File**: `docs/reference/contract-surfaces.md` (new)

**Intent**: Record the load-bearing names later slices must reuse and not rename.

**Contract**: Table listing `public.app_role`, `public.profiles` (+ columns), `public.current_app_role()`, `public.is_admin()`, `public.is_supervisor()`, trigger `on_auth_user_created`, `locals.profile`, `locals.profileError`, `AppRole` / `Profile` in `src/types.ts`, `ADMIN_ROUTES`; plus the policy conventions (helper calls wrapped in `(select …)`, `security_invoker = true` on views, structural tests in `supabase/tests/`).

### Success Criteria:

#### Automated Verification:

- Types regenerate and check cleanly: `npx astro sync && npx astro check`
- Lint passes: `npm run lint`
- Build passes: `npm run build`
- pgTAP suite still passes: `npx supabase test db`
- Smoke test passes: `npm run smoke`
- CI run on the pushed branch is green, including the new `Run RLS tests` step

#### Manual Verification:

- Signed in as `employee@meritly.local`, `/dashboard` shows role `employee` and `/admin` returns 403
- Signed in as `supervisor@meritly.local`, `/admin` returns 403
- Signed in as `admin@meritly.local`, `/dashboard` shows role `admin` and `/admin` renders
- Signed out, `/admin` redirects to `/auth/signin`
- Profile query failure is not a 403: with the middleware query temporarily pointed at a nonexistent column, `/admin` as admin returns 503 and the dev-server log shows the error with the user id (then revert)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- None — the project has no unit-test framework; the guarantees under test live in the database.

### Integration Tests:

- pgTAP suite `supabase/tests/profiles_rls.test.sql`: visibility matrix per role, escalation attempts, insert/delete denial, trigger behaviour, structural RLS / `security_invoker` guards. Runs locally and in CI.
- Existing `npm run smoke` covers signup → signin → dashboard with the trigger in place.

### Manual Testing Steps:

1. `npx supabase db reset`, start dev server, sign in as each seeded user and check `/dashboard` role and `/admin` access.
2. Sign up a brand-new user in the UI and confirm Studio shows an `employee` profile.
3. In Studio SQL, promote that user to `admin`, reload `/admin` — it renders without re-login.

## Performance Considerations

One extra primary-key lookup on `profiles` per authenticated request, and one per statement inside policies (helpers wrapped in `(select …)`). Negligible at the target scale (a handful of users).

## Migration Notes

Greenfield: no existing data. Users created in the hosted project before this migration have no profile; the middleware treats a missing profile as `null` (no role, no admin access). If any such users exist, backfill with `insert into public.profiles (id, email) select id, email from auth.users on conflict do nothing;` run once in the SQL editor. Rollback = new migration dropping the policies, helpers, trigger, table and type.

## References

- Roadmap item: `context/foundation/roadmap.md` — F-01: Role & RLS scaffold
- PRD: `context/foundation/prd.md` — Access Control, NFR (visibility)
- Middleware pattern: `src/middleware.ts:4-22`
- Signup path: `src/pages/api/auth/signup.ts:14`
- CI smoke job: `.github/workflows/ci.yml`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema, RLS, seed and pgTAP tests

#### Automated

- [x] 1.1 Migration and seed apply cleanly: `npx supabase db reset` — c1972b6
- [x] 1.2 pgTAP suite passes: `npx supabase test db` — c1972b6
- [x] 1.3 Smoke test still passes against a local dev server (signup trigger does not break signup): `npm run smoke` — c1972b6
- [x] 1.6 pgTAP suite is isolated: after the smoke run (extra users present) it passes twice in a row without a reset: `npx supabase test db && npx supabase test db` — c1972b6

#### Manual

- [x] 1.4 In Supabase Studio, `profiles` shows the three seeded users with roles admin / supervisor / employee, and the smoke-test signup appears as `employee` — c1972b6
- [x] 1.5 Signing in as `employee@meritly.local` in the app works (seeded password login is valid) — c1972b6

### Phase 2: CI gate and app wiring

#### Automated

- [x] 2.1 Types regenerate and check cleanly: `npx astro sync && npx astro check` — 586d60d
- [x] 2.2 Lint passes: `npm run lint` — 586d60d
- [x] 2.3 Build passes: `npm run build` — 586d60d
- [x] 2.4 pgTAP suite still passes: `npx supabase test db` — 586d60d
- [x] 2.5 Smoke test passes: `npm run smoke` — 586d60d
- [x] 2.6 CI run on the pushed branch is green, including the new `Run RLS tests` step — 586d60d

#### Manual

- [x] 2.7 Signed in as `employee@meritly.local`, `/dashboard` shows role `employee` and `/admin` returns 403 — 586d60d
- [x] 2.8 Signed in as `supervisor@meritly.local`, `/admin` returns 403 — 586d60d
- [x] 2.9 Signed in as `admin@meritly.local`, `/dashboard` shows role `admin` and `/admin` renders — 586d60d
- [x] 2.10 Signed out, `/admin` redirects to `/auth/signin` — 586d60d
- [x] 2.11 Profile query failure is not a 403: with the middleware query temporarily pointed at a nonexistent column, `/admin` as admin returns 503 and the dev-server log shows the error with the user id (then revert) — 586d60d
