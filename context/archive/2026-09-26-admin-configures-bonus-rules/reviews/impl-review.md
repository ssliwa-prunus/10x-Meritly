<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Admin Configures Bonus Rules

- **Plan**: context/changes/admin-configures-bonus-rules/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-09-26
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Evidence

- **Scope**: commits `4ef6e3e`, `38a2ac8`, `b4fe6a5`. All 17 changed code files are listed in the plan, and none are missing.
- **Drift check**: every planned change is a MATCH. The six EXTRA items are harmless:
  - additional pgTAP assertions: admin insert into `bonus_settings` raises 42501; anon gets 42501; employee and supervisor deletes are empty;
  - a `ServiceResult<T>` that carries data for the read functions;
  - the redirect helpers living in the service module;
  - one line of freezing copy on the settings page.
- **"What We're NOT Doing"**: nothing violated. There are no islands, no service-role use, no delete path, no re-filling of rejected input and no versioning.
- **Automated criteria re-run**, all passing:
  - `supabase db reset`
  - `supabase test db` (73/73)
  - `astro sync` + `astro check` (0/0/0)
  - `eslint`
  - `npm run build`
  - `npm run smoke` (8/8, against the dev server on local Supabase)
- **Manual criteria**: 1.4 and 2.6–2.10 were confirmed by the user during `/10x-implement`.
- **Framework behaviour** (from `node_modules`):
  - Astro escapes `{expr}` output, so there is no XSS.
  - `checkOrigin` defaults to on, so there is no CSRF.
  - The pathname is decoded before middleware runs, so the `startsWith` guard cannot be bypassed.
  - zod strips unknown keys, so there is no mass assignment.

## Findings

### F1 — `formData()` parse errors surface as a raw 500

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/admin/job-roles/index.ts:17, job-roles/[id].ts:23, job-roles/[id]/archive.ts:27, bonus-settings/kpi.ts:17, bonus-settings/rating-factors.ts:17
- **Detail**:
  - `await context.request.formData()` is unguarded.
  - A JSON body, an empty body or broken multipart throws a TypeError, and the admin gets a raw 500 instead of the redirect-with-error flow.
  - Only admins can reach it, because the middleware runs first. The auth routes have the same gap.
- **Fix**: Add a `parseForm(request, schema)` helper in the service that catches the parse error and returns a validation-style failure. Use it in all five routes, so errors redirect with "Invalid form submission".
- **Decision**: FIXED — `parseForm()` helper in bonus-config.ts, used by all 5 admin routes; a JSON or empty body now redirects with `invalid_form`

### F2 — `authenticated` keeps TRUNCATE/REFERENCES/TRIGGER on the config tables

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260926120000_bonus_rules_config.sql:34,80
- **Detail**:
  - Verified in the local DB: `authenticated` has DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE and UPDATE on `job_roles` and `bonus_settings`. It has the same on `profiles`, from F-01.
  - TRUNCATE ignores RLS. PostgREST can't reach it today, so this is defence-in-depth, but the migration only revokes from `anon`.
- **Fix**: In a new migration, `revoke truncate, references, trigger on public.job_roles, public.bonus_settings, public.profiles from authenticated;`, plus a pgTAP `table_privs_are`-style assertion.
- **Decision**: SKIPPED — defence-in-depth only; not reachable through PostgREST today

### F3 — Decimal parsing accepts hex and sub-hundredth noise

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/bonus-config.ts:13-22
- **Detail**:
  - `"0x1"` is accepted as 1, through `Number()` coercion.
  - `"1.0000000001"` passes the 1e-6 two-decimal tolerance, and `numeric(4,2)` then silently stores 1.00.
  - The DB CHECKs still guarantee valid stored values.
- **Fix**: Add `.regex(/^\d+(\.\d{1,2})?$/)` on the trimmed string before coercion, and drop the float tolerance.
- **Decision**: SKIPPED — DB CHECKs already guarantee stored values

### F4 — `description` has no length cap

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260926120000_bonus_rules_config.sql:15-27, src/lib/services/bonus-config.ts:45-49
- **Detail**: `job_roles.description` is unbounded in both zod and the DB, while `name` is capped at 100.
- **Fix**: Add `.max(500)` in zod and a matching `char_length(description) <= 500` CHECK in a new migration.
- **Decision**: SKIPPED

### F5 — Admin page shows free text from the URL

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/admin/settings.astro:11-16, src/lib/services/bonus-config.ts:132-133
- **Detail**:
  - `?error=<text>` is rendered into a `role="alert"` box on an admin page. The text is escaped, so it is not XSS.
  - A crafted link can still show arbitrary text, for example "Session expired, re-enter your password at …".
  - The auth pages use the same pattern.
- **Fix**: Redirect with an error code, such as `?error=duplicate_name`, and map it to a message from a fixed server-side table, falling back to a generic message.
- **Decision**: FIXED — redirects carry an error code plus optional field; `settingsErrorMessage()` resolves them from a fixed catalog, and unknown codes show a generic message

### F6 — Duplicated input classes and routing helpers in the service

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/admin/JobRolesSection.astro:21-28, KpiSettingsSection.astro:13-16, RatingFactorsSection.astro:13-16; src/lib/services/bonus-config.ts:122-133
- **Detail**:
  - `inputClass` is copied into three components, and the copies have already diverged: only JobRoles has `min-w-0`.
  - `buttonClass = cn("<one string>")` is a no-op use of `cn()`.
  - The redirect/URL helpers live in the data service.
- **Fix**: Extract the shared form class constants into one module, such as `src/components/admin/form-classes.ts`. The URL helpers can stay where they are.
- **Decision**: FIXED — shared `inputClass`/`buttonClass` in src/components/admin/form-classes.ts, used by all three sections
