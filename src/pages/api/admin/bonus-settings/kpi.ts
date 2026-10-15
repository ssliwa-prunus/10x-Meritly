import type { APIRoute } from "astro";
import { logContextFrom } from "@/lib/error-log";
import { createClient } from "@/lib/supabase";
import {
  kpiSettingsInputSchema,
  parseForm,
  settingsErrorUrl,
  settingsSavedUrl,
  updateKpiSettings,
} from "@/lib/services/bonus-config";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  const log = logContextFrom(context.locals, context.request);
  if (!supabase) {
    return context.redirect(settingsErrorUrl("kpi", { code: "not_configured" }));
  }

  const parsed = await parseForm(context.request, kpiSettingsInputSchema);
  if (parsed.error) {
    return context.redirect(settingsErrorUrl("kpi", parsed.error));
  }

  const { error } = await updateKpiSettings(supabase, parsed.data, log);
  if (error) {
    return context.redirect(settingsErrorUrl("kpi", error));
  }

  return context.redirect(settingsSavedUrl("kpi"));
};
