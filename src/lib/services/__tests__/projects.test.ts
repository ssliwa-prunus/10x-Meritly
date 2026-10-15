import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  createMilestone,
  createProject,
  getProject,
  getProjectExposure,
  listMilestones,
  listProjectExposure,
  listProjects,
  listSupervisors,
  projectsErrorMessage,
  updateMilestone,
  updateProject,
  type MilestoneInput,
  type ProjectInput,
} from "@/lib/services/projects";

// Oracle: the code-in-URL contract (projects.ts header) — a known code renders its catalog text in
// the request's locale with the field label of that locale; anything else renders the localized
// generic message. Load failures return the code "load_failed", never text. Log levels and payloads:
// context/changes/log-mapped-errors/plan.md (Levels, Phase 2) — 23514/42501/MR014 and 0-row writes
// warn with mappedTo, 23505 and the other guard codes are silent, anything else is an error.

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

const failing = () => queryClient({ data: null, error: { code: "XX000", message: "boom" }, status: 500 });

const rejecting = (code: string, status = 400) =>
  queryClient({ data: null, error: { code, message: `rejected ${code}` }, status });

const noRows = () => queryClient({ data: [], error: null, status: 200 });

const projectInput = {} as ProjectInput;
const milestoneInput = {} as MilestoneInput;

let consoleError: MockInstance;
let consoleWarn: MockInstance;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
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
    expect(consoleError).toHaveBeenCalledWith("listProjects failed", { code: "XX000", status: 500, message: "boom" });
  });

  it.each([
    ["getProject", () => getProject(failing(), PROJECT_ID), { projectId: PROJECT_ID }],
    ["listMilestones", () => listMilestones(failing(), PROJECT_ID), { projectId: PROJECT_ID }],
    ["listProjectExposure", () => listProjectExposure(failing()), {}],
    ["getProjectExposure", () => getProjectExposure(failing(), PROJECT_ID), { projectId: PROJECT_ID }],
    ["listSupervisors", () => listSupervisors(failing()), {}],
  ])("%s returns the load_failed code and logs status and ids", async (operation, load, ids) => {
    expect(await load()).toEqual({ error: "load_failed" });
    expect(consoleError).toHaveBeenCalledWith(`${operation} failed`, {
      code: "XX000",
      status: 500,
      message: "boom",
      ...ids,
    });
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("adds a passed log context to the payload", async () => {
    await getProject(failing(), PROJECT_ID, { userId: "u-1", requestId: "ray-1" });
    expect(consoleError).toHaveBeenCalledWith("getProject failed", {
      code: "XX000",
      status: 500,
      message: "boom",
      projectId: PROJECT_ID,
      userId: "u-1",
      requestId: "ray-1",
    });
  });
});

describe("write errors", () => {
  const writes = {
    createProject: (client: SupabaseClient) => createProject(client, projectInput, { userId: "u-1" }),
    updateProject: (client: SupabaseClient) => updateProject(client, PROJECT_ID, projectInput, { userId: "u-1" }),
    createMilestone: (client: SupabaseClient) => createMilestone(client, PROJECT_ID, milestoneInput, { userId: "u-1" }),
    updateMilestone: (client: SupabaseClient) =>
      updateMilestone(client, PROJECT_ID, MILESTONE_ID, milestoneInput, { userId: "u-1" }),
  };
  const idsOf = {
    createProject: {},
    updateProject: { projectId: PROJECT_ID },
    createMilestone: { projectId: PROJECT_ID },
    updateMilestone: { projectId: PROJECT_ID, milestoneId: MILESTONE_ID },
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
      code: "XX000",
      status: 500,
      message: "boom",
      ...idsOf[operation],
      userId: "u-1",
    });
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("23514 warns with mappedTo rule_violation", async () => {
    expect(await writes.createProject(rejecting("23514"))).toEqual({ error: { code: "rule_violation" } });
    expect(consoleWarn).toHaveBeenCalledWith("createProject failed", {
      code: "23514",
      status: 400,
      message: "rejected 23514",
      userId: "u-1",
      mappedTo: "rule_violation",
    });
  });

  it("MR014 warns with mappedTo invalid_status", async () => {
    expect(await writes.updateMilestone(rejecting("MR014"))).toEqual({ error: { code: "invalid_status" } });
    expect(consoleWarn).toHaveBeenCalledWith("updateMilestone failed", {
      code: "MR014",
      status: 400,
      message: "rejected MR014",
      projectId: PROJECT_ID,
      milestoneId: MILESTONE_ID,
      userId: "u-1",
      mappedTo: "invalid_status",
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it.each([
    ["23505", { code: "duplicate_name" }],
    ["MR001", { code: "owner_not_supervisor" }],
    ["MR003", { code: "project_closed" }],
    ["MR015", { code: "milestone_approved" }],
  ])("%s is a domain rejection: same code, nothing logged", async (code, expected) => {
    expect(await writes.updateMilestone(rejecting(code, 409))).toEqual({ error: expected });
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it.each(["updateProject", "createMilestone", "updateMilestone"] as const)(
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

  it.each(["updateProject", "createMilestone", "updateMilestone"] as const)(
    "%s: a matched row succeeds and logs nothing",
    async (operation) => {
      expect(await writes[operation](queryClient({ data: [{ id: PROJECT_ID }], error: null }))).toEqual({});
      expect(consoleWarn).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    },
  );
});
