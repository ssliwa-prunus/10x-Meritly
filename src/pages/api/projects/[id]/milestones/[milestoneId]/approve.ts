import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { approveInputSchema, approveMilestone, approvalUrl, parseForm } from "@/lib/services/approvals";
import { isMilestoneInProject } from "@/lib/services/engagements";
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

  // Friendly early exit only; approve_milestone's ownership check (42501) is the real enforcement.
  if (context.locals.profile?.role === "admin") {
    return context.redirect(approvalUrl(projectId.data, milestoneId.data, { error: { code: "admin_read_only" } }));
  }

  // The milestone must belong to the project in the URL, so a crafted project/milestone pair
  // cannot approve under one project and redirect to another. The RPC still guards the data itself.
  const inProject = await isMilestoneInProject(supabase, projectId.data, milestoneId.data);
  if (inProject.error) {
    return context.redirect(projectUrl(projectId.data, "milestones", { error: { code: "save_failed" } }));
  }
  if (!inProject.data) {
    return context.redirect(projectUrl(projectId.data, "milestones", { error: { code: "not_found" } }));
  }

  const parsed = await parseForm(context.request, approveInputSchema);
  if (parsed.error) {
    return context.redirect(approvalUrl(projectId.data, milestoneId.data, { error: parsed.error }));
  }

  const { error } = await approveMilestone(supabase, milestoneId.data);
  if (error) {
    return context.redirect(approvalUrl(projectId.data, milestoneId.data, { error }));
  }

  return context.redirect(approvalUrl(projectId.data, milestoneId.data, { saved: "approved" }));
};
