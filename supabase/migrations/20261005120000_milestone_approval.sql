-- Milestone approval (S-05; FR-012, FR-016, FR-017, FR-018, US-01). A Supervisor approves a scored,
-- staffed milestone; approval saves a frozen snapshot of the computed result and from then on the
-- database rejects every change to that milestone. Employees read their own Approved lines only.
-- Every rule is enforced here, so the app-side checks are a convenience only.
--
-- Custom SQLSTATEs added to the catalog (20261004120000_milestone_kpi_and_payouts.sql):
--   MR014 milestone_not_approvable   approve_milestone on a cancelled, unscored or unstaffed
--                                     milestone; or status set to 'approved' outside
--                                     approve_milestone (no snapshot row), including on insert
--   MR015 milestone_approved          any update of an approved milestone, or a second approval
-- MR003 (closed project) keeps coming from milestones_check_parent, also on approval, and rolls the
-- snapshot back with it. MR007 now also covers engagement writes on approved milestones.
--
-- Approval is irreversible. 'approved' is terminal: there is no un-approve, no correction and no
-- re-snapshot. milestones_check_frozen rejects every update of an approved milestone, also for
-- writes without a JWT (seed, Studio); a mistake needs an operator fix in the database.
--
-- Privacy split. The snapshot is two tables:
--   milestone_results       one header per approved milestone: pool, payout total, residual, M,
--                           multiplier bounds, KPI scores. Supervisor/Admin only, NO employee
--                           policy.
--   milestone_result_lines  one row per engagement: the employee-readable figures. It deliberately
--                           has NO share, payout pool, payout total or residual: with any of them an
--                           employee could derive colleagues' bonuses (pool minus own bonus, or own
--                           bonus divided by own share). The Supervisor view rebuilds share as
--                           weighted_contribution / sum(weighted_contribution) from the lines.
--
-- One-statement snapshot rule (S-04 review-fixes.md). The header and its lines are inserted by ONE
-- data-modifying CTE statement that calls milestone_payout_lines, kpi_multiplier and
-- capped_payout_pool. Stable functions (plpgsql included) use the snapshot of the calling query, so
-- every figure comes from one consistent snapshot; the header's payout_total and engagement_count
-- are aggregated from the same CTE rows that become the lines, never from a second call. Only then
-- is the status set to 'approved', which milestones_check_frozen allows only when the header exists.
--
-- The "open milestone" exclusion filters (MR007, MR008, MR012, employee_time_share_totals) now
-- treat 'approved' as closed alongside 'completed' and 'cancelled'. project_budget_exposure reserves
-- an approved milestone's stored payout_pool instead of its target_pool.

-- ---------------------------------------------------------------------------
-- Status: add 'approved'.
-- ---------------------------------------------------------------------------
alter table public.milestones drop constraint milestones_status_valid;
alter table public.milestones
  add constraint milestones_status_valid
  check (status in ('planned', 'active', 'completed', 'cancelled', 'approved'));

-- ---------------------------------------------------------------------------
-- milestone_results: the frozen header, one row per approved milestone. Written only by
-- approve_milestone (security definer). Supervisor/Admin only. The CHECKs keep the pool rules in
-- the database: payouts never exceed the payout pool, which never exceeds the target pool.
-- ---------------------------------------------------------------------------
create table public.milestone_results (
  milestone_id uuid primary key references public.milestones (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  project_name text not null,
  milestone_name text not null,
  start_date date not null,
  end_date date not null,
  target_pool numeric(12, 2) not null,
  kpi_schedule smallint not null,
  kpi_budget smallint not null,
  kpi_quality smallint not null,
  kpi_risk smallint not null,
  multiplier numeric not null,
  multiplier_min numeric(4, 2) not null,
  multiplier_max numeric(4, 2) not null,
  budget_share numeric not null,
  payout_pool numeric(12, 2) not null,
  payout_total numeric(12, 2) not null,
  residual numeric(12, 2) not null,
  engagement_count integer not null,
  approved_at timestamptz not null default now(),
  approved_by uuid references public.profiles (id) on delete set null,
  constraint milestone_results_payout_pool_nonnegative check (payout_pool >= 0),
  constraint milestone_results_payout_pool_within_target check (payout_pool <= target_pool),
  constraint milestone_results_payout_total_within_pool check (payout_total >= 0 and payout_total <= payout_pool),
  constraint milestone_results_residual_consistent check (residual = payout_pool - payout_total)
);

create index milestone_results_project_id_idx on public.milestone_results (project_id);

alter table public.milestone_results enable row level security;

revoke all on public.milestone_results from anon;
revoke insert, update, delete, truncate, references, trigger on public.milestone_results from authenticated;
grant select on public.milestone_results to authenticated;

-- ---------------------------------------------------------------------------
-- milestone_result_lines: one row per engagement at approval, employee-readable. Display fields are
-- snapshotted so renames never change history. No share, pool, total or residual (privacy split).
-- notified_at is stamped by the approval-email Edge Function (secret key) only.
-- ---------------------------------------------------------------------------
create table public.milestone_result_lines (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references public.milestone_results (milestone_id) on delete restrict,
  engagement_id uuid not null references public.milestone_engagements (id) on delete restrict,
  employee_id uuid not null references public.employees (id) on delete restrict,
  employee_name text not null,
  job_role_name text not null,
  project_id uuid not null references public.projects (id) on delete restrict,
  project_name text not null,
  milestone_name text not null,
  start_date date not null,
  end_date date not null,
  approved_at timestamptz not null,
  time_share numeric(3, 2) not null,
  role_weight numeric(4, 2) not null,
  rating smallint not null,
  rating_factor numeric(4, 2) not null,
  weighted_contribution numeric not null,
  multiplier numeric not null,
  bonus numeric(12, 2) not null,
  notified_at timestamptz,
  constraint milestone_result_lines_bonus_nonnegative check (bonus >= 0),
  constraint milestone_result_lines_milestone_employee_key unique (milestone_id, employee_id)
);

create index milestone_result_lines_employee_id_idx on public.milestone_result_lines (employee_id);

alter table public.milestone_result_lines enable row level security;

revoke all on public.milestone_result_lines from anon;
revoke insert, update, delete, truncate, references, trigger on public.milestone_result_lines from authenticated;
grant select on public.milestone_result_lines to authenticated;

-- ---------------------------------------------------------------------------
-- Employee helpers. security definer so the employee policy can resolve the caller's employee row
-- and the milestone's status without any employee policy on employees or milestones.
-- ---------------------------------------------------------------------------

-- The caller's own employee row, only once the invite was accepted (activated_at set): a claimed
-- but unactivated account sees nothing. Null when there is none.
create function public.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.employees e
  where e.profile_id = auth.uid()
    and e.activated_at is not null;
$$;

revoke execute on function public.current_employee_id() from public, anon;
grant execute on function public.current_employee_id() to authenticated;

-- The milestone exists and is approved.
create function public.is_approved_milestone(p_milestone_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.milestones m
    where m.id = p_milestone_id
      and m.status = 'approved'
  );
$$;

revoke execute on function public.is_approved_milestone(uuid) from public, anon;
grant execute on function public.is_approved_milestone(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Policies on milestone_results (all to authenticated; anon has no access at all). The owning
-- Supervisor and Admins read.
--
-- Deliberately absent: there is NO insert, update or delete policy for any API role, and NO
-- policy for the Employee role (the header carries the pool and total; privacy split). With RLS
-- enabled, a missing policy means the operation is denied. Only approve_milestone writes it. This
-- is intentional, not an oversight.
-- ---------------------------------------------------------------------------
create policy milestone_results_select_supervisor
  on public.milestone_results
  for select
  to authenticated
  using (public.owns_milestone(milestone_id));

create policy milestone_results_select_admin
  on public.milestone_results
  for select
  to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Policies on milestone_result_lines (all to authenticated; anon has no access at all). The owning
-- Supervisor and Admins read every line; an activated Employee reads only their own lines, and only
-- of an approved milestone (CLAUDE.md RLS rule).
--
-- Deliberately absent: there is NO insert, update or delete policy for any API role. Only
-- approve_milestone (security definer) and the approval-email Edge Function (secret key) write.
-- This is intentional, not an oversight.
-- ---------------------------------------------------------------------------
create policy milestone_result_lines_select_supervisor
  on public.milestone_result_lines
  for select
  to authenticated
  using (public.owns_milestone(milestone_id));

create policy milestone_result_lines_select_admin
  on public.milestone_result_lines
  for select
  to authenticated
  using ((select public.is_admin()));

create policy milestone_result_lines_select_employee
  on public.milestone_result_lines
  for select
  to authenticated
  using (
    employee_id = (select public.current_employee_id())
    and public.is_approved_milestone(milestone_id)
  );

-- ---------------------------------------------------------------------------
-- Freeze guard. Triggers on milestones fire in name order, so this one runs BEFORE
-- milestones_check_parent: it repeats that trigger's MR006 (project_id change) and 42501 checks
-- first, keeping their precedence. Then: no milestone is born approved (MR014), an approved
-- milestone never changes (MR015), and the move to 'approved' needs the snapshot header, which only
-- approve_milestone writes (MR014). Keep the 42501 predicate in sync with the milestones
-- insert/update policies (owns_project). Writes without a JWT (seed, Studio) keep MR006/MR014/MR015.
-- ---------------------------------------------------------------------------
create function public.milestones_check_frozen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    raise exception 'a milestone cannot be moved to another project'
      using errcode = 'MR006';
  end if;

  if auth.uid() is not null and not public.owns_project(new.project_id) then
    raise exception 'permission denied for project %', new.project_id
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'approved' then
      raise exception 'a new milestone cannot be approved; approve it after scoring and staffing it'
        using errcode = 'MR014';
    end if;
    return new;
  end if;

  if old.status = 'approved' then
    raise exception 'milestone is approved; approved milestones cannot be changed'
      using errcode = 'MR015';
  end if;

  if new.status = 'approved' and not exists (
    select 1 from public.milestone_results r where r.milestone_id = new.id
  ) then
    raise exception 'milestone can only be approved through approve_milestone'
      using errcode = 'MR014';
  end if;

  return new;
end;
$$;

revoke execute on function public.milestones_check_frozen() from public, anon, authenticated;

create trigger milestones_check_frozen
  before insert or update on public.milestones
  for each row execute function public.milestones_check_frozen();

-- ---------------------------------------------------------------------------
-- Approve a milestone: permission (42501; Admins are read-only and get it too), lock, already
-- approved (MR015), not approvable (MR014: cancelled, unscored or no engagements), then the snapshot
-- in ONE statement, then the status. security definer: it writes the system-only snapshot tables,
-- and the security-invoker payout functions it calls run with the definer's (full) visibility.
-- milestones_check_parent still raises MR003 for a closed project on the status update, which rolls
-- the snapshot back with it.
-- ---------------------------------------------------------------------------
create function public.approve_milestone(p_milestone_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_scored boolean;
begin
  if not public.owns_milestone(p_milestone_id) then
    raise exception 'permission denied for milestone %', p_milestone_id
      using errcode = '42501';
  end if;

  select m.status, num_nulls(m.kpi_schedule, m.kpi_budget, m.kpi_quality, m.kpi_risk) = 0
  into v_status, v_scored
  from public.milestones m
  where m.id = p_milestone_id
  for update;

  if v_status = 'approved' then
    raise exception 'milestone is already approved'
      using errcode = 'MR015';
  end if;

  if v_status = 'cancelled' then
    raise exception 'milestone is cancelled; it cannot be approved'
      using errcode = 'MR014';
  end if;

  if not v_scored then
    raise exception 'milestone has no KPI scores; score it before approving'
      using errcode = 'MR014';
  end if;

  if not exists (select 1 from public.milestone_engagements e where e.milestone_id = p_milestone_id) then
    raise exception 'milestone has no engagements; assign employees before approving'
      using errcode = 'MR014';
  end if;

  -- The one-statement snapshot: header and lines from the same CTE rows and the same snapshot.
  with src as (
    select
      m.id as milestone_id,
      m.project_id,
      p.name as project_name,
      m.name as milestone_name,
      m.start_date,
      m.end_date,
      m.target_pool,
      m.kpi_schedule,
      m.kpi_budget,
      m.kpi_quality,
      m.kpi_risk,
      x.multiplier,
      s.multiplier_min,
      s.multiplier_max,
      round(x.multiplier / s.multiplier_max, 6) as budget_share,
      -- round(..., 2) only trims the scale: capped_payout_pool already floored to the grosz.
      round(public.capped_payout_pool(m.target_pool, x.multiplier), 2) as payout_pool
    from public.milestones m
    join public.projects p on p.id = m.project_id
    cross join public.bonus_settings s
    cross join lateral (
      select public.kpi_multiplier(m.kpi_schedule, m.kpi_budget, m.kpi_quality, m.kpi_risk) as multiplier
    ) as x
    where m.id = p_milestone_id
      and s.id
  ),
  pl as materialized (
    select * from public.milestone_payout_lines(p_milestone_id)
  ),
  totals as (
    select coalesce(sum(pl.bonus), 0) as payout_total, count(*)::integer as engagement_count
    from pl
  ),
  header_ins as (
    insert into public.milestone_results (
      milestone_id, project_id, project_name, milestone_name, start_date, end_date,
      target_pool, kpi_schedule, kpi_budget, kpi_quality, kpi_risk,
      multiplier, multiplier_min, multiplier_max, budget_share,
      payout_pool, payout_total, residual, engagement_count, approved_by
    )
    select
      src.milestone_id, src.project_id, src.project_name, src.milestone_name, src.start_date, src.end_date,
      src.target_pool, src.kpi_schedule, src.kpi_budget, src.kpi_quality, src.kpi_risk,
      src.multiplier, src.multiplier_min, src.multiplier_max, src.budget_share,
      src.payout_pool, t.payout_total, src.payout_pool - t.payout_total, t.engagement_count, auth.uid()
    from src
    cross join totals t
    returning
      milestone_id, project_id, project_name, milestone_name, start_date, end_date, multiplier, approved_at
  )
  insert into public.milestone_result_lines (
    milestone_id, engagement_id, employee_id, employee_name, job_role_name,
    project_id, project_name, milestone_name, start_date, end_date, approved_at,
    time_share, role_weight, rating, rating_factor, weighted_contribution, multiplier, bonus
  )
  select
    h.milestone_id, pl.engagement_id, pl.employee_id, pl.employee_name, pl.job_role_name,
    h.project_id, h.project_name, h.milestone_name, h.start_date, h.end_date, h.approved_at,
    pl.time_share, pl.role_weight, pl.rating, pl.rating_factor, pl.weighted_contribution, h.multiplier, pl.bonus
  from pl
  cross join header_ins h;

  -- milestones_check_frozen allows this only because the header now exists.
  update public.milestones
  set status = 'approved'
  where id = p_milestone_id;
end;
$$;

revoke execute on function public.approve_milestone(uuid) from public, anon;
grant execute on function public.approve_milestone(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Closed set: 'approved' is closed alongside 'completed' and 'cancelled'. Bodies copied from
-- 20260929120000_employees_and_engagements.sql and
-- 20260930120000_projects_guard_engaged_owner_change.sql; only the status sets change. Return
-- types are unchanged, so create or replace keeps the triggers; the revokes are re-applied.
-- ---------------------------------------------------------------------------

-- MR008: no owner change while assigned to an open milestone of another Supervisor.
create or replace function public.employees_check_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Keep in sync with employees_insert_supervisor / employees_update_supervisor: a non-Admin
  -- caller may only write rows they own as a Supervisor.
  if auth.uid() is not null
    and not public.is_admin()
    and (new.supervisor_id is distinct from auth.uid() or not public.is_supervisor()) then
    raise exception 'permission denied for employee'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles pr
    where pr.id = new.supervisor_id
      and pr.role = 'supervisor'::public.app_role
  ) then
    raise exception 'employee owner must be a supervisor'
      using errcode = 'MR001';
  end if;

  if tg_op = 'INSERT' then
    if exists (
      select 1 from public.job_roles jr where jr.id = new.job_role_id and jr.archived_at is not null
    ) then
      raise exception 'job role is archived; pick an active job role'
        using errcode = 'MR010';
    end if;
  else
    if new.job_role_id is distinct from old.job_role_id and exists (
      select 1 from public.job_roles jr where jr.id = new.job_role_id and jr.archived_at is not null
    ) then
      raise exception 'job role is archived; pick an active job role'
        using errcode = 'MR010';
    end if;

    if new.email is distinct from old.email and old.invited_at is not null then
      raise exception 'employee email cannot change after the first invite'
        using errcode = 'MR009';
    end if;

    if new.supervisor_id is distinct from old.supervisor_id and exists (
      select 1
      from public.milestone_engagements e
      join public.milestones m on m.id = e.milestone_id
      join public.projects p on p.id = m.project_id
      where e.employee_id = new.id
        and m.status not in ('completed', 'cancelled', 'approved')
        and p.supervisor_id <> new.supervisor_id
    ) then
      raise exception 'employee is assigned to open milestones of another supervisor; remove those assignments first'
        using errcode = 'MR008';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.employees_check_rules() from public, anon, authenticated;

-- MR007: no engagement write while the milestone (now also approved) or its project is closed.
create or replace function public.milestone_engagements_check_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_milestone_id uuid;
  v_employee_id uuid;
  v_milestone_status text;
  v_project_id uuid;
  v_project_status text;
  v_project_owner uuid;
  v_employee_owner uuid;
begin
  if tg_op = 'DELETE' then
    v_milestone_id := old.milestone_id;
    v_employee_id := old.employee_id;
  else
    v_milestone_id := new.milestone_id;
    v_employee_id := new.employee_id;
  end if;

  if auth.uid() is not null and not public.owns_milestone(v_milestone_id) then
    raise exception 'permission denied for milestone %', v_milestone_id
      using errcode = '42501';
  end if;

  select m.status, m.project_id
  into v_milestone_status, v_project_id
  from public.milestones m
  where m.id = v_milestone_id
  for share;

  select p.status, p.supervisor_id
  into v_project_status, v_project_owner
  from public.projects p
  where p.id = v_project_id
  for share;

  select e.supervisor_id
  into v_employee_owner
  from public.employees e
  where e.id = v_employee_id
  for share;

  if v_milestone_status in ('completed', 'cancelled', 'approved') or v_project_status in ('completed', 'cancelled') then
    raise exception 'milestone or project is closed; reopen it before changing its assignments'
      using errcode = 'MR007';
  end if;

  if tg_op = 'INSERT' and v_employee_owner is distinct from v_project_owner then
    raise exception 'employee is not on the milestone owner''s team'
      using errcode = 'MR011';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.milestone_engagements_check_parent() from public, anon, authenticated;

-- MR012: no project owner change while an open milestone holds another Supervisor's employees.
create or replace function public.projects_check_engaged_owner_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.supervisor_id is distinct from old.supervisor_id and exists (
    select 1
    from public.milestone_engagements e
    join public.milestones m on m.id = e.milestone_id
    join public.employees em on em.id = e.employee_id
    where m.project_id = new.id
      and m.status not in ('completed', 'cancelled', 'approved')
      and em.supervisor_id <> new.supervisor_id
  ) then
    raise exception 'project has open milestones with employees of another supervisor; remove those assignments first'
      using errcode = 'MR012';
  end if;
  return new;
end;
$$;

revoke execute on function public.projects_check_engaged_owner_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Open time-share total (FR-011): approved milestones no longer count. Same columns, still
-- security_invoker; grants re-applied.
-- ---------------------------------------------------------------------------
create or replace view public.employee_time_share_totals
with (security_invoker = true)
as
select
  e.employee_id,
  sum(e.time_share)::numeric as open_total,
  sum(e.time_share) > 1 as over_allocated
from public.milestone_engagements e
join public.milestones m on m.id = e.milestone_id
where m.status not in ('completed', 'cancelled', 'approved')
group by e.employee_id;

revoke all on public.employee_time_share_totals from anon, authenticated;
grant select on public.employee_time_share_totals to authenticated;

-- ---------------------------------------------------------------------------
-- Budget exposure (FR-017): a non-cancelled milestone reserves its target_pool, except an approved
-- one, which reserves its stored payout_pool. The coalesce is defence in depth: an approved
-- milestone without a visible snapshot falls back to its target_pool and never reserves 0. Same
-- columns, still security_invoker (milestone_results is read under the caller's RLS); grants
-- re-applied.
-- ---------------------------------------------------------------------------
create or replace view public.project_budget_exposure
with (security_invoker = true)
as
select
  e.project_id,
  e.total_budget,
  e.reserved_total,
  e.total_budget - e.reserved_total as remaining,
  e.reserved_total > e.total_budget as over_budget
from (
  select
    p.id as project_id,
    p.total_budget,
    coalesce(
      sum(
        case
          when m.status = 'approved' then coalesce(r.payout_pool, m.target_pool)
          else m.target_pool
        end
      ) filter (where m.status <> 'cancelled'),
      0
    ) as reserved_total
  from public.projects p
  left join public.milestones m on m.project_id = p.id
  left join public.milestone_results r on r.milestone_id = m.id
  group by p.id, p.total_budget
) as e;

revoke all on public.project_budget_exposure from anon, authenticated;
grant select on public.project_budget_exposure to authenticated;
