import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  firstIssueMessage,
  kpiSettingsInputSchema,
  settingsErrorUrl,
  settingsSavedUrl,
  updateKpiSettings,
} from "@/lib/services/bonus-config";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(settingsErrorUrl("kpi", "Supabase is not configured"));
  }

  const form = await context.request.formData();
  const parsed = kpiSettingsInputSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return context.redirect(settingsErrorUrl("kpi", firstIssueMessage(parsed.error)));
  }

  const { error } = await updateKpiSettings(supabase, parsed.data);
  if (error) {
    return context.redirect(settingsErrorUrl("kpi", error));
  }

  return context.redirect(settingsSavedUrl("kpi"));
};
