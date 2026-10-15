import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  engagementsErrorMessage,
  isMilestoneInProject,
  listAssignableEmployees,
  listEngagements,
} from "@/lib/services/engagements";

// Oracle: the code-in-URL contract (engagements.ts header) — a known code renders its catalog text
// in the request's locale with the field label of that locale; anything else renders the localized
// generic message. Load failures return the code "load_failed", never text.

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const MILESTONE_ID = "00000000-0000-4000-8000-000000000003";

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
    expect(consoleError).toHaveBeenCalledWith("listEngagements failed", { code: "XX000", message: "boom" });
  });

  it("listAssignableEmployees returns the load_failed code", async () => {
    expect(await listAssignableEmployees(failing(), PROJECT_ID, MILESTONE_ID)).toEqual({ error: "load_failed" });
  });

  it("isMilestoneInProject returns the load_failed code", async () => {
    expect(await isMilestoneInProject(failing(), PROJECT_ID, MILESTONE_ID)).toEqual({ error: "load_failed" });
  });
});
