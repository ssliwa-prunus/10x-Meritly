import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  approvalErrorMessage,
  approvalNoticeMessage,
  approveMilestone,
  emailNotice,
  getApprovedPayout,
  listEmployeeHistory,
  listMyBonuses,
  notifyMilestoneApproved,
} from "@/lib/services/approvals";

// Oracle: the notify-milestone-approved contract (supabase/functions/notify-milestone-approved/index.ts
// header) and the plan's notice rule — failed call → email_failed, unconfirmed emails → email_partial,
// emails held by another request → email_pending, otherwise no notice. No network: functions.invoke
// is faked with what supabase-js returns for a 2xx body, a non-2xx response or a transport failure.
// Log levels and payloads: context/changes/log-mapped-errors/plan.md (Levels, Phase 2) — function
// forbidden/not_found/invalid_request warn, failure codes are errors, not_approved is silent, the
// fall-through is an error; 42501 and MR014 warn, MR003/MR015 are silent.

const MILESTONE_ID = "00000000-0000-4000-8000-000000000023";

function fakeClient(result: { data: unknown; error: unknown }) {
  const invoke = vi.fn().mockResolvedValue(result);
  return { client: { functions: { invoke } } as unknown as SupabaseClient, invoke };
}

const ok = (body: unknown) => fakeClient({ data: body, error: null });

interface QueryResult {
  data: unknown;
  error: unknown;
  status?: number;
}

/** A query builder that resolves to `result` after any chain of builder calls. */
function resolving(result: QueryResult): object {
  const builder: object = new Proxy(
    {},
    {
      get: (_target, prop) =>
        prop === "then"
          ? (resolve: (value: QueryResult) => void) => {
              resolve(result);
            }
          : () => builder,
    },
  );
  return builder;
}

/** A client whose rpc calls resolve to `rpcResult` and table queries to the next of `fromResults`. */
function queryClient(rpcResult: QueryResult, ...fromResults: QueryResult[]): SupabaseClient {
  const queue = fromResults.length > 0 ? fromResults : [rpcResult];
  let call = 0;
  return {
    from: () => resolving(queue[Math.min(call++, queue.length - 1)]),
    rpc: () => resolving(rpcResult),
  } as unknown as SupabaseClient;
}

const DB_ERROR: QueryResult = { data: null, error: { code: "XX000", message: "boom" }, status: 500 };

/** A client whose every query (any chain of builder calls, then awaited) fails with a database error. */
const failingClient = () => queryClient(DB_ERROR);

const rejecting = (code: string, status = 400) =>
  queryClient({ data: null, error: { code, message: `rejected ${code}` }, status });

const httpError = (status: number, body: string) =>
  fakeClient({
    data: null,
    error: new FunctionsHttpError(new Response(body, { status, headers: { "Content-Type": "application/json" } })),
  });

/** Approve path: the outcome of the call plus the notice the route shows. */
async function approveOutcome(client: SupabaseClient) {
  const result = await notifyMilestoneApproved(client, MILESTONE_ID);
  return { result, notice: emailNotice(result) };
}

let consoleError: MockInstance;
let consoleWarn: MockInstance;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("notifyMilestoneApproved", () => {
  it("invokes notify-milestone-approved with the milestone id", async () => {
    const { client, invoke } = ok({ sent: 1, failed: 0, pending: 0 });
    await notifyMilestoneApproved(client, MILESTONE_ID);
    expect(invoke).toHaveBeenCalledWith("notify-milestone-approved", { body: { milestone_id: MILESTONE_ID } });
  });

  it("all emails sent: counts, no notice", async () => {
    const { result, notice } = await approveOutcome(ok({ sent: 2, failed: 0 }).client);
    expect(result).toEqual({ data: { sent: 2, failed: 0, pending: 0 } });
    expect(notice).toBeUndefined();
  });

  it("some emails unconfirmed: email_partial", async () => {
    const { result, notice } = await approveOutcome(ok({ sent: 1, failed: 1, pending: 0 }).client);
    expect(result).toEqual({ data: { sent: 1, failed: 1, pending: 0 } });
    expect(notice).toBe("email_partial");
  });

  it("nothing claimed but lines held by another call: email_pending, not plain success", async () => {
    const { result, notice } = await approveOutcome(ok({ sent: 0, failed: 0, pending: 2 }).client);
    expect(result).toEqual({ data: { sent: 0, failed: 0, pending: 2 } });
    expect(notice).toBe("email_pending");
  });

  it("treats a missing pending as 0 (a function deployed before the field existed)", async () => {
    const { result, notice } = await approveOutcome(ok({ sent: 0, failed: 0 }).client);
    expect(result).toEqual({ data: { sent: 0, failed: 0, pending: 0 } });
    expect(notice).toBeUndefined();
  });

  it.each([
    ["a null body", null],
    ["a string body", "ok"],
    ["non-numeric counts", { sent: "2", failed: null, pending: Number.NaN }],
    ["infinite counts", { sent: Number.POSITIVE_INFINITY, failed: 0, pending: Number.NEGATIVE_INFINITY }],
  ])("reads %s as zero counts", async (_label, body) => {
    const { result } = await approveOutcome(ok(body).client);
    expect(result).toEqual({ data: { sent: 0, failed: 0, pending: 0 } });
  });

  it("send_failed from the function: error send_failed, approve notice email_failed", async () => {
    const { result, notice } = await approveOutcome(httpError(502, JSON.stringify({ code: "send_failed" })).client);
    expect(result).toEqual({ error: { code: "send_failed" } });
    expect(notice).toBe("email_failed");
  });

  // Every documented error code of the function maps to fixed catalog text the page can show.
  // Oracle: the function's response contract (S-05 plan, archived; index.ts header) and the app's
  // rule that permission failures read as not_found, as payouts.ts maps 42501 (no existence leak).
  it.each([
    [400, "invalid_request", "invalid_id"], // the only input is the milestone id
    [403, "forbidden", "not_found"], // not a Supervisor: permission failure, reported as not found
    [404, "not_found", "not_found"], // not visible or not the owner
    [409, "not_approved", "not_approved"],
    [500, "email_not_configured", "email_not_configured"],
    [502, "send_failed", "send_failed"],
    [500, "notify_failed", "notify_failed"],
  ])("maps HTTP %i { code: %s } to %s", async (status, code, expected) => {
    const { result } = await approveOutcome(httpError(status, JSON.stringify({ code })).client);
    expect(result).toEqual({ error: { code: expected } });
  });

  it.each([
    [400, "invalid_request", "invalid_id"],
    [403, "forbidden", "not_found"],
    [404, "not_found", "not_found"],
  ])("warns HTTP %i { code: %s } with the status and mappedTo %s", async (status, code, mappedTo) => {
    await notifyMilestoneApproved(httpError(status, JSON.stringify({ code })).client, MILESTONE_ID, { userId: "u-1" });
    expect(consoleWarn).toHaveBeenCalledWith("notifyMilestoneApproved failed", {
      name: "FunctionsHttpError",
      status,
      code,
      milestoneId: MILESTONE_ID,
      userId: "u-1",
      mappedTo,
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it.each([
    [500, "email_not_configured"],
    [502, "send_failed"],
    [500, "notify_failed"],
  ])("logs HTTP %i { code: %s } at error level with the status", async (status, code) => {
    await notifyMilestoneApproved(httpError(status, JSON.stringify({ code })).client, MILESTONE_ID);
    expect(consoleError).toHaveBeenCalledWith("notifyMilestoneApproved failed", {
      name: "FunctionsHttpError",
      status,
      code,
      milestoneId: MILESTONE_ID,
      mappedTo: code,
    });
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("not_approved is a domain rejection: nothing logged", async () => {
    await notifyMilestoneApproved(httpError(409, JSON.stringify({ code: "not_approved" })).client, MILESTONE_ID);
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("logs an unmapped HTML 502 at error level with status 502", async () => {
    await notifyMilestoneApproved(httpError(502, "<html>Bad gateway</html>").client, MILESTONE_ID);
    expect(consoleError).toHaveBeenCalledWith("notifyMilestoneApproved failed", {
      name: "FunctionsHttpError",
      status: 502,
      milestoneId: MILESTONE_ID,
    });
  });

  it("warns on an unknown function code (contract drift), with its status and code", async () => {
    await notifyMilestoneApproved(httpError(500, JSON.stringify({ code: "boom" })).client, MILESTONE_ID);
    expect(consoleWarn).toHaveBeenCalledWith("notifyMilestoneApproved failed", {
      name: "FunctionsHttpError",
      status: 500,
      code: "boom",
      milestoneId: MILESTONE_ID,
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("logs a network error with its cause", async () => {
    const { client } = fakeClient({ data: null, error: new FunctionsFetchError(new TypeError("fetch failed")) });
    await notifyMilestoneApproved(client, MILESTONE_ID);
    expect(consoleError).toHaveBeenCalledWith("notifyMilestoneApproved failed", {
      name: "FunctionsFetchError",
      causeName: "TypeError",
      causeMessage: "fetch failed",
      milestoneId: MILESTONE_ID,
    });
  });

  it("does not map a relay error's body code: notify_failed, logged with status and code", async () => {
    const response = new Response(JSON.stringify({ code: "forbidden" }), { status: 502 });
    const { client } = fakeClient({ data: null, error: new FunctionsRelayError(response) });
    expect(await notifyMilestoneApproved(client, MILESTONE_ID)).toEqual({ error: { code: "notify_failed" } });
    expect(consoleError).toHaveBeenCalledWith("notifyMilestoneApproved failed", {
      name: "FunctionsRelayError",
      status: 502,
      code: "forbidden",
      milestoneId: MILESTONE_ID,
    });
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown code", httpError(500, JSON.stringify({ code: "boom" }))],
    ["an inherited property name as code", httpError(500, JSON.stringify({ code: "toString" }))],
    ["a non-string code", httpError(500, JSON.stringify({ code: 7 }))],
    ["a body without code", httpError(500, JSON.stringify({ message: "x" }))],
    ["a JSON null body", httpError(500, "null")],
    ["a non-JSON body", httpError(500, "<html>gateway</html>")],
    ["an HTTP error without a Response", fakeClient({ data: null, error: new FunctionsHttpError({}) })],
    ["a network error", fakeClient({ data: null, error: new FunctionsFetchError(new TypeError("fetch failed")) })],
    ["a relay error", fakeClient({ data: null, error: new FunctionsRelayError({}) })],
    ["a non-Error value", fakeClient({ data: null, error: "down" })],
  ])("falls back to notify_failed for %s", async (_label, { client }) => {
    const { result, notice } = await approveOutcome(client);
    expect(result).toEqual({ error: { code: "notify_failed" } });
    expect(notice).toBe("email_failed");
    // Unknown codes warn, everything else errors (pinned above); either way exactly one line is logged.
    expect([...consoleError.mock.calls, ...consoleWarn.mock.calls]).toEqual([
      ["notifyMilestoneApproved failed", expect.any(Object)],
    ]);
  });
});

describe("emailNotice", () => {
  it("prefers email_partial over email_pending when both apply", () => {
    expect(emailNotice({ data: { sent: 0, failed: 1, pending: 1 } })).toBe("email_partial");
  });

  it("gives no notice when there is neither data nor error", () => {
    expect(emailNotice({})).toBeUndefined();
  });
});

describe("approvalNoticeMessage", () => {
  it("resolves email_pending to the fixed pending text", () => {
    expect(approvalNoticeMessage("email_pending", "en")).toBe(
      "Bonus emails are still being sent by another request. Check “Emails sent” in a few minutes; if it does not change, use “Re-send unsent emails”.",
    );
  });

  it("resolves email_pending to the Polish text, quoting the Polish label and button", () => {
    expect(approvalNoticeMessage("email_pending", "pl")).toBe(
      "E-maile o premiach są wciąż wysyłane przez inne żądanie. Sprawdź „Wysłane e-maile” za kilka minut; jeśli wartość się nie zmieni, użyj przycisku „Wyślij ponownie niewysłane e-maile”.",
    );
  });

  // Oracle: the notice must name the button exactly as the dictionary labels it, in each language.
  it.each([
    ["en", "email_partial", "Some bonus emails could not be sent. Use “Re-send unsent emails” to try again."],
    ["en", "email_failed", "The bonus emails could not be sent. Use “Re-send unsent emails” to try again."],
    [
      "pl",
      "email_partial",
      "Nie udało się wysłać części e-maili o premiach. Użyj przycisku „Wyślij ponownie niewysłane e-maile”, aby spróbować ponownie.",
    ],
    [
      "pl",
      "email_failed",
      "Nie udało się wysłać e-maili o premiach. Użyj przycisku „Wyślij ponownie niewysłane e-maile”, aby spróbować ponownie.",
    ],
  ] as const)("resolves %s %s", (locale, code, expected) => {
    expect(approvalNoticeMessage(code, locale)).toBe(expected);
  });

  it.each(["email_unknown", "", "toString", "__proto__"])("gives nothing for unknown notice code %j", (code) => {
    expect(approvalNoticeMessage(code, "en")).toBeNull();
    expect(approvalNoticeMessage(code, "pl")).toBeNull();
  });
});

describe("approvalErrorMessage", () => {
  it.each([
    ["en", "already_approved", "This milestone is already approved"],
    ["pl", "already_approved", "Ten kamień milowy jest już zatwierdzony"],
  ] as const)("resolves %s %s from the catalog", (locale, code, expected) => {
    expect(approvalErrorMessage(code, locale)).toBe(expected);
  });

  it.each(["boom", "toString", "__proto__"])("falls back to the localized generic message for %j", (code) => {
    expect(approvalErrorMessage(code, "en")).toBe("Something went wrong. Please try again.");
    expect(approvalErrorMessage(code, "pl")).toBe("Coś poszło nie tak. Spróbuj ponownie.");
  });
});

describe("load errors", () => {
  const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000002";
  const DB_PAYLOAD = { code: "XX000", status: 500, message: "boom" };

  it("listMyBonuses returns the load_failed code, never text", async () => {
    expect(await listMyBonuses(failingClient(), { userId: "u-1" })).toEqual({ error: "load_failed" });
    expect(consoleError).toHaveBeenCalledWith("listMyBonusesEmployee failed", { ...DB_PAYLOAD, userId: "u-1" });
  });

  it("listMyBonuses logs the linked employee id when the lines fail", async () => {
    const client = queryClient({ data: EMPLOYEE_ID, error: null, status: 200 }, DB_ERROR);
    expect(await listMyBonuses(client)).toEqual({ error: "load_failed" });
    expect(consoleError).toHaveBeenCalledWith("listMyBonuses failed", { ...DB_PAYLOAD, employeeId: EMPLOYEE_ID });
  });

  it("listEmployeeHistory returns the load_failed code", async () => {
    expect(await listEmployeeHistory(failingClient(), EMPLOYEE_ID)).toEqual({ error: "load_failed" });
    expect(consoleError).toHaveBeenCalledWith("listEmployeeHistory failed", { ...DB_PAYLOAD, employeeId: EMPLOYEE_ID });
  });

  it("getApprovedPayout returns the load_failed code", async () => {
    expect(await getApprovedPayout(failingClient(), MILESTONE_ID)).toEqual({ error: "load_failed" });
    expect(consoleError).toHaveBeenCalledWith("getApprovedPayoutHeader failed", {
      ...DB_PAYLOAD,
      milestoneId: MILESTONE_ID,
    });
  });

  it("getApprovedPayout logs the lines query when only it fails", async () => {
    const client = queryClient(DB_ERROR, { data: null, error: null, status: 200 }, DB_ERROR);
    expect(await getApprovedPayout(client, MILESTONE_ID)).toEqual({ error: "load_failed" });
    expect(consoleError).toHaveBeenCalledWith("getApprovedPayoutLines failed", {
      ...DB_PAYLOAD,
      milestoneId: MILESTONE_ID,
    });
  });
});

describe("approveMilestone", () => {
  it("42501 warns with mappedTo not_found and returns not_found", async () => {
    expect(await approveMilestone(rejecting("42501", 403), MILESTONE_ID, { requestId: "ray-1" })).toEqual({
      error: { code: "not_found" },
    });
    expect(consoleWarn).toHaveBeenCalledWith("approveMilestone failed", {
      code: "42501",
      status: 403,
      message: "rejected 42501",
      milestoneId: MILESTONE_ID,
      requestId: "ray-1",
      mappedTo: "not_found",
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("MR014 warns with mappedTo not_approvable", async () => {
    expect(await approveMilestone(rejecting("MR014"), MILESTONE_ID)).toEqual({ error: { code: "not_approvable" } });
    expect(consoleWarn).toHaveBeenCalledWith("approveMilestone failed", {
      code: "MR014",
      status: 400,
      message: "rejected MR014",
      milestoneId: MILESTONE_ID,
      mappedTo: "not_approvable",
    });
  });

  it.each([
    ["MR003", "project_closed"],
    ["MR015", "already_approved"],
  ])("%s is a domain rejection: %s, nothing logged", async (code, expected) => {
    expect(await approveMilestone(rejecting(code), MILESTONE_ID)).toEqual({ error: { code: expected } });
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("an unexpected error is logged at error level as save_failed", async () => {
    expect(await approveMilestone(failingClient(), MILESTONE_ID)).toEqual({ error: { code: "save_failed" } });
    expect(consoleError).toHaveBeenCalledWith("approveMilestone failed", {
      code: "XX000",
      status: 500,
      message: "boom",
      milestoneId: MILESTONE_ID,
    });
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("a successful approval logs nothing", async () => {
    expect(await approveMilestone(queryClient({ data: null, error: null, status: 204 }), MILESTONE_ID)).toEqual({});
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });
});
