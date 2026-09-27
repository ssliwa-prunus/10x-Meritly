-- Projects and milestones (S-02): supervisor-owned projects, their milestones, the single money
-- rounding rule, and the read-time budget exposure view (FR-017). Every value rule, ownership
-- rule and period rule is enforced here, so the app-side validation is a convenience only.
--
-- Custom SQLSTATEs raised by the guard triggers below (mapped to catalog codes by the app):
--   MR001 owner_not_supervisor               a project's supervisor_id is not a Supervisor
--   MR002 milestone_outside_project          a milestone's period falls outside its project's
--   MR003 project_closed                     milestone write while the project is completed/cancelled
--   MR004 project_period_excludes_milestones a project date change would leave a milestone outside
--   MR005 supervisor_owns_projects           the role of a Supervisor who owns projects is changed
--   MR006 (not user-reachable)               a milestone's project_id is changed
--
-- Nothing is ever deleted: mistakes are set to 'cancelled'.

-- ---------------------------------------------------------------------------
-- Money rounding: the single rounding rule for money. Floors to the grosz (0.01); never rely on
-- a numeric(p,2) cast, which rounds half away from zero. S-04 reuses it for payout_pool, so a
-- payout pool can never exceed the reservation computed below. Security invoker on purpose.
-- ---------------------------------------------------------------------------
create function public.money_floor_mul(amount numeric, multiplier numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select floor(amount * multiplier * 100) / 100;
$$;

revoke execute on function public.money_floor_mul(numeric, numeric) from public, anon;
grant execute on function public.money_floor_mul(numeric, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- projects: owned by exactly one Supervisor (supervisor_id). Names are unique company-wide,
-- case-insensitively. supervisor_id defaults to the caller; Admins set it explicitly.
-- ---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'planned',
  total_budget numeric(12, 2) not null,
  notes text,
  supervisor_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  constraint projects_name_length check (char_length(name) between 1 and 100),
  constraint projects_name_trimmed check (name = btrim(name)),
  constraint projects_period_order check (end_date >= start_date),
  constraint projects_status_valid check (status in ('planned', 'active', 'completed', 'cancelled')),
  constraint projects_total_budget_positive check (total_budget > 0),
  constraint projects_notes_length check (char_length(notes) <= 2000)
);

create unique index projects_name_lower_key on public.projects (lower(name));
create index projects_supervisor_id_idx on public.projects (supervisor_id);

alter table public.projects enable row level security;

revoke all on public.projects from anon;
revoke truncate, references, trigger on public.projects from authenticated;

-- ---------------------------------------------------------------------------
-- milestones: belong to one project for life (project_id is immutable). Names are unique
-- within their project, case-insensitively.
-- ---------------------------------------------------------------------------
create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete restrict,
  name text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'planned',
  target_pool numeric(12, 2) not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  constraint milestones_name_length check (char_length(name) between 1 and 100),
  constraint milestones_name_trimmed check (name = btrim(name)),
  constraint milestones_period_order check (end_date >= start_date),
  constraint milestones_status_valid check (status in ('planned', 'active', 'completed', 'cancelled')),
  constraint milestones_target_pool_positive check (target_pool > 0),
  constraint milestones_notes_length check (char_length(notes) <= 2000)
);

create unique index milestones_project_name_lower_key on public.milestones (project_id, lower(name));
create index milestones_project_id_idx on public.milestones (project_id);

alter table public.milestones enable row level security;

revoke all on public.milestones from anon;
revoke truncate, references, trigger on public.milestones from authenticated;

-- ---------------------------------------------------------------------------
-- Ownership helper. security definer so milestone policies can check the parent project's
-- owner without being filtered by the caller's own RLS on projects.
-- ---------------------------------------------------------------------------
create function public.owns_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.projects p
      where p.id = p_project_id
        and p.supervisor_id = auth.uid()
    )
    and public.is_supervisor();
$$;

revoke execute on function public.owns_project(uuid) from public, anon;
grant execute on function public.owns_project(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Audit fields: reuse the table-agnostic S-01 trigger function.
-- ---------------------------------------------------------------------------
create trigger projects_set_audit_fields
  before insert or update on public.projects
  for each row execute function public.set_config_audit_fields();

create trigger milestones_set_audit_fields
  before insert or update on public.milestones
  for each row execute function public.set_config_audit_fields();

-- ---------------------------------------------------------------------------
-- Guard triggers. security definer so each check sees the rows it needs regardless of the
-- caller's RLS. BEFORE row triggers run before RLS WITH CHECK, so a guard can raise its MR code
-- ahead of a 42501 from the policies.
-- ---------------------------------------------------------------------------

-- A project's owner must be a current Supervisor (MR001).
create function public.projects_check_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.profiles pr
    where pr.id = new.supervisor_id
      and pr.role = 'supervisor'::public.app_role
  ) then
    raise exception 'project owner must be a supervisor'
      using errcode = 'MR001';
  end if;
  return new;
end;
$$;

revoke execute on function public.projects_check_owner() from public, anon, authenticated;

create trigger projects_check_owner
  before insert or update of supervisor_id on public.projects
  for each row execute function public.projects_check_owner();

-- A milestone stays in its project (MR006), cannot be written while the project is closed
-- (MR003) and must lie inside the project's period (MR002). The parent row is read with
-- for share, so a concurrent project update cannot slip past this check.
create function public.milestones_check_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_start date;
  v_end date;
begin
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    raise exception 'a milestone cannot be moved to another project'
      using errcode = 'MR006';
  end if;

  select p.status, p.start_date, p.end_date
  into v_status, v_start, v_end
  from public.projects p
  where p.id = new.project_id
  for share;

  if v_status in ('completed', 'cancelled') then
    raise exception 'project is %; reopen it before changing its milestones', v_status
      using errcode = 'MR003';
  end if;

  if new.start_date < v_start or new.end_date > v_end then
    raise exception 'milestone period must lie within the project period (% to %)', v_start, v_end
      using errcode = 'MR002';
  end if;

  return new;
end;
$$;

revoke execute on function public.milestones_check_parent() from public, anon, authenticated;

create trigger milestones_check_parent
  before insert or update on public.milestones
  for each row execute function public.milestones_check_parent();

-- A project's period must keep containing every one of its milestones, any status (MR004).
create function public.projects_check_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outside integer;
begin
  -- "update of" fires whenever a date is in the SET list, even if unchanged.
  if new.start_date = old.start_date and new.end_date = old.end_date then
    return new;
  end if;

  select count(*)
  into v_outside
  from public.milestones m
  where m.project_id = new.id
    and (m.start_date < new.start_date or m.end_date > new.end_date);

  if v_outside > 0 then
    raise exception 'new project period would leave % milestone(s) outside it', v_outside
      using errcode = 'MR004';
  end if;

  return new;
end;
$$;

revoke execute on function public.projects_check_period() from public, anon, authenticated;

create trigger projects_check_period
  before update of start_date, end_date on public.projects
  for each row execute function public.projects_check_period();

-- A Supervisor who owns projects keeps the role until an Admin reassigns them (MR005).
create function public.profiles_block_owner_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owned integer;
begin
  if old.role = 'supervisor'::public.app_role and new.role is distinct from old.role then
    select count(*)
    into v_owned
    from public.projects p
    where p.supervisor_id = old.id;

    if v_owned > 0 then
      raise exception 'supervisor owns % project(s); reassign them first', v_owned
        using errcode = 'MR005';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.profiles_block_owner_role_change() from public, anon, authenticated;

create trigger profiles_block_owner_role_change
  before update of role on public.profiles
  for each row execute function public.profiles_block_owner_role_change();

-- ---------------------------------------------------------------------------
-- Policies on projects (all to authenticated; anon has no access at all). A Supervisor reads
-- and writes only their own projects; an Admin reads and writes all of them, including
-- reassigning the owner.
--
-- Deliberately absent: there is NO delete policy for any API role. With RLS enabled, a missing
-- policy means the operation is denied. Projects are cancelled, never deleted. This is
-- intentional, not an oversight.
-- ---------------------------------------------------------------------------
create policy projects_select_supervisor
  on public.projects
  for select
  to authenticated
  using (supervisor_id = (select auth.uid()) and (select public.is_supervisor()));

create policy projects_select_admin
  on public.projects
  for select
  to authenticated
  using ((select public.is_admin()));

create policy projects_insert_supervisor
  on public.projects
  for insert
  to authenticated
  with check (supervisor_id = (select auth.uid()) and (select public.is_supervisor()));

create policy projects_insert_admin
  on public.projects
  for insert
  to authenticated
  with check ((select public.is_admin()));

create policy projects_update_supervisor
  on public.projects
  for update
  to authenticated
  using (supervisor_id = (select auth.uid()) and (select public.is_supervisor()))
  with check (supervisor_id = (select auth.uid()) and (select public.is_supervisor()));

create policy projects_update_admin
  on public.projects
  for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Policies on milestones (all to authenticated; anon has no access at all). The owning
-- Supervisor reads and writes; an Admin only reads.
--
-- Deliberately absent: there is NO insert or update policy for Admins and NO delete policy for
-- any API role. With RLS enabled, a missing policy means the operation is denied. An Admin
-- reassigns the project to a Supervisor instead of editing its milestones; milestones are
-- cancelled, never deleted. This is intentional, not an oversight.
-- ---------------------------------------------------------------------------
create policy milestones_select_supervisor
  on public.milestones
  for select
  to authenticated
  using (public.owns_project(project_id));

create policy milestones_select_admin
  on public.milestones
  for select
  to authenticated
  using ((select public.is_admin()));

create policy milestones_insert_supervisor
  on public.milestones
  for insert
  to authenticated
  with check (public.owns_project(project_id));

create policy milestones_update_supervisor
  on public.milestones
  for update
  to authenticated
  using (public.owns_project(project_id))
  with check (public.owns_project(project_id));

-- ---------------------------------------------------------------------------
-- Budget exposure (FR-017), computed at read time and informational only: every non-cancelled
-- milestone reserves money_floor_mul(target_pool, multiplier_max). security_invoker, so the
-- caller's RLS on projects, milestones and bonus_settings applies (no row for employees).
--
-- The filter is an exclusion (<> 'cancelled') on purpose, so S-05's 'approved' status is not
-- silently dropped. S-05 replaces Approved milestones' amount with their stored payout_pool.
-- ---------------------------------------------------------------------------
create view public.project_budget_exposure
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
      sum(public.money_floor_mul(m.target_pool, s.multiplier_max)) filter (where m.status <> 'cancelled'),
      0
    ) as reserved_total
  from public.projects p
  cross join public.bonus_settings s
  left join public.milestones m on m.project_id = p.id
  group by p.id, p.total_budget, s.multiplier_max
) as e;

revoke all on public.project_budget_exposure from anon, authenticated;
grant select on public.project_budget_exposure to authenticated;
