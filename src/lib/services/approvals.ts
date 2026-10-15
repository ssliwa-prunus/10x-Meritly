import { FunctionsHttpError, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  logError,
  logFunctionError,
  mapLoadError,
  readFunctionError,
  type LogContext,
  type LogMeta,
} from "@/lib/error-log";
import { firstIssueError as firstFormIssueError, parseForm as parseFormWith } from "@/lib/forms";
import { format, getMessages, type Locale } from "@/lib/i18n";
import { PROJECTS_PATH } from "@/lib/services/projects";
import type { LoadErrorCode, MilestonePayoutLine, MilestonePayoutSummary, MyBonusLine, MyBonuses } from "@/types";

// ---------------------------------------------------------------------------
// Error codes. Approval failures travel to the milestone page as a fixed code in the redirect
// URL, never as free text, so a crafted link cannot put arbitrary text on the page. The page
// resolves codes with approvalErrorMessage() in the request's locale; unknown codes fall back to a
// generic message. The EN catalog defines the codes and the PL catalog is typed against them, so a
// missing translation fails the type check.
// ---------------------------------------------------------------------------

const APPROVAL_ERROR_MESSAGES_EN = {
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

export type ApprovalErrorCode = keyof typeof APPROVAL_ERROR_MESSAGES_EN;

const APPROVAL_ERROR_MESSAGES: Record<Locale, Record<ApprovalErrorCode, string>> = {
  en: APPROVAL_ERROR_MESSAGES_EN,
  pl: {
    invalid_form: "Nieprawidłowe dane formularza",
    invalid_id: "Nieprawidłowy identyfikator",
    confirm_required: "Zaznacz potwierdzenie, aby zatwierdzić kamień milowy",
    not_found: "Nie znaleziono",
    not_approvable:
      "Tego kamienia milowego nie można zatwierdzić: wymaga wszystkich czterech wyników KPI i co najmniej jednego przypisania oraz nie może być anulowany",
    already_approved: "Ten kamień milowy jest już zatwierdzony",
    project_closed: "Projekt jest zakończony lub anulowany; wznów go przed zatwierdzaniem jego kamieni milowych",
    admin_read_only: "Administratorzy mogą przeglądać zatwierdzenia, ale nie mogą zatwierdzać kamieni milowych",
    save_failed: "Nie udało się zatwierdzić kamienia milowego. Spróbuj ponownie.",
    not_configured: "Supabase nie jest skonfigurowany",
    not_approved:
      "Ten kamień milowy nie jest jeszcze zatwierdzony; e-maile o premiach są wysyłane dopiero po zatwierdzeniu",
    email_not_configured:
      "Wysyłka e-maili o premiach nie jest skonfigurowana. Poproś administratora o skonfigurowanie dostawcy poczty.",
    send_failed: "Nie udało się wysłać żadnego e-maila o premii. Spróbuj ponownie później.",
    notify_failed: "Nie udało się wysłać e-maili o premiach. Spróbuj ponownie.",
  },
};

const GENERIC_ERROR_MESSAGE: Record<Locale, string> = {
  en: "Something went wrong. Please try again.",
  pl: "Coś poszło nie tak. Spróbuj ponownie.",
};

export interface ApprovalError {
  code: ApprovalErrorCode;
  field?: string;
}

const isApprovalErrorCode = (value: string): value is ApprovalErrorCode =>
  Object.hasOwn(APPROVAL_ERROR_MESSAGES_EN, value);

/** Message for an error code taken from the URL. Only fixed catalog text is ever returned. */
export function approvalErrorMessage(code: string, locale: Locale): string {
  if (!isApprovalErrorCode(code)) return GENERIC_ERROR_MESSAGE[locale];
  return APPROVAL_ERROR_MESSAGES[locale][code];
}

// Notices: approval succeeded, but not every bonus email went out. Same rule as errors: the URL
// carries a code, the page shows fixed catalog text, and an unknown code shows nothing. The text
// quotes the "Emails sent" label and the re-send button by name, so {emailsSent} and {resend} are
// filled from the same dictionary entries (t.milestones) the approval card renders.
const APPROVAL_NOTICE_MESSAGES_EN = {
  email_partial: "Some bonus emails could not be sent. Use “{resend}” to try again.",
  email_failed: "The bonus emails could not be sent. Use “{resend}” to try again.",
  email_pending:
    "Bonus emails are still being sent by another request. Check “{emailsSent}” in a few minutes; if it does not change, use “{resend}”.",
} as const;

export type ApprovalNoticeCode = keyof typeof APPROVAL_NOTICE_MESSAGES_EN;

const APPROVAL_NOTICE_MESSAGES: Record<Locale, Record<ApprovalNoticeCode, string>> = {
  en: APPROVAL_NOTICE_MESSAGES_EN,
  pl: {
    email_partial: "Nie udało się wysłać części e-maili o premiach. Użyj przycisku „{resend}”, aby spróbować ponownie.",
    email_failed: "Nie udało się wysłać e-maili o premiach. Użyj przycisku „{resend}”, aby spróbować ponownie.",
    email_pending:
      "E-maile o premiach są wciąż wysyłane przez inne żądanie. Sprawdź „{emailsSent}” za kilka minut; jeśli wartość się nie zmieni, użyj przycisku „{resend}”.",
  },
};

const isApprovalNoticeCode = (value: string): value is ApprovalNoticeCode =>
  Object.hasOwn(APPROVAL_NOTICE_MESSAGES_EN, value);

/** Message for a notice code taken from the URL; null for an unknown code. */
export function approvalNoticeMessage(code: string, locale: Locale): string | null {
  if (!isApprovalNoticeCode(code)) return null;
  const t = getMessages(locale).milestones;
  return format(APPROVAL_NOTICE_MESSAGES[locale][code], {
    resend: t.resendUnsentEmails,
    emailsSent: t.emailsSent,
  });
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
//   notice=email_partial | email_failed | email_pending
//                                        with saved: not every bonus email went out (or is still held
//                                        by another request)
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
  error?: LoadErrorCode;
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

/**
 * Domain rejections (MR003, MR015) return silently. 42501 and MR014 are warned: they can also mean
 * a missing grant or a broken snapshot invariant, not only a caller who may not approve.
 */
function mapPostgrestError(error: PostgrestError, operation: string, meta: Omit<LogMeta, "mappedTo">): ApprovalError {
  // The RPC's permission check rejected the caller (also Admins): to them the milestone does not exist.
  if (error.code === "42501") {
    logError("warn", operation, error, { ...meta, mappedTo: NOT_FOUND.code });
    return NOT_FOUND;
  }
  if (Object.hasOwn(GUARD_ERROR_CODES, error.code)) {
    const code = GUARD_ERROR_CODES[error.code];
    if (error.code === "MR014") logError("warn", operation, error, { ...meta, mappedTo: code });
    return { code };
  }
  logError("error", operation, error, meta);
  return { code: "save_failed" };
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
export async function approveMilestone(
  supabase: SupabaseClient,
  milestoneId: string,
  log?: LogContext,
): Promise<WriteResult> {
  const { error, status } = await supabase.rpc("approve_milestone", { p_milestone_id: milestoneId });
  if (error) return { error: mapPostgrestError(error, "approveMilestone", { status, ids: { milestoneId }, log }) };
  return {};
}

/**
 * An approved milestone's frozen snapshot in the Draft payout shapes, so PayoutSection renders
 * both: the summary, the lines in employee-name order and the
 * approval time. The lines carry no share (privacy split), so it is rebuilt here as
 * weighted_contribution / Σ weighted_contribution, for display only. notified_count / line_count
 * count the lines whose bonus email the provider confirmed, for "Emails sent: N of M".
 * `data` is null when the milestone has no visible snapshot (a Draft milestone), so the page can
 * load it in parallel with everything else and fall back to the live Draft computation.
 */
export async function getApprovedPayout(
  supabase: SupabaseClient,
  milestoneId: string,
  log?: LogContext,
): Promise<
  ServiceResult<{
    summary: MilestonePayoutSummary;
    lines: MilestonePayoutLine[];
    approved_at: string;
    notified_count: number;
    line_count: number;
  } | null>
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

  const ids = { milestoneId };
  if (header.error) {
    return { error: mapLoadError("getApprovedPayoutHeader", header.error, { status: header.status, ids, log }) };
  }
  if (lines.error) {
    return { error: mapLoadError("getApprovedPayoutLines", lines.error, { status: lines.status, ids, log }) };
  }
  if (!header.data) return { data: null };

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

/**
 * Log level per mapped function code. A permission or input rejection is warned (it can also mean
 * id tampering or a broken deploy), a send failure is an error; not_approved is a domain rejection
 * and stays silent.
 */
const NOTIFY_LOG_LEVELS: Record<string, "warn" | "error"> = {
  invalid_request: "warn",
  forbidden: "warn",
  not_found: "warn",
  email_not_configured: "error",
  send_failed: "error",
  notify_failed: "error",
};

const toCount = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/**
 * Counts reported by notify-milestone-approved. `pending` counts unsent lines that another (or a
 * crashed) call still holds, so nothing was sent now but the emails are not all out either.
 */
export interface NotifyCounts {
  sent: number;
  failed: number;
  pending: number;
}

/**
 * The notice shown after approve or re-send, the single rule for both routes: a failed call, then
 * unconfirmed emails, then emails held by another request; otherwise no notice.
 */
export function emailNotice(result: WriteResult<NotifyCounts>): ApprovalNoticeCode | undefined {
  if (result.error) return "email_failed";
  if (!result.data) return undefined;
  if (result.data.failed > 0) return "email_partial";
  if (result.data.pending > 0) return "email_pending";
  return undefined;
}

/**
 * Emails each engaged employee of an approved milestone their own bonus through the
 * notify-milestone-approved Edge Function. Only unsent lines are sent, so it doubles as the
 * re-send. Called after approve_milestone has committed: a failure never undoes the approval.
 */
export async function notifyMilestoneApproved(
  supabase: SupabaseClient,
  milestoneId: string,
  log?: LogContext,
): Promise<WriteResult<NotifyCounts>> {
  const result = await supabase.functions.invoke("notify-milestone-approved", {
    body: { milestone_id: milestoneId },
  });
  const error: unknown = result.error;
  if (!error) {
    const body: unknown = result.data;
    const counts = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    return {
      data: { sent: toCount(counts.sent), failed: toCount(counts.failed), pending: toCount(counts.pending) },
    };
  }

  // Only an HTTP error's body code is mapped, as before; a relay error's body is logged, not trusted.
  const info = await readFunctionError(error);
  const meta = { ids: { milestoneId }, log };
  const code = info.code;
  if (error instanceof FunctionsHttpError && code !== undefined && Object.hasOwn(NOTIFY_ERROR_CODES, code)) {
    const mappedTo = NOTIFY_ERROR_CODES[code];
    if (Object.hasOwn(NOTIFY_LOG_LEVELS, code)) {
      logFunctionError(NOTIFY_LOG_LEVELS[code], "notifyMilestoneApproved", info, { ...meta, mappedTo });
    }
    return { error: { code: mappedTo } };
  }

  // A code the function sent but this table does not know means the two sides drifted: warn. No code
  // at all (crash, gateway page, relay or network failure) is an unexpected failure: error.
  const level = error instanceof FunctionsHttpError && code !== undefined ? "warn" : "error";
  logFunctionError(level, "notifyMilestoneApproved", info, meta);
  return { error: { code: "notify_failed" } };
}

interface MyBonusRow {
  id: string;
  employee_id: string;
  project_id: string;
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
  "id, employee_id, project_id, project_name, milestone_name, start_date, end_date, approved_at, job_role_name, time_share, role_weight, rating, rating_factor, multiplier, bonus";

const toBonusLine = (row: MyBonusRow): MyBonusLine => ({
  id: row.id,
  project_id: row.project_id,
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
});

/**
 * The signed-in employee's own approved bonuses, newest approval first. current_employee_id() is
 * null unless the account is linked to an activated employee record; then the list is empty and
 * `not_linked` is set. RLS already limits an employee to their own lines of approved milestones;
 * the employee_id filter is defence in depth.
 */
export async function listMyBonuses(supabase: SupabaseClient, log?: LogContext): Promise<ServiceResult<MyBonuses>> {
  // Both in parallel: RLS already limits the select to the caller's own approved lines, and the
  // employee id is applied afterwards as the defence-in-depth filter.
  const [linked, { data, error, status }] = await Promise.all([
    supabase.rpc("current_employee_id"),
    supabase
      .from("milestone_result_lines")
      .select(MY_BONUS_COLUMNS)
      .order("approved_at", { ascending: false })
      .order("milestone_name", { ascending: true })
      .overrideTypes<MyBonusRow[], { merge: false }>(),
  ]);
  if (linked.error) {
    return { error: mapLoadError("listMyBonusesEmployee", linked.error, { status: linked.status, log }) };
  }
  // The function returns a scalar uuid; the untyped client types it as any, so it is narrowed here.
  const employeeId: unknown = linked.data;
  if (typeof employeeId !== "string") return { data: { lines: [], not_linked: true } };
  if (error) return { error: mapLoadError("listMyBonuses", error, { status, ids: { employeeId }, log }) };
  const ownRows = data.filter((row) => row.employee_id === employeeId);

  return { data: { not_linked: false, lines: ownRows.map(toBonusLine) } };
}

/**
 * One employee's approved history for /employees/[id]. RLS decides the scope: the Supervisor's own
 * milestones only (no hint of other Supervisors' lines), every line for an Admin. Unlike the
 * employee policy, the Supervisor/Admin policies do not require an approved milestone (only
 * approve_milestone writes lines), so the read itself keeps approved milestones only: a stored line
 * of a non-approved milestone never reaches the page. `employeeId` must already be a validated UUID.
 */
export async function listEmployeeHistory(
  supabase: SupabaseClient,
  employeeId: string,
  log?: LogContext,
): Promise<ServiceResult<MyBonusLine[]>> {
  // Lines reference milestone_results, which references milestones: two inner embeds reach the status.
  const { data, error, status } = await supabase
    .from("milestone_result_lines")
    .select(`${MY_BONUS_COLUMNS}, milestone_results!inner(milestones!inner(status))`)
    .eq("employee_id", employeeId)
    .eq("milestone_results.milestones.status", "approved")
    .overrideTypes<MyBonusRow[], { merge: false }>();
  if (error) return { error: mapLoadError("listEmployeeHistory", error, { status, ids: { employeeId }, log }) };
  return { data: data.map(toBonusLine) };
}
