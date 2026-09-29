import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { employeeIdSchema, employeesUrl, firstIssueError, inviteEmployee } from "@/lib/services/employees";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(employeesUrl({ error: { code: "not_configured" } }));
  }

  const id = employeeIdSchema.safeParse(context.params.id);
  if (!id.success) {
    return context.redirect(employeesUrl({ error: firstIssueError(id.error) }));
  }

  // The Edge Function re-checks the caller's role and ownership; the Worker never holds the secret key.
  const { error } = await inviteEmployee(supabase, id.data);
  if (error) {
    return context.redirect(employeesUrl({ error }, id.data));
  }

  return context.redirect(employeesUrl({ saved: "invited" }));
};
