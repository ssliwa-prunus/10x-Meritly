import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { firstIssueError as firstFormIssueError, parseForm as parseFormWith } from "@/lib/forms";
import type { Milestone, Profile, Project, ProjectExposure, WorkStatus } from "@/types";

// ---------------------------------------------------------------------------
// Error codes. Validation and save failures travel to the project pages as a fixed code (plus
// an optional field name) in the redirect URL, never as free text, so a crafted link cannot put
// arbitrary text on the page. Pages resolve codes with projectsErrorMessage(); unknown codes
// fall back to a generic message.
// ---------------------------------------------------------------------------

const PROJECTS_ERROR_MESSAGES = {
  required: "{field} is required",
  name_too_long: "Name must be at most 100 characters",
  notes_too_long: "Notes must be at most 2000 characters",
  invalid_money: "{field} must be an amount above 0 with at most 2 decimal places",
  invalid_date: "{field} must be a valid date",
  period_order: "End date must be on or after the start date",
  invalid_status: "Choose a valid status",
  invalid_id: "Invalid id",
  invalid_owner: "Choose a supervisor as the owner",
  invalid_form: "Invalid form submission",
  duplicate_name: "This name is already in use",
  rule_violation: "Values violate project rules",
  owner_not_supervisor: "The owner must be a supervisor",
  milestone_outside_project: "The milestone period must lie within the project period",
  project_closed: "The project is completed or cancelled; reopen it before changing its milestones",
  project_period_excludes_milestones: "The new project period would leave some milestones outside it",
  admin_read_only: "Admins can view milestones but not change them",
  not_found: "Not found",
  save_failed: "Could not save changes. Please try again.",
  not_configured: "Supabase is not configured",
} as const;

export type ProjectsErrorCode = keyof typeof PROJECTS_ERROR_MESSAGES;

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  start_date: "Start date",
  end_date: "End date",
  status: "Status",
  total_budget: "Total budget",
  target_pool: "Target pool",
  notes: "Notes",
  supervisor_id: "Owner",
};

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export interface ProjectsError {
  code: ProjectsErrorCode;
  field?: string;
}

const isProjectsErrorCode = (value: string): value is ProjectsErrorCode =>
  Object.hasOwn(PROJECTS_ERROR_MESSAGES, value);

/** Message for an error code taken from the URL. Only fixed catalog text is ever returned. */
export function projectsErrorMessage(code: string, field: string | null): string {
  if (!isProjectsErrorCode(code)) return GENERIC_ERROR_MESSAGE;
  const label = (field !== null && Object.hasOwn(FIELD_LABELS, field) ? FIELD_LABELS[field] : undefined) ?? "Value";
  return PROJECTS_ERROR_MESSAGES[code].replace("{field}", label);
}

// ---------------------------------------------------------------------------
// Validation. The database CHECK constraints and guard triggers enforce the same rules; these
// give readable messages first. Issue messages are error codes; the field comes from the path.
// ---------------------------------------------------------------------------

export const WORK_STATUSES = ["planned", "active", "completed", "cancelled"] as const satisfies readonly WorkStatus[];

const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/** Integer grosze of a string already matching MONEY_PATTERN; exact, no floating point. */
const toGrosze = (value: string) => {
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
};

/**
 * A required money form field: plain decimal digits with at most 2 decimals, above 0. Rejects
 * 12.555, 0x1 and 1e3 instead of coercing them. The output stays the validated decimal string,
 * so the exact value reaches numeric(12,2) without a float round trip.
 */
const moneyField = () =>
  z
    .string({ error: "required" })
    .trim()
    .min(1, "required")
    .regex(MONEY_PATTERN, "invalid_money")
    .refine((value) => toGrosze(value) > 0, "invalid_money");

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A required YYYY-MM-DD calendar date (2026-02-30 is rejected). */
const dateField = () =>
  z
    .string({ error: "required" })
    .trim()
    .min(1, "required")
    .regex(ISO_DATE_PATTERN, "invalid_date")
    .refine((value) => {
      const date = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }, "invalid_date");

const nameField = () => z.string({ error: "required" }).trim().min(1, "required").max(100, "name_too_long");

const statusField = () => z.enum(WORK_STATUSES, { error: "invalid_status" });

const notesField = () =>
  z
    .string()
    .trim()
    .max(2000, "notes_too_long")
    .nullish()
    .transform((value) => (value === "" ? null : (value ?? null)));

/** ISO dates compare correctly as strings. */
const periodOrder = (input: { start_date: string; end_date: string }, ctx: z.RefinementCtx) => {
  if (input.end_date < input.start_date) {
    ctx.addIssue({ code: "custom", message: "period_order", path: ["end_date"] });
  }
};

const projectFields = {
  name: nameField(),
  start_date: dateField(),
  end_date: dateField(),
  status: statusField(),
  total_budget: moneyField(),
  notes: notesField(),
};

/** Supervisor form: no owner field, so supervisor_id defaults to the caller on insert and is untouched on update. */
export const projectInputSchema = z.object(projectFields).superRefine(periodOrder);

/** Admin form: the owner is required and may be reassigned. */
export const adminProjectInputSchema = z
  .object({ ...projectFields, supervisor_id: z.uuid("invalid_owner") })
  .superRefine(periodOrder);

/** No project_id field: the parent project comes from the route param. */
export const milestoneInputSchema = z
  .object({
    name: nameField(),
    start_date: dateField(),
    end_date: dateField(),
    status: statusField(),
    target_pool: moneyField(),
    notes: notesField(),
  })
  .superRefine(periodOrder);

export type ProjectInput = z.infer<typeof projectInputSchema> | z.infer<typeof adminProjectInputSchema>;
export type MilestoneInput = z.infer<typeof milestoneInputSchema>;

export const projectIdSchema = z.uuid("invalid_id");

/** First issue of a failed parse as an error code plus the offending field, if any. */
export function firstIssueError(error: z.ZodError): ProjectsError {
  return firstFormIssueError(error, isProjectsErrorCode);
}

/** Reads the request body as form data and validates it; a body that isn't form data is an error, not a 500. */
export function parseForm<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ data: z.output<T>; error?: undefined } | { data?: undefined; error: ProjectsError }> {
  return parseFormWith(request, schema, isProjectsErrorCode);
}

// ---------------------------------------------------------------------------
// Redirect targets for the project form endpoints. Query params read by the pages:
//   saved=<section>                      success flash for that section
//   error=<code>&field=<name>            catalog code plus the offending form field, if any
//   section=new|project|milestones       which form shows the error (absent: page-level alert)
//   milestone=<uuid>                     with section=milestones: the row whose edit form failed
//                                        (absent: the add-milestone form)
// ---------------------------------------------------------------------------

export type ProjectSection = "project" | "milestones";

export type ProjectsFlash = { saved: ProjectSection; error?: undefined } | { saved?: undefined; error: ProjectsError };

export const PROJECTS_PATH = "/projects";

function flashQuery(flash: ProjectsFlash, section?: string, milestoneId?: string): string {
  if (flash.saved) return new URLSearchParams({ saved: flash.saved }).toString();
  const params = new URLSearchParams({ error: flash.error.code });
  if (section) params.set("section", section);
  if (flash.error.field) params.set("field", flash.error.field);
  if (milestoneId) params.set("milestone", milestoneId);
  return params.toString();
}

/** The projects list. Pass section "new" for errors from the create form. */
export const projectsUrl = (flash: ProjectsFlash, section?: "new") => `${PROJECTS_PATH}?${flashQuery(flash, section)}`;

/** A project's detail page. `id` must already be a validated UUID. */
export const projectUrl = (id: string, section: ProjectSection, flash: ProjectsFlash, milestoneId?: string) =>
  `${PROJECTS_PATH}/${id}?${flashQuery(flash, section, milestoneId)}`;

// ---------------------------------------------------------------------------
// Data access. Always called with the request-scoped client (the signed-in user's JWT), never
// the service role, so RLS decides which projects and milestones are visible and writable.
// Numerics are converted with Number() for display only; TS does no money arithmetic.
// ---------------------------------------------------------------------------

export interface ServiceResult<T = undefined> {
  data?: T;
  error?: string;
}

export interface WriteResult<T = undefined> {
  data?: T;
  error?: ProjectsError;
}

const NOT_FOUND: ProjectsError = { code: "not_found" };

/** Custom SQLSTATEs raised by the S-02 guard triggers; MR005/MR006 are not reachable here and fall through. */
const GUARD_ERROR_CODES: Record<string, ProjectsErrorCode> = {
  MR001: "owner_not_supervisor",
  MR002: "milestone_outside_project",
  MR003: "project_closed",
  MR004: "project_period_excludes_milestones",
};

function mapPostgrestError(error: PostgrestError, context: string): ProjectsError {
  if (error.code === "23505") return { code: "duplicate_name" };
  if (error.code === "23514") return { code: "rule_violation" };
  // RLS rejected the row: to the caller the project does not exist.
  if (error.code === "42501") return NOT_FOUND;
  if (Object.hasOwn(GUARD_ERROR_CODES, error.code)) return { code: GUARD_ERROR_CODES[error.code] };
  // eslint-disable-next-line no-console -- intentional: surfaces unexpected DB errors in Workers observability logs
  console.error(`${context} failed`, { code: error.code, message: error.message });
  return { code: "save_failed" };
}

function mapLoadError(error: PostgrestError, context: string): string {
  // eslint-disable-next-line no-console -- intentional: surfaces unexpected DB errors in Workers observability logs
  console.error(`${context} failed`, { code: error.code, message: error.message });
  return "Could not load projects. Please try again.";
}

interface ProjectRow extends Omit<Project, "total_budget"> {
  total_budget: number | string;
}

interface MilestoneRow extends Omit<Milestone, "target_pool"> {
  target_pool: number | string;
}

interface ProjectExposureRow {
  project_id: string;
  total_budget: number | string;
  reserved_total: number | string;
  remaining: number | string;
  over_budget: boolean;
}

const PROJECT_COLUMNS = "id, name, start_date, end_date, status, total_budget, notes, supervisor_id";

const MILESTONE_COLUMNS = "id, project_id, name, start_date, end_date, status, target_pool, notes";

const EXPOSURE_COLUMNS = "project_id, total_budget, reserved_total, remaining, over_budget";

const toProject = (row: ProjectRow): Project => ({ ...row, total_budget: Number(row.total_budget) });

const toMilestone = (row: MilestoneRow): Milestone => ({ ...row, target_pool: Number(row.target_pool) });

const toExposure = (row: ProjectExposureRow): ProjectExposure => ({
  project_id: row.project_id,
  total_budget: Number(row.total_budget),
  reserved_total: Number(row.reserved_total),
  remaining: Number(row.remaining),
  over_budget: row.over_budget,
});

/** Visible projects (own for a Supervisor, all for an Admin), ordered by name. */
export async function listProjects(supabase: SupabaseClient): Promise<ServiceResult<Project[]>> {
  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_COLUMNS)
    .order("name", { ascending: true })
    .overrideTypes<ProjectRow[], { merge: false }>();

  if (error) return { error: mapLoadError(error, "listProjects") };
  return { data: data.map(toProject) };
}

/** One project, or data null when it does not exist or is not visible to the caller. */
export async function getProject(supabase: SupabaseClient, id: string): Promise<ServiceResult<Project | null>> {
  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_COLUMNS)
    .eq("id", id)
    .maybeSingle<ProjectRow>();

  if (error) return { error: mapLoadError(error, "getProject") };
  return { data: data ? toProject(data) : null };
}

/** A project's milestones in period order. */
export async function listMilestones(supabase: SupabaseClient, projectId: string): Promise<ServiceResult<Milestone[]>> {
  const { data, error } = await supabase
    .from("milestones")
    .select(MILESTONE_COLUMNS)
    .eq("project_id", projectId)
    .order("start_date", { ascending: true })
    .order("name", { ascending: true })
    .overrideTypes<MilestoneRow[], { merge: false }>();

  if (error) return { error: mapLoadError(error, "listMilestones") };
  return { data: data.map(toMilestone) };
}

/** Budget exposure for every visible project (FR-017). */
export async function listProjectExposure(supabase: SupabaseClient): Promise<ServiceResult<ProjectExposure[]>> {
  const { data, error } = await supabase
    .from("project_budget_exposure")
    .select(EXPOSURE_COLUMNS)
    .overrideTypes<ProjectExposureRow[], { merge: false }>();

  if (error) return { error: mapLoadError(error, "listProjectExposure") };
  return { data: data.map(toExposure) };
}

/** Budget exposure for one project, or data null when it is not visible. */
export async function getProjectExposure(
  supabase: SupabaseClient,
  id: string,
): Promise<ServiceResult<ProjectExposure | null>> {
  const { data, error } = await supabase
    .from("project_budget_exposure")
    .select(EXPOSURE_COLUMNS)
    .eq("project_id", id)
    .maybeSingle<ProjectExposureRow>();

  if (error) return { error: mapLoadError(error, "getProjectExposure") };
  return { data: data ? toExposure(data) : null };
}

/** Supervisors, for the Admin owner select. */
export async function listSupervisors(supabase: SupabaseClient): Promise<ServiceResult<Profile[]>> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, display_name, role")
    .eq("role", "supervisor")
    .order("email", { ascending: true })
    .overrideTypes<Profile[], { merge: false }>();

  if (error) return { error: mapLoadError(error, "listSupervisors") };
  return { data };
}

export async function createProject(
  supabase: SupabaseClient,
  input: ProjectInput,
): Promise<WriteResult<{ id: string }>> {
  const { data, error } = await supabase.from("projects").insert(input).select("id").single<{ id: string }>();
  if (error) return { error: mapPostgrestError(error, "createProject") };
  return { data };
}

export async function updateProject(supabase: SupabaseClient, id: string, input: ProjectInput): Promise<WriteResult> {
  const { data, error } = await supabase.from("projects").update(input).eq("id", id).select("id");
  if (error) return { error: mapPostgrestError(error, "updateProject") };
  if (data.length === 0) return { error: NOT_FOUND };
  return {};
}

export async function createMilestone(
  supabase: SupabaseClient,
  projectId: string,
  input: MilestoneInput,
): Promise<WriteResult> {
  const { data, error } = await supabase
    .from("milestones")
    .insert({ ...input, project_id: projectId })
    .select("id");
  if (error) return { error: mapPostgrestError(error, "createMilestone") };
  if (data.length === 0) return { error: NOT_FOUND };
  return {};
}

export async function updateMilestone(
  supabase: SupabaseClient,
  projectId: string,
  id: string,
  input: MilestoneInput,
): Promise<WriteResult> {
  const { data, error } = await supabase
    .from("milestones")
    .update(input)
    .eq("id", id)
    .eq("project_id", projectId)
    .select("id");
  if (error) return { error: mapPostgrestError(error, "updateMilestone") };
  if (data.length === 0) return { error: NOT_FOUND };
  return {};
}
