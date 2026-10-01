// invite-employee: sends (or re-sends) the Supabase invite email for one employee and links the
// invited auth user to the employee row. This is the only code that uses the secret key; it runs
// in Supabase Edge Functions, never in the Worker.
//
// Request:  POST { "employee_id": "<uuid>" } with the signed-in user's JWT (verify_jwt = true).
// Responses:
//   200 { ok: true }
//   400 { code: "invalid_request" }    body is not { employee_id: uuid }
//   403 { code: "forbidden" }          caller is neither a Supervisor nor an Admin
//   404 { code: "not_found" }          row not visible to the caller, or a Supervisor who does not own it
//   409 { code: "already_active" }     the employee has already accepted an invite
//   409 { code: "email_unavailable" }  Auth rejected the email (e.g. an existing confirmed account)
//   500 { code: "invite_failed" }      anything else (logged)
//
// Ownership is checked explicitly: a Supervisor can SEE employees they do not own (engaged on the
// Supervisor's milestones), so visibility through RLS alone is not enough.

import { withSupabase } from "npm:@supabase/server@^1";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface EmployeeRow {
  id: string;
  supervisor_id: string;
  full_name: string;
  email: string;
  activated_at: string | null;
}

const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

async function readEmployeeId(req: Request): Promise<string | null> {
  try {
    const body: unknown = await req.json();
    if (typeof body !== "object" || body === null) return null;
    const value = (body as Record<string, unknown>).employee_id;
    return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return reply(400, { code: "invalid_request" });

    const employeeId = await readEmployeeId(req);
    if (!employeeId) return reply(400, { code: "invalid_request" });

    // Role through the caller's own client (current_app_role reads profiles for auth.uid()).
    const { data: role, error: roleError } = await ctx.supabase.rpc("current_app_role");
    if (roleError) {
      console.error("invite-employee: role lookup failed", { code: roleError.code, message: roleError.message });
      return reply(500, { code: "invite_failed" });
    }
    if (role !== "supervisor" && role !== "admin") return reply(403, { code: "forbidden" });

    // Visibility through RLS first, then explicit ownership for Supervisors.
    const { data: employee, error: loadError } = await ctx.supabase
      .from("employees")
      .select("id, supervisor_id, full_name, email, activated_at")
      .eq("id", employeeId)
      .maybeSingle<EmployeeRow>();
    if (loadError) {
      console.error("invite-employee: employee lookup failed", { code: loadError.code, message: loadError.message });
      return reply(500, { code: "invite_failed" });
    }
    if (!employee) return reply(404, { code: "not_found" });
    if (role === "supervisor" && employee.supervisor_id !== ctx.userClaims?.id) {
      return reply(404, { code: "not_found" });
    }

    if (employee.activated_at !== null) return reply(409, { code: "already_active" });

    const { data: invited, error: inviteError } = await ctx.supabaseAdmin.auth.admin.inviteUserByEmail(
      employee.email,
      { data: { display_name: employee.full_name } },
    );
    if (inviteError || !invited.user) {
      const status = inviteError?.status;
      // A client-side rejection (e.g. the email already belongs to a confirmed account). Generic
      // on purpose: the caller learns nothing about other accounts. Rate limits (429) and server
      // errors are failures, not an unavailable email.
      if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
        return reply(409, { code: "email_unavailable" });
      }
      console.error("invite-employee: invite failed", {
        employeeId,
        status,
        code: inviteError?.code,
        message: inviteError?.message,
      });
      return reply(500, { code: "invite_failed" });
    }

    // System-written columns (not writable by authenticated), so the admin client stamps them.
    const { error: linkError } = await ctx.supabaseAdmin
      .from("employees")
      .update({ profile_id: invited.user.id, invited_at: new Date().toISOString() })
      .eq("id", employee.id);
    if (linkError) {
      console.error("invite-employee: linking the invited user failed", {
        employeeId,
        code: linkError.code,
        message: linkError.message,
      });
      return reply(500, { code: "invite_failed" });
    }

    return reply(200, { ok: true });
  }),
};
