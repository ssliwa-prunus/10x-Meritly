-- pgTAP suite for employees and milestone engagements (public.employees,
-- public.milestone_engagements, public.owns_milestone(), public.employee_engaged_on_own_milestone(),
-- the guard triggers, the extended MR005 guard, the activation trigger on auth.users and
-- public.employee_time_share_totals).
--
-- Isolation model: same as profiles_rls.test.sql. Runs against the live local database without
-- a reset, creates its own fixtures in the reserved UUID range 00000000-0000-4000-8000-0000000004xx
-- with emails under @pgtap.test, never asserts absolute row counts (counts are scoped to fixture
-- rows), and rolls everything back at the end. It uses its own job roles, so local edits to the
-- seeded ones do not matter.
--
-- Run with: npx supabase test db

begin;

create extension if not exists pgtap with schema extensions;

select plan(75);

-- ---------------------------------------------------------------------------
-- Fixtures (as the table owner; auth.uid() is null, so supervisor_id is explicit)
--   users:       ...0401 employee   ...0402 supervisor A   ...0403 supervisor B
--                ...0404 admin      ...0405 supervisor C (owns one employee, no projects)
--                ...0406 invited employee account (email not confirmed yet)
--   job roles:   ...0408 active     ...0409 archived
--   projects:    ...0411 A's   ...0412 B's   ...0413 A's (cancelled below)   ...0414 A's (closed history only)
--   milestones:  ...0421 (0411, active)   ...0422 (0411, planned)   ...0423 (0411, completed below)
--                ...0424 (0412, active)   ...0425 (0413, active; its project is cancelled below)
--                ...0426 (0414, completed below)
--   employees:   ...0431 EA1 (A)   ...0432 EA2 (A; closed-milestone history only)
--                ...0433 EA3 (A; open engagement)   ...0434 EB1 (B)   ...0435 EC1 (C)
--                ...0436 EX (B, moved to A below)   ...0437 EI (A; invited, linked to ...0406)
--   engagements: ...0441 EA1@0421 0.60   ...0442 EA1@0422 0.50   ...0443 EA1@0423 0.30
--                ...0444 EA2@0423 0.20   ...0445 EA3@0421 0.40   ...0446 EA3@0425 0.10
--                ...0447 EX@0424 0.50 (B's milestone)   ...0448 EX@0421 0.50 (A's milestone)
--                ...0449 EA2@0426 0.20
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000401', 'authenticated', 'authenticated', 'employees-employee@pgtap.test', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000402', 'authenticated', 'authenticated', 'employees-supervisor-a@pgtap.test', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000403', 'authenticated', 'authenticated', 'employees-supervisor-b@pgtap.test', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000404', 'authenticated', 'authenticated', 'employees-admin@pgtap.test', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000405', 'authenticated', 'authenticated', 'employees-supervisor-c@pgtap.test', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000406', 'authenticated', 'authenticated', 'employees-ei@pgtap.test', '{}', now(), now());

update public.profiles set role = 'supervisor'
where id in (
  '00000000-0000-4000-8000-000000000402',
  '00000000-0000-4000-8000-000000000403',
  '00000000-0000-4000-8000-000000000405'
);
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-000000000404';

insert into public.job_roles (id, name, weight, archived_at)
values
  ('00000000-0000-4000-8000-000000000408', 'pgTAP Employees Active Role', 1.00, null),
  ('00000000-0000-4000-8000-000000000409', 'pgTAP Employees Archived Role', 1.00, now());

insert into public.projects (id, name, start_date, end_date, status, total_budget, supervisor_id)
values
  ('00000000-0000-4000-8000-000000000411', 'pgTAP Employees Project A', '2026-01-01', '2026-12-31', 'active', 10000.00, '00000000-0000-4000-8000-000000000402'),
  ('00000000-0000-4000-8000-000000000412', 'pgTAP Employees Project B', '2026-01-01', '2026-12-31', 'active', 10000.00, '00000000-0000-4000-8000-000000000403'),
  ('00000000-0000-4000-8000-000000000413', 'pgTAP Employees Project A2', '2026-01-01', '2026-12-31', 'active', 10000.00, '00000000-0000-4000-8000-000000000402'),
  ('00000000-0000-4000-8000-000000000414', 'pgTAP Employees Project A3', '2026-01-01', '2026-12-31', 'active', 10000.00, '00000000-0000-4000-8000-000000000402');

insert into public.milestones (id, project_id, name, start_date, end_date, status, target_pool)
values
  ('00000000-0000-4000-8000-000000000421', '00000000-0000-4000-8000-000000000411', 'pgTAP E M1', '2026-01-01', '2026-03-31', 'active', 1000.00),
  ('00000000-0000-4000-8000-000000000422', '00000000-0000-4000-8000-000000000411', 'pgTAP E M2', '2026-04-01', '2026-06-30', 'planned', 1000.00),
  ('00000000-0000-4000-8000-000000000423', '00000000-0000-4000-8000-000000000411', 'pgTAP E M3', '2026-07-01', '2026-09-30', 'active', 1000.00),
  ('00000000-0000-4000-8000-000000000424', '00000000-0000-4000-8000-000000000412', 'pgTAP E B1', '2026-01-01', '2026-03-31', 'active', 1000.00),
  ('00000000-0000-4000-8000-000000000425', '00000000-0000-4000-8000-000000000413', 'pgTAP E A2 M1', '2026-01-01', '2026-03-31', 'active', 1000.00),
  ('00000000-0000-4000-8000-000000000426', '00000000-0000-4000-8000-000000000414', 'pgTAP E A3 M1', '2026-01-01', '2026-03-31', 'active', 1000.00);

insert into public.employees (id, supervisor_id, full_name, email, job_role_id)
values
  ('00000000-0000-4000-8000-000000000431', '00000000-0000-4000-8000-000000000402', 'pgTAP EA1', 'employees-ea1@pgtap.test', '00000000-0000-4000-8000-000000000408'),
  ('00000000-0000-4000-8000-000000000432', '00000000-0000-4000-8000-000000000402', 'pgTAP EA2', 'employees-ea2@pgtap.test', '00000000-0000-4000-8000-000000000408'),
  ('00000000-0000-4000-8000-000000000433', '00000000-0000-4000-8000-000000000402', 'pgTAP EA3', 'employees-ea3@pgtap.test', '00000000-0000-4000-8000-000000000408'),
  ('00000000-0000-4000-8000-000000000434', '00000000-0000-4000-8000-000000000403', 'pgTAP EB1', 'employees-eb1@pgtap.test', '00000000-0000-4000-8000-000000000408'),
  ('00000000-0000-4000-8000-000000000435', '00000000-0000-4000-8000-000000000405', 'pgTAP EC1', 'employees-ec1@pgtap.test', '00000000-0000-4000-8000-000000000408'),
  ('00000000-0000-4000-8000-000000000436', '00000000-0000-4000-8000-000000000403', 'pgTAP EX', 'employees-ex@pgtap.test', '00000000-0000-4000-8000-000000000408');

-- EI: invited and linked to ...0406 (as the invite Edge Function would do), not yet activated.
insert into public.employees (id, supervisor_id, full_name, email, job_role_id, profile_id, invited_at)
values (
  '00000000-0000-4000-8000-000000000437', '00000000-0000-4000-8000-000000000402', 'pgTAP EI',
  'employees-ei@pgtap.test', '00000000-0000-4000-8000-000000000408',
  '00000000-0000-4000-8000-000000000406', now()
);

insert into public.milestone_engagements (id, milestone_id, employee_id, time_share, rating)
values
  ('00000000-0000-4000-8000-000000000441', '00000000-0000-4000-8000-000000000421', '00000000-0000-4000-8000-000000000431', 0.60, 4),
  ('00000000-0000-4000-8000-000000000442', '00000000-0000-4000-8000-000000000422', '00000000-0000-4000-8000-000000000431', 0.50, 3),
  ('00000000-0000-4000-8000-000000000443', '00000000-0000-4000-8000-000000000423', '00000000-0000-4000-8000-000000000431', 0.30, 3),
  ('00000000-0000-4000-8000-000000000444', '00000000-0000-4000-8000-000000000423', '00000000-0000-4000-8000-000000000432', 0.20, 3),
  ('00000000-0000-4000-8000-000000000445', '00000000-0000-4000-8000-000000000421', '00000000-0000-4000-8000-000000000433', 0.40, 3),
  ('00000000-0000-4000-8000-000000000446', '00000000-0000-4000-8000-000000000425', '00000000-0000-4000-8000-000000000433', 0.10, 3),
  ('00000000-0000-4000-8000-000000000447', '00000000-0000-4000-8000-000000000424', '00000000-0000-4000-8000-000000000436', 0.50, 3),
  ('00000000-0000-4000-8000-000000000449', '00000000-0000-4000-8000-000000000426', '00000000-0000-4000-8000-000000000432', 0.20, 3);

-- EX gets engagements on both A's and B's open milestones: B's milestone is closed while EX
-- moves from B to A (closed history does not block the move), then reopened.
update public.milestones set status = 'completed' where id = '00000000-0000-4000-8000-000000000424';
update public.employees set supervisor_id = '00000000-0000-4000-8000-000000000402'
where id = '00000000-0000-4000-8000-000000000436';
update public.milestones set status = 'active' where id = '00000000-0000-4000-8000-000000000424';

insert into public.milestone_engagements (id, milestone_id, employee_id, time_share, rating)
values ('00000000-0000-4000-8000-000000000448', '00000000-0000-4000-8000-000000000421', '00000000-0000-4000-8000-000000000436', 0.50, 3);

-- Close the parents last, after their engagements exist.
update public.milestones set status = 'completed'
where id in ('00000000-0000-4000-8000-000000000423', '00000000-0000-4000-8000-000000000426');
update public.projects set status = 'cancelled' where id = '00000000-0000-4000-8000-000000000413';

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------
select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.employees'::regclass),
  'employees has row level security enabled'
);
select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.milestone_engagements'::regclass),
  'milestone_engagements has row level security enabled'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_class c, unnest(coalesce(c.reloptions, '{}'::text[])) as opt
    where c.oid = 'public.employee_time_share_totals'::regclass
      and lower(opt) in ('security_invoker=true', 'security_invoker=on', 'security_invoker=1')
  ),
  'employee_time_share_totals has security_invoker = true'
);
select ok(
  not has_column_privilege('authenticated', 'public.employees', 'profile_id', 'UPDATE'),
  'authenticated cannot update employees.profile_id'
);
select ok(
  not has_column_privilege('authenticated', 'public.employees', 'invited_at', 'UPDATE'),
  'authenticated cannot update employees.invited_at'
);
select ok(
  not has_column_privilege('authenticated', 'public.employees', 'activated_at', 'UPDATE'),
  'authenticated cannot update employees.activated_at'
);
select ok(
  not has_column_privilege('authenticated', 'public.milestone_engagements', 'milestone_id', 'UPDATE'),
  'authenticated cannot update milestone_engagements.milestone_id'
);
select ok(
  not has_column_privilege('authenticated', 'public.milestone_engagements', 'employee_id', 'UPDATE'),
  'authenticated cannot update milestone_engagements.employee_id'
);

-- ---------------------------------------------------------------------------
-- Supervisor A: own employees
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000402"}';

select lives_ok(
  $$ insert into public.employees (full_name, email, job_role_id)
     values ('pgTAP New Employee', 'employees-new@pgtap.test', '00000000-0000-4000-8000-000000000408') $$,
  'supervisor A can register an employee'
);
select is(
  (select supervisor_id from public.employees where email = 'employees-new@pgtap.test'),
  '00000000-0000-4000-8000-000000000402'::uuid,
  'supervisor A selects the new employee, owned by A via the auth.uid() default'
);
select isnt_empty(
  $$ select id from public.employees where id = '00000000-0000-4000-8000-000000000431' $$,
  'supervisor A sees own employee'
);
select is_empty(
  $$ select id from public.employees where id = '00000000-0000-4000-8000-000000000434' $$,
  'supervisor A sees 0 rows of B''s unengaged employee'
);
select isnt_empty(
  $$ update public.employees set full_name = 'pgTAP EA1 edited' where id = '00000000-0000-4000-8000-000000000431' returning id $$,
  'supervisor A can update own employee'
);
select isnt_empty(
  $$ update public.employees set email = 'employees-ea1b@pgtap.test' where id = '00000000-0000-4000-8000-000000000431' returning id $$,
  'supervisor A can change the email of a not-yet-invited employee'
);
select throws_ok(
  $$ insert into public.employees (full_name, email, job_role_id, supervisor_id)
     values ('pgTAP A for B', 'employees-a-for-b@pgtap.test', '00000000-0000-4000-8000-000000000408',
             '00000000-0000-4000-8000-000000000403') $$,
  '42501',
  null,
  'supervisor A registering an employee owned by B is denied'
);
select throws_ok(
  $$ update public.employees set supervisor_id = '00000000-0000-4000-8000-000000000403'
     where id = '00000000-0000-4000-8000-000000000431' $$,
  '42501',
  null,
  'supervisor A handing own employee to B is denied'
);
select throws_ok(
  $$ insert into public.employees (full_name, email, job_role_id)
     values ('pgTAP Duplicate', 'employees-eb1@pgtap.test', '00000000-0000-4000-8000-000000000408') $$,
  '23505',
  null,
  'an email already registered (by another supervisor) is rejected'
);
select throws_ok(
  $$ insert into public.employees (full_name, email, job_role_id)
     values ('pgTAP Upper', 'Employees-Upper@pgtap.test', '00000000-0000-4000-8000-000000000408') $$,
  '23514',
  null,
  'an email that is not lowercase is rejected'
);
select throws_ok(
  $$ insert into public.employees (full_name, email, job_role_id)
     values ('pgTAP Archived', 'employees-archived@pgtap.test', '00000000-0000-4000-8000-000000000409') $$,
  'MR010',
  null,
  'registering an employee with an archived job role raises MR010'
);
select throws_ok(
  $$ update public.employees set job_role_id = '00000000-0000-4000-8000-000000000409'
     where id = '00000000-0000-4000-8000-000000000431' $$,
  'MR010',
  null,
  'changing an employee to an archived job role raises MR010'
);
select throws_ok(
  $$ update public.employees set email = 'employees-ei-new@pgtap.test'
     where id = '00000000-0000-4000-8000-000000000437' $$,
  'MR009',
  null,
  'changing the email of an invited employee raises MR009'
);

-- ---------------------------------------------------------------------------
-- Supervisor A: engagements
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.milestone_engagements (milestone_id, employee_id, time_share, rating)
     select '00000000-0000-4000-8000-000000000421', e.id, 0.25, 3
     from public.employees e where e.email = 'employees-new@pgtap.test' $$,
  'supervisor A can assign own employee to an open milestone of A'
);
select isnt_empty(
  $$ update public.milestone_engagements set time_share = 0.30, rating = 5
     where milestone_id = '00000000-0000-4000-8000-000000000421'
       and employee_id = (select id from public.employees where email = 'employees-new@pgtap.test')
     returning id $$,
  'supervisor A can update own engagement'
);
select throws_ok(
  $$ insert into public.milestone_engagements (milestone_id, employee_id, time_share, rating)
     values ('00000000-0000-4000-8000-000000000421', '00000000-0000-4000-8000-000000000431', 0.10, 3) $$,
  '23505',
  null,
  'a second engagement for the same (milestone, employee) is rejected'
);
select throws_ok(
  $$ insert into public.milestone_engagements (milestone_id, employee_id, time_share, rating)
     select '00000000-0000-4000-8000-000000000422', e.id, 0, 3
     from public.employees e where e.email = 'employees-new@pgtap.test' $$,
  '23514',
  null,
  'time_share 0 is rejected'
);
select throws_ok(
  $$ insert into public.milestone_engagements (milestone_id, employee_id, time_share, rating)
     select '00000000-0000-4000-8000-000000000422', e.id, 1.01, 3
     from public.employees e where e.email = 'employees-new@pgtap.test' $$,
  '23514',
  null,
  'time_share 1.01 is rejected'
);
select throws_ok(
  $$ insert into public.milestone_engagements (milestone_id, employee_id, time_share, rating)
     select '00000000-0000-4000-8000-000000000422', e.id, 0.50, 0
     from public.employees e where e.email = 'employees-new@pgtap.test' $$,
  '23514',
  null,
  'rating 0 is rejected'
);
select throws_ok(
  $$ insert into public.milestone_engagements (milestone_id, employee_id, time_share, rating)
     select '00000000-0000-4000-8000-000000000422', e.id, 0.50, 6
     from public.employees e where e.email = 'employees-new@pgtap.test' $$,
  '23514',
  null,
  'rating 6 is rejected'
);
select throws_ok(
  $$ insert into public.milestone_engagements (milestone_id, employee_id, time_share, rating)
     values ('00000000-0000-4000-8000-000000000421', '00000000-0000-4000-8000-000000000434', 0.10, 3) $$,
  'MR011',
  null,
  'assigning B''s employee to A''s milestone raises MR011'
);
select throws_ok(
  $$ insert into public.milestone_engagements (milestone_id, employee_id, time_share, rating)
     values ('00000000-0000-4000-8000-000000000424', '00000000-0000-4000-8000-000000000431', 0.10, 3) $$,
  '42501',
  null,
  'supervisor A assigning to B''s milestone is denied'
);
select is_empty(
  $$ update public.milestone_engagements set rating = 1 where id = '00000000-0000-4000-8000-000000000447' returning id $$,
  'supervisor A updating an engagement on B''s milestone affects 0 rows'
);
select is_empty(
  $$ delete from public.milestone_engagements where id = '00000000-0000-4000-8000-000000000447' returning id $$,
  'supervisor A deleting an engagement on B''s milestone removes 0 rows'
);
select throws_ok(
  $$ update public.milestone_engagements set milestone_id = '00000000-0000-4000-8000-000000000422'
     where id = '00000000-0000-4000-8000-000000000441' $$,
  '42501',
  null,
  'an engagement''s milestone_id cannot be changed'
);

-- Closed parents (MR007): completed milestone ...0423, cancelled project ...0413
select throws_ok(
  $$ insert into public.milestone_engagements (milestone_id, employee_id, time_share, rating)
     select '00000000-0000-4000-8000-000000000423', e.id, 0.10, 3
     from public.employees e where e.email = 'employees-new@pgtap.test' $$,
  'MR007',
  null,
  'assigning to a completed milestone raises MR007'
);
select throws_ok(
  $$ update public.milestone_engagements set rating = 5 where id = '00000000-0000-4000-8000-000000000443' $$,
  'MR007',
  null,
  'updating an engagement on a completed milestone raises MR007'
);
select throws_ok(
  $$ delete from public.milestone_engagements where id = '00000000-0000-4000-8000-000000000443' $$,
  'MR007',
  null,
  'deleting an engagement on a completed milestone raises MR007'
);
select throws_ok(
  $$ insert into public.milestone_engagements (milestone_id, employee_id, time_share, rating)
     select '00000000-0000-4000-8000-000000000425', e.id, 0.10, 3
     from public.employees e where e.email = 'employees-new@pgtap.test' $$,
  'MR007',
  null,
  'assigning to a milestone of a cancelled project raises MR007'
);
select throws_ok(
  $$ update public.milestone_engagements set rating = 5 where id = '00000000-0000-4000-8000-000000000446' $$,
  'MR007',
  null,
  'updating an engagement in a cancelled project raises MR007'
);
select throws_ok(
  $$ delete from public.milestone_engagements where id = '00000000-0000-4000-8000-000000000446' $$,
  'MR007',
  null,
  'deleting an engagement in a cancelled project raises MR007'
);
select isnt_empty(
  $$ delete from public.milestone_engagements
     where milestone_id = '00000000-0000-4000-8000-000000000421'
       and employee_id = (select id from public.employees where email = 'employees-new@pgtap.test')
     returning id $$,
  'supervisor A can delete own engagement on an open milestone'
);

-- Open totals, A's scope: EA1 0.60 + 0.50 on open milestones (0.30 on the completed one is
-- excluded); EX 0.50 on A's milestone only (its 0.50 on B's milestone is not visible to A).
select results_eq(
  $$ select open_total, over_allocated from public.employee_time_share_totals
     where employee_id = '00000000-0000-4000-8000-000000000431' $$,
  $$ values (1.10::numeric, true) $$,
  'supervisor A sees EA1 at 1.10 over allocated (completed milestone excluded)'
);
select results_eq(
  $$ select open_total, over_allocated from public.employee_time_share_totals
     where employee_id = '00000000-0000-4000-8000-000000000436' $$,
  $$ values (0.50::numeric, false) $$,
  'supervisor A''s total for EX counts only A''s milestones'
);

-- ---------------------------------------------------------------------------
-- Supervisor B: cannot see or touch A's employees
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000403"}';

select is_empty(
  $$ select id from public.employees where id = '00000000-0000-4000-8000-000000000431' $$,
  'supervisor B sees 0 rows of A''s employee'
);
select is_empty(
  $$ update public.employees set full_name = 'pgTAP B was here' where id = '00000000-0000-4000-8000-000000000431' returning id $$,
  'supervisor B updating A''s employee affects 0 rows'
);
select is_empty(
  $$ select id from public.milestone_engagements where milestone_id = '00000000-0000-4000-8000-000000000421' $$,
  'supervisor B sees 0 engagements on A''s milestone'
);

-- ---------------------------------------------------------------------------
-- Employee-role user: sees nothing, writes nothing
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000401"}';

select is_empty($$ select id from public.employees $$, 'employee-role user sees 0 employees');
select is_empty($$ select id from public.milestone_engagements $$, 'employee-role user sees 0 engagements');
select is_empty($$ select employee_id from public.employee_time_share_totals $$, 'employee-role user sees 0 totals');
select throws_ok(
  $$ insert into public.employees (full_name, email, job_role_id)
     values ('pgTAP Self', 'employees-self@pgtap.test', '00000000-0000-4000-8000-000000000408') $$,
  '42501',
  null,
  'employee-role user registering an employee gets 42501, not a guard code'
);
select is_empty(
  $$ update public.employees set full_name = 'pgTAP employee was here' where id = '00000000-0000-4000-8000-000000000431' returning id $$,
  'employee-role user updating an employee affects 0 rows'
);

-- ---------------------------------------------------------------------------
-- Admin: reads and writes employees, only reads engagements
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000404"}';

select is(
  (
    select count(*)::int
    from public.employees
    where id in (
      '00000000-0000-4000-8000-000000000431',
      '00000000-0000-4000-8000-000000000432',
      '00000000-0000-4000-8000-000000000433',
      '00000000-0000-4000-8000-000000000434',
      '00000000-0000-4000-8000-000000000435',
      '00000000-0000-4000-8000-000000000436',
      '00000000-0000-4000-8000-000000000437'
    )
  ),
  7,
  'admin selects employees of every supervisor'
);
select lives_ok(
  $$ insert into public.employees (full_name, email, job_role_id, supervisor_id)
     values ('pgTAP Admin for B', 'employees-admin-for-b@pgtap.test', '00000000-0000-4000-8000-000000000408',
             '00000000-0000-4000-8000-000000000403') $$,
  'admin can register an employee for supervisor B'
);
select is(
  (select supervisor_id from public.employees where email = 'employees-admin-for-b@pgtap.test'),
  '00000000-0000-4000-8000-000000000403'::uuid,
  'the admin-registered employee is owned by B'
);
select throws_ok(
  $$ insert into public.employees (full_name, email, job_role_id, supervisor_id)
     values ('pgTAP Owned by Employee', 'employees-owned-by-employee@pgtap.test', '00000000-0000-4000-8000-000000000408',
             '00000000-0000-4000-8000-000000000401') $$,
  'MR001',
  null,
  'admin registering an employee owned by a non-supervisor raises MR001'
);
select throws_ok(
  $$ update public.employees set supervisor_id = '00000000-0000-4000-8000-000000000403'
     where id = '00000000-0000-4000-8000-000000000433' $$,
  'MR008',
  null,
  'moving an employee with an open engagement on the old owner''s project raises MR008'
);
select isnt_empty(
  $$ update public.employees set supervisor_id = '00000000-0000-4000-8000-000000000403'
     where id = '00000000-0000-4000-8000-000000000432' returning id $$,
  'moving an employee whose only engagements are on closed milestones succeeds'
);
select throws_ok(
  $$ update public.projects set supervisor_id = '00000000-0000-4000-8000-000000000403'
     where id = '00000000-0000-4000-8000-000000000411' $$,
  'MR012',
  null,
  'moving a project whose open milestones have engagements of the old owner''s employees raises MR012'
);
select isnt_empty(
  $$ update public.projects set supervisor_id = '00000000-0000-4000-8000-000000000403'
     where id = '00000000-0000-4000-8000-000000000414' returning id $$,
  'moving a project whose only engagements are on closed milestones succeeds'
);
select throws_ok(
  $$ update public.profiles set role = 'employee' where id = '00000000-0000-4000-8000-000000000405' $$,
  'MR005',
  null,
  'demoting a supervisor who owns employees but no projects raises MR005'
);
select is(
  (
    select count(*)::int
    from public.milestone_engagements
    where milestone_id in ('00000000-0000-4000-8000-000000000421', '00000000-0000-4000-8000-000000000424')
  ),
  4,
  'admin selects engagements on A''s and B''s milestones'
);
select throws_ok(
  $$ insert into public.milestone_engagements (milestone_id, employee_id, time_share, rating)
     values ('00000000-0000-4000-8000-000000000424', '00000000-0000-4000-8000-000000000434', 0.10, 3) $$,
  '42501',
  null,
  'admin engagement insert is denied'
);
select is_empty(
  $$ update public.milestone_engagements set rating = 1 where id = '00000000-0000-4000-8000-000000000441' returning id $$,
  'admin engagement update affects 0 rows'
);
select is_empty(
  $$ delete from public.milestone_engagements where id = '00000000-0000-4000-8000-000000000441' returning id $$,
  'admin engagement delete removes 0 rows'
);
select results_eq(
  $$ select open_total, over_allocated from public.employee_time_share_totals
     where employee_id = '00000000-0000-4000-8000-000000000436' $$,
  $$ values (1.00::numeric, false) $$,
  'admin''s total for EX spans A''s and B''s milestones and is not flagged at exactly 1.00'
);
select results_eq(
  $$ select open_total, over_allocated from public.employee_time_share_totals
     where employee_id = '00000000-0000-4000-8000-000000000431' $$,
  $$ values (1.10::numeric, true) $$,
  'admin sees EA1 at 1.10 over allocated'
);

-- ---------------------------------------------------------------------------
-- After the move: A still sees EA2 (engaged on A's milestone) but can no longer edit it
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000402"}';

select isnt_empty(
  $$ select id from public.employees where id = '00000000-0000-4000-8000-000000000432' $$,
  'supervisor A sees B''s employee engaged on A''s milestone'
);
select is_empty(
  $$ update public.employees set full_name = 'pgTAP A after move' where id = '00000000-0000-4000-8000-000000000432' returning id $$,
  'supervisor A updating a visible but not owned employee affects 0 rows'
);
select is_empty(
  $$ select id from public.employees where id = '00000000-0000-4000-8000-000000000434' $$,
  'supervisor A still sees 0 rows of B''s unengaged employee'
);

-- ---------------------------------------------------------------------------
-- Owner: denied deletes left the rows in place; activation trigger
-- ---------------------------------------------------------------------------
reset role;

select is(
  (
    select count(*)::int
    from public.milestone_engagements
    where id in (
      '00000000-0000-4000-8000-000000000441',
      '00000000-0000-4000-8000-000000000443',
      '00000000-0000-4000-8000-000000000446',
      '00000000-0000-4000-8000-000000000447'
    )
  ),
  4,
  'engagements survived every denied delete'
);
select ok(
  (select activated_at is null from public.employees where id = '00000000-0000-4000-8000-000000000437'),
  'an invited employee is not activated before the email is confirmed'
);

update auth.users set email_confirmed_at = now() where id = '00000000-0000-4000-8000-000000000406';

select ok(
  (select activated_at is not null from public.employees where id = '00000000-0000-4000-8000-000000000437'),
  'confirming the linked account''s email stamps activated_at'
);

delete from auth.users where id = '00000000-0000-4000-8000-000000000406';

select ok(
  (
    select profile_id is null and invited_at is null and activated_at is null
    from public.employees
    where id = '00000000-0000-4000-8000-000000000437'
  ),
  'deleting the linked account clears profile_id and the invite stamps'
);

-- ---------------------------------------------------------------------------
-- Anonymous (anon has no privileges on the tables or the view at all)
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{}';

select throws_ok(
  $$ select count(*) from public.employees $$,
  '42501',
  null,
  'anon cannot read employees'
);
select throws_ok(
  $$ select count(*) from public.milestone_engagements $$,
  '42501',
  null,
  'anon cannot read milestone_engagements'
);
select throws_ok(
  $$ select count(*) from public.employee_time_share_totals $$,
  '42501',
  null,
  'anon cannot read employee_time_share_totals'
);

reset role;

select * from finish();

rollback;
