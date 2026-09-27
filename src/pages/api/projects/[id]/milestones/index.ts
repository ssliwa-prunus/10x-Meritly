import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  createMilestone,
  firstIssueError,
  milestoneInputSchema,
  parseForm,
  projectIdSchema,
  projectsUrl,
  projectUrl,
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

  // Friendly early exit only; RLS (no Admin insert policy on milestones) is the real enforcement.
  if (context.locals.profile?.role === "admin") {
    return context.redirect(projectUrl(projectId.data, "milestones", { error: { code: "admin_read_only" } }));
  }

  const parsed = await parseForm(context.request, milestoneInputSchema);
  if (parsed.error) {
    return context.redirect(projectUrl(projectId.data, "milestones", { error: parsed.error }));
  }

  const { error } = await createMilestone(supabase, projectId.data, parsed.data);
  if (error) {
    return context.redirect(projectUrl(projectId.data, "milestones", { error }));
  }

  return context.redirect(projectUrl(projectId.data, "milestones", { saved: "milestones" }));
};
