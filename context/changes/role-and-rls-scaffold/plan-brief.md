# Role & RLS Scaffold — Plan Brief

> Full plan: `context/changes/role-and-rls-scaffold/plan.md`

## What & Why

Roadmap F-01: give every user a server-side access role (`admin` / `supervisor` / `employee`) in a `profiles` table with RLS, plus a reusable role-check pattern. Every later slice's guarantee — Admin sees all, Supervisor their own work, Employee only themselves, even via URL manipulation — is unenforceable without it, and building it before any data exists avoids retrofitting RLS later.

## Starting Point

Supabase Auth and session middleware already work (`src/middleware.ts` puts `user` on `locals`), but there are no migrations, no tables and no notion of role anywhere. The only automated test is `npm run smoke` (signup → signin → dashboard).

## Desired End State

Each new signup automatically gets an `employee` profile; admins and supervisors are set by SQL. Policies check roles through shared SQL helpers, and a pgTAP suite in CI proves who can read or change which profile — and fails any future table without RLS or view without `security_invoker`. The app knows the signed-in user's role (`locals.profile`), shows it on `/dashboard`, and `/admin` is reachable only by admins.

## Key Decisions Made

| Decision               | Choice                                                                                                        | Why (1 sentence)                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Profile creation       | `after insert on auth.users` trigger, role defaults to `employee`                                             | No code path can skip it and existing signup/smoke flow stays unchanged.                                        |
| Admin bootstrap        | Local `seed.sql` users + documented one-line SQL for production                                               | No privilege-escalation surface in the app.                                                                     |
| Role check in RLS      | `security definer` helpers (`current_app_role`, `is_admin`, `is_supervisor`)                                  | Single source of truth, immediate effect, no recursive RLS on `profiles`.                                       |
| Profile visibility     | Employee: own row; Supervisor + Admin: all rows; Admin-only update; no API insert/delete                      | S-03 can list employees to assign without rewriting F-01's policy; profiles hold no figures.                    |
| App wiring             | `locals.profile` typed in `src/types.ts` + `/admin` 403 guard + role on dashboard                             | Later slices reuse one typed role source and one guard pattern.                                                 |
| Profile lookup failure | Distinct from "no row": logged, `locals.profileError = true`, guarded routes return 503                       | Valid users never get a misleading 403 during a DB outage, and the outage stays diagnosable.                    |
| Verification           | pgTAP via `supabase test db`, run in the CI `smoke` job                                                       | Proves RLS at the layer where the guarantee lives.                                                              |
| Test isolation         | No reset; suite runs in `begin…rollback` with its own UUID range (disjoint from seed) and relative row counts | Passes on any starting state (seed, smoke signups, repeated runs) without depending on command reset behaviour. |
| Phasing                | Tests ship with the schema in Phase 1                                                                         | No commit ever carries RLS without proof.                                                                       |

## Scope

**In scope:**

- Migration: `app_role` enum, `profiles` table + RLS, signup trigger, role helpers, per-role policies
- `supabase/seed.sql` with admin / supervisor / employee local users
- pgTAP suite incl. structural guards (RLS on every public table, `security_invoker` on every public view)
- CI step, `src/types.ts`, middleware profile loading, `/admin` guard, role on dashboard
- README role-promotion note, `docs/reference/contract-surfaces.md`

**Out of scope:**

- Admin UI for changing roles; supervisor→employee team relation; job roles with bonus weights (S-01/S-03)
- JWT custom claims; email sync to `profiles`; last-admin protection; new smoke steps; generated DB types

## Architecture / Approach

`auth.users` insert → trigger → `public.profiles` (role `employee`). Policies on `profiles` (and later on every slice's tables) call `(select public.is_admin())` etc., which read `profiles` as definer and bypass RLS recursion. The Astro middleware reads the signed-in user's own profile with the public key (RLS applies) into `locals.profile`; route guards branch on `profile.role`.

## Phases at a Glance

| Phase                                | What it delivers                                                     | Key risk                                                                                             |
| ------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1. Schema, RLS, seed and pgTAP tests | Proven role model in the DB, local seeded users                      | Trigger bug breaks signup; `auth.users` seeding gotchas                                              |
| 2. CI gate and app wiring            | RLS tests in CI, `locals.profile`, `/admin` guard, contract registry | Profile query failure mistaken for "no role" — mitigated: logged, `locals.profileError`, 503 not 403 |

**Prerequisites:** Docker + `npx supabase start` locally; nothing from other slices.
**Estimated effort:** ~2 sessions (one per phase).

## Open Risks & Assumptions

- Assumes no real users exist yet in the hosted project; if they do, a one-time backfill statement (in the plan's Migration Notes) creates their profiles.
- Supervisors can list every user's name/email — accepted, since profiles contain no compensation data.
- `supabase test db` in CI assumes the excluded services in the `smoke` job aren't needed by pgTAP (only the DB container is).

## Success Criteria (Summary)

- A fresh signup is an `employee` and can see only their own profile; no user can raise their own role.
- Seeded admin reaches `/admin`; employee and supervisor get 403.
- CI fails if any RLS guarantee, public-table RLS or view `security_invoker` rule regresses.
