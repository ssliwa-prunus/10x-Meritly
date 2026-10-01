-- Close the project side of the S-03 ownership rule (impl-review F1). MR008 stops an employee's
-- owner change while they are assigned to an open milestone of another Supervisor, and MR011
-- checks team membership on engagement insert, but an Admin could still move a project whose
-- open milestones hold engagements of the old owner's employees. The new owner would then edit
-- and delete engagements of employees they do not own.
--
-- Custom SQLSTATE added to the catalog (20260929120000_employees_and_engagements.sql):
--   MR012 project_has_foreign_engagements   a project's owner change while an open milestone of it
--                                            has an engagement of an employee the new owner does
--                                            not own
--
-- Known remaining gap: reopening a completed milestone can still leave an engagement of another
-- Supervisor's employee on an open milestone (the employee moved while it was closed).

-- The UPDATE holds the project row lock, which serializes it against the engagement guard's
-- FOR SHARE read of the same project.
create function public.projects_check_engaged_owner_change()
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
      and m.status not in ('completed', 'cancelled')
      and em.supervisor_id <> new.supervisor_id
  ) then
    raise exception 'project has open milestones with employees of another supervisor; remove those assignments first'
      using errcode = 'MR012';
  end if;
  return new;
end;
$$;

revoke execute on function public.projects_check_engaged_owner_change() from public, anon, authenticated;

create trigger projects_check_engaged_owner_change
  before update of supervisor_id on public.projects
  for each row execute function public.projects_check_engaged_owner_change();
