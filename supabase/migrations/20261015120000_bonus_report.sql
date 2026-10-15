-- Aggregate bonus report (aggregate-bonus-report, phase 1).
--
-- bonus_report sums the approved result lines per employee: how many approved milestones each
-- employee has a line on and the total of those bonuses, optionally limited to an approval-date
-- range. It reads only the approval snapshot (milestone_result_lines), never live figures.
--
-- Scope is whatever the caller's RLS lets them read. security invoker on purpose: a Supervisor gets
-- only the lines of milestones they currently own (owns_milestone), so an employee who also worked
-- on another Supervisor's milestones shows a partial count and total; an Admin gets every line. A
-- definer version would bypass RLS and widen pay visibility, which rls_catalog_guard.test.sql pins.
-- Employees get nothing: they have no policy on milestone_results or milestones, so the join below
-- drops every row (the page is Supervisor/Admin only anyway).
--
-- Approved only: the Supervisor and Admin policies on milestone_result_lines do not require an
-- approved milestone (an injected or leftover Draft line would be visible), so the join keeps
-- milestones.status = 'approved' explicitly.
--
-- Date range: p_from and p_to compare against the approval day in Europe/Warsaw, inclusive, each
-- bound ignored when null. Comparing the raw timestamptz would move a late-evening approval into
-- the neighbouring day. p_from > p_to returns no rows.
--
-- Name: the snapshot employee_name of the employee's most recent approved line (tie: the smaller
-- milestone_id). employees is not joined: after a transfer the Supervisor may not read that row.
--
-- milestone_count = count(*): one line per milestone and employee (unique constraint), 0 zł lines
-- included.

create function public.bonus_report(p_from date default null, p_to date default null)
returns table (
  employee_id uuid,
  employee_name text,
  milestone_count integer,
  total_bonus numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with lines as (
    select l.employee_id, l.employee_name, l.milestone_id, l.approved_at, l.bonus
    from public.milestone_result_lines l
    join public.milestone_results r on r.milestone_id = l.milestone_id
    join public.milestones m on m.id = r.milestone_id
    where m.status = 'approved'
      and (p_from is null or (l.approved_at at time zone 'Europe/Warsaw')::date >= p_from)
      and (p_to is null or (l.approved_at at time zone 'Europe/Warsaw')::date <= p_to)
  ),
  latest_name as (
    select distinct on (ln.employee_id) ln.employee_id, ln.employee_name
    from lines ln
    order by ln.employee_id, ln.approved_at desc, ln.milestone_id
  )
  select
    ln.employee_id,
    n.employee_name,
    count(*)::integer,
    sum(ln.bonus)::numeric
  from lines ln
  join latest_name n on n.employee_id = ln.employee_id
  group by ln.employee_id, n.employee_name
  order by n.employee_name, ln.employee_id;
$$;

revoke execute on function public.bonus_report(date, date) from public, anon;
grant execute on function public.bonus_report(date, date) to authenticated;
