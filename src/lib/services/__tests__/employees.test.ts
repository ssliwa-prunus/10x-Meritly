import { FunctionsFetchError, FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  createEmployee,
  employeesErrorMessage,
  getEmployeeDetail,
  inviteEmployee,
  listEmployees,
  listOpenAssignments,
  updateEmployee,
  type EmployeeInput,
  type EmployeeUpdateInput,
} from "@/lib/services/employees";

// Oracle: the code-in-URL contract (employees.ts header) — a known code renders its catalog text in
// the request's locale with the field label of that locale; anything else renders the localized
// generic message. Load failures return the code "load_failed", never text. Log levels and payloads:
// context/changes/log-mapped-errors/plan.md (Levels, Phase 2) — 42501 and 0-row writes warn with
// mappedTo, 23505 and the guard codes are silent; function forbidden/not_found/invalid_request warn,
// invite_failed is an error, already_active/email_unavailable are silent, the fall-through is an error.

const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000002";
const OWNER_ID = "00000000-0000-4000-8000-000000000009";

/** A client whose every query (any chain of builder calls, then awaited) resolves to `result`. */
function queryClient(result: { data: unknown; error: unknown; status?: number }): SupabaseClient {
  const builder: object = new Proxy(
    {},
    {
      get: (_target, prop) =>
        prop === "then"
          ? (resolve: (value: typeof result) => void) => {
              resolve(result);
            }
          : () => builder,
    },
  );
  return { from: () => builder, rpc: () => builder } as unknown as SupabaseClient;
}

const failing = () => queryClient({ data: null, error: { code: "XX000", message: "boom" }, status: 500 });

const rejecting = (code: string, status = 400) =>
  queryClient({ data: null, error: { code, message: `rejected ${code}` }, status });

const DB_PAYLOAD = { code: "XX000", status: 500, message: "boom" };

/** A client whose functions.invoke resolves to what supabase-js returns for a failed call. */
const invokeFailing = (error: unknown) =>
  ({ functions: { invoke: vi.fn().mockResolvedValue({ data: null, error }) } }) as unknown as SupabaseClient;

const httpError = (status: number, body: string) =>
  invokeFailing(
    new FunctionsHttpError(new Response(body, { status, headers: { "Content-Type": "application/json" } })),
  );

let consoleError: MockInstance;
let consoleWarn: MockInstance;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("employeesErrorMessage", () => {
  it.each([
    ["en", "required", "full_name", "Name is required"],
    ["pl", "required", "full_name", "Pole „Imię i nazwisko” jest wymagane"],
    ["en", "too_long", "email", "Email is too long"],
    ["pl", "too_long", "email", "Pole „E-mail” jest za długie"],
    ["en", "email_locked", null, "The email cannot change after the first invite"],
    ["pl", "email_locked", null, "Adresu e-mail nie można zmienić po wysłaniu pierwszego zaproszenia"],
  ] as const)("%s %s (%s)", (locale, code, field, expected) => {
    expect(employeesErrorMessage(code, field, locale)).toBe(expected);
  });

  it.each([
    ["en", "Value is required"],
    ["pl", "Pole „Wartość” jest wymagane"],
  ] as const)("uses the localized fallback label for an unknown field (%s)", (locale, expected) => {
    expect(employeesErrorMessage("required", "hasOwnProperty", locale)).toBe(expected);
    expect(employeesErrorMessage("required", null, locale)).toBe(expected);
  });

  it.each(["boom", "", "toString", "__proto__"])("falls back to the localized generic message for %j", (code) => {
    expect(employeesErrorMessage(code, null, "en")).toBe("Something went wrong. Please try again.");
    expect(employeesErrorMessage(code, null, "pl")).toBe("Coś poszło nie tak. Spróbuj ponownie.");
  });
});

describe("load errors", () => {
  it("listEmployees returns the load_failed code, never text", async () => {
    expect(await listEmployees(failing())).toEqual({ error: "load_failed" });
    expect(consoleError).toHaveBeenCalledWith("listEmployees failed", DB_PAYLOAD);
  });

  it("listEmployees logs the owner filter and the log context", async () => {
    expect(await listEmployees(failing(), { ownerId: OWNER_ID }, { userId: "u-1" })).toEqual({ error: "load_failed" });
    expect(consoleError).toHaveBeenCalledWith("listEmployees failed", {
      ...DB_PAYLOAD,
      ownerId: OWNER_ID,
      userId: "u-1",
    });
  });

  /** A client whose first table query resolves to `first` and every later one to `rest`. */
  const sequenced = (first: SupabaseClient, rest: SupabaseClient) => {
    let call = 0;
    return { from: () => (call++ === 0 ? first : rest).from("") } as unknown as SupabaseClient;
  };
  const empty = (data: unknown) => queryClient({ data, error: null, status: 200 });

  it("listEmployees logs the totals query when only it fails", async () => {
    const client = sequenced(empty([]), failing());
    expect(await listEmployees(client, { ownerId: OWNER_ID })).toEqual({ error: "load_failed" });
    expect(consoleError).toHaveBeenCalledWith("listEmployeeTimeShareTotals failed", {
      ...DB_PAYLOAD,
      ownerId: OWNER_ID,
    });
  });

  it("getEmployeeDetail logs the total query when only it fails", async () => {
    const client = sequenced(empty(null), failing());
    expect(await getEmployeeDetail(client, EMPLOYEE_ID)).toEqual({ error: "load_failed" });
    expect(consoleError).toHaveBeenCalledWith("getEmployeeTimeShareTotal failed", {
      ...DB_PAYLOAD,
      employeeId: EMPLOYEE_ID,
    });
  });

  it("getEmployeeDetail returns the load_failed code", async () => {
    expect(await getEmployeeDetail(failing(), EMPLOYEE_ID)).toEqual({ error: "load_failed" });
    expect(consoleError).toHaveBeenCalledWith("getEmployeeDetail failed", { ...DB_PAYLOAD, employeeId: EMPLOYEE_ID });
  });

  it("listOpenAssignments returns the load_failed code", async () => {
    expect(await listOpenAssignments(failing(), EMPLOYEE_ID)).toEqual({ error: "load_failed" });
    expect(consoleError).toHaveBeenCalledWith("listOpenAssignments failed", { ...DB_PAYLOAD, employeeId: EMPLOYEE_ID });
  });
});

describe("write errors", () => {
  const input = {} as EmployeeInput;
  const update = {} as EmployeeUpdateInput;

  it("updateEmployee: 42501 warns with mappedTo not_found and returns not_found", async () => {
    expect(await updateEmployee(rejecting("42501", 403), EMPLOYEE_ID, update, { userId: "u-1" })).toEqual({
      error: { code: "not_found" },
    });
    expect(consoleWarn).toHaveBeenCalledWith("updateEmployee failed", {
      code: "42501",
      status: 403,
      message: "rejected 42501",
      employeeId: EMPLOYEE_ID,
      userId: "u-1",
      mappedTo: "not_found",
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("createEmployee: 42501 warns without ids", async () => {
    expect(await createEmployee(rejecting("42501", 403), input)).toEqual({ error: { code: "not_found" } });
    expect(consoleWarn).toHaveBeenCalledWith("createEmployee failed", {
      code: "42501",
      status: 403,
      message: "rejected 42501",
      mappedTo: "not_found",
    });
  });

  it.each([
    ["23505", { code: "registration_failed", field: "email" }],
    ["MR001", { code: "owner_not_supervisor" }],
    ["MR008", { code: "employee_has_open_engagements" }],
    ["MR009", { code: "email_locked" }],
    ["MR010", { code: "job_role_archived" }],
  ])("%s is a domain rejection: same code, nothing logged", async (code, expected) => {
    expect(await updateEmployee(rejecting(code, 409), EMPLOYEE_ID, update)).toEqual({ error: expected });
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("an unexpected error is logged at error level as save_failed", async () => {
    expect(await createEmployee(failing(), input)).toEqual({ error: { code: "save_failed" } });
    expect(consoleError).toHaveBeenCalledWith("createEmployee failed", DB_PAYLOAD);
    expect(await updateEmployee(failing(), EMPLOYEE_ID, update)).toEqual({ error: { code: "save_failed" } });
    expect(consoleError).toHaveBeenCalledWith("updateEmployee failed", { ...DB_PAYLOAD, employeeId: EMPLOYEE_ID });
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("updateEmployee: a write that matched no row warns no_rows and returns not_found", async () => {
    const client = queryClient({ data: [], error: null, status: 200 });
    expect(await updateEmployee(client, EMPLOYEE_ID, update, { requestId: "ray-1" })).toEqual({
      error: { code: "not_found" },
    });
    expect(consoleWarn).toHaveBeenCalledWith("updateEmployee failed", {
      code: "no_rows",
      employeeId: EMPLOYEE_ID,
      requestId: "ray-1",
      mappedTo: "not_found",
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("updateEmployee: a matched row logs nothing", async () => {
    const client = queryClient({ data: [{ id: EMPLOYEE_ID }], error: null, status: 200 });
    expect(await updateEmployee(client, EMPLOYEE_ID, update)).toEqual({});
    expect(consoleWarn).not.toHaveBeenCalled();
  });
});

describe("inviteEmployee", () => {
  it("succeeds without logging", async () => {
    const client = { functions: { invoke: vi.fn().mockResolvedValue({ data: {}, error: null }) } };
    expect(await inviteEmployee(client as unknown as SupabaseClient, EMPLOYEE_ID)).toEqual({});
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it.each([
    [400, "invalid_request", "invalid_id"],
    [403, "forbidden", "not_found"],
    [404, "not_found", "not_found"],
  ])("warns HTTP %i { code: %s } with the status and mappedTo %s", async (status, code, mappedTo) => {
    const result = await inviteEmployee(httpError(status, JSON.stringify({ code })), EMPLOYEE_ID, { userId: "u-1" });
    expect(result).toEqual({ error: { code: mappedTo } });
    expect(consoleWarn).toHaveBeenCalledWith("inviteEmployee failed", {
      name: "FunctionsHttpError",
      status,
      code,
      employeeId: EMPLOYEE_ID,
      userId: "u-1",
      mappedTo,
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("logs invite_failed at error level with the status", async () => {
    const result = await inviteEmployee(httpError(500, JSON.stringify({ code: "invite_failed" })), EMPLOYEE_ID);
    expect(result).toEqual({ error: { code: "invite_failed" } });
    expect(consoleError).toHaveBeenCalledWith("inviteEmployee failed", {
      name: "FunctionsHttpError",
      status: 500,
      code: "invite_failed",
      employeeId: EMPLOYEE_ID,
      mappedTo: "invite_failed",
    });
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it.each([
    [409, "already_active", "already_active"],
    [409, "email_unavailable", "registration_failed"],
  ])("HTTP %i { code: %s } is a domain rejection: %s, nothing logged", async (status, code, expected) => {
    expect(await inviteEmployee(httpError(status, JSON.stringify({ code })), EMPLOYEE_ID)).toEqual({
      error: { code: expected },
    });
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("falls back to invite_failed for an unmapped HTML 502, logged with status 502", async () => {
    expect(await inviteEmployee(httpError(502, "<html>Bad gateway</html>"), EMPLOYEE_ID)).toEqual({
      error: { code: "invite_failed" },
    });
    expect(consoleError).toHaveBeenCalledWith("inviteEmployee failed", {
      name: "FunctionsHttpError",
      status: 502,
      employeeId: EMPLOYEE_ID,
    });
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("falls back to invite_failed for an unknown code, warned with the code (contract drift)", async () => {
    expect(await inviteEmployee(httpError(500, JSON.stringify({ code: "toString" })), EMPLOYEE_ID)).toEqual({
      error: { code: "invite_failed" },
    });
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledWith("inviteEmployee failed", {
      name: "FunctionsHttpError",
      status: 500,
      code: "toString",
      employeeId: EMPLOYEE_ID,
    });
  });

  it("falls back to invite_failed for a network error, logged with its cause", async () => {
    const client = invokeFailing(new FunctionsFetchError(new TypeError("fetch failed")));
    expect(await inviteEmployee(client, EMPLOYEE_ID)).toEqual({ error: { code: "invite_failed" } });
    expect(consoleError).toHaveBeenCalledWith("inviteEmployee failed", {
      name: "FunctionsFetchError",
      causeName: "TypeError",
      causeMessage: "fetch failed",
      employeeId: EMPLOYEE_ID,
    });
  });
});
