import { describe, expect, it } from "vitest";
import { toOpenAssignments, type AssignmentRow } from "@/lib/assignments";
import type { MilestoneStatus, WorkStatus } from "@/types";

// Oracle: the "open" rule of employee_time_share_totals
// (supabase/migrations/20261009130000_time_share_excludes_closed_projects.sql): a milestone is open
// unless it is completed, cancelled or approved, and only while its project is not completed or
// cancelled. Rows the caller cannot see (null embeds) are dropped. Order: start date, then project
// name, then milestone name.

let seq = 0;
function row(
  milestone: { status?: MilestoneStatus; start_date?: string; name?: string } = {},
  project: { status?: WorkStatus; name?: string } = {},
): AssignmentRow {
  seq += 1;
  return {
    id: `eng-${seq}`,
    time_share: "0.30",
    milestones: {
      id: `m-${seq}`,
      name: milestone.name ?? `Milestone ${seq}`,
      status: milestone.status ?? "active",
      start_date: milestone.start_date ?? "2026-01-01",
      end_date: "2026-12-31",
      projects: { id: `p-${seq}`, name: project.name ?? "Project", status: project.status ?? "active" },
    },
  };
}

describe("toOpenAssignments", () => {
  it("keeps planned and active milestones in open projects, as numbers", () => {
    const planned = row({ status: "planned", name: "Planned" });
    const active = row({ status: "active", name: "Active" });

    const open = toOpenAssignments([planned, active]);

    expect(open.map((a) => a.milestone_name)).toEqual(["Active", "Planned"]);
    expect(open[0]).toMatchObject({ engagement_id: active.id, time_share: 0.3, project_name: "Project" });
  });

  it.each<MilestoneStatus>(["completed", "cancelled", "approved"])("drops a %s milestone", (status) => {
    expect(toOpenAssignments([row({ status })])).toEqual([]);
  });

  it.each<WorkStatus>(["completed", "cancelled"])("drops an open milestone of a %s project", (status) => {
    expect(toOpenAssignments([row({ status: "active" }, { status })])).toEqual([]);
  });

  it("drops rows whose milestone or project the caller cannot see", () => {
    const noMilestone: AssignmentRow = { ...row(), milestones: null };
    const withProject = row();
    const noProject: AssignmentRow = {
      ...withProject,
      milestones: withProject.milestones ? { ...withProject.milestones, projects: null } : null,
    };

    expect(toOpenAssignments([noMilestone, noProject])).toEqual([]);
  });

  it("orders by start date, then project name, then milestone name, whatever the input order", () => {
    const late = row({ start_date: "2026-05-01", name: "Late" }, { name: "A" });
    const sameDayB = row({ start_date: "2026-02-01", name: "X" }, { name: "B" });
    const sameDayA2 = row({ start_date: "2026-02-01", name: "Y" }, { name: "A" });
    const sameDayA1 = row({ start_date: "2026-02-01", name: "W" }, { name: "A" });
    const names = (rows: AssignmentRow[]) => toOpenAssignments(rows).map((a) => a.milestone_name);

    expect(names([late, sameDayB, sameDayA2, sameDayA1])).toEqual(["W", "Y", "X", "Late"]);
    expect(names([sameDayA1, sameDayA2, sameDayB, late])).toEqual(["W", "Y", "X", "Late"]);
  });
});
