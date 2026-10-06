-- pgTAP suite for milestone approval (public.milestone_results, public.milestone_result_lines,
-- public.current_employee_id(), public.is_approved_milestone(), public.approve_milestone(), the
-- milestones_check_frozen guard, the 'approved' closed set in MR007/MR008/MR012 and
-- public.employee_time_share_totals, and the stored payout pool in public.project_budget_exposure).
--
-- Isolation model: same as profiles_rls.test.sql. Runs against the live local database without
-- a reset, creates its own fixtures in the reserved UUID range 00000000-0000-4000-8000-0000000006xx
-- with emails under @pgtap.test, never asserts absolute row counts (everything is scoped to
-- fixture rows or read as fixture-only users), and rolls everything back at the end.
-- bonus_settings is pinned to the defaults inside the transaction and the suite uses its own job
-- roles, so local config edits do not change the expected figures.
--
-- Worked example (same as milestone_payouts.test.sql): scores 80/90/85/60 give M = 1.1875; the
-- target pool 10000.00 gives a payout pool of floor(10000.00 x 1.1875 / 1.30) = 9134.61;
-- engagements (0.50, 1.25, rating 4), (0.50, 1.10, 4), (0.30, 1.00, 3) give bonuses
-- 3943.51 / 3470.29 / 1720.80, total 9134.60, residual 0.01.
--
-- Run with: npx supabase test db

begin;

create extension if not exists pgtap with schema extensions;

select plan(71);

-- ---------------------------------------------------------------------------
-- Fixtures (as the table owner; auth.uid() is null, so supervisor_id is explicit)
--   users:       ...0601 employee account of E1 (linked, activated)   ...0602 supervisor A
--                ...0603 supervisor B   ...0604 admin
--                ...0605 employee account of E3 (linked, NOT activated)
--   job roles:   ...0606 Lead 1.25   ...0607 Senior 1.10   ...0608 Specialist 1.00
--   projects:    ...0611 A's (active)   ...0612 A's (completed below)   ...0613 B's (active)
--                ...0614 A's (active; owner change after approval, MR012)
--   milestones:  ...0621 worked example (0611, active, target 10000.00, scored 80/90/85/60) -> approved
--                ...0622 cancelled (0611)   ...0623 unscored, one engagement (0611)
--                ...0624 scored 100s, no engagements (0611)   ...0625 open, unscored (0611)
--                ...0626 scored 100s, in the completed project 0612
--                ...0628 planned, scored 100s (0614, target 1000.00) -> approved
--   employees:   ...0631 E1 Lead   ...0632 E2 Senior   ...0633 E3 Specialist   ...0634 E4 Specialist
--                (all owned by A)
--   engagements: ...0641 E1@0621 0.50 r4   ...0642 E2@0621 0.50 r4   ...0643 E3@0621 0.30 r3
--                ...0644 E1@0623 0.10 r3   ...0645 E1@0625 0.60 r3   ...0646 E2@0626 0.20 r3
--                ...0647 E2@0628 0.10 r3
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000601', 'authenticated', 'authenticated', 'approval-e1@pgtap.test', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000602', 'authenticated', 'authenticated', 'approval-supervisor-a@pgtap.test', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000603', 'authenticated', 'authenticated', 'approval-supervisor-b@pgtap.test', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000604', 'authenticated', 'authenticated', 'approval-admin@pgtap.test', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000605', 'authenticated', 'authenticated', 'approval-e3@pgtap.test', '{}', now(), now());

update public.profiles set role = 'supervisor'
where id in ('00000000-0000-4000-8000-000000000602', '00000000-0000-4000-8000-000000000603');
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-000000000604';

update public.bonus_settings
set
  kpi_weight_schedule = 0.30,
  kpi_weight_budget = 0.30,
  kpi_weight_quality = 0.25,
  kpi_weight_risk = 0.15,
  multiplier_min = 0.70,
  multiplier_max = 1.30,
  rating_factor_1 = 0.80,
  rating_factor_2 = 0.90,
  rating_factor_3 = 1.00,
  rating_factor_4 = 1.10,
  rating_factor_5 = 1.20
where id;

insert into public.job_roles (id, name, weight)
values
  ('00000000-0000-4000-8000-000000000606', 'pgTAP Approval Lead', 1.25),
  ('00000000-0000-4000-8000-000000000607', 'pgTAP Approval Senior', 1.10),
  ('00000000-0000-4000-8000-000000000608', 'pgTAP Approval Specialist', 1.00);

insert into public.projects (id, name, start_date, end_date, status, total_budget, supervisor_id)
values
  ('00000000-0000-4000-8000-000000000611', 'pgTAP Approval Project A', '2026-01-01', '2026-12-31', 'active', 100000.00, '00000000-0000-4000-8000-000000000602'),
  ('00000000-0000-4000-8000-000000000612', 'pgTAP Approval Project A closed', '2026-01-01', '2026-12-31', 'active', 10000.00, '00000000-0000-4000-8000-000000000602'),
  ('00000000-0000-4000-8000-000000000613', 'pgTAP Approval Project B', '2026-01-01', '2026-12-31', 'active', 10000.00, '00000000-0000-4000-8000-000000000603'),
  ('00000000-0000-4000-8000-000000000614', 'pgTAP Approval Project A handover', '2026-01-01', '2026-12-31', 'active', 10000.00, '00000000-0000-4000-8000-000000000602');

insert into public.milestones (id, project_id, name, start_date, end_date, status, target_pool)
values
  ('00000000-0000-4000-8000-000000000621', '00000000-0000-4000-8000-000000000611', 'pgTAP Ap Worked', '2026-01-01', '2026-03-31', 'active', 10000.00),
  ('00000000-0000-4000-8000-000000000622', '00000000-0000-4000-8000-000000000611', 'pgTAP Ap Cancelled', '2026-04-01', '2026-04-30', 'cancelled', 1000.00),
  ('00000000-0000-4000-8000-000000000623', '00000000-0000-4000-8000-000000000611', 'pgTAP Ap Unscored', '2026-05-01', '2026-05-31', 'active', 1000.00),
  ('00000000-0000-4000-8000-000000000624', '00000000-0000-4000-8000-000000000611', 'pgTAP Ap Empty', '2026-06-01', '2026-06-30', 'active', 1000.00),
  ('00000000-0000-4000-8000-000000000625', '00000000-0000-4000-8000-000000000611', 'pgTAP Ap Open', '2026-07-01', '2026-07-31', 'active', 1000.00),
  ('00000000-0000-4000-8000-000000000626', '00000000-0000-4000-8000-000000000612', 'pgTAP Ap Closed', '2026-01-01', '2026-03-31', 'active', 1000.00),
  ('00000000-0000-4000-8000-000000000628', '00000000-0000-4000-8000-000000000614', 'pgTAP Ap Handover', '2026-01-01', '2026-03-31', 'planned', 1000.00);

insert into public.employees (id, supervisor_id, full_name, email, job_role_id)
values
  ('00000000-0000-4000-8000-000000000632', '00000000-0000-4000-8000-000000000602', 'pgTAP Approval E2', 'approval-e2-record@pgtap.test', '00000000-0000-4000-8000-000000000607'),
  ('00000000-0000-4000-8000-000000000634', '00000000-0000-4000-8000-000000000602', 'pgTAP Approval E4', 'approval-e4-record@pgtap.test', '00000000-0000-4000-8000-000000000608');

-- E1: linked to ...0601 and activated (invite accepted). E3: linked to ...0605, invited only.
insert into public.employees (id, supervisor_id, full_name, email, job_role_id, profile_id, invited_at, activated_at)
values
  ('00000000-0000-4000-8000-000000000631', '00000000-0000-4000-8000-000000000602', 'pgTAP Approval E1', 'approval-e1@pgtap.test', '00000000-0000-4000-8000-000000000606', '00000000-0000-4000-8000-000000000601', now(), now()),
  ('00000000-0000-4000-8000-000000000633', '00000000-0000-4000-8000-000000000602', 'pgTAP Approval E3', 'approval-e3@pgtap.test', '00000000-0000-4000-8000-000000000608', '00000000-0000-4000-8000-000000000605', now(), null);

insert into public.milestone_engagements (id, milestone_id, employee_id, time_share, rating)
values
  ('00000000-0000-4000-8000-000000000641', '00000000-0000-4000-8000-000000000621', '00000000-0000-4000-8000-000000000631', 0.50, 4),
  ('00000000-0000-4000-8000-000000000642', '00000000-0000-4000-8000-000000000621', '00000000-0000-4000-8000-000000000632', 0.50, 4),
  ('00000000-0000-4000-8000-000000000643', '00000000-0000-4000-8000-000000000621', '00000000-0000-4000-8000-000000000633', 0.30, 3),
  ('00000000-0000-4000-8000-000000000644', '00000000-0000-4000-8000-000000000623', '00000000-0000-4000-8000-000000000631', 0.10, 3),
  ('00000000-0000-4000-8000-000000000645', '00000000-0000-4000-8000-000000000625', '00000000-0000-4000-8000-000000000631', 0.60, 3),
  ('00000000-0000-4000-8000-000000000646', '00000000-0000-4000-8000-000000000626', '00000000-0000-4000-8000-000000000632', 0.20, 3),
  ('00000000-0000-4000-8000-000000000647', '00000000-0000-4000-8000-000000000628', '00000000-0000-4000-8000-000000000632', 0.10, 3);

update public.milestones
set kpi_schedule = 80, kpi_budget = 90, kpi_quality = 85, kpi_risk = 60
where id = '00000000-0000-4000-8000-000000000621';

update public.milestones
set kpi_schedule = 100, kpi_budget = 100, kpi_quality = 100, kpi_risk = 100
where id in (
  '00000000-0000-4000-8000-000000000624',
  '00000000-0000-4000-8000-000000000626',
  '00000000-0000-4000-8000-000000000628'
);

-- Close the parent project last, after its milestone's engagement and scores exist.
update public.projects set status = 'completed' where id = '00000000-0000-4000-8000-000000000612';

-- The Draft figures just before approval, read as the owner (who sees the same config).
create temp table pgtap_pre_summary as
select * from public.milestone_payout_summary('00000000-0000-4000-8000-000000000621');

create temp table pgtap_pre_lines as
select * from public.milestone_payout_lines('00000000-0000-4000-8000-000000000621');

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------
select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.milestone_results'::regclass),
  'milestone_results has row level security enabled'
);
select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.milestone_result_lines'::regclass),
  'milestone_result_lines has row level security enabled'
);
select ok(
  not has_table_privilege('authenticated', 'public.milestone_results', 'INSERT')
    and not has_table_privilege('authenticated', 'public.milestone_results', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.milestone_results', 'DELETE')
    and has_table_privilege('authenticated', 'public.milestone_results', 'SELECT'),
  'authenticated may only select milestone_results (no insert, update or delete)'
);
select ok(
  not has_table_privilege('authenticated', 'public.milestone_result_lines', 'INSERT')
    and not has_table_privilege('authenticated', 'public.milestone_result_lines', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.milestone_result_lines', 'DELETE')
    and has_table_privilege('authenticated', 'public.milestone_result_lines', 'SELECT'),
  'authenticated may only select milestone_result_lines (no insert, update or delete)'
);
select ok(
  not has_column_privilege('authenticated', 'public.milestone_result_lines', 'notify_claimed_at', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.milestone_result_lines', 'notified_at', 'UPDATE'),
  'the email send claim and stamp (notify_claimed_at, notified_at) are not writable by authenticated'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_class c, unnest(coalesce(c.reloptions, '{}'::text[])) as opt
    where c.oid = 'public.employee_time_share_totals'::regclass
      and lower(opt) in ('security_invoker=true', 'security_invoker=on', 'security_invoker=1')
  ),
  'employee_time_share_totals keeps security_invoker = true'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_class c, unnest(coalesce(c.reloptions, '{}'::text[])) as opt
    where c.oid = 'public.project_budget_exposure'::regclass
      and lower(opt) in ('security_invoker=true', 'security_invoker=on', 'security_invoker=1')
  ),
  'project_budget_exposure keeps security_invoker = true'
);
select ok(
  has_function_privilege('authenticated', 'public.current_employee_id()', 'execute')
    and not has_function_privilege('anon', 'public.current_employee_id()', 'execute'),
  'current_employee_id is executable by authenticated, not anon'
);
select ok(
  has_function_privilege('authenticated', 'public.is_approved_milestone(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.is_approved_milestone(uuid)', 'execute'),
  'is_approved_milestone is executable by authenticated, not anon'
);
select ok(
  has_function_privilege('authenticated', 'public.approve_milestone(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.approve_milestone(uuid)', 'execute'),
  'approve_milestone is executable by authenticated, not anon'
);
select ok(
  not has_function_privilege('authenticated', 'public.milestones_check_frozen()', 'execute'),
  'authenticated cannot execute the milestones_check_frozen trigger function'
);

-- Invariant CHECKs on the header, as the owner (0624 has no header yet).
select throws_ok(
  $$ insert into public.milestone_results (
       milestone_id, project_id, project_name, milestone_name, start_date, end_date, target_pool,
       kpi_schedule, kpi_budget, kpi_quality, kpi_risk, multiplier, multiplier_min, multiplier_max,
       budget_share, payout_pool, payout_total, residual, engagement_count)
     values ('00000000-0000-4000-8000-000000000624', '00000000-0000-4000-8000-000000000611', 'P', 'M',
             '2026-06-01', '2026-06-30', 1000.00, 100, 100, 100, 100, 1.30, 0.70, 1.30,
             1, 1000.01, 0, 1000.01, 0) $$,
  '23514',
  null,
  'a header whose payout pool exceeds the target pool is rejected'
);
select throws_ok(
  $$ insert into public.milestone_results (
       milestone_id, project_id, project_name, milestone_name, start_date, end_date, target_pool,
       kpi_schedule, kpi_budget, kpi_quality, kpi_risk, multiplier, multiplier_min, multiplier_max,
       budget_share, payout_pool, payout_total, residual, engagement_count)
     values ('00000000-0000-4000-8000-000000000624', '00000000-0000-4000-8000-000000000611', 'P', 'M',
             '2026-06-01', '2026-06-30', 1000.00, 100, 100, 100, 100, 1.30, 0.70, 1.30,
             1, 900.00, 900.01, -0.01, 1) $$,
  '23514',
  null,
  'a header whose payout total exceeds the payout pool is rejected'
);
select throws_ok(
  $$ insert into public.milestone_results (
       milestone_id, project_id, project_name, milestone_name, start_date, end_date, target_pool,
       kpi_schedule, kpi_budget, kpi_quality, kpi_risk, multiplier, multiplier_min, multiplier_max,
       budget_share, payout_pool, payout_total, residual, engagement_count)
     values ('00000000-0000-4000-8000-000000000624', '00000000-0000-4000-8000-000000000611', 'P', 'M',
             '2026-06-01', '2026-06-30', 1000.00, 100, 100, 100, 100, 1.30, 0.70, 1.30,
             1, 1000.00, 900.00, 99.00, 1) $$,
  '23514',
  null,
  'a header whose residual is not pool minus total is rejected'
);

-- ---------------------------------------------------------------------------
-- Owner: before approval, the open-milestone filters still count 0621 and 0628
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.employees set supervisor_id = '00000000-0000-4000-8000-000000000603'
     where id = '00000000-0000-4000-8000-000000000633' $$,
  'MR008',
  null,
  'before approval: moving E3 to B while engaged on A''s open milestone raises MR008'
);
select throws_ok(
  $$ update public.projects set supervisor_id = '00000000-0000-4000-8000-000000000603'
     where id = '00000000-0000-4000-8000-000000000614' $$,
  'MR012',
  null,
  'before approval: handing 0614 to B while its open milestone holds A''s employee raises MR012'
);

-- ---------------------------------------------------------------------------
-- Supervisor A: baselines, then the guards that refuse approval
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000602"}';

select is(
  (select reserved_total from public.project_budget_exposure where project_id = '00000000-0000-4000-8000-000000000611'),
  13000.00::numeric,
  'before approval the project reserves every non-cancelled target pool (13000.00)'
);
select is(
  (select open_total from public.employee_time_share_totals where employee_id = '00000000-0000-4000-8000-000000000631'),
  1.20::numeric,
  'before approval E1''s open time share counts 0621 (1.20)'
);
select throws_ok(
  $$ update public.milestones set status = 'approved' where id = '00000000-0000-4000-8000-000000000625' $$,
  'MR014',
  null,
  'the generic update to status approved raises MR014'
);
select throws_ok(
  $$ insert into public.milestones (project_id, name, start_date, end_date, status, target_pool)
     values ('00000000-0000-4000-8000-000000000611', 'pgTAP Ap Born Approved', '2026-08-01', '2026-08-31',
             'approved', 100.00) $$,
  'MR014',
  null,
  'inserting a milestone with status approved raises MR014'
);
select throws_ok(
  $$ select public.approve_milestone('00000000-0000-4000-8000-000000000622') $$,
  'MR014',
  null,
  'approving a cancelled milestone raises MR014'
);
select throws_ok(
  $$ select public.approve_milestone('00000000-0000-4000-8000-000000000623') $$,
  'MR014',
  null,
  'approving an unscored milestone raises MR014'
);
select throws_ok(
  $$ select public.approve_milestone('00000000-0000-4000-8000-000000000624') $$,
  'MR014',
  null,
  'approving a milestone with no engagements raises MR014'
);
select throws_ok(
  $$ select public.approve_milestone('00000000-0000-4000-8000-000000000626') $$,
  'MR003',
  null,
  'approving a milestone of a completed project raises MR003'
);
select is_empty(
  $$ select milestone_id from public.milestone_results
     where milestone_id in (
       '00000000-0000-4000-8000-000000000622', '00000000-0000-4000-8000-000000000623',
       '00000000-0000-4000-8000-000000000624', '00000000-0000-4000-8000-000000000626') $$,
  'refused approvals leave no snapshot behind (MR003 rolled the header back)'
);

-- ---------------------------------------------------------------------------
-- Supervisor A: approval
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.approve_milestone('00000000-0000-4000-8000-000000000621') $$,
  'the owning supervisor approves the scored, staffed, active milestone'
);
select lives_ok(
  $$ select public.approve_milestone('00000000-0000-4000-8000-000000000628') $$,
  'the owning supervisor approves the planned handover milestone'
);
select is(
  (select status from public.milestones where id = '00000000-0000-4000-8000-000000000621'),
  'approved',
  'the milestone status is approved'
);
select throws_ok(
  $$ select public.approve_milestone('00000000-0000-4000-8000-000000000621') $$,
  'MR015',
  null,
  'a second approval raises MR015'
);
select results_eq(
  $$ select payout_pool, payout_total, residual, multiplier, multiplier_max, engagement_count, approved_by
     from public.milestone_results where milestone_id = '00000000-0000-4000-8000-000000000621' $$,
  $$ values (9134.61::numeric, 9134.60::numeric, 0.01::numeric, 1.1875::numeric, 1.30::numeric, 3,
             '00000000-0000-4000-8000-000000000602'::uuid) $$,
  'the header stores the worked example: pool 9134.61, total 9134.60, residual 0.01, M 1.1875, max 1.30'
);
select results_eq(
  $$ select employee_name, bonus
     from public.milestone_result_lines
     where milestone_id = '00000000-0000-4000-8000-000000000621'
     order by employee_name $$,
  $$ values
       ('pgTAP Approval E1', 3943.51::numeric),
       ('pgTAP Approval E2', 3470.29::numeric),
       ('pgTAP Approval E3', 1720.80::numeric) $$,
  'the owning supervisor reads the three stored lines: 3943.51 / 3470.29 / 1720.80'
);

-- ---------------------------------------------------------------------------
-- Owner: the snapshot equals the Draft figures taken just before approval
-- ---------------------------------------------------------------------------
reset role;

select results_eq(
  $$ select target_pool, kpi_schedule, kpi_budget, kpi_quality, kpi_risk, multiplier, budget_share,
            payout_pool, payout_total, residual, engagement_count
     from public.milestone_results where milestone_id = '00000000-0000-4000-8000-000000000621' $$,
  $$ select target_pool, kpi_schedule, kpi_budget, kpi_quality, kpi_risk, multiplier, budget_share,
            payout_pool, payout_total, residual, engagement_count
     from pgtap_pre_summary $$,
  'the header equals milestone_payout_summary just before approval'
);
select results_eq(
  $$ select engagement_id, employee_id, employee_name, job_role_name, time_share, role_weight, rating,
            rating_factor, weighted_contribution, bonus
     from public.milestone_result_lines
     where milestone_id = '00000000-0000-4000-8000-000000000621'
     order by employee_name, engagement_id $$,
  $$ select engagement_id, employee_id, employee_name, job_role_name, time_share, role_weight, rating,
            rating_factor, weighted_contribution, bonus
     from pgtap_pre_lines
     order by employee_name, engagement_id $$,
  'the lines equal milestone_payout_lines just before approval'
);
select ok(
  (
    select sum(l.bonus) = r.payout_total and r.payout_total <= r.payout_pool and r.payout_pool <= r.target_pool
    from public.milestone_results r
    join public.milestone_result_lines l on l.milestone_id = r.milestone_id
    where r.milestone_id = '00000000-0000-4000-8000-000000000621'
    group by r.payout_total, r.payout_pool, r.target_pool
  ),
  'sum of stored bonuses = payout_total <= payout_pool <= target_pool'
);
select ok(
  (
    select bool_and(
      l.multiplier = r.multiplier
      and l.approved_at = r.approved_at
      and l.project_name = r.project_name
      and l.milestone_name = r.milestone_name
      and l.start_date = r.start_date
      and l.end_date = r.end_date
      and l.notified_at is null
    )
    from public.milestone_results r
    join public.milestone_result_lines l on l.milestone_id = r.milestone_id
    where r.milestone_id = '00000000-0000-4000-8000-000000000621'
  ),
  'every line carries the header''s multiplier, approval time and display fields, not yet notified'
);

-- ---------------------------------------------------------------------------
-- Freeze: config, job role, employee and project edits never change the snapshot
-- ---------------------------------------------------------------------------
update public.bonus_settings
set
  kpi_weight_schedule = 0.25,
  kpi_weight_budget = 0.25,
  kpi_weight_quality = 0.25,
  kpi_weight_risk = 0.25,
  multiplier_max = 2.00,
  rating_factor_1 = 0.50,
  rating_factor_2 = 0.60,
  rating_factor_3 = 0.70,
  rating_factor_4 = 0.80,
  rating_factor_5 = 0.90
where id;

update public.job_roles
set weight = 2.00, name = 'pgTAP Approval Lead renamed'
where id = '00000000-0000-4000-8000-000000000606';

update public.employees
set full_name = 'pgTAP Approval E1 renamed', job_role_id = '00000000-0000-4000-8000-000000000608'
where id = '00000000-0000-4000-8000-000000000631';

update public.projects
set name = 'pgTAP Approval Project A renamed'
where id = '00000000-0000-4000-8000-000000000611';

select results_eq(
  $$ select project_name, multiplier, multiplier_max, budget_share, payout_pool, payout_total, residual
     from public.milestone_results where milestone_id = '00000000-0000-4000-8000-000000000621' $$,
  $$ values ('pgTAP Approval Project A', 1.1875::numeric, 1.30::numeric, 0.913462::numeric,
             9134.61::numeric, 9134.60::numeric, 0.01::numeric) $$,
  'after config, role and name edits the header figures are unchanged'
);
select results_eq(
  $$ select employee_name, job_role_name, role_weight, rating_factor, bonus, project_name
     from public.milestone_result_lines
     where milestone_id = '00000000-0000-4000-8000-000000000621'
     order by employee_name $$,
  $$ values
       ('pgTAP Approval E1', 'pgTAP Approval Lead', 1.25::numeric, 1.10::numeric, 3943.51::numeric, 'pgTAP Approval Project A'),
       ('pgTAP Approval E2', 'pgTAP Approval Senior', 1.10::numeric, 1.10::numeric, 3470.29::numeric, 'pgTAP Approval Project A'),
       ('pgTAP Approval E3', 'pgTAP Approval Specialist', 1.00::numeric, 1.00::numeric, 1720.80::numeric, 'pgTAP Approval Project A') $$,
  'after config, role and name edits the stored lines are unchanged'
);

-- ---------------------------------------------------------------------------
-- Supervisor A: an approved milestone and its engagements are frozen
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000602"}';

select throws_ok(
  $$ update public.milestones set target_pool = 20000.00 where id = '00000000-0000-4000-8000-000000000621' $$,
  'MR015',
  null,
  'changing an approved milestone''s target pool raises MR015'
);
select throws_ok(
  $$ update public.milestones
     set kpi_schedule = 10, kpi_budget = 10, kpi_quality = 10, kpi_risk = 10
     where id = '00000000-0000-4000-8000-000000000621' $$,
  'MR015',
  null,
  'changing an approved milestone''s KPI scores raises MR015'
);
select throws_ok(
  $$ update public.milestones set status = 'active' where id = '00000000-0000-4000-8000-000000000621' $$,
  'MR015',
  null,
  'reopening an approved milestone raises MR015 (approval is irreversible)'
);
select throws_ok(
  $$ update public.milestones set name = 'pgTAP Ap Worked renamed' where id = '00000000-0000-4000-8000-000000000621' $$,
  'MR015',
  null,
  'renaming an approved milestone raises MR015'
);
select throws_ok(
  $$ insert into public.milestone_engagements (milestone_id, employee_id, time_share, rating)
     values ('00000000-0000-4000-8000-000000000621', '00000000-0000-4000-8000-000000000634', 0.10, 3) $$,
  'MR007',
  null,
  'adding an engagement to an approved milestone raises MR007'
);
select throws_ok(
  $$ update public.milestone_engagements set time_share = 0.40 where id = '00000000-0000-4000-8000-000000000641' $$,
  'MR007',
  null,
  'changing an engagement of an approved milestone raises MR007'
);
select throws_ok(
  $$ delete from public.milestone_engagements where id = '00000000-0000-4000-8000-000000000641' $$,
  'MR007',
  null,
  'deleting an engagement of an approved milestone raises MR007'
);
select throws_ok(
  $$ update public.milestones set project_id = '00000000-0000-4000-8000-000000000613'
     where id = '00000000-0000-4000-8000-000000000625' $$,
  'MR006',
  null,
  'moving a milestone to a project the caller does not own still raises MR006'
);

-- ---------------------------------------------------------------------------
-- Supervisor A: the filters treat approved as closed
-- ---------------------------------------------------------------------------
select is(
  (select reserved_total from public.project_budget_exposure where project_id = '00000000-0000-4000-8000-000000000611'),
  12134.61::numeric,
  'the budget view reserves the approved milestone''s payout pool (9134.61 + 3 x 1000.00)'
);
select is(
  (select open_total from public.employee_time_share_totals where employee_id = '00000000-0000-4000-8000-000000000631'),
  0.70::numeric,
  'E1''s open time share no longer counts the approved milestone (0.70)'
);
select ok(
  public.is_approved_milestone('00000000-0000-4000-8000-000000000621')
    and not public.is_approved_milestone('00000000-0000-4000-8000-000000000625'),
  'is_approved_milestone is true only for the approved milestone'
);

reset role;
-- Clear the JWT too: reset role keeps Supervisor A's claims, and the owner-change guards would then
-- (correctly) raise 42501 instead of reaching MR008/MR012. Same no-JWT context as the "before" block.
set local request.jwt.claims = '{}';

select lives_ok(
  $$ update public.employees set supervisor_id = '00000000-0000-4000-8000-000000000603'
     where id = '00000000-0000-4000-8000-000000000633' $$,
  'after approval MR008 no longer counts the approved milestone as open'
);
select lives_ok(
  $$ update public.projects set supervisor_id = '00000000-0000-4000-8000-000000000603'
     where id = '00000000-0000-4000-8000-000000000614' $$,
  'after approval MR012 no longer counts the approved milestone as open'
);

-- ---------------------------------------------------------------------------
-- Supervisor B and the Admin: 42501 before any MR guard; reads follow RLS
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000603"}';

select throws_ok(
  $$ select public.approve_milestone('00000000-0000-4000-8000-000000000621') $$,
  '42501',
  null,
  'supervisor B approving A''s approved milestone gets 42501, not MR015'
);
select throws_ok(
  $$ select public.approve_milestone('00000000-0000-4000-8000-000000000623') $$,
  '42501',
  null,
  'supervisor B approving A''s unscored milestone gets 42501, not MR014'
);
select is_empty(
  $$ select milestone_id from public.milestone_results where milestone_id = '00000000-0000-4000-8000-000000000621' $$,
  'supervisor B sees no header of A''s milestone'
);
select is_empty(
  $$ select id from public.milestone_result_lines where milestone_id = '00000000-0000-4000-8000-000000000621' $$,
  'supervisor B sees no lines of A''s milestone'
);

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000604"}';

select throws_ok(
  $$ select public.approve_milestone('00000000-0000-4000-8000-000000000621') $$,
  '42501',
  null,
  'the admin approving gets 42501, not MR015 (admins are read-only)'
);
select throws_ok(
  $$ select public.approve_milestone('00000000-0000-4000-8000-000000000623') $$,
  '42501',
  null,
  'the admin approving an unscored milestone gets 42501, not MR014'
);
select isnt_empty(
  $$ select milestone_id from public.milestone_results where milestone_id = '00000000-0000-4000-8000-000000000621' $$,
  'the admin reads the header'
);
select is(
  (select count(*)::int from public.milestone_result_lines where milestone_id = '00000000-0000-4000-8000-000000000621'),
  3,
  'the admin reads every line'
);
select throws_ok(
  $$ update public.milestone_result_lines set bonus = 0 where milestone_id = '00000000-0000-4000-8000-000000000621' $$,
  '42501',
  null,
  'the admin cannot change a stored line (no update privilege)'
);

-- ---------------------------------------------------------------------------
-- Employee E1 (linked, activated): exactly their own line, never the header or a colleague's line
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000601"}';

select is(
  public.current_employee_id(),
  '00000000-0000-4000-8000-000000000631'::uuid,
  'current_employee_id resolves the activated employee row'
);
select results_eq(
  $$ select milestone_id, employee_id, employee_name, bonus from public.milestone_result_lines $$,
  $$ values ('00000000-0000-4000-8000-000000000621'::uuid, '00000000-0000-4000-8000-000000000631'::uuid,
             'pgTAP Approval E1', 3943.51::numeric) $$,
  'E1 sees exactly their own approved line'
);
select is_empty(
  $$ select id from public.milestone_result_lines
     where employee_id in ('00000000-0000-4000-8000-000000000632', '00000000-0000-4000-8000-000000000633') $$,
  'E1 sees no line of a colleague on the same milestone, even by id'
);
select is_empty(
  $$ select milestone_id from public.milestone_results $$,
  'E1 sees no header row (pool, total and residual stay hidden)'
);
select is_empty(
  $$ select id from public.milestones where id = '00000000-0000-4000-8000-000000000621' $$,
  'E1 still cannot read the milestone itself'
);
select throws_ok(
  $$ select public.approve_milestone('00000000-0000-4000-8000-000000000625') $$,
  '42501',
  null,
  'an employee cannot approve'
);

-- ---------------------------------------------------------------------------
-- Employee E3 (linked, NOT activated): sees nothing
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000605"}';

select ok(
  public.current_employee_id() is null,
  'current_employee_id is null for a linked but unactivated account'
);
select is_empty(
  $$ select id from public.milestone_result_lines $$,
  'a linked but unactivated employee sees no lines, not even their own'
);

-- ---------------------------------------------------------------------------
-- A line of a non-approved milestone stays invisible to its employee (the approved predicate)
-- ---------------------------------------------------------------------------
reset role;

insert into public.milestone_results (
  milestone_id, project_id, project_name, milestone_name, start_date, end_date, target_pool,
  kpi_schedule, kpi_budget, kpi_quality, kpi_risk, multiplier, multiplier_min, multiplier_max,
  budget_share, payout_pool, payout_total, residual, engagement_count
)
values (
  '00000000-0000-4000-8000-000000000623', '00000000-0000-4000-8000-000000000611', 'pgTAP Approval Project A',
  'pgTAP Ap Unscored', '2026-05-01', '2026-05-31', 1000.00, 50, 50, 50, 50, 1.00, 0.70, 1.30,
  0.769231, 769.23, 769.23, 0.00, 1
);

insert into public.milestone_result_lines (
  milestone_id, engagement_id, employee_id, employee_name, job_role_name, project_id, project_name,
  milestone_name, start_date, end_date, approved_at, time_share, role_weight, rating, rating_factor,
  weighted_contribution, multiplier, bonus
)
values (
  '00000000-0000-4000-8000-000000000623', '00000000-0000-4000-8000-000000000644',
  '00000000-0000-4000-8000-000000000631', 'pgTAP Approval E1', 'pgTAP Approval Lead',
  '00000000-0000-4000-8000-000000000611', 'pgTAP Approval Project A', 'pgTAP Ap Unscored',
  '2026-05-01', '2026-05-31', now(), 0.10, 1.25, 3, 1.00, 0.125, 1.00, 769.23
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000601"}';

select is_empty(
  $$ select id from public.milestone_result_lines where milestone_id = '00000000-0000-4000-8000-000000000623' $$,
  'E1 cannot see their own line of a milestone that is not approved'
);
select is(
  (select count(*)::int from public.milestone_result_lines),
  1,
  'E1 still sees only the approved line'
);

-- ---------------------------------------------------------------------------
-- Anonymous (anon has no privileges on the snapshot tables at all)
-- ---------------------------------------------------------------------------
reset role;

set local role anon;
set local request.jwt.claims = '{}';

select throws_ok(
  $$ select count(*) from public.milestone_result_lines $$,
  '42501',
  null,
  'anon cannot read milestone_result_lines'
);
select throws_ok(
  $$ select count(*) from public.milestone_results $$,
  '42501',
  null,
  'anon cannot read milestone_results'
);

reset role;

select * from finish();

rollback;
