# Admin Configures Bonus Rules — Plan Brief

> Full plan: `context/changes/admin-configures-bonus-rules/plan.md`

## What & Why

Roadmap S-01 (FR-001/002/003): an Admin maintains the bonus formula's global parameters. These are job roles with weights, the four KPI weights with the min/max milestone-multiplier bounds, and the contribution-rating (1–5) → factor mapping. S-04's computation consumes these values, and S-03 assigns employees to job roles, so the config must exist, be valid and be readable under RLS before those slices start.

## Starting Point

F-01 delivered `profiles` with access roles, the `is_admin()`/`is_supervisor()` policy helpers, a pgTAP suite with structural RLS guards in CI and an `/admin` route guard. There are no config tables, no service layer and no admin UI beyond a placeholder page. The spreadsheet `Model_premiowania.xlsx` (`Ustawienia` sheet) holds the validated default values.

## Desired End State

A seeded admin opens `/admin/settings` and sees all three config groups pre-filled with the spreadsheet defaults. The admin can add, edit, archive and restore job roles, and edit the KPI weights, bounds and rating factors. Invalid values are rejected with a readable message by both the form and the database. Supervisors can read the config (for S-03/S-04), employees cannot see it at all, and pgTAP proves both.

## Key Decisions Made

| Decision               | Choice                                                                                                                                                        | Why (1 sentence)                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Freezing Approved data | Current config only; S-04/S-05 snapshot the values they used onto result rows                                                                                 | Keeps S-01 simple and makes historical results self-contained, so config edits can never alter them. |
| Removing a role        | Archive (`archived_at`) with restore; no hard delete                                                                                                          | Removal always succeeds and never orphans the employees S-03 will link to a role.                    |
| Value rules            | KPI weights ≥ 0 summing to exactly 1.00; 0 < min < max ≤ 3; role weight in (0, 3]; factors in (0, 3] and non-decreasing; enforced in both zod and DB `CHECK`s | Blocks nonsense configs while letting Admin move beyond the spreadsheet defaults.                    |
| Read access            | Admin: select, insert, update; Supervisor: select; Employee: none; no delete policies                                                                         | Least privilege that still lets S-03/S-04 run as the signed-in user without the service-role key.    |
| Defaults               | Seeded in the migration (settings row plus the 8 spreadsheet roles)                                                                                           | Every environment, including production, starts with a valid config, and S-04 can assume it exists.  |
| UI                     | One `/admin/settings` Astro page, three sections, HTML forms that POST to zod-validated routes and redirect back                                              | Matches the existing auth form pattern and the `.astro`-first rule, with minimal JS.                 |
| Storage shape          | `job_roles` table plus a singleton `bonus_settings` row holding the KPI weights, bounds and `rating_factor_1…5`                                               | Single-row `CHECK`s enforce "sum = 1" and "non-decreasing" without cross-row triggers.               |
| Admin API guard        | Add `/api/admin` to `PROTECTED_ROUTES` and `ADMIN_ROUTES`                                                                                                     | The `/admin` prefix doesn't match API paths, so non-admins would otherwise reach the handlers.       |

## Scope

**In scope:**

- Migration: `job_roles`, `bonus_settings`, constraints, RLS policies, audit trigger (`updated_at`/`updated_by`), seeded defaults
- pgTAP suite `bonus_config_rls.test.sql` (access matrix, constraints, defaults, no delete)
- `src/types.ts` types, `src/lib/services/bonus-config.ts` (zod + queries), five `/api/admin/...` POST routes
- Middleware guard for `/api/admin`, the `/admin/settings` page with three section components, a link from `/admin`
- `contract-surfaces.md` rows plus the "config snapshot rule" for S-04/S-05

**Out of scope:**

- Config versioning or history, hard delete of roles, an audit log beyond `updated_*`
- Employee↔role link (S-03), multiplier computation and Ryzyko direction (S-04)
- Employee access to config, React islands or live validation, re-filling rejected form input, new smoke steps, concurrency control (last write wins)

## Architecture / Approach

Browser `<form>` → `POST /api/admin/...` (middleware: admin only) → zod schema in `bonus-config.ts` → Supabase client acting as the admin user (RLS: `is_admin()` write policies) → DB `CHECK`s as the final guard → redirect to `/admin/settings?saved=…` or `?error=…`. The page reads through the same service. Supervisors read the same tables in later slices through `is_supervisor()` select policies.

## Phases at a Glance

| Phase                                    | What it delivers                                                          | Key risk                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1. Schema, defaults, RLS and pgTAP tests | Config tables with defaults, proven access matrix and value rules         | Constraint or policy gaps. Mitigated: every rule has a pgTAP assertion                  |
| 2. Admin settings app                    | `/admin/settings` with three editable sections, validated admin-only APIs | Float rounding in the KPI-sum check (compare in hundredths); missing `/api/admin` guard |

**Prerequisites:** F-01 done (it is), Docker plus `npx supabase start` locally.
**Estimated effort:** ~2 sessions (one per phase).

## Open Risks & Assumptions

- **Ryzyko direction (for S-04):** the spreadsheet formula uses `1 − Ryzyko/100` (lower is better), while the instructions document says 100 = no problems. S-01 stores only the weight. S-04 must settle the direction before computing.
- The production role list starts with the eight spreadsheet roles. Admin can archive the ones that don't apply.
- Assumes two-decimal precision is enough for all weights and factors (true for every spreadsheet value).

## Success Criteria (Summary)

- Admin can view and change all three config groups at `/admin/settings`, and every change persists.
- Invalid configs (KPI sum ≠ 1, min ≥ max, decreasing factors, duplicate role) are rejected by both the form and the DB.
- Supervisors can read the config, employees cannot, and only admins can change it. This is proven in CI by pgTAP.
