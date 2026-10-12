import type { EmployeeHistory, HistoryProjectGroup, MyBonusLine } from "@/types";

// ---------------------------------------------------------------------------
// An employee's approved history grouped by project (S-06), shared by /my-bonuses and
// /employees/[id]. Pure, so it is unit- and mutation-tested. The lines are already scoped by RLS;
// this only groups, orders and sums them.
// ---------------------------------------------------------------------------

/** Money in integer grosze, so sums are exact (0.10 + 0.20 is not 0.30 in floating point). */
const toGrosze = (amount: number) => Math.round(amount * 100);

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Groups lines by `project_id` (never by name: two projects may share one). Groups are ordered by
 * their most recent approval, newest first, ties by project name then id. Lines inside a group are
 * ordered by end date, newest first, ties by milestone name. A group takes its name from its most
 * recently approved line (the first listed one on a tie), since snapshot names are frozen per approval.
 */
export function groupHistory(lines: readonly MyBonusLine[]): EmployeeHistory {
  const byProject = new Map<string, MyBonusLine[]>();
  for (const line of lines) {
    const group = byProject.get(line.project_id);
    if (group) group.push(line);
    else byProject.set(line.project_id, [line]);
  }

  let totalGrosze = 0;
  const groups: HistoryProjectGroup[] = [...byProject].map(([projectId, projectLines]) => {
    const sorted = [...projectLines].sort(
      (a, b) => byText(b.end_date, a.end_date) || byText(a.milestone_name, b.milestone_name),
    );
    // Strict `>`: of two lines approved at the same instant, the one listed first names the group.
    const latest = sorted.reduce((a, b) => (b.approved_at > a.approved_at ? b : a));
    const subtotalGrosze = sorted.reduce((sum, line) => sum + toGrosze(line.bonus), 0);
    totalGrosze += subtotalGrosze;
    return {
      project_id: projectId,
      project_name: latest.project_name,
      latest_approved_at: latest.approved_at,
      subtotal: subtotalGrosze / 100,
      lines: sorted,
    };
  });

  groups.sort(
    (a, b) =>
      byText(b.latest_approved_at, a.latest_approved_at) ||
      byText(a.project_name, b.project_name) ||
      byText(a.project_id, b.project_id),
  );

  return { groups, total: totalGrosze / 100, line_count: lines.length };
}
