-- Hard-cap payout pool (S-04 amendment). Business-rule correction: a milestone's target pool is the
-- amount approved (by the president/director) as the MAXIMUM for that milestone's payouts. The
-- earlier rule, payout_pool = floor(target_pool * M), paid out more than the approved amount
-- whenever M > 1.0 (up to target_pool * multiplier_max), so it is replaced by
--
--   payout_pool = floor(target_pool * M / multiplier_max) to the grosz
--
-- which pays out exactly the target pool at M = multiplier_max and never more. The KPI -> M
-- mapping (kpi_multiplier) and the integer-grosze split are unchanged.
--
-- The budget check follows: every non-cancelled milestone now reserves its target_pool (the most
-- it can ever pay out), so project_budget_exposure no longer reads bonus_settings.
--
-- Exactness: M = min + inner * (max - min) has at most 6 decimals (KPI weights have 2, scores are
-- integers, * 0.01, (max - min) has 2) and multiplier_max at most 2, so both are scaled to integers
-- and the pool is computed with div() (exact truncation), never numeric division before the floor:
--   pool_grosze = div(target_pool*100 * (M*1000000), multiplier_max*100*10000)
--
-- S-05 (approval) must snapshot multiplier_max alongside M, the payout pool and the lines: the
-- pool now depends on it, so a later multiplier_max edit must not change an Approved milestone.
-- S-05 also swaps in Approved milestones' stored payout_pool in project_budget_exposure.

-- ---------------------------------------------------------------------------
-- The payout-pool rule. The single place it lives. strict: null when the multiplier is null
-- (unscored). Security invoker: reads bonus_settings under the caller's RLS, so callers without
-- access to the config get null.
-- ---------------------------------------------------------------------------
create function public.capped_payout_pool(p_target_pool numeric, p_multiplier numeric)
returns numeric
language sql
stable
strict
security invoker
set search_path = ''
as $$
  select div(p_target_pool * 100 * (p_multiplier * 1000000), s.multiplier_max * 100 * 10000) * 0.01
  from public.bonus_settings s
  where s.id;
$$;

revoke execute on function public.capped_payout_pool(numeric, numeric) from public, anon;
grant execute on function public.capped_payout_pool(numeric, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Payout lines: same contract as 20261004120000_milestone_kpi_and_payouts.sql; only the pool now
-- comes from capped_payout_pool. Return type unchanged, so create or replace keeps the grants.
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
  v_target_pool numeric;
  v_multiplier numeric;
  v_pool_grosze numeric;
  v_unresolved integer;
begin
  select m.target_pool, public.kpi_multiplier(m.kpi_schedule, m.kpi_budget, m.kpi_quality, m.kpi_risk)
  into v_target_pool, v_multiplier
  from public.milestones m
  where m.id = p_milestone_id;

  if not found then
    return;
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

-- ---------------------------------------------------------------------------
-- Payout summary: same contract as before, the pool from capped_payout_pool, plus the display-only
-- budget_share = M / multiplier_max (rounded to 6 decimals; null while unscored), the share of the
-- target pool that is paid out. The return type changes, so the function is dropped and re-created
-- (nothing depends on it: milestone_payout_lines does not call it) and its grants re-applied.
-- ---------------------------------------------------------------------------
drop function public.milestone_payout_summary(uuid);

create function public.milestone_payout_summary(p_milestone_id uuid)
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
language sql
stable
security invoker
set search_path = ''
as $$
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
$$;

revoke execute on function public.milestone_payout_summary(uuid) from public, anon;
grant execute on function public.milestone_payout_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Budget exposure (FR-017): every non-cancelled milestone reserves its target_pool, the most it can
-- pay out under the hard cap. Same columns as before, still security_invoker (the caller's RLS on
-- projects and milestones applies; no row for employees, who see no projects). bonus_settings is no
-- longer joined. The filter stays an exclusion (<> 'cancelled') so S-05's 'approved' is kept; S-05
-- replaces Approved milestones' amount with their stored payout_pool. create or replace keeps the
-- grants (select for authenticated only).
-- ---------------------------------------------------------------------------
create or replace view public.project_budget_exposure
with (security_invoker = true)
as
select
  e.project_id,
  e.total_budget,
  e.reserved_total,
  e.total_budget - e.reserved_total as remaining,
  e.reserved_total > e.total_budget as over_budget
from (
  select
    p.id as project_id,
    p.total_budget,
    coalesce(sum(m.target_pool) filter (where m.status <> 'cancelled'), 0) as reserved_total
  from public.projects p
  left join public.milestones m on m.project_id = p.id
  group by p.id, p.total_budget
) as e;
