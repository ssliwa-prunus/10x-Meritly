import type { SupabaseClient } from "@supabase/supabase-js";
import { needsPayoutSummary } from "@/lib/dashboard";
import { mapLoadError, type LogContext } from "@/lib/error-log";
import { toSummary, type PayoutSummaryRow } from "@/lib/services/payouts";
import { MILESTONE_COLUMNS, type ServiceResult } from "@/lib/services/projects";
import type { DashboardApprovedResult, DashboardMilestone, MilestonePayoutSummary, WorkStatus } from "@/types";

// ---------------------------------------------------------------------------
// Dashboard reads (context/changes/new-dashboard-view/plan.md, Phase 3). Always called with the
// request-scoped client (the signed-in user's JWT), never the service role, so RLS decides the
// scope: own projects for a Supervisor, everything for an Admin. Numerics may arrive as strings
// and are converted with Number(); the figures themselves come from src/lib/dashboard.ts.
// ---------------------------------------------------------------------------

type Numeric = number | string;

interface DashboardMilestoneRow {
  id: string;
  project_id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: DashboardMilestone["status"];
  target_pool: Numeric;
  notes: string | null;
  kpi_schedule: number | null;
  kpi_budget: number | null;
  kpi_quality: number | null;
  kpi_risk: number | null;
  projects: { name: string; status: WorkStatus };
}

interface ApprovedResultRow {
  milestone_id: string;
  multiplier: Numeric;
  multiplier_max: Numeric;
  payout_total: Numeric;
  approved_at: string;
}

// `!inner`: a milestone whose project the caller cannot read is left out rather than listed without a project.
const DASHBOARD_MILESTONE_COLUMNS = `${MILESTONE_COLUMNS}, kpi_schedule, kpi_budget, kpi_quality, kpi_risk, projects!inner(name, status)`;

const APPROVED_RESULT_COLUMNS = "milestone_id, multiplier, multiplier_max, payout_total, approved_at";

const toDashboardMilestone = ({ projects, ...row }: DashboardMilestoneRow): DashboardMilestone => ({
  ...row,
  target_pool: Number(row.target_pool),
  project_name: projects.name,
  project_status: projects.status,
});

const toApprovedResult = (row: ApprovedResultRow): DashboardApprovedResult => ({
  milestone_id: row.milestone_id,
  multiplier: Number(row.multiplier),
  multiplier_max: Number(row.multiplier_max),
  payout_total: Number(row.payout_total),
  approved_at: row.approved_at,
});

/** Every visible milestone across projects, with its KPI scores and its project's name and status. */
export async function listVisibleMilestones(
  supabase: SupabaseClient,
  log?: LogContext,
): Promise<ServiceResult<DashboardMilestone[]>> {
  const { data, error, status } = await supabase
    .from("milestones")
    .select(DASHBOARD_MILESTONE_COLUMNS)
    .order("start_date", { ascending: true })
    .order("name", { ascending: true })
    .overrideTypes<DashboardMilestoneRow[], { merge: false }>();

  if (error) return { error: mapLoadError("listVisibleMilestones", error, { status, log }) };
  return { data: data.map(toDashboardMilestone) };
}

/**
 * A milestone's live payout summary only (no lines, unlike getMilestonePayout), or data null when
 * the milestone is not visible. The RPC refuses approved milestones (MR015): call it only for
 * milestones that pass `needsPayoutSummary`.
 */
export async function getPayoutSummary(
  supabase: SupabaseClient,
  milestoneId: string,
  log?: LogContext,
): Promise<ServiceResult<MilestonePayoutSummary | null>> {
  const summary = await supabase.rpc("milestone_payout_summary", { p_milestone_id: milestoneId });
  if (summary.error) {
    const meta = { status: summary.status, ids: { milestoneId }, log };
    return { error: mapLoadError("getPayoutSummary", summary.error, meta) };
  }

  // SETOF rows; on the untyped client the row shape is asserted (see getMilestonePayout).
  const row = ((summary.data ?? []) as PayoutSummaryRow[]).at(0);
  return { data: row ? toSummary(row) : null };
}

/**
 * Live summaries for the milestones that need one (scored, unapproved, non-cancelled, project open),
 * fetched in parallel. A failed summary is logged by getPayoutSummary and only its milestone is
 * missing from the map, as is one that is not visible: that row shows no KPI and is not awaiting.
 */
export async function listPayoutSummaries(
  supabase: SupabaseClient,
  milestones: readonly DashboardMilestone[],
  log?: LogContext,
): Promise<Map<string, MilestonePayoutSummary>> {
  const wanted = milestones.filter(needsPayoutSummary);
  const results = await Promise.all(wanted.map((milestone) => getPayoutSummary(supabase, milestone.id, log)));

  const summaries = new Map<string, MilestonePayoutSummary>();
  results.forEach(({ data }, index) => {
    if (data) summaries.set(wanted[index].id, data);
  });
  return summaries;
}

/**
 * Approved milestone snapshots whose `approved_at` lies in [fromIso, toIso) (the current Warsaw
 * year, from `warsawYearBounds`), newest first. Supervisor/Admin RLS scope.
 */
export async function listApprovedResults(
  supabase: SupabaseClient,
  { fromIso, toIso }: { fromIso: string; toIso: string },
  log?: LogContext,
): Promise<ServiceResult<DashboardApprovedResult[]>> {
  const { data, error, status } = await supabase
    .from("milestone_results")
    .select(APPROVED_RESULT_COLUMNS)
    .gte("approved_at", fromIso)
    .lt("approved_at", toIso)
    .order("approved_at", { ascending: false })
    .overrideTypes<ApprovedResultRow[], { merge: false }>();

  if (error) return { error: mapLoadError("listApprovedResults", error, { status, log }) };
  return { data: data.map(toApprovedResult) };
}
