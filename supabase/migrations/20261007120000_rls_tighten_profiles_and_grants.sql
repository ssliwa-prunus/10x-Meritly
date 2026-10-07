-- Tighten the RLS surface (testing-rls-matrix, decisions F1 and F2).
--
-- F1: Supervisors no longer read every profile. profiles_select_supervisor exposed every user's
-- email, display name and role to any Supervisor; they keep their own row through
-- profiles_select_own. No app path needs more: the middleware reads only the caller's own row,
-- the supervisor list (listSupervisors) is loaded only for Admins, and the remaining in-database
-- profile reads (owner/role guards) are security definer triggers that bypass RLS.
--
-- F2: authenticated loses truncate, references and trigger on profiles, job_roles and
-- bonus_settings. TRUNCATE ignores RLS entirely, and none of these privileges is used by the app.
-- This matches projects and milestones (20260927120000_projects_and_milestones.sql) and the later
-- tables, which never kept them.

drop policy profiles_select_supervisor on public.profiles;

revoke truncate, references, trigger on public.profiles, public.job_roles, public.bonus_settings from authenticated;
