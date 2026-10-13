import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { getBonusSettings, listJobRoles, settingsErrorMessage } from "@/lib/services/bonus-config";

// Oracle: the code-in-URL contract (bonus-config.ts header) — a known code renders its catalog text
// in the request's locale with the field label of that locale; anything else renders the localized
// generic message. Load failures return the code "load_failed" and a missing settings row
// "settings_missing", never text.

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

const failing = () => queryClient({ data: null, error: { code: "XX000", message: "boom" } });

let consoleError: MockInstance;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("settingsErrorMessage", () => {
  it.each([
    ["en", "positive_up_to_three", "multiplier_max", "Maximum multiplier must be greater than 0 and at most 3"],
    [
      "pl",
      "positive_up_to_three",
      "multiplier_max",
      "Pole „Maksymalny mnożnik” musi być większe od 0 i nie większe niż 3",
    ],
    ["en", "kpi_weight_range", "kpi_weight_quality", "Jakość weight must be between 0 and 1"],
    ["pl", "kpi_weight_range", "kpi_weight_quality", "Pole „Waga KPI Jakość” musi mieścić się w przedziale od 0 do 1"],
    ["en", "kpi_sum", null, "KPI weights must sum to 1.00"],
    ["pl", "kpi_sum", null, "Wagi KPI muszą sumować się do 1.00"],
  ] as const)("%s %s (%s)", (locale, code, field, expected) => {
    expect(settingsErrorMessage(code, field, locale)).toBe(expected);
  });

  it.each([
    ["en", "Value must be a number"],
    ["pl", "Pole „Wartość” musi być liczbą"],
  ] as const)("uses the localized fallback label for an unknown field (%s)", (locale, expected) => {
    expect(settingsErrorMessage("not_a_number", "toString", locale)).toBe(expected);
    expect(settingsErrorMessage("not_a_number", null, locale)).toBe(expected);
  });

  it.each(["boom", "", "toString", "__proto__"])("falls back to the localized generic message for %j", (code) => {
    expect(settingsErrorMessage(code, null, "en")).toBe("Something went wrong. Please try again.");
    expect(settingsErrorMessage(code, null, "pl")).toBe("Coś poszło nie tak. Spróbuj ponownie.");
  });
});

describe("load errors", () => {
  it("listJobRoles returns the load_failed code, never text", async () => {
    expect(await listJobRoles(failing())).toEqual({ error: "load_failed" });
    expect(consoleError).toHaveBeenCalledWith("listJobRoles failed", { code: "XX000", message: "boom" });
  });

  it("getBonusSettings returns the load_failed code on a database error", async () => {
    expect(await getBonusSettings(failing())).toEqual({ error: "load_failed" });
  });

  it("getBonusSettings returns settings_missing when the singleton row is absent", async () => {
    expect(await getBonusSettings(queryClient({ data: null, error: null }))).toEqual({ error: "settings_missing" });
    expect(consoleError).not.toHaveBeenCalled();
  });
});
