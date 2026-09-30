import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  createEngagement,
  engagementInputSchema,
  isMilestoneInProject,
  listAssignableEmployees,
  milestoneUrl,
  parseForm,
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

  // Friendly early exit only; RLS (no Admin insert policy on milestone_engagements) is the real enforcement.
  const profile = context.locals.profile;
  if (profile?.role === "admin") {
    return context.redirect(milestoneUrl(projectId.data, milestoneId.data, { error: { code: "admin_read_only" } }));
  }

  // The milestone must belong to the project in the URL, so a crafted project/milestone pair
  // cannot write under one project and redirect to another. RLS still guards the data itself.
  const inProject = await isMilestoneInProject(supabase, projectId.data, milestoneId.data);
  if (inProject.error) {
    return context.redirect(projectUrl(projectId.data, "milestones", { error: { code: "save_failed" } }));
  }
  if (!inProject.data) {
    return context.redirect(projectUrl(projectId.data, "milestones", { error: { code: "not_found" } }));
  }

  const parsed = await parseForm(context.request, engagementInputSchema);
  if (parsed.error) {
    return context.redirect(milestoneUrl(projectId.data, milestoneId.data, { error: parsed.error }));
  }

  // Only the signed-in Supervisor's own, not-yet-assigned employees may be picked. Seeing an
  // employee is not owning them; the MR011 guard in the database is the real enforcement.
  if (!profile) {
    return context.redirect(milestoneUrl(projectId.data, milestoneId.data, { error: { code: "not_found" } }));
  }
  const assignable = await listAssignableEmployees(supabase, profile.id, milestoneId.data);
  if (!assignable.data) {
    return context.redirect(milestoneUrl(projectId.data, milestoneId.data, { error: { code: "save_failed" } }));
  }
  if (!assignable.data.some((employee) => employee.id === parsed.data.employee_id)) {
    return context.redirect(
      milestoneUrl(projectId.data, milestoneId.data, {
        error: { code: "employee_not_available", field: "employee_id" },
      }),
    );
  }

  const { error } = await createEngagement(supabase, milestoneId.data, parsed.data);
  if (error) {
    return context.redirect(milestoneUrl(projectId.data, milestoneId.data, { error }));
  }

  return context.redirect(milestoneUrl(projectId.data, milestoneId.data, { saved: "created" }));
};
