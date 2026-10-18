import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  getPayoutSummary,
  listApprovedResults,
  listPayoutSummaries,
  listVisibleMilestones,
} from "@/lib/services/dashboard";
import type { DashboardMilestone } from "@/types";

// Oracle: context/changes/new-dashboard-view/plan.md, Phase 3 §2 and "Critical Implementation
// Details". Reads run under RLS with the caller's client and follow the ServiceResult +
// mapLoadError pattern (load_failed code, `${operation} failed` logged with status and ids). The
// milestone list embeds the project's name and status; the approved results are read in the
// [fromIso, toIso) window; the summary RPC is called alone (no lines), only for scored,
// unapproved, non-cancelled milestones of open projects, and one failed summary only drops its row.

const MILESTONE_ID = "00000000-0000-4000-8000-000000000003";
const DB_PAYLOAD = { code: "XX000", status: 500, message: "boom" };

type Call = [string, unknown[]];

/** A client whose every query resolves to `result`, recording each builder call in `calls`. */
function recordingClient(result: { data: unknown; error: unknown; status?: number }, calls: Call[] = []) {
  const builder: object = new Proxy(
    {},
    {
      get: (_target, prop) =>
        prop === "then"
          ? (resolve: (value: typeof result) => void) => {
              resolve(result);
            }
          : (...args: unknown[]) => {
              calls.push([String(prop), args]);
              return builder;
            },
    },
  );
  const entry =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, args]);
      return builder;
    };
  return { client: { from: entry("from"), rpc: entry("rpc") } as unknown as SupabaseClient, calls };
}

const failing = () => recordingClient({ data: null, error: { code: "XX000", message: "boom" }, status: 500 });

let consoleError: MockInstance;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listVisibleMilestones", () => {
  it("returns load_failed and logs the operation with the log context", async () => {
    const { client } = failing();
    expect(await listVisibleMilestones(client, { userId: "u-1" })).toEqual({ error: "load_failed" });
    expect(consoleError).toHaveBeenCalledWith("listVisibleMilestones failed", { ...DB_PAYLOAD, userId: "u-1" });
  });

  it("selects the milestone and KPI columns with the project embed, and flattens the embed", async () => {
    const row = {
      id: MILESTONE_ID,
      project_id: "p-1",
      name: "M1",
      start_date: "2026-01-01",
      end_date: "2026-03-31",
      status: "active",
      target_pool: "12000.50",
      notes: null,
      kpi_schedule: 80,
      kpi_budget: 70,
      kpi_quality: 90,
      kpi_risk: 60,
      projects: { name: "Alpha", status: "planned" },
    };
    const { client, calls } = recordingClient({ data: [row], error: null, status: 200 });

    const result = await listVisibleMilestones(client);

    expect(result).toEqual({
      data: [
        {
          id: MILESTONE_ID,
          project_id: "p-1",
          name: "M1",
          start_date: "2026-01-01",
          end_date: "2026-03-31",
          status: "active",
          target_pool: 12000.5,
          notes: null,
          kpi_schedule: 80,
          kpi_budget: 70,
          kpi_quality: 90,
          kpi_risk: 60,
          project_name: "Alpha",
          project_status: "planned",
        },
      ],
    });
    expect(calls[0]).toEqual(["from", ["milestones"]]);
    const select = calls.find(([name]) => name === "select");
    expect(select?.[1][0]).toBe(
      "id, project_id, name, start_date, end_date, status, target_pool, notes, kpi_schedule, kpi_budget, kpi_quality, kpi_risk, projects!inner(name, status)",
    );
    expect(calls.some(([name]) => name === "eq")).toBe(false);
  });
});

describe("getPayoutSummary", () => {
  it("returns load_failed and logs the milestone id", async () => {
    const { client } = failing();
    expect(await getPayoutSummary(client, MILESTONE_ID, { userId: "u-1" })).toEqual({ error: "load_failed" });
    expect(consoleError).toHaveBeenCalledWith("getPayoutSummary failed", {
      ...DB_PAYLOAD,
      milestoneId: MILESTONE_ID,
      userId: "u-1",
    });
  });

  it("calls only the summary RPC and maps its numerics", async () => {
    const row = {
      milestone_id: MILESTONE_ID,
      target_pool: "10000.00",
      kpi_schedule: 80,
      kpi_budget: 70,
      kpi_quality: 90,
      kpi_risk: 60,
      scored: true,
      multiplier: "1.1875",
      budget_share: "0.95",
      payout_pool: "9500.00",
      payout_total: "9499.99",
      residual: "0.01",
      within_pool: true,
      engagement_count: "3",
    };
    const { client, calls } = recordingClient({ data: [row], error: null, status: 200 });

    expect(await getPayoutSummary(client, MILESTONE_ID)).toEqual({
      data: {
        milestone_id: MILESTONE_ID,
        target_pool: 10000,
        kpi_schedule: 80,
        kpi_budget: 70,
        kpi_quality: 90,
        kpi_risk: 60,
        scored: true,
        multiplier: 1.1875,
        budget_share: 0.95,
        payout_pool: 9500,
        payout_total: 9499.99,
        residual: 0.01,
        within_pool: true,
        engagement_count: 3,
      },
    });
    expect(calls).toEqual([["rpc", ["milestone_payout_summary", { p_milestone_id: MILESTONE_ID }]]]);
  });

  it("returns null when the milestone is not visible", async () => {
    const { client } = recordingClient({ data: [], error: null, status: 200 });
    expect(await getPayoutSummary(client, MILESTONE_ID)).toEqual({ data: null });
  });
});

describe("listApprovedResults", () => {
  const window = { fromIso: "2025-12-31T23:00:00.000Z", toIso: "2026-12-31T23:00:00.000Z" };

  it("returns load_failed and logs the operation", async () => {
    const { client } = failing();
    expect(await listApprovedResults(client, window, { requestId: "ray-1" })).toEqual({ error: "load_failed" });
    expect(consoleError).toHaveBeenCalledWith("listApprovedResults failed", { ...DB_PAYLOAD, requestId: "ray-1" });
  });

  it("reads the snapshot columns inside the half-open window and maps numerics", async () => {
    const row = {
      milestone_id: MILESTONE_ID,
      multiplier: "0.9",
      multiplier_max: "1.25",
      payout_total: "1234.56",
      approved_at: "2026-05-01T10:00:00+00:00",
    };
    const { client, calls } = recordingClient({ data: [row], error: null, status: 200 });

    expect(await listApprovedResults(client, window)).toEqual({
      data: [
        {
          milestone_id: MILESTONE_ID,
          multiplier: 0.9,
          multiplier_max: 1.25,
          payout_total: 1234.56,
          approved_at: "2026-05-01T10:00:00+00:00",
        },
      ],
    });
    expect(calls).toContainEqual(["from", ["milestone_results"]]);
    expect(calls).toContainEqual(["select", ["milestone_id, multiplier, multiplier_max, payout_total, approved_at"]]);
    expect(calls).toContainEqual(["gte", ["approved_at", window.fromIso]]);
    expect(calls).toContainEqual(["lt", ["approved_at", window.toIso]]);
  });
});

describe("listPayoutSummaries", () => {
  function milestone(id: string, overrides: Partial<DashboardMilestone> = {}): DashboardMilestone {
    return {
      id,
      project_id: "p-1",
      name: id,
      start_date: "2026-01-01",
      end_date: "2026-03-31",
      status: "active",
      target_pool: 1000,
      notes: null,
      kpi_schedule: 80,
      kpi_budget: 70,
      kpi_quality: 90,
      kpi_risk: 60,
      project_name: "Alpha",
      project_status: "active",
      ...overrides,
    };
  }

  const summaryRow = (id: string) => ({
    milestone_id: id,
    target_pool: "1000",
    kpi_schedule: 80,
    kpi_budget: 70,
    kpi_quality: 90,
    kpi_risk: 60,
    scored: true,
    multiplier: "1",
    budget_share: "0.8",
    payout_pool: "800",
    payout_total: "800",
    residual: "0",
    within_pool: true,
    engagement_count: "1",
  });

  /** RPC results per milestone id: "fail" errors, "hidden" returns no row, otherwise a summary row. */
  function perMilestoneClient(outcomes: Record<string, "ok" | "fail" | "hidden">) {
    const requested: string[] = [];
    const client = {
      rpc: (name: string, args: { p_milestone_id: string }) => {
        requested.push(`${name}:${args.p_milestone_id}`);
        const outcome = outcomes[args.p_milestone_id];
        const { client: inner } =
          outcome === "fail"
            ? failing()
            : recordingClient({
                data: outcome === "hidden" ? [] : [summaryRow(args.p_milestone_id)],
                error: null,
                status: 200,
              });
        return inner.rpc(name, args);
      },
    } as unknown as SupabaseClient;
    return { client, requested };
  }

  it("returns an empty map and calls nothing for no milestones", async () => {
    const { client, requested } = perMilestoneClient({});
    expect(await listPayoutSummaries(client, [])).toEqual(new Map());
    expect(requested).toEqual([]);
  });

  it("calls the summary RPC only for scored, unapproved, non-cancelled milestones of open projects", async () => {
    const { client, requested } = perMilestoneClient({ a: "ok", b: "ok" });
    const summaries = await listPayoutSummaries(client, [
      milestone("a"),
      milestone("unscored", { kpi_schedule: null, kpi_budget: null, kpi_quality: null, kpi_risk: null }),
      milestone("approved", { status: "approved" }),
      milestone("cancelled", { status: "cancelled" }),
      milestone("closed", { project_status: "completed" }),
      milestone("b", { status: "completed", project_status: "planned" }),
    ]);

    expect(requested).toEqual(["milestone_payout_summary:a", "milestone_payout_summary:b"]);
    expect([...summaries.keys()]).toEqual(["a", "b"]);
    expect(summaries.get("a")).toMatchObject({ milestone_id: "a", engagement_count: 1, multiplier: 1 });
  });

  it("drops only a failed or invisible summary and logs the failure", async () => {
    const { client } = perMilestoneClient({ a: "ok", b: "fail", c: "hidden" });
    const summaries = await listPayoutSummaries(client, [milestone("a"), milestone("b"), milestone("c")], {
      userId: "u-1",
    });

    expect([...summaries.keys()]).toEqual(["a"]);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith("getPayoutSummary failed", {
      ...DB_PAYLOAD,
      milestoneId: "b",
      userId: "u-1",
    });
  });
});
