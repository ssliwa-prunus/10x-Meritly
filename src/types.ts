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

/** Status of a project or milestone; mirrors the `projects_status_valid` / `milestones_status_valid` checks. */
export type WorkStatus = "planned" | "active" | "completed" | "cancelled";

/** Row of `public.projects` as exposed to the app (audit columns omitted). */
export interface Project {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: WorkStatus;
  total_budget: number;
  notes: string | null;
  supervisor_id: string;
}

/** Row of `public.milestones` as exposed to the app (audit columns omitted). */
export interface Milestone {
  id: string;
  project_id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: WorkStatus;
  target_pool: number;
  notes: string | null;
}

/** Row of the `public.project_budget_exposure` view (FR-017, informational only). */
export interface ProjectExposure {
  project_id: string;
  total_budget: number;
  reserved_total: number;
  remaining: number;
  over_budget: boolean;
}

/** Row of `public.employees` as exposed to the app (audit columns omitted). */
export interface Employee {
  id: string;
  supervisor_id: string;
  full_name: string;
  email: string;
  job_role_id: string;
  profile_id: string | null;
  invited_at: string | null;
  activated_at: string | null;
}

/** Derived from `invited_at` / `activated_at`: never invited, invite sent, or invite accepted. */
export type InviteStatus = "not_invited" | "invited" | "active";

/** Row of the `public.employee_time_share_totals` view (FR-011, informational only). */
export interface EmployeeTimeShare {
  employee_id: string;
  open_total: number;
  over_allocated: boolean;
}

/** Row of `public.milestone_engagements` as exposed to the app (audit columns omitted). */
export interface Engagement {
  id: string;
  milestone_id: string;
  employee_id: string;
  time_share: number;
  rating: number;
}

/**
 * An engagement as listed on a milestone page: the row plus the employee's name and job role (null
 * when the employee row is not visible) and their open time-share total (0 when none).
 */
export interface EngagementListItem extends Engagement {
  employee_name: string | null;
  job_role_name: string | null;
  open_total: number;
  over_allocated: boolean;
}

/** An employee the signed-in Supervisor owns and may still assign to a milestone. */
export type AssignableEmployee = Pick<Employee, "id" | "full_name">;

/** An employee as listed on /employees: the row plus its job role name and open time-share total (0 when none). */
export interface EmployeeListItem extends Employee {
  job_role_name: string;
  open_total: number;
  over_allocated: boolean;
}
