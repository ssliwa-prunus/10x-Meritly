-- Interface language per user (language-switch-pl-en, phase 1).
--
-- profiles.locale keeps the user's last explicit PL/EN choice, so a new device or a cleared cookie
-- comes back in the chosen language. null means "never chosen" (the app falls back to Polish).
--
-- Write path: ONLY set_my_locale. profiles has no self-update policy on purpose: role lives on the
-- same row, and a self-update policy would let a user change their own role. The definer function
-- writes exactly one column of exactly the caller's row; the check constraint rejects any value
-- other than 'pl'/'en' (23514). No new policy and no change to the table grants.

alter table public.profiles
  add column locale text null
  constraint profiles_locale_valid check (locale in ('pl', 'en'));

create function public.set_my_locale(p_locale text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated'
      using errcode = '42501';
  end if;

  update public.profiles
  set locale = p_locale
  where id = auth.uid();
end;
$$;

revoke execute on function public.set_my_locale(text) from public, anon;
grant execute on function public.set_my_locale(text) to authenticated;
