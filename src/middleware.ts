import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";
import type { Profile } from "@/types";

const PROTECTED_ROUTES = ["/dashboard", "/admin"];
const ADMIN_ROUTES = ["/admin"];

const matchesRoute = (pathname: string, routes: string[]) => routes.some((route) => pathname.startsWith(route));

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  context.locals.user = null;
  context.locals.profile = null;
  context.locals.profileError = false;

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;

    if (user) {
      // Queried as the signed-in user, so RLS applies.
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, display_name, role")
        .eq("id", user.id)
        .maybeSingle<Profile>();

      if (error) {
        context.locals.profileError = true;
        // eslint-disable-next-line no-console -- intentional: surfaces DB outages in Workers observability logs
        console.error("Profile lookup failed", { userId: user.id, code: error.code, message: error.message });
      } else {
        context.locals.profile = data;
      }
    }
  }

  const { pathname } = context.url;

  if (matchesRoute(pathname, PROTECTED_ROUTES)) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  if (matchesRoute(pathname, ADMIN_ROUTES)) {
    if (context.locals.profileError) {
      return new Response("Service temporarily unavailable", { status: 503 });
    }
    if (context.locals.profile?.role !== "admin") {
      return new Response("Forbidden", { status: 403 });
    }
  }

  return next();
});
