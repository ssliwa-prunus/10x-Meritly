import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { BonusSettings, JobRole } from "@/types";

// ---------------------------------------------------------------------------
// Validation. Every decimal rule is compared in integer hundredths, because values like
// 0.3 + 0.3 + 0.25 + 0.15 are not exactly 1 in floating point. The database CHECK
// constraints enforce the same rules; these give readable messages first.
// ---------------------------------------------------------------------------

const toHundredths = (value: number) => Math.round(value * 100);

const hasAtMostTwoDecimals = (value: number) => Math.abs(value * 100 - toHundredths(value)) < 1e-6;

/** A required decimal form field: non-empty string, coerced to a finite number, at most 2 decimals. */
const decimalField = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .pipe(z.coerce.number({ error: `${label} must be a number` }))
    .refine(hasAtMostTwoDecimals, `${label} must have at most 2 decimal places`);

/** Decimal in (0, 3], the range shared by role weights, multipliers and rating factors. */
const positiveUpToThree = (label: string) =>
  decimalField(label).refine(
    (value) => toHundredths(value) > 0 && toHundredths(value) <= 300,
    `${label} must be greater than 0 and at most 3`,
  );

/** KPI weight in [0, 1]. */
const kpiWeight = (label: string) =>
  decimalField(label).refine(
    (value) => toHundredths(value) >= 0 && toHundredths(value) <= 100,
    `${label} must be between 0 and 1`,
  );

export const jobRoleInputSchema = z.object({
  name: z
    .string({ error: "Name is required" })
    .trim()
    .min(1, "Name is required")
    .max(100, "Name must be at most 100 characters"),
  weight: positiveUpToThree("Weight"),
  description: z
    .string()
    .trim()
    .nullish()
    .transform((value) => (value === "" ? null : (value ?? null))),
});

export const kpiSettingsInputSchema = z
  .object({
    kpi_weight_schedule: kpiWeight("Termin weight"),
    kpi_weight_budget: kpiWeight("Budżet weight"),
    kpi_weight_quality: kpiWeight("Jakość weight"),
    kpi_weight_risk: kpiWeight("Ryzyko weight"),
    multiplier_min: positiveUpToThree("Minimum multiplier"),
    multiplier_max: positiveUpToThree("Maximum multiplier"),
  })
  .superRefine((input, ctx) => {
    const sum =
      toHundredths(input.kpi_weight_schedule) +
      toHundredths(input.kpi_weight_budget) +
      toHundredths(input.kpi_weight_quality) +
      toHundredths(input.kpi_weight_risk);
    if (sum !== 100) {
      ctx.addIssue({
        code: "custom",
        message: `KPI weights must sum to 1.00 (currently ${(sum / 100).toFixed(2)})`,
        path: ["kpi_weight_schedule"],
      });
    }
    if (toHundredths(input.multiplier_min) >= toHundredths(input.multiplier_max)) {
      ctx.addIssue({
        code: "custom",
        message: "Minimum multiplier must be lower than maximum multiplier",
        path: ["multiplier_min"],
      });
    }
  });

export const ratingFactorsInputSchema = z
  .object({
    rating_factor_1: positiveUpToThree("Factor for rating 1"),
    rating_factor_2: positiveUpToThree("Factor for rating 2"),
    rating_factor_3: positiveUpToThree("Factor for rating 3"),
    rating_factor_4: positiveUpToThree("Factor for rating 4"),
    rating_factor_5: positiveUpToThree("Factor for rating 5"),
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
        ctx.addIssue({
          code: "custom",
          message: "Rating factors must be non-decreasing from rating 1 to rating 5",
          path: [`rating_factor_${i + 1}`],
        });
        return;
      }
    }
  });

export type JobRoleInput = z.infer<typeof jobRoleInputSchema>;
export type KpiSettingsInput = z.infer<typeof kpiSettingsInputSchema>;
export type RatingFactorsInput = z.infer<typeof ratingFactorsInputSchema>;

export const jobRoleIdSchema = z.uuid("Invalid role id");

/** First validation message of a failed parse, for the redirect `error` param. */
export function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input";
}

// ---------------------------------------------------------------------------
// Redirect targets for the admin settings form endpoints.
// ---------------------------------------------------------------------------

export type SettingsSection = "roles" | "kpi" | "factors";

export const SETTINGS_PATH = "/admin/settings";

export const settingsSavedUrl = (section: SettingsSection) => `${SETTINGS_PATH}?saved=${section}`;

export const settingsErrorUrl = (section: SettingsSection, message: string) =>
  `${SETTINGS_PATH}?error=${encodeURIComponent(message)}&section=${section}`;

// ---------------------------------------------------------------------------
// Data access. Always called with the request-scoped client (the signed-in user's JWT),
// never the service role, so RLS applies on top of the middleware admin guard.
// ---------------------------------------------------------------------------

export interface ServiceResult<T = undefined> {
  data?: T;
  error?: string;
}

const NOT_FOUND = "Not found";

function mapPostgrestError(error: PostgrestError, context: string): string {
  if (error.code === "23505") return "A role with this name already exists";
  if (error.code === "23514") return "Values violate configuration rules";
  // eslint-disable-next-line no-console -- intentional: surfaces unexpected DB errors in Workers observability logs
  console.error(`${context} failed`, { code: error.code, message: error.message });
  return "Could not save changes. Please try again.";
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

export async function createJobRole(supabase: SupabaseClient, input: JobRoleInput): Promise<ServiceResult> {
  const { error } = await supabase.from("job_roles").insert(input);
  if (error) return { error: mapPostgrestError(error, "createJobRole") };
  return {};
}

export async function updateJobRole(supabase: SupabaseClient, id: string, input: JobRoleInput): Promise<ServiceResult> {
  const { data, error } = await supabase.from("job_roles").update(input).eq("id", id).select("id");
  if (error) return { error: mapPostgrestError(error, "updateJobRole") };
  if (data.length === 0) return { error: NOT_FOUND };
  return {};
}

export async function setJobRoleArchived(
  supabase: SupabaseClient,
  id: string,
  archived: boolean,
): Promise<ServiceResult> {
  const { data, error } = await supabase
    .from("job_roles")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id");
  if (error) return { error: mapPostgrestError(error, "setJobRoleArchived") };
  if (data.length === 0) return { error: NOT_FOUND };
  return {};
}

export async function updateKpiSettings(supabase: SupabaseClient, input: KpiSettingsInput): Promise<ServiceResult> {
  const { data, error } = await supabase.from("bonus_settings").update(input).eq("id", true).select("id");
  if (error) return { error: mapPostgrestError(error, "updateKpiSettings") };
  if (data.length === 0) return { error: NOT_FOUND };
  return {};
}

export async function updateRatingFactors(supabase: SupabaseClient, input: RatingFactorsInput): Promise<ServiceResult> {
  const { data, error } = await supabase.from("bonus_settings").update(input).eq("id", true).select("id");
  if (error) return { error: mapPostgrestError(error, "updateRatingFactors") };
  if (data.length === 0) return { error: NOT_FOUND };
  return {};
}
