import type { APIRoute } from "astro";
import { z } from "zod";
import { logContextFrom, logError } from "@/lib/error-log";
import { LOCALE_COOKIE, LOCALES, localeCookieOptions } from "@/lib/i18n";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase";

// Language switch (public, works without JavaScript): sets the `lang` cookie, saves the choice to
// the signed-in user's profile through set_my_locale, and returns to the same page. An invalid
// locale changes nothing. A failed profile write is logged and never blocks: the cookie decides
// what is rendered.
const localeFormSchema = z.object({
  locale: z.enum(LOCALES),
});

export const POST: APIRoute = async (context) => {
  // A body that is not a form changes nothing (same guard as parseForm in @/lib/forms).
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    return context.redirect("/");
  }
  const next = safeNext(form.get("next")) ?? "/";
  const parsed = localeFormSchema.safeParse({ locale: form.get("locale") });

  if (parsed.success) {
    const { locale } = parsed.data;
    context.cookies.set(LOCALE_COOKIE, locale, localeCookieOptions(context.url));

    if (context.locals.user) {
      const supabase = createClient(context.request.headers, context.cookies);
      const { error, status } = supabase
        ? await supabase.rpc("set_my_locale", { p_locale: locale })
        : { error: null, status: undefined };
      if (error) {
        logError("error", "set_my_locale", error, {
          status,
          log: logContextFrom(context.locals, context.request),
        });
      }
    }
  }

  return context.redirect(next);
};
