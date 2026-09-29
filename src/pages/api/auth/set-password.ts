import type { APIRoute } from "astro";
import { parseForm } from "@/lib/forms";
import { isSetPasswordErrorCode, setPasswordSchema, setPasswordUrl } from "@/lib/set-password";
import { createClient } from "@/lib/supabase";

// Invited users arrive here signed in (via /auth/confirm); the middleware keeps anonymous callers out.
export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(setPasswordUrl("not_configured"));
  }

  const parsed = await parseForm(context.request, setPasswordSchema, isSetPasswordErrorCode);
  if (parsed.error) {
    return context.redirect(setPasswordUrl(parsed.error.code));
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    // eslint-disable-next-line no-console -- intentional: surfaces Auth failures in Workers observability logs
    console.error("Set password failed", { status: error.status, code: error.code });
    return context.redirect(setPasswordUrl("update_failed"));
  }

  return context.redirect("/dashboard");
};
