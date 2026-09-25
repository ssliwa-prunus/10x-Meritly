-- Role and RLS scaffold: access roles live in public.profiles (never in auth user_metadata,
-- which users can edit). Every later slice's policies call into the helpers defined here.

-- ---------------------------------------------------------------------------
-- Access-role enum
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'supervisor', 'employee');

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user, created by the signup trigger below
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  role public.app_role not null default 'employee',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

revoke all on public.profiles from anon;

-- ---------------------------------------------------------------------------
-- Signup trigger: create an employee profile for every new auth user.
-- The role always takes the column default; it is never read from metadata.
-- ---------------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'display_name');
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Role helpers. security definer so they read profiles as the owner and bypass
-- RLS; policies on profiles call these instead of sub-selecting profiles
-- inline, which would recurse into the same policies.
-- ---------------------------------------------------------------------------
create function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() = 'admin'::public.app_role, false);
$$;

create function public.is_supervisor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() = 'supervisor'::public.app_role, false);
$$;

revoke execute on function public.current_app_role() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_supervisor() from public, anon;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_supervisor() to authenticated;

-- ---------------------------------------------------------------------------
-- Policies on profiles (all to authenticated; anon has no access at all).
--
-- Deliberately absent: there are NO insert and NO delete policies for any API
-- role. With RLS enabled, a missing policy means the operation is denied.
-- Profiles are inserted only by the on_auth_user_created trigger and deleted
-- only through the auth.users on delete cascade. This is intentional, not an
-- oversight.
-- ---------------------------------------------------------------------------
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

create policy profiles_select_supervisor
  on public.profiles
  for select
  to authenticated
  using ((select public.is_supervisor()));

create policy profiles_select_admin
  on public.profiles
  for select
  to authenticated
  using ((select public.is_admin()));

create policy profiles_update_admin
  on public.profiles
  for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
