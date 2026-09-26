import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  createJobRole,
  firstIssueMessage,
  jobRoleInputSchema,
  settingsErrorUrl,
  settingsSavedUrl,
} from "@/lib/services/bonus-config";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(settingsErrorUrl("roles", "Supabase is not configured"));
  }

  const form = await context.request.formData();
  const parsed = jobRoleInputSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return context.redirect(settingsErrorUrl("roles", firstIssueMessage(parsed.error)));
  }

  const { error } = await createJobRole(supabase, parsed.data);
  if (error) {
    return context.redirect(settingsErrorUrl("roles", error));
  }

  return context.redirect(settingsSavedUrl("roles"));
};
