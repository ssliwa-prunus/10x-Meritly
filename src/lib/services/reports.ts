import type { SupabaseClient } from "@supabase/supabase-js";
import { logError, mapLoadError, type LogContext } from "@/lib/error-log";
import type { BonusReportFilter, BonusReportRow, LoadErrorCode } from "@/types";

// ---------------------------------------------------------------------------
// Data access for the aggregate bonus report. Always called with the request-scoped client (the
// signed-in user's JWT), never the service role: bonus_report is security invoker, so RLS decides
// the scope (a Supervisor's own milestones, every milestone for an Admin). The sums were computed
// in SQL; numerics may arrive as strings and are converted with Number() for display only.
// ---------------------------------------------------------------------------

export interface ServiceResult<T = undefined> {
  data?: T;
  error?: LoadErrorCode;
}

type Numeric = number | string;

interface BonusReportRpcRow {
  employee_id: string;
  employee_name: string;
  milestone_count: Numeric;
  total_bonus: Numeric;
}

/**
 * Approved bonuses per employee, optionally limited to an approval-date range (Europe/Warsaw day,
 * inclusive; a null bound is unbounded). Rows come in employee-name order from the function.
 * `filter` must already be validated (parseBonusReportFilter).
 */
export async function getBonusReport(
  supabase: SupabaseClient,
  filter: BonusReportFilter,
  log?: LogContext,
): Promise<ServiceResult<BonusReportRow[]>> {
  // count: "exact" makes a truncated result detectable: PostgREST caps every response at max_rows
  // (supabase/config.toml), and a silently shortened payroll report would be wrong, not just short.
  const result = await supabase.rpc("bonus_report", { p_from: filter.from, p_to: filter.to }, { count: "exact" });
  if (result.error) return { error: mapLoadError("getBonusReport", result.error, { status: result.status, log }) };

  // The function returns SETOF rows. On the untyped client overrideTypes<Row[]> rejects RPC results
  // as "single object", so the row shape is asserted here instead.
  const rows = (result.data ?? []) as BonusReportRpcRow[];
  if (result.count !== null && result.count > rows.length) {
    // A truncated report must be visible in Workers logs.
    const message = `${rows.length} of ${result.count} rows returned`;
    logError("error", "getBonusReport", { code: "truncated", message }, { status: result.status, log });
    return { error: "load_failed" };
  }
  return {
    data: rows.map((row) => ({
      employee_id: row.employee_id,
      employee_name: row.employee_name,
      milestone_count: Number(row.milestone_count),
      total_bonus: Number(row.total_bonus),
    })),
  };
}
