import type { APIRoute } from "astro";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;
  // A same-origin path to return to after sign-in; anything else falls back to "/".
  const next = safeNext(form.get("next"));
  const nextParam = next ? `&next=${encodeURIComponent(next)}` : "";

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=not_configured${nextParam}`);
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Only a fixed code travels in the URL; the sign-in page maps it to catalog text.
    const code =
      error.code === "invalid_credentials" || error.code === "email_not_confirmed" ? error.code : "signin_failed";
    return context.redirect(`/auth/signin?error=${code}${nextParam}`);
  }

  return context.redirect(next ?? "/");
};
