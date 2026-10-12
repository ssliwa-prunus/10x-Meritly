import type { MilestoneStatus, OpenAssignment, WorkStatus } from "@/types";

// ---------------------------------------------------------------------------
// Open assignments for /employees/[id] (S-06). Pure, so the "open" rule is unit-tested on both
// sides. Same rule as employee_time_share_totals: a closed milestone or a closed project is not open.
// ---------------------------------------------------------------------------

/** One `milestone_engagements` row with its milestone and project embedded (null when RLS hides them). */
export interface AssignmentRow {
  id: string;
  time_share: number | string;
  milestones: {
    id: string;
    name: string;
    status: MilestoneStatus;
    start_date: string;
    end_date: string;
    projects: { id: string; name: string; status: WorkStatus } | null;
  } | null;
}

const CLOSED_MILESTONE: readonly MilestoneStatus[] = ["completed", "cancelled", "approved"];
const CLOSED_PROJECT: readonly WorkStatus[] = ["completed", "cancelled"];

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Engagements on open milestones of open projects, by start date, then project and milestone name. */
export function toOpenAssignments(rows: readonly AssignmentRow[]): OpenAssignment[] {
  const open: OpenAssignment[] = [];
  for (const row of rows) {
    const milestone = row.milestones;
    const project = milestone?.projects;
    if (!milestone || !project) continue;
    if (CLOSED_MILESTONE.includes(milestone.status) || CLOSED_PROJECT.includes(project.status)) continue;
    open.push({
      engagement_id: row.id,
      project_id: project.id,
      project_name: project.name,
      milestone_id: milestone.id,
      milestone_name: milestone.name,
      start_date: milestone.start_date,
      end_date: milestone.end_date,
      time_share: Number(row.time_share),
    });
  }
  return open.sort(
    (a, b) =>
      byText(a.start_date, b.start_date) ||
      byText(a.project_name, b.project_name) ||
      byText(a.milestone_name, b.milestone_name),
  );
}
