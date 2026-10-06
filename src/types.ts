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

/**
 * Status of a milestone; mirrors `milestones_status_valid`. `approved` is terminal and set only by
 * `public.approve_milestone()`: an approved milestone is frozen (MR015) and counts as closed.
 */
export type MilestoneStatus = WorkStatus | "approved";

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
  status: MilestoneStatus;
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

/**
 * Row of `public.milestone_payout_summary(milestone_id)` (S-04, Draft, computed at read time). The
 * target pool is the approved maximum: `payout_pool` is the target pool scaled by
 * `budget_share` (M / multiplier_max) and never exceeds it. The money fields, `multiplier`,
 * `budget_share` and `within_pool` are null while the milestone is unscored; scored with no
 * engagements, `payout_total` is 0 and `residual` equals `payout_pool`. Amounts are already
 * floored to the grosz in SQL: display them, never recompute them.
 */
export interface MilestonePayoutSummary {
  milestone_id: string;
  target_pool: number;
  kpi_schedule: number | null;
  kpi_budget: number | null;
  kpi_quality: number | null;
  kpi_risk: number | null;
  scored: boolean;
  multiplier: number | null;
  /** M / multiplier_max (display only): the share of the target pool that is paid out. */
  budget_share: number | null;
  payout_pool: number | null;
  payout_total: number | null;
  residual: number | null;
  within_pool: boolean | null;
  engagement_count: number;
}

/**
 * Row of `public.milestone_payout_lines(milestone_id)`: one engagement's weighted contribution
 * (time share x role weight x rating factor), its share of the milestone total (display only) and
 * its bonus (null while the milestone is unscored).
 */
export interface MilestonePayoutLine {
  engagement_id: string;
  employee_id: string;
  employee_name: string;
  job_role_name: string;
  time_share: number;
  role_weight: number;
  rating: number;
  rating_factor: number;
  weighted_contribution: number;
  share: number;
  bonus: number | null;
}

/**
 * Row of `public.milestone_results` (S-05): the frozen header of one approved milestone, written
 * once by `public.approve_milestone()`. Supervisor/Admin only; employees never read it (it carries
 * the pool, total and residual). Figures never change after approval.
 */
export interface MilestoneResult {
  milestone_id: string;
  project_id: string;
  project_name: string;
  milestone_name: string;
  start_date: string;
  end_date: string;
  target_pool: number;
  kpi_schedule: number;
  kpi_budget: number;
  kpi_quality: number;
  kpi_risk: number;
  multiplier: number;
  multiplier_min: number;
  multiplier_max: number;
  /** M / multiplier_max (display only): the share of the target pool that is paid out. */
  budget_share: number;
  payout_pool: number;
  payout_total: number;
  residual: number;
  engagement_count: number;
  approved_at: string;
  approved_by: string | null;
}

/**
 * Row of `public.milestone_result_lines` (S-05): one engagement's frozen figures at approval. An
 * activated employee reads their own lines of approved milestones. Deliberately has no share,
 * pool, total or residual (privacy split); the Supervisor view derives share as
 * `weighted_contribution / sum(weighted_contribution)`. `notified_at` is null until the approval
 * email was sent.
 */
export interface MilestoneResultLine {
  id: string;
  milestone_id: string;
  engagement_id: string;
  employee_id: string;
  employee_name: string;
  job_role_name: string;
  project_id: string;
  project_name: string;
  milestone_name: string;
  start_date: string;
  end_date: string;
  approved_at: string;
  time_share: number;
  role_weight: number;
  rating: number;
  rating_factor: number;
  weighted_contribution: number;
  multiplier: number;
  bonus: number;
  notified_at: string | null;
}
