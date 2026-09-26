-- pgTAP suite for the bonus rules config (public.job_roles, public.bonus_settings,
-- public.set_config_audit_fields()).
--
-- Isolation model: same as profiles_rls.test.sql. Runs against the live local database without
-- a reset, creates its own fixtures in the reserved UUID range 00000000-0000-4000-8000-0000000002xx
-- with emails under @pgtap.test, never asserts absolute row counts (an admin may add roles), and
-- rolls everything back at the end. The seeded-defaults checks assume the migration's defaults
-- have not been edited in the local database (true after `npx supabase db reset` and in CI).
--
-- Run with: npx supabase test db

begin;

create extension if not exists pgtap with schema extensions;

select plan(43);

-- ---------------------------------------------------------------------------
-- Seeded defaults (as the table owner)
-- ---------------------------------------------------------------------------
select ok(
  exists (
    select 1
    from public.bonus_settings
    where id
      and kpi_weight_schedule = 0.30
      and kpi_weight_budget = 0.30
      and kpi_weight_quality = 0.25
      and kpi_weight_risk = 0.15
      and multiplier_min = 0.70
      and multiplier_max = 1.30
      and rating_factor_1 = 0.80
      and rating_factor_2 = 0.90
      and rating_factor_3 = 1.00
      and rating_factor_4 = 1.10
      and rating_factor_5 = 1.20
  ),
  'bonus_settings row holds the spreadsheet defaults'
);
select is(
  (
    select count(*)::int
    from public.job_roles jr
    join (
      values
        ('Lider projektu / Architekt', 1.25),
        ('Senior', 1.10),
        ('Specjalista', 1.00),
        ('Junior', 0.85),
        ('Tester/QA', 1.00),
        ('Inż. elektroniki', 1.10),
        ('Inż. firmware', 1.15),
        ('Inż. oprogramowania', 1.05)
    ) as d (name, weight) on jr.name = d.name and jr.weight = d.weight
  ),
  8,
  'all eight spreadsheet job roles are present with their weights'
);

-- ---------------------------------------------------------------------------
-- Fixtures (as the table owner)
--   users: ...0201 employee   ...0202 supervisor   ...0203 admin
--   roles: ...0211 archived role (owner-inserted)   ...0212 role created by the admin
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000201', 'authenticated', 'authenticated', 'config-employee@pgtap.test', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000202', 'authenticated', 'authenticated', 'config-supervisor@pgtap.test', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000203', 'authenticated', 'authenticated', 'config-admin@pgtap.test', '{}', now(), now());

update public.profiles set role = 'supervisor' where id = '00000000-0000-4000-8000-000000000202';
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-000000000203';

-- Written without a JWT, so the audit trigger records updated_by = null on both rows.
insert into public.job_roles (id, name, weight, description, archived_at)
values ('00000000-0000-4000-8000-000000000211', 'pgTAP Archived Role', 1.00, 'pgTAP fixture', now());
update public.bonus_settings set updated_by = null where id;

-- Owner-side total, captured before impersonating; compared against impersonated counts.
do $$
begin
  perform set_config('pgtap.total_job_roles', (select count(*) from public.job_roles)::text, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Employee: sees nothing, writes nothing
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000201"}';

select is_empty($$ select id from public.job_roles $$, 'employee sees 0 job roles');
select is_empty($$ select id from public.bonus_settings $$, 'employee sees 0 bonus_settings rows');
select throws_ok(
  $$ insert into public.job_roles (name, weight) values ('pgTAP Employee Role', 1.00) $$,
  '42501',
  null,
  'employee insert into job_roles is denied'
);
select is_empty(
  $$ update public.job_roles set weight = 2.00 where id = '00000000-0000-4000-8000-000000000211' returning id $$,
  'employee update on job_roles affects 0 rows'
);
select is_empty(
  $$ update public.bonus_settings set multiplier_max = 1.50 where id returning id $$,
  'employee update on bonus_settings affects 0 rows'
);
select is_empty(
  $$ delete from public.job_roles where id = '00000000-0000-4000-8000-000000000211' returning id $$,
  'employee delete on job_roles removes 0 rows'
);
select is_empty(
  $$ delete from public.bonus_settings returning id $$,
  'employee delete on bonus_settings removes 0 rows'
);

-- ---------------------------------------------------------------------------
-- Supervisor: reads everything (archived roles included), writes nothing
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000202"}';

select isnt_empty($$ select id from public.bonus_settings $$, 'supervisor sees the bonus_settings row');
select is(
  (select count(*)::int from public.job_roles),
  current_setting('pgtap.total_job_roles')::int,
  'supervisor sees all job roles'
);
select isnt_empty(
  $$ select id from public.job_roles where id = '00000000-0000-4000-8000-000000000211' and archived_at is not null $$,
  'supervisor sees archived job roles'
);
select throws_ok(
  $$ insert into public.job_roles (name, weight) values ('pgTAP Supervisor Role', 1.00) $$,
  '42501',
  null,
  'supervisor insert into job_roles is denied'
);
select is_empty(
  $$ update public.job_roles set weight = 2.00 where id = '00000000-0000-4000-8000-000000000211' returning id $$,
  'supervisor update on job_roles affects 0 rows'
);
select is_empty(
  $$ update public.bonus_settings set multiplier_max = 1.50 where id returning id $$,
  'supervisor update on bonus_settings affects 0 rows'
);
select is_empty(
  $$ delete from public.job_roles where id = '00000000-0000-4000-8000-000000000211' returning id $$,
  'supervisor delete on job_roles removes 0 rows'
);
select is_empty(
  $$ delete from public.bonus_settings returning id $$,
  'supervisor delete on bonus_settings removes 0 rows'
);

-- ---------------------------------------------------------------------------
-- Admin: reads and writes, audit fields recorded, but still cannot delete
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000203"}';

select lives_ok(
  $$ insert into public.job_roles (id, name, weight, description)
     values ('00000000-0000-4000-8000-000000000212', 'pgTAP Admin Role', 1.00, 'pgTAP fixture') $$,
  'admin can insert a job role'
);
select is(
  (select updated_by from public.job_roles where id = '00000000-0000-4000-8000-000000000212'),
  '00000000-0000-4000-8000-000000000203'::uuid,
  'admin-created job role records the admin in updated_by'
);
select isnt_empty(
  $$ update public.job_roles set weight = 1.20 where id = '00000000-0000-4000-8000-000000000212' returning id $$,
  'admin can update a job role weight'
);
select is(
  (select weight from public.job_roles where id = '00000000-0000-4000-8000-000000000212'),
  1.20::numeric,
  'job role weight was changed by the admin'
);
select isnt_empty(
  $$ update public.job_roles set archived_at = now() where id = '00000000-0000-4000-8000-000000000212' returning id $$,
  'admin can archive a job role'
);
select ok(
  (select archived_at is not null from public.job_roles where id = '00000000-0000-4000-8000-000000000212'),
  'archived job role has archived_at set'
);
select isnt_empty(
  $$ update public.job_roles set description = 'pgTAP fixture, edited' where id = '00000000-0000-4000-8000-000000000211' returning id $$,
  'admin can update an existing job role'
);
select is(
  (select updated_by from public.job_roles where id = '00000000-0000-4000-8000-000000000211'),
  '00000000-0000-4000-8000-000000000203'::uuid,
  'job role update records the admin in updated_by'
);
select isnt_empty(
  $$ update public.bonus_settings set multiplier_max = 1.25 where id returning id $$,
  'admin can update the bonus_settings row'
);
select is(
  (select multiplier_max from public.bonus_settings where id),
  1.25::numeric,
  'bonus_settings value was changed by the admin'
);
select is(
  (select updated_by from public.bonus_settings where id),
  '00000000-0000-4000-8000-000000000203'::uuid,
  'bonus_settings update records the admin in updated_by'
);
select throws_ok(
  $$ insert into public.bonus_settings select * from public.bonus_settings $$,
  '42501',
  null,
  'admin insert into bonus_settings is denied'
);
select is_empty(
  $$ delete from public.job_roles where id = '00000000-0000-4000-8000-000000000212' returning id $$,
  'admin delete on job_roles removes 0 rows'
);
select is_empty(
  $$ delete from public.bonus_settings returning id $$,
  'admin delete on bonus_settings removes 0 rows'
);

-- Constraint violations (as admin, so RLS passes and the CHECK / unique rules decide)
select throws_ok(
  $$ update public.bonus_settings set kpi_weight_risk = 0.14 where id $$,
  '23514',
  null,
  'KPI weights summing to 0.99 are rejected'
);
select throws_ok(
  $$ update public.bonus_settings set multiplier_min = multiplier_max where id $$,
  '23514',
  null,
  'multiplier_min >= multiplier_max is rejected'
);
select throws_ok(
  $$ update public.bonus_settings set rating_factor_3 = 0.85 where id $$,
  '23514',
  null,
  'rating_factor_3 < rating_factor_2 is rejected'
);
select throws_ok(
  $$ insert into public.job_roles (name, weight) values ('pgTAP Zero Weight', 0) $$,
  '23514',
  null,
  'job role weight 0 is rejected'
);
select throws_ok(
  $$ insert into public.job_roles (name, weight) values ('SENIOR', 1.00) $$,
  '23505',
  null,
  'job role name differing only in case is rejected'
);
select throws_ok(
  $$ insert into public.job_roles (name, weight) values ('Senior ', 1.00) $$,
  '23514',
  null,
  'job role name with surrounding whitespace is rejected'
);

-- ---------------------------------------------------------------------------
-- Owner: rows survived every delete attempt; the singleton cannot be duplicated
-- ---------------------------------------------------------------------------
reset role;

select isnt_empty(
  $$ select id from public.job_roles where id = '00000000-0000-4000-8000-000000000211' $$,
  'owner-inserted job role still exists after the delete attempts'
);
select isnt_empty(
  $$ select id from public.job_roles where id = '00000000-0000-4000-8000-000000000212' $$,
  'admin-created job role still exists after the delete attempt'
);
select isnt_empty(
  $$ select id from public.bonus_settings where id $$,
  'bonus_settings row still exists after the delete attempts'
);
select throws_ok(
  $$ insert into public.bonus_settings select * from public.bonus_settings $$,
  '23505',
  null,
  'a second bonus_settings row is rejected'
);

-- ---------------------------------------------------------------------------
-- Anonymous (anon has no privileges on the config tables at all)
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{}';

select throws_ok(
  $$ select count(*) from public.job_roles $$,
  '42501',
  null,
  'anon cannot read job_roles'
);
select throws_ok(
  $$ select count(*) from public.bonus_settings $$,
  '42501',
  null,
  'anon cannot read bonus_settings'
);

reset role;

select * from finish();

rollback;
