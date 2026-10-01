import { FunctionsHttpError, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { firstIssueError as firstFormIssueError, parseForm as parseFormWith } from "@/lib/forms";
import type { Employee, EmployeeListItem, EmployeeTimeShare, InviteStatus } from "@/types";

// ---------------------------------------------------------------------------
// Error codes. Validation, save and invite failures travel to /employees as a fixed code (plus
// an optional field name) in the redirect URL, never as free text, so a crafted link cannot put
// arbitrary text on the page. The page resolves codes with employeesErrorMessage(); unknown codes
// fall back to a generic message. A duplicate or rejected email gets the generic
// registration_failed text: it neither reveals another Supervisor's employee nor echoes the email.
// ---------------------------------------------------------------------------

const EMPLOYEES_ERROR_MESSAGES = {
  invalid_form: "Invalid form submission",
  invalid_id: "Invalid id",
  required: "{field} is required",
  too_long: "{field} is too long",
  invalid_email: "Enter a valid email address",
  not_found: "Not found",
  save_failed: "Could not save changes. Please try again.",
  not_configured: "Supabase is not configured",
  owner_not_supervisor: "The owner must be a supervisor",
  employee_has_open_engagements:
    "This employee is assigned to open milestones of another supervisor; remove those assignments before changing the owner",
  email_locked: "The email cannot change after the first invite",
  job_role_archived: "This job role is archived; choose an active job role",
  registration_failed: "Could not register this employee. Check the email or contact an Admin.",
  already_active: "This employee has already accepted the invite",
  invite_failed: "Could not send the invite. Please try again.",
} as const;

export type EmployeesErrorCode = keyof typeof EMPLOYEES_ERROR_MESSAGES;

const FIELD_LABELS: Record<string, string> = {
  full_name: "Name",
  email: "Email",
  job_role_id: "Job role",
  supervisor_id: "Owner",
};

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export interface EmployeesError {
  code: EmployeesErrorCode;
  field?: string;
}

const isEmployeesErrorCode = (value: string): value is EmployeesErrorCode =>
  Object.hasOwn(EMPLOYEES_ERROR_MESSAGES, value);

/** Message for an error code taken from the URL. Only fixed catalog text is ever returned. */
export function employeesErrorMessage(code: string, field: string | null): string {
  if (!isEmployeesErrorCode(code)) return GENERIC_ERROR_MESSAGE;
  const label = (field !== null && Object.hasOwn(FIELD_LABELS, field) ? FIELD_LABELS[field] : undefined) ?? "Value";
  return EMPLOYEES_ERROR_MESSAGES[code].replace("{field}", label);
}

// ---------------------------------------------------------------------------
// Validation. The database CHECK constraints and guard triggers enforce the same rules; these
// give readable messages first. Issue messages are error codes; the field comes from the path.
// ---------------------------------------------------------------------------

/** Same shape as the employees_email_format check. */
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const fullNameField = () => z.string({ error: "required" }).trim().min(1, "required").max(100, "too_long");

/** Trimmed and lowercased, as the employees_email_normalized check requires. */
const emailField = () =>
  z
    .string({ error: "required" })
    .trim()
    .toLowerCase()
    .min(1, "required")
    .max(254, "too_long")
    .regex(EMAIL_PATTERN, "invalid_email");

const employeeFields = {
  full_name: fullNameField(),
  email: emailField(),
  job_role_id: z.uuid("required"),
};

/** Supervisor form: no owner field, so supervisor_id defaults to the caller on insert and is untouched on update. */
export const employeeInputSchema = z.object(employeeFields);

/** Admin form: the owner is required and may be reassigned. */
export const adminEmployeeInputSchema = z.object({ ...employeeFields, supervisor_id: z.uuid("required") });

/**
 * Update forms: the email input is disabled once the employee is invited, so a locked row posts no
 * email and the column is left untouched. A submitted email change after the invite is refused by
 * the database (MR009).
 */
export const employeeUpdateSchema = employeeInputSchema.partial({ email: true });
export const adminEmployeeUpdateSchema = adminEmployeeInputSchema.partial({ email: true });

export type EmployeeInput = z.infer<typeof employeeInputSchema> | z.infer<typeof adminEmployeeInputSchema>;
export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema> | z.infer<typeof adminEmployeeUpdateSchema>;

export const employeeIdSchema = z.uuid("invalid_id");

/** First issue of a failed parse as an error code plus the offending field, if any. */
export function firstIssueError(error: z.ZodError): EmployeesError {
  return firstFormIssueError(error, isEmployeesErrorCode);
}

/** Reads the request body as form data and validates it; a body that isn't form data is an error, not a 500. */
export function parseForm<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ data: z.output<T>; error?: undefined } | { data?: undefined; error: EmployeesError }> {
  return parseFormWith(request, schema, isEmployeesErrorCode);
}

// ---------------------------------------------------------------------------
// Redirect targets for the employee form endpoints. Query params read by the page:
//   saved=created|updated|invited        success flash
//   error=<code>&field=<name>            catalog code plus the offending form field, if any
//   employee=<uuid>                      the row whose edit or invite failed (absent: the register form)
// ---------------------------------------------------------------------------

export type EmployeesSaved = "created" | "updated" | "invited";

export type EmployeesFlash =
  { saved: EmployeesSaved; error?: undefined } | { saved?: undefined; error: EmployeesError };

export const EMPLOYEES_PATH = "/employees";

/** The employees page. `employeeId` must already be a validated UUID. */
export function employeesUrl(flash: EmployeesFlash, employeeId?: string): string {
  if (flash.saved) return `${EMPLOYEES_PATH}?${new URLSearchParams({ saved: flash.saved }).toString()}`;
  const params = new URLSearchParams({ error: flash.error.code });
  if (flash.error.field) params.set("field", flash.error.field);
  if (employeeId) params.set("employee", employeeId);
  return `${EMPLOYEES_PATH}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Data access. Always called with the request-scoped client (the signed-in user's JWT), never
// the service role, so RLS decides which employees are visible and writable. The invite goes
// through the invite-employee Edge Function with the same JWT; only the function holds the
// secret key.
// ---------------------------------------------------------------------------

export interface ServiceResult<T = undefined> {
  data?: T;
  error?: string;
}

export interface WriteResult<T = undefined> {
  data?: T;
  error?: EmployeesError;
}

const NOT_FOUND: EmployeesError = { code: "not_found" };

/** Custom SQLSTATEs raised by the employees guard trigger. */
const GUARD_ERROR_CODES: Record<string, EmployeesErrorCode> = {
  MR001: "owner_not_supervisor",
  MR008: "employee_has_open_engagements",
  MR009: "email_locked",
  MR010: "job_role_archived",
};

function mapPostgrestError(error: PostgrestError, context: string): EmployeesError {
  // The only user-writable unique column is email; the message stays generic on purpose.
  if (error.code === "23505") return { code: "registration_failed", field: "email" };
  // RLS or the guard's permission check rejected the row: to the caller the employee does not exist.
  if (error.code === "42501") return NOT_FOUND;
  if (Object.hasOwn(GUARD_ERROR_CODES, error.code)) return { code: GUARD_ERROR_CODES[error.code] };
  // eslint-disable-next-line no-console -- intentional: surfaces unexpected DB errors in Workers observability logs
  console.error(`${context} failed`, { code: error.code, message: error.message });
  return { code: "save_failed" };
}

function mapLoadError(error: PostgrestError, context: string): string {
  // eslint-disable-next-line no-console -- intentional: surfaces unexpected DB errors in Workers observability logs
  console.error(`${context} failed`, { code: error.code, message: error.message });
  return "Could not load employees. Please try again.";
}

interface EmployeeRow extends Employee {
  job_roles: { name: string } | null;
}

interface TimeShareRow {
  employee_id: string;
  open_total: number | string;
  over_allocated: boolean;
}

const EMPLOYEE_COLUMNS =
  "id, supervisor_id, full_name, email, job_role_id, profile_id, invited_at, activated_at, job_roles(name)";

const toTimeShare = (row: TimeShareRow): EmployeeTimeShare => ({
  employee_id: row.employee_id,
  open_total: Number(row.open_total),
  over_allocated: row.over_allocated,
});

/**
 * Visible employees ordered by name, with their job role name and open time-share total (0 when
 * the view has no row). A Supervisor passes their own id as ownerId, so employees they only see
 * read-only (engaged on the Supervisor's milestones after a move) are left out. The total's scope
 * follows RLS on the view: the Supervisor's own milestones, or every milestone for an Admin.
 */
export async function listEmployees(
  supabase: SupabaseClient,
  { ownerId }: { ownerId?: string } = {},
): Promise<ServiceResult<EmployeeListItem[]>> {
  let employeesQuery = supabase.from("employees").select(EMPLOYEE_COLUMNS);
  if (ownerId) employeesQuery = employeesQuery.eq("supervisor_id", ownerId);

  const [employees, totals] = await Promise.all([
    employeesQuery.order("full_name", { ascending: true }).overrideTypes<EmployeeRow[], { merge: false }>(),
    supabase
      .from("employee_time_share_totals")
      .select("employee_id, open_total, over_allocated")
      .overrideTypes<TimeShareRow[], { merge: false }>(),
  ]);

  if (employees.error) return { error: mapLoadError(employees.error, "listEmployees") };
  if (totals.error) return { error: mapLoadError(totals.error, "listEmployeeTimeShareTotals") };

  const totalsById = new Map(totals.data.map((row) => [row.employee_id, toTimeShare(row)]));

  return {
    data: employees.data.map(({ job_roles, ...employee }) => {
      const total = totalsById.get(employee.id);
      return {
        ...employee,
        job_role_name: job_roles?.name ?? "—",
        open_total: total?.open_total ?? 0,
        over_allocated: total?.over_allocated ?? false,
      };
    }),
  };
}

/** Invite state derived from the system-written timestamps. */
export function inviteStatus(employee: Pick<Employee, "invited_at" | "activated_at">): InviteStatus {
  if (employee.activated_at !== null) return "active";
  if (employee.invited_at !== null) return "invited";
  return "not_invited";
}

export async function createEmployee(
  supabase: SupabaseClient,
  input: EmployeeInput,
): Promise<WriteResult<{ id: string }>> {
  const { data, error } = await supabase.from("employees").insert(input).select("id").single<{ id: string }>();
  if (error) return { error: mapPostgrestError(error, "createEmployee") };
  return { data };
}

export async function updateEmployee(
  supabase: SupabaseClient,
  id: string,
  input: EmployeeUpdateInput,
): Promise<WriteResult> {
  // A locked (invited) row posts no email; leave the column out instead of sending undefined.
  const { email, ...rest } = input;
  const changes = email === undefined ? rest : { ...rest, email };
  const { data, error } = await supabase.from("employees").update(changes).eq("id", id).select("id");
  if (error) return { error: mapPostgrestError(error, "updateEmployee") };
  if (data.length === 0) return { error: NOT_FOUND };
  return {};
}

/** Response codes of the invite-employee Edge Function mapped to the catalog. */
const INVITE_ERROR_CODES: Record<string, EmployeesErrorCode> = {
  invalid_request: "invalid_id",
  forbidden: "not_found",
  not_found: "not_found",
  already_active: "already_active",
  email_unavailable: "registration_failed",
  invite_failed: "invite_failed",
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

/** Sends or re-sends the invite email through the invite-employee Edge Function. */
export async function inviteEmployee(supabase: SupabaseClient, id: string): Promise<WriteResult> {
  const result = await supabase.functions.invoke("invite-employee", { body: { employee_id: id } });
  const error: unknown = result.error;
  if (!error) return {};

  if (error instanceof FunctionsHttpError) {
    const code = await functionErrorCode(error.context);
    if (code !== null && Object.hasOwn(INVITE_ERROR_CODES, code)) return { error: { code: INVITE_ERROR_CODES[code] } };
  }

  // eslint-disable-next-line no-console -- intentional: surfaces function failures in Workers observability logs
  console.error("inviteEmployee failed", { name: error instanceof Error ? error.name : typeof error });
  return { error: { code: "invite_failed" } };
}
