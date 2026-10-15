import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  createJobRole,
  getBonusSettings,
  listJobRoles,
  setJobRoleArchived,
  settingsErrorMessage,
  updateJobRole,
  updateKpiSettings,
  updateRatingFactors,
  type JobRoleInput,
  type KpiSettingsInput,
  type RatingFactorsInput,
} from "@/lib/services/bonus-config";

// Oracle: the code-in-URL contract (bonus-config.ts header) — a known code renders its catalog text
// in the request's locale with the field label of that locale; anything else renders the localized
// generic message. Load failures return the code "load_failed" and a missing settings row
// "settings_missing", never text. Log levels and payloads: context/changes/log-mapped-errors/plan.md
// (Levels, Phase 2) — 23514 and 0-row writes warn with mappedTo, 23505 is silent, anything else
// (42501 included: it is unmapped here) is an error.

const JOB_ROLE_ID = "00000000-0000-4000-8000-000000000005";

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
    expect(consoleError).toHaveBeenCalledWith("listJobRoles failed", DB_PAYLOAD);
  });

  it("getBonusSettings returns the load_failed code on a database error", async () => {
    expect(await getBonusSettings(failing(), { userId: "u-1" })).toEqual({ error: "load_failed" });
    expect(consoleError).toHaveBeenCalledWith("getBonusSettings failed", { ...DB_PAYLOAD, userId: "u-1" });
  });

  it("getBonusSettings returns settings_missing when the singleton row is absent", async () => {
    expect(await getBonusSettings(queryClient({ data: null, error: null }))).toEqual({ error: "settings_missing" });
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("write errors", () => {
  const role = {} as JobRoleInput;
  const writes = {
    createJobRole: (client: SupabaseClient) => createJobRole(client, role, { userId: "u-1" }),
    updateJobRole: (client: SupabaseClient) => updateJobRole(client, JOB_ROLE_ID, role, { userId: "u-1" }),
    setJobRoleArchived: (client: SupabaseClient) => setJobRoleArchived(client, JOB_ROLE_ID, true, { userId: "u-1" }),
    updateKpiSettings: (client: SupabaseClient) => updateKpiSettings(client, {} as KpiSettingsInput, { userId: "u-1" }),
    updateRatingFactors: (client: SupabaseClient) =>
      updateRatingFactors(client, {} as RatingFactorsInput, { userId: "u-1" }),
  };
  const idsOf = {
    createJobRole: {},
    updateJobRole: { jobRoleId: JOB_ROLE_ID },
    setJobRoleArchived: { jobRoleId: JOB_ROLE_ID },
    updateKpiSettings: {},
    updateRatingFactors: {},
  };
  const operations = Object.keys(writes) as (keyof typeof writes)[];

  it.each(operations)("%s: 23514 warns with mappedTo rule_violation", async (operation) => {
    expect(await writes[operation](rejecting("23514"))).toEqual({ error: { code: "rule_violation" } });
    expect(consoleWarn).toHaveBeenCalledWith(`${operation} failed`, {
      code: "23514",
      status: 400,
      message: "rejected 23514",
      ...idsOf[operation],
      userId: "u-1",
      mappedTo: "rule_violation",
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

  it("42501 is unmapped here: save_failed, logged at error level", async () => {
    expect(await writes.updateJobRole(rejecting("42501", 403))).toEqual({ error: { code: "save_failed" } });
    expect(consoleError).toHaveBeenCalledWith("updateJobRole failed", {
      code: "42501",
      status: 403,
      message: "rejected 42501",
      jobRoleId: JOB_ROLE_ID,
      userId: "u-1",
    });
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("23505 is a domain rejection: duplicate_name, nothing logged", async () => {
    expect(await writes.createJobRole(rejecting("23505", 409))).toEqual({ error: { code: "duplicate_name" } });
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it.each(["updateJobRole", "setJobRoleArchived", "updateKpiSettings", "updateRatingFactors"] as const)(
    "%s: a write that matched no row warns no_rows and returns not_found",
    async (operation) => {
      expect(await writes[operation](noRows())).toEqual({ error: { code: "not_found" } });
      expect(consoleWarn).toHaveBeenCalledWith(`${operation} failed`, {
        code: "no_rows",
        ...idsOf[operation],
        userId: "u-1",
        mappedTo: "not_found",
      });
      expect(consoleError).not.toHaveBeenCalled();
    },
  );

  it.each(["updateJobRole", "setJobRoleArchived", "updateKpiSettings", "updateRatingFactors"] as const)(
    "%s: a matched row succeeds and logs nothing",
    async (operation) => {
      const client = queryClient({ data: [{ id: JOB_ROLE_ID }], error: null, status: 200 });
      expect(await writes[operation](client)).toEqual({});
      expect(consoleWarn).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    },
  );
});
