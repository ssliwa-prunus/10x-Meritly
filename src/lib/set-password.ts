import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Set-password form (invite acceptance). Errors travel to /auth/set-password as a fixed code in the
// redirect URL, never as free text; the page resolves them with setPasswordErrorMessage().
// ---------------------------------------------------------------------------

const SET_PASSWORD_ERROR_MESSAGES = {
  invalid_form: "Invalid form submission",
  required: "Enter and confirm your new password",
  password_too_short: "Password must be at least 6 characters",
  password_too_long: "Password must be at most 72 characters",
  password_mismatch: "Passwords do not match",
  update_failed: "Could not set your password. Please try again.",
  not_configured: "Supabase is not configured",
} as const;

export type SetPasswordErrorCode = keyof typeof SET_PASSWORD_ERROR_MESSAGES;

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export const isSetPasswordErrorCode = (value: string): value is SetPasswordErrorCode =>
  Object.hasOwn(SET_PASSWORD_ERROR_MESSAGES, value);

/** Message for an error code taken from the URL. Only fixed catalog text is ever returned. */
export function setPasswordErrorMessage(code: string): string {
  return isSetPasswordErrorCode(code) ? SET_PASSWORD_ERROR_MESSAGES[code] : GENERIC_ERROR_MESSAGE;
}

/** Minimum matches supabase/config.toml minimum_password_length; 72 is the Auth (bcrypt) maximum. Not trimmed. */
export const setPasswordSchema = z
  .object({
    password: z
      .string({ error: "required" })
      .min(1, "required")
      .min(6, "password_too_short")
      .max(72, "password_too_long"),
    confirm_password: z.string({ error: "required" }).min(1, "required"),
  })
  .refine((input) => input.password === input.confirm_password, {
    message: "password_mismatch",
    path: ["confirm_password"],
  });

export const setPasswordUrl = (code: SetPasswordErrorCode | "invalid_form") =>
  `/auth/set-password?${new URLSearchParams({ error: code }).toString()}`;

const INVITE_AMR_METHODS = new Set(["invite", "otp"]);

/**
 * True when the current session was created by an invite link: the most recent sign-in method in
 * the verified JWT's `amr` claim (most recent first, token refreshes skipped) is invite/otp. A
 * password sign-in never qualifies, so a stolen regular session cannot set a new password here.
 */
export async function isInviteSession(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return false;
  const methods = (data.claims.amr ?? []).map((entry) => (typeof entry === "string" ? entry : entry.method));
  const latest = methods.find((method) => method !== "token_refresh");
  return latest !== undefined && INVITE_AMR_METHODS.has(latest);
}
