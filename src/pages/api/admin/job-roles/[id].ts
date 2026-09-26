import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  firstIssueMessage,
  jobRoleIdSchema,
  jobRoleInputSchema,
  settingsErrorUrl,
  settingsSavedUrl,
  updateJobRole,
} from "@/lib/services/bonus-config";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(settingsErrorUrl("roles", "Supabase is not configured"));
  }

  const id = jobRoleIdSchema.safeParse(context.params.id);
  if (!id.success) {
    return context.redirect(settingsErrorUrl("roles", firstIssueMessage(id.error)));
  }

  const form = await context.request.formData();
  const parsed = jobRoleInputSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return context.redirect(settingsErrorUrl("roles", firstIssueMessage(parsed.error)));
  }

  const { error } = await updateJobRole(supabase, id.data, parsed.data);
  if (error) {
    return context.redirect(settingsErrorUrl("roles", error));
  }

  return context.redirect(settingsSavedUrl("roles"));
};
