import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  createEngagement,
  deleteEngagement,
  engagementsErrorMessage,
  isMilestoneInProject,
  listAssignableEmployees,
  listEngagements,
  updateEngagement,
  type EngagementInput,
  type EngagementUpdateInput,
} from "@/lib/services/engagements";

// Oracle: the code-in-URL contract (engagements.ts header) — a known code renders its catalog text
// in the request's locale with the field label of that locale; anything else renders the localized
// generic message. Load failures return the code "load_failed", never text. Log levels and payloads:
// context/changes/log-mapped-errors/plan.md (Levels, Phase 2) — 42501 and 0-row writes warn with
// mappedTo, 23505 and the guard codes are silent, anything else is an error.

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const MILESTONE_ID = "00000000-0000-4000-8000-000000000003";
const OWNER_ID = "00000000-0000-4000-8000-000000000009";
const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000002";
const ENGAGEMENT_ID = "00000000-0000-4000-8000-000000000004";

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

const noRows = () => queryClient({ data: [], error: null, status: 200 });

const DB_PAYLOAD = { code: "XX000", status: 500, message: "boom" };

let consoleError: MockInstance;
let consoleWarn: MockInstance;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("engagementsErrorMessage", () => {
  it.each([
    ["en", "not_a_number", "time_share", "Time share must be a number"],
    ["pl", "not_a_number", "time_share", "Pole „Udział czasowy” musi być liczbą"],
    ["en", "required", "employee_id", "Employee is required"],
    ["pl", "required", "employee_id", "Pole „Pracownik” jest wymagane"],
    ["en", "rating_range", "rating", "Rating must be a whole number from 1 to 5"],
    ["pl", "rating_range", "rating", "Ocena musi być liczbą całkowitą od 1 do 5"],
  ] as const)("%s %s (%s)", (locale, code, field, expected) => {
    expect(engagementsErrorMessage(code, field, locale)).toBe(expected);
  });

  it.each([
    ["en", "Value must have at most 2 decimal places"],
    ["pl", "Pole „Wartość” może mieć najwyżej 2 miejsca po przecinku"],
  ] as const)("uses the localized fallback label for an unknown field (%s)", (locale, expected) => {
    expect(engagementsErrorMessage("too_many_decimals", "valueOf", locale)).toBe(expected);
    expect(engagementsErrorMessage("too_many_decimals", null, locale)).toBe(expected);
  });

  it.each(["boom", "", "toString", "__proto__"])("falls back to the localized generic message for %j", (code) => {
    expect(engagementsErrorMessage(code, null, "en")).toBe("Something went wrong. Please try again.");
    expect(engagementsErrorMessage(code, null, "pl")).toBe("Coś poszło nie tak. Spróbuj ponownie.");
  });
});

describe("load errors", () => {
  it("listEngagements returns the load_failed code, never text", async () => {
    expect(await listEngagements(failing(), MILESTONE_ID)).toEqual({ error: "load_failed" });
    expect(consoleError).toHaveBeenCalledWith("listEngagements failed", { ...DB_PAYLOAD, milestoneId: MILESTONE_ID });
  });

  it("listEngagements logs the totals query when only it fails", async () => {
    let call = 0;
    const engagements = queryClient({ data: [{ employee_id: EMPLOYEE_ID }], error: null, status: 200 });
    const totals = failing();
    const client = { from: () => (call++ === 0 ? engagements : totals).from("") } as unknown as SupabaseClient;
    expect(await listEngagements(client, MILESTONE_ID, { userId: "u-1" })).toEqual({ error: "load_failed" });
    expect(consoleError).toHaveBeenCalledWith("listEngagementTimeShareTotals failed", {
      ...DB_PAYLOAD,
      milestoneId: MILESTONE_ID,
      userId: "u-1",
    });
  });

  it("listAssignableEmployees returns the load_failed code", async () => {
    expect(await listAssignableEmployees(failing(), OWNER_ID, MILESTONE_ID)).toEqual({ error: "load_failed" });
    expect(consoleError).toHaveBeenCalledWith("listAssignableEmployees failed", {
      ...DB_PAYLOAD,
      ownerId: OWNER_ID,
      milestoneId: MILESTONE_ID,
    });
  });

  it("listAssignableEmployees logs the assigned-ids query when only it fails", async () => {
    let call = 0;
    const employees = queryClient({ data: [], error: null, status: 200 });
    const assigned = failing();
    const client = { from: () => (call++ === 0 ? employees : assigned).from("") } as unknown as SupabaseClient;
    expect(await listAssignableEmployees(client, OWNER_ID, MILESTONE_ID)).toEqual({ error: "load_failed" });
    expect(consoleError).toHaveBeenCalledWith("listAssignedEmployeeIds failed", {
      ...DB_PAYLOAD,
      ownerId: OWNER_ID,
      milestoneId: MILESTONE_ID,
    });
  });

  it("isMilestoneInProject answers without logging when the query succeeds", async () => {
    const client = queryClient({ data: { id: MILESTONE_ID }, error: null, status: 200 });
    expect(await isMilestoneInProject(client, PROJECT_ID, MILESTONE_ID)).toEqual({ data: true });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("isMilestoneInProject returns the load_failed code", async () => {
    expect(await isMilestoneInProject(failing(), PROJECT_ID, MILESTONE_ID)).toEqual({ error: "load_failed" });
    expect(consoleError).toHaveBeenCalledWith("isMilestoneInProject failed", {
      ...DB_PAYLOAD,
      projectId: PROJECT_ID,
      milestoneId: MILESTONE_ID,
    });
  });
});

describe("write errors", () => {
  const input = { employee_id: EMPLOYEE_ID } as EngagementInput;
  const update = {} as EngagementUpdateInput;
  const writes = {
    createEngagement: (client: SupabaseClient) => createEngagement(client, MILESTONE_ID, input, { userId: "u-1" }),
    updateEngagement: (client: SupabaseClient) =>
      updateEngagement(client, MILESTONE_ID, ENGAGEMENT_ID, update, { userId: "u-1" }),
    deleteEngagement: (client: SupabaseClient) =>
      deleteEngagement(client, MILESTONE_ID, ENGAGEMENT_ID, { userId: "u-1" }),
  };
  const idsOf = {
    createEngagement: { milestoneId: MILESTONE_ID, employeeId: EMPLOYEE_ID },
    updateEngagement: { milestoneId: MILESTONE_ID, engagementId: ENGAGEMENT_ID },
    deleteEngagement: { milestoneId: MILESTONE_ID, engagementId: ENGAGEMENT_ID },
  };
  const operations = Object.keys(writes) as (keyof typeof writes)[];

  it.each(operations)("%s: 42501 warns with mappedTo not_found and returns not_found", async (operation) => {
    expect(await writes[operation](rejecting("42501", 403))).toEqual({ error: { code: "not_found" } });
    expect(consoleWarn).toHaveBeenCalledWith(`${operation} failed`, {
      code: "42501",
      status: 403,
      message: "rejected 42501",
      ...idsOf[operation],
      userId: "u-1",
      mappedTo: "not_found",
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it.each(operations)("%s: an unexpected error is logged at error level as save_failed", async (operation) => {
    expect(await writes[operation](failing())).toEqual({ error: { code: "save_failed" } });
    expect(consoleError).toHaveBeenCalledWith(`${operation} failed`, {
      ...DB_PAYLOAD,
      ...idsOf[operation],
      userId: "u-1",
    });
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it.each(operations)("%s: a write that matched no row warns no_rows and returns not_found", async (operation) => {
    expect(await writes[operation](noRows())).toEqual({ error: { code: "not_found" } });
    expect(consoleWarn).toHaveBeenCalledWith(`${operation} failed`, {
      code: "no_rows",
      ...idsOf[operation],
      userId: "u-1",
      mappedTo: "not_found",
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it.each([
    ["23505", { code: "already_assigned", field: "employee_id" }],
    ["MR007", { code: "milestone_closed" }],
    ["MR011", { code: "employee_not_available" }],
    ["MR015", { code: "milestone_approved" }],
  ])("%s is a domain rejection: same code, nothing logged", async (code, expected) => {
    expect(await writes.createEngagement(rejecting(code, 409))).toEqual({ error: expected });
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it.each(operations)("%s: a matched row succeeds and logs nothing", async (operation) => {
    const client = queryClient({ data: [{ id: ENGAGEMENT_ID }], error: null, status: 200 });
    expect(await writes[operation](client)).toEqual({});
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
