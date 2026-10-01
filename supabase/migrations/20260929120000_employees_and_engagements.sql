-- Employees and milestone engagements (S-03): Supervisor-owned employee records (FR-007), their
-- assignments to milestones with a time share and a contribution rating (FR-008), and the
-- read-time open time-share total with its >100% flag (FR-011). Every ownership, privacy and
-- closed-parent rule is enforced here, so the app-side validation is a convenience only.
--
-- Custom SQLSTATEs raised by the guard triggers below, extending the S-02 catalog
-- (20260927120000_projects_and_milestones.sql, MR001-MR006; mapped to catalog codes by the app):
--   MR001 owner_not_supervisor               reused: an employee's supervisor_id is not a Supervisor
--   MR005 supervisor_owns_projects           extended: now also counts employees the Supervisor owns
--   MR007 engagement_parent_closed           engagement write while the milestone or its project is
--                                            completed/cancelled
--   MR008 employee_has_open_engagements      an employee's owner change while they are assigned to an
--                                            open milestone of another Supervisor
--   MR009 employee_email_locked              an employee's email change after the first invite
--   MR010 job_role_archived                  an employee is given an archived job role
--   MR011 employee_not_on_team               an engagement's employee is not owned by the Supervisor
--                                            who owns the milestone's project
--
-- "Open" milestone means status not in ('completed', 'cancelled'), written as an exclusion so a
-- future status (S-05 'approved') is not silently dropped; S-05 must revisit it.
--
-- Nothing on employees is ever deleted. Engagements are hard-deleted by their owning Supervisor
-- while the milestone and project are open (the project's first delete policy).

-- ---------------------------------------------------------------------------
-- employees: owned by exactly one Supervisor (supervisor_id). The email is unique, stored
-- lowercase, and locked after the first invite. profile_id, invited_at and activated_at are
-- written only by the invite Edge Function (secret key) and the activation trigger below.
-- ---------------------------------------------------------------------------
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  supervisor_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  full_name text not null,
  email text not null,
  job_role_id uuid not null references public.job_roles (id) on delete restrict,
  profile_id uuid unique references public.profiles (id) on delete set null,
  invited_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  constraint employees_full_name_length check (char_length(full_name) between 1 and 100),
  constraint employees_full_name_trimmed check (full_name = btrim(full_name)),
  constraint employees_email_normalized check (email = lower(btrim(email))),
  constraint employees_email_format check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

create unique index employees_email_key on public.employees (email);
create index employees_supervisor_id_idx on public.employees (supervisor_id);

alter table public.employees enable row level security;

revoke all on public.employees from anon;
revoke truncate, references, trigger on public.employees from authenticated;

-- Column-level write privileges: revoking the table-level privilege also drops any column-level
-- one, then only the user-editable columns are granted back. profile_id, invited_at and
-- activated_at are never writable by authenticated.
revoke insert, update on public.employees from authenticated;
grant insert (full_name, email, job_role_id, supervisor_id) on public.employees to authenticated;
grant update (full_name, email, job_role_id, supervisor_id) on public.employees to authenticated;

-- ---------------------------------------------------------------------------
-- milestone_engagements: one row per (milestone, employee). milestone_id and employee_id are
-- immutable (not in the update grant); only time_share and rating change.
-- ---------------------------------------------------------------------------
create table public.milestone_engagements (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references public.milestones (id) on delete restrict,
  employee_id uuid not null references public.employees (id) on delete restrict,
  time_share numeric(3, 2) not null,
  rating smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  constraint milestone_engagements_time_share_range check (time_share > 0 and time_share <= 1),
  constraint milestone_engagements_rating_range check (rating between 1 and 5),
  constraint milestone_engagements_milestone_employee_key unique (milestone_id, employee_id)
);

create index milestone_engagements_employee_id_idx on public.milestone_engagements (employee_id);

alter table public.milestone_engagements enable row level security;

revoke all on public.milestone_engagements from anon;
revoke truncate, references, trigger on public.milestone_engagements from authenticated;

revoke insert, update on public.milestone_engagements from authenticated;
grant insert (milestone_id, employee_id, time_share, rating) on public.milestone_engagements to authenticated;
grant update (time_share, rating) on public.milestone_engagements to authenticated;

-- ---------------------------------------------------------------------------
-- Audit fields: reuse the table-agnostic S-01 trigger function.
-- ---------------------------------------------------------------------------
create trigger employees_set_audit_fields
  before insert or update on public.employees
  for each row execute function public.set_config_audit_fields();

create trigger milestone_engagements_set_audit_fields
  before insert or update on public.milestone_engagements
  for each row execute function public.set_config_audit_fields();

-- ---------------------------------------------------------------------------
-- Ownership helpers. security definer so policies can follow engagement -> milestone -> project
-- without being filtered by the caller's own RLS, and so no policy on employees queries
-- milestone_engagements directly (that would form a policy cycle through the engagement checks).
-- ---------------------------------------------------------------------------

-- The caller is the Supervisor who owns the milestone's project.
create function public.owns_milestone(p_milestone_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select public.owns_project(m.project_id)
      from public.milestones m
      where m.id = p_milestone_id
    ),
    false
  );
$$;

revoke execute on function public.owns_milestone(uuid) from public, anon;
grant execute on function public.owns_milestone(uuid) to authenticated;

-- The employee has an engagement on a milestone the caller owns. Visibility only: seeing an
-- employee through this helper never implies owning them (MR011 and the invite function compare
-- supervisor_id explicitly).
create function public.employee_engaged_on_own_milestone(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.milestone_engagements e
      join public.milestones m on m.id = e.milestone_id
      join public.projects p on p.id = m.project_id
      where e.employee_id = p_employee_id
        and p.supervisor_id = auth.uid()
    )
    and public.is_supervisor();
$$;

revoke execute on function public.employee_engaged_on_own_milestone(uuid) from public, anon;
grant execute on function public.employee_engaged_on_own_milestone(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Guard triggers. security definer so each check sees the rows it needs regardless of the
-- caller's RLS. BEFORE row triggers run before RLS WITH CHECK, so each guard raises 42501 for a
-- caller with a JWT who may not write the row before any MR code (which could leak data about
-- rows the caller cannot see). Writes without a JWT (seed, Studio) keep every other guard.
-- ---------------------------------------------------------------------------

-- Employee writes: permission (42501), owner is a Supervisor (MR001), job role not archived
-- (MR010), email locked after the first invite (MR009), no owner change while assigned to an
-- open milestone of another Supervisor (MR008). The UPDATE holds the employee row lock, which
-- serializes it against the engagement guard's FOR SHARE read of the same row.
create function public.employees_check_rules()
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
        and m.status not in ('completed', 'cancelled')
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

create trigger employees_check_rules
  before insert or update of supervisor_id, email, job_role_id on public.employees
  for each row execute function public.employees_check_rules();

-- Engagement writes (insert, update and delete): permission (42501), then the milestone, its
-- project and the employee are read FOR SHARE so a concurrent status change or owner change
-- cannot slip past; no write while the milestone or project is closed (MR007); on insert, the
-- employee must be owned by the Supervisor who owns the milestone's project (MR011).
-- Keep the 42501 predicate in sync with the milestone_engagements write policies (owns_milestone).
create function public.milestone_engagements_check_parent()
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

  if v_milestone_status in ('completed', 'cancelled') or v_project_status in ('completed', 'cancelled') then
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

create trigger milestone_engagements_check_parent
  before insert or update or delete on public.milestone_engagements
  for each row execute function public.milestone_engagements_check_parent();

-- A Supervisor who owns projects or employees keeps the role until an Admin reassigns them
-- (MR005). Replaces the S-02 body, which counted projects only; project semantics are unchanged.
create or replace function public.profiles_block_owner_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_projects integer;
  v_employees integer;
begin
  if old.role = 'supervisor'::public.app_role and new.role is distinct from old.role then
    select count(*)
    into v_projects
    from public.projects p
    where p.supervisor_id = old.id;

    select count(*)
    into v_employees
    from public.employees e
    where e.supervisor_id = old.id;

    if v_projects > 0 or v_employees > 0 then
      raise exception 'supervisor owns % project(s) and % employee(s); reassign projects and employees first',
        v_projects, v_employees
        using errcode = 'MR005';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.profiles_block_owner_role_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Activation: when an invited user confirms their email (accepting the invite), stamp the linked
-- employee's activated_at. security definer: it runs as part of an auth.users update made by the
-- auth server, which has no privileges on public.employees.
-- ---------------------------------------------------------------------------
create function public.handle_employee_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.employees
  set activated_at = now()
  where profile_id = new.id;
  return new;
end;
$$;

revoke execute on function public.handle_employee_activation() from public, anon, authenticated;

create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.handle_employee_activation();

-- ---------------------------------------------------------------------------
-- Policies on employees (all to authenticated; anon has no access at all). A Supervisor reads
-- and writes the employees they own, and additionally reads (never writes) employees who have
-- an engagement on one of the Supervisor's milestones, so names stay visible after a move. An
-- Admin reads and writes all of them, including choosing or changing the owner.
--
-- Deliberately absent: there is NO delete policy for any API role, and NO policy for the
-- Employee role (employees get access to their own data in S-05/S-06). With RLS enabled, a
-- missing policy means the operation is denied. Employees are never deleted. This is
-- intentional, not an oversight.
-- ---------------------------------------------------------------------------
create policy employees_select_supervisor
  on public.employees
  for select
  to authenticated
  using (
    (supervisor_id = (select auth.uid()) and (select public.is_supervisor()))
    or public.employee_engaged_on_own_milestone(id)
  );

create policy employees_select_admin
  on public.employees
  for select
  to authenticated
  using ((select public.is_admin()));

create policy employees_insert_supervisor
  on public.employees
  for insert
  to authenticated
  with check (supervisor_id = (select auth.uid()) and (select public.is_supervisor()));

create policy employees_insert_admin
  on public.employees
  for insert
  to authenticated
  with check ((select public.is_admin()));

create policy employees_update_supervisor
  on public.employees
  for update
  to authenticated
  using (supervisor_id = (select auth.uid()) and (select public.is_supervisor()))
  with check (supervisor_id = (select auth.uid()) and (select public.is_supervisor()));

create policy employees_update_admin
  on public.employees
  for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Policies on milestone_engagements (all to authenticated; anon has no access at all). The
-- Supervisor who owns the milestone's project reads and writes, including hard delete (the
-- project's first delete policy; the guard blocks it on closed parents). An Admin only reads.
--
-- Deliberately absent: there is NO insert, update or delete policy for Admins, and NO policy for
-- the Employee role. With RLS enabled, a missing policy means the operation is denied. An Admin
-- reassigns the project instead of editing its assignments; employees see their own results
-- from S-05/S-06. This is intentional, not an oversight.
-- ---------------------------------------------------------------------------
create policy milestone_engagements_select_supervisor
  on public.milestone_engagements
  for select
  to authenticated
  using (public.owns_milestone(milestone_id));

create policy milestone_engagements_select_admin
  on public.milestone_engagements
  for select
  to authenticated
  using ((select public.is_admin()));

create policy milestone_engagements_insert_supervisor
  on public.milestone_engagements
  for insert
  to authenticated
  with check (public.owns_milestone(milestone_id));

create policy milestone_engagements_update_supervisor
  on public.milestone_engagements
  for update
  to authenticated
  using (public.owns_milestone(milestone_id))
  with check (public.owns_milestone(milestone_id));

create policy milestone_engagements_delete_supervisor
  on public.milestone_engagements
  for delete
  to authenticated
  using (public.owns_milestone(milestone_id));

-- ---------------------------------------------------------------------------
-- Open time-share total per employee (FR-011), computed at read time and informational only.
-- security_invoker, so the caller's RLS on milestone_engagements and milestones sets the scope:
-- a Supervisor's total covers only their own milestones, an Admin's covers every milestone, an
-- Employee gets no rows. Employees without open engagements have no row (total 0). The flag is
-- strictly above 1.00; numeric sums are exact.
-- ---------------------------------------------------------------------------
create view public.employee_time_share_totals
with (security_invoker = true)
as
select
  e.employee_id,
  sum(e.time_share)::numeric as open_total,
  sum(e.time_share) > 1 as over_allocated
from public.milestone_engagements e
join public.milestones m on m.id = e.milestone_id
where m.status not in ('completed', 'cancelled')
group by e.employee_id;

revoke all on public.employee_time_share_totals from anon, authenticated;
grant select on public.employee_time_share_totals to authenticated;
