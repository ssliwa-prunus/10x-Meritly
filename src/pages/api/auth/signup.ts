import type { APIRoute } from "astro";
import { signupErrorCode } from "@/lib/auth-errors";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect("/auth/signup?error=not_configured");
  }
  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    // Only a fixed code travels in the URL; the sign-up page maps it to dictionary text.
    return context.redirect(`/auth/signup?error=${signupErrorCode(error.code)}`);
  }

  return context.redirect("/auth/confirm-email");
};
