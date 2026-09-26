-- Bonus rules configuration: job roles (role weights) and the singleton bonus_settings row
-- (KPI weights, milestone multiplier bounds, rating -> factor mapping). Every value rule is a
-- CHECK constraint, so invalid config cannot be stored even if the app-side validation is
-- bypassed. Defaults come from docs/Model Premiowania/Model_premiowania.xlsx (sheet Ustawienia)
-- and are seeded here, not in seed.sql, so every environment (production included) starts with
-- a valid config.
--
-- Freezing: approved milestones are not protected by versioning this config. Later slices
-- (S-04/S-05) must snapshot the values they used onto their own result rows.

-- ---------------------------------------------------------------------------
-- job_roles: named role weights. Archived rows (archived_at not null) stay readable for
-- existing references; new assignments must pick only rows with archived_at is null.
-- ---------------------------------------------------------------------------
create table public.job_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  weight numeric(4, 2) not null,
  description text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  constraint job_roles_name_length check (char_length(name) between 1 and 100),
  constraint job_roles_name_trimmed check (name = btrim(name)),
  constraint job_roles_weight_range check (weight > 0 and weight <= 3)
);

-- Case-insensitive uniqueness over all rows, archived included, so a restore never collides.
create unique index job_roles_name_lower_key on public.job_roles (lower(name));

alter table public.job_roles enable row level security;

revoke all on public.job_roles from anon;

-- ---------------------------------------------------------------------------
-- bonus_settings: exactly one row (boolean PK that must be true).
-- ---------------------------------------------------------------------------
create table public.bonus_settings (
  id boolean primary key default true,
  kpi_weight_schedule numeric(3, 2) not null,
  kpi_weight_budget numeric(3, 2) not null,
  kpi_weight_quality numeric(3, 2) not null,
  kpi_weight_risk numeric(3, 2) not null,
  multiplier_min numeric(4, 2) not null,
  multiplier_max numeric(4, 2) not null,
  rating_factor_1 numeric(4, 2) not null,
  rating_factor_2 numeric(4, 2) not null,
  rating_factor_3 numeric(4, 2) not null,
  rating_factor_4 numeric(4, 2) not null,
  rating_factor_5 numeric(4, 2) not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  constraint bonus_settings_singleton check (id),
  constraint bonus_settings_kpi_weight_schedule_range check (kpi_weight_schedule >= 0 and kpi_weight_schedule <= 1),
  constraint bonus_settings_kpi_weight_budget_range check (kpi_weight_budget >= 0 and kpi_weight_budget <= 1),
  constraint bonus_settings_kpi_weight_quality_range check (kpi_weight_quality >= 0 and kpi_weight_quality <= 1),
  constraint bonus_settings_kpi_weight_risk_range check (kpi_weight_risk >= 0 and kpi_weight_risk <= 1),
  constraint bonus_settings_kpi_weights_sum check (
    kpi_weight_schedule + kpi_weight_budget + kpi_weight_quality + kpi_weight_risk = 1
  ),
  constraint bonus_settings_multiplier_range check (
    multiplier_min > 0 and multiplier_min < multiplier_max and multiplier_max <= 3
  ),
  constraint bonus_settings_rating_factor_1_range check (rating_factor_1 > 0 and rating_factor_1 <= 3),
  constraint bonus_settings_rating_factor_2_range check (rating_factor_2 > 0 and rating_factor_2 <= 3),
  constraint bonus_settings_rating_factor_3_range check (rating_factor_3 > 0 and rating_factor_3 <= 3),
  constraint bonus_settings_rating_factor_4_range check (rating_factor_4 > 0 and rating_factor_4 <= 3),
  constraint bonus_settings_rating_factor_5_range check (rating_factor_5 > 0 and rating_factor_5 <= 3),
  constraint bonus_settings_rating_factors_ordered check (
    rating_factor_1 <= rating_factor_2
    and rating_factor_2 <= rating_factor_3
    and rating_factor_3 <= rating_factor_4
    and rating_factor_4 <= rating_factor_5
  )
);

alter table public.bonus_settings enable row level security;

revoke all on public.bonus_settings from anon;

-- ---------------------------------------------------------------------------
-- Audit fields: updated_at / updated_by are always set by the database, never trusted from
-- the client. updated_by is null for rows written without a JWT (e.g. the seed rows below).
-- ---------------------------------------------------------------------------
create function public.set_config_audit_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

revoke execute on function public.set_config_audit_fields() from public, anon, authenticated;

create trigger job_roles_set_audit_fields
  before insert or update on public.job_roles
  for each row execute function public.set_config_audit_fields();

create trigger bonus_settings_set_audit_fields
  before update on public.bonus_settings
  for each row execute function public.set_config_audit_fields();

-- ---------------------------------------------------------------------------
-- Policies (all to authenticated; anon has no access at all). Admins read and write,
-- supervisors only read, employees see nothing.
--
-- Deliberately absent: there are NO delete policies on either table and NO insert policy on
-- bonus_settings for any API role. With RLS enabled, a missing policy means the operation is
-- denied. Job roles are archived (archived_at), never deleted; the single bonus_settings row
-- is seeded by this migration and only ever updated. This is intentional, not an oversight.
-- ---------------------------------------------------------------------------
create policy job_roles_select_admin
  on public.job_roles
  for select
  to authenticated
  using ((select public.is_admin()));

create policy job_roles_select_supervisor
  on public.job_roles
  for select
  to authenticated
  using ((select public.is_supervisor()));

create policy job_roles_insert_admin
  on public.job_roles
  for insert
  to authenticated
  with check ((select public.is_admin()));

create policy job_roles_update_admin
  on public.job_roles
  for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy bonus_settings_select_admin
  on public.bonus_settings
  for select
  to authenticated
  using ((select public.is_admin()));

create policy bonus_settings_select_supervisor
  on public.bonus_settings
  for select
  to authenticated
  using ((select public.is_supervisor()));

create policy bonus_settings_update_admin
  on public.bonus_settings
  for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Defaults (spreadsheet sheet Ustawienia)
-- ---------------------------------------------------------------------------
insert into public.bonus_settings (
  kpi_weight_schedule,
  kpi_weight_budget,
  kpi_weight_quality,
  kpi_weight_risk,
  multiplier_min,
  multiplier_max,
  rating_factor_1,
  rating_factor_2,
  rating_factor_3,
  rating_factor_4,
  rating_factor_5
)
values (0.30, 0.30, 0.25, 0.15, 0.70, 1.30, 0.80, 0.90, 1.00, 1.10, 1.20);

insert into public.job_roles (name, weight, description)
values
  ('Lider projektu / Architekt', 1.25, 'Kluczowe decyzje, odpowiedzialność za integrację'),
  ('Senior', 1.10, 'Duży wpływ techniczny, mentoring'),
  ('Specjalista', 1.00, 'Standardowy wkład'),
  ('Junior', 0.85, 'Wkład pod nadzorem'),
  ('Tester/QA', 1.00, 'Jakość i kryteria akceptacji'),
  ('Inż. elektroniki', 1.10, 'Projektowanie, uruchomienia, EMC'),
  ('Inż. firmware', 1.15, 'Sterowniki, RTOS, bezpieczeństwo'),
  ('Inż. oprogramowania', 1.05, 'Backend/frontend, integracje');
