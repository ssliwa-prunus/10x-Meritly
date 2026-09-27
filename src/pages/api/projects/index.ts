import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  adminProjectInputSchema,
  createProject,
  parseForm,
  projectInputSchema,
  projectsUrl,
  projectUrl,
} from "@/lib/services/projects";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(projectsUrl({ error: { code: "not_configured" } }, "new"));
  }

  // Admins pick the owner; a Supervisor's project defaults to themselves (supervisor_id = auth.uid()).
  const schema = context.locals.profile?.role === "admin" ? adminProjectInputSchema : projectInputSchema;
  const parsed = await parseForm(context.request, schema);
  if (parsed.error) {
    return context.redirect(projectsUrl({ error: parsed.error }, "new"));
  }

  const { data, error } = await createProject(supabase, parsed.data);
  if (error || !data) {
    return context.redirect(projectsUrl({ error: error ?? { code: "save_failed" } }, "new"));
  }

  return context.redirect(projectUrl(data.id, "project", { saved: "project" }));
};
