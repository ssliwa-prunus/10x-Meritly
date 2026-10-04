import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { kpiScoresInputSchema, kpiUrl, parseForm, updateKpiScores } from "@/lib/services/payouts";
import { firstIssueError, projectIdSchema, projectsUrl, projectUrl } from "@/lib/services/projects";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(projectsUrl({ error: { code: "not_configured" } }));
  }

  // Until both ids are valid UUIDs there is no milestone page to return to.
  const projectId = projectIdSchema.safeParse(context.params.id);
  if (!projectId.success) {
    return context.redirect(projectsUrl({ error: firstIssueError(projectId.error) }));
  }

  const milestoneId = projectIdSchema.safeParse(context.params.milestoneId);
  if (!milestoneId.success) {
    return context.redirect(projectUrl(projectId.data, "milestones", { error: firstIssueError(milestoneId.error) }));
  }

  // Friendly early exit only; RLS (no Admin update policy on milestones) is the real enforcement.
  if (context.locals.profile?.role === "admin") {
    return context.redirect(kpiUrl(projectId.data, milestoneId.data, { error: { code: "admin_read_only" } }));
  }

  const parsed = await parseForm(context.request, kpiScoresInputSchema);
  if (parsed.error) {
    return context.redirect(kpiUrl(projectId.data, milestoneId.data, { error: parsed.error }));
  }

  // Filtered by id and project_id: a crafted project/milestone pair updates nothing (not_found).
  const { error } = await updateKpiScores(supabase, projectId.data, milestoneId.data, parsed.data);
  if (error) {
    return context.redirect(kpiUrl(projectId.data, milestoneId.data, { error }));
  }

  return context.redirect(kpiUrl(projectId.data, milestoneId.data, { saved: "kpi" }));
};
