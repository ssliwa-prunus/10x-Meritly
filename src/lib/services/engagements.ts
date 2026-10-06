import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  decimalField,
  firstIssueError as firstFormIssueError,
  parseForm as parseFormWith,
  toHundredths,
} from "@/lib/forms";
import { PROJECTS_PATH } from "@/lib/services/projects";
import type { AssignableEmployee, Engagement, EngagementListItem } from "@/types";

// ---------------------------------------------------------------------------
// Error codes. Validation and save failures travel to the milestone page as a fixed code (plus
// an optional field name) in the redirect URL, never as free text, so a crafted link cannot put
// arbitrary text on the page. The page resolves codes with engagementsErrorMessage(); unknown
// codes fall back to a generic message.
// ---------------------------------------------------------------------------

const ENGAGEMENTS_ERROR_MESSAGES = {
  invalid_form: "Invalid form submission",
  invalid_id: "Invalid id",
  required: "{field} is required",
  not_a_number: "{field} must be a number",
  too_many_decimals: "{field} must have at most 2 decimal places",
  not_found: "Not found",
  save_failed: "Could not save changes. Please try again.",
  not_configured: "Supabase is not configured",
  time_share_range: "Time share must be above 0 and at most 1.00",
  rating_range: "Rating must be a whole number from 1 to 5",
  already_assigned: "This employee is already assigned to this milestone",
  milestone_closed:
    "The milestone is approved, or it or its project is completed or cancelled. Approved milestones are frozen; reopen a completed or cancelled one before changing its assignments",
  milestone_approved: "This milestone is approved and frozen",
  employee_not_available: "This employee cannot be assigned to this milestone. Choose one of your employees.",
  admin_read_only: "Admins can view assignments but not change them",
} as const;

export type EngagementsErrorCode = keyof typeof ENGAGEMENTS_ERROR_MESSAGES;

const FIELD_LABELS: Record<string, string> = {
  employee_id: "Employee",
  time_share: "Time share",
  rating: "Rating",
};

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export interface EngagementsError {
  code: EngagementsErrorCode;
  field?: string;
}

const isEngagementsErrorCode = (value: string): value is EngagementsErrorCode =>
  Object.hasOwn(ENGAGEMENTS_ERROR_MESSAGES, value);

/** Message for an error code taken from the URL. Only fixed catalog text is ever returned. */
export function engagementsErrorMessage(code: string, field: string | null): string {
  if (!isEngagementsErrorCode(code)) return GENERIC_ERROR_MESSAGE;
  const label = (field !== null && Object.hasOwn(FIELD_LABELS, field) ? FIELD_LABELS[field] : undefined) ?? "Value";
  return ENGAGEMENTS_ERROR_MESSAGES[code].replace("{field}", label);
}

// ---------------------------------------------------------------------------
// Validation. The database CHECK constraints and guard trigger enforce the same rules; these
// give readable messages first. Issue messages are error codes; the field comes from the path.
// ---------------------------------------------------------------------------

/** Above 0 and at most 1.00 with 2 decimals, compared in integer hundredths (numeric(3,2) in the DB). */
const timeShareField = () =>
  decimalField().refine((value) => toHundredths(value) > 0 && toHundredths(value) <= 100, "time_share_range");

/** A whole number from 1 to 5; rejects 2.5, 1e0 and similar instead of coercing them. */
const ratingField = () =>
  z
    .string({ error: "required" })
    .trim()
    .min(1, "required")
    .regex(/^[1-5]$/, "rating_range")
    .transform(Number);

/** No milestone_id field: the milestone comes from the route param. */
export const engagementInputSchema = z.object({
  employee_id: z.uuid("required"),
  time_share: timeShareField(),
  rating: ratingField(),
});

/** employee_id is immutable (not in the update grant); only the time share and rating change. */
export const engagementUpdateSchema = z.object({
  time_share: timeShareField(),
  rating: ratingField(),
});

export type EngagementInput = z.infer<typeof engagementInputSchema>;
export type EngagementUpdateInput = z.infer<typeof engagementUpdateSchema>;

export const engagementIdSchema = z.uuid("invalid_id");

/** First issue of a failed parse as an error code plus the offending field, if any. */
export function firstIssueError(error: z.ZodError): EngagementsError {
  return firstFormIssueError(error, isEngagementsErrorCode);
}

/** Reads the request body as form data and validates it; a body that isn't form data is an error, not a 500. */
export function parseForm<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ data: z.output<T>; error?: undefined } | { data?: undefined; error: EngagementsError }> {
  return parseFormWith(request, schema, isEngagementsErrorCode);
}

// ---------------------------------------------------------------------------
// Redirect targets for the engagement form endpoints. Query params read by the milestone page:
//   saved=created|updated|deleted        success flash
//   error=<code>&field=<name>            catalog code plus the offending form field, if any
//   engagement=<uuid>                    the row whose edit or delete failed (absent: the add form)
// ---------------------------------------------------------------------------

export type EngagementsSaved = "created" | "updated" | "deleted";

export type EngagementsFlash =
  { saved: EngagementsSaved; error?: undefined } | { saved?: undefined; error: EngagementsError };

/** A milestone's page. `projectId`, `milestoneId` and `engagementId` must already be validated UUIDs. */
export function milestoneUrl(
  projectId: string,
  milestoneId: string,
  flash: EngagementsFlash,
  engagementId?: string,
): string {
  const path = `${PROJECTS_PATH}/${projectId}/milestones/${milestoneId}`;
  if (flash.saved) return `${path}?${new URLSearchParams({ saved: flash.saved }).toString()}`;
  const params = new URLSearchParams({ error: flash.error.code });
  if (flash.error.field) params.set("field", flash.error.field);
  if (engagementId) params.set("engagement", engagementId);
  return `${path}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Data access. Always called with the request-scoped client (the signed-in user's JWT), never
// the service role, so RLS decides which engagements and employees are visible and writable.
// Numerics may arrive as strings and are converted with Number() for display only.
// ---------------------------------------------------------------------------

export interface ServiceResult<T = undefined> {
  data?: T;
  error?: string;
}

export interface WriteResult<T = undefined> {
  data?: T;
  error?: EngagementsError;
}

const NOT_FOUND: EngagementsError = { code: "not_found" };

/** Custom SQLSTATEs raised by the engagement and milestone guard triggers. */
const GUARD_ERROR_CODES: Record<string, EngagementsErrorCode> = {
  MR007: "milestone_closed",
  MR011: "employee_not_available",
  MR015: "milestone_approved",
};

function mapPostgrestError(error: PostgrestError, context: string): EngagementsError {
  // The only unique key is (milestone_id, employee_id).
  if (error.code === "23505") return { code: "already_assigned", field: "employee_id" };
  // RLS or the guard's permission check rejected the row: to the caller the milestone does not exist.
  if (error.code === "42501") return NOT_FOUND;
  if (Object.hasOwn(GUARD_ERROR_CODES, error.code)) return { code: GUARD_ERROR_CODES[error.code] };
  // eslint-disable-next-line no-console -- intentional: surfaces unexpected DB errors in Workers observability logs
  console.error(`${context} failed`, { code: error.code, message: error.message });
  return { code: "save_failed" };
}

function mapLoadError(error: PostgrestError, context: string): string {
  // eslint-disable-next-line no-console -- intentional: surfaces unexpected DB errors in Workers observability logs
  console.error(`${context} failed`, { code: error.code, message: error.message });
  return "Could not load assignments. Please try again.";
}

interface EngagementRow extends Omit<Engagement, "time_share" | "rating"> {
  time_share: number | string;
  rating: number | string;
  employees: { full_name: string; job_roles: { name: string } | null } | null;
}

interface TimeShareRow {
  employee_id: string;
  open_total: number | string;
  over_allocated: boolean;
}

const ENGAGEMENT_COLUMNS = "id, milestone_id, employee_id, time_share, rating, employees(full_name, job_roles(name))";

/**
 * A milestone's engagements ordered by employee name, with the employee's name and job role (null
 * when the employee row is not visible) and open time-share total (0 when the view has no row).
 * The total's scope follows RLS on the view: the Supervisor's own milestones, or every milestone
 * for an Admin.
 */
export async function listEngagements(
  supabase: SupabaseClient,
  milestoneId: string,
): Promise<ServiceResult<EngagementListItem[]>> {
  const engagements = await supabase
    .from("milestone_engagements")
    .select(ENGAGEMENT_COLUMNS)
    .eq("milestone_id", milestoneId)
    .overrideTypes<EngagementRow[], { merge: false }>();

  if (engagements.error) return { error: mapLoadError(engagements.error, "listEngagements") };
  if (engagements.data.length === 0) return { data: [] };

  const employeeIds = engagements.data.map((row) => row.employee_id);
  const totals = await supabase
    .from("employee_time_share_totals")
    .select("employee_id, open_total, over_allocated")
    .in("employee_id", employeeIds)
    .overrideTypes<TimeShareRow[], { merge: false }>();

  if (totals.error) return { error: mapLoadError(totals.error, "listEngagementTimeShareTotals") };

  const totalsById = new Map(totals.data.map((row) => [row.employee_id, row]));

  const items: EngagementListItem[] = engagements.data.map((row) => {
    const total = totalsById.get(row.employee_id);
    return {
      id: row.id,
      milestone_id: row.milestone_id,
      employee_id: row.employee_id,
      time_share: Number(row.time_share),
      rating: Number(row.rating),
      employee_name: row.employees?.full_name ?? null,
      job_role_name: row.employees?.job_roles?.name ?? null,
      open_total: total ? Number(total.open_total) : 0,
      over_allocated: total?.over_allocated ?? false,
    };
  });

  // Hidden employees (null name) sort last.
  items.sort((a, b) => {
    if (a.employee_name === null || b.employee_name === null) {
      return (a.employee_name === null ? 1 : 0) - (b.employee_name === null ? 1 : 0);
    }
    return a.employee_name.localeCompare(b.employee_name);
  });

  return { data: items };
}

/**
 * Employees the Supervisor `ownerId` owns and who are not yet on this milestone, ordered by name.
 * supervisor_id is compared explicitly: a Supervisor also sees (read-only) employees engaged on
 * their milestones after a move, and visibility never implies being assignable.
 */
export async function listAssignableEmployees(
  supabase: SupabaseClient,
  ownerId: string,
  milestoneId: string,
): Promise<ServiceResult<AssignableEmployee[]>> {
  const [employees, assigned] = await Promise.all([
    supabase
      .from("employees")
      .select("id, full_name")
      .eq("supervisor_id", ownerId)
      .order("full_name", { ascending: true })
      .overrideTypes<AssignableEmployee[], { merge: false }>(),
    supabase
      .from("milestone_engagements")
      .select("employee_id")
      .eq("milestone_id", milestoneId)
      .overrideTypes<{ employee_id: string }[], { merge: false }>(),
  ]);

  if (employees.error) return { error: mapLoadError(employees.error, "listAssignableEmployees") };
  if (assigned.error) return { error: mapLoadError(assigned.error, "listAssignedEmployeeIds") };

  const assignedIds = new Set(assigned.data.map((row) => row.employee_id));
  return { data: employees.data.filter((employee) => !assignedIds.has(employee.id)) };
}

/**
 * Whether the milestone belongs to the project, as the caller sees them through RLS. Routes use it
 * so a crafted project/milestone pair cannot write under one project and redirect to another.
 */
export async function isMilestoneInProject(
  supabase: SupabaseClient,
  projectId: string,
  milestoneId: string,
): Promise<ServiceResult<boolean>> {
  const { data, error } = await supabase
    .from("milestones")
    .select("id")
    .eq("id", milestoneId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) return { error: mapLoadError(error, "isMilestoneInProject") };
  return { data: data !== null };
}

export async function createEngagement(
  supabase: SupabaseClient,
  milestoneId: string,
  input: EngagementInput,
): Promise<WriteResult> {
  const { data, error } = await supabase
    .from("milestone_engagements")
    .insert({ ...input, milestone_id: milestoneId })
    .select("id");
  if (error) return { error: mapPostgrestError(error, "createEngagement") };
  if (data.length === 0) return { error: NOT_FOUND };
  return {};
}

export async function updateEngagement(
  supabase: SupabaseClient,
  milestoneId: string,
  id: string,
  input: EngagementUpdateInput,
): Promise<WriteResult> {
  const { data, error } = await supabase
    .from("milestone_engagements")
    .update(input)
    .eq("id", id)
    .eq("milestone_id", milestoneId)
    .select("id");
  if (error) return { error: mapPostgrestError(error, "updateEngagement") };
  if (data.length === 0) return { error: NOT_FOUND };
  return {};
}

export async function deleteEngagement(
  supabase: SupabaseClient,
  milestoneId: string,
  id: string,
): Promise<WriteResult> {
  const { data, error } = await supabase
    .from("milestone_engagements")
    .delete()
    .eq("id", id)
    .eq("milestone_id", milestoneId)
    .select("id");
  if (error) return { error: mapPostgrestError(error, "deleteEngagement") };
  if (data.length === 0) return { error: NOT_FOUND };
  return {};
}
