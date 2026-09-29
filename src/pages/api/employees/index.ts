import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  adminEmployeeInputSchema,
  createEmployee,
  employeeInputSchema,
  employeesUrl,
  parseForm,
} from "@/lib/services/employees";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(employeesUrl({ error: { code: "not_configured" } }));
  }

  // Admins pick the owner; a Supervisor's employee defaults to themselves (supervisor_id = auth.uid()).
  const schema = context.locals.profile?.role === "admin" ? adminEmployeeInputSchema : employeeInputSchema;
  const parsed = await parseForm(context.request, schema);
  if (parsed.error) {
    return context.redirect(employeesUrl({ error: parsed.error }));
  }

  // Registering never sends email; the invite is a separate action.
  const { error } = await createEmployee(supabase, parsed.data);
  if (error) {
    return context.redirect(employeesUrl({ error }));
  }

  return context.redirect(employeesUrl({ saved: "created" }));
};
