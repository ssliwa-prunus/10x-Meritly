/** Access role; mirrors the `public.app_role` enum. */
export type AppRole = "admin" | "supervisor" | "employee";

/** Row of `public.profiles` as exposed to the app (created_at omitted). */
export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  role: AppRole;
}

/** Row of `public.job_roles` as exposed to the app (audit columns omitted). `archived_at` null = active. */
export interface JobRole {
  id: string;
  name: string;
  weight: number;
  description: string | null;
  archived_at: string | null;
}

/** The singleton `public.bonus_settings` row as exposed to the app (id and audit columns omitted). */
export interface BonusSettings {
  kpi_weight_schedule: number;
  kpi_weight_budget: number;
  kpi_weight_quality: number;
  kpi_weight_risk: number;
  multiplier_min: number;
  multiplier_max: number;
  rating_factor_1: number;
  rating_factor_2: number;
  rating_factor_3: number;
  rating_factor_4: number;
  rating_factor_5: number;
}
