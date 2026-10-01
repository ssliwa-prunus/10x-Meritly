import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect("/auth/signin?error=not_configured");
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Only a fixed code travels in the URL; the sign-in page maps it to catalog text.
    const code =
      error.code === "invalid_credentials" || error.code === "email_not_confirmed" ? error.code : "signin_failed";
    return context.redirect(`/auth/signin?error=${code}`);
  }

  return context.redirect("/");
};
