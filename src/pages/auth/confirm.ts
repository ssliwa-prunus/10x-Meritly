import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";

// Invite links from the email template land here: {{ .SiteURL }}/auth/confirm?token_hash=…&type=invite.
// verifyOtp exchanges the token hash for a session server-side (the SSR client writes the session
// cookies), then the new user sets a password. Any failure shows a fixed message on sign-in.

const confirmQuerySchema = z.object({
  token_hash: z.string().trim().min(1),
  type: z.enum(["invite"]),
});

const INVITE_INVALID_URL = "/auth/signin?error=invite_invalid";

export const GET: APIRoute = async (context) => {
  const parsed = confirmQuerySchema.safeParse({
    token_hash: context.url.searchParams.get("token_hash") ?? undefined,
    type: context.url.searchParams.get("type") ?? undefined,
  });
  if (!parsed.success) {
    return context.redirect(INVITE_INVALID_URL);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(INVITE_INVALID_URL);
  }

  const { error } = await supabase.auth.verifyOtp({ token_hash: parsed.data.token_hash, type: parsed.data.type });
  if (error) {
    return context.redirect(INVITE_INVALID_URL);
  }

  return context.redirect("/auth/set-password");
};
