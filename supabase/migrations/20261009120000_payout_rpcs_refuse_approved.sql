-- Live payout RPCs refuse Approved milestones (test-plan risk #4; testing-payout-correctness
-- research finding 5). milestone_payout_lines and milestone_payout_summary recompute a milestone's
-- figures from the CURRENT bonus_settings and role weights. They are granted to authenticated, so
-- the owner or an Admin calling them directly for an Approved milestone got figures recomputed from
-- a config edited after approval: the freeze held only because pages branch on the status first.
-- Now both raise MR015 (milestone is approved/frozen, the code milestones_check_frozen and
-- approve_milestone already use) for an Approved milestone the caller can see. The approval
-- snapshot (milestone_results / milestone_result_lines) is the only source of Approved figures.
--
-- The status check runs AFTER the visibility lookup: a caller who cannot see the milestone still
-- gets zero rows and learns nothing about its status.
--
-- approve_milestone is unaffected: it reads milestone_payout_lines in its snapshot statement while
-- the milestone is still not approved, and only then sets status = 'approved'.
--
-- Same signatures, return types, stable, security invoker and search_path = '', so create or
-- replace keeps the grants; they are re-applied anyway. milestone_payout_summary moves from sql to
-- plpgsql so it carries its own status guard instead of relying on the lateral call to the lines
-- function.

-- ---------------------------------------------------------------------------
-- Payout lines: body of 20261004130000_milestone_payout_hard_cap.sql plus the status guard.
-- ---------------------------------------------------------------------------
create or replace function public.milestone_payout_lines(p_milestone_id uuid)
returns table (
  engagement_id uuid,
  employee_id uuid,
  employee_name text,
  job_role_name text,
  time_share numeric,
  role_weight numeric,
  rating smallint,
  rating_factor numeric,
  weighted_contribution numeric,
  share numeric,
  bonus numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_status text;
  v_target_pool numeric;
  v_multiplier numeric;
  v_pool_grosze numeric;
  v_unresolved integer;
begin
  select m.status, m.target_pool, public.kpi_multiplier(m.kpi_schedule, m.kpi_budget, m.kpi_quality, m.kpi_risk)
  into v_status, v_target_pool, v_multiplier
  from public.milestones m
  where m.id = p_milestone_id;

  if not found then
    return;
  end if;

  if v_status = 'approved' then
    raise exception 'milestone % is approved; read its figures from the approval snapshot (milestone_results, milestone_result_lines)',
      p_milestone_id
      using errcode = 'MR015';
  end if;

  if not exists (select 1 from public.bonus_settings s where s.id) then
    raise exception 'bonus settings are not visible; cannot compute payouts for milestone %', p_milestone_id;
  end if;

  select count(*)
  into v_unresolved
  from public.milestone_engagements e
  left join public.employees em on em.id = e.employee_id
  left join public.job_roles jr on jr.id = em.job_role_id
  where e.milestone_id = p_milestone_id
    and jr.weight is null;

  if v_unresolved > 0 then
    raise exception '% engagement(s) of milestone % have no visible role weight; refusing to split the pool without them',
      v_unresolved, p_milestone_id;
  end if;

  -- capped_payout_pool already floors to the grosz, so * 100 is a whole number.
  if v_multiplier is not null then
    v_pool_grosze := public.capped_payout_pool(v_target_pool, v_multiplier) * 100;
  end if;

  return query
  with lines as (
    select
      e.id as engagement_id,
      e.employee_id as employee_id,
      em.full_name as employee_name,
      jr.name as job_role_name,
      e.time_share as time_share,
      jr.weight as role_weight,
      e.rating as rating,
      case e.rating
        when 1 then s.rating_factor_1
        when 2 then s.rating_factor_2
        when 3 then s.rating_factor_3
        when 4 then s.rating_factor_4
        when 5 then s.rating_factor_5
      end as rating_factor
    from public.milestone_engagements e
    join public.employees em on em.id = e.employee_id
    join public.job_roles jr on jr.id = em.job_role_id
    cross join public.bonus_settings s
    where e.milestone_id = p_milestone_id
      and s.id
  ),
  scaled as (
    select
      l.*,
      l.time_share * l.role_weight * l.rating_factor as weighted_contribution,
      (l.time_share * 100) * (l.role_weight * 100) * (l.rating_factor * 100) as e_scaled
    from lines l
  ),
  totals as (
    select sum(sc.e_scaled) as total_scaled
    from scaled sc
  )
  select
    sc.engagement_id,
    sc.employee_id,
    sc.employee_name,
    sc.job_role_name,
    sc.time_share::numeric,
    sc.role_weight::numeric,
    sc.rating,
    sc.rating_factor::numeric,
    sc.weighted_contribution,
    sc.e_scaled / t.total_scaled,
    case
      when v_pool_grosze is null then null
      else div(v_pool_grosze * sc.e_scaled, t.total_scaled) * 0.01
    end
  from scaled sc
  cross join totals t
  order by sc.employee_name, sc.engagement_id;
end;
$$;

revoke execute on function public.milestone_payout_lines(uuid) from public, anon;
grant execute on function public.milestone_payout_lines(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Payout summary: same columns and figures as 20261004130000_milestone_payout_hard_cap.sql, now
-- plpgsql with its own visibility lookup and status guard. A milestone the caller cannot see
-- returns zero rows; a visible Approved one raises MR015.
-- ---------------------------------------------------------------------------
create or replace function public.milestone_payout_summary(p_milestone_id uuid)
returns table (
  milestone_id uuid,
  target_pool numeric,
  kpi_schedule smallint,
  kpi_budget smallint,
  kpi_quality smallint,
  kpi_risk smallint,
  scored boolean,
  multiplier numeric,
  budget_share numeric,
  payout_pool numeric,
  payout_total numeric,
  residual numeric,
  within_pool boolean,
  engagement_count integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_status text;
begin
  select m.status
  into v_status
  from public.milestones m
  where m.id = p_milestone_id;

  if not found then
    return;
  end if;

  if v_status = 'approved' then
    raise exception 'milestone % is approved; read its figures from the approval snapshot (milestone_results, milestone_result_lines)',
      p_milestone_id
      using errcode = 'MR015';
  end if;

  return query
  select
    m.id,
    m.target_pool::numeric,
    m.kpi_schedule,
    m.kpi_budget,
    m.kpi_quality,
    m.kpi_risk,
    num_nulls(m.kpi_schedule, m.kpi_budget, m.kpi_quality, m.kpi_risk) = 0,
    x.multiplier,
    round(x.multiplier / (select s.multiplier_max from public.bonus_settings s where s.id), 6),
    p.payout_pool,
    case when p.payout_pool is not null then coalesce(l.bonus_total, 0) end,
    p.payout_pool - coalesce(l.bonus_total, 0),
    coalesce(l.bonus_total, 0) <= p.payout_pool,
    l.line_count
  from public.milestones m
  cross join lateral (
    select public.kpi_multiplier(m.kpi_schedule, m.kpi_budget, m.kpi_quality, m.kpi_risk) as multiplier
  ) as x
  cross join lateral (
    -- round(..., 2) only trims the scale: capped_payout_pool already floored to the grosz.
    select round(public.capped_payout_pool(m.target_pool, x.multiplier), 2) as payout_pool
  ) as p
  cross join lateral (
    select sum(pl.bonus) as bonus_total, count(*)::integer as line_count
    from public.milestone_payout_lines(m.id) as pl
  ) as l
  where m.id = p_milestone_id;
end;
$$;

revoke execute on function public.milestone_payout_summary(uuid) from public, anon;
grant execute on function public.milestone_payout_summary(uuid) to authenticated;
