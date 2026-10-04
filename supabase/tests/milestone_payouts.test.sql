-- pgTAP suite for milestone KPI scores and computed bonuses (the milestones KPI columns and checks,
-- public.milestones_check_scores(), public.kpi_multiplier(), public.milestone_payout_lines() and
-- public.capped_payout_pool() and public.milestone_payout_summary()).
--
-- Isolation model: same as profiles_rls.test.sql. Runs against the live local database without
-- a reset, creates its own fixtures in the reserved UUID range 00000000-0000-4000-8000-0000000005xx
-- with emails under @pgtap.test, never asserts absolute row counts (everything is scoped to
-- fixture milestones), and rolls everything back at the end. bonus_settings is pinned to the
-- defaults inside the transaction and the suite uses its own job roles, so local config edits do
-- not change the expected figures.
--
-- Worked example (defaults, Ryzyko higher = better): scores 80/90/85/60 give M = 1.1875; the
-- target pool 10000.00 is the approved maximum, so the payout pool is floor(10000.00 x 1.1875 /
-- 1.30) = 9134.61; engagements (0.50, 1.25, rating 4), (0.50, 1.10, 4), (0.30, 1.00, 3) give
-- bonuses 3943.51 / 3470.29 / 1720.80, total 9134.60, residual 0.01. Only M = multiplier_max
-- (100/100/100/100) pays out the whole target pool.
--
-- Run with: npx supabase test db

begin;

create extension if not exists pgtap with schema extensions;

select plan(55);

-- ---------------------------------------------------------------------------
-- Fixtures (as the table owner; auth.uid() is null, so supervisor_id is explicit)
--   users:       ...0501 employee   ...0502 supervisor A   ...0503 supervisor B   ...0504 admin
--   job roles:   ...0506 Lead 1.25   ...0507 Senior 1.10   ...0508 Specialist 1.00
--   projects:    ...0511 A's (active)   ...0512 A's (completed below)
--   milestones:  ...0521 worked example (0511, target 10000.00)
--                ...0522 recurring split (0511, target 100.00, scored 100s: pool 100.00)
--                ...0523 no engagements (0511, target 1000.00, scored 100s: pool 1000.00)
--                ...0524 cancelled (0511)   ...0525 unscored, no engagements (0511)
--                ...0526 in the completed project 0512
--   employees:   ...0531 E1 Lead   ...0532 E2 Senior   ...0533 E3 Specialist
--                ...0534/0535/0536 R1/R2/R3 Specialist (all owned by A)
--   engagements: ...0541 E1@0521 0.50 r4   ...0542 E2@0521 0.50 r4   ...0543 E3@0521 0.30 r3
--                ...0544/0545/0546 R1/R2/R3@0522 0.50 r3 (three equal contributions)
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000501', 'authenticated', 'authenticated', 'payouts-employee@pgtap.test', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000502', 'authenticated', 'authenticated', 'payouts-supervisor-a@pgtap.test', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000503', 'authenticated', 'authenticated', 'payouts-supervisor-b@pgtap.test', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000504', 'authenticated', 'authenticated', 'payouts-admin@pgtap.test', '{}', now(), now());

update public.profiles set role = 'supervisor'
where id in ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000503');
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-000000000504';

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
  ('00000000-0000-4000-8000-000000000506', 'pgTAP Payouts Lead', 1.25),
  ('00000000-0000-4000-8000-000000000507', 'pgTAP Payouts Senior', 1.10),
  ('00000000-0000-4000-8000-000000000508', 'pgTAP Payouts Specialist', 1.00);

insert into public.projects (id, name, start_date, end_date, status, total_budget, supervisor_id)
values
  ('00000000-0000-4000-8000-000000000511', 'pgTAP Payouts Project A', '2026-01-01', '2026-12-31', 'active', 100000.00, '00000000-0000-4000-8000-000000000502'),
  ('00000000-0000-4000-8000-000000000512', 'pgTAP Payouts Project A closed', '2026-01-01', '2026-12-31', 'active', 10000.00, '00000000-0000-4000-8000-000000000502');

insert into public.milestones (id, project_id, name, start_date, end_date, status, target_pool)
values
  ('00000000-0000-4000-8000-000000000521', '00000000-0000-4000-8000-000000000511', 'pgTAP P Worked', '2026-01-01', '2026-03-31', 'active', 10000.00),
  ('00000000-0000-4000-8000-000000000522', '00000000-0000-4000-8000-000000000511', 'pgTAP P Recurring', '2026-04-01', '2026-06-30', 'active', 100.00),
  ('00000000-0000-4000-8000-000000000523', '00000000-0000-4000-8000-000000000511', 'pgTAP P Empty', '2026-07-01', '2026-09-30', 'active', 1000.00),
  ('00000000-0000-4000-8000-000000000524', '00000000-0000-4000-8000-000000000511', 'pgTAP P Cancelled', '2026-10-01', '2026-10-31', 'cancelled', 1000.00),
  ('00000000-0000-4000-8000-000000000525', '00000000-0000-4000-8000-000000000511', 'pgTAP P Unscored', '2026-11-01', '2026-11-30', 'active', 1000.00),
  ('00000000-0000-4000-8000-000000000526', '00000000-0000-4000-8000-000000000512', 'pgTAP P Closed', '2026-01-01', '2026-03-31', 'active', 1000.00);

insert into public.employees (id, supervisor_id, full_name, email, job_role_id)
values
  ('00000000-0000-4000-8000-000000000531', '00000000-0000-4000-8000-000000000502', 'pgTAP Payouts E1', 'payouts-e1@pgtap.test', '00000000-0000-4000-8000-000000000506'),
  ('00000000-0000-4000-8000-000000000532', '00000000-0000-4000-8000-000000000502', 'pgTAP Payouts E2', 'payouts-e2@pgtap.test', '00000000-0000-4000-8000-000000000507'),
  ('00000000-0000-4000-8000-000000000533', '00000000-0000-4000-8000-000000000502', 'pgTAP Payouts E3', 'payouts-e3@pgtap.test', '00000000-0000-4000-8000-000000000508'),
  ('00000000-0000-4000-8000-000000000534', '00000000-0000-4000-8000-000000000502', 'pgTAP Payouts R1', 'payouts-r1@pgtap.test', '00000000-0000-4000-8000-000000000508'),
  ('00000000-0000-4000-8000-000000000535', '00000000-0000-4000-8000-000000000502', 'pgTAP Payouts R2', 'payouts-r2@pgtap.test', '00000000-0000-4000-8000-000000000508'),
  ('00000000-0000-4000-8000-000000000536', '00000000-0000-4000-8000-000000000502', 'pgTAP Payouts R3', 'payouts-r3@pgtap.test', '00000000-0000-4000-8000-000000000508');

insert into public.milestone_engagements (id, milestone_id, employee_id, time_share, rating)
values
  ('00000000-0000-4000-8000-000000000541', '00000000-0000-4000-8000-000000000521', '00000000-0000-4000-8000-000000000531', 0.50, 4),
  ('00000000-0000-4000-8000-000000000542', '00000000-0000-4000-8000-000000000521', '00000000-0000-4000-8000-000000000532', 0.50, 4),
  ('00000000-0000-4000-8000-000000000543', '00000000-0000-4000-8000-000000000521', '00000000-0000-4000-8000-000000000533', 0.30, 3),
  ('00000000-0000-4000-8000-000000000544', '00000000-0000-4000-8000-000000000522', '00000000-0000-4000-8000-000000000534', 0.50, 3),
  ('00000000-0000-4000-8000-000000000545', '00000000-0000-4000-8000-000000000522', '00000000-0000-4000-8000-000000000535', 0.50, 3),
  ('00000000-0000-4000-8000-000000000546', '00000000-0000-4000-8000-000000000522', '00000000-0000-4000-8000-000000000536', 0.50, 3);

-- Close the second project last, after its milestone exists.
update public.projects set status = 'completed' where id = '00000000-0000-4000-8000-000000000512';

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------
select is(
  (
    select count(*)::int
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'milestones'
      and c.column_name in ('kpi_schedule', 'kpi_budget', 'kpi_quality', 'kpi_risk')
      and c.data_type = 'smallint'
      and c.is_nullable = 'YES'
  ),
  4,
  'milestones has four nullable smallint KPI score columns'
);
select ok(
  not has_function_privilege('anon', 'public.milestone_payout_summary(uuid)', 'execute'),
  'anon cannot execute milestone_payout_summary'
);
select ok(
  not has_function_privilege('anon', 'public.milestone_payout_lines(uuid)', 'execute'),
  'anon cannot execute milestone_payout_lines'
);
select ok(
  not has_function_privilege('anon', 'public.kpi_multiplier(smallint, smallint, smallint, smallint)', 'execute'),
  'anon cannot execute kpi_multiplier'
);
select ok(
  has_function_privilege('authenticated', 'public.milestone_payout_summary(uuid)', 'execute'),
  'authenticated can execute milestone_payout_summary'
);
select ok(
  not has_function_privilege('anon', 'public.capped_payout_pool(numeric, numeric)', 'execute')
    and has_function_privilege('authenticated', 'public.capped_payout_pool(numeric, numeric)', 'execute'),
  'capped_payout_pool is executable by authenticated, not anon'
);
select ok(
  not has_function_privilege('authenticated', 'public.milestones_check_scores()', 'execute'),
  'authenticated cannot execute the milestones_check_scores trigger function'
);

-- ---------------------------------------------------------------------------
-- Supervisor A: the multiplier
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000502"}';

select is(
  public.kpi_multiplier(80::smallint, 90::smallint, 85::smallint, 60::smallint),
  1.1875::numeric,
  'scores 80/90/85/60 give M = 1.1875'
);
select is(
  public.kpi_multiplier(0::smallint, 0::smallint, 0::smallint, 0::smallint),
  0.70::numeric,
  'scores 0/0/0/0 give M = multiplier_min 0.70'
);
select is(
  public.kpi_multiplier(100::smallint, 100::smallint, 100::smallint, 100::smallint),
  1.30::numeric,
  'scores 100/100/100/100 give M = multiplier_max 1.30'
);
select ok(
  public.kpi_multiplier(80::smallint, 90::smallint, 85::smallint, 90::smallint)
    > public.kpi_multiplier(80::smallint, 90::smallint, 85::smallint, 60::smallint),
  'Ryzyko higher = better: raising only the risk score raises M'
);
select ok(
  public.kpi_multiplier(80::smallint, 90::smallint, 85::smallint, null) is null,
  'kpi_multiplier is null when any score is missing'
);
select is(
  public.capped_payout_pool(10000.00, 1.1875),
  9134.61::numeric,
  'capped_payout_pool floors target x M / max to the grosz (10000.00 x 1.1875 / 1.30 = 9134.61)'
);
select ok(
  public.capped_payout_pool(10000.00, null) is null,
  'capped_payout_pool is null while unscored'
);

-- ---------------------------------------------------------------------------
-- Supervisor A: unscored state of the worked-example milestone
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select employee_name, weighted_contribution, bonus
     from public.milestone_payout_lines('00000000-0000-4000-8000-000000000521') $$,
  $$ values
       ('pgTAP Payouts E1', 0.6875::numeric, null::numeric),
       ('pgTAP Payouts E2', 0.605::numeric, null::numeric),
       ('pgTAP Payouts E3', 0.30::numeric, null::numeric) $$,
  'unscored lines: exact weighted contributions in name order, bonus null'
);
select is(
  (
    select count(*)::int
    from public.milestone_payout_lines('00000000-0000-4000-8000-000000000521')
    where share > 0
  ),
  3,
  'unscored lines still show every share'
);
select results_eq(
  $$ select scored, multiplier, budget_share, payout_pool, payout_total, residual, within_pool, engagement_count
     from public.milestone_payout_summary('00000000-0000-4000-8000-000000000521') $$,
  $$ values (false, null::numeric, null::numeric, null::numeric, null::numeric, null::numeric, null::boolean, 3) $$,
  'unscored summary: scored false, money fields null, 3 engagements'
);

-- ---------------------------------------------------------------------------
-- Supervisor A: the worked example
-- ---------------------------------------------------------------------------
select isnt_empty(
  $$ update public.milestones
     set kpi_schedule = 80, kpi_budget = 90, kpi_quality = 85, kpi_risk = 60
     where id = '00000000-0000-4000-8000-000000000521'
     returning id $$,
  'the owning supervisor can score a milestone'
);
select results_eq(
  $$ select scored, target_pool, multiplier, budget_share, payout_pool, payout_total, residual, within_pool
     from public.milestone_payout_summary('00000000-0000-4000-8000-000000000521') $$,
  $$ values (true, 10000.00::numeric, 1.1875::numeric, 0.913462::numeric, 9134.61::numeric, 9134.60::numeric, 0.01::numeric, true) $$,
  'worked example summary: M 1.1875, share 0.913462, pool 9134.61, total 9134.60, residual 0.01, within pool'
);
select ok(
  (
    select budget_share = round(multiplier / 1.30, 6) and payout_pool <= target_pool
    from public.milestone_payout_summary('00000000-0000-4000-8000-000000000521')
  ),
  'worked example: budget_share equals M / multiplier_max and the payout pool stays within the target pool'
);
select results_eq(
  $$ select employee_name, bonus
     from public.milestone_payout_lines('00000000-0000-4000-8000-000000000521') $$,
  $$ values
       ('pgTAP Payouts E1', 3943.51::numeric),
       ('pgTAP Payouts E2', 3470.29::numeric),
       ('pgTAP Payouts E3', 1720.80::numeric) $$,
  'worked example bonuses: 3943.51 / 3470.29 / 1720.80'
);
select results_eq(
  $$ select role_weight, rating_factor
     from public.milestone_payout_lines('00000000-0000-4000-8000-000000000521') $$,
  $$ values (1.25::numeric, 1.10::numeric), (1.10::numeric, 1.10::numeric), (1.00::numeric, 1.00::numeric) $$,
  'lines resolve the role weight and the rating factor from the current config'
);

-- The multiplier scales the pool; it is not cancelled out by the proportional split.
update public.milestones
set kpi_schedule = 0, kpi_budget = 0, kpi_quality = 0, kpi_risk = 0
where id = '00000000-0000-4000-8000-000000000521';

select results_eq(
  $$ select multiplier, budget_share, payout_pool, payout_total, residual
     from public.milestone_payout_summary('00000000-0000-4000-8000-000000000521') $$,
  $$ values (0.70::numeric, 0.538462::numeric, 5384.61::numeric, 5384.59::numeric, 0.02::numeric) $$,
  'scored 0/0/0/0 the same engagements share a 5384.61 pool (total 5384.59, residual 0.02)'
);
select results_eq(
  $$ select bonus
     from public.milestone_payout_lines('00000000-0000-4000-8000-000000000521') $$,
  $$ values (2324.59::numeric), (2045.64::numeric), (1014.36::numeric) $$,
  'scored 0/0/0/0 every bonus is lower than in the worked example'
);
select ok(
  (select payout_pool <= target_pool from public.milestone_payout_summary('00000000-0000-4000-8000-000000000521')),
  'scored 0/0/0/0 the payout pool stays within the target pool'
);

update public.milestones
set kpi_schedule = 100, kpi_budget = 100, kpi_quality = 100, kpi_risk = 100
where id = '00000000-0000-4000-8000-000000000521';

select results_eq(
  $$ select multiplier, budget_share, payout_pool, payout_total, residual, within_pool
     from public.milestone_payout_summary('00000000-0000-4000-8000-000000000521') $$,
  $$ values (1.30::numeric, 1::numeric, 10000.00::numeric, 9999.99::numeric, 0.01::numeric, true) $$,
  'scored 100/100/100/100: M 1.30, share 1, pool 10000.00, total 9999.99, residual 0.01'
);
select ok(
  (
    select multiplier > 1 and payout_pool = target_pool
    from public.milestone_payout_summary('00000000-0000-4000-8000-000000000521')
  ),
  'at M = multiplier_max the payout pool equals the target pool exactly, never more'
);
select results_eq(
  $$ select bonus
     from public.milestone_payout_lines('00000000-0000-4000-8000-000000000521') $$,
  $$ values (4317.11::numeric), (3799.05::numeric), (1883.83::numeric) $$,
  'scored 100/100/100/100 bonuses: 4317.11 / 3799.05 / 1883.83'
);

update public.milestones
set kpi_schedule = 80, kpi_budget = 90, kpi_quality = 85, kpi_risk = 90
where id = '00000000-0000-4000-8000-000000000521';

select results_eq(
  $$ select multiplier, payout_pool, payout_total, residual
     from public.milestone_payout_summary('00000000-0000-4000-8000-000000000521') $$,
  $$ values (1.2145::numeric, 9342.30::numeric, 9342.29::numeric, 0.01::numeric) $$,
  'raising only Ryzyko from 60 to 90 raises M (1.1875 -> 1.2145) and the pool (9134.61 -> 9342.30)'
);
select results_eq(
  $$ select bonus
     from public.milestone_payout_lines('00000000-0000-4000-8000-000000000521') $$,
  $$ values (4033.17::numeric), (3549.19::numeric), (1759.93::numeric) $$,
  'scored 80/90/85/90 bonuses: 4033.17 / 3549.19 / 1759.93'
);
select ok(
  (select payout_pool <= target_pool from public.milestone_payout_summary('00000000-0000-4000-8000-000000000521')),
  'scored 80/90/85/90 the payout pool stays within the target pool'
);

-- ---------------------------------------------------------------------------
-- Supervisor A: exact floor and the empty milestone (scored 100s, so the pool is the whole target)
-- ---------------------------------------------------------------------------
update public.milestones
set kpi_schedule = 100, kpi_budget = 100, kpi_quality = 100, kpi_risk = 100
where id in ('00000000-0000-4000-8000-000000000522', '00000000-0000-4000-8000-000000000523');

select results_eq(
  $$ select multiplier, payout_pool, payout_total, residual, within_pool
     from public.milestone_payout_summary('00000000-0000-4000-8000-000000000522') $$,
  $$ values (1.30::numeric, 100.00::numeric, 99.99::numeric, 0.01::numeric, true) $$,
  'three equal shares of a 100.00 pool: total 99.99, residual 0.01'
);
select results_eq(
  $$ select bonus
     from public.milestone_payout_lines('00000000-0000-4000-8000-000000000522') $$,
  $$ values (33.33::numeric), (33.33::numeric), (33.33::numeric) $$,
  'three equal shares of a 100.00 pool are floored to 33.33 each'
);
select results_eq(
  $$ select scored, payout_pool, payout_total, residual, within_pool, engagement_count
     from public.milestone_payout_summary('00000000-0000-4000-8000-000000000523') $$,
  $$ values (true, 1000.00::numeric, 0::numeric, 1000.00::numeric, true, 0) $$,
  'scored milestone with no engagements: total 0, residual = payout pool'
);
select is_empty(
  $$ select engagement_id from public.milestone_payout_lines('00000000-0000-4000-8000-000000000523') $$,
  'scored milestone with no engagements has no lines'
);

-- ---------------------------------------------------------------------------
-- Supervisor A: constraints and guards
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.milestones set kpi_schedule = 101 where id = '00000000-0000-4000-8000-000000000521' $$,
  '23514',
  null,
  'a score of 101 is rejected'
);
select throws_ok(
  $$ update public.milestones set kpi_risk = -1 where id = '00000000-0000-4000-8000-000000000521' $$,
  '23514',
  null,
  'a score of -1 is rejected'
);
select throws_ok(
  $$ update public.milestones set kpi_schedule = 50 where id = '00000000-0000-4000-8000-000000000525' $$,
  '23514',
  null,
  'setting only one score is rejected (all or none)'
);
select throws_ok(
  $$ update public.milestones set kpi_risk = null where id = '00000000-0000-4000-8000-000000000521' $$,
  '23514',
  null,
  'clearing only one score is rejected (all or none)'
);
select throws_ok(
  $$ update public.milestones
     set kpi_schedule = 50, kpi_budget = 50, kpi_quality = 50, kpi_risk = 50
     where id = '00000000-0000-4000-8000-000000000524' $$,
  'MR013',
  null,
  'scoring a cancelled milestone raises MR013'
);
select throws_ok(
  $$ insert into public.milestones (project_id, name, start_date, end_date, status, target_pool,
                                    kpi_schedule, kpi_budget, kpi_quality, kpi_risk)
     values ('00000000-0000-4000-8000-000000000511', 'pgTAP P Cancelled Scored', '2026-12-01', '2026-12-31',
             'cancelled', 100.00, 50, 50, 50, 50) $$,
  'MR013',
  null,
  'inserting a cancelled milestone with scores raises MR013'
);
select throws_ok(
  $$ update public.milestones
     set kpi_schedule = 50, kpi_budget = 50, kpi_quality = 50, kpi_risk = 50
     where id = '00000000-0000-4000-8000-000000000526' $$,
  'MR003',
  null,
  'scoring a milestone of a completed project raises MR003'
);

-- ---------------------------------------------------------------------------
-- Supervisor B: cannot see, score or probe A's milestones
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000503"}';

select is_empty(
  $$ update public.milestones
     set kpi_schedule = 10, kpi_budget = 10, kpi_quality = 10, kpi_risk = 10
     where id = '00000000-0000-4000-8000-000000000521'
     returning id $$,
  'supervisor B scoring A''s milestone affects 0 rows'
);
select throws_ok(
  $$ insert into public.milestones (project_id, name, start_date, end_date, status, target_pool,
                                    kpi_schedule, kpi_budget, kpi_quality, kpi_risk)
     values ('00000000-0000-4000-8000-000000000511', 'pgTAP P B probe', '2026-12-01', '2026-12-31',
             'cancelled', 100.00, 50, 50, 50, 50) $$,
  '42501',
  null,
  'supervisor B inserting a scored cancelled milestone into A''s project gets 42501, not MR013'
);
select is_empty(
  $$ select milestone_id from public.milestone_payout_summary('00000000-0000-4000-8000-000000000521') $$,
  'supervisor B gets no summary row for A''s milestone'
);
select is_empty(
  $$ select engagement_id from public.milestone_payout_lines('00000000-0000-4000-8000-000000000521') $$,
  'supervisor B gets no lines for A''s milestone'
);

-- ---------------------------------------------------------------------------
-- Admin: reads the figures, never scores
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000504"}';

select results_eq(
  $$ select multiplier, payout_pool
     from public.milestone_payout_summary('00000000-0000-4000-8000-000000000521') $$,
  $$ values (1.2145::numeric, 9342.30::numeric) $$,
  'admin reads the summary of any milestone'
);
select is(
  (select count(*)::int from public.milestone_payout_lines('00000000-0000-4000-8000-000000000521')),
  3,
  'admin reads the lines of any milestone'
);
select is_empty(
  $$ update public.milestones
     set kpi_schedule = 10, kpi_budget = 10, kpi_quality = 10, kpi_risk = 10
     where id = '00000000-0000-4000-8000-000000000521'
     returning id $$,
  'admin scoring a milestone affects 0 rows'
);

-- ---------------------------------------------------------------------------
-- Employee: sees nothing
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000501"}';

select is_empty(
  $$ select milestone_id from public.milestone_payout_summary('00000000-0000-4000-8000-000000000521') $$,
  'employee gets no summary row'
);
select is_empty(
  $$ select engagement_id from public.milestone_payout_lines('00000000-0000-4000-8000-000000000521') $$,
  'employee gets no lines'
);
select ok(
  public.kpi_multiplier(80::smallint, 90::smallint, 85::smallint, 60::smallint) is null,
  'employee gets a null multiplier (no access to bonus_settings)'
);

-- ---------------------------------------------------------------------------
-- Owner: B and the admin changed nothing
-- ---------------------------------------------------------------------------
reset role;

select results_eq(
  $$ select kpi_schedule, kpi_budget, kpi_quality, kpi_risk
     from public.milestones
     where id = '00000000-0000-4000-8000-000000000521' $$,
  $$ values (80::smallint, 90::smallint, 85::smallint, 90::smallint) $$,
  'the worked-example scores are unchanged by supervisor B and the admin'
);

-- ---------------------------------------------------------------------------
-- Anonymous (anon cannot execute the payout functions at all)
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{}';

select throws_ok(
  $$ select * from public.milestone_payout_summary('00000000-0000-4000-8000-000000000521') $$,
  '42501',
  null,
  'anon cannot execute milestone_payout_summary'
);

reset role;

-- ---------------------------------------------------------------------------
-- No silent shrinking: when the owner cannot resolve one engagement's role weight, the split
-- raises instead of dividing the pool among the remaining people. A restrictive policy (rolled
-- back with everything else) hides the Specialist job role from authenticated callers.
-- ---------------------------------------------------------------------------
create policy pgtap_hide_specialist_role
  on public.job_roles
  as restrictive
  for select
  to authenticated
  using (id <> '00000000-0000-4000-8000-000000000508');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000502"}';

select throws_ok(
  $$ select * from public.milestone_payout_lines('00000000-0000-4000-8000-000000000521') $$,
  'P0001',
  null,
  'an engagement with no visible role weight makes the split raise instead of shrinking it'
);

reset role;

select * from finish();

rollback;
