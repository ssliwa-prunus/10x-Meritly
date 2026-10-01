import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  adminEmployeeUpdateSchema,
  employeeIdSchema,
  employeesUrl,
  employeeUpdateSchema,
  firstIssueError,
  parseForm,
  updateEmployee,
} from "@/lib/services/employees";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(employeesUrl({ error: { code: "not_configured" } }));
  }

  const id = employeeIdSchema.safeParse(context.params.id);
  if (!id.success) {
    return context.redirect(employeesUrl({ error: firstIssueError(id.error) }));
  }

  // The Supervisor schema has no owner field, so a Supervisor's update leaves supervisor_id untouched.
  // The email is optional: its input is disabled (not posted) once the employee is invited.
  const schema = context.locals.profile?.role === "admin" ? adminEmployeeUpdateSchema : employeeUpdateSchema;
  const parsed = await parseForm(context.request, schema);
  if (parsed.error) {
    return context.redirect(employeesUrl({ error: parsed.error }, id.data));
  }

  const { error } = await updateEmployee(supabase, id.data, parsed.data);
  if (error) {
    return context.redirect(employeesUrl({ error }, id.data));
  }

  return context.redirect(employeesUrl({ saved: "updated" }));
};
