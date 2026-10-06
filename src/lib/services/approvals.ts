import { FunctionsHttpError, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { firstIssueError as firstFormIssueError, parseForm as parseFormWith } from "@/lib/forms";
import { PROJECTS_PATH } from "@/lib/services/projects";
import type { MilestonePayoutLine, MilestonePayoutSummary, MyBonuses } from "@/types";

// ---------------------------------------------------------------------------
// Error codes. Approval failures travel to the milestone page as a fixed code in the redirect
// URL, never as free text, so a crafted link cannot put arbitrary text on the page. The page
// resolves codes with approvalErrorMessage(); unknown codes fall back to a generic message.
// ---------------------------------------------------------------------------

const APPROVAL_ERROR_MESSAGES = {
  invalid_form: "Invalid form submission",
  invalid_id: "Invalid id",
  confirm_required: "Tick the confirmation to approve the milestone",
  not_found: "Not found",
  not_approvable:
    "This milestone cannot be approved: it needs all four KPI scores and at least one assignment, and must not be cancelled",
  already_approved: "This milestone is already approved",
  project_closed: "The project is completed or cancelled; reopen it before approving its milestones",
  admin_read_only: "Admins can view approvals but not approve milestones",
  save_failed: "Could not approve the milestone. Please try again.",
  not_configured: "Supabase is not configured",
  not_approved: "This milestone is not approved yet; bonus emails are sent only after approval",
  email_not_configured: "Bonus emails are not configured. Ask an administrator to set up the email provider.",
  send_failed: "No bonus email could be sent. Please try again later.",
  notify_failed: "Could not send the bonus emails. Please try again.",
} as const;

export type ApprovalErrorCode = keyof typeof APPROVAL_ERROR_MESSAGES;

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export interface ApprovalError {
  code: ApprovalErrorCode;
  field?: string;
}

const isApprovalErrorCode = (value: string): value is ApprovalErrorCode =>
  Object.hasOwn(APPROVAL_ERROR_MESSAGES, value);

/** Message for an error code taken from the URL. Only fixed catalog text is ever returned. */
export function approvalErrorMessage(code: string): string {
  if (!isApprovalErrorCode(code)) return GENERIC_ERROR_MESSAGE;
  return APPROVAL_ERROR_MESSAGES[code];
}

// Notices: approval succeeded, but not every bonus email went out. Same rule as errors: the URL
// carries a code, the page shows fixed catalog text, and an unknown code shows nothing.
const APPROVAL_NOTICE_MESSAGES = {
  email_partial: "Some bonus emails could not be sent. Use “Re-send unsent emails” to try again.",
  email_failed: "The bonus emails could not be sent. Use “Re-send unsent emails” to try again.",
} as const;

export type ApprovalNoticeCode = keyof typeof APPROVAL_NOTICE_MESSAGES;

const isApprovalNoticeCode = (value: string): value is ApprovalNoticeCode =>
  Object.hasOwn(APPROVAL_NOTICE_MESSAGES, value);

/** Message for a notice code taken from the URL; null for an unknown code. */
export function approvalNoticeMessage(code: string): string | null {
  if (!isApprovalNoticeCode(code)) return null;
  return APPROVAL_NOTICE_MESSAGES[code];
}

// ---------------------------------------------------------------------------
// Validation. approve_milestone enforces every approval rule (MR014, MR015, MR003, 42501); the
// form only carries the required confirmation checkbox. A native checkbox sends "on" when ticked
// and nothing when not.
// ---------------------------------------------------------------------------

export const approveInputSchema = z.object({
  confirm: z.literal("on", { error: "confirm_required" }),
});

/** First issue of a failed parse as an error code plus the offending field, if any. */
export function firstIssueError(error: z.ZodError): ApprovalError {
  return firstFormIssueError(error, isApprovalErrorCode);
}

/** Reads the request body as form data and validates it; a body that isn't form data is an error, not a 500. */
export function parseForm<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ data: z.output<T>; error?: undefined } | { data?: undefined; error: ApprovalError }> {
  return parseFormWith(request, schema, isApprovalErrorCode);
}

// ---------------------------------------------------------------------------
// Redirect target for the approve and notify endpoints. Query params read by the milestone page:
//   saved=approved | saved=notified      success flash (approved, or unsent emails re-sent)
//   notice=email_partial | email_failed  with saved: not every bonus email went out
//   error=<code>&section=approval        catalog code; the approval card shows the error
// ---------------------------------------------------------------------------

export type ApprovalSavedCode = "approved" | "notified";

export type ApprovalFlash =
  | { saved: ApprovalSavedCode; notice?: ApprovalNoticeCode; error?: undefined }
  | { saved?: undefined; notice?: undefined; error: ApprovalError };

/** A milestone's page with an approval flash. `projectId` and `milestoneId` must already be validated UUIDs. */
export function approvalUrl(projectId: string, milestoneId: string, flash: ApprovalFlash): string {
  const path = `${PROJECTS_PATH}/${projectId}/milestones/${milestoneId}`;
  if (flash.saved) {
    const params = new URLSearchParams({ saved: flash.saved });
    if (flash.notice) params.set("notice", flash.notice);
    return `${path}?${params.toString()}`;
  }
  const params = new URLSearchParams({ error: flash.error.code });
  if (flash.error.field) params.set("field", flash.error.field);
  params.set("section", "approval");
  return `${path}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Data access. Always called with the request-scoped client (the signed-in user's JWT), never
// the service role, so RLS decides who may approve and who reads the snapshot. The figures were
// computed and floored in SQL at approval; numerics may arrive as strings and are converted with
// Number() for display only. TS does no money arithmetic.
// ---------------------------------------------------------------------------

export interface ServiceResult<T = undefined> {
  data?: T;
  error?: string;
}

export interface WriteResult<T = undefined> {
  data?: T;
  error?: ApprovalError;
}

const NOT_FOUND: ApprovalError = { code: "not_found" };

/** Custom SQLSTATEs raised by approve_milestone and the milestone guard triggers. */
const GUARD_ERROR_CODES: Record<string, ApprovalErrorCode> = {
  MR003: "project_closed",
  MR014: "not_approvable",
  MR015: "already_approved",
};

function mapPostgrestError(error: PostgrestError, context: string): ApprovalError {
  // The RPC's permission check rejected the caller (also Admins): to them the milestone does not exist.
  if (error.code === "42501") return NOT_FOUND;
  if (Object.hasOwn(GUARD_ERROR_CODES, error.code)) return { code: GUARD_ERROR_CODES[error.code] };
  // eslint-disable-next-line no-console -- intentional: surfaces unexpected DB errors in Workers observability logs
  console.error(`${context} failed`, { code: error.code, message: error.message });
  return { code: "save_failed" };
}

function mapLoadError(error: PostgrestError, context: string): string {
  // eslint-disable-next-line no-console -- intentional: surfaces unexpected DB errors in Workers observability logs
  console.error(`${context} failed`, { code: error.code, message: error.message });
  return "Could not load bonuses. Please try again.";
}

type Numeric = number | string;

interface ResultHeaderRow {
  milestone_id: string;
  target_pool: Numeric;
  kpi_schedule: number;
  kpi_budget: number;
  kpi_quality: number;
  kpi_risk: number;
  multiplier: Numeric;
  budget_share: Numeric;
  payout_pool: Numeric;
  payout_total: Numeric;
  residual: Numeric;
  engagement_count: Numeric;
  approved_at: string;
}

interface ResultLineRow {
  engagement_id: string;
  employee_id: string;
  employee_name: string;
  job_role_name: string;
  time_share: Numeric;
  role_weight: Numeric;
  rating: Numeric;
  rating_factor: Numeric;
  weighted_contribution: Numeric;
  bonus: Numeric;
  notified_at: string | null;
}

const HEADER_COLUMNS =
  "milestone_id, target_pool, kpi_schedule, kpi_budget, kpi_quality, kpi_risk, multiplier, budget_share, payout_pool, payout_total, residual, engagement_count, approved_at";

const LINE_COLUMNS =
  "engagement_id, employee_id, employee_name, job_role_name, time_share, role_weight, rating, rating_factor, weighted_contribution, bonus, notified_at";

const toApprovedSummary = (row: ResultHeaderRow): MilestonePayoutSummary => ({
  milestone_id: row.milestone_id,
  target_pool: Number(row.target_pool),
  kpi_schedule: row.kpi_schedule,
  kpi_budget: row.kpi_budget,
  kpi_quality: row.kpi_quality,
  kpi_risk: row.kpi_risk,
  scored: true,
  multiplier: Number(row.multiplier),
  budget_share: Number(row.budget_share),
  payout_pool: Number(row.payout_pool),
  payout_total: Number(row.payout_total),
  residual: Number(row.residual),
  // The header CHECK (payout_total <= payout_pool) guarantees this; computed for the badge only.
  within_pool: Number(row.payout_total) <= Number(row.payout_pool),
  engagement_count: Number(row.engagement_count),
});

/**
 * Approves a milestone through approve_milestone: the RPC checks ownership, status, scores and
 * engagements, writes the frozen snapshot and sets the status to approved in one transaction.
 */
export async function approveMilestone(supabase: SupabaseClient, milestoneId: string): Promise<WriteResult> {
  const { error } = await supabase.rpc("approve_milestone", { p_milestone_id: milestoneId });
  if (error) return { error: mapPostgrestError(error, "approveMilestone") };
  return {};
}

/**
 * An approved milestone's frozen snapshot in the Draft payout shapes, so PayoutSection renders
 * both: the summary (null when no snapshot is visible), the lines in employee-name order and the
 * approval time. The lines carry no share (privacy split), so it is rebuilt here as
 * weighted_contribution / Σ weighted_contribution, for display only. notified_count / line_count
 * count the lines whose bonus email the provider confirmed, for "Emails sent: N of M".
 */
export async function getApprovedPayout(
  supabase: SupabaseClient,
  milestoneId: string,
): Promise<
  ServiceResult<{
    summary: MilestonePayoutSummary;
    lines: MilestonePayoutLine[];
    approved_at: string;
    notified_count: number;
    line_count: number;
  }>
> {
  const [header, lines] = await Promise.all([
    supabase
      .from("milestone_results")
      .select(HEADER_COLUMNS)
      .eq("milestone_id", milestoneId)
      .maybeSingle<ResultHeaderRow>(),
    supabase
      .from("milestone_result_lines")
      .select(LINE_COLUMNS)
      .eq("milestone_id", milestoneId)
      .order("employee_name", { ascending: true })
      .order("engagement_id", { ascending: true })
      .overrideTypes<ResultLineRow[], { merge: false }>(),
  ]);

  if (header.error) return { error: mapLoadError(header.error, "getApprovedPayoutHeader") };
  if (lines.error) return { error: mapLoadError(lines.error, "getApprovedPayoutLines") };
  if (!header.data) {
    // An approved milestone always has a header (approve_milestone writes both in one statement), so
    // a missing one is a broken invariant or an RLS gap: surface it instead of rendering nothing.
    // eslint-disable-next-line no-console -- intentional: surfaces the broken invariant in Workers observability logs
    console.error("getApprovedPayout: approved milestone has no snapshot header", { milestoneId });
    return { error: "Could not load bonuses. Please try again." };
  }

  const totalContribution = lines.data.reduce((sum, row) => sum + Number(row.weighted_contribution), 0);

  return {
    data: {
      summary: toApprovedSummary(header.data),
      lines: lines.data.map((row) => ({
        engagement_id: row.engagement_id,
        employee_id: row.employee_id,
        employee_name: row.employee_name,
        job_role_name: row.job_role_name,
        time_share: Number(row.time_share),
        role_weight: Number(row.role_weight),
        rating: Number(row.rating),
        rating_factor: Number(row.rating_factor),
        weighted_contribution: Number(row.weighted_contribution),
        share: totalContribution > 0 ? Number(row.weighted_contribution) / totalContribution : 0,
        bonus: Number(row.bonus),
      })),
      approved_at: header.data.approved_at,
      notified_count: lines.data.filter((row) => row.notified_at !== null).length,
      line_count: lines.data.length,
    },
  };
}

/** Response codes of the notify-milestone-approved Edge Function mapped to the catalog. */
const NOTIFY_ERROR_CODES: Record<string, ApprovalErrorCode> = {
  invalid_request: "invalid_id",
  forbidden: "not_found",
  not_found: "not_found",
  not_approved: "not_approved",
  email_not_configured: "email_not_configured",
  send_failed: "send_failed",
  notify_failed: "notify_failed",
};

/** Reads the function's `{ code }` body from an HTTP error response; null when it has none. */
async function functionErrorCode(response: unknown): Promise<string | null> {
  if (!(response instanceof Response)) return null;
  try {
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return null;
    const code = (body as Record<string, unknown>).code;
    return typeof code === "string" ? code : null;
  } catch {
    return null;
  }
}

const toCount = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/**
 * Emails each engaged employee of an approved milestone their own bonus through the
 * notify-milestone-approved Edge Function. Only unsent lines are sent, so it doubles as the
 * re-send. Called after approve_milestone has committed: a failure never undoes the approval.
 */
export async function notifyMilestoneApproved(
  supabase: SupabaseClient,
  milestoneId: string,
): Promise<WriteResult<{ sent: number; failed: number }>> {
  const result = await supabase.functions.invoke("notify-milestone-approved", {
    body: { milestone_id: milestoneId },
  });
  const error: unknown = result.error;
  if (!error) {
    const body: unknown = result.data;
    const counts = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    return { data: { sent: toCount(counts.sent), failed: toCount(counts.failed) } };
  }

  if (error instanceof FunctionsHttpError) {
    const code = await functionErrorCode(error.context);
    if (code !== null && Object.hasOwn(NOTIFY_ERROR_CODES, code)) return { error: { code: NOTIFY_ERROR_CODES[code] } };
  }

  // eslint-disable-next-line no-console -- intentional: surfaces function failures in Workers observability logs
  console.error("notifyMilestoneApproved failed", { name: error instanceof Error ? error.name : typeof error });
  return { error: { code: "notify_failed" } };
}

interface MyBonusRow {
  id: string;
  project_name: string;
  milestone_name: string;
  start_date: string;
  end_date: string;
  approved_at: string;
  job_role_name: string;
  time_share: Numeric;
  role_weight: Numeric;
  rating: Numeric;
  rating_factor: Numeric;
  multiplier: Numeric;
  bonus: Numeric;
}

const MY_BONUS_COLUMNS =
  "id, project_name, milestone_name, start_date, end_date, approved_at, job_role_name, time_share, role_weight, rating, rating_factor, multiplier, bonus";

/**
 * The signed-in employee's own approved bonuses, newest approval first. current_employee_id() is
 * null unless the account is linked to an activated employee record; then the list is empty and
 * `not_linked` is set. RLS already limits an employee to their own lines of approved milestones;
 * the employee_id filter is defence in depth.
 */
export async function listMyBonuses(supabase: SupabaseClient): Promise<ServiceResult<MyBonuses>> {
  const linked = await supabase.rpc("current_employee_id");
  if (linked.error) return { error: mapLoadError(linked.error, "listMyBonusesEmployee") };
  // The function returns a scalar uuid; the untyped client types it as any, so it is narrowed here.
  const employeeId: unknown = linked.data;
  if (typeof employeeId !== "string") return { data: { lines: [], not_linked: true } };

  const { data, error } = await supabase
    .from("milestone_result_lines")
    .select(MY_BONUS_COLUMNS)
    .eq("employee_id", employeeId)
    .order("approved_at", { ascending: false })
    .order("milestone_name", { ascending: true })
    .overrideTypes<MyBonusRow[], { merge: false }>();
  if (error) return { error: mapLoadError(error, "listMyBonuses") };

  return {
    data: {
      not_linked: false,
      lines: data.map((row) => ({
        id: row.id,
        project_name: row.project_name,
        milestone_name: row.milestone_name,
        start_date: row.start_date,
        end_date: row.end_date,
        approved_at: row.approved_at,
        job_role_name: row.job_role_name,
        time_share: Number(row.time_share),
        role_weight: Number(row.role_weight),
        rating: Number(row.rating),
        rating_factor: Number(row.rating_factor),
        multiplier: Number(row.multiplier),
        bonus: Number(row.bonus),
      })),
    },
  };
}
