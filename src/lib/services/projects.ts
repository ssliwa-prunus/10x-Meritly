import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { logError, mapLoadError, type LogContext, type LogMeta } from "@/lib/error-log";
import { firstIssueError as firstFormIssueError, parseForm as parseFormWith } from "@/lib/forms";
import type { Locale } from "@/lib/i18n";
import type { LoadErrorCode, Milestone, Profile, Project, ProjectExposure, WorkStatus } from "@/types";

// ---------------------------------------------------------------------------
// Error codes. Validation and save failures travel to the project pages as a fixed code (plus
// an optional field name) in the redirect URL, never as free text, so a crafted link cannot put
// arbitrary text on the page. Pages resolve codes with projectsErrorMessage() in the request's
// locale; unknown codes fall back to a generic message. The EN catalog defines the codes and the
// PL catalog is typed against them, so a missing translation fails the type check.
// ---------------------------------------------------------------------------

const PROJECTS_ERROR_MESSAGES_EN = {
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
  project_has_foreign_engagements:
    "Employees of the current owner are assigned to open milestones; remove those assignments first",
  admin_read_only: "Admins can view milestones but not change them",
  milestone_approved: "This milestone is approved and frozen",
  not_found: "Not found",
  save_failed: "Could not save changes. Please try again.",
  not_configured: "Supabase is not configured",
} as const;

export type ProjectsErrorCode = keyof typeof PROJECTS_ERROR_MESSAGES_EN;

const PROJECTS_ERROR_MESSAGES: Record<Locale, Record<ProjectsErrorCode, string>> = {
  en: PROJECTS_ERROR_MESSAGES_EN,
  pl: {
    required: "Pole „{field}” jest wymagane",
    name_too_long: "Nazwa może mieć najwyżej 100 znaków",
    notes_too_long: "Notatki mogą mieć najwyżej 2000 znaków",
    invalid_money: "Pole „{field}” musi zawierać kwotę większą od 0 z najwyżej 2 miejscami po przecinku",
    invalid_date: "Pole „{field}” musi zawierać prawidłową datę",
    period_order: "Data zakończenia nie może być wcześniejsza niż data rozpoczęcia",
    invalid_status: "Wybierz prawidłowy status",
    invalid_id: "Nieprawidłowy identyfikator",
    invalid_owner: "Wybierz przełożonego jako właściciela",
    invalid_form: "Nieprawidłowe dane formularza",
    duplicate_name: "Ta nazwa jest już zajęta",
    rule_violation: "Wartości naruszają reguły projektu",
    owner_not_supervisor: "Właścicielem musi być przełożony",
    milestone_outside_project: "Okres kamienia milowego musi mieścić się w okresie projektu",
    project_closed: "Projekt jest zakończony lub anulowany; wznów go przed zmianą jego kamieni milowych",
    project_period_excludes_milestones: "Nowy okres projektu pozostawiłby niektóre kamienie milowe poza nim",
    project_has_foreign_engagements:
      "Pracownicy obecnego właściciela są przypisani do otwartych kamieni milowych; najpierw usuń te przypisania",
    admin_read_only: "Administratorzy mogą przeglądać kamienie milowe, ale nie mogą ich zmieniać",
    milestone_approved: "Ten kamień milowy jest zatwierdzony i zamrożony",
    not_found: "Nie znaleziono",
    save_failed: "Nie udało się zapisać zmian. Spróbuj ponownie.",
    not_configured: "Supabase nie jest skonfigurowany",
  },
};

const FIELD_LABELS_EN = {
  name: "Name",
  start_date: "Start date",
  end_date: "End date",
  status: "Status",
  total_budget: "Total budget",
  target_pool: "Target pool",
  notes: "Notes",
  supervisor_id: "Owner",
};

const FIELD_LABELS: Record<Locale, Record<keyof typeof FIELD_LABELS_EN, string>> = {
  en: FIELD_LABELS_EN,
  pl: {
    name: "Nazwa",
    start_date: "Data rozpoczęcia",
    end_date: "Data zakończenia",
    status: "Status",
    total_budget: "Budżet całkowity",
    target_pool: "Pula docelowa",
    notes: "Notatki",
    supervisor_id: "Właściciel",
  },
};

/** Label for a field outside FIELD_LABELS (or no field at all). */
const FALLBACK_FIELD_LABEL: Record<Locale, string> = { en: "Value", pl: "Wartość" };

const GENERIC_ERROR_MESSAGE: Record<Locale, string> = {
  en: "Something went wrong. Please try again.",
  pl: "Coś poszło nie tak. Spróbuj ponownie.",
};

export interface ProjectsError {
  code: ProjectsErrorCode;
  field?: string;
}

const isProjectsErrorCode = (value: string): value is ProjectsErrorCode =>
  Object.hasOwn(PROJECTS_ERROR_MESSAGES_EN, value);

/** Message for an error code taken from the URL. Only fixed catalog text is ever returned. */
export function projectsErrorMessage(code: string, field: string | null, locale: Locale): string {
  if (!isProjectsErrorCode(code)) return GENERIC_ERROR_MESSAGE[locale];
  const labels: Record<string, string> = FIELD_LABELS[locale];
  const label = field !== null && Object.hasOwn(labels, field) ? labels[field] : FALLBACK_FIELD_LABEL[locale];
  return PROJECTS_ERROR_MESSAGES[locale][code].replace("{field}", label);
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
  error?: LoadErrorCode;
}

export interface WriteResult<T = undefined> {
  data?: T;
  error?: ProjectsError;
}

const NOT_FOUND: ProjectsError = { code: "not_found" };

/**
 * Custom SQLSTATEs raised by the S-02 and S-05 guard triggers; MR005/MR006 are not reachable here
 * and fall through. MR014 fires when a write tries to set status 'approved' outside
 * approve_milestone (the form's zod enum already rejects it); MR015 on any write to an approved milestone.
 */
const GUARD_ERROR_CODES: Record<string, ProjectsErrorCode> = {
  MR001: "owner_not_supervisor",
  MR002: "milestone_outside_project",
  MR003: "project_closed",
  MR004: "project_period_excludes_milestones",
  MR012: "project_has_foreign_engagements",
  MR014: "invalid_status",
  MR015: "milestone_approved",
};

/**
 * Domain rejections (23505, the guard codes) return silently. 23514, 42501 and MR014 are warned:
 * zod or RLS should have stopped them, so they can also mean a deploy regression or id tampering.
 */
function mapPostgrestError(error: PostgrestError, operation: string, meta: Omit<LogMeta, "mappedTo">): ProjectsError {
  if (error.code === "23505") return { code: "duplicate_name" };
  if (error.code === "23514") {
    logError("warn", operation, error, { ...meta, mappedTo: "rule_violation" });
    return { code: "rule_violation" };
  }
  // RLS rejected the row: to the caller the project does not exist.
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

/** An update or insert that matched no row: id tampering or an RLS regression, so it is warned. */
function notFound(operation: string, meta: Omit<LogMeta, "status" | "mappedTo">): ProjectsError {
  logError("warn", operation, { code: "no_rows" }, { ...meta, mappedTo: NOT_FOUND.code });
  return NOT_FOUND;
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

export const MILESTONE_COLUMNS = "id, project_id, name, start_date, end_date, status, target_pool, notes";

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
export async function listProjects(supabase: SupabaseClient, log?: LogContext): Promise<ServiceResult<Project[]>> {
  const { data, error, status } = await supabase
    .from("projects")
    .select(PROJECT_COLUMNS)
    .order("name", { ascending: true })
    .overrideTypes<ProjectRow[], { merge: false }>();

  if (error) return { error: mapLoadError("listProjects", error, { status, log }) };
  return { data: data.map(toProject) };
}

/** One project, or data null when it does not exist or is not visible to the caller. */
export async function getProject(
  supabase: SupabaseClient,
  id: string,
  log?: LogContext,
): Promise<ServiceResult<Project | null>> {
  const { data, error, status } = await supabase
    .from("projects")
    .select(PROJECT_COLUMNS)
    .eq("id", id)
    .maybeSingle<ProjectRow>();

  if (error) return { error: mapLoadError("getProject", error, { status, ids: { projectId: id }, log }) };
  return { data: data ? toProject(data) : null };
}

/** A project's milestones in period order. */
export async function listMilestones(
  supabase: SupabaseClient,
  projectId: string,
  log?: LogContext,
): Promise<ServiceResult<Milestone[]>> {
  const { data, error, status } = await supabase
    .from("milestones")
    .select(MILESTONE_COLUMNS)
    .eq("project_id", projectId)
    .order("start_date", { ascending: true })
    .order("name", { ascending: true })
    .overrideTypes<MilestoneRow[], { merge: false }>();

  if (error) return { error: mapLoadError("listMilestones", error, { status, ids: { projectId }, log }) };
  return { data: data.map(toMilestone) };
}

/** Budget exposure for every visible project (FR-017). */
export async function listProjectExposure(
  supabase: SupabaseClient,
  log?: LogContext,
): Promise<ServiceResult<ProjectExposure[]>> {
  const { data, error, status } = await supabase
    .from("project_budget_exposure")
    .select(EXPOSURE_COLUMNS)
    .overrideTypes<ProjectExposureRow[], { merge: false }>();

  if (error) return { error: mapLoadError("listProjectExposure", error, { status, log }) };
  return { data: data.map(toExposure) };
}

/** Budget exposure for one project, or data null when it is not visible. */
export async function getProjectExposure(
  supabase: SupabaseClient,
  id: string,
  log?: LogContext,
): Promise<ServiceResult<ProjectExposure | null>> {
  const { data, error, status } = await supabase
    .from("project_budget_exposure")
    .select(EXPOSURE_COLUMNS)
    .eq("project_id", id)
    .maybeSingle<ProjectExposureRow>();

  if (error) return { error: mapLoadError("getProjectExposure", error, { status, ids: { projectId: id }, log }) };
  return { data: data ? toExposure(data) : null };
}

/** Supervisors, for the Admin owner select. */
export async function listSupervisors(supabase: SupabaseClient, log?: LogContext): Promise<ServiceResult<Profile[]>> {
  const { data, error, status } = await supabase
    .from("profiles")
    .select("id, email, display_name, role, locale")
    .eq("role", "supervisor")
    .order("email", { ascending: true })
    .overrideTypes<Profile[], { merge: false }>();

  if (error) return { error: mapLoadError("listSupervisors", error, { status, log }) };
  return { data };
}

export async function createProject(
  supabase: SupabaseClient,
  input: ProjectInput,
  log?: LogContext,
): Promise<WriteResult<{ id: string }>> {
  const { data, error, status } = await supabase.from("projects").insert(input).select("id").single<{ id: string }>();
  if (error) return { error: mapPostgrestError(error, "createProject", { status, log }) };
  return { data };
}

export async function updateProject(
  supabase: SupabaseClient,
  id: string,
  input: ProjectInput,
  log?: LogContext,
): Promise<WriteResult> {
  const ids = { projectId: id };
  const { data, error, status } = await supabase.from("projects").update(input).eq("id", id).select("id");
  if (error) return { error: mapPostgrestError(error, "updateProject", { status, ids, log }) };
  if (data.length === 0) return { error: notFound("updateProject", { ids, log }) };
  return {};
}

export async function createMilestone(
  supabase: SupabaseClient,
  projectId: string,
  input: MilestoneInput,
  log?: LogContext,
): Promise<WriteResult> {
  const ids = { projectId };
  const { data, error, status } = await supabase
    .from("milestones")
    .insert({ ...input, project_id: projectId })
    .select("id");
  if (error) return { error: mapPostgrestError(error, "createMilestone", { status, ids, log }) };
  if (data.length === 0) return { error: notFound("createMilestone", { ids, log }) };
  return {};
}

export async function updateMilestone(
  supabase: SupabaseClient,
  projectId: string,
  id: string,
  input: MilestoneInput,
  log?: LogContext,
): Promise<WriteResult> {
  const ids = { projectId, milestoneId: id };
  const { data, error, status } = await supabase
    .from("milestones")
    .update(input)
    .eq("id", id)
    .eq("project_id", projectId)
    .select("id");
  if (error) return { error: mapPostgrestError(error, "updateMilestone", { status, ids, log }) };
  if (data.length === 0) return { error: notFound("updateMilestone", { ids, log }) };
  return {};
}
