import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  engagementIdSchema,
  engagementUpdateSchema,
  firstIssueError,
  milestoneUrl,
  parseForm,
  updateEngagement,
} from "@/lib/services/engagements";
import { projectIdSchema, projectsUrl, projectUrl } from "@/lib/services/projects";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(projectsUrl({ error: { code: "not_configured" } }));
  }

  const projectId = projectIdSchema.safeParse(context.params.id);
  if (!projectId.success) {
    return context.redirect(projectsUrl({ error: { code: "invalid_id" } }));
  }

  const milestoneId = projectIdSchema.safeParse(context.params.milestoneId);
  if (!milestoneId.success) {
    return context.redirect(projectUrl(projectId.data, "milestones", { error: { code: "invalid_id" } }));
  }

  const engagementId = engagementIdSchema.safeParse(context.params.engagementId);
  if (!engagementId.success) {
    return context.redirect(
      milestoneUrl(projectId.data, milestoneId.data, { error: firstIssueError(engagementId.error) }),
    );
  }

  // Friendly early exit only; RLS (no Admin update policy on milestone_engagements) is the real enforcement.
  if (context.locals.profile?.role === "admin") {
    return context.redirect(
      milestoneUrl(projectId.data, milestoneId.data, { error: { code: "admin_read_only" } }, engagementId.data),
    );
  }

  const parsed = await parseForm(context.request, engagementUpdateSchema);
  if (parsed.error) {
    return context.redirect(milestoneUrl(projectId.data, milestoneId.data, { error: parsed.error }, engagementId.data));
  }

  const { error } = await updateEngagement(supabase, milestoneId.data, engagementId.data, parsed.data);
  if (error) {
    return context.redirect(milestoneUrl(projectId.data, milestoneId.data, { error }, engagementId.data));
  }

  return context.redirect(milestoneUrl(projectId.data, milestoneId.data, { saved: "updated" }));
};
