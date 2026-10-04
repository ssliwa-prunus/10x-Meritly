-- pgTAP suite for projects and milestones (public.projects, public.milestones,
-- public.money_floor_mul(), public.owns_project(), the guard triggers and
-- public.project_budget_exposure).
--
-- Isolation model: same as profiles_rls.test.sql. Runs against the live local database without
-- a reset, creates its own fixtures in the reserved UUID range 00000000-0000-4000-8000-0000000003xx
-- with emails under @pgtap.test, never asserts absolute row counts (counts are scoped to fixture
-- projects), and rolls everything back at the end. multiplier_min/max are pinned to the defaults
-- (0.70/1.30) inside the transaction; the exposure figures reserve each non-cancelled milestone at
-- its target pool (the hard cap) and must not depend on multiplier_max at all.
--
-- Run with: npx supabase test db

begin;

create extension if not exists pgtap with schema extensions;

select plan(75);

-- ---------------------------------------------------------------------------
-- Fixtures (as the table owner)
--   users:      ...0301 employee   ...0302 supervisor A   ...0303 supervisor B
--               ...0304 admin      ...0305 supervisor C (owns nothing)
--   projects:   ...0311 A's (created by A)   ...0312 B's (owner-inserted)
--               ...0313 A's second (created by A)   ...0314 B's (created by the admin)
--               ...0315 B's closed (owner-inserted)
--   milestones: ...0321/0322/0323 in 0311 (created by A)   ...0324 in 0312 (owner-inserted)
--               ...0325 in 0313 (created by A)
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000301', 'authenticated', 'authenticated', 'projects-employee@pgtap.test', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000302', 'authenticated', 'authenticated', 'projects-supervisor-a@pgtap.test', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000303', 'authenticated', 'authenticated', 'projects-supervisor-b@pgtap.test', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000304', 'authenticated', 'authenticated', 'projects-admin@pgtap.test', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000305', 'authenticated', 'authenticated', 'projects-supervisor-c@pgtap.test', '{}', now(), now());

update public.profiles set role = 'supervisor'
where id in (
  '00000000-0000-4000-8000-000000000302',
  '00000000-0000-4000-8000-000000000303',
  '00000000-0000-4000-8000-000000000305'
);
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-000000000304';

update public.bonus_settings set multiplier_min = 0.70, multiplier_max = 1.30 where id;

-- supervisor_id is explicit: auth.uid() is null without a JWT.
insert into public.projects (id, name, start_date, end_date, status, total_budget, supervisor_id)
values (
  '00000000-0000-4000-8000-000000000312', 'pgTAP Project B', '2026-01-01', '2026-12-31', 'active', 5000.00,
  '00000000-0000-4000-8000-000000000303'
);
insert into public.milestones (id, project_id, name, start_date, end_date, status, target_pool)
values (
  '00000000-0000-4000-8000-000000000324', '00000000-0000-4000-8000-000000000312', 'pgTAP B1',
  '2026-02-01', '2026-03-31', 'active', 1000.00
);
-- B's closed project: probes into it must not reveal its status (guard ownership check).
insert into public.projects (id, name, start_date, end_date, status, total_budget, supervisor_id)
values (
  '00000000-0000-4000-8000-000000000315', 'pgTAP Project B closed', '2026-01-01', '2026-12-31', 'completed', 5000.00,
  '00000000-0000-4000-8000-000000000303'
);

-- ---------------------------------------------------------------------------
-- Structure and the rounding rule
-- ---------------------------------------------------------------------------
select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.projects'::regclass),
  'projects has row level security enabled'
);
select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.milestones'::regclass),
  'milestones has row level security enabled'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_class c, unnest(coalesce(c.reloptions, '{}'::text[])) as opt
    where c.oid = 'public.project_budget_exposure'::regclass
      and lower(opt) in ('security_invoker=true', 'security_invoker=on', 'security_invoker=1')
  ),
  'project_budget_exposure has security_invoker = true'
);
select is(public.money_floor_mul(10.01, 1.30), 13.01::numeric, 'money_floor_mul floors to the grosz (10.01 x 1.30 = 13.01)');
select is(public.money_floor_mul(3000.00, 1.30), 3900.00::numeric, 'money_floor_mul keeps an exact product (3000.00 x 1.30 = 3900.00)');

-- ---------------------------------------------------------------------------
-- Supervisor A: own projects and milestones
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000302"}';

select lives_ok(
  $$ insert into public.projects (id, name, start_date, end_date, status, total_budget)
     values ('00000000-0000-4000-8000-000000000311', 'pgTAP Project A', '2026-01-01', '2026-12-31', 'active', 10000.00) $$,
  'supervisor A can insert a project'
);
select is(
  (select supervisor_id from public.projects where id = '00000000-0000-4000-8000-000000000311'),
  '00000000-0000-4000-8000-000000000302'::uuid,
  'supervisor A selects own project, owned by A via the auth.uid() default'
);
select lives_ok(
  $$ insert into public.projects (id, name, start_date, end_date, status, total_budget)
     values ('00000000-0000-4000-8000-000000000313', 'pgTAP Project A2', '2026-01-01', '2026-06-30', 'active', 5000.00) $$,
  'supervisor A can insert a second project'
);
select isnt_empty(
  $$ update public.projects set notes = 'pgTAP edited' where id = '00000000-0000-4000-8000-000000000311' returning id $$,
  'supervisor A can update own project'
);
select lives_ok(
  $$ insert into public.milestones (id, project_id, name, start_date, end_date, status, target_pool)
     values
       ('00000000-0000-4000-8000-000000000321', '00000000-0000-4000-8000-000000000311', 'pgTAP M1', '2026-01-01', '2026-03-31', 'active', 3000.00),
       ('00000000-0000-4000-8000-000000000322', '00000000-0000-4000-8000-000000000311', 'pgTAP M2', '2026-04-01', '2026-06-30', 'active', 3000.00),
       ('00000000-0000-4000-8000-000000000323', '00000000-0000-4000-8000-000000000311', 'pgTAP M3', '2026-07-01', '2026-09-30', 'cancelled', 2000.00) $$,
  'supervisor A can insert milestones into own project'
);
select is(
  (select count(*)::int from public.milestones where project_id = '00000000-0000-4000-8000-000000000311'),
  3,
  'supervisor A sees own project''s milestones'
);
select is_empty(
  $$ select id from public.milestones where project_id = '00000000-0000-4000-8000-000000000312' $$,
  'supervisor A sees 0 milestones of B''s project'
);
select throws_ok(
  $$ insert into public.milestones (project_id, name, start_date, end_date, target_pool)
     values ('00000000-0000-4000-8000-000000000312', 'pgTAP A in B', '2026-05-01', '2026-05-31', 100.00) $$,
  '42501',
  null,
  'supervisor A inserting a milestone into B''s project is denied'
);
select throws_ok(
  $$ insert into public.milestones (project_id, name, start_date, end_date, target_pool)
     values ('00000000-0000-4000-8000-000000000312', 'pgTAP A in B late', '2027-01-01', '2027-01-31', 100.00) $$,
  '42501',
  null,
  'supervisor A inserting out-of-period dates into B''s project gets 42501, not MR002'
);
select throws_ok(
  $$ insert into public.milestones (project_id, name, start_date, end_date, target_pool)
     values ('00000000-0000-4000-8000-000000000315', 'pgTAP A in B closed', '2026-05-01', '2026-05-31', 100.00) $$,
  '42501',
  null,
  'supervisor A inserting into B''s closed project gets 42501, not MR003'
);
select throws_ok(
  $$ insert into public.projects (name, start_date, end_date, total_budget, supervisor_id)
     values ('pgTAP Project A for B', '2026-01-01', '2026-12-31', 1000.00, '00000000-0000-4000-8000-000000000303') $$,
  '42501',
  null,
  'supervisor A inserting a project owned by B is denied'
);
select throws_ok(
  $$ update public.projects set supervisor_id = '00000000-0000-4000-8000-000000000303'
     where id = '00000000-0000-4000-8000-000000000311' $$,
  '42501',
  null,
  'supervisor A handing own project to B is denied (with check)'
);
select throws_ok(
  $$ update public.milestones set project_id = '00000000-0000-4000-8000-000000000313'
     where id = '00000000-0000-4000-8000-000000000321' $$,
  'MR006',
  null,
  'moving a milestone to another project raises MR006'
);
select throws_ok(
  $$ truncate public.milestones $$,
  '42501',
  null,
  'authenticated cannot truncate milestones'
);
select is_empty(
  $$ delete from public.milestones where id = '00000000-0000-4000-8000-000000000321' returning id $$,
  'supervisor A deleting own milestone removes 0 rows'
);
select is_empty(
  $$ delete from public.projects where id = '00000000-0000-4000-8000-000000000313' returning id $$,
  'supervisor A deleting own project removes 0 rows'
);

-- Value rules (as A, so RLS passes and the CHECK / unique rules decide)
select throws_ok(
  $$ insert into public.projects (name, start_date, end_date, total_budget)
     values ('pgTAP Zero Budget', '2026-01-01', '2026-12-31', 0) $$,
  '23514',
  null,
  'project total_budget 0 is rejected'
);
select throws_ok(
  $$ insert into public.milestones (project_id, name, start_date, end_date, target_pool)
     values ('00000000-0000-4000-8000-000000000311', 'pgTAP Zero Pool', '2026-05-01', '2026-05-31', 0) $$,
  '23514',
  null,
  'milestone target_pool 0 is rejected'
);
select throws_ok(
  $$ insert into public.projects (name, start_date, end_date, total_budget)
     values ('pgTAP Backwards', '2026-12-31', '2026-01-01', 1000.00) $$,
  '23514',
  null,
  'project end_date before start_date is rejected'
);
select throws_ok(
  $$ insert into public.projects (name, start_date, end_date, status, total_budget)
     values ('pgTAP Bad Status', '2026-01-01', '2026-12-31', 'archived', 1000.00) $$,
  '23514',
  null,
  'project with an invalid status is rejected'
);
select throws_ok(
  $$ insert into public.projects (name, start_date, end_date, total_budget)
     values (repeat('x', 101), '2026-01-01', '2026-12-31', 1000.00) $$,
  '23514',
  null,
  'project name longer than 100 characters is rejected'
);
select throws_ok(
  $$ insert into public.projects (name, start_date, end_date, total_budget)
     values ('PGTAP PROJECT A', '2026-01-01', '2026-12-31', 1000.00) $$,
  '23505',
  null,
  'project name differing only in case is rejected'
);
select throws_ok(
  $$ insert into public.milestones (project_id, name, start_date, end_date, target_pool)
     values ('00000000-0000-4000-8000-000000000311', 'PGTAP M1', '2026-05-01', '2026-05-31', 100.00) $$,
  '23505',
  null,
  'duplicate milestone name in the same project is rejected'
);
select lives_ok(
  $$ insert into public.milestones (id, project_id, name, start_date, end_date, status, target_pool)
     values ('00000000-0000-4000-8000-000000000325', '00000000-0000-4000-8000-000000000313', 'pgTAP M1', '2026-01-01', '2026-02-28', 'active', 500.00) $$,
  'the same milestone name in another project is accepted'
);

-- Periods and the closed-project lock
select throws_ok(
  $$ insert into public.milestones (project_id, name, start_date, end_date, target_pool)
     values ('00000000-0000-4000-8000-000000000311', 'pgTAP Outside', '2026-12-01', '2027-01-31', 100.00) $$,
  'MR002',
  null,
  'milestone ending after the project end raises MR002'
);
select throws_ok(
  $$ update public.projects set end_date = '2026-08-31' where id = '00000000-0000-4000-8000-000000000311' $$,
  'MR004',
  null,
  'shrinking the project period past a (cancelled) milestone raises MR004'
);
select isnt_empty(
  $$ update public.projects set status = 'completed' where id = '00000000-0000-4000-8000-000000000311' returning id $$,
  'supervisor A can complete own project'
);
select throws_ok(
  $$ insert into public.milestones (project_id, name, start_date, end_date, target_pool)
     values ('00000000-0000-4000-8000-000000000311', 'pgTAP Late', '2026-10-01', '2026-10-31', 100.00) $$,
  'MR003',
  null,
  'milestone insert into a completed project raises MR003'
);
select throws_ok(
  $$ update public.milestones set notes = 'pgTAP locked' where id = '00000000-0000-4000-8000-000000000321' $$,
  'MR003',
  null,
  'milestone update in a completed project raises MR003'
);
select isnt_empty(
  $$ update public.projects set status = 'active' where id = '00000000-0000-4000-8000-000000000311' returning id $$,
  'supervisor A can reopen own project'
);
select isnt_empty(
  $$ update public.milestones set notes = 'pgTAP reopened' where id = '00000000-0000-4000-8000-000000000321' returning id $$,
  'milestone update is allowed again after reopening the project'
);

-- Exposure: 10000.00 budget, 3000.00 + 3000.00 active, 2000.00 cancelled; each non-cancelled
-- milestone reserves its target pool
select results_eq(
  $$ select reserved_total, remaining, over_budget
     from public.project_budget_exposure
     where project_id = '00000000-0000-4000-8000-000000000311' $$,
  $$ values (6000.00::numeric, 4000.00::numeric, false) $$,
  'exposure excludes the cancelled milestone (6000.00 reserved, 4000.00 remaining)'
);

update public.milestones set status = 'active' where id = '00000000-0000-4000-8000-000000000323';

select results_eq(
  $$ select reserved_total, remaining, over_budget
     from public.project_budget_exposure
     where project_id = '00000000-0000-4000-8000-000000000311' $$,
  $$ values (8000.00::numeric, 2000.00::numeric, false) $$,
  'un-cancelling the milestone gives 8000.00 reserved (the sum of the target pools)'
);

update public.projects set total_budget = 8000.00 where id = '00000000-0000-4000-8000-000000000311';

select is(
  (select over_budget from public.project_budget_exposure where project_id = '00000000-0000-4000-8000-000000000311'),
  false,
  'reserved_total equal to the budget is not over budget'
);

update public.projects set total_budget = 7999.99 where id = '00000000-0000-4000-8000-000000000311';

select is(
  (select over_budget from public.project_budget_exposure where project_id = '00000000-0000-4000-8000-000000000311'),
  true,
  'reserved_total 0.01 over the budget is over budget'
);

-- multiplier_max does not affect the reservation (changed as the owner, inside this transaction)
reset role;
update public.bonus_settings set multiplier_max = 1.50 where id;
set local role authenticated;

select is(
  (select reserved_total from public.project_budget_exposure where project_id = '00000000-0000-4000-8000-000000000311'),
  8000.00::numeric,
  'a multiplier_max change does not change the reservation (still 8000.00 of target pools)'
);

reset role;
update public.bonus_settings set multiplier_max = 1.30 where id;
set local role authenticated;

-- ---------------------------------------------------------------------------
-- Supervisor B: cannot see or touch A's project
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000303"}';

select is_empty(
  $$ select id from public.projects where id = '00000000-0000-4000-8000-000000000311' $$,
  'supervisor B sees 0 rows of A''s project'
);
select is_empty(
  $$ update public.projects set notes = 'pgTAP B was here' where id = '00000000-0000-4000-8000-000000000311' returning id $$,
  'supervisor B updating A''s project affects 0 rows'
);
select is_empty(
  $$ select project_id from public.project_budget_exposure where project_id = '00000000-0000-4000-8000-000000000311' $$,
  'supervisor B gets no exposure row for A''s project'
);

-- ---------------------------------------------------------------------------
-- Employee: sees nothing
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000301"}';

select is_empty($$ select id from public.projects $$, 'employee sees 0 projects');
select is_empty($$ select id from public.milestones $$, 'employee sees 0 milestones');
select is_empty($$ select project_id from public.project_budget_exposure $$, 'employee sees 0 exposure rows');
select throws_ok(
  $$ insert into public.milestones (project_id, name, start_date, end_date, target_pool)
     values ('00000000-0000-4000-8000-000000000315', 'pgTAP employee probe', '2027-01-01', '2027-01-31', 100.00) $$,
  '42501',
  null,
  'employee inserting a milestone gets 42501, not a guard code'
);

-- ---------------------------------------------------------------------------
-- Admin: reads everything, writes projects, never writes milestones
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000304"}';

select is(
  (
    select count(*)::int
    from public.milestones
    where project_id in ('00000000-0000-4000-8000-000000000311', '00000000-0000-4000-8000-000000000312')
  ),
  4,
  'admin selects milestones of any project'
);
select throws_ok(
  $$ insert into public.milestones (project_id, name, start_date, end_date, target_pool)
     values ('00000000-0000-4000-8000-000000000312', 'pgTAP Admin Milestone', '2026-05-01', '2026-05-31', 100.00) $$,
  '42501',
  null,
  'admin milestone insert is denied'
);
select is_empty(
  $$ update public.milestones set notes = 'pgTAP admin' where id = '00000000-0000-4000-8000-000000000324' returning id $$,
  'admin milestone update affects 0 rows'
);
select is_empty(
  $$ delete from public.projects where id = '00000000-0000-4000-8000-000000000312' returning id $$,
  'admin deleting a project removes 0 rows'
);
select lives_ok(
  $$ insert into public.projects (id, name, start_date, end_date, status, total_budget, supervisor_id)
     values ('00000000-0000-4000-8000-000000000314', 'pgTAP Project Admin for B', '2026-01-01', '2026-12-31', 'planned', 3000.00,
             '00000000-0000-4000-8000-000000000303') $$,
  'admin can create a project for supervisor B'
);
select is(
  (select updated_by from public.projects where id = '00000000-0000-4000-8000-000000000314'),
  '00000000-0000-4000-8000-000000000304'::uuid,
  'admin-created project records the admin in updated_by'
);
select results_eq(
  $$ select reserved_total, remaining, over_budget
     from public.project_budget_exposure
     where project_id = '00000000-0000-4000-8000-000000000314' $$,
  $$ values (0::numeric, 3000.00::numeric, false) $$,
  'a project with no milestones reserves 0'
);
select throws_ok(
  $$ update public.projects set supervisor_id = '00000000-0000-4000-8000-000000000301'
     where id = '00000000-0000-4000-8000-000000000311' $$,
  'MR001',
  null,
  'admin assigning a project to an employee raises MR001'
);
select throws_ok(
  $$ insert into public.projects (name, start_date, end_date, total_budget, supervisor_id)
     values ('pgTAP Project for Employee', '2026-01-01', '2026-12-31', 1000.00, '00000000-0000-4000-8000-000000000301') $$,
  'MR001',
  null,
  'admin creating a project owned by an employee raises MR001'
);

-- Role block while A still owns projects
select throws_ok(
  $$ update public.profiles set role = 'employee' where id = '00000000-0000-4000-8000-000000000302' $$,
  'MR005',
  null,
  'changing the role of a supervisor who owns projects raises MR005'
);
select is(
  (select role from public.profiles where id = '00000000-0000-4000-8000-000000000302'),
  'supervisor'::public.app_role,
  'supervisor A is still a supervisor after the blocked change'
);
select isnt_empty(
  $$ update public.profiles set display_name = 'pgTAP Supervisor A' where id = '00000000-0000-4000-8000-000000000302' returning id $$,
  'updating the display_name of a supervisor who owns projects succeeds'
);
select isnt_empty(
  $$ update public.profiles set role = 'supervisor' where id = '00000000-0000-4000-8000-000000000302' returning id $$,
  'setting an owning supervisor''s role to its current value is not blocked'
);

-- Reassign A's projects to B
select isnt_empty(
  $$ update public.projects set supervisor_id = '00000000-0000-4000-8000-000000000303'
     where id in ('00000000-0000-4000-8000-000000000311', '00000000-0000-4000-8000-000000000313')
     returning id $$,
  'admin can reassign A''s projects to B'
);

-- ---------------------------------------------------------------------------
-- After the reassignment: A loses access, B gains it
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000302"}';

select is_empty(
  $$ select id from public.projects where id = '00000000-0000-4000-8000-000000000311' $$,
  'supervisor A sees 0 rows of the reassigned project'
);
select is_empty(
  $$ select id from public.milestones where project_id = '00000000-0000-4000-8000-000000000311' $$,
  'supervisor A sees 0 milestones of the reassigned project'
);
select is_empty(
  $$ update public.milestones set notes = 'pgTAP A after' where id = '00000000-0000-4000-8000-000000000321' returning id $$,
  'supervisor A updating a milestone of the reassigned project affects 0 rows'
);

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000303"}';

select isnt_empty(
  $$ select id from public.projects where id = '00000000-0000-4000-8000-000000000314' $$,
  'supervisor B sees the project the admin created for B'
);
select isnt_empty(
  $$ select id from public.projects where id = '00000000-0000-4000-8000-000000000311' $$,
  'supervisor B sees the reassigned project'
);
select is(
  (select count(*)::int from public.milestones where project_id = '00000000-0000-4000-8000-000000000311'),
  3,
  'supervisor B sees the reassigned project''s milestones'
);
select isnt_empty(
  $$ select project_id from public.project_budget_exposure where project_id = '00000000-0000-4000-8000-000000000311' $$,
  'supervisor B sees the reassigned project''s exposure row'
);

-- ---------------------------------------------------------------------------
-- Role block lifted once A owns nothing; C (owns nothing) was never blocked
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000304"}';

select isnt_empty(
  $$ update public.profiles set role = 'employee' where id = '00000000-0000-4000-8000-000000000302' returning id $$,
  'changing A''s role succeeds after the reassignment'
);
select isnt_empty(
  $$ update public.profiles set role = 'employee' where id = '00000000-0000-4000-8000-000000000305' returning id $$,
  'changing the role of a supervisor who owns nothing succeeds'
);

-- ---------------------------------------------------------------------------
-- Owner: nothing was deleted
-- ---------------------------------------------------------------------------
reset role;

select is(
  (
    select count(*)::int
    from public.projects
    where id in (
      '00000000-0000-4000-8000-000000000311',
      '00000000-0000-4000-8000-000000000312',
      '00000000-0000-4000-8000-000000000313',
      '00000000-0000-4000-8000-000000000314'
    )
  ),
  4,
  'all fixture projects still exist'
);

-- ---------------------------------------------------------------------------
-- Anonymous (anon has no privileges on the tables or the view at all)
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{}';

select throws_ok(
  $$ select count(*) from public.projects $$,
  '42501',
  null,
  'anon cannot read projects'
);
select throws_ok(
  $$ select count(*) from public.milestones $$,
  '42501',
  null,
  'anon cannot read milestones'
);
select throws_ok(
  $$ select count(*) from public.project_budget_exposure $$,
  '42501',
  null,
  'anon cannot read project_budget_exposure'
);

reset role;

select * from finish();

rollback;
