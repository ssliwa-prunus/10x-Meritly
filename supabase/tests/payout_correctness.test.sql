-- pgTAP suite for payout correctness (test-plan.md §3 Phase 2): the payout ceilings and grosz
-- flooring of the live payout functions (public.kpi_multiplier(), public.capped_payout_pool(),
-- public.milestone_payout_lines(), public.milestone_payout_summary()) and of the approval snapshot
-- (public.approve_milestone()), on the boundary cases milestone_payouts.test.sql and
-- milestone_approval.test.sql do not cover. One section per risk of test-plan.md §2:
--   #3  payout ceilings and boundary cases (Σ bonus <= payout pool <= target pool, exact flooring)
--   #4  approval freeze                      (Draft follows a config edit, Approved keeps its
--                                             snapshot, live RPCs refuse Approved with MR015)
--   #7  supervisor flags                     (budget exposure and time share at their strict->
--                                             boundaries; closed milestones and closed projects
--                                             leave the time-share total)
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
--                #4: ...0804 employee account of F1 (linked, activated)
--                ...0805-...0809 free for later sections
--   projects     ...0810-...0819   #3: ...0811 SP's (active)   #4: ...0812 SP's (active)
--                                  #7: ...0813 P_b   ...0814 P_c   ...0815 P_t   ...0816 P_tc
--                                      ...0817 P_tk (all SP's)   ...0818 P_q (SQ's)
--                                      ...0819 free for later sections
--   milestones   ...0820-...0829   #3: ...0821-...0826 (one per case, all in ...0811)
--                                  #4: ...0827 A (approved)   ...0828 B (Draft)   (both in ...0812)
--                ...08b0-...08bf   #7: ...08b1-...08b5 budget milestones (listed in the #7 header)
--                ...08c0-...08cf   #7: ...08c1-...08c6 time-share milestones (listed in the #7 header)
--   employees    ...0830-...0839   #3: ...0831-...0837 S1-S7 (Standard 1.00)
--                                      ...0838 Hi (Max 3.00)   ...0839 Lo (Min 0.01)   (all SP's)
--                ...08a0-...08af   #4: ...08a1 F1 (Standard, linked to ...0804, activated)
--                                      ...08a2 F2 (Standard)   (both SP's)
--                ...08d0-...08df   #7: ...08d1-...08d4 T1-T4   ...08d5 B1 (all Standard; T4 starts as
--                                      SQ's and moves to SP, the rest are SP's)
--   engagements  ...0840-...0849   #4: ...0840-...0843 (listed in the #4 header);
--                                  #7: ...0844-...0849 (listed in the #7 header)
--   job roles    ...0850-...0859   #3: ...0851 Standard 1.00   ...0852 Max 3.00   ...0853 Min 0.01
--   engagements  ...0860-...0899   #3: ...0860-...0881 (listed per milestone below);
--                                  #7: ...0882-...0886 (listed in the #7 header);
--                                      ...0887-...0899 free for later sections
--   free         users ...0805-...0809; hex ids ...08a3-...08af, ...08b6-...08bf, ...08c7-...08cf,
--                ...08d6-...08ff
--
-- Run with: npx supabase test db

begin;

create extension if not exists pgtap with schema extensions;

select plan(49);

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
-- #4 Approval freeze
--
-- Config C1' (set here as the owner): KPI weights 0.40/0.30/0.20/0.10, multiplier_min 0.50,
-- multiplier_max 2.00, rating factors r1 0.01, r2 0.50, r3 1.00, r4 1.50, r5 3.00.
-- Config C2 (the owner's edit after A is approved): KPI weights 0.25 each, min 0.50, max 2.00,
-- rating factors r1 0.01, r2 0.50, r3 1.00, r4 3.00, r5 3.00 (r4 raised; still non-decreasing).
--
-- Milestones (both in ...0812, active, scored 100/50/0/0 at insert, target 10000.00) and identical
-- engagements (the "Non-default config" inputs of #3: factors 1.00 and 1.50 under C1'):
--   ...0827 A   ...0840 F1 0.50 r3   ...0841 F2 0.50 r4   -> approved by SP under C1'
--   ...0828 B   ...0842 F1 0.50 r3   ...0843 F2 0.50 r4   -> stays Draft
--
-- Under C1' (same derivation as #3 "Non-default config"):
--   M = 0.50 + (0.40x100 + 0.30x50 + 0.20x0 + 0.10x0) x 0.01 x 1.50 = 0.50 + 0.55 x 1.50 = 1.325
--   pool = floor(10000.00 x 1.325 / 2.00) = 6625.00 (662 500 gr)
--   F1: e_scaled = 50 x 100 x 100 = 500 000;  F2: e_scaled = 50 x 100 x 150 = 750 000;  Σ = 1 250 000
--   F1 bonus = 662 500 x 500 000 / 1 250 000 = 265 000 gr = 2650.00
--   F2 bonus = 662 500 x 750 000 / 1 250 000 = 397 500 gr = 3975.00   (exact; total 6625.00, residual 0.00)
-- Under C2:
--   M = 0.50 + (0.25x100 + 0.25x50 + 0.25x0 + 0.25x0) x 0.01 x 1.50 = 0.50 + 0.375 x 1.50 = 1.0625
--   pool = floor(10000.00 x 1.0625 / 2.00) = floor(5312.50) = 5312.50 (531 250 gr)
--   F1: e_scaled = 50 x 100 x 100 = 500 000;  F2: e_scaled = 50 x 100 x 300 = 1 500 000;  Σ = 2 000 000
--   F1 bonus = floor(531 250 x 500 000 / 2 000 000)   = floor(132 812.5) = 132 812 gr = 1328.12
--   F2 bonus = floor(531 250 x 1 500 000 / 2 000 000) = floor(398 437.5) = 398 437 gr = 3984.37
--   total 531 249 gr = 5312.49, residual 1 gr = 0.01
-- ===========================================================================
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

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000804', 'authenticated', 'authenticated', 'payout-correctness-f1@pgtap.test', '{}', now(), now());

insert into public.projects (id, name, start_date, end_date, status, total_budget, supervisor_id)
values
  ('00000000-0000-4000-8000-000000000812', 'pgTAP PC Project Freeze', '2026-01-01', '2026-12-31', 'active', 100000.00, '00000000-0000-4000-8000-000000000801');

insert into public.milestones (
  id, project_id, name, start_date, end_date, status, target_pool,
  kpi_schedule, kpi_budget, kpi_quality, kpi_risk
)
values
  ('00000000-0000-4000-8000-000000000827', '00000000-0000-4000-8000-000000000812', 'pgTAP PC Freeze A', '2026-01-01', '2026-03-31', 'active', 10000.00, 100, 50, 0, 0),
  ('00000000-0000-4000-8000-000000000828', '00000000-0000-4000-8000-000000000812', 'pgTAP PC Freeze B', '2026-04-01', '2026-06-30', 'active', 10000.00, 100, 50, 0, 0);

-- F1: linked to ...0804 and activated (invite accepted), like milestone_approval's E1. F2: not linked.
insert into public.employees (id, supervisor_id, full_name, email, job_role_id, profile_id, invited_at, activated_at)
values
  ('00000000-0000-4000-8000-0000000008a1', '00000000-0000-4000-8000-000000000801', 'pgTAP PC F1', 'payout-correctness-f1@pgtap.test', '00000000-0000-4000-8000-000000000851', '00000000-0000-4000-8000-000000000804', now(), now());

insert into public.employees (id, supervisor_id, full_name, email, job_role_id)
values
  ('00000000-0000-4000-8000-0000000008a2', '00000000-0000-4000-8000-000000000801', 'pgTAP PC F2', 'pc-f2@pgtap.test', '00000000-0000-4000-8000-000000000851');

insert into public.milestone_engagements (id, milestone_id, employee_id, time_share, rating)
values
  ('00000000-0000-4000-8000-000000000840', '00000000-0000-4000-8000-000000000827', '00000000-0000-4000-8000-0000000008a1', 0.50, 3),
  ('00000000-0000-4000-8000-000000000841', '00000000-0000-4000-8000-000000000827', '00000000-0000-4000-8000-0000000008a2', 0.50, 4),
  ('00000000-0000-4000-8000-000000000842', '00000000-0000-4000-8000-000000000828', '00000000-0000-4000-8000-0000000008a1', 0.50, 3),
  ('00000000-0000-4000-8000-000000000843', '00000000-0000-4000-8000-000000000828', '00000000-0000-4000-8000-0000000008a2', 0.50, 4);

-- ---------------------------------------------------------------------------
-- #4 Before the config edit (C1'), as SP: approve A; A's snapshot and B's live figures agree.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000801"}';

select lives_ok(
  $$ select public.approve_milestone('00000000-0000-4000-8000-000000000827') $$,
  'SP approves freeze milestone A under C1'''
);
-- C1' figures (header comment): M 1.325, multiplier_max 2.00, pool 6625.00, total 6625.00, residual 0.00.
select results_eq(
  $$ select target_pool, multiplier, multiplier_max, payout_pool, payout_total, residual, engagement_count
     from public.milestone_results where milestone_id = '00000000-0000-4000-8000-000000000827' $$,
  $$ values (10000.00::numeric, 1.325::numeric, 2.00::numeric, 6625.00::numeric, 6625.00::numeric, 0.00::numeric, 2) $$,
  'A snapshot header before the edit: M 1.325, pool 6625.00, total 6625.00, residual 0.00'
);
-- C1' lines (header comment): F1 1.00 -> 2650.00, F2 1.50 -> 3975.00.
select results_eq(
  $$ select employee_name, rating_factor, bonus
     from public.milestone_result_lines
     where milestone_id = '00000000-0000-4000-8000-000000000827'
     order by employee_name $$,
  $$ values ('pgTAP PC F1', 1.00::numeric, 2650.00::numeric), ('pgTAP PC F2', 1.50::numeric, 3975.00::numeric) $$,
  'A snapshot lines before the edit: F1 2650.00, F2 3975.00'
);
-- B is Draft with the same inputs, so its live figures are the same C1' figures.
select results_eq(
  $$ select scored, target_pool, multiplier, payout_pool, payout_total, residual, within_pool, engagement_count
     from public.milestone_payout_summary('00000000-0000-4000-8000-000000000828') $$,
  $$ values (true, 10000.00::numeric, 1.325::numeric, 6625.00::numeric, 6625.00::numeric, 0.00::numeric, true, 2) $$,
  'B (Draft) live summary before the edit equals A''s snapshot: pool 6625.00, total 6625.00'
);
select results_eq(
  $$ select employee_name, rating_factor, bonus
     from public.milestone_payout_lines('00000000-0000-4000-8000-000000000828') $$,
  $$ values ('pgTAP PC F1', 1.00::numeric, 2650.00::numeric), ('pgTAP PC F2', 1.50::numeric, 3975.00::numeric) $$,
  'B (Draft) live lines before the edit: F1 2650.00, F2 3975.00'
);

-- ---------------------------------------------------------------------------
-- #4 Config edit as the owner: C1' -> C2 (KPI weights 0.25 each; rating 4 factor 1.50 -> 3.00).
-- ---------------------------------------------------------------------------
reset role;
set local request.jwt.claims = '{}';

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
  rating_factor_4 = 3.00,
  rating_factor_5 = 3.00
where id;

-- ---------------------------------------------------------------------------
-- #4 After the edit, as SP
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000801"}';

-- B (Draft) reflects C2 (header comment): M 1.0625, pool 5312.50, total 5312.49, residual 0.01.
select results_eq(
  $$ select scored, target_pool, multiplier, payout_pool, payout_total, residual, within_pool, engagement_count
     from public.milestone_payout_summary('00000000-0000-4000-8000-000000000828') $$,
  $$ values (true, 10000.00::numeric, 1.0625::numeric, 5312.50::numeric, 5312.49::numeric, 0.01::numeric, true, 2) $$,
  'B (Draft) after the edit reflects C2: M 1.0625, pool 5312.50, total 5312.49, residual 0.01'
);
-- C2 lines (header comment): F1 1.00 -> 1328.12, F2 3.00 -> 3984.37.
select results_eq(
  $$ select employee_name, rating_factor, bonus
     from public.milestone_payout_lines('00000000-0000-4000-8000-000000000828') $$,
  $$ values ('pgTAP PC F1', 1.00::numeric, 1328.12::numeric), ('pgTAP PC F2', 3.00::numeric, 3984.37::numeric) $$,
  'B (Draft) lines after the edit reflect C2: F1 1328.12, F2 3984.37'
);
-- A (Approved) is unchanged: the same C1' literals as before the edit.
select results_eq(
  $$ select target_pool, multiplier, multiplier_max, payout_pool, payout_total, residual, engagement_count
     from public.milestone_results where milestone_id = '00000000-0000-4000-8000-000000000827' $$,
  $$ values (10000.00::numeric, 1.325::numeric, 2.00::numeric, 6625.00::numeric, 6625.00::numeric, 0.00::numeric, 2) $$,
  'A snapshot header after the edit is unchanged: M 1.325, pool 6625.00, total 6625.00, residual 0.00'
);
select results_eq(
  $$ select employee_name, rating_factor, bonus
     from public.milestone_result_lines
     where milestone_id = '00000000-0000-4000-8000-000000000827'
     order by employee_name $$,
  $$ values ('pgTAP PC F1', 1.00::numeric, 2650.00::numeric), ('pgTAP PC F2', 1.50::numeric, 3975.00::numeric) $$,
  'A snapshot lines after the edit are unchanged for SP: F1 2650.00, F2 3975.00'
);
-- The live RPCs refuse to recompute A from the edited config.
select throws_ok(
  $$ select * from public.milestone_payout_lines('00000000-0000-4000-8000-000000000827') $$,
  'MR015',
  null,
  'SP calling milestone_payout_lines on Approved A gets MR015'
);
select throws_ok(
  $$ select * from public.milestone_payout_summary('00000000-0000-4000-8000-000000000827') $$,
  'MR015',
  null,
  'SP calling milestone_payout_summary on Approved A gets MR015'
);
-- A rating-only change on A's engagement is a write on a frozen milestone.
select throws_ok(
  $$ update public.milestone_engagements set rating = 5 where id = '00000000-0000-4000-8000-000000000841' $$,
  'MR007',
  null,
  'SP changing only the rating of an engagement on Approved A gets MR007'
);

-- ---------------------------------------------------------------------------
-- #4 After the edit, as F1 (linked and activated employee on A): own snapshot line unchanged
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000804"}';

select results_eq(
  $$ select employee_name, rating_factor, bonus
     from public.milestone_result_lines
     where milestone_id = '00000000-0000-4000-8000-000000000827' $$,
  $$ values ('pgTAP PC F1', 1.00::numeric, 2650.00::numeric) $$,
  'F1 reads exactly their own A line after the edit, unchanged: 2650.00'
);

-- ---------------------------------------------------------------------------
-- #4 After the edit, as AP (Admin): the live RPCs refuse A too
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000802"}';

select throws_ok(
  $$ select * from public.milestone_payout_lines('00000000-0000-4000-8000-000000000827') $$,
  'MR015',
  null,
  'AP calling milestone_payout_lines on Approved A gets MR015'
);
select throws_ok(
  $$ select * from public.milestone_payout_summary('00000000-0000-4000-8000-000000000827') $$,
  'MR015',
  null,
  'AP calling milestone_payout_summary on Approved A gets MR015'
);

-- ---------------------------------------------------------------------------
-- #4 After the edit, as SQ (foreign Supervisor): A is invisible, so no rows and no MR015 (no leak)
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000803"}';

select is_empty(
  $$ select engagement_id from public.milestone_payout_lines('00000000-0000-4000-8000-000000000827') $$,
  'SQ calling milestone_payout_lines on A gets none (no existence leak)'
);
select is_empty(
  $$ select milestone_id from public.milestone_payout_summary('00000000-0000-4000-8000-000000000827') $$,
  'SQ calling milestone_payout_summary on A gets none (no existence leak)'
);

reset role;
set local request.jwt.claims = '{}';

-- ===========================================================================
-- #7 Supervisor flags at their strict-> boundaries
--
-- Config C1 again (set here as the owner; #4 left C2 active): KPI weights 0.25 each,
-- multiplier_min 0.50, multiplier_max 2.00, rating factors r1 0.01, r2 0.50, r3 1.00, r4 1.50,
-- r5 3.00. So the #3 "Single employee" oracle applies to M1 below: M 1.25, pool 6250.00.
--
-- Budget exposure (project_budget_exposure): reserved_total = Σ over non-cancelled milestones of
-- (approved ? stored payout_pool : target_pool); remaining = total_budget - reserved_total;
-- over_budget = reserved_total > total_budget. Project status is ignored.
--   ...0813 P_b  total_budget 15000.00
--     ...08b1 M1  active, target 10000.00, scores 50/50/50/50, ...0844 B1 0.50 r3 -> approved below
--     ...08b2 M2  active (Draft), target 8750.00
--   ...0814 P_c  total_budget 5000.00 (set to 'completed' below)
--     ...08b3 completed 3000.00   ...08b4 cancelled 9000.00   ...08b5 planned 2000.01
--
-- Time share (employee_time_share_totals): open_total = Σ time_share over engagements whose
-- milestone is not completed/cancelled/approved and (after 20261009130000) whose project is not
-- completed/cancelled; over_allocated = open_total > 1. Employees T1-T4 are fresh (Standard 1.00,
-- all SP's in the end), so their totals depend only on these engagements.
--   ...0815 P_t  (SP, active)     ...08c1 active   ...08c2 planned   ...08c3 active -> cancelled below
--   ...0816 P_tc (SP, active -> cancelled below)   ...08c4 active
--   ...0817 P_tk (SP, active -> completed below)   ...08c5 active
--   ...0818 P_q  (SQ, active)     ...08c6 active
--   engagements (all rating 3):
--     T1 ...08d1: ...0845 @08c1 0.50   ...0846 @08c2 0.50
--     T2 ...08d2: ...0847 @08c2 0.60   ...0848 @08c1 0.41   ...0849 @08c3 0.30 (added, then cancelled)
--     T3 ...08d3: ...0882 @08c1 0.60   ...0883 @08c4 0.50   ...0884 @08c5 0.50
--     T4 ...08d4: ...0886 @08c6 0.60 (SQ's milestone)   ...0885 @08c1 0.60 (SP's milestone)
--   T4 is built like employees_rls.test.sql builds EX: created as SQ's, engaged on SQ's ...08c6,
--   ...08c6 closed while T4 moves to SP (MR008 only counts open milestones), ...08c6 reopened, then
--   engaged on SP's ...08c1 (MR011: employee and project now share the owner SP).
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

insert into public.projects (id, name, start_date, end_date, status, total_budget, supervisor_id)
values
  ('00000000-0000-4000-8000-000000000813', 'pgTAP PC Project Budget Approval', '2026-01-01', '2026-12-31', 'active', 15000.00, '00000000-0000-4000-8000-000000000801'),
  ('00000000-0000-4000-8000-000000000814', 'pgTAP PC Project Budget Mixed', '2026-01-01', '2026-12-31', 'active', 5000.00, '00000000-0000-4000-8000-000000000801'),
  ('00000000-0000-4000-8000-000000000815', 'pgTAP PC Project Time Open', '2026-01-01', '2026-12-31', 'active', 100000.00, '00000000-0000-4000-8000-000000000801'),
  ('00000000-0000-4000-8000-000000000816', 'pgTAP PC Project Time Cancelled', '2026-01-01', '2026-12-31', 'active', 100000.00, '00000000-0000-4000-8000-000000000801'),
  ('00000000-0000-4000-8000-000000000817', 'pgTAP PC Project Time Completed', '2026-01-01', '2026-12-31', 'active', 100000.00, '00000000-0000-4000-8000-000000000801'),
  ('00000000-0000-4000-8000-000000000818', 'pgTAP PC Project Time SQ', '2026-01-01', '2026-12-31', 'active', 100000.00, '00000000-0000-4000-8000-000000000803');

insert into public.milestones (
  id, project_id, name, start_date, end_date, status, target_pool,
  kpi_schedule, kpi_budget, kpi_quality, kpi_risk
)
values
  ('00000000-0000-4000-8000-0000000008b1', '00000000-0000-4000-8000-000000000813', 'pgTAP PC Budget M1', '2026-01-01', '2026-03-31', 'active', 10000.00, 50, 50, 50, 50),
  ('00000000-0000-4000-8000-0000000008b2', '00000000-0000-4000-8000-000000000813', 'pgTAP PC Budget M2', '2026-04-01', '2026-06-30', 'active', 8750.00, null, null, null, null),
  ('00000000-0000-4000-8000-0000000008b3', '00000000-0000-4000-8000-000000000814', 'pgTAP PC Budget completed', '2026-01-01', '2026-03-31', 'completed', 3000.00, null, null, null, null),
  ('00000000-0000-4000-8000-0000000008b4', '00000000-0000-4000-8000-000000000814', 'pgTAP PC Budget cancelled', '2026-04-01', '2026-06-30', 'cancelled', 9000.00, null, null, null, null),
  ('00000000-0000-4000-8000-0000000008b5', '00000000-0000-4000-8000-000000000814', 'pgTAP PC Budget planned', '2026-07-01', '2026-09-30', 'planned', 2000.01, null, null, null, null),
  ('00000000-0000-4000-8000-0000000008c1', '00000000-0000-4000-8000-000000000815', 'pgTAP PC Time active', '2026-01-01', '2026-03-31', 'active', 1000.00, null, null, null, null),
  ('00000000-0000-4000-8000-0000000008c2', '00000000-0000-4000-8000-000000000815', 'pgTAP PC Time planned', '2026-04-01', '2026-06-30', 'planned', 1000.00, null, null, null, null),
  ('00000000-0000-4000-8000-0000000008c3', '00000000-0000-4000-8000-000000000815', 'pgTAP PC Time to cancel', '2026-07-01', '2026-09-30', 'active', 1000.00, null, null, null, null),
  ('00000000-0000-4000-8000-0000000008c4', '00000000-0000-4000-8000-000000000816', 'pgTAP PC Time in cancelled project', '2026-01-01', '2026-03-31', 'active', 1000.00, null, null, null, null),
  ('00000000-0000-4000-8000-0000000008c5', '00000000-0000-4000-8000-000000000817', 'pgTAP PC Time in completed project', '2026-01-01', '2026-03-31', 'active', 1000.00, null, null, null, null),
  ('00000000-0000-4000-8000-0000000008c6', '00000000-0000-4000-8000-000000000818', 'pgTAP PC Time SQ', '2026-01-01', '2026-03-31', 'active', 1000.00, null, null, null, null);

insert into public.employees (id, supervisor_id, full_name, email, job_role_id)
values
  ('00000000-0000-4000-8000-0000000008d1', '00000000-0000-4000-8000-000000000801', 'pgTAP PC T1', 'pc-t1@pgtap.test', '00000000-0000-4000-8000-000000000851'),
  ('00000000-0000-4000-8000-0000000008d2', '00000000-0000-4000-8000-000000000801', 'pgTAP PC T2', 'pc-t2@pgtap.test', '00000000-0000-4000-8000-000000000851'),
  ('00000000-0000-4000-8000-0000000008d3', '00000000-0000-4000-8000-000000000801', 'pgTAP PC T3', 'pc-t3@pgtap.test', '00000000-0000-4000-8000-000000000851'),
  ('00000000-0000-4000-8000-0000000008d4', '00000000-0000-4000-8000-000000000803', 'pgTAP PC T4', 'pc-t4@pgtap.test', '00000000-0000-4000-8000-000000000851'),
  ('00000000-0000-4000-8000-0000000008d5', '00000000-0000-4000-8000-000000000801', 'pgTAP PC B1', 'pc-b1@pgtap.test', '00000000-0000-4000-8000-000000000851');

insert into public.milestone_engagements (id, milestone_id, employee_id, time_share, rating)
values
  -- M1: the "Single employee" inputs (one Standard engagement, 0.50, rating 3)
  ('00000000-0000-4000-8000-000000000844', '00000000-0000-4000-8000-0000000008b1', '00000000-0000-4000-8000-0000000008d5', 0.50, 3),
  -- T1
  ('00000000-0000-4000-8000-000000000845', '00000000-0000-4000-8000-0000000008c1', '00000000-0000-4000-8000-0000000008d1', 0.50, 3),
  ('00000000-0000-4000-8000-000000000846', '00000000-0000-4000-8000-0000000008c2', '00000000-0000-4000-8000-0000000008d1', 0.50, 3),
  -- T2 (the ...08c3 engagement ...0849 is added later)
  ('00000000-0000-4000-8000-000000000847', '00000000-0000-4000-8000-0000000008c2', '00000000-0000-4000-8000-0000000008d2', 0.60, 3),
  ('00000000-0000-4000-8000-000000000848', '00000000-0000-4000-8000-0000000008c1', '00000000-0000-4000-8000-0000000008d2', 0.41, 3),
  -- T3
  ('00000000-0000-4000-8000-000000000882', '00000000-0000-4000-8000-0000000008c1', '00000000-0000-4000-8000-0000000008d3', 0.60, 3),
  ('00000000-0000-4000-8000-000000000883', '00000000-0000-4000-8000-0000000008c4', '00000000-0000-4000-8000-0000000008d3', 0.50, 3),
  ('00000000-0000-4000-8000-000000000884', '00000000-0000-4000-8000-0000000008c5', '00000000-0000-4000-8000-0000000008d3', 0.50, 3),
  -- T4 while still SQ's: on SQ's milestone
  ('00000000-0000-4000-8000-000000000886', '00000000-0000-4000-8000-0000000008c6', '00000000-0000-4000-8000-0000000008d4', 0.60, 3);

-- T4 moves from SQ to SP: SQ's milestone is closed during the move, then reopened.
update public.milestones set status = 'completed' where id = '00000000-0000-4000-8000-0000000008c6';
update public.employees set supervisor_id = '00000000-0000-4000-8000-000000000801'
where id = '00000000-0000-4000-8000-0000000008d4';
update public.milestones set status = 'active' where id = '00000000-0000-4000-8000-0000000008c6';

insert into public.milestone_engagements (id, milestone_id, employee_id, time_share, rating)
values ('00000000-0000-4000-8000-000000000885', '00000000-0000-4000-8000-0000000008c1', '00000000-0000-4000-8000-0000000008d4', 0.60, 3);

-- ---------------------------------------------------------------------------
-- #7 Budget exposure, as SP
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000801"}';

-- P_b before approval: M1 and M2 both reserve their target.
--   reserved = 10000.00 + 8750.00 = 18750.00; remaining = 15000.00 - 18750.00 = -3750.00;
--   18750.00 > 15000.00 -> over_budget true
select results_eq(
  $$ select total_budget, reserved_total, remaining, over_budget
     from public.project_budget_exposure where project_id = '00000000-0000-4000-8000-000000000813' $$,
  $$ values (15000.00::numeric, 18750.00::numeric, -3750.00::numeric, true) $$,
  'P_b before approval: reserved 18750.00 > budget 15000.00, over_budget true'
);
select lives_ok(
  $$ select public.approve_milestone('00000000-0000-4000-8000-0000000008b1') $$,
  'SP approves P_b''s M1 under C1'
);
-- P_b after approving M1: M1 reserves its stored payout pool, M2 still its target.
--   M1 pool (#3 "Single employee" under C1) = floor(10000.00 x 1.25 / 2.00) = 6250.00
--   reserved = 6250.00 + 8750.00 = 15000.00; remaining = 15000.00 - 15000.00 = 0.00;
--   15000.00 > 15000.00 is false -> over_budget false (equality is not over)
select results_eq(
  $$ select total_budget, reserved_total, remaining, over_budget
     from public.project_budget_exposure where project_id = '00000000-0000-4000-8000-000000000813' $$,
  $$ values (15000.00::numeric, 15000.00::numeric, 0.00::numeric, false) $$,
  'P_b after approving M1: reserved 15000.00 = budget, remaining 0.00, over_budget false'
);
-- P_c: completed reserves its target, cancelled reserves nothing, planned reserves its target.
--   reserved = 3000.00 + 2000.01 = 5000.01; remaining = 5000.00 - 5000.01 = -0.01;
--   5000.01 > 5000.00 -> over_budget true (one grosz over)
select results_eq(
  $$ select total_budget, reserved_total, remaining, over_budget
     from public.project_budget_exposure where project_id = '00000000-0000-4000-8000-000000000814' $$,
  $$ values (5000.00::numeric, 5000.01::numeric, -0.01::numeric, true) $$,
  'P_c: completed 3000.00 + planned 2000.01 reserved, cancelled ignored; one grosz over is flagged'
);

reset role;
set local request.jwt.claims = '{}';
update public.projects set status = 'completed' where id = '00000000-0000-4000-8000-000000000814';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000801"}';

-- P_c after the project is completed: project status is ignored, so the same figures
--   (reserved 3000.00 + 2000.01 = 5000.01, remaining -0.01, over_budget true).
select results_eq(
  $$ select total_budget, reserved_total, remaining, over_budget
     from public.project_budget_exposure where project_id = '00000000-0000-4000-8000-000000000814' $$,
  $$ values (5000.00::numeric, 5000.01::numeric, -0.01::numeric, true) $$,
  'P_c after the project is completed still shows its exposure: reserved 5000.01, over_budget true'
);

-- ---------------------------------------------------------------------------
-- #7 Time share, as SP
-- ---------------------------------------------------------------------------
-- T1: 0.50 (...08c1 active) + 0.50 (...08c2 planned) = 1.00; 1.00 > 1 is false.
select results_eq(
  $$ select open_total, over_allocated
     from public.employee_time_share_totals where employee_id = '00000000-0000-4000-8000-0000000008d1' $$,
  $$ values (1.00::numeric, false) $$,
  'T1 at exactly 100% (0.50 + 0.50) is not flagged'
);
-- T2: 0.60 (...08c2 planned) + 0.41 (...08c1 active) = 1.01; 1.01 > 1 is true.
select results_eq(
  $$ select open_total, over_allocated
     from public.employee_time_share_totals where employee_id = '00000000-0000-4000-8000-0000000008d2' $$,
  $$ values (1.01::numeric, true) $$,
  'T2 just over 100% (0.60 planned + 0.41 active = 1.01) is flagged'
);

-- T2 gets 0.30 on ...08c3 while it is open, then ...08c3 is cancelled.
reset role;
set local request.jwt.claims = '{}';
insert into public.milestone_engagements (id, milestone_id, employee_id, time_share, rating)
values ('00000000-0000-4000-8000-000000000849', '00000000-0000-4000-8000-0000000008c3', '00000000-0000-4000-8000-0000000008d2', 0.30, 3);
update public.milestones set status = 'cancelled' where id = '00000000-0000-4000-8000-0000000008c3';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000801"}';

-- T2: the cancelled ...08c3 (0.30) is excluded, so still 0.60 + 0.41 = 1.01, flagged.
select results_eq(
  $$ select open_total, over_allocated
     from public.employee_time_share_totals where employee_id = '00000000-0000-4000-8000-0000000008d2' $$,
  $$ values (1.01::numeric, true) $$,
  'T2 with an extra 0.30 on a cancelled milestone stays at 1.01 (closed milestone excluded)'
);

-- T3 while all three projects are open: 0.60 + 0.50 + 0.50 = 1.60; flagged.
select results_eq(
  $$ select open_total, over_allocated
     from public.employee_time_share_totals where employee_id = '00000000-0000-4000-8000-0000000008d3' $$,
  $$ values (1.60::numeric, true) $$,
  'T3 with all projects open: 0.60 + 0.50 + 0.50 = 1.60, flagged'
);

reset role;
set local request.jwt.claims = '{}';
update public.projects set status = 'cancelled' where id = '00000000-0000-4000-8000-000000000816';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000801"}';

-- T3 after P_tc is cancelled: its active ...08c4 (0.50) no longer counts: 0.60 + 0.50 = 1.10; flagged.
select results_eq(
  $$ select open_total, over_allocated
     from public.employee_time_share_totals where employee_id = '00000000-0000-4000-8000-0000000008d3' $$,
  $$ values (1.10::numeric, true) $$,
  'T3 after one project is cancelled: its active milestone is excluded, 0.60 + 0.50 = 1.10'
);

reset role;
set local request.jwt.claims = '{}';
update public.projects set status = 'completed' where id = '00000000-0000-4000-8000-000000000817';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000801"}';

-- T3 after P_tk is completed too: its active ...08c5 (0.50) no longer counts: 0.60; 0.60 > 1 is false.
select results_eq(
  $$ select open_total, over_allocated
     from public.employee_time_share_totals where employee_id = '00000000-0000-4000-8000-0000000008d3' $$,
  $$ values (0.60::numeric, false) $$,
  'T3 after the other project is completed too: only the open project counts, 0.60, not flagged'
);

-- T4 as SP: only SP's ...08c1 (0.60) is visible; SQ's ...08c6 is not. 0.60 > 1 is false.
-- Accepted tradeoff (research): the flag is per Supervisor, so 0.60 + 0.60 across two flags for neither.
select results_eq(
  $$ select open_total, over_allocated
     from public.employee_time_share_totals where employee_id = '00000000-0000-4000-8000-0000000008d4' $$,
  $$ values (0.60::numeric, false) $$,
  'T4 as SP: only SP''s 0.60 counts, not flagged (cross-Supervisor non-flag, accepted)'
);

-- T4 as AP (Admin sees every engagement): 0.60 (...08c1) + 0.60 (...08c6) = 1.20; flagged.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000802"}';

select results_eq(
  $$ select open_total, over_allocated
     from public.employee_time_share_totals where employee_id = '00000000-0000-4000-8000-0000000008d4' $$,
  $$ values (1.20::numeric, true) $$,
  'T4 as AP: 0.60 + 0.60 across both Supervisors = 1.20, flagged'
);

reset role;
set local request.jwt.claims = '{}';

-- ===========================================================================
-- End of #7.
-- ===========================================================================

select * from finish();

rollback;
