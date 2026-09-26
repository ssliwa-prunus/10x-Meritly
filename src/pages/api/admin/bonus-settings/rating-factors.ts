import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  firstIssueMessage,
  ratingFactorsInputSchema,
  settingsErrorUrl,
  settingsSavedUrl,
  updateRatingFactors,
} from "@/lib/services/bonus-config";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(settingsErrorUrl("factors", "Supabase is not configured"));
  }

  const form = await context.request.formData();
  const parsed = ratingFactorsInputSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return context.redirect(settingsErrorUrl("factors", firstIssueMessage(parsed.error)));
  }

  const { error } = await updateRatingFactors(supabase, parsed.data);
  if (error) {
    return context.redirect(settingsErrorUrl("factors", error));
  }

  return context.redirect(settingsSavedUrl("factors"));
};
