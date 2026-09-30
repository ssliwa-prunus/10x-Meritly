-- Clear an employee's invite stamps when their linked account goes away (impl-review F6).
-- profile_id is `on delete set null`, so deleting the auth user (and with it the profile) used to
-- leave invited_at/activated_at set: the employee still showed "Active", invite-employee answered
-- already_active forever and the email stayed locked (MR009). With the stamps cleared the
-- employee is "Not invited" again and can be re-invited.
create function public.employees_clear_invite_on_unlink()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.profile_id is null and old.profile_id is not null then
    new.invited_at := null;
    new.activated_at := null;
  end if;
  return new;
end;
$$;

revoke execute on function public.employees_clear_invite_on_unlink() from public, anon, authenticated;

create trigger employees_clear_invite_on_unlink
  before update of profile_id on public.employees
  for each row execute function public.employees_clear_invite_on_unlink();
