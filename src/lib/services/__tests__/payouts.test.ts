import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { getMilestonePayout, kpiErrorMessage, updateKpiScores, type KpiScoresInput } from "@/lib/services/payouts";

// Oracle: the code-in-URL contract (payouts.ts header) — a known code renders its catalog text in
// the request's locale; the KPI names Termin/Budżet/Jakość/Ryzyko are product terms and stay the
// same in both languages (plan, "What We're NOT Doing"); anything else renders the localized
// generic message. Load failures return the code "load_failed", never text. Log levels and payloads:
// context/changes/log-mapped-errors/plan.md (Levels, Phase 2) — 42501 and 0-row writes warn with
// mappedTo, the guard codes are silent, anything else is an error.

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const MILESTONE_ID = "00000000-0000-4000-8000-000000000003";

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

let consoleError: MockInstance;
let consoleWarn: MockInstance;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("kpiErrorMessage", () => {
  it.each([
    ["en", "kpi_range", "kpi_risk", "Ryzyko must be a whole number from 0 to 100"],
    ["pl", "kpi_range", "kpi_risk", "Pole „Ryzyko” musi być liczbą całkowitą od 0 do 100"],
    ["en", "required", "kpi_budget", "Budżet is required"],
    ["pl", "required", "kpi_budget", "Pole „Budżet” jest wymagane"],
    ["en", "milestone_cancelled", null, "The milestone is cancelled; its KPI scores cannot be changed"],
    ["pl", "milestone_cancelled", null, "Kamień milowy jest anulowany; jego wyników KPI nie można zmienić"],
  ] as const)("%s %s (%s)", (locale, code, field, expected) => {
    expect(kpiErrorMessage(code, field, locale)).toBe(expected);
  });

  it.each([
    ["en", "Value is required"],
    ["pl", "Pole „Wartość” jest wymagane"],
  ] as const)("uses the localized fallback label for an unknown field (%s)", (locale, expected) => {
    expect(kpiErrorMessage("required", "constructor", locale)).toBe(expected);
    expect(kpiErrorMessage("required", null, locale)).toBe(expected);
  });

  it.each(["boom", "", "toString", "__proto__"])("falls back to the localized generic message for %j", (code) => {
    expect(kpiErrorMessage(code, null, "en")).toBe("Something went wrong. Please try again.");
    expect(kpiErrorMessage(code, null, "pl")).toBe("Coś poszło nie tak. Spróbuj ponownie.");
  });
});

const rejecting = (code: string, status = 400) =>
  queryClient({ data: null, error: { code, message: `rejected ${code}` }, status });

const DB_PAYLOAD = { code: "XX000", status: 500, message: "boom" };

describe("load errors", () => {
  it("getMilestonePayout returns the load_failed code, never text", async () => {
    const client = queryClient({ data: null, error: { code: "XX000", message: "boom" }, status: 500 });
    expect(await getMilestonePayout(client, MILESTONE_ID, { userId: "u-1" })).toEqual({
      error: "load_failed",
    });
    expect(consoleError).toHaveBeenCalledWith("getMilestonePayoutSummary failed", {
      ...DB_PAYLOAD,
      milestoneId: MILESTONE_ID,
      userId: "u-1",
    });
  });

  it("getMilestonePayout logs the lines call when only it fails", async () => {
    let call = 0;
    const summary = queryClient({ data: [], error: null, status: 200 });
    const lines = queryClient({ data: null, error: { code: "XX000", message: "boom" }, status: 500 });
    const client = { rpc: () => (call++ === 0 ? summary : lines).rpc("") } as unknown as SupabaseClient;
    expect(await getMilestonePayout(client, MILESTONE_ID)).toEqual({ error: "load_failed" });
    expect(consoleError).toHaveBeenCalledWith("getMilestonePayoutLines failed", {
      ...DB_PAYLOAD,
      milestoneId: MILESTONE_ID,
    });
  });
});

describe("updateKpiScores", () => {
  const input = {} as KpiScoresInput;
  const ids = { projectId: PROJECT_ID, milestoneId: MILESTONE_ID };

  it("42501 warns with mappedTo not_found and returns not_found", async () => {
    expect(await updateKpiScores(rejecting("42501", 403), PROJECT_ID, MILESTONE_ID, input, { userId: "u-1" })).toEqual({
      error: { code: "not_found" },
    });
    expect(consoleWarn).toHaveBeenCalledWith("updateKpiScores failed", {
      code: "42501",
      status: 403,
      message: "rejected 42501",
      ...ids,
      userId: "u-1",
      mappedTo: "not_found",
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it.each([
    ["MR003", "project_closed"],
    ["MR013", "milestone_cancelled"],
    ["MR015", "milestone_approved"],
  ])("%s is a domain rejection: %s, nothing logged", async (code, expected) => {
    expect(await updateKpiScores(rejecting(code), PROJECT_ID, MILESTONE_ID, input)).toEqual({
      error: { code: expected },
    });
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("an unexpected error is logged at error level as save_failed", async () => {
    const client = queryClient({ data: null, error: { code: "XX000", message: "boom" }, status: 500 });
    expect(await updateKpiScores(client, PROJECT_ID, MILESTONE_ID, input)).toEqual({ error: { code: "save_failed" } });
    expect(consoleError).toHaveBeenCalledWith("updateKpiScores failed", { ...DB_PAYLOAD, ...ids });
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("a write that matched no row warns no_rows and returns not_found", async () => {
    const client = queryClient({ data: [], error: null, status: 200 });
    expect(await updateKpiScores(client, PROJECT_ID, MILESTONE_ID, input, { requestId: "ray-1" })).toEqual({
      error: { code: "not_found" },
    });
    expect(consoleWarn).toHaveBeenCalledWith("updateKpiScores failed", {
      code: "no_rows",
      ...ids,
      requestId: "ray-1",
      mappedTo: "not_found",
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("a matched row logs nothing", async () => {
    const client = queryClient({ data: [{ id: MILESTONE_ID }], error: null, status: 200 });
    expect(await updateKpiScores(client, PROJECT_ID, MILESTONE_ID, input)).toEqual({});
    expect(consoleWarn).not.toHaveBeenCalled();
  });
});
