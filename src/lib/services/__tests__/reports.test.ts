import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { getBonusReport } from "@/lib/services/reports";

// Oracle: the aggregate-bonus-report plan (Phase 2, Service) and the bonus_report function
// (supabase/migrations/20261015120000_bonus_report.sql): one rpc call with p_from/p_to (null =
// unbounded), numeric columns normalised with Number(), any database error logged and mapped to
// load_failed. No network: rpc is faked with what supabase-js resolves to.

function fakeClient(result: { data: unknown; error: unknown; count?: number | null; status?: number }) {
  const rpc = vi.fn().mockResolvedValue({ count: null, ...result });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
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

describe("getBonusReport", () => {
  it("passes null bounds through", async () => {
    const { client, rpc } = fakeClient({ data: [], error: null });
    await getBonusReport(client, { from: null, to: null });
    expect(rpc).toHaveBeenCalledWith("bonus_report", { p_from: null, p_to: null }, { count: "exact" });
  });

  it("passes the bounds as p_from and p_to", async () => {
    const { client, rpc } = fakeClient({ data: [], error: null });
    await getBonusReport(client, { from: "2026-01-01", to: "2026-03-31" });
    expect(rpc).toHaveBeenCalledWith("bonus_report", { p_from: "2026-01-01", p_to: "2026-03-31" }, { count: "exact" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("maps numeric strings to numbers and keeps the order", async () => {
    const { client } = fakeClient({
      data: [
        { employee_id: "e-1", employee_name: "Anna", milestone_count: "2", total_bonus: "1234.50" },
        { employee_id: "e-2", employee_name: "Bartek", milestone_count: 1, total_bonus: 0 },
      ],
      error: null,
    });
    expect(await getBonusReport(client, { from: null, to: null })).toEqual({
      data: [
        { employee_id: "e-1", employee_name: "Anna", milestone_count: 2, total_bonus: 1234.5 },
        { employee_id: "e-2", employee_name: "Bartek", milestone_count: 1, total_bonus: 0 },
      ],
    });
  });

  it("null data: empty list", async () => {
    const { client } = fakeClient({ data: null, error: null });
    expect(await getBonusReport(client, { from: null, to: null })).toEqual({ data: [] });
  });

  // PostgREST caps responses at max_rows (supabase/config.toml); a capped report must fail loudly.
  it("truncated result (count above the rows received): load_failed, logged", async () => {
    const row = { employee_id: "e-1", employee_name: "Anna", milestone_count: 1, total_bonus: "1.00" };
    const { client } = fakeClient({
      data: Array.from({ length: 1000 }, () => row),
      error: null,
      count: 1001,
      status: 206,
    });
    expect(await getBonusReport(client, { from: null, to: null }, { userId: "u-1" })).toEqual({ error: "load_failed" });
    expect(consoleError).toHaveBeenCalledWith("getBonusReport failed", {
      code: "truncated",
      status: 206,
      message: "1000 of 1001 rows returned",
      userId: "u-1",
    });
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("complete result (count equals the rows received): data", async () => {
    const { client } = fakeClient({
      data: [{ employee_id: "e-1", employee_name: "Anna", milestone_count: 1, total_bonus: "1.00" }],
      error: null,
      count: 1,
    });
    expect(await getBonusReport(client, { from: null, to: null })).toEqual({
      data: [{ employee_id: "e-1", employee_name: "Anna", milestone_count: 1, total_bonus: 1 }],
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("database error: load_failed, logged with code and message", async () => {
    const { client } = fakeClient({
      data: null,
      error: { code: "XX000", message: "boom", details: "", hint: "" },
      status: 500,
    });
    expect(await getBonusReport(client, { from: null, to: null }, { requestId: "ray-1" })).toEqual({
      error: "load_failed",
    });
    expect(consoleError).toHaveBeenCalledWith("getBonusReport failed", {
      code: "XX000",
      status: 500,
      message: "boom",
      requestId: "ray-1",
    });
  });
});
