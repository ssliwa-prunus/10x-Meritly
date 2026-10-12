import { describe, expect, it } from "vitest";
import { groupHistory } from "@/lib/history";
import type { MyBonusLine } from "@/types";

// Oracle: the S-06 plan (context/changes/navigate-to-employee-detail-and-history/plan.md, Phase 1).
// Groups are keyed by project_id, ordered by their most recent approval (newest first; ties by name,
// then id); lines inside a group by end date, newest first (ties by milestone name); subtotals and
// the total are exact to the grosz.

let seq = 0;
function line(overrides: Partial<MyBonusLine>): MyBonusLine {
  seq += 1;
  return {
    id: `line-${seq}`,
    project_id: "p-1",
    project_name: "Project",
    milestone_name: `Milestone ${seq}`,
    start_date: "2026-01-01",
    end_date: "2026-03-31",
    approved_at: "2026-04-01T10:00:00Z",
    job_role_name: "Developer",
    time_share: 0.5,
    role_weight: 1,
    rating: 3,
    rating_factor: 1,
    multiplier: 1,
    bonus: 100,
    ...overrides,
  };
}

describe("groupHistory", () => {
  it("returns no groups and a zero total for an empty history", () => {
    expect(groupHistory([])).toEqual({ groups: [], total: 0, line_count: 0 });
  });

  it("keeps two projects with the same name apart, ordered by their latest approval, not their end dates", () => {
    // Project A: approved recently, but its milestone ended long ago.
    const a = line({
      project_id: "p-a",
      project_name: "Same name",
      end_date: "2025-06-30",
      approved_at: "2026-09-01T00:00:00Z",
    });
    // Project B: same name, later end date, approved earlier.
    const b = line({
      project_id: "p-b",
      project_name: "Same name",
      end_date: "2026-08-31",
      approved_at: "2026-08-15T00:00:00Z",
    });

    const history = groupHistory([b, a]);

    expect(history.groups.map((group) => group.project_id)).toEqual(["p-a", "p-b"]);
    expect(history.groups.map((group) => group.latest_approved_at)).toEqual([
      "2026-09-01T00:00:00Z",
      "2026-08-15T00:00:00Z",
    ]);
    expect(history.line_count).toBe(2);
  });

  it("breaks equal latest approvals by project name, then id", () => {
    const approved_at = "2026-05-01T00:00:00Z";
    const zeta = line({ project_id: "p-1", project_name: "Zeta", approved_at });
    const alphaLate = line({ project_id: "p-9", project_name: "Alpha", approved_at });
    const alphaEarly = line({ project_id: "p-2", project_name: "Alpha", approved_at });

    expect(groupHistory([zeta, alphaLate, alphaEarly]).groups.map((group) => group.project_id)).toEqual([
      "p-2",
      "p-9",
      "p-1",
    ]);
  });

  it("orders a project's milestones by end date, newest first, and names the group from its latest approval", () => {
    const older = line({
      milestone_name: "M1",
      end_date: "2026-03-31",
      approved_at: "2026-06-01T00:00:00Z",
      project_name: "Renamed",
    });
    const newer = line({
      milestone_name: "M2",
      end_date: "2026-06-30",
      approved_at: "2026-04-01T00:00:00Z",
      project_name: "Original",
    });
    const sameEndB = line({ milestone_name: "B", end_date: "2026-01-31", approved_at: "2026-02-01T00:00:00Z" });
    const sameEndA = line({ milestone_name: "A", end_date: "2026-01-31", approved_at: "2026-02-01T00:00:00Z" });

    const [group] = groupHistory([sameEndB, older, sameEndA, newer]).groups;

    expect(group.lines.map((l) => l.milestone_name)).toEqual(["M2", "M1", "A", "B"]);
    expect(group.project_name).toBe("Renamed");
    expect(group.latest_approved_at).toBe("2026-06-01T00:00:00Z");
  });

  it("orders ties the same whatever the input order", () => {
    const approved_at = "2026-05-01T00:00:00Z";
    const alpha = line({ project_id: "p-a", project_name: "Alpha", approved_at });
    const beta = line({ project_id: "p-b", project_name: "Beta", approved_at });
    const m1 = line({ project_id: "p-c", milestone_name: "M1", end_date: "2026-01-31", approved_at: "2026-01-01" });
    const m2 = line({ project_id: "p-c", milestone_name: "M2", end_date: "2026-01-31", approved_at: "2026-01-01" });
    const order = (lines: MyBonusLine[]) =>
      groupHistory(lines).groups.map((group) => [group.project_id, ...group.lines.map((l) => l.milestone_name)]);

    const expected = [
      ["p-a", alpha.milestone_name],
      ["p-b", beta.milestone_name],
      ["p-c", "M1", "M2"],
    ];
    expect(order([alpha, beta, m1, m2])).toEqual(expected);
    expect(order([m2, m1, beta, alpha])).toEqual(expected);
  });

  it("names a group from its first listed line when two approvals share a timestamp", () => {
    // Equal approved_at: the line shown first (newest end date) wins, whatever the input order.
    const approved_at = "2026-05-01T00:00:00Z";
    const first = line({ project_name: "Shown first", end_date: "2026-06-30", approved_at });
    const second = line({ project_name: "Shown second", end_date: "2026-03-31", approved_at });

    expect(groupHistory([first, second]).groups[0].project_name).toBe("Shown first");
    expect(groupHistory([second, first]).groups[0].project_name).toBe("Shown first");
  });

  it("sums subtotals and the total exactly to the grosz", () => {
    // 0.10 + 0.20 is 0.30000000000000004 in floating point; in grosze it is 10 + 20 = 30 → 0.30.
    // 1200.07 + 800.01 = 2000.08; overall 0.30 + 2000.08 = 2000.38.
    const history = groupHistory([
      line({ project_id: "p-1", bonus: 0.1, approved_at: "2026-02-01T00:00:00Z" }),
      line({ project_id: "p-1", bonus: 0.2, approved_at: "2026-02-01T00:00:00Z" }),
      line({ project_id: "p-2", bonus: 1200.07, approved_at: "2026-01-01T00:00:00Z" }),
      line({ project_id: "p-2", bonus: 800.01, approved_at: "2026-01-01T00:00:00Z" }),
    ]);

    expect(history.groups.map((group) => group.subtotal)).toEqual([0.3, 2000.08]);
    expect(history.total).toBe(2000.38);
  });
});
