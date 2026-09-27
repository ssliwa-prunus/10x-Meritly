import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  firstIssueError,
  milestoneInputSchema,
  parseForm,
  projectIdSchema,
  projectsUrl,
  projectUrl,
  updateMilestone,
} from "@/lib/services/projects";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(projectsUrl({ error: { code: "not_configured" } }));
  }

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
    return context.redirect(
      projectUrl(projectId.data, "milestones", { error: { code: "admin_read_only" } }, milestoneId.data),
    );
  }

  const parsed = await parseForm(context.request, milestoneInputSchema);
  if (parsed.error) {
    return context.redirect(projectUrl(projectId.data, "milestones", { error: parsed.error }, milestoneId.data));
  }

  const { error } = await updateMilestone(supabase, projectId.data, milestoneId.data, parsed.data);
  if (error) {
    return context.redirect(projectUrl(projectId.data, "milestones", { error }, milestoneId.data));
  }

  return context.redirect(projectUrl(projectId.data, "milestones", { saved: "milestones" }));
};
