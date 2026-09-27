import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  adminProjectInputSchema,
  firstIssueError,
  parseForm,
  projectIdSchema,
  projectInputSchema,
  projectsUrl,
  projectUrl,
  updateProject,
} from "@/lib/services/projects";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(projectsUrl({ error: { code: "not_configured" } }));
  }

  const id = projectIdSchema.safeParse(context.params.id);
  if (!id.success) {
    return context.redirect(projectsUrl({ error: firstIssueError(id.error) }));
  }

  // The Supervisor schema has no owner field, so a Supervisor's update leaves supervisor_id untouched.
  const schema = context.locals.profile?.role === "admin" ? adminProjectInputSchema : projectInputSchema;
  const parsed = await parseForm(context.request, schema);
  if (parsed.error) {
    return context.redirect(projectUrl(id.data, "project", { error: parsed.error }));
  }

  const { error } = await updateProject(supabase, id.data, parsed.data);
  if (error) {
    return context.redirect(projectUrl(id.data, "project", { error }));
  }

  return context.redirect(projectUrl(id.data, "project", { saved: "project" }));
};
