import { defineMiddleware } from "astro:middleware";
import { logContextFrom, logError } from "@/lib/error-log";
import { LOCALE_COOKIE, localeCookieOptions, resolveLocale } from "@/lib/i18n";
import { discardUnreadBody } from "@/lib/request-body";
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
      const { data, error, status } = await supabase
        .from("profiles")
        .select("id, email, display_name, role, locale")
        .eq("id", user.id)
        .maybeSingle<Profile>();

      if (error) {
        context.locals.profileError = true;
        logError("error", "Profile lookup", error, {
          status,
          log: logContextFrom(context.locals, context.request),
        });
      } else {
        context.locals.profile = data;
      }
    }
  }

  // Before the access decision, so redirect targets and error paths render in the right language.
  // A signed-in request without a valid cookie gets it restored from the saved profile choice.
  const { locale, writeCookie } = resolveLocale({
    cookie: context.cookies.get(LOCALE_COOKIE)?.value,
    profileLocale: context.locals.profile?.locale,
  });
  context.locals.locale = locale;
  if (writeCookie) {
    context.cookies.set(LOCALE_COOKIE, locale, localeCookieOptions(context.url));
  }

  const { pathname, search } = context.url;
  const decision = decideAccess(pathname, search, {
    signedIn: context.locals.user !== null,
    role: context.locals.profile?.role ?? null,
    profileError: context.locals.profileError,
  });

  // Early answers never reach a handler, so the request body they leave unread is released first.
  if (decision.kind !== "allow") await discardUnreadBody(context.request);
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
      await discardUnreadBody(context.request);
      return context.redirect("/dashboard");
    }
  }

  return next();
});
