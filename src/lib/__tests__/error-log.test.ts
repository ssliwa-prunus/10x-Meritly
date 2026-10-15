import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  errorFields,
  functionFallbackLevel,
  logContextFrom,
  logError,
  logFunctionError,
  mapLoadError,
  readFunctionError,
} from "@/lib/error-log";

// Oracle: context/changes/log-mapped-errors/plan.md, Key Discoveries "Field allow-list" and
// Critical Implementation Details. PostgREST errors are plain parsed objects (no status, no class);
// status comes from the result. Payloads omit absent and empty-string keys, except `code` ("" is
// the transport signal). Assertions use toStrictEqual so an `undefined` key fails them.

let consoleError: MockInstance;
let consoleWarn: MockInstance;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const jsonResponse = (status: number, body: string) =>
  new Response(body, { status, headers: { "Content-Type": "application/json" } });

describe("errorFields: PostgREST errors", () => {
  it("keeps code, the result status and message for an ordinary JSON error, but not details or hint", () => {
    const error = { code: "XX000", message: "boom", details: "row (a@b.pl)", hint: "try again" };
    expect(errorFields(error, 500)).toStrictEqual({ code: "XX000", status: 500, message: "boom" });
  });

  it("omits status when none is passed", () => {
    expect(errorFields({ code: "XX000", message: "boom" })).toStrictEqual({ code: "XX000", message: "boom" });
  });

  it("drops the details of a unique violation, so the email never reaches the log", () => {
    const error = {
      code: "23505",
      message: 'duplicate key value violates unique constraint "employees_email_key"',
      details: "Key (email)=(a@b.pl) already exists.",
      hint: null,
    };
    const fields = errorFields(error, 409);
    expect(fields).toStrictEqual({
      code: "23505",
      status: 409,
      message: 'duplicate key value violates unique constraint "employees_email_key"',
    });
    expect(JSON.stringify(fields)).not.toContain("a@b.pl");
  });

  it("drops the failing row of a check violation", () => {
    const error = {
      code: "23514",
      message: 'new row violates check constraint "x"',
      details: "Failing row contains (Jan, a@b.pl, 1000).",
      hint: "",
    };
    expect(errorFields(error, 400)).toStrictEqual({
      code: "23514",
      status: 400,
      message: 'new row violates check constraint "x"',
    });
  });

  it("drops the message of a class 22 error, which echoes the input", () => {
    const error = { code: "22P02", message: 'invalid input syntax for type uuid: "secret"', details: null, hint: null };
    expect(errorFields(error, 400)).toStrictEqual({ code: "22P02", status: 400 });
  });

  it("keeps message, details and hint of a transport failure (code '' and status 0)", () => {
    const error = { code: "", message: "TypeError: fetch failed", details: "stack at x.js:1", hint: "timeout" };
    expect(errorFields(error, 0)).toStrictEqual({
      code: "",
      status: 0,
      message: "TypeError: fetch failed",
      details: "stack at x.js:1",
      hint: "timeout",
    });
  });

  it("treats code '' as transport even without a status", () => {
    const error = { code: "", message: "TypeError: fetch failed", details: "stack", hint: "abort" };
    expect(errorFields(error)).toStrictEqual({
      code: "",
      message: "TypeError: fetch failed",
      details: "stack",
      hint: "abort",
    });
  });

  it("treats status 0 as transport whatever the code", () => {
    const error = { code: "XX000", message: "m", details: "d", hint: "h" };
    expect(errorFields(error, 0)).toStrictEqual({ code: "XX000", status: 0, message: "m", details: "d", hint: "h" });
  });

  it.each(["42501", "42703", "42P01", "57014", "PGRST116", "PGRST002"])("keeps details and hint for %s", (code) => {
    const error = { code, message: "m", details: "d", hint: "h" };
    expect(errorFields(error, 403)).toStrictEqual({ code, status: 403, message: "m", details: "d", hint: "h" });
  });

  it.each(["57000", "X42501", "XPGRST1", "23503"])("drops details and hint for %s", (code) => {
    const error = { code, message: "m", details: "d", hint: "h" };
    expect(errorFields(error, 500)).toStrictEqual({ code, status: 500, message: "m" });
  });

  it("omits empty-string message, details and hint but keeps an empty code", () => {
    const error = { code: "", message: "", details: "", hint: "" };
    expect(errorFields(error, 0)).toStrictEqual({ code: "", status: 0 });
  });

  it("ignores non-string details and hint", () => {
    const error = { code: "42501", message: "m", details: 7, hint: { x: 1 } };
    expect(errorFields(error, 403)).toStrictEqual({ code: "42501", status: 403, message: "m" });
  });

  it("cuts a raw non-JSON body (no code key) to 200 characters", () => {
    const body = `<html>${"x".repeat(494)}`;
    expect(body).toHaveLength(500);
    expect(errorFields({ message: body }, 502)).toStrictEqual({ status: 502, message: body.slice(0, 200) });
  });

  it("logs only the length of a 2xx body that failed to parse, never its rows", () => {
    const body = '[{"employee_id":"e-1","full_name":"Jan Kowalski","bonus":1234.5';
    const fields = errorFields({ message: body }, 200);
    expect(fields).toStrictEqual({ status: 200, bodyLength: body.length });
    expect(JSON.stringify(fields)).not.toMatch(/Kowalski|1234/);
  });

  it.each([199, 300])("still logs a raw-body excerpt at status %i (outside 2xx)", (status) => {
    expect(errorFields({ message: "<html>x</html>" }, status)).toStrictEqual({ status, message: "<html>x</html>" });
  });

  it("keeps a short raw body whole and treats a non-string code as a raw body", () => {
    expect(errorFields({ code: 500, message: "Bad gateway", details: "d" })).toStrictEqual({ message: "Bad gateway" });
  });

  it("logs an empty object as an empty payload", () => {
    expect(errorFields({})).toStrictEqual({});
  });
});

describe("errorFields: Auth, function and non-object values", () => {
  it("keeps name, status and code of an Auth error and never its message", () => {
    const error = new AuthApiError("User a@b.pl already registered", 422, "user_already_exists");
    expect(errorFields(error, 999)).toStrictEqual({ name: "AuthApiError", status: 422, code: "user_already_exists" });
  });

  it("tells an anonymous session from an Auth outage by name", () => {
    expect(errorFields(new AuthSessionMissingError())).toStrictEqual({ name: "AuthSessionMissingError", status: 400 });
    expect(errorFields(new AuthRetryableFetchError("fetch failed", 0))).toStrictEqual({
      name: "AuthRetryableFetchError",
      status: 0,
    });
  });

  it("reads a function HTTP error's status without its body", () => {
    const response = jsonResponse(500, JSON.stringify({ code: "invite_failed" }));
    expect(errorFields(new FunctionsHttpError(response))).toStrictEqual({ name: "FunctionsHttpError", status: 500 });
    expect(response.bodyUsed).toBe(false);
  });

  it("reads a function fetch error's cause", () => {
    const error = new FunctionsFetchError(new TypeError("fetch failed"));
    expect(errorFields(error)).toStrictEqual({
      name: "FunctionsFetchError",
      causeName: "TypeError",
      causeMessage: "fetch failed",
    });
  });

  it("logs a null as 'null' and a string by its type, never its content", () => {
    expect(errorFields(null)).toStrictEqual({ name: "null" });
    expect(errorFields("a@b.pl")).toStrictEqual({ name: "string" });
    expect(errorFields(undefined)).toStrictEqual({ name: "undefined" });
  });
});

describe("logError", () => {
  it("writes at error level with ids, request context and the mapped code", () => {
    logError(
      "error",
      "updateProject",
      { code: "42501", message: "denied", details: "d", hint: "" },
      {
        status: 403,
        ids: { projectId: "p-1", milestoneId: "m-1" },
        log: { userId: "u-1", requestId: "ray-1" },
        mappedTo: "not_found",
      },
    );
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith("updateProject failed", {
      code: "42501",
      status: 403,
      message: "denied",
      details: "d",
      projectId: "p-1",
      milestoneId: "m-1",
      userId: "u-1",
      requestId: "ray-1",
      mappedTo: "not_found",
    });
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("writes at warn level when asked", () => {
    logError("warn", "createEngagement", { code: "23505", message: "dup" }, { mappedTo: "duplicate" });
    expect(consoleWarn).toHaveBeenCalledWith("createEngagement failed", {
      code: "23505",
      message: "dup",
      mappedTo: "duplicate",
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("omits absent and empty ids and context", () => {
    logError(
      "error",
      "listProjects",
      { code: "XX000", message: "boom" },
      {
        ids: { projectId: undefined, employeeId: "" },
        log: { userId: undefined },
      },
    );
    const [, data] = consoleError.mock.calls[0] as [string, unknown];
    expect(data).toStrictEqual({ code: "XX000", message: "boom" });
  });

  it("works without meta", () => {
    logError("error", "listProjects", null);
    const [, data] = consoleError.mock.calls[0] as [string, unknown];
    expect(data).toStrictEqual({ name: "null" });
  });
});

describe("mapLoadError", () => {
  it("returns load_failed and logs at error level", () => {
    const code = mapLoadError(
      "getProject",
      { code: "XX000", message: "boom" },
      {
        status: 500,
        ids: { projectId: "p-1" },
      },
    );
    expect(code).toBe("load_failed");
    expect(consoleError).toHaveBeenCalledWith("getProject failed", {
      code: "XX000",
      status: 500,
      message: "boom",
      projectId: "p-1",
    });
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("works without meta", () => {
    expect(mapLoadError("listProjects", { code: "XX000", message: "boom" })).toBe("load_failed");
    expect(consoleError).toHaveBeenCalledWith("listProjects failed", { code: "XX000", message: "boom" });
  });
});

describe("logContextFrom", () => {
  const request = (headers: Record<string, string> = {}) => new Request("https://meritly.test/x", { headers });

  it("takes the user id and the cf-ray header", () => {
    expect(logContextFrom({ user: { id: "u-1" } }, request({ "cf-ray": "8f-WAW" }))).toStrictEqual({
      userId: "u-1",
      requestId: "8f-WAW",
    });
  });

  it("omits both when signed out and running locally", () => {
    expect(logContextFrom({ user: null }, request())).toStrictEqual({});
  });

  it("caps a client-supplied cf-ray at 64 characters", () => {
    const long = "a".repeat(65);
    expect(logContextFrom({ user: null }, request({ "cf-ray": long }))).toStrictEqual({ requestId: long.slice(0, 64) });
  });

  it("omits each one independently", () => {
    expect(logContextFrom({ user: null }, request({ "cf-ray": "8f-WAW" }))).toStrictEqual({ requestId: "8f-WAW" });
    expect(logContextFrom({ user: { id: "u-1" } }, request())).toStrictEqual({ userId: "u-1" });
  });
});

describe("readFunctionError", () => {
  it("reads the status and the JSON body's code of an HTTP error", async () => {
    const error = new FunctionsHttpError(jsonResponse(409, JSON.stringify({ code: "already_active" })));
    await expect(readFunctionError(error)).resolves.toStrictEqual({
      name: "FunctionsHttpError",
      status: 409,
      code: "already_active",
    });
  });

  it("consumes the Response body itself, leaving no unread stream behind", async () => {
    const response = jsonResponse(404, JSON.stringify({ code: "not_found" }));
    await readFunctionError(new FunctionsHttpError(response));
    expect(response.bodyUsed).toBe(true);
  });

  it("keeps the status of an HTML body and does not throw", async () => {
    const error = new FunctionsHttpError(new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(readFunctionError(error)).resolves.toStrictEqual({ name: "FunctionsHttpError", status: 502 });
  });

  it("keeps the status when the body was already read", async () => {
    const response = jsonResponse(500, JSON.stringify({ code: "x" }));
    await response.text();
    await expect(readFunctionError(new FunctionsHttpError(response))).resolves.toStrictEqual({
      name: "FunctionsHttpError",
      status: 500,
    });
  });

  it.each([
    ["a non-object JSON body", JSON.stringify("oops")],
    ["a null JSON body", "null"],
    ["a non-string code", JSON.stringify({ code: 5 })],
  ])("leaves code undefined for %s", async (_label, body) => {
    const error = new FunctionsHttpError(jsonResponse(500, body));
    await expect(readFunctionError(error)).resolves.toStrictEqual({ name: "FunctionsHttpError", status: 500 });
  });

  it("reads a relay error like an HTTP error", async () => {
    const error = new FunctionsRelayError(jsonResponse(503, JSON.stringify({ code: "relay" })));
    await expect(readFunctionError(error)).resolves.toStrictEqual({
      name: "FunctionsRelayError",
      status: 503,
      code: "relay",
    });
  });

  it("returns only the name when an HTTP error carries no Response", async () => {
    await expect(readFunctionError(new FunctionsHttpError({}))).resolves.toStrictEqual({ name: "FunctionsHttpError" });
  });

  it("does not read a Response off a fetch error", async () => {
    const error = new FunctionsFetchError(jsonResponse(500, JSON.stringify({ code: "x" })));
    await expect(readFunctionError(error)).resolves.toStrictEqual({ name: "FunctionsFetchError" });
  });

  it("reads the cause of a fetch error", async () => {
    const error = new FunctionsFetchError(new TypeError("fetch failed"));
    await expect(readFunctionError(error)).resolves.toStrictEqual({
      name: "FunctionsFetchError",
      causeName: "TypeError",
      causeMessage: "fetch failed",
    });
  });

  it.each([
    ["a string", "boom"],
    ["null", null],
  ])("returns only the name for a fetch error whose context is %s", async (_label, context) => {
    await expect(readFunctionError(new FunctionsFetchError(context))).resolves.toStrictEqual({
      name: "FunctionsFetchError",
    });
  });

  it("returns only the name for a non-function error", async () => {
    await expect(readFunctionError(new TypeError("x"))).resolves.toStrictEqual({ name: "TypeError" });
    await expect(readFunctionError({ code: "XX000" })).resolves.toStrictEqual({ name: "object" });
    await expect(readFunctionError(null)).resolves.toStrictEqual({ name: "null" });
  });
});

describe("functionFallbackLevel", () => {
  const http = (status: number) => new FunctionsHttpError(new Response("{}", { status }));

  it.each([400, 403, 409, 499])("warns on an unknown code from a %i (contract drift)", (status) => {
    expect(functionFallbackLevel(http(status), { name: "FunctionsHttpError", status, code: "boom" })).toBe("warn");
  });

  it.each([404, 500, 502, 399])("is an error for an unknown code at %i", (status) => {
    expect(functionFallbackLevel(http(status), { name: "FunctionsHttpError", status, code: "boom" })).toBe("error");
  });

  it("is an error for a 4xx without a code", () => {
    expect(functionFallbackLevel(http(409), { name: "FunctionsHttpError", status: 409 })).toBe("error");
  });

  it("is an error for a 4xx code without a known status", () => {
    expect(functionFallbackLevel(http(409), { name: "FunctionsHttpError", code: "boom" })).toBe("error");
  });

  it("is an error for a relay error, even with a 4xx code", () => {
    const relay = new FunctionsRelayError(new Response("{}", { status: 409 }));
    expect(functionFallbackLevel(relay, { name: "FunctionsRelayError", status: 409, code: "boom" })).toBe("error");
  });
});

describe("logFunctionError", () => {
  it("writes the info fields with ids, context and the mapped code", () => {
    logFunctionError(
      "warn",
      "inviteEmployee",
      { name: "FunctionsHttpError", status: 409, code: "already_active" },
      { ids: { employeeId: "e-1" }, log: { userId: "u-1" }, mappedTo: "already_active" },
    );
    expect(consoleWarn).toHaveBeenCalledWith("inviteEmployee failed", {
      name: "FunctionsHttpError",
      status: 409,
      code: "already_active",
      employeeId: "e-1",
      userId: "u-1",
      mappedTo: "already_active",
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("omits absent info fields and writes at error level", () => {
    logFunctionError("error", "notifyMilestoneApproved", {
      name: "FunctionsFetchError",
      causeName: "TypeError",
      causeMessage: "fetch failed",
      status: undefined,
      code: undefined,
    });
    const [message, data] = consoleError.mock.calls[0] as [string, unknown];
    expect(message).toBe("notifyMilestoneApproved failed");
    expect(data).toStrictEqual({ name: "FunctionsFetchError", causeName: "TypeError", causeMessage: "fetch failed" });
  });
});
