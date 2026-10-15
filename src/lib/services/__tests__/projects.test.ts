import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { getProject, listProjects, listSupervisors, projectsErrorMessage } from "@/lib/services/projects";

// Oracle: the code-in-URL contract (projects.ts header) — a known code renders its catalog text in
// the request's locale with the field label of that locale; anything else renders the localized
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

const failing = () => queryClient({ data: null, error: { code: "XX000", message: "boom" } });

let consoleError: MockInstance;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("projectsErrorMessage", () => {
  it.each([
    ["en", "required", "total_budget", "Total budget is required"],
    ["pl", "required", "total_budget", "Pole „Budżet całkowity” jest wymagane"],
    ["en", "invalid_date", "end_date", "End date must be a valid date"],
    ["pl", "invalid_date", "end_date", "Pole „Data zakończenia” musi zawierać prawidłową datę"],
    ["en", "duplicate_name", null, "This name is already in use"],
    ["pl", "duplicate_name", null, "Ta nazwa jest już zajęta"],
  ] as const)("%s %s (%s)", (locale, code, field, expected) => {
    expect(projectsErrorMessage(code, field, locale)).toBe(expected);
  });

  it.each([
    ["en", "Value is required"],
    ["pl", "Pole „Wartość” jest wymagane"],
  ] as const)("uses the localized fallback label for an unknown field (%s)", (locale, expected) => {
    expect(projectsErrorMessage("required", "toString", locale)).toBe(expected);
    expect(projectsErrorMessage("required", null, locale)).toBe(expected);
  });

  it.each(["boom", "", "toString", "__proto__"])("falls back to the localized generic message for %j", (code) => {
    expect(projectsErrorMessage(code, null, "en")).toBe("Something went wrong. Please try again.");
    expect(projectsErrorMessage(code, null, "pl")).toBe("Coś poszło nie tak. Spróbuj ponownie.");
  });
});

describe("load errors", () => {
  it("listProjects returns the load_failed code, never text", async () => {
    expect(await listProjects(failing())).toEqual({ error: "load_failed" });
    expect(consoleError).toHaveBeenCalledWith("listProjects failed", { code: "XX000", message: "boom" });
  });

  it("getProject returns the load_failed code", async () => {
    expect(await getProject(failing(), "00000000-0000-4000-8000-000000000001")).toEqual({ error: "load_failed" });
  });

  it("listSupervisors returns the load_failed code", async () => {
    expect(await listSupervisors(failing())).toEqual({ error: "load_failed" });
  });
});
