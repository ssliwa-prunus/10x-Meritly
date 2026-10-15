import type { APIRoute } from "astro";
import { LOCALE_COOKIE } from "@/lib/i18n";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (supabase) {
    await supabase.auth.signOut();
  }
  // The language cookie may have been restored from this user's profile; never carry it into the next user's sign-in.
  context.cookies.delete(LOCALE_COOKIE, { path: "/" });
  return context.redirect("/");
};
