import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  firstIssueError,
  jobRoleArchiveInputSchema,
  jobRoleIdSchema,
  parseForm,
  setJobRoleArchived,
  settingsErrorUrl,
  settingsSavedUrl,
} from "@/lib/services/bonus-config";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(settingsErrorUrl("roles", { code: "not_configured" }));
  }

  const id = jobRoleIdSchema.safeParse(context.params.id);
  if (!id.success) {
    return context.redirect(settingsErrorUrl("roles", firstIssueError(id.error)));
  }

  const parsed = await parseForm(context.request, jobRoleArchiveInputSchema);
  if (parsed.error) {
    return context.redirect(settingsErrorUrl("roles", parsed.error));
  }

  const { error } = await setJobRoleArchived(supabase, id.data, parsed.data.archived);
  if (error) {
    return context.redirect(settingsErrorUrl("roles", error));
  }

  return context.redirect(settingsSavedUrl("roles"));
};
