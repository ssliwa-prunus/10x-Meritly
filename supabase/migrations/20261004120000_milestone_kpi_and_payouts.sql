-- Milestone KPI scores and computed bonuses (S-04; FR-006, FR-009, FR-010). A milestone carries four
-- KPI scores; the payout figures are computed at read time from the current config, role weights
-- and engagements. Every score rule (range, all-or-nothing, cancelled milestone) is enforced here,
-- so the app-side validation is a convenience only.
--
-- Formula (all inputs from public.bonus_settings and public.job_roles at read time):
--
--   inner       = (w_schedule*S + w_budget*B + w_quality*Q + w_risk*R) * 0.01      in [0, 1]
--   M           = least(max, greatest(min, min + inner * (max - min)))
--   payout_pool = money_floor_mul(target_pool, M)
--   e_i         = time_share_i * role_weight_i * rating_factor_i
--   bonus_i     = floor(payout_pool * e_i / sum(e)) to the grosz
--
--   S/B/Q/R are the scores Termin/Budżet/Jakość/Ryzyko, whole numbers 0-100, 100 = best for ALL
--   FOUR. Ryzyko is deliberately higher = better (100 = no risk), unlike the spreadsheet formula
--   (Model_premiowania.xlsx, Milestones!M uses 1 - R/100), whose own instruction doc reads the
--   scale the other way. The spreadsheet's MIN(M, 1) cap (Wyniki!I) is NOT reproduced: M above
--   1.0 pays out more than the target pool, within multiplier_max (PRD Business Logic).
--
--   KPI weights sum to exactly 1, so inner is in [0, 1] and M lands in [min, max] without the
--   clamp; the clamp is kept as a guard. kpi_multiplier() is the only place this mapping lives.
--
-- Exactness: every input has at most 2 decimals, so the split runs in integer grosze with no
-- numeric division before the floor:
--   e_scaled_i = (time_share*100) * (role_weight*100) * (rating_factor*100)      (integers)
--   bonus_i    = div(payout_pool*100 * e_scaled_i, sum(e_scaled)) * 0.01
-- div() truncates exactly; numeric division would round at its own scale and could overpay by
-- 0.01. sum(bonus) <= payout_pool always; the difference is the rounding residual.
--
-- Draft only: nothing here is stored. The figures follow the current config, role weights and
-- engagements on every read. S-05 (approval) must snapshot the multiplier, payout pool, and each
-- line's role weight, rating factor and bonus onto its own result rows when a milestone is
-- approved, so later config edits never change Approved milestones (contract-surfaces.md,
-- "Config snapshot rule").
--
-- Custom SQLSTATE added to the catalog (20260930120000_projects_guard_engaged_owner_change.sql):
--   MR013 milestone_cancelled   a KPI score is set or changed while the milestone is cancelled
-- MR003 (closed project) keeps coming from milestones_check_parent.

-- ---------------------------------------------------------------------------
-- KPI score columns: nullable (unscored), whole numbers 0-100, all four set or none.
-- milestones keeps its table-level update grant and policies, so no grant changes are needed.
-- ---------------------------------------------------------------------------
alter table public.milestones
  add column kpi_schedule smallint,
  add column kpi_budget smallint,
  add column kpi_quality smallint,
  add column kpi_risk smallint,
  add constraint milestones_kpi_schedule_range check (kpi_schedule between 0 and 100),
  add constraint milestones_kpi_budget_range check (kpi_budget between 0 and 100),
  add constraint milestones_kpi_quality_range check (kpi_quality between 0 and 100),
  add constraint milestones_kpi_risk_range check (kpi_risk between 0 and 100),
  add constraint milestones_kpi_all_or_none check (
    num_nulls(kpi_schedule, kpi_budget, kpi_quality, kpi_risk) in (0, 4)
  );

-- ---------------------------------------------------------------------------
-- Guard trigger: permission (42501), then no score change on a cancelled milestone (MR013).
-- Triggers on milestones fire in name order, so milestones_check_parent (42501, MR006, MR003,
-- MR002) runs first; the 42501 check is repeated here so this guard never answers MR013 about a
-- milestone the caller cannot see, whatever the order. Keep it in sync with the milestones
-- insert/update policies (owns_project). Writes without a JWT (seed, Studio) keep the MR013 rule.
-- ---------------------------------------------------------------------------
create function public.milestones_check_scores()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.owns_project(new.project_id) then
    raise exception 'permission denied for project %', new.project_id
      using errcode = '42501';
  end if;

  if new.status = 'cancelled' then
    if tg_op = 'INSERT' then
      if num_nonnulls(new.kpi_schedule, new.kpi_budget, new.kpi_quality, new.kpi_risk) > 0 then
        raise exception 'milestone is cancelled; its KPI scores cannot be set'
          using errcode = 'MR013';
      end if;
    elsif (new.kpi_schedule, new.kpi_budget, new.kpi_quality, new.kpi_risk)
      is distinct from (old.kpi_schedule, old.kpi_budget, old.kpi_quality, old.kpi_risk) then
      -- "update of" fires whenever a score is in the SET list, even if unchanged.
      raise exception 'milestone is cancelled; its KPI scores cannot be changed'
        using errcode = 'MR013';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.milestones_check_scores() from public, anon, authenticated;

create trigger milestones_check_scores
  before insert or update of kpi_schedule, kpi_budget, kpi_quality, kpi_risk on public.milestones
  for each row execute function public.milestones_check_scores();

-- ---------------------------------------------------------------------------
-- KPI -> milestone multiplier M. The single place this mapping lives. strict: null when any score
-- is null (unscored). Security invoker: reads bonus_settings under the caller's RLS, so callers
-- without access to the config (Employees) get null. Exact: only multiplication and * 0.01.
-- ---------------------------------------------------------------------------
create function public.kpi_multiplier(p_schedule smallint, p_budget smallint, p_quality smallint, p_risk smallint)
returns numeric
language sql
stable
strict
security invoker
set search_path = ''
as $$
  select least(
    s.multiplier_max,
    greatest(
      s.multiplier_min,
      s.multiplier_min
        + (
          s.kpi_weight_schedule * p_schedule
          + s.kpi_weight_budget * p_budget
          + s.kpi_weight_quality * p_quality
          + s.kpi_weight_risk * p_risk
        ) * 0.01 * (s.multiplier_max - s.multiplier_min)
    )
  )
  from public.bonus_settings s
  where s.id;
$$;

revoke execute on function public.kpi_multiplier(smallint, smallint, smallint, smallint) from public, anon;
grant execute on function public.kpi_multiplier(smallint, smallint, smallint, smallint) to authenticated;

-- ---------------------------------------------------------------------------
-- Per-employee payout lines of one milestone, one row per engagement, ordered by employee name.
-- Security invoker: RLS on milestones, milestone_engagements, employees, job_roles and
-- bonus_settings decides visibility, so a caller who cannot see the milestone gets no rows.
-- weighted_contribution is the exact e_i; share (e_i / sum(e)) is for display only; bonus is
-- null while the milestone is unscored.
--
-- Never splits the pool among fewer people: if any engagement's role weight or rating factor
-- cannot be resolved (employee, job role or config row not visible to the caller), it raises.
-- The owning Supervisor always sees engaged employees (employee_engaged_on_own_milestone) and
-- Admins see everything, so this is a guard, not an expected path.
-- ---------------------------------------------------------------------------
create function public.milestone_payout_lines(p_milestone_id uuid)
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

  -- money_floor_mul already floors to the grosz, so * 100 is a whole number.
  if v_multiplier is not null then
    v_pool_grosze := public.money_floor_mul(v_target_pool, v_multiplier) * 100;
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
-- Payout summary of one milestone: zero rows when the caller cannot see it, else one row.
-- multiplier, payout_pool, payout_total, residual and within_pool are null while unscored.
-- Scored with no engagements: payout_total 0 and residual = payout_pool. payout_total is the sum
-- of milestone_payout_lines' bonuses, so the two functions always agree (and this one raises
-- whenever the lines would). Security invoker, like the lines.
-- ---------------------------------------------------------------------------
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
    -- round(..., 2) only trims the scale: money_floor_mul already floored to the grosz.
    select round(public.money_floor_mul(m.target_pool, x.multiplier), 2) as payout_pool
  ) as p
  cross join lateral (
    select sum(pl.bonus) as bonus_total, count(*)::integer as line_count
    from public.milestone_payout_lines(m.id) as pl
  ) as l
  where m.id = p_milestone_id;
$$;

revoke execute on function public.milestone_payout_summary(uuid) from public, anon;
grant execute on function public.milestone_payout_summary(uuid) to authenticated;
