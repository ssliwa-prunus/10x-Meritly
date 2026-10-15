import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { getMilestonePayout, kpiErrorMessage } from "@/lib/services/payouts";

// Oracle: the code-in-URL contract (payouts.ts header) — a known code renders its catalog text in
// the request's locale; the KPI names Termin/Budżet/Jakość/Ryzyko are product terms and stay the
// same in both languages (plan, "What We're NOT Doing"); anything else renders the localized
// generic message. Load failures return the code "load_failed", never text.

/** A client whose every query (any chain of builder calls, then awaited) resolves to `result`. */
function queryClient(result: { data: unknown; error: unknown }): SupabaseClient {
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

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
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

describe("load errors", () => {
  it("getMilestonePayout returns the load_failed code, never text", async () => {
    const client = queryClient({ data: null, error: { code: "XX000", message: "boom" } });
    expect(await getMilestonePayout(client, "00000000-0000-4000-8000-000000000003")).toEqual({
      error: "load_failed",
    });
    expect(consoleError).toHaveBeenCalledWith("getMilestonePayoutSummary failed", { code: "XX000", message: "boom" });
  });
});
