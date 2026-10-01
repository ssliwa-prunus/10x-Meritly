import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  decimalField,
  firstIssueError as firstFormIssueError,
  parseForm as parseFormWith,
  toHundredths,
} from "@/lib/forms";
import type { BonusSettings, JobRole } from "@/types";

// ---------------------------------------------------------------------------
// Error codes. Validation and save failures travel to the settings page as a fixed code
// (plus an optional field name) in the redirect URL, never as free text, so a crafted link
// cannot put arbitrary text on the admin page. The page resolves codes with
// settingsErrorMessage(); unknown codes fall back to a generic message.
// ---------------------------------------------------------------------------

const SETTINGS_ERROR_MESSAGES = {
  required: "{field} is required",
  not_a_number: "{field} must be a number",
  too_many_decimals: "{field} must have at most 2 decimal places",
  positive_up_to_three: "{field} must be greater than 0 and at most 3",
  kpi_weight_range: "{field} must be between 0 and 1",
  name_too_long: "Name must be at most 100 characters",
  kpi_sum: "KPI weights must sum to 1.00",
  multiplier_order: "Minimum multiplier must be lower than maximum multiplier",
  factors_order: "Rating factors must be non-decreasing from rating 1 to rating 5",
  invalid_id: "Invalid role id",
  invalid_action: "Invalid archive action",
  invalid_form: "Invalid form submission",
  duplicate_name: "A role with this name already exists",
  rule_violation: "Values violate configuration rules",
  save_failed: "Could not save changes. Please try again.",
  not_found: "Not found",
  not_configured: "Supabase is not configured",
} as const;

export type SettingsErrorCode = keyof typeof SETTINGS_ERROR_MESSAGES;

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  weight: "Weight",
  description: "Description",
  kpi_weight_schedule: "Termin weight",
  kpi_weight_budget: "Budżet weight",
  kpi_weight_quality: "Jakość weight",
  kpi_weight_risk: "Ryzyko weight",
  multiplier_min: "Minimum multiplier",
  multiplier_max: "Maximum multiplier",
  rating_factor_1: "Factor for rating 1",
  rating_factor_2: "Factor for rating 2",
  rating_factor_3: "Factor for rating 3",
  rating_factor_4: "Factor for rating 4",
  rating_factor_5: "Factor for rating 5",
};

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export interface SettingsError {
  code: SettingsErrorCode;
  field?: string;
}

const isSettingsErrorCode = (value: string): value is SettingsErrorCode =>
  Object.hasOwn(SETTINGS_ERROR_MESSAGES, value);

/** Message for an error code taken from the URL. Only fixed catalog text is ever returned. */
export function settingsErrorMessage(code: string, field: string | null): string {
  if (!isSettingsErrorCode(code)) return GENERIC_ERROR_MESSAGE;
  const label = (field !== null && Object.hasOwn(FIELD_LABELS, field) ? FIELD_LABELS[field] : undefined) ?? "Value";
  return SETTINGS_ERROR_MESSAGES[code].replace("{field}", label);
}

// ---------------------------------------------------------------------------
// Validation. Every decimal rule is compared in integer hundredths, because values like
// 0.3 + 0.3 + 0.25 + 0.15 are not exactly 1 in floating point. The database CHECK
// constraints enforce the same rules; these give readable messages first. Issue messages
// are error codes; the field comes from the issue path.
// ---------------------------------------------------------------------------

/** Decimal in (0, 3], the range shared by role weights, multipliers and rating factors. */
const positiveUpToThree = () =>
  decimalField().refine((value) => toHundredths(value) > 0 && toHundredths(value) <= 300, "positive_up_to_three");

/** KPI weight in [0, 1]. */
const kpiWeight = () =>
  decimalField().refine((value) => toHundredths(value) >= 0 && toHundredths(value) <= 100, "kpi_weight_range");

export const jobRoleInputSchema = z.object({
  name: z.string({ error: "required" }).trim().min(1, "required").max(100, "name_too_long"),
  weight: positiveUpToThree(),
  description: z
    .string()
    .trim()
    .nullish()
    .transform((value) => (value === "" ? null : (value ?? null))),
});

export const kpiSettingsInputSchema = z
  .object({
    kpi_weight_schedule: kpiWeight(),
    kpi_weight_budget: kpiWeight(),
    kpi_weight_quality: kpiWeight(),
    kpi_weight_risk: kpiWeight(),
    multiplier_min: positiveUpToThree(),
    multiplier_max: positiveUpToThree(),
  })
  .superRefine((input, ctx) => {
    const sum =
      toHundredths(input.kpi_weight_schedule) +
      toHundredths(input.kpi_weight_budget) +
      toHundredths(input.kpi_weight_quality) +
      toHundredths(input.kpi_weight_risk);
    if (sum !== 100) {
      ctx.addIssue({ code: "custom", message: "kpi_sum", path: [] });
    }
    if (toHundredths(input.multiplier_min) >= toHundredths(input.multiplier_max)) {
      ctx.addIssue({ code: "custom", message: "multiplier_order", path: [] });
    }
  });

export const ratingFactorsInputSchema = z
  .object({
    rating_factor_1: positiveUpToThree(),
    rating_factor_2: positiveUpToThree(),
    rating_factor_3: positiveUpToThree(),
    rating_factor_4: positiveUpToThree(),
    rating_factor_5: positiveUpToThree(),
  })
  .superRefine((input, ctx) => {
    const factors = [
      input.rating_factor_1,
      input.rating_factor_2,
      input.rating_factor_3,
      input.rating_factor_4,
      input.rating_factor_5,
    ].map(toHundredths);
    for (let i = 1; i < factors.length; i++) {
      if (factors[i] < factors[i - 1]) {
        ctx.addIssue({ code: "custom", message: "factors_order", path: [] });
        return;
      }
    }
  });

export const jobRoleArchiveInputSchema = z.object({
  archived: z.enum(["true", "false"], { error: "invalid_action" }).transform((value) => value === "true"),
});

export type JobRoleInput = z.infer<typeof jobRoleInputSchema>;
export type KpiSettingsInput = z.infer<typeof kpiSettingsInputSchema>;
export type RatingFactorsInput = z.infer<typeof ratingFactorsInputSchema>;

export const jobRoleIdSchema = z.uuid("invalid_id");

/** First issue of a failed parse as an error code plus the offending field, if any. */
export function firstIssueError(error: z.ZodError): SettingsError {
  return firstFormIssueError(error, isSettingsErrorCode);
}

/** Reads the request body as form data and validates it; a body that isn't form data is an error, not a 500. */
export function parseForm<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ data: z.output<T>; error?: undefined } | { data?: undefined; error: SettingsError }> {
  return parseFormWith(request, schema, isSettingsErrorCode);
}

// ---------------------------------------------------------------------------
// Redirect targets for the admin settings form endpoints.
// ---------------------------------------------------------------------------

export type SettingsSection = "roles" | "kpi" | "factors";

export const SETTINGS_PATH = "/admin/settings";

export const settingsSavedUrl = (section: SettingsSection) => `${SETTINGS_PATH}?saved=${section}`;

export const settingsErrorUrl = (section: SettingsSection, error: SettingsError) => {
  const params = new URLSearchParams({ error: error.code, section });
  if (error.field) params.set("field", error.field);
  return `${SETTINGS_PATH}?${params.toString()}`;
};

// ---------------------------------------------------------------------------
// Data access. Always called with the request-scoped client (the signed-in user's JWT),
// never the service role, so RLS applies on top of the middleware admin guard.
// ---------------------------------------------------------------------------

export interface ServiceResult<T = undefined> {
  data?: T;
  error?: string;
}

export interface WriteResult {
  error?: SettingsError;
}

const NOT_FOUND: SettingsError = { code: "not_found" };

function mapPostgrestError(error: PostgrestError, context: string): SettingsError {
  if (error.code === "23505") return { code: "duplicate_name" };
  if (error.code === "23514") return { code: "rule_violation" };
  // eslint-disable-next-line no-console -- intentional: surfaces unexpected DB errors in Workers observability logs
  console.error(`${context} failed`, { code: error.code, message: error.message });
  return { code: "save_failed" };
}

function mapLoadError(error: PostgrestError, context: string): string {
  // eslint-disable-next-line no-console -- intentional: surfaces unexpected DB errors in Workers observability logs
  console.error(`${context} failed`, { code: error.code, message: error.message });
  return "Could not load configuration. Please try again.";
}

interface JobRoleRow {
  id: string;
  name: string;
  weight: number | string;
  description: string | null;
  archived_at: string | null;
}

type BonusSettingsRow = Record<keyof BonusSettings, number | string>;

const JOB_ROLE_COLUMNS = "id, name, weight, description, archived_at";

const BONUS_SETTINGS_COLUMNS =
  "kpi_weight_schedule, kpi_weight_budget, kpi_weight_quality, kpi_weight_risk, multiplier_min, multiplier_max, rating_factor_1, rating_factor_2, rating_factor_3, rating_factor_4, rating_factor_5";

/** Active roles first, then archived ones; each group ordered by name. */
export async function listJobRoles(supabase: SupabaseClient): Promise<ServiceResult<JobRole[]>> {
  const { data, error } = await supabase
    .from("job_roles")
    .select(JOB_ROLE_COLUMNS)
    .order("name", { ascending: true })
    .overrideTypes<JobRoleRow[], { merge: false }>();

  if (error) return { error: mapLoadError(error, "listJobRoles") };

  const roles = data.map((row) => ({ ...row, weight: Number(row.weight) }));
  const active = roles.filter((role) => role.archived_at === null);
  const archived = roles.filter((role) => role.archived_at !== null);
  return { data: [...active, ...archived] };
}

export async function getBonusSettings(supabase: SupabaseClient): Promise<ServiceResult<BonusSettings>> {
  const { data, error } = await supabase
    .from("bonus_settings")
    .select(BONUS_SETTINGS_COLUMNS)
    .maybeSingle<BonusSettingsRow>();

  if (error) return { error: mapLoadError(error, "getBonusSettings") };
  if (!data) return { error: "Bonus settings are missing" };

  return {
    data: {
      kpi_weight_schedule: Number(data.kpi_weight_schedule),
      kpi_weight_budget: Number(data.kpi_weight_budget),
      kpi_weight_quality: Number(data.kpi_weight_quality),
      kpi_weight_risk: Number(data.kpi_weight_risk),
      multiplier_min: Number(data.multiplier_min),
      multiplier_max: Number(data.multiplier_max),
      rating_factor_1: Number(data.rating_factor_1),
      rating_factor_2: Number(data.rating_factor_2),
      rating_factor_3: Number(data.rating_factor_3),
      rating_factor_4: Number(data.rating_factor_4),
      rating_factor_5: Number(data.rating_factor_5),
    },
  };
}

export async function createJobRole(supabase: SupabaseClient, input: JobRoleInput): Promise<WriteResult> {
  const { error } = await supabase.from("job_roles").insert(input);
  if (error) return { error: mapPostgrestError(error, "createJobRole") };
  return {};
}

export async function updateJobRole(supabase: SupabaseClient, id: string, input: JobRoleInput): Promise<WriteResult> {
  const { data, error } = await supabase.from("job_roles").update(input).eq("id", id).select("id");
  if (error) return { error: mapPostgrestError(error, "updateJobRole") };
  if (data.length === 0) return { error: NOT_FOUND };
  return {};
}

export async function setJobRoleArchived(
  supabase: SupabaseClient,
  id: string,
  archived: boolean,
): Promise<WriteResult> {
  const { data, error } = await supabase
    .from("job_roles")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id");
  if (error) return { error: mapPostgrestError(error, "setJobRoleArchived") };
  if (data.length === 0) return { error: NOT_FOUND };
  return {};
}

export async function updateKpiSettings(supabase: SupabaseClient, input: KpiSettingsInput): Promise<WriteResult> {
  const { data, error } = await supabase.from("bonus_settings").update(input).eq("id", true).select("id");
  if (error) return { error: mapPostgrestError(error, "updateKpiSettings") };
  if (data.length === 0) return { error: NOT_FOUND };
  return {};
}

export async function updateRatingFactors(supabase: SupabaseClient, input: RatingFactorsInput): Promise<WriteResult> {
  const { data, error } = await supabase.from("bonus_settings").update(input).eq("id", true).select("id");
  if (error) return { error: mapPostgrestError(error, "updateRatingFactors") };
  if (data.length === 0) return { error: NOT_FOUND };
  return {};
}
