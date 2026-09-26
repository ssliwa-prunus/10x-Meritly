import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import {
  firstIssueMessage,
  jobRoleIdSchema,
  setJobRoleArchived,
  settingsErrorUrl,
  settingsSavedUrl,
} from "@/lib/services/bonus-config";

const archiveInputSchema = z.object({
  archived: z.enum(["true", "false"], { error: "Invalid archive action" }).transform((value) => value === "true"),
});

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
  const parsed = archiveInputSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return context.redirect(settingsErrorUrl("roles", firstIssueMessage(parsed.error)));
  }

  const { error } = await setJobRoleArchived(supabase, id.data, parsed.data.archived);
  if (error) {
    return context.redirect(settingsErrorUrl("roles", error));
  }

  return context.redirect(settingsSavedUrl("roles"));
};
