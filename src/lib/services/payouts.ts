import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { logError, mapLoadError, type LogContext, type LogMeta } from "@/lib/error-log";
import { firstIssueError as firstFormIssueError, parseForm as parseFormWith } from "@/lib/forms";
import type { Locale } from "@/lib/i18n";
import { PROJECTS_PATH } from "@/lib/services/projects";
import type { LoadErrorCode, MilestonePayoutLine, MilestonePayoutSummary } from "@/types";

// ---------------------------------------------------------------------------
// Error codes. Validation and save failures of the KPI form travel to the milestone page as a
// fixed code (plus an optional field name) in the redirect URL, never as free text, so a crafted
// link cannot put arbitrary text on the page. The page resolves codes with kpiErrorMessage() in
// the request's locale; unknown codes fall back to a generic message. The EN catalog defines the
// codes and the PL catalog is typed against them, so a missing translation fails the type check.
// ---------------------------------------------------------------------------

const KPI_ERROR_MESSAGES_EN = {
  invalid_form: "Invalid form submission",
  invalid_id: "Invalid id",
  required: "{field} is required",
  kpi_range: "{field} must be a whole number from 0 to 100",
  not_found: "Not found",
  save_failed: "Could not save changes. Please try again.",
  not_configured: "Supabase is not configured",
  admin_read_only: "Admins can view KPI scores but not change them",
  milestone_cancelled: "The milestone is cancelled; its KPI scores cannot be changed",
  project_closed: "The project is completed or cancelled; reopen it before changing its milestones",
  milestone_approved: "This milestone is approved and frozen",
} as const;

export type KpiErrorCode = keyof typeof KPI_ERROR_MESSAGES_EN;

const KPI_ERROR_MESSAGES: Record<Locale, Record<KpiErrorCode, string>> = {
  en: KPI_ERROR_MESSAGES_EN,
  pl: {
    invalid_form: "Nieprawidłowe dane formularza",
    invalid_id: "Nieprawidłowy identyfikator",
    required: "Pole „{field}” jest wymagane",
    kpi_range: "Pole „{field}” musi być liczbą całkowitą od 0 do 100",
    not_found: "Nie znaleziono",
    save_failed: "Nie udało się zapisać zmian. Spróbuj ponownie.",
    not_configured: "Supabase nie jest skonfigurowany",
    admin_read_only: "Administratorzy mogą przeglądać wyniki KPI, ale nie mogą ich zmieniać",
    milestone_cancelled: "Kamień milowy jest anulowany; jego wyników KPI nie można zmienić",
    project_closed: "Projekt jest zakończony lub anulowany; wznów go przed zmianą jego kamieni milowych",
    milestone_approved: "Ten kamień milowy jest zatwierdzony i zamrożony",
  },
};

// The KPI names are product terms (prd.md) and read the same in both languages.
const KPI_FIELD_LABELS = {
  kpi_schedule: "Termin",
  kpi_budget: "Budżet",
  kpi_quality: "Jakość",
  kpi_risk: "Ryzyko",
};

const FIELD_LABELS: Record<Locale, Record<keyof typeof KPI_FIELD_LABELS, string>> = {
  en: KPI_FIELD_LABELS,
  pl: KPI_FIELD_LABELS,
};

/** Label for a field outside FIELD_LABELS (or no field at all). */
const FALLBACK_FIELD_LABEL: Record<Locale, string> = { en: "Value", pl: "Wartość" };

const GENERIC_ERROR_MESSAGE: Record<Locale, string> = {
  en: "Something went wrong. Please try again.",
  pl: "Coś poszło nie tak. Spróbuj ponownie.",
};

export interface KpiError {
  code: KpiErrorCode;
  field?: string;
}

const isKpiErrorCode = (value: string): value is KpiErrorCode => Object.hasOwn(KPI_ERROR_MESSAGES_EN, value);

/** Message for an error code taken from the URL. Only fixed catalog text is ever returned. */
export function kpiErrorMessage(code: string, field: string | null, locale: Locale): string {
  if (!isKpiErrorCode(code)) return GENERIC_ERROR_MESSAGE[locale];
  const labels: Record<string, string> = FIELD_LABELS[locale];
  const label = field !== null && Object.hasOwn(labels, field) ? labels[field] : FALLBACK_FIELD_LABEL[locale];
  return KPI_ERROR_MESSAGES[locale][code].replace("{field}", label);
}

// ---------------------------------------------------------------------------
// Validation. The database CHECK constraints (range, all four or none) and the MR013 guard
// enforce the same rules; these give readable messages first. Issue messages are error codes;
// the field comes from the path.
// ---------------------------------------------------------------------------

/** A whole number from 0 to 100; rejects 2.5, 1e1, -1, 101 and 007 instead of coercing them. */
const kpiScoreField = () =>
  z
    .string({ error: "required" })
    .trim()
    .min(1, "required")
    .regex(/^(100|[1-9]?[0-9])$/, "kpi_range")
    .transform(Number);

/** All four scores are required: partial scoring is not allowed (milestones_kpi_all_or_none). */
export const kpiScoresInputSchema = z.object({
  kpi_schedule: kpiScoreField(),
  kpi_budget: kpiScoreField(),
  kpi_quality: kpiScoreField(),
  kpi_risk: kpiScoreField(),
});

export type KpiScoresInput = z.infer<typeof kpiScoresInputSchema>;

/** First issue of a failed parse as an error code plus the offending field, if any. */
export function firstIssueError(error: z.ZodError): KpiError {
  return firstFormIssueError(error, isKpiErrorCode);
}

/** Reads the request body as form data and validates it; a body that isn't form data is an error, not a 500. */
export function parseForm<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ data: z.output<T>; error?: undefined } | { data?: undefined; error: KpiError }> {
  return parseFormWith(request, schema, isKpiErrorCode);
}

// ---------------------------------------------------------------------------
// Redirect target for the KPI form endpoint. Query params read by the milestone page:
//   saved=kpi                            success flash
//   error=<code>&field=<name>            catalog code plus the offending form field, if any
//   section=kpi                          the KPI form shows the error
// ---------------------------------------------------------------------------

export type KpiFlash = { saved: "kpi"; error?: undefined } | { saved?: undefined; error: KpiError };

/** A milestone's page with a KPI flash. `projectId` and `milestoneId` must already be validated UUIDs. */
export function kpiUrl(projectId: string, milestoneId: string, flash: KpiFlash): string {
  const path = `${PROJECTS_PATH}/${projectId}/milestones/${milestoneId}`;
  if (flash.saved) return `${path}?${new URLSearchParams({ saved: flash.saved }).toString()}`;
  const params = new URLSearchParams({ error: flash.error.code });
  if (flash.error.field) params.set("field", flash.error.field);
  params.set("section", "kpi");
  return `${path}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Data access. Always called with the request-scoped client (the signed-in user's JWT), never
// the service role, so RLS decides which milestones are visible and writable. The figures are
// computed and floored in SQL; numerics may arrive as strings and are converted with Number()
// for display only. TS does no money arithmetic.
// ---------------------------------------------------------------------------

export interface ServiceResult<T = undefined> {
  data?: T;
  error?: LoadErrorCode;
}

export interface WriteResult<T = undefined> {
  data?: T;
  error?: KpiError;
}

const NOT_FOUND: KpiError = { code: "not_found" };

/** Custom SQLSTATEs raised by the milestone guard triggers on a KPI score update. */
const GUARD_ERROR_CODES: Record<string, KpiErrorCode> = {
  MR003: "project_closed",
  MR013: "milestone_cancelled",
  MR015: "milestone_approved",
};

/**
 * Domain rejections (the guard codes) return silently. 42501 is warned: besides a caller without
 * access it can mean id tampering or a missing grant or policy.
 */
function mapPostgrestError(error: PostgrestError, operation: string, meta: Omit<LogMeta, "mappedTo">): KpiError {
  // RLS or the guard's permission check rejected the row: to the caller the milestone does not exist.
  if (error.code === "42501") {
    logError("warn", operation, error, { ...meta, mappedTo: NOT_FOUND.code });
    return NOT_FOUND;
  }
  if (Object.hasOwn(GUARD_ERROR_CODES, error.code)) return { code: GUARD_ERROR_CODES[error.code] };
  logError("error", operation, error, meta);
  return { code: "save_failed" };
}

type Numeric = number | string;

export interface PayoutSummaryRow {
  milestone_id: string;
  target_pool: Numeric;
  kpi_schedule: number | null;
  kpi_budget: number | null;
  kpi_quality: number | null;
  kpi_risk: number | null;
  scored: boolean;
  multiplier: Numeric | null;
  budget_share: Numeric | null;
  payout_pool: Numeric | null;
  payout_total: Numeric | null;
  residual: Numeric | null;
  within_pool: boolean | null;
  engagement_count: Numeric;
}

interface PayoutLineRow {
  engagement_id: string;
  employee_id: string;
  employee_name: string;
  job_role_name: string;
  time_share: Numeric;
  role_weight: Numeric;
  rating: Numeric;
  rating_factor: Numeric;
  weighted_contribution: Numeric;
  share: Numeric;
  bonus: Numeric | null;
}

const toNullableNumber = (value: Numeric | null) => (value === null ? null : Number(value));

export const toSummary = (row: PayoutSummaryRow): MilestonePayoutSummary => ({
  milestone_id: row.milestone_id,
  target_pool: Number(row.target_pool),
  kpi_schedule: toNullableNumber(row.kpi_schedule),
  kpi_budget: toNullableNumber(row.kpi_budget),
  kpi_quality: toNullableNumber(row.kpi_quality),
  kpi_risk: toNullableNumber(row.kpi_risk),
  scored: row.scored,
  multiplier: toNullableNumber(row.multiplier),
  budget_share: toNullableNumber(row.budget_share),
  payout_pool: toNullableNumber(row.payout_pool),
  payout_total: toNullableNumber(row.payout_total),
  residual: toNullableNumber(row.residual),
  within_pool: row.within_pool,
  engagement_count: Number(row.engagement_count),
});

const toLine = (row: PayoutLineRow): MilestonePayoutLine => ({
  engagement_id: row.engagement_id,
  employee_id: row.employee_id,
  employee_name: row.employee_name,
  job_role_name: row.job_role_name,
  time_share: Number(row.time_share),
  role_weight: Number(row.role_weight),
  rating: Number(row.rating),
  rating_factor: Number(row.rating_factor),
  weighted_contribution: Number(row.weighted_contribution),
  share: Number(row.share),
  bonus: toNullableNumber(row.bonus),
});

/**
 * Saves a milestone's four KPI scores. Filtered by id and project_id, so a crafted
 * project/milestone pair matches nothing; a milestone the caller cannot write (RLS) also
 * matches nothing, and either way the caller gets not_found.
 */
export async function updateKpiScores(
  supabase: SupabaseClient,
  projectId: string,
  milestoneId: string,
  input: KpiScoresInput,
  log?: LogContext,
): Promise<WriteResult> {
  const ids = { projectId, milestoneId };
  const { data, error, status } = await supabase
    .from("milestones")
    .update(input)
    .eq("id", milestoneId)
    .eq("project_id", projectId)
    .select("id");
  if (error) return { error: mapPostgrestError(error, "updateKpiScores", { status, ids, log }) };
  if (data.length === 0) {
    // Matched no row: a crafted id pair or an RLS regression, so it is warned.
    logError("warn", "updateKpiScores", { code: "no_rows" }, { ids, log, mappedTo: NOT_FOUND.code });
    return { error: NOT_FOUND };
  }
  return {};
}

/**
 * A milestone's computed Draft payout: the summary (null when the milestone is not visible) and
 * the per-employee lines in employee-name order.
 */
export async function getMilestonePayout(
  supabase: SupabaseClient,
  milestoneId: string,
  log?: LogContext,
): Promise<ServiceResult<{ summary: MilestonePayoutSummary | null; lines: MilestonePayoutLine[] }>> {
  const [summary, lines] = await Promise.all([
    supabase.rpc("milestone_payout_summary", { p_milestone_id: milestoneId }),
    supabase.rpc("milestone_payout_lines", { p_milestone_id: milestoneId }),
  ]);

  const ids = { milestoneId };
  if (summary.error) {
    return { error: mapLoadError("getMilestonePayoutSummary", summary.error, { status: summary.status, ids, log }) };
  }
  if (lines.error) {
    return { error: mapLoadError("getMilestonePayoutLines", lines.error, { status: lines.status, ids, log }) };
  }

  // Both functions return SETOF rows. On the untyped client overrideTypes<Row[]> rejects RPC
  // results as "single object", so the row shapes are asserted here instead.
  const summaryRows = (summary.data ?? []) as PayoutSummaryRow[];
  const lineRows = (lines.data ?? []) as PayoutLineRow[];

  const summaryRow = summaryRows.at(0);
  return {
    data: {
      summary: summaryRow ? toSummary(summaryRow) : null,
      lines: lineRows.map(toLine),
    },
  };
}
