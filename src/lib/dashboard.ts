import { groupHistory } from "@/lib/history";
import type {
  AppRole,
  AttentionItems,
  AwaitingMilestone,
  DashboardApprovedResult,
  DashboardKpi,
  DashboardMilestone,
  DashboardMilestoneRow,
  EmployeeListItem,
  EmployeeStats,
  MilestonePayoutSummary,
  MilestoneStatus,
  MyBonusLine,
  Project,
  ProjectExposure,
  ReservedBudget,
  SupervisorStats,
  WorkStatus,
} from "@/types";

// ---------------------------------------------------------------------------
// The dashboard's figures (context/changes/new-dashboard-view/plan.md, Implementation Approach →
// Definitions). Pure, so they are unit- and mutation-tested. The inputs are already scoped by RLS;
// these only filter, order, count and sum them. Money is summed in integer grosze like history.ts.
// ---------------------------------------------------------------------------

/** Money in integer grosze, so sums are exact (0.10 + 0.20 is not 0.30 in floating point). */
const toGrosze = (amount: number) => Math.round(amount * 100);

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const TABLE_LIMIT = 8;

const CLOSED_PROJECT_STATUSES: readonly WorkStatus[] = ["completed", "cancelled"];

/** Approved milestones are frozen and cancelled ones are out; neither can be approved. */
const UNAPPROVABLE_STATUSES: readonly MilestoneStatus[] = ["approved", "cancelled"];

const isOpenProject = (status: WorkStatus) => !CLOSED_PROJECT_STATUSES.includes(status);

/**
 * Warsaw wall-clock time of an instant, as if it were UTC (to the hour). Hour precision is enough: Warsaw has
 * only whole-hour offsets, and the bounds fall on midnight. The formatter is built per call, not at module
 * load, so mutation testing can reach its options.
 */
function warsawWallClock(instant: number): { year: number; asUtc: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) parts[part.type] = part.value;
  const year = Number(parts.year);
  return { year, asUtc: Date.UTC(year, Number(parts.month) - 1, Number(parts.day), Number(parts.hour)) };
}

/** The instant of 1 January 00:00 in Warsaw: midnight UTC minus Warsaw's offset at that moment. */
function warsawNewYear(year: number): number {
  const utcMidnight = Date.UTC(year, 0, 1);
  const offset = warsawWallClock(utcMidnight).asUtc - utcMidnight;
  return utcMidnight - offset;
}

/**
 * The Europe/Warsaw calendar year of `now` and its bounds as ISO instants, for
 * `.gte("approved_at", fromIso).lt("approved_at", toIso)`. 2026-12-31T23:30Z is already 2027.
 */
export function warsawYearBounds(now: Date): { year: number; fromIso: string; toIso: string } {
  const { year } = warsawWallClock(now.getTime());
  return {
    year,
    fromIso: new Date(warsawNewYear(year)).toISOString(),
    toIso: new Date(warsawNewYear(year + 1)).toISOString(),
  };
}

type ScoredFields = Pick<DashboardMilestone, "status" | "kpi_schedule" | "kpi_budget" | "kpi_quality" | "kpi_risk">;

/** All four KPI scores set (the database allows all or none). A score of 0 counts as set. */
const isScored = (milestone: ScoredFields) =>
  milestone.kpi_schedule !== null &&
  milestone.kpi_budget !== null &&
  milestone.kpi_quality !== null &&
  milestone.kpi_risk !== null;

/** Scored, not approved or cancelled, project open: the only milestones whose summary RPC is called. */
function isApprovable(milestone: ScoredFields, projectStatus: WorkStatus): boolean {
  return !UNAPPROVABLE_STATUSES.includes(milestone.status) && isOpenProject(projectStatus) && isScored(milestone);
}

/**
 * Whether the dashboard calls `milestone_payout_summary` for this milestone: scored, unapproved,
 * non-cancelled, project open. Known from the columns, so unscored rows cost no RPC.
 */
export function needsPayoutSummary(milestone: DashboardMilestone): boolean {
  return isApprovable(milestone, milestone.project_status);
}

/**
 * Awaiting approval, mirroring the Approve button: not approved or cancelled, project not completed
 * or cancelled, all four KPI scores set, and the summary shows at least one engagement. A missing
 * summary (not visible, or its RPC failed) is never awaiting.
 */
export function isAwaitingApproval(
  milestone: ScoredFields,
  projectStatus: WorkStatus,
  summary: MilestonePayoutSummary | null,
): boolean {
  return isApprovable(milestone, projectStatus) && summary !== null && summary.engagement_count > 0;
}

const byPeriodThenName = (a: DashboardMilestone, b: DashboardMilestone) =>
  byText(a.start_date, b.start_date) || byText(a.name, b.name);

/** Milestones awaiting approval with the summary that proves it, ordered by start date then name. */
export function awaitingMilestones(
  milestones: readonly DashboardMilestone[],
  summaries: ReadonlyMap<string, MilestonePayoutSummary>,
): AwaitingMilestone[] {
  const awaiting: AwaitingMilestone[] = [];
  for (const milestone of milestones) {
    const summary = summaries.get(milestone.id) ?? null;
    if (summary !== null && isAwaitingApproval(milestone, milestone.project_status, summary)) {
      awaiting.push({ milestone, summary });
    }
  }
  return awaiting.sort((a, b) => byPeriodThenName(a.milestone, b.milestone));
}

/**
 * "Zarezerwowane z budżetu": reserved_total and total_budget summed over projects that are not
 * completed or cancelled. Percent is floored; 0 when the budget sum is 0.
 */
export function reservedBudget(projects: readonly Project[], exposures: readonly ProjectExposure[]): ReservedBudget {
  const open = new Set(projects.filter((project) => isOpenProject(project.status)).map((project) => project.id));
  let reservedGrosze = 0;
  let budgetGrosze = 0;
  for (const exposure of exposures) {
    if (!open.has(exposure.project_id)) continue;
    reservedGrosze += toGrosze(exposure.reserved_total);
    budgetGrosze += toGrosze(exposure.total_budget);
  }
  return {
    reserved: reservedGrosze / 100,
    budget: budgetGrosze / 100,
    percent: budgetGrosze === 0 ? 0 : Math.floor((reservedGrosze * 100) / budgetGrosze),
  };
}

/**
 * The tiles: active projects and milestones (status active), the awaiting count, and the year's
 * paid total and count. `approvedResults` is already limited to the current Warsaw year by
 * `listApprovedResults`.
 */
export function supervisorStats(
  projects: readonly Project[],
  milestones: readonly DashboardMilestone[],
  awaiting: readonly AwaitingMilestone[],
  approvedResults: readonly DashboardApprovedResult[],
): SupervisorStats {
  const paidGrosze = approvedResults.reduce((sum, result) => sum + toGrosze(result.payout_total), 0);
  return {
    active_projects: projects.filter((project) => project.status === "active").length,
    active_milestones: milestones.filter((milestone) => milestone.status === "active").length,
    awaiting: awaiting.length,
    paid_total: paidGrosze / 100,
    paid_count: approvedResults.length,
  };
}

/** Table group order: awaiting, active, planned, other completed, approved. */
const AWAITING_RANK = 0;
const GROUP_RANK: Record<Exclude<WorkStatus, "cancelled">, number> = { active: 1, planned: 2, completed: 3 };
const APPROVED_RANK = 4;

interface RankedRow {
  row: DashboardMilestoneRow;
  rank: number;
}

function liveKpi(summary: MilestonePayoutSummary | null, multiplierMax: number | null): DashboardKpi | null {
  if (summary?.multiplier == null || multiplierMax === null) return null;
  return { multiplier: summary.multiplier, multiplier_max: multiplierMax };
}

/**
 * The milestones table: every non-cancelled milestone of an open project plus this year's
 * approvals (those with a row in `approvedResults`). Ordered awaiting, active, planned, completed,
 * then approved by approval date (newest first); ties by start date, then name. At most 8 rows.
 * KPI: the snapshot for approved rows, the live summary over `multiplierMax` (bonus_settings) for
 * the rest, else null. Action: "approve" only for a supervisor on an awaiting row.
 */
export function dashboardRows(
  milestones: readonly DashboardMilestone[],
  summaries: ReadonlyMap<string, MilestonePayoutSummary>,
  approvedResults: readonly DashboardApprovedResult[],
  role: AppRole,
  multiplierMax: number | null,
): DashboardMilestoneRow[] {
  const results = new Map(approvedResults.map((result) => [result.milestone_id, result]));
  const ranked: RankedRow[] = [];

  for (const milestone of milestones) {
    if (milestone.status === "approved") {
      const result = results.get(milestone.id);
      if (!result) continue;
      ranked.push({
        rank: APPROVED_RANK,
        row: {
          milestone,
          awaiting: false,
          kpi: { multiplier: result.multiplier, multiplier_max: result.multiplier_max },
          action: "results",
          approved_at: result.approved_at,
        },
      });
      continue;
    }
    if (milestone.status === "cancelled" || !isOpenProject(milestone.project_status)) continue;

    const summary = summaries.get(milestone.id) ?? null;
    const awaiting = isAwaitingApproval(milestone, milestone.project_status, summary);
    ranked.push({
      rank: awaiting ? AWAITING_RANK : GROUP_RANK[milestone.status],
      row: {
        milestone,
        awaiting,
        kpi: liveKpi(summary, multiplierMax),
        action: awaiting && role === "supervisor" ? "approve" : "open",
        approved_at: null,
      },
    });
  }

  ranked.sort(
    (a, b) =>
      a.rank - b.rank ||
      byText(b.row.approved_at ?? "", a.row.approved_at ?? "") ||
      byPeriodThenName(a.row.milestone, b.row.milestone),
  );
  return ranked.slice(0, TABLE_LIMIT).map(({ row }) => row);
}

/**
 * "Wymaga uwagi": the awaiting milestones as given, the open (not completed or cancelled) visible projects flagged over budget (in
 * `projects` order) and the employees whose open time share exceeds 100% (in `employees` order).
 */
export function attentionItems(
  awaiting: readonly AwaitingMilestone[],
  exposures: readonly ProjectExposure[],
  projects: readonly Project[],
  employees: readonly EmployeeListItem[],
): AttentionItems {
  const exposureById = new Map(exposures.map((exposure) => [exposure.project_id, exposure]));
  // A closed project's overrun is history: nobody can act on it from the dashboard.
  const overBudget = projects
    .filter((project) => isOpenProject(project.status))
    .flatMap((project) => {
      const exposure = exposureById.get(project.id);
      return exposure?.over_budget ? [{ project, exposure }] : [];
    });
  return {
    awaiting: [...awaiting],
    over_budget: overBudget,
    over_allocated: employees.filter((employee) => employee.over_allocated),
  };
}

/**
 * The employee tiles: the sum and count of bonuses approved in the current Warsaw year, the latest
 * line (`lines[0]` in `listMyBonuses` order) and the names of the projects with a bonus (groupHistory order).
 */
export function employeeStats(lines: readonly MyBonusLine[], now: Date): EmployeeStats {
  const { year, fromIso, toIso } = warsawYearBounds(now);
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  const inYear = lines.filter((line) => {
    const approvedAt = Date.parse(line.approved_at);
    return approvedAt >= from && approvedAt < to;
  });
  const totalGrosze = inYear.reduce((sum, line) => sum + toGrosze(line.bonus), 0);
  return {
    year,
    year_total: totalGrosze / 100,
    year_count: inYear.length,
    latest: lines.at(0) ?? null,
    project_names: groupHistory(lines).groups.map((group) => group.project_name),
  };
}
