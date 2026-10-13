import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { employeesErrorMessage, getEmployeeDetail, listEmployees, listOpenAssignments } from "@/lib/services/employees";

// Oracle: the code-in-URL contract (employees.ts header) — a known code renders its catalog text in
// the request's locale with the field label of that locale; anything else renders the localized
// generic message. Load failures return the code "load_failed", never text.

const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000002";

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
    expect(consoleError).toHaveBeenCalledWith("listEmployees failed", { code: "XX000", message: "boom" });
  });

  it("getEmployeeDetail returns the load_failed code", async () => {
    expect(await getEmployeeDetail(failing(), EMPLOYEE_ID)).toEqual({ error: "load_failed" });
  });

  it("listOpenAssignments returns the load_failed code", async () => {
    expect(await listOpenAssignments(failing(), EMPLOYEE_ID)).toEqual({ error: "load_failed" });
  });
});
