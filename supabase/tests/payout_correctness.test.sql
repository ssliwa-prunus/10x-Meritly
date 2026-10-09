-- pgTAP suite for payout correctness (test-plan.md §3 Phase 2): the payout ceilings and grosz
-- flooring of the live payout functions (public.kpi_multiplier(), public.capped_payout_pool(),
-- public.milestone_payout_lines(), public.milestone_payout_summary()) and of the approval snapshot
-- (public.approve_milestone()), on the boundary cases milestone_payouts.test.sql and
-- milestone_approval.test.sql do not cover. One section per risk of test-plan.md §2:
--   #3  payout ceilings and boundary cases (Σ bonus <= payout pool <= target pool, exact flooring)
--   #4  approval freeze                      (appended by a later phase)
--   #7  supervisor flags                     (appended by a later phase)
--
-- Isolation model: same as profiles_rls.test.sql. Runs against the live local database without
-- a reset, creates its own fixtures in the reserved UUID range 00000000-0000-4000-8000-0000000008xx
-- with emails under @pgtap.test, never asserts absolute row counts (everything is scoped to
-- fixture milestones), and rolls everything back at the end. bonus_settings is a global singleton:
-- each section sets it explicitly as the owner at its top, and the expected figures never depend on
-- the seeded defaults. The suite uses its own job roles.
--
-- Oracle rule. Every expected literal is derived by hand from PRD Business Logic
-- (context/foundation/prd.md, "Business Logic") and the linear KPI -> M mapping, in integer grosze,
-- with the derivation in a comment above its assertion. Never computed by calling the function
-- under test.
--   M        = min + (w_S*S + w_B*B + w_Q*Q + w_R*R) * 0.01 * (max - min)
--   pool     = floor_0.01(target * M / max)
--   e_i      = time_share_i * role_weight_i * rating_factor_i
--   bonus_i  = floor_0.01(pool * e_i / Σe)
--   residual = pool - Σ bonus_i
-- In integer grosze with e scaled to integers (each input has 2 decimals, so x100 each):
--   e_scaled_i = (time_share*100) * (role_weight*100) * (rating_factor*100)
--   bonus_i    = floor(pool_grosze * e_scaled_i / Σ e_scaled) grosze
--
-- Fixture map (UUIDs 00000000-0000-4000-8000-0000000008xx; hex ids such as ...08a0-...08ff are
-- still inside the range and are left for later sections if the decimal ids run out):
--   users        ...0801 Supervisor SP   ...0802 Admin AP   ...0803 second Supervisor SQ
--                ...0804-...0809 free for later sections (e.g. a linked employee account)
--   projects     ...0810-...0819   #3: ...0811 SP's (active)
--   milestones   ...0820-...0829   #3: ...0821-...0826 (one per case, all in ...0811)
--   employees    ...0830-...0839   #3: ...0831-...0837 S1-S7 (Standard 1.00)
--                                      ...0838 Hi (Max 3.00)   ...0839 Lo (Min 0.01)   (all SP's)
--   engagements  ...0840-...0849   free for later sections
--   job roles    ...0850-...0859   #3: ...0851 Standard 1.00   ...0852 Max 3.00   ...0853 Min 0.01
--   engagements  ...0860-...0899   #3: ...0860-...0881 (listed per milestone below);
--                                      ...0882-...0899 free for later sections
--
-- Run with: npx supabase test db

begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

-- ---------------------------------------------------------------------------
-- Shared fixtures (as the table owner; auth.uid() is null, so supervisor_id is explicit)
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000801', 'authenticated', 'authenticated', 'payout-correctness-sp@pgtap.test', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000802', 'authenticated', 'authenticated', 'payout-correctness-ap@pgtap.test', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000803', 'authenticated', 'authenticated', 'payout-correctness-sq@pgtap.test', '{}', now(), now());

update public.profiles set role = 'supervisor'
where id in ('00000000-0000-4000-8000-000000000801', '00000000-0000-4000-8000-000000000803');
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-000000000802';

-- ===========================================================================
-- #3 Payout ceilings and boundary cases
--
-- Config C1 (set here as the owner): KPI weights 0.25 each, multiplier_min 0.50,
-- multiplier_max 2.00. Rating -> factor mapping, used by C1 and C1' alike:
--   rating 1 -> 0.01   rating 2 -> 0.50   rating 3 -> 1.00   rating 4 -> 1.50   rating 5 -> 3.00
-- (non-decreasing, each in (0, 3]). Identical-engagement cases use rating 3; the factor cancels.
--
-- Milestones (all in ...0811, active, scored at insert) and engagements:
--   ...0821 Single       target 10000.00         scores 50/50/50/50     ...0860 S1 0.50 r3
--   ...0822 Large min    target 9999999999.99    scores 0/0/0/0         ...0861-...0863 S1-S3 0.50 r3
--   ...0823 Large max    target 9999999999.99    scores 100/100/100/100 ...0864-...0870 S1-S7 0.50 r3
--   ...0824 Residual     target 0.13             scores 100/100/100/100 ...0871-...0877 S1-S7 0.50 r3
--   ...0825 Floor zero   target 100.00           scores 100/100/100/100 ...0878 Hi 1.00 r5
--                                                                       ...0879 Lo 0.01 r1
--                                                                       -> approved below
--   ...0826 Draft C1'    target 10000.00         scores 100/50/0/0      ...0880 S1 0.50 r3
--                                                                       ...0881 S2 0.50 r4
-- ===========================================================================
update public.bonus_settings
set
  kpi_weight_schedule = 0.25,
  kpi_weight_budget = 0.25,
  kpi_weight_quality = 0.25,
  kpi_weight_risk = 0.25,
  multiplier_min = 0.50,
  multiplier_max = 2.00,
  rating_factor_1 = 0.01,
  rating_factor_2 = 0.50,
  rating_factor_3 = 1.00,
  rating_factor_4 = 1.50,
  rating_factor_5 = 3.00
where id;

insert into public.job_roles (id, name, weight)
values
  ('00000000-0000-4000-8000-000000000851', 'pgTAP PC Standard', 1.00),
  ('00000000-0000-4000-8000-000000000852', 'pgTAP PC Max', 3.00),
  ('00000000-0000-4000-8000-000000000853', 'pgTAP PC Min', 0.01);

insert into public.projects (id, name, start_date, end_date, status, total_budget, supervisor_id)
values
  ('00000000-0000-4000-8000-000000000811', 'pgTAP PC Project Ceilings', '2026-01-01', '2026-12-31', 'active', 100000.00, '00000000-0000-4000-8000-000000000801');

insert into public.milestones (
  id, project_id, name, start_date, end_date, status, target_pool,
  kpi_schedule, kpi_budget, kpi_quality, kpi_risk
)
values
  ('00000000-0000-4000-8000-000000000821', '00000000-0000-4000-8000-000000000811', 'pgTAP PC Single', '2026-01-01', '2026-01-31', 'active', 10000.00, 50, 50, 50, 50),
  ('00000000-0000-4000-8000-000000000822', '00000000-0000-4000-8000-000000000811', 'pgTAP PC Large min', '2026-02-01', '2026-02-28', 'active', 9999999999.99, 0, 0, 0, 0),
  ('00000000-0000-4000-8000-000000000823', '00000000-0000-4000-8000-000000000811', 'pgTAP PC Large max', '2026-03-01', '2026-03-31', 'active', 9999999999.99, 100, 100, 100, 100),
  ('00000000-0000-4000-8000-000000000824', '00000000-0000-4000-8000-000000000811', 'pgTAP PC Residual', '2026-04-01', '2026-04-30', 'active', 0.13, 100, 100, 100, 100),
  ('00000000-0000-4000-8000-000000000825', '00000000-0000-4000-8000-000000000811', 'pgTAP PC Floor zero', '2026-05-01', '2026-05-31', 'active', 100.00, 100, 100, 100, 100),
  ('00000000-0000-4000-8000-000000000826', '00000000-0000-4000-8000-000000000811', 'pgTAP PC Draft C1 prime', '2026-06-01', '2026-06-30', 'active', 10000.00, 100, 50, 0, 0);

insert into public.employees (id, supervisor_id, full_name, email, job_role_id)
values
  ('00000000-0000-4000-8000-000000000831', '00000000-0000-4000-8000-000000000801', 'pgTAP PC S1', 'pc-s1@pgtap.test', '00000000-0000-4000-8000-000000000851'),
  ('00000000-0000-4000-8000-000000000832', '00000000-0000-4000-8000-000000000801', 'pgTAP PC S2', 'pc-s2@pgtap.test', '00000000-0000-4000-8000-000000000851'),
  ('00000000-0000-4000-8000-000000000833', '00000000-0000-4000-8000-000000000801', 'pgTAP PC S3', 'pc-s3@pgtap.test', '00000000-0000-4000-8000-000000000851'),
  ('00000000-0000-4000-8000-000000000834', '00000000-0000-4000-8000-000000000801', 'pgTAP PC S4', 'pc-s4@pgtap.test', '00000000-0000-4000-8000-000000000851'),
  ('00000000-0000-4000-8000-000000000835', '00000000-0000-4000-8000-000000000801', 'pgTAP PC S5', 'pc-s5@pgtap.test', '00000000-0000-4000-8000-000000000851'),
  ('00000000-0000-4000-8000-000000000836', '00000000-0000-4000-8000-000000000801', 'pgTAP PC S6', 'pc-s6@pgtap.test', '00000000-0000-4000-8000-000000000851'),
  ('00000000-0000-4000-8000-000000000837', '00000000-0000-4000-8000-000000000801', 'pgTAP PC S7', 'pc-s7@pgtap.test', '00000000-0000-4000-8000-000000000851'),
  ('00000000-0000-4000-8000-000000000838', '00000000-0000-4000-8000-000000000801', 'pgTAP PC Hi', 'pc-hi@pgtap.test', '00000000-0000-4000-8000-000000000852'),
  ('00000000-0000-4000-8000-000000000839', '00000000-0000-4000-8000-000000000801', 'pgTAP PC Lo', 'pc-lo@pgtap.test', '00000000-0000-4000-8000-000000000853');

insert into public.milestone_engagements (id, milestone_id, employee_id, time_share, rating)
values
  -- ...0821 Single
  ('00000000-0000-4000-8000-000000000860', '00000000-0000-4000-8000-000000000821', '00000000-0000-4000-8000-000000000831', 0.50, 3),
  -- ...0822 Large min
  ('00000000-0000-4000-8000-000000000861', '00000000-0000-4000-8000-000000000822', '00000000-0000-4000-8000-000000000831', 0.50, 3),
  ('00000000-0000-4000-8000-000000000862', '00000000-0000-4000-8000-000000000822', '00000000-0000-4000-8000-000000000832', 0.50, 3),
  ('00000000-0000-4000-8000-000000000863', '00000000-0000-4000-8000-000000000822', '00000000-0000-4000-8000-000000000833', 0.50, 3),
  -- ...0823 Large max
  ('00000000-0000-4000-8000-000000000864', '00000000-0000-4000-8000-000000000823', '00000000-0000-4000-8000-000000000831', 0.50, 3),
  ('00000000-0000-4000-8000-000000000865', '00000000-0000-4000-8000-000000000823', '00000000-0000-4000-8000-000000000832', 0.50, 3),
  ('00000000-0000-4000-8000-000000000866', '00000000-0000-4000-8000-000000000823', '00000000-0000-4000-8000-000000000833', 0.50, 3),
  ('00000000-0000-4000-8000-000000000867', '00000000-0000-4000-8000-000000000823', '00000000-0000-4000-8000-000000000834', 0.50, 3),
  ('00000000-0000-4000-8000-000000000868', '00000000-0000-4000-8000-000000000823', '00000000-0000-4000-8000-000000000835', 0.50, 3),
  ('00000000-0000-4000-8000-000000000869', '00000000-0000-4000-8000-000000000823', '00000000-0000-4000-8000-000000000836', 0.50, 3),
  ('00000000-0000-4000-8000-000000000870', '00000000-0000-4000-8000-000000000823', '00000000-0000-4000-8000-000000000837', 0.50, 3),
  -- ...0824 Residual
  ('00000000-0000-4000-8000-000000000871', '00000000-0000-4000-8000-000000000824', '00000000-0000-4000-8000-000000000831', 0.50, 3),
  ('00000000-0000-4000-8000-000000000872', '00000000-0000-4000-8000-000000000824', '00000000-0000-4000-8000-000000000832', 0.50, 3),
  ('00000000-0000-4000-8000-000000000873', '00000000-0000-4000-8000-000000000824', '00000000-0000-4000-8000-000000000833', 0.50, 3),
  ('00000000-0000-4000-8000-000000000874', '00000000-0000-4000-8000-000000000824', '00000000-0000-4000-8000-000000000834', 0.50, 3),
  ('00000000-0000-4000-8000-000000000875', '00000000-0000-4000-8000-000000000824', '00000000-0000-4000-8000-000000000835', 0.50, 3),
  ('00000000-0000-4000-8000-000000000876', '00000000-0000-4000-8000-000000000824', '00000000-0000-4000-8000-000000000836', 0.50, 3),
  ('00000000-0000-4000-8000-000000000877', '00000000-0000-4000-8000-000000000824', '00000000-0000-4000-8000-000000000837', 0.50, 3),
  -- ...0825 Floor zero: Hi = (1.00, Max 3.00, rating 5 -> 3.00), Lo = (0.01, Min 0.01, rating 1 -> 0.01)
  ('00000000-0000-4000-8000-000000000878', '00000000-0000-4000-8000-000000000825', '00000000-0000-4000-8000-000000000838', 1.00, 5),
  ('00000000-0000-4000-8000-000000000879', '00000000-0000-4000-8000-000000000825', '00000000-0000-4000-8000-000000000839', 0.01, 1),
  -- ...0826 Draft C1': identical except the factor (rating 3 -> 1.00, rating 4 -> 1.50)
  ('00000000-0000-4000-8000-000000000880', '00000000-0000-4000-8000-000000000826', '00000000-0000-4000-8000-000000000831', 0.50, 3),
  ('00000000-0000-4000-8000-000000000881', '00000000-0000-4000-8000-000000000826', '00000000-0000-4000-8000-000000000832', 0.50, 4);

-- ---------------------------------------------------------------------------
-- #3 Supervisor SP under C1: the payout-pool rule on its own (capped_payout_pool)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000801"}';

-- 10000.00 x 1.25 / 2.00 = 6250.00 exactly (1 000 000 gr x 1.25 / 2 = 625 000 gr).
select is(
  public.capped_payout_pool(10000.00, 1.25),
  6250.00::numeric,
  'C1: capped_payout_pool(10000.00, 1.25) = 6250.00'
);
-- 9999999999.99 x 0.50 / 2.00 = 2499999999.9975 -> floor to the grosz 2499999999.99
-- (999 999 999 999 gr / 4 = 249 999 999 999.75 gr -> 249 999 999 999 gr).
select is(
  public.capped_payout_pool(9999999999.99, 0.50),
  2499999999.99::numeric,
  'C1: capped_payout_pool at the numeric(12,2) ceiling and M = min floors to 2499999999.99'
);
-- 9999999999.99 x 2.00 / 2.00 = 9999999999.99: at M = max the pool is exactly the target.
select is(
  public.capped_payout_pool(9999999999.99, 2.00),
  9999999999.99::numeric,
  'C1: capped_payout_pool at the numeric(12,2) ceiling and M = max equals the target pool'
);

-- ---------------------------------------------------------------------------
-- #3 Single employee (...0821)
-- M = 0.50 + (0.25x50 x 4) x 0.01 x 1.50 = 0.50 + 0.50 x 1.50 = 1.25
-- pool = floor(10000.00 x 1.25 / 2.00) = 6250.00 (625 000 gr)
-- one line: e_scaled / Σ e_scaled = 1, so bonus = 625 000 gr = 6250.00; residual 0.00
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select scored, target_pool, multiplier, payout_pool, payout_total, residual, within_pool, engagement_count
     from public.milestone_payout_summary('00000000-0000-4000-8000-000000000821') $$,
  $$ values (true, 10000.00::numeric, 1.25::numeric, 6250.00::numeric, 6250.00::numeric, 0.00::numeric, true, 1) $$,
  'single employee summary: M 1.25, pool 6250.00, total 6250.00, residual 0.00, within pool'
);
select results_eq(
  $$ select employee_name, share, bonus
     from public.milestone_payout_lines('00000000-0000-4000-8000-000000000821') $$,
  $$ values ('pgTAP PC S1', 1::numeric, 6250.00::numeric) $$,
  'single employee gets the whole pool: share 1, bonus 6250.00'
);

-- ---------------------------------------------------------------------------
-- #3 Large pool, M = min (...0822)
-- M = 0.50 + 0 = 0.50 (all scores 0)
-- pool = floor(9999999999.99 x 0.50 / 2.00) = floor(2499999999.9975) = 2499999999.99
--        (249 999 999 999 gr)
-- 3 identical lines (each e_scaled = 50 x 100 x 100 = 500 000): bonus = floor(249 999 999 999 / 3)
--   = 83 333 333 333 gr = 833333333.33 (3 x 83 333 333 333 = 249 999 999 999, so residual 0.00)
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select scored, target_pool, multiplier, payout_pool, payout_total, residual, within_pool, engagement_count
     from public.milestone_payout_summary('00000000-0000-4000-8000-000000000822') $$,
  $$ values (true, 9999999999.99::numeric, 0.50::numeric, 2499999999.99::numeric, 2499999999.99::numeric,
             0.00::numeric, true, 3) $$,
  'large pool at M = min: pool 2499999999.99, total 2499999999.99, residual 0.00'
);
select results_eq(
  $$ select employee_name, bonus
     from public.milestone_payout_lines('00000000-0000-4000-8000-000000000822') $$,
  $$ values
       ('pgTAP PC S1', 833333333.33::numeric),
       ('pgTAP PC S2', 833333333.33::numeric),
       ('pgTAP PC S3', 833333333.33::numeric) $$,
  'large pool at M = min: three identical bonuses of 833333333.33'
);

-- ---------------------------------------------------------------------------
-- #3 Large pool, M = max (...0823)
-- M = 0.50 + (0.25x100 x 4) x 0.01 x 1.50 = 0.50 + 1.50 = 2.00 = max
-- pool = floor(9999999999.99 x 2.00 / 2.00) = 9999999999.99 = target (999 999 999 999 gr)
-- 7 identical lines: bonus = floor(999 999 999 999 / 7) = 142 857 142 857 gr = 1428571428.57
--   (7 x 142 857 142 857 = 999 999 999 999, so residual 0.00)
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select scored, target_pool, multiplier, payout_pool, payout_total, residual, within_pool, engagement_count
     from public.milestone_payout_summary('00000000-0000-4000-8000-000000000823') $$,
  $$ values (true, 9999999999.99::numeric, 2.00::numeric, 9999999999.99::numeric, 9999999999.99::numeric,
             0.00::numeric, true, 7) $$,
  'large pool at M = max: pool = target = 9999999999.99, total 9999999999.99, residual 0.00'
);
select results_eq(
  $$ select employee_name, bonus
     from public.milestone_payout_lines('00000000-0000-4000-8000-000000000823') $$,
  $$ values
       ('pgTAP PC S1', 1428571428.57::numeric),
       ('pgTAP PC S2', 1428571428.57::numeric),
       ('pgTAP PC S3', 1428571428.57::numeric),
       ('pgTAP PC S4', 1428571428.57::numeric),
       ('pgTAP PC S5', 1428571428.57::numeric),
       ('pgTAP PC S6', 1428571428.57::numeric),
       ('pgTAP PC S7', 1428571428.57::numeric) $$,
  'large pool at M = max: seven identical bonuses of 1428571428.57'
);

-- ---------------------------------------------------------------------------
-- #3 Residual n - 1 (...0824)
-- M = 2.00 (all scores 100); pool = floor(0.13 x 2.00 / 2.00) = 0.13 (13 gr)
-- 7 identical lines: bonus = floor(13 / 7) = 1 gr = 0.01 each; total 7 gr = 0.07;
-- residual 13 - 7 = 6 gr = 0.06 (the largest residual 7 lines can leave is n - 1 = 6 gr)
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select scored, target_pool, multiplier, payout_pool, payout_total, residual, within_pool, engagement_count
     from public.milestone_payout_summary('00000000-0000-4000-8000-000000000824') $$,
  $$ values (true, 0.13::numeric, 2.00::numeric, 0.13::numeric, 0.07::numeric, 0.06::numeric, true, 7) $$,
  'residual n - 1: pool 0.13, total 0.07, residual 0.06, within pool'
);
select results_eq(
  $$ select employee_name, bonus
     from public.milestone_payout_lines('00000000-0000-4000-8000-000000000824') $$,
  $$ values
       ('pgTAP PC S1', 0.01::numeric),
       ('pgTAP PC S2', 0.01::numeric),
       ('pgTAP PC S3', 0.01::numeric),
       ('pgTAP PC S4', 0.01::numeric),
       ('pgTAP PC S5', 0.01::numeric),
       ('pgTAP PC S6', 0.01::numeric),
       ('pgTAP PC S7', 0.01::numeric) $$,
  'residual n - 1: seven bonuses of 0.01'
);

-- ---------------------------------------------------------------------------
-- #3 Floor to zero (...0825)
-- M = 2.00 (all scores 100); pool = floor(100.00 x 2.00 / 2.00) = 100.00 (10 000 gr)
-- Hi: e_scaled = (1.00x100) x (3.00x100) x (3.00x100) = 100 x 300 x 300 = 9 000 000
-- Lo: e_scaled = (0.01x100) x (0.01x100) x (0.01x100) = 1 x 1 x 1     = 1
-- Σ e_scaled = 9 000 001
-- Hi bonus = floor(10 000 x 9 000 000 / 9 000 001) = floor(9 999.9988...) = 9 999 gr = 99.99
-- Lo bonus = floor(10 000 x 1 / 9 000 001)         = floor(0.0011...)     = 0 gr     = 0.00
-- total 99.99, residual 0.01
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select scored, target_pool, multiplier, payout_pool, payout_total, residual, within_pool, engagement_count
     from public.milestone_payout_summary('00000000-0000-4000-8000-000000000825') $$,
  $$ values (true, 100.00::numeric, 2.00::numeric, 100.00::numeric, 99.99::numeric, 0.01::numeric, true, 2) $$,
  'floor to zero summary: pool 100.00, total 99.99, residual 0.01'
);
select results_eq(
  $$ select employee_name, time_share, role_weight, rating_factor, bonus
     from public.milestone_payout_lines('00000000-0000-4000-8000-000000000825') $$,
  $$ values
       ('pgTAP PC Hi', 1.00::numeric, 3.00::numeric, 3.00::numeric, 99.99::numeric),
       ('pgTAP PC Lo', 0.01::numeric, 0.01::numeric, 0.01::numeric, 0.00::numeric) $$,
  'floor to zero lines: extreme weights and factors resolve; Hi 99.99, Lo floors to 0.00'
);

-- ---------------------------------------------------------------------------
-- #3 Property check over every milestone of this section (...0821-...0826), under whatever config is
-- active: Σ line bonus <= summary payout_pool <= target_pool and payout_total = Σ line bonus. It
-- checks invariants, not literals, so it holds for any valid config. It runs before ...0825 is
-- approved, so it only ever calls the live functions on Draft milestones. count(*) = 6 keeps it
-- from passing vacuously when a milestone is invisible.
-- ---------------------------------------------------------------------------
select ok(
  (
    select bool_and(
        coalesce(l.bonus_total, 0) <= s.payout_pool
        and s.payout_pool <= s.target_pool
        and s.payout_total = coalesce(l.bonus_total, 0)
      )
      and count(*) = 6
    from (
      values
        ('00000000-0000-4000-8000-000000000821'::uuid),
        ('00000000-0000-4000-8000-000000000822'::uuid),
        ('00000000-0000-4000-8000-000000000823'::uuid),
        ('00000000-0000-4000-8000-000000000824'::uuid),
        ('00000000-0000-4000-8000-000000000825'::uuid),
        ('00000000-0000-4000-8000-000000000826'::uuid)
    ) as f (milestone_id)
    cross join lateral public.milestone_payout_summary(f.milestone_id) as s
    cross join lateral (
      select sum(pl.bonus) as bonus_total
      from public.milestone_payout_lines(f.milestone_id) as pl
    ) as l
  ),
  'every #3 milestone: sum of bonuses = payout_total <= payout_pool <= target_pool'
);

-- ---------------------------------------------------------------------------
-- #3 Snapshot accepts a 0.00 bonus: SP approves Floor to zero (...0825) under C1. The snapshot
-- holds the same hand figures as the Draft above (pool 100.00, Hi 99.99, Lo 0.00, total 99.99,
-- residual 0.01) and its CHECKs (bonus >= 0, total <= pool <= target, residual = pool - total)
-- accept them.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.approve_milestone('00000000-0000-4000-8000-000000000825') $$,
  'SP approves the floor-to-zero milestone; the snapshot CHECKs accept a 0.00 bonus'
);
select results_eq(
  $$ select target_pool, payout_pool, payout_total, residual, engagement_count
     from public.milestone_results where milestone_id = '00000000-0000-4000-8000-000000000825' $$,
  $$ values (100.00::numeric, 100.00::numeric, 99.99::numeric, 0.01::numeric, 2) $$,
  'floor-to-zero snapshot header: pool 100.00, total 99.99, residual 0.01'
);
select results_eq(
  $$ select employee_name, bonus
     from public.milestone_result_lines
     where milestone_id = '00000000-0000-4000-8000-000000000825'
     order by employee_name $$,
  $$ values ('pgTAP PC Hi', 99.99::numeric), ('pgTAP PC Lo', 0.00::numeric) $$,
  'floor-to-zero snapshot lines: Hi 99.99, Lo 0.00'
);

-- ---------------------------------------------------------------------------
-- #3 Non-default config in a Draft (...0826). The owner switches the global config to C1':
-- KPI weights 0.40/0.30/0.20/0.10, min 0.50, max 2.00, same rating factors as C1.
-- ---------------------------------------------------------------------------
reset role;
-- Clear the JWT too: reset role keeps SP's claims (the audit trigger would stamp SP as updated_by).
set local request.jwt.claims = '{}';

update public.bonus_settings
set
  kpi_weight_schedule = 0.40,
  kpi_weight_budget = 0.30,
  kpi_weight_quality = 0.20,
  kpi_weight_risk = 0.10,
  multiplier_min = 0.50,
  multiplier_max = 2.00,
  rating_factor_1 = 0.01,
  rating_factor_2 = 0.50,
  rating_factor_3 = 1.00,
  rating_factor_4 = 1.50,
  rating_factor_5 = 3.00
where id;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000801"}';

-- M = 0.50 + (0.40x100 + 0.30x50 + 0.20x0 + 0.10x0) x 0.01 x 1.50 = 0.50 + 0.55 x 1.50 = 1.325
-- pool = floor(10000.00 x 1.325 / 2.00) = 6625.00 (662 500 gr)
-- S1: e_scaled = 50 x 100 x 100 = 500 000;  S2: e_scaled = 50 x 100 x 150 = 750 000;  Σ = 1 250 000
-- S1 bonus = 662 500 x 500 000 / 1 250 000 = 265 000 gr = 2650.00
-- S2 bonus = 662 500 x 750 000 / 1 250 000 = 397 500 gr = 3975.00   (exact; residual 0.00)
select results_eq(
  $$ select scored, target_pool, multiplier, payout_pool, payout_total, residual, within_pool, engagement_count
     from public.milestone_payout_summary('00000000-0000-4000-8000-000000000826') $$,
  $$ values (true, 10000.00::numeric, 1.325::numeric, 6625.00::numeric, 6625.00::numeric, 0.00::numeric, true, 2) $$,
  'C1'' Draft summary: M 1.325, pool 6625.00, total 6625.00, residual 0.00'
);
select results_eq(
  $$ select employee_name, rating_factor, bonus
     from public.milestone_payout_lines('00000000-0000-4000-8000-000000000826') $$,
  $$ values
       ('pgTAP PC S1', 1.00::numeric, 2650.00::numeric),
       ('pgTAP PC S2', 1.50::numeric, 3975.00::numeric) $$,
  'C1'' Draft lines: factors 1.00 / 1.50 give bonuses 2650.00 / 3975.00'
);

reset role;
set local request.jwt.claims = '{}';

-- ===========================================================================
-- End of #3. Later sections (#4, #7) go here, each setting bonus_settings as the owner at its top.
-- ===========================================================================

select * from finish();

rollback;
