-- Open time share excludes closed projects (test-plan risk #7; testing-payout-correctness research
-- finding 6). employee_time_share_totals filtered on the milestone status only, so an engagement on
-- a planned or active milestone inside a cancelled or completed project still counted toward the
-- employee's open total and could raise a false "Over 100%" flag. Work in a closed project is no
-- longer in progress: the view now also requires the project to be open.
--
-- Scope stays per caller (accepted tradeoff): the view is security_invoker, so a Supervisor's total
-- covers only engagements on their own milestones (0.60 + 0.60 across two Supervisors flags for
-- neither), an Admin's covers every engagement, and employees get no rows. The added join to
-- projects runs under the caller's RLS too: every role that sees an engagement row also sees its
-- project (a Supervisor sees engagements only on milestones of projects they own; an Admin sees
-- everything), so the join drops no open engagement. rls_matrix.test.sql pins it per actor.
--
-- Same columns, still security_invoker; grants re-applied.

create or replace view public.employee_time_share_totals
with (security_invoker = true)
as
select
  e.employee_id,
  sum(e.time_share)::numeric as open_total,
  sum(e.time_share) > 1 as over_allocated
from public.milestone_engagements e
join public.milestones m on m.id = e.milestone_id
join public.projects p on p.id = m.project_id
where m.status not in ('completed', 'cancelled', 'approved')
  and p.status not in ('completed', 'cancelled')
group by e.employee_id;

revoke all on public.employee_time_share_totals from anon, authenticated;
grant select on public.employee_time_share_totals to authenticated;
