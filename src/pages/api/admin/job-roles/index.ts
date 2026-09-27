import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  createJobRole,
  jobRoleInputSchema,
  parseForm,
  settingsErrorUrl,
  settingsSavedUrl,
} from "@/lib/services/bonus-config";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(settingsErrorUrl("roles", { code: "not_configured" }));
  }

  const parsed = await parseForm(context.request, jobRoleInputSchema);
  if (parsed.error) {
    return context.redirect(settingsErrorUrl("roles", parsed.error));
  }

  const { error } = await createJobRole(supabase, parsed.data);
  if (error) {
    return context.redirect(settingsErrorUrl("roles", error));
  }

  return context.redirect(settingsSavedUrl("roles"));
};
