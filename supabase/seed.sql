-- LOCAL DEVELOPMENT / CI ONLY. Never run this against the hosted Supabase project.
--
-- Creates one ready-to-use account per access role, plus a second supervisor to reassign
-- projects to, one sample project with two milestones owned by supervisor@meritly.local, and two
-- employee records owned by that supervisor (one activated and over-allocated at 110%, one not
-- yet invited). Milestone 1 is KPI-scored (computed bonuses show), Milestone 2 is not. A second
-- linked employee and an "Approved Demo Project" with one Approved and one Draft milestone give the
-- smoke test (scripts/smoke.mjs) a real attacker and victim for its HTTP IDOR checks. Recreated
-- on every `npx supabase db reset`.
--
--   admin@meritly.local        role: admin
--   supervisor@meritly.local   role: supervisor  (owns "Local Demo Project", "Approved Demo Project")
--   supervisor2@meritly.local  role: supervisor
--   employee@meritly.local     role: employee
--   employee2@meritly.local    role: employee
--
-- Shared local password for all five: Meritly-Local-Passw0rd!
--
-- Fixed UUIDs use the seed range 00000000-0000-4000-8000-0000000000xx. The pgTAP suites
-- (supabase/tests) use the disjoint ranges 00000000-0000-4000-8000-0000000001xx, ...02xx,
-- ...03xx, ...04xx, ...05xx, ...06xx (approval), ...07xx (RLS matrix) and ...08xx (payout
-- correctness).

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  u.id,
  'authenticated',
  'authenticated',
  u.email,
  extensions.crypt('Meritly-Local-Passw0rd!', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('display_name', u.display_name),
  now(),
  now(),
  '',
  '',
  '',
  ''
from (
  values
    ('00000000-0000-4000-8000-000000000001'::uuid, 'admin@meritly.local', 'Local Admin'),
    ('00000000-0000-4000-8000-000000000002'::uuid, 'supervisor@meritly.local', 'Local Supervisor'),
    ('00000000-0000-4000-8000-000000000003'::uuid, 'employee@meritly.local', 'Local Employee'),
    ('00000000-0000-4000-8000-000000000004'::uuid, 'supervisor2@meritly.local', 'Local Supervisor 2'),
    ('00000000-0000-4000-8000-000000000005'::uuid, 'employee2@meritly.local', 'Local Employee 2')
) as u (id, email, display_name);

-- Password sign-in requires a matching email identity per user.
-- auth.identities.email is a generated column, so it is not inserted.
insert into auth.identities (
  id,
  user_id,
  provider_id,
  provider,
  identity_data,
  last_sign_in_at,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  u.id,
  u.id::text,
  'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  now(),
  now(),
  now()
from auth.users u
where u.id in (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000005'
);

-- The signup trigger created every profile as 'employee'; promote admin and supervisors.
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-000000000001';
update public.profiles set role = 'supervisor' where id = '00000000-0000-4000-8000-000000000002';
update public.profiles set role = 'supervisor' where id = '00000000-0000-4000-8000-000000000004';

-- Sample project. Must come after the promotions (the owner trigger requires a supervisor), and
-- supervisor_id is explicit because auth.uid() is null without a JWT. Its two milestones reserve
-- their target pools, 6000.00 of 10000.00.
insert into public.projects (id, name, start_date, end_date, status, total_budget, supervisor_id)
values (
  '00000000-0000-4000-8000-000000000011',
  'Local Demo Project',
  '2026-01-01',
  '2026-12-31',
  'active',
  10000.00,
  '00000000-0000-4000-8000-000000000002'
);

insert into public.milestones (id, project_id, name, start_date, end_date, status, target_pool)
values
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000011', 'Milestone 1', '2026-01-01', '2026-06-30', 'active', 3000.00),
  ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000011', 'Milestone 2', '2026-07-01', '2026-12-31', 'active', 3000.00);

-- Employee records owned by supervisor@meritly.local. supervisor_id is explicit because
-- auth.uid() is null without a JWT. ...0031 is linked to the employee@meritly.local account as if
-- the invite had been accepted; ...0032 has not been invited yet.
insert into public.employees (id, supervisor_id, full_name, email, job_role_id, profile_id, invited_at, activated_at)
values
  (
    '00000000-0000-4000-8000-000000000031',
    '00000000-0000-4000-8000-000000000002',
    'Local Employee',
    'employee@meritly.local',
    (select jr.id from public.job_roles jr where jr.name = 'Senior'),
    '00000000-0000-4000-8000-000000000003',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000032',
    '00000000-0000-4000-8000-000000000002',
    'Pending Invitee',
    'pending@meritly.local',
    (select jr.id from public.job_roles jr where jr.name = 'Senior'),
    null,
    null,
    null
  );

-- Assignments for Local Employee on both open milestones: an open total of 1.10, so the >100%
-- flag shows in employee_time_share_totals.
insert into public.milestone_engagements (id, milestone_id, employee_id, time_share, rating)
values
  ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000031', 0.60, 4),
  ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000031', 0.50, 3);

-- KPI scores 80/90/85/60 on Milestone 1 (the S-04 worked example's scores): at the default config
-- M = 1.1875 of the maximum 1.30, so its 3000.00 target pool (the approved maximum) becomes a
-- 2740.38 payout pool, all of it Local Employee's bonus. Milestone 2 stays unscored (shares only, no PLN amounts).
update public.milestones
set kpi_schedule = 80, kpi_budget = 90, kpi_quality = 85, kpi_risk = 60
where id = '00000000-0000-4000-8000-000000000021';

-- ---------------------------------------------------------------------------
-- Approved Demo Project: the HTTP IDOR fixture for scripts/smoke.mjs.
--
-- Expected bonuses, derived by hand from the PRD formula (not from the code):
--   M           = clamp(min + (Σ KPI weight_k × score_k) × 0.01 × (max − min), min, max)
--   payout_pool = floor(target_pool × M / multiplier_max)
--   bonus_i     = floor(payout_pool × e_i / Σ e),  e_i = time share × role weight × rating factor
-- All four KPI scores are 100 and the KPI weights sum to 1 (bonus_settings_kpi_weights_sum), so
-- Σ weight_k × score_k = 100 and M = min + (max − min) = max, whatever the configured bounds.
-- The payout pool is then the whole 1000.00 target pool. Both employees have the same job role and
-- rating, so role weight × rating factor cancels out and the pool splits by time share alone:
--   Local Employee   (…0031) 0.60 / 1.00 × 1000.00 = 600.00 PLN
--   Local Employee 2 (…0033) 0.40 / 1.00 × 1000.00 = 400.00 PLN
-- "Draft Milestone" (…0024) is scored but never approved, so it has no result lines and no
-- employee may see it on /my-bonuses.
-- ---------------------------------------------------------------------------

-- ...0033 is linked to the employee2@meritly.local account as if the invite had been accepted.
insert into public.employees (id, supervisor_id, full_name, email, job_role_id, profile_id, invited_at, activated_at)
values (
  '00000000-0000-4000-8000-000000000033',
  '00000000-0000-4000-8000-000000000002',
  'Local Employee 2',
  'employee2@meritly.local',
  (select jr.id from public.job_roles jr where jr.name = 'Senior'),
  '00000000-0000-4000-8000-000000000005',
  now(),
  now()
);

insert into public.projects (id, name, start_date, end_date, status, total_budget, supervisor_id)
values (
  '00000000-0000-4000-8000-000000000012',
  'Approved Demo Project',
  '2026-01-01',
  '2026-12-31',
  'active',
  5000.00,
  '00000000-0000-4000-8000-000000000002'
);

insert into public.milestones (id, project_id, name, start_date, end_date, status, target_pool)
values
  ('00000000-0000-4000-8000-000000000023', '00000000-0000-4000-8000-000000000012', 'Approved Milestone', '2026-01-01', '2026-03-31', 'active', 1000.00),
  ('00000000-0000-4000-8000-000000000024', '00000000-0000-4000-8000-000000000012', 'Draft Milestone', '2026-04-01', '2026-06-30', 'active', 1000.00);

insert into public.milestone_engagements (id, milestone_id, employee_id, time_share, rating)
values
  ('00000000-0000-4000-8000-000000000043', '00000000-0000-4000-8000-000000000023', '00000000-0000-4000-8000-000000000031', 0.60, 3),
  ('00000000-0000-4000-8000-000000000044', '00000000-0000-4000-8000-000000000023', '00000000-0000-4000-8000-000000000033', 0.40, 3),
  ('00000000-0000-4000-8000-000000000045', '00000000-0000-4000-8000-000000000024', '00000000-0000-4000-8000-000000000033', 0.30, 3);

update public.milestones
set kpi_schedule = 100, kpi_budget = 100, kpi_quality = 100, kpi_risk = 100
where id in ('00000000-0000-4000-8000-000000000023', '00000000-0000-4000-8000-000000000024');

-- Approve ...0023 the way the app does: approve_milestone checks ownership through auth.uid(), so
-- it runs as supervisor@meritly.local's JWT. It must come after the KPI scores and engagements,
-- which it snapshots. Session-level settings (not `set local`), because the seed may not run
-- inside an explicit transaction; both are reset right after.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}', false);
set role authenticated;
select public.approve_milestone('00000000-0000-4000-8000-000000000023');
reset role;
select set_config('request.jwt.claims', '', false);
