import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  parseForm,
  ratingFactorsInputSchema,
  settingsErrorUrl,
  settingsSavedUrl,
  updateRatingFactors,
} from "@/lib/services/bonus-config";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(settingsErrorUrl("factors", { code: "not_configured" }));
  }

  const parsed = await parseForm(context.request, ratingFactorsInputSchema);
  if (parsed.error) {
    return context.redirect(settingsErrorUrl("factors", parsed.error));
  }

  const { error } = await updateRatingFactors(supabase, parsed.data);
  if (error) {
    return context.redirect(settingsErrorUrl("factors", error));
  }

  return context.redirect(settingsSavedUrl("factors"));
};
