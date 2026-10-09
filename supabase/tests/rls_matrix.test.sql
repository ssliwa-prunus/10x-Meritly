-- pgTAP suite: the decided RLS matrix (testing-rls-matrix, test-plan risks #1 and #2). Walks every
-- actor x surface x operation cell of the decided matrix in
-- context/changes/testing-rls-matrix/plan.md with real attackers: two linked AND activated
-- employees (E1, E2), a second Supervisor (SB), an employee-role user with no employees row (U),
-- an Admin (AD) and anon. Expected values come from that matrix only, never from a policy body.
--
-- Isolation model: same as profiles_rls.test.sql. Runs against the live (seeded) local database
-- without a reset, creates its own fixtures in the reserved UUID range
-- 00000000-0000-4000-8000-0000000007xx with emails under @pgtap.test, scopes every count to fixture
-- ids (unscoped reads are used only where the expected answer is "nothing at all"), and rolls
-- everything back at the end. bonus_settings is pinned to the defaults inside the transaction.
--
-- Denial shapes: an RLS-denied insert raises 42501; an RLS-denied update or delete affects 0 rows.
-- Where the table or column privilege itself is missing (result lines; employees.profile_id) the
-- statement raises 42501 instead. Every block of denied updates/deletes is followed by an owner-side
-- check that no fixture row changed (an md5 fingerprint per table, compared with a baseline), so
-- "0 rows" cannot hide a write to a different row.
--
-- When a migration adds a table, policy, grant or definer function, update this file and
-- supabase/tests/rls_catalog_guard.test.sql. A migration that changes only a view or invoker
-- function body (same name, columns, security_invoker, grants and definer status) adds cells here
-- for the changed behaviour, once per actor, and leaves the catalog guard unchanged.
--
-- Run with: npx supabase test db

begin;

create extension if not exists pgtap with schema extensions;

select plan(252);

-- ---------------------------------------------------------------------------
-- Fixtures (as the table owner; auth.uid() is null, so owners are explicit)
--   users:       ...0701 E1's account   ...0702 E2's account   ...0703 SA (supervisor)
--                ...0704 SB (supervisor)   ...0705 AD (admin)   ...0706 U (employee role, no
--                employees row)
--   job role:    ...0708 pgTAP Matrix Role (AD inserts ...0709)
--   projects:    ...0711 PA (SA)   ...0712 PB (SB)   ...0713 PR (SA; reassigned to SB at the end)
--                ...0714 PC (SA; cancelled after its engagement exists)
--   milestones:  ...0721 MA_appr (PA, approved)   ...0722 MA_draft (PA, active, scored, injected
--                Draft snapshot)   ...0723 MB (PB, active)   ...0724 MR_appr (PR, approved)
--                ...0726 MC (PC, active; its project is cancelled)   (SA inserts ...0725)
--   employees:   ...0731 E1 (SA, linked to ...0701, activated)   ...0732 E2 (SA, linked to ...0702,
--                activated)   ...0733 E3 (SA, not linked)   ...0734 EB (SB, not linked)
--                (SA and AD each insert one more, by email; the insert grant has no id column)
--   engagements: ...0741 E1@MA_appr   ...0742 E2@MA_appr   ...0743 E1@MA_draft   ...0744 E2@MA_draft
--                ...0745 EB@MB   ...0746 E1@MR_appr   ...0747 E1@MC 0.40 (closed project, so outside
--                E1's open time share)   (SA inserts and deletes E3@MA_draft)
--   result line: ...0751 injected E1 line of MA_draft (Draft, never visible to E1)
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000701', 'authenticated', 'authenticated', 'matrix-e1@pgtap.test', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000702', 'authenticated', 'authenticated', 'matrix-e2@pgtap.test', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000703', 'authenticated', 'authenticated', 'matrix-supervisor-a@pgtap.test', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000704', 'authenticated', 'authenticated', 'matrix-supervisor-b@pgtap.test', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000705', 'authenticated', 'authenticated', 'matrix-admin@pgtap.test', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000706', 'authenticated', 'authenticated', 'matrix-unlinked@pgtap.test', '{}', now(), now());

update public.profiles set role = 'supervisor'
where id in ('00000000-0000-4000-8000-000000000703', '00000000-0000-4000-8000-000000000704');
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-000000000705';

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
values ('00000000-0000-4000-8000-000000000708', 'pgTAP Matrix Role', 1.00);

insert into public.projects (id, name, start_date, end_date, status, total_budget, supervisor_id)
values
  ('00000000-0000-4000-8000-000000000711', 'pgTAP Matrix PA', '2026-01-01', '2026-12-31', 'active', 100000.00, '00000000-0000-4000-8000-000000000703'),
  ('00000000-0000-4000-8000-000000000712', 'pgTAP Matrix PB', '2026-01-01', '2026-12-31', 'active', 10000.00, '00000000-0000-4000-8000-000000000704'),
  ('00000000-0000-4000-8000-000000000713', 'pgTAP Matrix PR', '2026-01-01', '2026-12-31', 'active', 10000.00, '00000000-0000-4000-8000-000000000703'),
  ('00000000-0000-4000-8000-000000000714', 'pgTAP Matrix PC', '2026-01-01', '2026-12-31', 'active', 10000.00, '00000000-0000-4000-8000-000000000703');

insert into public.milestones (id, project_id, name, start_date, end_date, status, target_pool)
values
  ('00000000-0000-4000-8000-000000000721', '00000000-0000-4000-8000-000000000711', 'pgTAP Matrix MA appr', '2026-01-01', '2026-03-31', 'active', 10000.00),
  ('00000000-0000-4000-8000-000000000722', '00000000-0000-4000-8000-000000000711', 'pgTAP Matrix MA draft', '2026-04-01', '2026-06-30', 'active', 1000.00),
  ('00000000-0000-4000-8000-000000000723', '00000000-0000-4000-8000-000000000712', 'pgTAP Matrix MB', '2026-01-01', '2026-03-31', 'active', 1000.00),
  ('00000000-0000-4000-8000-000000000724', '00000000-0000-4000-8000-000000000713', 'pgTAP Matrix MR appr', '2026-01-01', '2026-03-31', 'active', 1000.00),
  ('00000000-0000-4000-8000-000000000726', '00000000-0000-4000-8000-000000000714', 'pgTAP Matrix MC', '2026-01-01', '2026-03-31', 'active', 1000.00);

-- E1 and E2: linked to their accounts and activated (invite accepted), like milestone_approval's E1.
insert into public.employees (id, supervisor_id, full_name, email, job_role_id, profile_id, invited_at, activated_at)
values
  ('00000000-0000-4000-8000-000000000731', '00000000-0000-4000-8000-000000000703', 'pgTAP Matrix E1', 'matrix-e1@pgtap.test', '00000000-0000-4000-8000-000000000708', '00000000-0000-4000-8000-000000000701', now(), now()),
  ('00000000-0000-4000-8000-000000000732', '00000000-0000-4000-8000-000000000703', 'pgTAP Matrix E2', 'matrix-e2@pgtap.test', '00000000-0000-4000-8000-000000000708', '00000000-0000-4000-8000-000000000702', now(), now());

insert into public.employees (id, supervisor_id, full_name, email, job_role_id)
values
  ('00000000-0000-4000-8000-000000000733', '00000000-0000-4000-8000-000000000703', 'pgTAP Matrix E3', 'matrix-e3-record@pgtap.test', '00000000-0000-4000-8000-000000000708'),
  ('00000000-0000-4000-8000-000000000734', '00000000-0000-4000-8000-000000000704', 'pgTAP Matrix EB', 'matrix-eb-record@pgtap.test', '00000000-0000-4000-8000-000000000708');

insert into public.milestone_engagements (id, milestone_id, employee_id, time_share, rating)
values
  ('00000000-0000-4000-8000-000000000741', '00000000-0000-4000-8000-000000000721', '00000000-0000-4000-8000-000000000731', 0.50, 4),
  ('00000000-0000-4000-8000-000000000742', '00000000-0000-4000-8000-000000000721', '00000000-0000-4000-8000-000000000732', 0.50, 3),
  ('00000000-0000-4000-8000-000000000743', '00000000-0000-4000-8000-000000000722', '00000000-0000-4000-8000-000000000731', 0.30, 3),
  ('00000000-0000-4000-8000-000000000744', '00000000-0000-4000-8000-000000000722', '00000000-0000-4000-8000-000000000732', 0.20, 3),
  ('00000000-0000-4000-8000-000000000745', '00000000-0000-4000-8000-000000000723', '00000000-0000-4000-8000-000000000734', 0.50, 3),
  ('00000000-0000-4000-8000-000000000746', '00000000-0000-4000-8000-000000000724', '00000000-0000-4000-8000-000000000731', 0.10, 3),
  ('00000000-0000-4000-8000-000000000747', '00000000-0000-4000-8000-000000000726', '00000000-0000-4000-8000-000000000731', 0.40, 3);

-- Close PC last, after its engagement exists (MR007 blocks engagement writes in a closed project).
update public.projects set status = 'cancelled' where id = '00000000-0000-4000-8000-000000000714';

update public.milestones
set kpi_schedule = 80, kpi_budget = 90, kpi_quality = 85, kpi_risk = 60
where id = '00000000-0000-4000-8000-000000000721';
update public.milestones
set kpi_schedule = 70, kpi_budget = 70, kpi_quality = 70, kpi_risk = 70
where id = '00000000-0000-4000-8000-000000000722';
update public.milestones
set kpi_schedule = 100, kpi_budget = 100, kpi_quality = 100, kpi_risk = 100
where id = '00000000-0000-4000-8000-000000000724';

-- Approve MA_appr and MR_appr as their owner SA (approve_milestone checks ownership via auth.uid()).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000703"}';
do $$
begin
  perform public.approve_milestone('00000000-0000-4000-8000-000000000721');
  perform public.approve_milestone('00000000-0000-4000-8000-000000000724');
end;
$$;
reset role;
-- reset role keeps SA's claims; clear them so the owner works without a JWT.
set local request.jwt.claims = '{}';

-- Injected Draft snapshot for MA_draft (owner-inserted header and E1 line), so E1's empty result
-- for MA_draft is not trivially empty: a stored line exists, only the approved condition hides it.
insert into public.milestone_results (
  milestone_id, project_id, project_name, milestone_name, start_date, end_date, target_pool,
  kpi_schedule, kpi_budget, kpi_quality, kpi_risk, multiplier, multiplier_min, multiplier_max,
  budget_share, payout_pool, payout_total, residual, engagement_count
)
values (
  '00000000-0000-4000-8000-000000000722', '00000000-0000-4000-8000-000000000711', 'pgTAP Matrix PA',
  'pgTAP Matrix MA draft', '2026-04-01', '2026-06-30', 1000.00, 70, 70, 70, 70, 1.12, 0.70, 1.30,
  0.861538, 861.53, 861.53, 0.00, 1
);

insert into public.milestone_result_lines (
  id, milestone_id, engagement_id, employee_id, employee_name, job_role_name, project_id, project_name,
  milestone_name, start_date, end_date, approved_at, time_share, role_weight, rating, rating_factor,
  weighted_contribution, multiplier, bonus
)
values (
  '00000000-0000-4000-8000-000000000751', '00000000-0000-4000-8000-000000000722',
  '00000000-0000-4000-8000-000000000743', '00000000-0000-4000-8000-000000000731', 'pgTAP Matrix E1',
  'pgTAP Matrix Role', '00000000-0000-4000-8000-000000000711', 'pgTAP Matrix PA', 'pgTAP Matrix MA draft',
  '2026-04-01', '2026-06-30', now(), 0.30, 1.00, 3, 1.00, 0.30, 1.12, 861.53
);

-- Ids and totals read as the owner, readable later from any role through current_setting().
do $$
begin
  perform set_config('pgtap.total_profiles', (select count(*) from public.profiles)::text, true);
  perform set_config('pgtap.total_job_roles', (select count(*) from public.job_roles)::text, true);
  perform set_config(
    'pgtap.e1_line_ma',
    (select id::text from public.milestone_result_lines
     where milestone_id = '00000000-0000-4000-8000-000000000721'
       and employee_id = '00000000-0000-4000-8000-000000000731'),
    true
  );
  perform set_config(
    'pgtap.e2_line_ma',
    (select id::text from public.milestone_result_lines
     where milestone_id = '00000000-0000-4000-8000-000000000721'
       and employee_id = '00000000-0000-4000-8000-000000000732'),
    true
  );
end;
$$;

-- Owner-side fingerprint of every fixture row, per table (bonus_settings is the singleton).
create temp view pgtap_matrix_fp as
select 'profiles'::text as tbl, md5(coalesce(string_agg(t::text, '|' order by t.id), '')) as fp
from public.profiles t where t.id::text like '00000000-0000-4000-8000-0000000007%'
union all
select 'job_roles', md5(coalesce(string_agg(t::text, '|' order by t.id), ''))
from public.job_roles t where t.id::text like '00000000-0000-4000-8000-0000000007%'
union all
select 'bonus_settings', md5(coalesce(string_agg(t::text, '|'), ''))
from public.bonus_settings t
union all
select 'projects', md5(coalesce(string_agg(t::text, '|' order by t.id), ''))
from public.projects t where t.id::text like '00000000-0000-4000-8000-0000000007%'
union all
select 'milestones', md5(coalesce(string_agg(t::text, '|' order by t.id), ''))
from public.milestones t where t.id::text like '00000000-0000-4000-8000-0000000007%'
union all
select 'employees', md5(coalesce(string_agg(t::text, '|' order by t.id), ''))
from public.employees t where t.id::text like '00000000-0000-4000-8000-0000000007%'
union all
select 'milestone_engagements', md5(coalesce(string_agg(t::text, '|' order by t.id), ''))
from public.milestone_engagements t where t.id::text like '00000000-0000-4000-8000-0000000007%'
union all
select 'milestone_results', md5(coalesce(string_agg(t::text, '|' order by t.milestone_id), ''))
from public.milestone_results t where t.milestone_id::text like '00000000-0000-4000-8000-0000000007%'
union all
select 'milestone_result_lines', md5(coalesce(string_agg(t::text, '|' order by t.id), ''))
from public.milestone_result_lines t where t.milestone_id::text like '00000000-0000-4000-8000-0000000007%';

create temp table pgtap_matrix_fp0 as select * from pgtap_matrix_fp;

-- ---------------------------------------------------------------------------
-- Owner: the fixtures the "none" cells depend on really exist
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select id, status from public.milestones
     where id in ('00000000-0000-4000-8000-000000000721', '00000000-0000-4000-8000-000000000722',
                  '00000000-0000-4000-8000-000000000723', '00000000-0000-4000-8000-000000000724')
     order by id $$,
  $$ values ('00000000-0000-4000-8000-000000000721'::uuid, 'approved'::text),
            ('00000000-0000-4000-8000-000000000722'::uuid, 'active'::text),
            ('00000000-0000-4000-8000-000000000723'::uuid, 'active'::text),
            ('00000000-0000-4000-8000-000000000724'::uuid, 'approved'::text) $$,
  'fixture: MA_appr and MR_appr are approved, MA_draft and MB are active'
);
select results_eq(
  $$ select milestone_id, employee_id from public.milestone_result_lines
     where milestone_id::text like '00000000-0000-4000-8000-0000000007%'
     order by milestone_id, employee_id $$,
  $$ values ('00000000-0000-4000-8000-000000000721'::uuid, '00000000-0000-4000-8000-000000000731'::uuid),
            ('00000000-0000-4000-8000-000000000721'::uuid, '00000000-0000-4000-8000-000000000732'::uuid),
            ('00000000-0000-4000-8000-000000000722'::uuid, '00000000-0000-4000-8000-000000000731'::uuid),
            ('00000000-0000-4000-8000-000000000724'::uuid, '00000000-0000-4000-8000-000000000731'::uuid) $$,
  'fixture: stored lines are E1+E2 on MA_appr, the injected E1 Draft line on MA_draft, E1 on MR_appr'
);
select is(
  (select count(*)::int from public.employees
   where id in ('00000000-0000-4000-8000-000000000731', '00000000-0000-4000-8000-000000000732')
     and profile_id is not null and activated_at is not null),
  2,
  'fixture: E1 and E2 are linked to their accounts and activated'
);

-- ---------------------------------------------------------------------------
-- anon: no privilege on any table or view (select raises 42501, so no row is visible)
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{}';

select throws_ok($$ select count(*) from public.profiles $$, '42501', null, 'anon selecting profiles is denied (42501)');
select throws_ok($$ select count(*) from public.job_roles $$, '42501', null, 'anon selecting job_roles is denied (42501)');
select throws_ok($$ select count(*) from public.bonus_settings $$, '42501', null, 'anon selecting bonus_settings is denied (42501)');
select throws_ok($$ select count(*) from public.projects $$, '42501', null, 'anon selecting projects is denied (42501)');
select throws_ok($$ select count(*) from public.milestones $$, '42501', null, 'anon selecting milestones is denied (42501)');
select throws_ok($$ select count(*) from public.employees $$, '42501', null, 'anon selecting employees is denied (42501)');
select throws_ok($$ select count(*) from public.milestone_engagements $$, '42501', null, 'anon selecting milestone_engagements is denied (42501)');
select throws_ok($$ select count(*) from public.milestone_results $$, '42501', null, 'anon selecting milestone_results is denied (42501)');
select throws_ok($$ select count(*) from public.milestone_result_lines $$, '42501', null, 'anon selecting milestone_result_lines is denied (42501)');
select throws_ok($$ select count(*) from public.project_budget_exposure $$, '42501', null, 'anon selecting project_budget_exposure is denied (42501)');
select throws_ok($$ select count(*) from public.employee_time_share_totals $$, '42501', null, 'anon selecting employee_time_share_totals is denied (42501)');
select throws_ok(
  $$ insert into public.projects (name, start_date, end_date, total_budget, supervisor_id)
     values ('pgTAP Matrix anon probe', '2026-01-01', '2026-12-31', 100.00, '00000000-0000-4000-8000-000000000703') $$,
  '42501',
  null,
  'anon inserting a project is denied (42501)'
);

-- ---------------------------------------------------------------------------
-- U: employee role, no employees row
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000706"}';

select is(
  (select array_agg(id) from public.profiles),
  array['00000000-0000-4000-8000-000000000706'::uuid],
  'U selecting profiles sees exactly their own row'
);
select throws_ok(
  $$ insert into public.profiles (id, email) values ('00000000-0000-4000-8000-000000000799', 'matrix-probe@pgtap.test') $$,
  '42501', null, 'U inserting a profile is denied (42501)'
);
select is_empty(
  $$ update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-000000000706' returning id $$,
  'U updating own profile role affects 0 rows'
);
select is_empty(
  $$ delete from public.profiles where id = '00000000-0000-4000-8000-000000000706' returning id $$,
  'U deleting own profile affects 0 rows'
);
select is_empty($$ select id from public.job_roles $$, 'U selecting job_roles sees none');
select is_empty($$ select id from public.bonus_settings $$, 'U selecting bonus_settings sees none');
select throws_ok(
  $$ insert into public.job_roles (name, weight) values ('pgTAP Matrix U Role', 1.00) $$,
  '42501', null, 'U inserting a job role is denied (42501)'
);
select is_empty(
  $$ update public.job_roles set weight = 2.00 where id = '00000000-0000-4000-8000-000000000708' returning id $$,
  'U updating a job role affects 0 rows'
);
select is_empty(
  $$ update public.bonus_settings set multiplier_max = 1.50 where id returning id $$,
  'U updating bonus_settings affects 0 rows'
);
select is_empty(
  $$ delete from public.job_roles where id = '00000000-0000-4000-8000-000000000708' returning id $$,
  'U deleting a job role affects 0 rows'
);
select is_empty($$ select id from public.projects $$, 'U selecting projects sees none');
select is_empty($$ select id from public.milestones $$, 'U selecting milestones sees none');
select is_empty($$ select id from public.employees $$, 'U selecting employees sees none');
select is_empty($$ select id from public.milestone_engagements $$, 'U selecting milestone_engagements sees none');
select is_empty($$ select milestone_id from public.milestone_results $$, 'U selecting milestone_results sees none');
select is_empty($$ select id from public.milestone_result_lines $$, 'U selecting milestone_result_lines sees none');
select is_empty($$ select project_id from public.project_budget_exposure $$, 'U selecting project_budget_exposure sees none');
select is_empty($$ select employee_id from public.employee_time_share_totals $$, 'U selecting employee_time_share_totals sees none');
select is_empty(
  $$ select milestone_id from public.milestone_payout_summary('00000000-0000-4000-8000-000000000722') $$,
  'U calling milestone_payout_summary(MA_draft) gets none'
);
select is_empty(
  $$ select engagement_id from public.milestone_payout_lines('00000000-0000-4000-8000-000000000722') $$,
  'U calling milestone_payout_lines(MA_draft) gets none'
);
select is_empty(
  $$ select milestone_id from public.milestone_payout_summary('00000000-0000-4000-8000-000000000721') $$,
  'U calling milestone_payout_summary(MA_appr) gets none'
);
select is_empty(
  $$ select engagement_id from public.milestone_payout_lines('00000000-0000-4000-8000-000000000721') $$,
  'U calling milestone_payout_lines(MA_appr) gets none'
);
select ok(
  (select public.kpi_multiplier(m.kpi_schedule, m.kpi_budget, m.kpi_quality, m.kpi_risk)
   from public.milestones m where m.id = '00000000-0000-4000-8000-000000000722') is null,
  'U computing kpi_multiplier for MA_draft gets null'
);
select ok(
  public.kpi_multiplier(70::smallint, 70::smallint, 70::smallint, 70::smallint) is null,
  'U calling kpi_multiplier with MA_draft''s scores as literals gets null (no config access)'
);
select throws_ok(
  $$ select public.approve_milestone('00000000-0000-4000-8000-000000000722') $$,
  '42501', null, 'U approving MA_draft is denied (42501)'
);
select is(
  public.is_approved_milestone('00000000-0000-4000-8000-000000000723'),
  false,
  'U calling is_approved_milestone(MB) gets a boolean (F4, accepted)'
);

reset role;
set local request.jwt.claims = '{}';

select is_empty(
  $$ select a.tbl from pgtap_matrix_fp a join pgtap_matrix_fp0 b using (tbl) where a.fp is distinct from b.fp $$,
  'owner read after U''s denied updates/deletes: no fixture row changed'
);

-- ---------------------------------------------------------------------------
-- E1: linked, activated employee (risk #1 isolation and employee writes)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000701"}';

select is(
  public.current_employee_id(),
  '00000000-0000-4000-8000-000000000731'::uuid,
  'E1 resolves to their own activated employee row (the attacker is linked)'
);

-- profiles
select is(
  (select array_agg(id) from public.profiles),
  array['00000000-0000-4000-8000-000000000701'::uuid],
  'E1 selecting profiles sees exactly their own row'
);
select throws_ok(
  $$ insert into public.profiles (id, email) values ('00000000-0000-4000-8000-000000000799', 'matrix-probe@pgtap.test') $$,
  '42501', null, 'E1 inserting a profile is denied (42501)'
);
select is_empty(
  $$ update public.profiles set role = 'supervisor' where id = '00000000-0000-4000-8000-000000000701' returning id $$,
  'E1 updating own profile role affects 0 rows'
);
select is_empty(
  $$ delete from public.profiles where id = '00000000-0000-4000-8000-000000000701' returning id $$,
  'E1 deleting own profile affects 0 rows'
);

-- config
select is_empty($$ select id from public.job_roles $$, 'E1 selecting job_roles sees none');
select is_empty($$ select id from public.bonus_settings $$, 'E1 selecting bonus_settings sees none');
select throws_ok(
  $$ insert into public.job_roles (name, weight) values ('pgTAP Matrix E1 Role', 1.00) $$,
  '42501', null, 'E1 inserting a job role is denied (42501)'
);
select is_empty(
  $$ update public.job_roles set weight = 2.00 where id = '00000000-0000-4000-8000-000000000708' returning id $$,
  'E1 updating a job role affects 0 rows'
);
select is_empty(
  $$ update public.bonus_settings set rating_factor_5 = 1.50 where id returning id $$,
  'E1 updating bonus_settings affects 0 rows'
);
select is_empty(
  $$ delete from public.job_roles where id = '00000000-0000-4000-8000-000000000708' returning id $$,
  'E1 deleting a job role affects 0 rows'
);
select is_empty(
  $$ delete from public.bonus_settings returning id $$,
  'E1 deleting bonus_settings affects 0 rows'
);

-- projects
select is_empty($$ select id from public.projects $$, 'E1 selecting projects sees none');
select throws_ok(
  $$ insert into public.projects (name, start_date, end_date, total_budget, supervisor_id)
     values ('pgTAP Matrix E1 probe', '2026-01-01', '2026-12-31', 100.00, '00000000-0000-4000-8000-000000000703') $$,
  '42501', null, 'E1 inserting a project is denied (42501)'
);
select is_empty(
  $$ update public.projects set notes = 'E1 was here' where id = '00000000-0000-4000-8000-000000000711' returning id $$,
  'E1 updating PA affects 0 rows'
);
select is_empty(
  $$ delete from public.projects where id = '00000000-0000-4000-8000-000000000711' returning id $$,
  'E1 deleting PA affects 0 rows'
);

-- milestones
select is_empty($$ select id from public.milestones $$, 'E1 selecting milestones sees none');
select throws_ok(
  $$ insert into public.milestones (project_id, name, start_date, end_date, target_pool)
     values ('00000000-0000-4000-8000-000000000711', 'pgTAP Matrix E1 probe', '2026-07-01', '2026-07-31', 100.00) $$,
  '42501', null, 'E1 inserting a milestone into PA is denied (42501)'
);
select is_empty(
  $$ update public.milestones set name = 'pgTAP Matrix E1 renamed' where id = '00000000-0000-4000-8000-000000000722' returning id $$,
  'E1 updating MA_draft affects 0 rows'
);
select is_empty(
  $$ update public.milestones set kpi_schedule = 100, kpi_budget = 100, kpi_quality = 100, kpi_risk = 100
     where id = '00000000-0000-4000-8000-000000000722' returning id $$,
  'E1 scoring MA_draft''s KPIs affects 0 rows'
);
select is_empty(
  $$ delete from public.milestones where id = '00000000-0000-4000-8000-000000000722' returning id $$,
  'E1 deleting MA_draft affects 0 rows'
);

-- employees: none, including the own row
select is_empty($$ select id from public.employees $$, 'E1 selecting employees sees none');
select is_empty(
  $$ select id from public.employees where id = '00000000-0000-4000-8000-000000000731' $$,
  'E1 selecting their own employees row by id sees none'
);
select is_empty(
  $$ update public.employees set full_name = 'pgTAP Matrix E1 renamed' where id = '00000000-0000-4000-8000-000000000731' returning id $$,
  'E1 updating their own employees row affects 0 rows'
);
select throws_ok(
  $$ update public.employees set profile_id = '00000000-0000-4000-8000-000000000702'
     where id = '00000000-0000-4000-8000-000000000731' $$,
  '42501', null, 'E1 updating their own employees.profile_id is denied (42501, no column privilege)'
);
select is_empty(
  $$ delete from public.employees where id = '00000000-0000-4000-8000-000000000731' returning id $$,
  'E1 deleting their own employees row affects 0 rows'
);

-- engagements
select is_empty($$ select id from public.milestone_engagements $$, 'E1 selecting milestone_engagements sees none');
select throws_ok(
  $$ insert into public.milestone_engagements (milestone_id, employee_id, time_share, rating)
     values ('00000000-0000-4000-8000-000000000722', '00000000-0000-4000-8000-000000000733', 0.10, 3) $$,
  '42501', null, 'E1 inserting an engagement on MA_draft is denied (42501)'
);
select is_empty(
  $$ update public.milestone_engagements set rating = 5 where id = '00000000-0000-4000-8000-000000000743' returning id $$,
  'E1 updating their own MA_draft engagement affects 0 rows'
);
select is_empty(
  $$ delete from public.milestone_engagements where id = '00000000-0000-4000-8000-000000000743' returning id $$,
  'E1 deleting their own MA_draft engagement affects 0 rows'
);

-- snapshot: no header, exactly own approved lines
select is_empty($$ select milestone_id from public.milestone_results $$, 'E1 selecting milestone_results sees none (privacy split)');
select results_eq(
  $$ select milestone_id, employee_id from public.milestone_result_lines
     where milestone_id in ('00000000-0000-4000-8000-000000000721', '00000000-0000-4000-8000-000000000722') $$,
  $$ values ('00000000-0000-4000-8000-000000000721'::uuid, '00000000-0000-4000-8000-000000000731'::uuid) $$,
  'E1 selecting PA''s result lines sees exactly their own MA_appr line'
);
select results_eq(
  $$ select milestone_id, employee_id from public.milestone_result_lines order by milestone_id $$,
  $$ values ('00000000-0000-4000-8000-000000000721'::uuid, '00000000-0000-4000-8000-000000000731'::uuid),
            ('00000000-0000-4000-8000-000000000724'::uuid, '00000000-0000-4000-8000-000000000731'::uuid) $$,
  'E1 selecting all result lines sees only their own approved lines (MA_appr, MR_appr)'
);
select is_empty(
  $$ select id from public.milestone_result_lines where employee_id = '00000000-0000-4000-8000-000000000732' $$,
  'E1 selecting result lines by E2''s employee_id sees none'
);
select is_empty(
  $$ select id from public.milestone_result_lines where id = current_setting('pgtap.e2_line_ma')::uuid $$,
  'E1 selecting E2''s MA_appr line by its id sees none'
);
select is_empty(
  $$ select id from public.milestone_result_lines where milestone_id = '00000000-0000-4000-8000-000000000722' $$,
  'E1 selecting MA_draft''s lines sees none, although their own Draft line is stored'
);
select throws_ok(
  $$ update public.milestone_result_lines set bonus = 99999.00 where id = current_setting('pgtap.e1_line_ma')::uuid $$,
  '42501', null, 'E1 updating their own result line is denied (42501, no update privilege)'
);
select throws_ok(
  $$ delete from public.milestone_result_lines where id = current_setting('pgtap.e1_line_ma')::uuid $$,
  '42501', null, 'E1 deleting their own result line is denied (42501, no delete privilege)'
);

-- views and RPCs
select is_empty($$ select project_id from public.project_budget_exposure $$, 'E1 selecting project_budget_exposure sees none');
select is_empty($$ select employee_id from public.employee_time_share_totals $$, 'E1 selecting employee_time_share_totals sees none');
select is_empty(
  $$ select milestone_id from public.milestone_payout_summary('00000000-0000-4000-8000-000000000722') $$,
  'E1 calling milestone_payout_summary(MA_draft) gets none'
);
select is_empty(
  $$ select engagement_id from public.milestone_payout_lines('00000000-0000-4000-8000-000000000722') $$,
  'E1 calling milestone_payout_lines(MA_draft) gets none'
);
select is_empty(
  $$ select milestone_id from public.milestone_payout_summary('00000000-0000-4000-8000-000000000721') $$,
  'E1 calling milestone_payout_summary(MA_appr) gets none'
);
select is_empty(
  $$ select engagement_id from public.milestone_payout_lines('00000000-0000-4000-8000-000000000721') $$,
  'E1 calling milestone_payout_lines(MA_appr) gets none'
);
select ok(
  (select public.kpi_multiplier(m.kpi_schedule, m.kpi_budget, m.kpi_quality, m.kpi_risk)
   from public.milestones m where m.id = '00000000-0000-4000-8000-000000000722') is null,
  'E1 computing kpi_multiplier for MA_draft gets null'
);
select ok(
  public.kpi_multiplier(70::smallint, 70::smallint, 70::smallint, 70::smallint) is null,
  'E1 calling kpi_multiplier with MA_draft''s scores as literals gets null (no config access)'
);
select throws_ok(
  $$ select public.approve_milestone('00000000-0000-4000-8000-000000000722') $$,
  '42501', null, 'E1 approving MA_draft is denied (42501)'
);
-- F4 (accepted exposure): is_approved_milestone is callable by any authenticated user for any id.
-- It reveals only whether that milestone exists and is approved, as a boolean; UUIDs are not
-- guessable. Pinned here so a change to what it returns is a decision, not an accident.
select is(
  public.is_approved_milestone('00000000-0000-4000-8000-000000000723'),
  false,
  'E1 calling is_approved_milestone(MB) gets a boolean and nothing else (F4, accepted)'
);

reset role;
set local request.jwt.claims = '{}';

select is_empty(
  $$ select a.tbl from pgtap_matrix_fp a join pgtap_matrix_fp0 b using (tbl) where a.fp is distinct from b.fp $$,
  'owner read after E1''s denied updates/deletes: no fixture row changed'
);

-- ---------------------------------------------------------------------------
-- E2: the second linked, activated employee (symmetric to E1)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000702"}';

select is(
  public.current_employee_id(),
  '00000000-0000-4000-8000-000000000732'::uuid,
  'E2 resolves to their own activated employee row (the attacker is linked)'
);
select is(
  (select array_agg(id) from public.profiles),
  array['00000000-0000-4000-8000-000000000702'::uuid],
  'E2 selecting profiles sees exactly their own row'
);
select results_eq(
  $$ select milestone_id, employee_id from public.milestone_result_lines $$,
  $$ values ('00000000-0000-4000-8000-000000000721'::uuid, '00000000-0000-4000-8000-000000000732'::uuid) $$,
  'E2 selecting result lines sees exactly their own MA_appr line'
);
select is_empty(
  $$ select id from public.milestone_result_lines where employee_id = '00000000-0000-4000-8000-000000000731' $$,
  'E2 selecting result lines by E1''s employee_id sees none'
);
select is_empty(
  $$ select id from public.milestone_result_lines where id = current_setting('pgtap.e1_line_ma')::uuid $$,
  'E2 selecting E1''s MA_appr line by its id sees none'
);
select is_empty(
  $$ select id from public.milestone_result_lines where id = '00000000-0000-4000-8000-000000000751' $$,
  'E2 selecting the stored MA_draft line by its id sees none'
);
select is_empty($$ select milestone_id from public.milestone_results $$, 'E2 selecting milestone_results sees none (privacy split)');
select is_empty($$ select id from public.employees $$, 'E2 selecting employees sees none, including their own row');
select is_empty($$ select id from public.milestone_engagements $$, 'E2 selecting milestone_engagements sees none');
select is_empty($$ select id from public.projects $$, 'E2 selecting projects sees none');
select is_empty($$ select id from public.milestones $$, 'E2 selecting milestones sees none');
select is_empty($$ select id from public.job_roles $$, 'E2 selecting job_roles sees none');
select is_empty($$ select id from public.bonus_settings $$, 'E2 selecting bonus_settings sees none');
select is_empty($$ select project_id from public.project_budget_exposure $$, 'E2 selecting project_budget_exposure sees none');
select is_empty($$ select employee_id from public.employee_time_share_totals $$, 'E2 selecting employee_time_share_totals sees none');
select is_empty(
  $$ select milestone_id from public.milestone_payout_summary('00000000-0000-4000-8000-000000000722') $$,
  'E2 calling milestone_payout_summary(MA_draft) gets none'
);
select is_empty(
  $$ select engagement_id from public.milestone_payout_lines('00000000-0000-4000-8000-000000000722') $$,
  'E2 calling milestone_payout_lines(MA_draft) gets none'
);
select is_empty(
  $$ select milestone_id from public.milestone_payout_summary('00000000-0000-4000-8000-000000000721') $$,
  'E2 calling milestone_payout_summary(MA_appr) gets none'
);
select is_empty(
  $$ select engagement_id from public.milestone_payout_lines('00000000-0000-4000-8000-000000000721') $$,
  'E2 calling milestone_payout_lines(MA_appr) gets none'
);
select ok(
  (select public.kpi_multiplier(m.kpi_schedule, m.kpi_budget, m.kpi_quality, m.kpi_risk)
   from public.milestones m where m.id = '00000000-0000-4000-8000-000000000722') is null,
  'E2 computing kpi_multiplier for MA_draft gets null'
);
select throws_ok(
  $$ update public.milestone_result_lines set bonus = 99999.00 where id = current_setting('pgtap.e2_line_ma')::uuid $$,
  '42501', null, 'E2 updating their own result line is denied (42501, no update privilege)'
);
select throws_ok(
  $$ delete from public.milestone_result_lines where id = current_setting('pgtap.e2_line_ma')::uuid $$,
  '42501', null, 'E2 deleting their own result line is denied (42501, no delete privilege)'
);
select is_empty(
  $$ update public.employees set full_name = 'pgTAP Matrix E2 renamed' where id = '00000000-0000-4000-8000-000000000732' returning id $$,
  'E2 updating their own employees row affects 0 rows'
);
select is_empty(
  $$ delete from public.employees where id = '00000000-0000-4000-8000-000000000732' returning id $$,
  'E2 deleting their own employees row affects 0 rows'
);
select is_empty(
  $$ update public.milestone_engagements set rating = 5 where id = '00000000-0000-4000-8000-000000000744' returning id $$,
  'E2 updating their own MA_draft engagement affects 0 rows'
);
select throws_ok(
  $$ select public.approve_milestone('00000000-0000-4000-8000-000000000722') $$,
  '42501', null, 'E2 approving MA_draft is denied (42501)'
);
select is(
  public.is_approved_milestone('00000000-0000-4000-8000-000000000723'),
  false,
  'E2 calling is_approved_milestone(MB) gets a boolean (F4, accepted)'
);

reset role;
set local request.jwt.claims = '{}';

select is_empty(
  $$ select a.tbl from pgtap_matrix_fp a join pgtap_matrix_fp0 b using (tbl) where a.fp is distinct from b.fp $$,
  'owner read after E2''s denied updates/deletes: no fixture row changed'
);

-- ---------------------------------------------------------------------------
-- SB: foreign Supervisor against everything of SA's (risk #2)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000704"}';

-- profiles (F1)
select is(
  (select array_agg(id) from public.profiles),
  array['00000000-0000-4000-8000-000000000704'::uuid],
  'SB selecting profiles sees exactly their own row (F1)'
);
select is_empty(
  $$ select id from public.profiles
     where id in ('00000000-0000-4000-8000-000000000703', '00000000-0000-4000-8000-000000000701',
                  '00000000-0000-4000-8000-000000000705') $$,
  'SB selecting SA''s, E1''s or AD''s profile by id sees none (F1)'
);
select throws_ok(
  $$ insert into public.profiles (id, email) values ('00000000-0000-4000-8000-000000000799', 'matrix-probe@pgtap.test') $$,
  '42501', null, 'SB inserting a profile is denied (42501)'
);
select is_empty(
  $$ update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-000000000704' returning id $$,
  'SB updating own profile role affects 0 rows'
);
select is_empty(
  $$ update public.profiles set role = 'supervisor' where id = '00000000-0000-4000-8000-000000000701' returning id $$,
  'SB updating E1''s profile role affects 0 rows'
);
select is_empty(
  $$ delete from public.profiles where id = '00000000-0000-4000-8000-000000000701' returning id $$,
  'SB deleting E1''s profile affects 0 rows'
);

-- config
select is(
  (select count(*)::int from public.job_roles),
  current_setting('pgtap.total_job_roles')::int,
  'SB selecting job_roles sees all of them'
);
select isnt_empty($$ select id from public.bonus_settings $$, 'SB selecting bonus_settings sees the row');
select throws_ok(
  $$ insert into public.job_roles (name, weight) values ('pgTAP Matrix SB Role', 1.00) $$,
  '42501', null, 'SB inserting a job role is denied (42501)'
);
select is_empty(
  $$ update public.job_roles set weight = 2.00 where id = '00000000-0000-4000-8000-000000000708' returning id $$,
  'SB updating a job role affects 0 rows'
);
select is_empty(
  $$ update public.bonus_settings set multiplier_max = 1.50 where id returning id $$,
  'SB updating bonus_settings affects 0 rows'
);
select is_empty(
  $$ delete from public.job_roles where id = '00000000-0000-4000-8000-000000000708' returning id $$,
  'SB deleting a job role affects 0 rows'
);
select is_empty(
  $$ delete from public.bonus_settings returning id $$,
  'SB deleting bonus_settings affects 0 rows'
);

-- projects
select is_empty(
  $$ select id from public.projects where id in ('00000000-0000-4000-8000-000000000711', '00000000-0000-4000-8000-000000000713') $$,
  'SB selecting PA and PR sees none'
);
select is_empty(
  $$ update public.projects set notes = 'SB was here' where id = '00000000-0000-4000-8000-000000000711' returning id $$,
  'SB updating PA affects 0 rows'
);
select is_empty(
  $$ update public.projects set supervisor_id = '00000000-0000-4000-8000-000000000704'
     where id = '00000000-0000-4000-8000-000000000711' returning id $$,
  'SB taking over PA (supervisor_id) affects 0 rows'
);
select is_empty(
  $$ delete from public.projects where id = '00000000-0000-4000-8000-000000000711' returning id $$,
  'SB deleting PA affects 0 rows'
);

-- milestones
select is_empty(
  $$ select id from public.milestones where project_id = '00000000-0000-4000-8000-000000000711' $$,
  'SB selecting PA''s milestones sees none'
);
select throws_ok(
  $$ insert into public.milestones (project_id, name, start_date, end_date, target_pool)
     values ('00000000-0000-4000-8000-000000000711', 'pgTAP Matrix SB probe', '2026-07-01', '2026-07-31', 100.00) $$,
  '42501', null, 'SB inserting a milestone into PA is denied (42501)'
);
select is_empty(
  $$ update public.milestones set name = 'pgTAP Matrix SB renamed' where id = '00000000-0000-4000-8000-000000000722' returning id $$,
  'SB updating A''s milestone MA_draft affects 0 rows'
);
select is_empty(
  $$ update public.milestones set kpi_schedule = 0, kpi_budget = 0, kpi_quality = 0, kpi_risk = 0
     where id = '00000000-0000-4000-8000-000000000722' returning id $$,
  'SB scoring A''s milestone MA_draft affects 0 rows'
);
select is_empty(
  $$ delete from public.milestones where id = '00000000-0000-4000-8000-000000000722' returning id $$,
  'SB deleting A''s milestone MA_draft affects 0 rows'
);
select is_empty(
  $$ delete from public.milestones where id = '00000000-0000-4000-8000-000000000721' returning id $$,
  'SB deleting A''s approved milestone MA_appr affects 0 rows'
);

-- employees
select is_empty(
  $$ select id from public.employees
     where id in ('00000000-0000-4000-8000-000000000731', '00000000-0000-4000-8000-000000000732',
                  '00000000-0000-4000-8000-000000000733') $$,
  'SB selecting A''s employees sees none'
);
select is_empty(
  $$ update public.employees set full_name = 'pgTAP Matrix SB renamed' where id = '00000000-0000-4000-8000-000000000733' returning id $$,
  'SB updating A''s employee affects 0 rows'
);
select is_empty(
  $$ update public.employees set supervisor_id = '00000000-0000-4000-8000-000000000704'
     where id = '00000000-0000-4000-8000-000000000733' returning id $$,
  'SB taking over A''s employee (supervisor_id) affects 0 rows'
);
select is_empty(
  $$ delete from public.employees where id = '00000000-0000-4000-8000-000000000731' returning id $$,
  'SB deleting A''s employee affects 0 rows'
);

-- engagements
select is_empty(
  $$ select id from public.milestone_engagements
     where milestone_id in ('00000000-0000-4000-8000-000000000721', '00000000-0000-4000-8000-000000000722') $$,
  'SB selecting engagements on PA sees none'
);
select throws_ok(
  $$ insert into public.milestone_engagements (milestone_id, employee_id, time_share, rating)
     values ('00000000-0000-4000-8000-000000000722', '00000000-0000-4000-8000-000000000734', 0.10, 3) $$,
  '42501', null, 'SB inserting an engagement on A''s MA_draft is denied (42501)'
);
select is_empty(
  $$ update public.milestone_engagements set rating = 1 where id = '00000000-0000-4000-8000-000000000743' returning id $$,
  'SB updating A''s engagement affects 0 rows'
);
select is_empty(
  $$ delete from public.milestone_engagements where id = '00000000-0000-4000-8000-000000000743' returning id $$,
  'SB deleting A''s engagement affects 0 rows'
);

-- snapshot, views, RPCs
select is_empty(
  $$ select milestone_id from public.milestone_results where project_id = '00000000-0000-4000-8000-000000000711' $$,
  'SB selecting PA''s milestone_results sees none'
);
select is_empty(
  $$ select id from public.milestone_result_lines where project_id = '00000000-0000-4000-8000-000000000711' $$,
  'SB selecting PA''s result lines sees none'
);
select is_empty(
  $$ select project_id from public.project_budget_exposure where project_id = '00000000-0000-4000-8000-000000000711' $$,
  'SB selecting project_budget_exposure sees no PA row'
);
select is_empty(
  $$ select employee_id from public.employee_time_share_totals
     where employee_id in ('00000000-0000-4000-8000-000000000731', '00000000-0000-4000-8000-000000000732',
                           '00000000-0000-4000-8000-000000000733') $$,
  'SB selecting employee_time_share_totals sees none for A''s employees'
);
select is_empty(
  $$ select milestone_id from public.milestone_payout_summary('00000000-0000-4000-8000-000000000722') $$,
  'SB calling milestone_payout_summary(MA_draft) gets none'
);
select is_empty(
  $$ select engagement_id from public.milestone_payout_lines('00000000-0000-4000-8000-000000000722') $$,
  'SB calling milestone_payout_lines(MA_draft) gets none'
);
select is_empty(
  $$ select milestone_id from public.milestone_payout_summary('00000000-0000-4000-8000-000000000721') $$,
  'SB calling milestone_payout_summary(MA_appr) gets none'
);
select is_empty(
  $$ select engagement_id from public.milestone_payout_lines('00000000-0000-4000-8000-000000000721') $$,
  'SB calling milestone_payout_lines(MA_appr) gets none'
);
select ok(
  (select public.kpi_multiplier(m.kpi_schedule, m.kpi_budget, m.kpi_quality, m.kpi_risk)
   from public.milestones m where m.id = '00000000-0000-4000-8000-000000000722') is null,
  'SB computing kpi_multiplier for MA_draft gets null'
);
select throws_ok(
  $$ select public.approve_milestone('00000000-0000-4000-8000-000000000722') $$,
  '42501', null, 'SB approving A''s MA_draft is denied (42501)'
);
select is(
  public.is_approved_milestone('00000000-0000-4000-8000-000000000723'),
  false,
  'SB calling is_approved_milestone(MB) gets a boolean (F4, accepted)'
);

reset role;
set local request.jwt.claims = '{}';

select is_empty(
  $$ select a.tbl from pgtap_matrix_fp a join pgtap_matrix_fp0 b using (tbl) where a.fp is distinct from b.fp $$,
  'owner read after SB''s denied updates/deletes: no fixture row changed'
);

-- ---------------------------------------------------------------------------
-- SA: owner. Denied cells first (then an owner check), then every "allow" cell.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000703"}';

select is(
  (select array_agg(id) from public.profiles),
  array['00000000-0000-4000-8000-000000000703'::uuid],
  'SA selecting profiles sees exactly their own row (F1)'
);
select is_empty(
  $$ select id from public.profiles
     where id in ('00000000-0000-4000-8000-000000000704', '00000000-0000-4000-8000-000000000701',
                  '00000000-0000-4000-8000-000000000705') $$,
  'SA selecting SB''s, E1''s or AD''s profile by id sees none (F1)'
);
select throws_ok(
  $$ insert into public.profiles (id, email) values ('00000000-0000-4000-8000-000000000799', 'matrix-probe@pgtap.test') $$,
  '42501', null, 'SA inserting a profile is denied (42501)'
);
select is_empty(
  $$ update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-000000000703' returning id $$,
  'SA updating own profile role affects 0 rows'
);
select is_empty(
  $$ update public.profiles set display_name = 'pgTAP Matrix renamed' where id = '00000000-0000-4000-8000-000000000701' returning id $$,
  'SA updating E1''s profile affects 0 rows'
);
select is_empty(
  $$ delete from public.profiles where id = '00000000-0000-4000-8000-000000000703' returning id $$,
  'SA deleting own profile affects 0 rows'
);
select is(
  (select count(*)::int from public.job_roles),
  current_setting('pgtap.total_job_roles')::int,
  'SA selecting job_roles sees all of them'
);
select isnt_empty($$ select id from public.bonus_settings $$, 'SA selecting bonus_settings sees the row');
select throws_ok(
  $$ insert into public.job_roles (name, weight) values ('pgTAP Matrix SA Role', 1.00) $$,
  '42501', null, 'SA inserting a job role is denied (42501)'
);
select is_empty(
  $$ update public.job_roles set weight = 2.00 where id = '00000000-0000-4000-8000-000000000708' returning id $$,
  'SA updating a job role affects 0 rows'
);
select is_empty(
  $$ update public.bonus_settings set multiplier_max = 1.50 where id returning id $$,
  'SA updating bonus_settings affects 0 rows'
);
select is_empty(
  $$ delete from public.job_roles where id = '00000000-0000-4000-8000-000000000708' returning id $$,
  'SA deleting a job role affects 0 rows'
);
select is_empty(
  $$ delete from public.bonus_settings returning id $$,
  'SA deleting bonus_settings affects 0 rows'
);
select is_empty(
  $$ delete from public.projects where id = '00000000-0000-4000-8000-000000000711' returning id $$,
  'SA deleting own project PA affects 0 rows'
);
select is_empty(
  $$ delete from public.milestones where id = '00000000-0000-4000-8000-000000000722' returning id $$,
  'SA deleting own milestone MA_draft affects 0 rows'
);
select is_empty(
  $$ delete from public.employees where id = '00000000-0000-4000-8000-000000000733' returning id $$,
  'SA deleting own employee E3 affects 0 rows'
);
select throws_ok(
  $$ insert into public.milestone_engagements (milestone_id, employee_id, time_share, rating)
     values ('00000000-0000-4000-8000-000000000721', '00000000-0000-4000-8000-000000000733', 0.10, 3) $$,
  'MR007', null, 'SA inserting an engagement on approved MA_appr raises MR007'
);
select throws_ok(
  $$ update public.milestone_engagements set rating = 5 where id = '00000000-0000-4000-8000-000000000741' $$,
  'MR007', null, 'SA updating an engagement of approved MA_appr raises MR007'
);
select throws_ok(
  $$ delete from public.milestone_engagements where id = '00000000-0000-4000-8000-000000000741' $$,
  'MR007', null, 'SA deleting an engagement of approved MA_appr raises MR007'
);

reset role;
set local request.jwt.claims = '{}';

select is_empty(
  $$ select a.tbl from pgtap_matrix_fp a join pgtap_matrix_fp0 b using (tbl) where a.fp is distinct from b.fp $$,
  'owner read after SA''s denied updates/deletes: no fixture row changed'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000703"}';

-- projects
select isnt_empty(
  $$ select id from public.projects where id = '00000000-0000-4000-8000-000000000711' $$,
  'SA selecting own project PA sees it'
);
select isnt_empty(
  $$ update public.projects set notes = 'pgTAP Matrix SA note' where id = '00000000-0000-4000-8000-000000000711' returning id $$,
  'SA updating own project PA affects 1 row'
);

-- milestones
select is(
  (select count(*)::int from public.milestones where project_id = '00000000-0000-4000-8000-000000000711'),
  2,
  'SA selecting PA''s milestones sees both (MA_appr, MA_draft)'
);
select lives_ok(
  $$ insert into public.milestones (id, project_id, name, start_date, end_date, target_pool)
     values ('00000000-0000-4000-8000-000000000725', '00000000-0000-4000-8000-000000000711',
             'pgTAP Matrix MA new', '2026-07-01', '2026-07-31', 100.00) $$,
  'SA inserting a milestone into own project PA succeeds'
);
select isnt_empty(
  $$ update public.milestones set name = 'pgTAP Matrix MA draft renamed' where id = '00000000-0000-4000-8000-000000000722' returning id $$,
  'SA updating own milestone MA_draft affects 1 row'
);

-- employees
select is(
  (select count(*)::int from public.employees
   where id in ('00000000-0000-4000-8000-000000000731', '00000000-0000-4000-8000-000000000732',
                '00000000-0000-4000-8000-000000000733')),
  3,
  'SA selecting own employees sees E1, E2 and E3'
);
select lives_ok(
  $$ insert into public.employees (full_name, email, job_role_id)
     values ('pgTAP Matrix SA new', 'matrix-sa-new@pgtap.test', '00000000-0000-4000-8000-000000000708') $$,
  'SA inserting an own employee succeeds'
);
select isnt_empty(
  $$ update public.employees set full_name = 'pgTAP Matrix E3 renamed' where id = '00000000-0000-4000-8000-000000000733' returning id $$,
  'SA updating own employee E3 affects 1 row'
);

-- engagements: all four on an open milestone
select is(
  (select count(*)::int from public.milestone_engagements
   where milestone_id in ('00000000-0000-4000-8000-000000000721', '00000000-0000-4000-8000-000000000722')),
  4,
  'SA selecting engagements on PA sees all four'
);
select lives_ok(
  $$ insert into public.milestone_engagements (milestone_id, employee_id, time_share, rating)
     values ('00000000-0000-4000-8000-000000000722', '00000000-0000-4000-8000-000000000733', 0.10, 3) $$,
  'SA inserting an engagement of E3 on MA_draft succeeds'
);
select isnt_empty(
  $$ update public.milestone_engagements set rating = 4
     where milestone_id = '00000000-0000-4000-8000-000000000722'
       and employee_id = '00000000-0000-4000-8000-000000000733' returning id $$,
  'SA updating an engagement on MA_draft affects 1 row'
);
select isnt_empty(
  $$ delete from public.milestone_engagements
     where milestone_id = '00000000-0000-4000-8000-000000000722'
       and employee_id = '00000000-0000-4000-8000-000000000733' returning id $$,
  'SA deleting an engagement on MA_draft affects 1 row'
);

-- snapshot, views, RPCs
select is(
  (select count(*)::int from public.milestone_results where project_id = '00000000-0000-4000-8000-000000000711'),
  2,
  'SA selecting milestone_results sees PA''s rows (MA_appr, injected MA_draft)'
);
select is(
  (select count(*)::int from public.milestone_result_lines where project_id = '00000000-0000-4000-8000-000000000711'),
  3,
  'SA selecting result lines sees PA''s rows (E1+E2 on MA_appr, E1 on MA_draft)'
);
select isnt_empty(
  $$ select project_id from public.project_budget_exposure where project_id = '00000000-0000-4000-8000-000000000711' $$,
  'SA selecting project_budget_exposure sees the PA row'
);
select is(
  (select count(*)::int from public.employee_time_share_totals
   where employee_id in ('00000000-0000-4000-8000-000000000731', '00000000-0000-4000-8000-000000000732')),
  2,
  'SA selecting employee_time_share_totals sees own employees E1 and E2'
);
-- E1's open time share: MA_draft 0.30 only. MA_appr (0.50) and MR_appr (0.10) are approved, and
-- MC (0.40) is active but in the cancelled project PC: 0.30; 0.30 > 1 is false.
select results_eq(
  $$ select open_total, over_allocated from public.employee_time_share_totals
     where employee_id = '00000000-0000-4000-8000-000000000731' $$,
  $$ values (0.30::numeric, false) $$,
  'SA selecting employee_time_share_totals for E1 excludes the engagement in cancelled PC: 0.30'
);
select isnt_empty(
  $$ select milestone_id from public.milestone_payout_summary('00000000-0000-4000-8000-000000000722') $$,
  'SA calling milestone_payout_summary(MA_draft) gets rows'
);
select isnt_empty(
  $$ select engagement_id from public.milestone_payout_lines('00000000-0000-4000-8000-000000000722') $$,
  'SA calling milestone_payout_lines(MA_draft) gets rows'
);
select throws_ok(
  $$ select * from public.milestone_payout_summary('00000000-0000-4000-8000-000000000721') $$,
  'MR015',
  null,
  'SA calling milestone_payout_summary(MA_appr) gets MR015 (read the snapshot instead)'
);
select throws_ok(
  $$ select * from public.milestone_payout_lines('00000000-0000-4000-8000-000000000721') $$,
  'MR015',
  null,
  'SA calling milestone_payout_lines(MA_appr) gets MR015 (read the snapshot instead)'
);
select ok(
  (select public.kpi_multiplier(m.kpi_schedule, m.kpi_budget, m.kpi_quality, m.kpi_risk)
   from public.milestones m where m.id = '00000000-0000-4000-8000-000000000722') is not null,
  'SA computing kpi_multiplier for MA_draft gets a value'
);
select is(
  public.is_approved_milestone('00000000-0000-4000-8000-000000000723'),
  false,
  'SA calling is_approved_milestone(MB) gets a boolean (F4, accepted)'
);

-- New baseline: SA's allowed writes changed fixture rows on purpose.
reset role;
set local request.jwt.claims = '{}';
truncate pgtap_matrix_fp0;
insert into pgtap_matrix_fp0 select * from pgtap_matrix_fp;

-- ---------------------------------------------------------------------------
-- AD: admin. Denied cells first (then an owner check), then every "allow" cell.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000705"}';

select throws_ok(
  $$ insert into public.profiles (id, email) values ('00000000-0000-4000-8000-000000000799', 'matrix-probe@pgtap.test') $$,
  '42501', null, 'AD inserting a profile is denied (42501)'
);
select is_empty(
  $$ delete from public.profiles where id = '00000000-0000-4000-8000-000000000706' returning id $$,
  'AD deleting U''s profile affects 0 rows'
);
select throws_ok(
  $$ insert into public.bonus_settings select * from public.bonus_settings $$,
  '42501', null, 'AD inserting a bonus_settings row is denied (42501)'
);
select is_empty(
  $$ delete from public.job_roles where id = '00000000-0000-4000-8000-000000000708' returning id $$,
  'AD deleting a job role affects 0 rows'
);
select is_empty(
  $$ delete from public.bonus_settings returning id $$,
  'AD deleting bonus_settings affects 0 rows'
);
select is_empty(
  $$ delete from public.projects where id = '00000000-0000-4000-8000-000000000711' returning id $$,
  'AD deleting PA affects 0 rows'
);
select throws_ok(
  $$ insert into public.milestones (project_id, name, start_date, end_date, target_pool)
     values ('00000000-0000-4000-8000-000000000711', 'pgTAP Matrix AD probe', '2026-08-01', '2026-08-31', 100.00) $$,
  '42501', null, 'AD inserting a milestone into PA is denied (42501)'
);
select is_empty(
  $$ update public.milestones set name = 'pgTAP Matrix AD renamed' where id = '00000000-0000-4000-8000-000000000722' returning id $$,
  'AD updating MA_draft affects 0 rows'
);
select is_empty(
  $$ delete from public.milestones where id = '00000000-0000-4000-8000-000000000722' returning id $$,
  'AD deleting MA_draft affects 0 rows'
);
select throws_ok(
  $$ insert into public.milestone_engagements (milestone_id, employee_id, time_share, rating)
     values ('00000000-0000-4000-8000-000000000722', '00000000-0000-4000-8000-000000000733', 0.10, 3) $$,
  '42501', null, 'AD inserting an engagement on MA_draft is denied (42501)'
);
select is_empty(
  $$ update public.milestone_engagements set rating = 1 where id = '00000000-0000-4000-8000-000000000743' returning id $$,
  'AD updating an engagement on MA_draft affects 0 rows'
);
select is_empty(
  $$ delete from public.milestone_engagements where id = '00000000-0000-4000-8000-000000000743' returning id $$,
  'AD deleting an engagement on MA_draft affects 0 rows'
);
select throws_ok(
  $$ select public.approve_milestone('00000000-0000-4000-8000-000000000722') $$,
  '42501', null, 'AD approving MA_draft is denied (42501)'
);

reset role;
set local request.jwt.claims = '{}';

select is_empty(
  $$ select a.tbl from pgtap_matrix_fp a join pgtap_matrix_fp0 b using (tbl) where a.fp is distinct from b.fp $$,
  'owner read after AD''s denied updates/deletes: no fixture row changed'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000705"}';

-- profiles and config
select is(
  (select count(*)::int from public.profiles),
  current_setting('pgtap.total_profiles')::int,
  'AD selecting profiles sees all of them'
);
select isnt_empty(
  $$ update public.profiles set display_name = 'pgTAP Matrix U' where id = '00000000-0000-4000-8000-000000000706' returning id $$,
  'AD updating U''s profile affects 1 row'
);
select is(
  (select count(*)::int from public.job_roles),
  current_setting('pgtap.total_job_roles')::int,
  'AD selecting job_roles sees all of them'
);
select isnt_empty($$ select id from public.bonus_settings $$, 'AD selecting bonus_settings sees the row');
select lives_ok(
  $$ insert into public.job_roles (id, name, weight)
     values ('00000000-0000-4000-8000-000000000709', 'pgTAP Matrix AD Role', 1.00) $$,
  'AD inserting a job role succeeds'
);
select isnt_empty(
  $$ update public.job_roles set weight = 1.10 where id = '00000000-0000-4000-8000-000000000708' returning id $$,
  'AD updating a job role affects 1 row'
);
select isnt_empty(
  $$ update public.bonus_settings set rating_factor_5 = 1.20 where id returning id $$,
  'AD updating bonus_settings affects 1 row'
);

-- projects, milestones, employees, engagements
select isnt_empty(
  $$ select id from public.projects where id = '00000000-0000-4000-8000-000000000711' $$,
  'AD selecting PA sees it'
);
select isnt_empty(
  $$ update public.projects set notes = 'pgTAP Matrix AD note' where id = '00000000-0000-4000-8000-000000000711' returning id $$,
  'AD updating PA affects 1 row'
);
select is(
  (select count(*)::int from public.milestones
   where id in ('00000000-0000-4000-8000-000000000721', '00000000-0000-4000-8000-000000000722')),
  2,
  'AD selecting PA''s milestones sees them'
);
select is(
  (select count(*)::int from public.employees
   where id in ('00000000-0000-4000-8000-000000000731', '00000000-0000-4000-8000-000000000732',
                '00000000-0000-4000-8000-000000000733', '00000000-0000-4000-8000-000000000734')),
  4,
  'AD selecting employees sees A''s and B''s'
);
select lives_ok(
  $$ insert into public.employees (supervisor_id, full_name, email, job_role_id)
     values ('00000000-0000-4000-8000-000000000703', 'pgTAP Matrix AD new', 'matrix-ad-new@pgtap.test',
             '00000000-0000-4000-8000-000000000708') $$,
  'AD inserting an employee for SA succeeds'
);
select isnt_empty(
  $$ update public.employees set full_name = 'pgTAP Matrix E3 by AD' where id = '00000000-0000-4000-8000-000000000733' returning id $$,
  'AD updating A''s employee E3 affects 1 row'
);
select is(
  (select count(*)::int from public.milestone_engagements
   where milestone_id in ('00000000-0000-4000-8000-000000000721', '00000000-0000-4000-8000-000000000722')),
  4,
  'AD selecting engagements on PA sees them'
);

-- snapshot, views, RPCs
select is(
  (select count(*)::int from public.milestone_results
   where milestone_id in ('00000000-0000-4000-8000-000000000721', '00000000-0000-4000-8000-000000000722',
                          '00000000-0000-4000-8000-000000000724')),
  3,
  'AD selecting milestone_results sees every fixture header'
);
select is(
  (select count(*)::int from public.milestone_result_lines where milestone_id::text like '00000000-0000-4000-8000-0000000007%'),
  4,
  'AD selecting result lines sees every fixture line'
);
select isnt_empty(
  $$ select project_id from public.project_budget_exposure where project_id = '00000000-0000-4000-8000-000000000711' $$,
  'AD selecting project_budget_exposure sees the PA row'
);
select is(
  (select count(*)::int from public.employee_time_share_totals
   where employee_id in ('00000000-0000-4000-8000-000000000731', '00000000-0000-4000-8000-000000000732')),
  2,
  'AD selecting employee_time_share_totals sees A''s employees E1 and E2'
);
-- E1's open time share: MA_draft 0.30 only. MA_appr (0.50) and MR_appr (0.10) are approved, and
-- MC (0.40) is active but in the cancelled project PC: 0.30; 0.30 > 1 is false.
select results_eq(
  $$ select open_total, over_allocated from public.employee_time_share_totals
     where employee_id = '00000000-0000-4000-8000-000000000731' $$,
  $$ values (0.30::numeric, false) $$,
  'AD selecting employee_time_share_totals for E1 excludes the engagement in cancelled PC: 0.30'
);
select isnt_empty(
  $$ select milestone_id from public.milestone_payout_summary('00000000-0000-4000-8000-000000000722') $$,
  'AD calling milestone_payout_summary(MA_draft) gets rows'
);
select isnt_empty(
  $$ select engagement_id from public.milestone_payout_lines('00000000-0000-4000-8000-000000000722') $$,
  'AD calling milestone_payout_lines(MA_draft) gets rows'
);
select throws_ok(
  $$ select * from public.milestone_payout_summary('00000000-0000-4000-8000-000000000721') $$,
  'MR015',
  null,
  'AD calling milestone_payout_summary(MA_appr) gets MR015 (read the snapshot instead)'
);
select throws_ok(
  $$ select * from public.milestone_payout_lines('00000000-0000-4000-8000-000000000721') $$,
  'MR015',
  null,
  'AD calling milestone_payout_lines(MA_appr) gets MR015 (read the snapshot instead)'
);
select ok(
  (select public.kpi_multiplier(m.kpi_schedule, m.kpi_budget, m.kpi_quality, m.kpi_risk)
   from public.milestones m where m.id = '00000000-0000-4000-8000-000000000722') is not null,
  'AD computing kpi_multiplier for MA_draft gets a value'
);
select is(
  public.is_approved_milestone('00000000-0000-4000-8000-000000000723'),
  false,
  'AD calling is_approved_milestone(MB) gets a boolean (F4, accepted)'
);

-- ---------------------------------------------------------------------------
-- Reassignment (F3): AD hands PR to SB. Visibility of MR_appr's snapshot follows the current owner;
-- the employee keeps their own line.
-- ---------------------------------------------------------------------------
select isnt_empty(
  $$ update public.projects set supervisor_id = '00000000-0000-4000-8000-000000000704'
     where id = '00000000-0000-4000-8000-000000000713' returning id $$,
  'AD reassigning PR (only milestone approved) to SB affects 1 row'
);
select isnt_empty(
  $$ select milestone_id from public.milestone_results where milestone_id = '00000000-0000-4000-8000-000000000724' $$,
  'after reassignment AD still sees MR_appr''s header'
);

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000704"}';

select isnt_empty(
  $$ select milestone_id from public.milestone_results where milestone_id = '00000000-0000-4000-8000-000000000724' $$,
  'after reassignment SB sees MR_appr''s header'
);
select is(
  (select count(*)::int from public.milestone_result_lines where milestone_id = '00000000-0000-4000-8000-000000000724'),
  1,
  'after reassignment SB sees MR_appr''s line'
);

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000703"}';

select is_empty(
  $$ select milestone_id from public.milestone_results where milestone_id = '00000000-0000-4000-8000-000000000724' $$,
  'after reassignment SA sees none of MR_appr''s header'
);
select is_empty(
  $$ select id from public.milestone_result_lines where milestone_id = '00000000-0000-4000-8000-000000000724' $$,
  'after reassignment SA sees none of MR_appr''s lines'
);

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000701"}';

select results_eq(
  $$ select milestone_id, employee_id from public.milestone_result_lines
     where milestone_id = '00000000-0000-4000-8000-000000000724' $$,
  $$ values ('00000000-0000-4000-8000-000000000724'::uuid, '00000000-0000-4000-8000-000000000731'::uuid) $$,
  'after reassignment E1 still sees their own MR_appr line'
);

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000706"}';

select is_empty(
  $$ select id from public.milestone_result_lines where milestone_id = '00000000-0000-4000-8000-000000000724' $$,
  'after reassignment U sees none of MR_appr''s lines'
);

reset role;
set local request.jwt.claims = '{}';

select * from finish();

rollback;
