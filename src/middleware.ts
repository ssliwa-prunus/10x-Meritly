import { defineMiddleware } from "astro:middleware";
import { decideAccess, matchesRoute, SET_PASSWORD_ROUTES } from "@/lib/route-access";
import { isInviteSession } from "@/lib/set-password";
import { createClient } from "@/lib/supabase";
import type { Profile } from "@/types";

// Route lists and the access decision live in @/lib/route-access (pure, unit-tested).
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

  const { pathname, search } = context.url;
  const decision = decideAccess(pathname, search, {
    signedIn: context.locals.user !== null,
    role: context.locals.profile?.role ?? null,
    profileError: context.locals.profileError,
  });

  switch (decision.kind) {
    case "redirect":
      return context.redirect(decision.location);
    case "forbidden":
      return new Response("Forbidden", { status: 403 });
    case "unavailable":
      return new Response("Service temporarily unavailable", { status: 503 });
    case "allow":
      break;
  }

  // Invite acceptance only: a session from a regular password sign-in cannot set a password here.
  if (matchesRoute(pathname, SET_PASSWORD_ROUTES)) {
    if (!supabase || !(await isInviteSession(supabase))) {
      return context.redirect("/dashboard");
    }
  }

  return next();
});
