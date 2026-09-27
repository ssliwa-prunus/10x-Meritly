-- milestones_check_parent is security definer and runs before RLS WITH CHECK, so without an
-- ownership check it answered MR002/MR003 (with the project's dates) for projects the caller
-- cannot see. A caller with a JWT who does not own the parent project now gets 42501 first,
-- the same answer RLS gives; writes without a JWT (seed, Studio) keep every guard.
-- Keep this predicate in sync with the milestones insert/update policies (owns_project).

create or replace function public.milestones_check_parent()
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

  if auth.uid() is not null and not public.owns_project(new.project_id) then
    raise exception 'permission denied for project %', new.project_id
      using errcode = '42501';
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
