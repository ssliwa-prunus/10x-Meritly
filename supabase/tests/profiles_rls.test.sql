-- pgTAP suite for the role and RLS scaffold (public.profiles, role helpers, signup trigger).
--
-- Isolation model: runs against the live local database without a reset. It tolerates the
-- seed users and any other pre-existing rows (e.g. smoke-test signups), creates its own
-- fixtures in the reserved UUID range 00000000-0000-4000-8000-0000000001xx with emails under
-- @pgtap.test (disjoint from the seed range ...0000000000xx), never asserts absolute row
-- counts, and rolls everything back at the end.
--
-- Run with: npx supabase test db

begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

-- ---------------------------------------------------------------------------
-- Fixtures (as the table owner). Inserting into auth.users exercises the trigger.
--   ...0101 employee   ...0102 supervisor   ...0103 admin   ...0104 target employee
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'employee@pgtap.test', '{"display_name":"pgTAP Employee"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'supervisor@pgtap.test', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000103', 'authenticated', 'authenticated', 'admin@pgtap.test', '{"role":"admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000104', 'authenticated', 'authenticated', 'target@pgtap.test', '{}', now(), now());

-- Trigger behaviour
select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-4000-8000-000000000101'),
  1,
  'trigger creates exactly one profile for a new auth user'
);
select is(
  (select role from public.profiles where id = '00000000-0000-4000-8000-000000000101'),
  'employee'::public.app_role,
  'trigger-created profile has role employee'
);
select is(
  (select display_name from public.profiles where id = '00000000-0000-4000-8000-000000000101'),
  'pgTAP Employee',
  'trigger copies display_name from raw_user_meta_data'
);
select is(
  (select role from public.profiles where id = '00000000-0000-4000-8000-000000000103'),
  'employee'::public.app_role,
  'trigger ignores a role supplied in user metadata'
);

update public.profiles set role = 'supervisor' where id = '00000000-0000-4000-8000-000000000102';
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-000000000103';

-- Owner-side total, captured before impersonating; compared against impersonated counts.
do $$
begin
  perform set_config('pgtap.total_profiles', (select count(*) from public.profiles)::text, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Employee
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000101"}';

select is((select count(*)::int from public.profiles), 1, 'employee sees exactly one profile');
select is(
  (select id from public.profiles),
  '00000000-0000-4000-8000-000000000101'::uuid,
  'employee''s only visible profile is their own'
);
select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-4000-8000-000000000104'),
  0,
  'employee sees 0 rows when selecting another user''s id'
);
select is(public.current_app_role(), 'employee'::public.app_role, 'current_app_role() is employee for the employee');
select is(public.is_admin(), false, 'is_admin() is false for the employee');
select is_empty(
  $$ update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-000000000101' returning id $$,
  'employee updating own role to admin affects 0 rows'
);
select is(
  (select role from public.profiles where id = '00000000-0000-4000-8000-000000000101'),
  'employee'::public.app_role,
  'employee role is unchanged after the escalation attempt'
);
select throws_ok(
  $$ insert into public.profiles (id, email) values ('00000000-0000-4000-8000-000000000199', 'x@pgtap.test') $$,
  '42501',
  null,
  'insert into profiles as authenticated is denied'
);
select is_empty(
  $$ delete from public.profiles where id = '00000000-0000-4000-8000-000000000101' returning id $$,
  'employee deleting own profile removes 0 rows'
);

-- ---------------------------------------------------------------------------
-- Supervisor
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000102"}';

select is(
  (select count(*)::int from public.profiles),
  current_setting('pgtap.total_profiles')::int,
  'supervisor sees all profiles'
);
select is(public.current_app_role(), 'supervisor'::public.app_role, 'current_app_role() is supervisor for the supervisor');
select is(public.is_supervisor(), true, 'is_supervisor() is true for the supervisor');
select is_empty(
  $$ update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-000000000104' returning id $$,
  'supervisor updating another user''s role affects 0 rows'
);
select is_empty(
  $$ update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-000000000102' returning id $$,
  'supervisor updating own role affects 0 rows'
);
select is(
  (select role from public.profiles where id = '00000000-0000-4000-8000-000000000104'),
  'employee'::public.app_role,
  'target role is unchanged after the supervisor attempt'
);

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000103"}';

select is(
  (select count(*)::int from public.profiles),
  current_setting('pgtap.total_profiles')::int,
  'admin sees all profiles'
);
select is(public.current_app_role(), 'admin'::public.app_role, 'current_app_role() is admin for the admin');
select is(public.is_admin(), true, 'is_admin() is true for the admin');
select isnt_empty(
  $$ update public.profiles set role = 'supervisor' where id = '00000000-0000-4000-8000-000000000104' returning id $$,
  'admin can update another user''s role'
);
select is(
  (select role from public.profiles where id = '00000000-0000-4000-8000-000000000104'),
  'supervisor'::public.app_role,
  'target role was changed by the admin'
);
select is_empty(
  $$ delete from public.profiles where id = '00000000-0000-4000-8000-000000000104' returning id $$,
  'admin deleting a profile removes 0 rows'
);

-- Authenticated user without a profile
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000198"}';
select is(public.current_app_role(), null::public.app_role, 'current_app_role() is NULL for a user without a profile');

-- ---------------------------------------------------------------------------
-- Anonymous (anon has no privileges on profiles or the helpers at all)
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
set local request.jwt.claims = '{}';

select throws_ok(
  $$ select count(*) from public.profiles $$,
  '42501',
  null,
  'anon cannot read profiles (0 rows visible)'
);
select throws_ok(
  $$ select public.is_admin() $$,
  '42501',
  null,
  'anon cannot execute role helpers'
);

-- ---------------------------------------------------------------------------
-- Structural guards for future slices
-- ---------------------------------------------------------------------------
reset role;

select is_empty(
  $$
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
  $$,
  'every table in schema public has row level security enabled'
);
select is_empty(
  $$
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'v'
      and not exists (
        select 1
        from unnest(coalesce(c.reloptions, '{}'::text[])) as opt
        where lower(opt) in ('security_invoker=true', 'security_invoker=on', 'security_invoker=1')
      )
  $$,
  'every view in schema public has security_invoker = true'
);

select * from finish();

rollback;
