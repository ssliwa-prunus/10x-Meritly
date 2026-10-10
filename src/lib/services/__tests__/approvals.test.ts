import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { approvalNoticeMessage, emailNotice, notifyMilestoneApproved } from "@/lib/services/approvals";

// Oracle: the notify-milestone-approved contract (supabase/functions/notify-milestone-approved/index.ts
// header) and the plan's notice rule — failed call → email_failed, unconfirmed emails → email_partial,
// emails held by another request → email_pending, otherwise no notice. No network: functions.invoke
// is faked with what supabase-js returns for a 2xx body, a non-2xx response or a transport failure.

const MILESTONE_ID = "00000000-0000-4000-8000-000000000023";

function fakeClient(result: { data: unknown; error: unknown }) {
  const invoke = vi.fn().mockResolvedValue(result);
  return { client: { functions: { invoke } } as unknown as SupabaseClient, invoke };
}

const ok = (body: unknown) => fakeClient({ data: body, error: null });

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

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
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
    expect(consoleError).toHaveBeenCalledWith("notifyMilestoneApproved failed", expect.any(Object));
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
    expect(approvalNoticeMessage("email_pending")).toBe(
      "Bonus emails are still being sent by another request. Check “Emails sent” in a few minutes; if it does not change, use “Re-send unsent emails”.",
    );
  });

  it.each(["email_unknown", "", "toString", "__proto__"])("gives nothing for unknown notice code %j", (code) => {
    expect(approvalNoticeMessage(code)).toBeNull();
  });
});
