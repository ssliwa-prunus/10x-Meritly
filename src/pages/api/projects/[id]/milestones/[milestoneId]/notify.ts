import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { approvalUrl, emailNotice, notifyMilestoneApproved } from "@/lib/services/approvals";
import { isMilestoneInProject } from "@/lib/services/engagements";
import { firstIssueError, projectIdSchema, projectsUrl, projectUrl } from "@/lib/services/projects";

/** Re-sends the bonus emails of an approved milestone that the provider has not confirmed yet. */
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

  // Friendly early exit only; the Edge Function's role and ownership checks are the real enforcement.
  if (context.locals.profile?.role === "admin") {
    return context.redirect(approvalUrl(projectId.data, milestoneId.data, { error: { code: "admin_read_only" } }));
  }

  // The milestone must belong to the project in the URL, so a crafted project/milestone pair
  // cannot notify under one project and redirect to another.
  const inProject = await isMilestoneInProject(supabase, projectId.data, milestoneId.data);
  if (inProject.error) {
    return context.redirect(projectUrl(projectId.data, "milestones", { error: { code: "save_failed" } }));
  }
  if (!inProject.data) {
    return context.redirect(projectUrl(projectId.data, "milestones", { error: { code: "not_found" } }));
  }

  // The form carries no fields, so the body is not read.
  const notified = await notifyMilestoneApproved(supabase, milestoneId.data);
  if (notified.error) {
    return context.redirect(approvalUrl(projectId.data, milestoneId.data, { error: notified.error }));
  }

  const notice = emailNotice(notified);
  return context.redirect(approvalUrl(projectId.data, milestoneId.data, { saved: "notified", notice }));
};
