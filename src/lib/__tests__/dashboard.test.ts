import { describe, expect, it } from "vitest";
import {
  attentionItems,
  awaitingMilestones,
  dashboardRows,
  employeeStats,
  isAwaitingApproval,
  needsPayoutSummary,
  reservedBudget,
  supervisorStats,
  warsawYearBounds,
} from "@/lib/dashboard";
import type {
  DashboardApprovedResult,
  DashboardMilestone,
  EmployeeListItem,
  MilestonePayoutSummary,
  MyBonusLine,
  Project,
  ProjectExposure,
} from "@/types";

// Oracle: context/changes/new-dashboard-view/plan.md, "Implementation Approach" → Definitions and
// "Critical Implementation Details". Awaiting approval mirrors the Approve button (not approved or
// cancelled, project open, all four KPI scores set, at least one engagement). The current year is
// the Europe/Warsaw calendar year (2026-12-31T23:30Z is 2027). Reserved budget sums open projects
// (not completed/cancelled), percent floored, 0 on a zero budget. Table: awaiting, active, planned,
// completed, then approved by approved_at desc; ties by start_date asc, name asc; at most 8 rows;
// admins never get "approve". Money sums are exact to the grosz.

let seq = 0;

function milestone(overrides: Partial<DashboardMilestone> = {}): DashboardMilestone {
  seq += 1;
  return {
    id: `m-${seq}`,
    project_id: "p-1",
    name: `Milestone ${seq}`,
    start_date: "2026-01-01",
    end_date: "2026-03-31",
    status: "active",
    target_pool: 10000,
    notes: null,
    kpi_schedule: null,
    kpi_budget: null,
    kpi_quality: null,
    kpi_risk: null,
    project_name: "Project",
    project_status: "active",
    ...overrides,
  };
}

const SCORED = { kpi_schedule: 80, kpi_budget: 70, kpi_quality: 90, kpi_risk: 60 } as const;

function summary(milestoneId: string, overrides: Partial<MilestonePayoutSummary> = {}): MilestonePayoutSummary {
  return {
    milestone_id: milestoneId,
    target_pool: 10000,
    ...SCORED,
    scored: true,
    multiplier: 1.1,
    budget_share: 0.88,
    payout_pool: 8800,
    payout_total: 8799.99,
    residual: 0.01,
    within_pool: true,
    engagement_count: 2,
    ...overrides,
  };
}

function result(milestoneId: string, overrides: Partial<DashboardApprovedResult> = {}): DashboardApprovedResult {
  return {
    milestone_id: milestoneId,
    multiplier: 0.9,
    multiplier_max: 1.25,
    payout_total: 1000,
    approved_at: "2026-05-01T10:00:00+00:00",
    ...overrides,
  };
}

function project(overrides: Partial<Project> = {}): Project {
  seq += 1;
  return {
    id: `p-${seq}`,
    name: `Project ${seq}`,
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    status: "active",
    total_budget: 100000,
    notes: null,
    supervisor_id: "s-1",
    ...overrides,
  };
}

function exposure(projectId: string, overrides: Partial<ProjectExposure> = {}): ProjectExposure {
  return {
    project_id: projectId,
    total_budget: 1000,
    reserved_total: 500,
    remaining: 500,
    over_budget: false,
    ...overrides,
  };
}

function bonusLine(overrides: Partial<MyBonusLine> = {}): MyBonusLine {
  seq += 1;
  return {
    id: `line-${seq}`,
    project_id: "p-1",
    project_name: "Project",
    milestone_name: `Milestone ${seq}`,
    start_date: "2026-01-01",
    end_date: "2026-03-31",
    approved_at: "2026-04-01T10:00:00+00:00",
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

function employee(overrides: Partial<EmployeeListItem> = {}): EmployeeListItem {
  seq += 1;
  return {
    id: `e-${seq}`,
    supervisor_id: "s-1",
    full_name: `Employee ${seq}`,
    email: `e${seq}@example.com`,
    job_role_id: "r-1",
    profile_id: null,
    invited_at: null,
    activated_at: null,
    job_role_name: "Developer",
    open_total: 0.5,
    over_allocated: false,
    ...overrides,
  };
}

const summariesOf = (...items: MilestonePayoutSummary[]) => new Map(items.map((item) => [item.milestone_id, item]));

describe("warsawYearBounds", () => {
  it("puts an approval at 2026-12-31T23:30Z into 2027 (Warsaw is already past midnight)", () => {
    expect(warsawYearBounds(new Date("2026-12-31T23:30:00Z"))).toEqual({
      year: 2027,
      fromIso: "2026-12-31T23:00:00.000Z",
      toIso: "2027-12-31T23:00:00.000Z",
    });
  });

  it("keeps the last Warsaw millisecond of 2026 in 2026", () => {
    expect(warsawYearBounds(new Date("2026-12-31T22:59:59.999Z"))).toEqual({
      year: 2026,
      fromIso: "2025-12-31T23:00:00.000Z",
      toIso: "2026-12-31T23:00:00.000Z",
    });
  });

  it("starts the year exactly at Warsaw midnight", () => {
    expect(warsawYearBounds(new Date("2025-12-31T23:00:00.000Z")).year).toBe(2026);
    expect(warsawYearBounds(new Date("2025-12-31T22:59:59.999Z")).year).toBe(2025);
  });

  it("uses the winter offset for the bounds even in summer time (CEST)", () => {
    expect(warsawYearBounds(new Date("2026-07-15T12:00:00Z"))).toEqual({
      year: 2026,
      fromIso: "2025-12-31T23:00:00.000Z",
      toIso: "2026-12-31T23:00:00.000Z",
    });
  });

  it("handles a winter date and a different year", () => {
    expect(warsawYearBounds(new Date("2024-02-29T06:15:00Z"))).toEqual({
      year: 2024,
      fromIso: "2023-12-31T23:00:00.000Z",
      toIso: "2024-12-31T23:00:00.000Z",
    });
  });
});

describe("isAwaitingApproval", () => {
  const scored = milestone({ ...SCORED, status: "completed" });
  const ready = summary(scored.id);

  it("is true for an open, scored milestone of an open project with an engagement", () => {
    expect(isAwaitingApproval(scored, "active", ready)).toBe(true);
  });

  it.each(["planned", "active", "completed"] as const)("accepts milestone status %s", (status) => {
    expect(isAwaitingApproval({ ...scored, status }, "active", ready)).toBe(true);
  });

  it.each(["approved", "cancelled"] as const)("rejects milestone status %s", (status) => {
    expect(isAwaitingApproval({ ...scored, status }, "active", ready)).toBe(false);
  });

  it.each(["planned", "active"] as const)("accepts project status %s", (projectStatus) => {
    expect(isAwaitingApproval(scored, projectStatus, ready)).toBe(true);
  });

  it.each(["completed", "cancelled"] as const)("rejects project status %s", (projectStatus) => {
    expect(isAwaitingApproval(scored, projectStatus, ready)).toBe(false);
  });

  it.each(["kpi_schedule", "kpi_budget", "kpi_quality", "kpi_risk"] as const)(
    "rejects a milestone whose %s is null",
    (field) => {
      expect(isAwaitingApproval({ ...scored, [field]: null }, "active", ready)).toBe(false);
    },
  );

  it("accepts KPI scores of 0 (scored, not missing)", () => {
    const zeros = { ...scored, kpi_schedule: 0, kpi_budget: 0, kpi_quality: 0, kpi_risk: 0 };
    expect(isAwaitingApproval(zeros, "active", ready)).toBe(true);
  });

  it("rejects an unscored milestone", () => {
    expect(isAwaitingApproval(milestone(), "active", ready)).toBe(false);
  });

  it("rejects a milestone without engagements", () => {
    expect(isAwaitingApproval(scored, "active", { ...ready, engagement_count: 0 })).toBe(false);
  });

  it("accepts exactly one engagement", () => {
    expect(isAwaitingApproval(scored, "active", { ...ready, engagement_count: 1 })).toBe(true);
  });

  it("rejects a milestone whose summary is missing (not visible or failed)", () => {
    expect(isAwaitingApproval(scored, "active", null)).toBe(false);
  });
});

describe("needsPayoutSummary", () => {
  it("asks for the summary only for scored, unapproved, non-cancelled milestones of open projects", () => {
    expect(needsPayoutSummary(milestone({ ...SCORED }))).toBe(true);
    expect(needsPayoutSummary(milestone({ ...SCORED, status: "planned", project_status: "planned" }))).toBe(true);
    expect(needsPayoutSummary(milestone())).toBe(false);
    expect(needsPayoutSummary(milestone({ ...SCORED, kpi_risk: null }))).toBe(false);
    expect(needsPayoutSummary(milestone({ ...SCORED, status: "approved" }))).toBe(false);
    expect(needsPayoutSummary(milestone({ ...SCORED, status: "cancelled" }))).toBe(false);
    expect(needsPayoutSummary(milestone({ ...SCORED, project_status: "completed" }))).toBe(false);
    expect(needsPayoutSummary(milestone({ ...SCORED, project_status: "cancelled" }))).toBe(false);
  });
});

describe("awaitingMilestones", () => {
  it("returns nothing for empty input", () => {
    expect(awaitingMilestones([], new Map())).toEqual([]);
  });

  it("keeps awaiting milestones with their summary, ordered by start date then name", () => {
    const late = milestone({ ...SCORED, name: "A", start_date: "2026-03-01" });
    const earlyB = milestone({ ...SCORED, name: "B", start_date: "2026-01-01" });
    const earlyA = milestone({ ...SCORED, name: "A", start_date: "2026-01-01" });
    const noEngagements = milestone({ ...SCORED });
    const noSummary = milestone({ ...SCORED });
    const summaries = summariesOf(
      summary(late.id),
      summary(earlyB.id),
      summary(earlyA.id),
      summary(noEngagements.id, { engagement_count: 0 }),
    );

    expect(awaitingMilestones([late, earlyB, noEngagements, noSummary, earlyA], summaries)).toEqual([
      { milestone: earlyA, summary: summaries.get(earlyA.id) },
      { milestone: earlyB, summary: summaries.get(earlyB.id) },
      { milestone: late, summary: summaries.get(late.id) },
    ]);
  });
});

describe("reservedBudget", () => {
  it("is all zero for empty input", () => {
    expect(reservedBudget([], [])).toEqual({ reserved: 0, budget: 0, percent: 0 });
  });

  it("sums open projects only, exact to the grosz, and floors the percent", () => {
    const planned = project({ status: "planned" });
    const active = project({ status: "active" });
    const completed = project({ status: "completed" });
    const cancelled = project({ status: "cancelled" });
    const result = reservedBudget(
      [planned, active, completed, cancelled],
      [
        exposure(planned.id, { reserved_total: 0.1, total_budget: 0.2 }),
        exposure(active.id, { reserved_total: 0.2, total_budget: 0.11 }),
        exposure(completed.id, { reserved_total: 5000, total_budget: 5000 }),
        exposure(cancelled.id, { reserved_total: 7000, total_budget: 7000 }),
      ],
    );
    // 0.30 / 0.31 = 96.77% → 96
    expect(result).toEqual({ reserved: 0.3, budget: 0.31, percent: 96 });
  });

  it("rounds each amount to the grosz before summing (0.29 × 100 is 28.999… in floating point)", () => {
    const p = project();
    expect(reservedBudget([p], [exposure(p.id, { reserved_total: 0.29, total_budget: 1.15 })])).toEqual({
      reserved: 0.29,
      budget: 1.15,
      percent: 25,
    });
  });

  it("floors instead of rounding (999.99 of 1000 is 99%)", () => {
    const p = project();
    expect(reservedBudget([p], [exposure(p.id, { reserved_total: 999.99, total_budget: 1000 })]).percent).toBe(99);
  });

  it("reports over 100% when the reserve exceeds the budget", () => {
    const p = project();
    expect(reservedBudget([p], [exposure(p.id, { reserved_total: 1500, total_budget: 1000 })])).toEqual({
      reserved: 1500,
      budget: 1000,
      percent: 150,
    });
  });

  it("is 0% when the budget sum is 0", () => {
    const p = project();
    expect(reservedBudget([p], [exposure(p.id, { reserved_total: 0, total_budget: 0 })])).toEqual({
      reserved: 0,
      budget: 0,
      percent: 0,
    });
  });

  it("is 0% when every project is closed", () => {
    const p = project({ status: "completed" });
    expect(reservedBudget([p], [exposure(p.id)])).toEqual({ reserved: 0, budget: 0, percent: 0 });
  });

  it("ignores an exposure whose project is not listed", () => {
    const p = project();
    expect(
      reservedBudget([p], [exposure(p.id), exposure("p-unknown", { reserved_total: 9, total_budget: 9 })]),
    ).toEqual({ reserved: 500, budget: 1000, percent: 50 });
  });
});

describe("supervisorStats", () => {
  it("is all zero for empty input", () => {
    expect(supervisorStats([], [], [], [])).toEqual({
      active_projects: 0,
      active_milestones: 0,
      awaiting: 0,
      paid_total: 0,
      paid_count: 0,
    });
  });

  it("counts active projects and milestones, the awaiting list and the year's results", () => {
    const projects = [
      project({ status: "active" }),
      project({ status: "active" }),
      project({ status: "planned" }),
      project({ status: "completed" }),
    ];
    const milestones = [
      milestone({ status: "active" }),
      milestone({ status: "active", project_status: "completed" }),
      milestone({ status: "planned" }),
      milestone({ status: "completed" }),
    ];
    const awaiting = [{ milestone: milestones[3], summary: summary(milestones[3].id) }];
    const results = [result("m-a", { payout_total: 0.1 }), result("m-b", { payout_total: 0.2 }), result("m-c")];

    expect(supervisorStats(projects, milestones, awaiting, results)).toEqual({
      active_projects: 2,
      active_milestones: 2,
      awaiting: 1,
      paid_total: 1000.3,
      paid_count: 3,
    });
  });

  it("counts only status active, not everything else", () => {
    const projects = [project({ status: "active" }), project({ status: "planned" }), project({ status: "completed" })];
    const milestones = [
      milestone({ status: "active" }),
      milestone({ status: "planned" }),
      milestone({ status: "completed" }),
    ];

    expect(supervisorStats(projects, milestones, [], [])).toMatchObject({ active_projects: 1, active_milestones: 1 });
  });
});

describe("dashboardRows", () => {
  it("returns no rows for empty input", () => {
    expect(dashboardRows([], new Map(), [], "supervisor", 1.25)).toEqual([]);
  });

  it("includes non-cancelled milestones of open projects and this year's approvals only", () => {
    const active = milestone();
    const cancelled = milestone({ status: "cancelled" });
    const closedProject = milestone({ project_status: "completed" });
    const cancelledProject = milestone({ project_status: "cancelled" });
    const approvedThisYear = milestone({ status: "approved", project_status: "completed" });
    const approvedEarlier = milestone({ status: "approved" });

    const rows = dashboardRows(
      [active, cancelled, closedProject, cancelledProject, approvedThisYear, approvedEarlier],
      new Map(),
      [result(approvedThisYear.id)],
      "supervisor",
      1.25,
    );

    expect(rows.map((row) => row.milestone.id)).toEqual([active.id, approvedThisYear.id]);
  });

  it("orders awaiting, active, planned, completed, then approved by approval date, ties by start date and name", () => {
    const awaitingLate = milestone({ ...SCORED, status: "planned", start_date: "2026-02-01", name: "A" });
    const awaitingEarly = milestone({ ...SCORED, status: "completed", start_date: "2026-01-01", name: "Z" });
    const activeB = milestone({ status: "active", start_date: "2026-01-01", name: "B" });
    const activeA = milestone({ status: "active", start_date: "2026-01-01", name: "A" });
    const activeEarly = milestone({ status: "active", start_date: "2025-12-01", name: "Z" });
    const planned = milestone({ status: "planned", start_date: "2025-01-01" });
    const completed = milestone({ status: "completed", start_date: "2024-01-01" });
    const approvedOld = milestone({ status: "approved", start_date: "2020-01-01" });
    const approvedNew = milestone({ status: "approved", start_date: "2026-06-01", name: "B" });
    const approvedNewTie = milestone({ status: "approved", start_date: "2026-06-01", name: "A" });
    const summaries = summariesOf(summary(awaitingLate.id), summary(awaitingEarly.id));
    const results = [
      result(approvedOld.id, { approved_at: "2026-02-01T10:00:00+00:00" }),
      result(approvedNew.id, { approved_at: "2026-09-01T10:00:00+00:00" }),
      result(approvedNewTie.id, { approved_at: "2026-09-01T10:00:00+00:00" }),
    ];

    const rows = dashboardRows(
      [
        approvedOld,
        completed,
        planned,
        activeB,
        approvedNew,
        awaitingLate,
        activeA,
        approvedNewTie,
        activeEarly,
        awaitingEarly,
      ],
      summaries,
      results,
      "supervisor",
      1.25,
    );

    expect(rows.map((row) => row.milestone.id)).toEqual([
      awaitingEarly.id,
      awaitingLate.id,
      activeEarly.id,
      activeA.id,
      activeB.id,
      planned.id,
      completed.id,
      // Capped at 8: the newest approval wins the tie on start date by name.
      approvedNewTie.id,
    ]);
    expect(rows.slice(0, 2).every((row) => row.awaiting)).toBe(true);
    expect(rows.slice(2).some((row) => row.awaiting)).toBe(false);
  });

  it("orders approved rows by approval date, newest first, ties by start date then name", () => {
    const old = milestone({ status: "approved", start_date: "2020-01-01" });
    const newB = milestone({ status: "approved", start_date: "2026-06-01", name: "B" });
    const newA = milestone({ status: "approved", start_date: "2026-06-01", name: "A" });
    const newEarly = milestone({ status: "approved", start_date: "2026-05-01", name: "Z" });
    const at = "2026-09-01T10:00:00+00:00";
    const rows = dashboardRows(
      [old, newB, newA, newEarly],
      new Map(),
      [
        result(old.id, { approved_at: "2026-02-01T10:00:00+00:00" }),
        result(newB.id, { approved_at: at }),
        result(newA.id, { approved_at: at }),
        result(newEarly.id, { approved_at: at }),
      ],
      "supervisor",
      1.25,
    );

    expect(rows.map((row) => row.milestone.id)).toEqual([newEarly.id, newA.id, newB.id, old.id]);
    expect(rows.map((row) => row.approved_at)).toEqual([at, at, at, "2026-02-01T10:00:00+00:00"]);
  });

  it("caps the table at 8 rows, keeping the first ones in order", () => {
    const milestones = Array.from({ length: 10 }, (_, index) =>
      milestone({ start_date: `2026-01-${String(index + 10)}` }),
    );
    const rows = dashboardRows(milestones, new Map(), [], "supervisor", 1.25);
    expect(rows).toHaveLength(8);
    expect(rows.map((row) => row.milestone.id)).toEqual(milestones.slice(0, 8).map((m) => m.id));
  });

  it("keeps exactly 8 rows when there are 8", () => {
    const milestones = Array.from({ length: 8 }, () => milestone());
    expect(dashboardRows(milestones, new Map(), [], "supervisor", 1.25)).toHaveLength(8);
  });

  it("fills the KPI cell from the snapshot, the live summary or nothing", () => {
    const approved = milestone({ status: "approved" });
    const scored = milestone({ ...SCORED });
    const scoredFailed = milestone({ ...SCORED });
    const unscored = milestone();
    const rows = dashboardRows(
      [approved, scored, scoredFailed, unscored],
      summariesOf(summary(scored.id, { multiplier: 1.1875, engagement_count: 0 })),
      [result(approved.id, { multiplier: 0.9, multiplier_max: 1.5 })],
      "supervisor",
      1.25,
    );
    const kpiOf = (id: string) => rows.find((row) => row.milestone.id === id)?.kpi;

    expect(kpiOf(approved.id)).toEqual({ multiplier: 0.9, multiplier_max: 1.5 });
    expect(kpiOf(scored.id)).toEqual({ multiplier: 1.1875, multiplier_max: 1.25 });
    expect(kpiOf(scoredFailed.id)).toBeNull();
    expect(kpiOf(unscored.id)).toBeNull();
  });

  it("shows no live KPI when the summary has no multiplier or the maximum is unknown", () => {
    const scored = milestone({ ...SCORED });
    const unscoredSummary = summariesOf(summary(scored.id, { scored: false, multiplier: null }));
    expect(dashboardRows([scored], unscoredSummary, [], "supervisor", 1.25)[0].kpi).toBeNull();
    expect(dashboardRows([scored], summariesOf(summary(scored.id)), [], "supervisor", null)[0].kpi).toBeNull();
  });

  it("gives a supervisor Approve on awaiting rows, Results on approved rows and Open otherwise", () => {
    const awaiting = milestone({ ...SCORED });
    const approved = milestone({ status: "approved" });
    const plain = milestone();
    const rows = dashboardRows(
      [awaiting, approved, plain],
      summariesOf(summary(awaiting.id)),
      [result(approved.id)],
      "supervisor",
      1.25,
    );

    expect(rows.map((row) => [row.milestone.id, row.action, row.approved_at])).toEqual([
      [awaiting.id, "approve", null],
      [plain.id, "open", null],
      [approved.id, "results", "2026-05-01T10:00:00+00:00"],
    ]);
  });

  it("never gives an admin Approve, even on an awaiting row", () => {
    const awaiting = milestone({ ...SCORED });
    const approved = milestone({ status: "approved" });
    const rows = dashboardRows(
      [awaiting, approved],
      summariesOf(summary(awaiting.id)),
      [result(approved.id)],
      "admin",
      1.25,
    );

    expect(rows.map((row) => [row.action, row.awaiting])).toEqual([
      ["open", true],
      ["results", false],
    ]);
  });
});

describe("attentionItems", () => {
  it("is empty for empty input", () => {
    expect(attentionItems([], [], [], [])).toEqual({ awaiting: [], over_budget: [], over_allocated: [] });
  });

  it("lists awaiting milestones, over-budget projects in project order and over-allocated employees", () => {
    const m = milestone({ ...SCORED });
    const awaiting = [{ milestone: m, summary: summary(m.id) }];
    const ok = project({ name: "A" });
    const overB = project({ name: "B" });
    const overC = project({ name: "C" });
    const unlisted = exposure("p-unknown", { over_budget: true });
    const exposures = [
      exposure(overC.id, { over_budget: true }),
      exposure(ok.id),
      exposure(overB.id, { over_budget: true }),
      unlisted,
    ];
    const calm = employee({ over_allocated: false });
    const busy = employee({ over_allocated: true, open_total: 1.2 });

    expect(attentionItems(awaiting, exposures, [ok, overB, overC], [calm, busy])).toEqual({
      awaiting,
      over_budget: [
        { project: overB, exposure: exposures[2] },
        { project: overC, exposure: exposures[0] },
      ],
      over_allocated: [busy],
    });
  });

  it("leaves out over-budget projects that are completed or cancelled", () => {
    const completed = project({ status: "completed" });
    const cancelled = project({ status: "cancelled" });
    const planned = project({ status: "planned" });
    const exposures = [completed, cancelled, planned].map((p) => exposure(p.id, { over_budget: true }));

    expect(attentionItems([], exposures, [completed, cancelled, planned], []).over_budget).toEqual([
      { project: planned, exposure: exposures[2] },
    ]);
  });
});

describe("employeeStats", () => {
  const now = new Date("2026-10-18T12:00:00Z");

  it("is empty for no lines", () => {
    expect(employeeStats([], now)).toEqual({
      year: 2026,
      year_total: 0,
      year_count: 0,
      latest: null,
      project_names: [],
    });
  });

  it("sums this Warsaw year's bonuses exactly, takes lines[0] as latest and names the projects", () => {
    const newest = bonusLine({
      project_id: "p-b",
      project_name: "Beta",
      bonus: 0.1,
      approved_at: "2026-10-01T10:00:00+00:00",
    });
    const second = bonusLine({
      project_id: "p-a",
      project_name: "Alpha",
      bonus: 0.2,
      approved_at: "2026-03-01T10:00:00+00:00",
    });
    // 2025-12-31T23:30Z is already 2026 in Warsaw.
    const newYearsEve = bonusLine({
      project_id: "p-a",
      project_name: "Alpha",
      bonus: 1,
      approved_at: "2025-12-31T23:30:00+00:00",
    });
    const lastYear = bonusLine({
      project_id: "p-c",
      project_name: "Gamma",
      bonus: 500,
      approved_at: "2025-12-31T22:30:00+00:00",
    });

    expect(employeeStats([newest, second, newYearsEve, lastYear], now)).toEqual({
      year: 2026,
      year_total: 1.3,
      year_count: 3,
      latest: newest,
      project_names: ["Beta", "Alpha", "Gamma"],
    });
  });

  it("excludes an approval at the next year's Warsaw midnight", () => {
    const nextYear = bonusLine({ approved_at: "2026-12-31T23:00:00+00:00" });
    const stats = employeeStats([nextYear], new Date("2026-12-31T22:00:00Z"));
    expect(stats).toMatchObject({ year: 2026, year_total: 0, year_count: 0, latest: nextYear });
  });

  it("includes an approval at exactly this year's Warsaw midnight", () => {
    // 2025-12-31T23:00Z is 2026-01-01 00:00 in Warsaw (CET, +01:00).
    const firstInstant = bonusLine({ bonus: 5, approved_at: "2025-12-31T23:00:00+00:00" });
    const stats = employeeStats([firstInstant], new Date("2026-06-01T12:00:00Z"));
    expect(stats).toMatchObject({ year: 2026, year_total: 5, year_count: 1 });
  });
});
