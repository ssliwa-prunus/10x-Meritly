-- pgTAP suite: catalog guard for the RLS surface (testing-rls-matrix, test-plan risk #2).
--
-- Purpose: catch the NEXT migration. rls_matrix.test.sql asserts every actor x surface x operation
-- cell of the decided matrix, but it can only test surfaces it knows about. This file compares the
-- live catalog with the classified surface written out literally below, so a new or renamed table,
-- policy, grant or security definer function fails here until someone classifies it on purpose.
-- The expected lists are the oracle (context/changes/testing-rls-matrix/plan.md, "Decided matrix";
-- research.md §1 minus profiles_select_supervisor, dropped in
-- 20261007120000_rls_tighten_profiles_and_grants.sql). Never edit them just to match the catalog.
--
-- Update rule: when a migration adds, renames or drops a table, policy, grant or definer function,
-- update the expected list here AND add the matching cells to supabase/tests/rls_matrix.test.sql.
--
-- The RLS-enabled and security_invoker checks live in profiles_rls.test.sql (structural guards) and
-- are not repeated here. Catalog queries only: runs as the owner, no fixtures, nothing to roll back
-- beyond the pgTAP plan.
--
-- Failure diagnostics: set_eq prints the extra and missing rows; is_empty prints the offending rows.
--
-- Run with: npx supabase test db

begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

-- ---------------------------------------------------------------------------
-- Table set: every table in public is one the matrix classifies
-- ---------------------------------------------------------------------------
select set_eq(
  $$
    select c.relname::text
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  $$,
  $$
    values
      ('profiles'),
      ('job_roles'),
      ('bonus_settings'),
      ('projects'),
      ('milestones'),
      ('employees'),
      ('milestone_engagements'),
      ('milestone_results'),
      ('milestone_result_lines')
  $$,
  'tables in public match the classified set (new table? update rls_catalog_guard.test.sql and rls_matrix.test.sql)'
);

-- ---------------------------------------------------------------------------
-- Policy inventory: (table, policy, command). "No policy" for an operation means denied.
-- ---------------------------------------------------------------------------
select set_eq(
  $$
    select tablename::text, policyname::text, cmd::text
    from pg_catalog.pg_policies
    where schemaname = 'public'
  $$,
  $$
    values
      -- profiles: own row for everyone, all rows for admin (F1: no supervisor-wide select)
      ('profiles', 'profiles_select_own', 'SELECT'),
      ('profiles', 'profiles_select_admin', 'SELECT'),
      ('profiles', 'profiles_update_admin', 'UPDATE'),
      -- job_roles / bonus_settings: supervisors read, admin writes
      ('job_roles', 'job_roles_select_admin', 'SELECT'),
      ('job_roles', 'job_roles_select_supervisor', 'SELECT'),
      ('job_roles', 'job_roles_insert_admin', 'INSERT'),
      ('job_roles', 'job_roles_update_admin', 'UPDATE'),
      ('bonus_settings', 'bonus_settings_select_admin', 'SELECT'),
      ('bonus_settings', 'bonus_settings_select_supervisor', 'SELECT'),
      ('bonus_settings', 'bonus_settings_update_admin', 'UPDATE'),
      -- projects: owner supervisor and admin; no delete
      ('projects', 'projects_select_supervisor', 'SELECT'),
      ('projects', 'projects_select_admin', 'SELECT'),
      ('projects', 'projects_insert_supervisor', 'INSERT'),
      ('projects', 'projects_insert_admin', 'INSERT'),
      ('projects', 'projects_update_supervisor', 'UPDATE'),
      ('projects', 'projects_update_admin', 'UPDATE'),
      -- milestones: owner of the parent project; admin reads only; no delete
      ('milestones', 'milestones_select_supervisor', 'SELECT'),
      ('milestones', 'milestones_select_admin', 'SELECT'),
      ('milestones', 'milestones_insert_supervisor', 'INSERT'),
      ('milestones', 'milestones_update_supervisor', 'UPDATE'),
      -- employees: owning supervisor and admin; no delete
      ('employees', 'employees_select_supervisor', 'SELECT'),
      ('employees', 'employees_select_admin', 'SELECT'),
      ('employees', 'employees_insert_supervisor', 'INSERT'),
      ('employees', 'employees_insert_admin', 'INSERT'),
      ('employees', 'employees_update_supervisor', 'UPDATE'),
      ('employees', 'employees_update_admin', 'UPDATE'),
      -- milestone_engagements: owner of the milestone (all four); admin reads only
      ('milestone_engagements', 'milestone_engagements_select_supervisor', 'SELECT'),
      ('milestone_engagements', 'milestone_engagements_select_admin', 'SELECT'),
      ('milestone_engagements', 'milestone_engagements_insert_supervisor', 'INSERT'),
      ('milestone_engagements', 'milestone_engagements_update_supervisor', 'UPDATE'),
      ('milestone_engagements', 'milestone_engagements_delete_supervisor', 'DELETE'),
      -- milestone_results: read-only snapshot header; no employee policy (privacy split)
      ('milestone_results', 'milestone_results_select_supervisor', 'SELECT'),
      ('milestone_results', 'milestone_results_select_admin', 'SELECT'),
      -- milestone_result_lines: read-only; employee sees own line of an approved milestone only
      ('milestone_result_lines', 'milestone_result_lines_select_supervisor', 'SELECT'),
      ('milestone_result_lines', 'milestone_result_lines_select_admin', 'SELECT'),
      ('milestone_result_lines', 'milestone_result_lines_select_employee', 'SELECT')
  $$,
  'policies in public match the classified inventory (update rls_catalog_guard.test.sql and rls_matrix.test.sql)'
);

-- ---------------------------------------------------------------------------
-- No broad policies: one command per policy, granted to authenticated only
-- ---------------------------------------------------------------------------
select is_empty(
  $$
    select tablename::text, policyname::text
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and cmd = 'ALL'
  $$,
  'no "for all" policy in public (split it per operation; update rls_catalog_guard.test.sql and rls_matrix.test.sql)'
);
select is_empty(
  $$
    select tablename::text, policyname::text, roles::text
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and roles is distinct from '{authenticated}'::name[]
  $$,
  'every policy in public is "to authenticated" only (update rls_catalog_guard.test.sql and rls_matrix.test.sql)'
);

-- ---------------------------------------------------------------------------
-- Grant hygiene (F2). Covers tables and views: anon holds nothing (table- or column-level), and
-- authenticated holds none of the privileges RLS does not govern or the app never uses.
-- ---------------------------------------------------------------------------
select is_empty(
  $$
    select c.relname::text, p.privilege
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join (
      values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
    ) as p (privilege)
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm')
      and (
        pg_catalog.has_table_privilege('anon', c.oid, p.privilege)
        or (
          p.privilege in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
          and pg_catalog.has_any_column_privilege('anon', c.oid, p.privilege)
        )
      )
  $$,
  'anon holds no privilege on any public table or view (update rls_catalog_guard.test.sql and rls_matrix.test.sql)'
);
select is_empty(
  $$
    select c.relname::text, p.privilege
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p (privilege)
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm')
      and pg_catalog.has_table_privilege('authenticated', c.oid, p.privilege)
  $$,
  'authenticated holds no truncate, references or trigger in public (update rls_catalog_guard.test.sql and rls_matrix.test.sql)'
);

-- ---------------------------------------------------------------------------
-- Definer allowlist: security definer functions an authenticated user can call directly.
-- Trigger functions are definer too but must stay non-executable; they are not on this list.
-- Keyed on the full signature, so a new overload of an allowlisted name is caught too.
-- ---------------------------------------------------------------------------
select set_eq(
  $$
    select p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')'
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
  $$,
  $$
    values
      ('current_app_role()'),
      ('is_admin()'),
      ('is_supervisor()'),
      ('owns_project(uuid)'),
      ('owns_milestone(uuid)'),
      ('employee_engaged_on_own_milestone(uuid)'),
      ('current_employee_id()'),
      -- F4 accepted: unscoped, but returns only a boolean for an unguessable UUID
      ('is_approved_milestone(uuid)'),
      ('approve_milestone(uuid)')
  $$,
  'security definer functions executable by authenticated match the allowlist (update rls_catalog_guard.test.sql and rls_matrix.test.sql)'
);

-- ---------------------------------------------------------------------------
-- Search path: every security definer function pins search_path
-- ---------------------------------------------------------------------------
select is_empty(
  $$
    select p.proname::text
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, '{}'::text[])) as cfg
        where cfg like 'search_path=%'
      )
  $$,
  'every security definer function in public sets search_path (add "set search_path = ''''"; update rls_catalog_guard.test.sql and rls_matrix.test.sql)'
);

select * from finish();

rollback;
