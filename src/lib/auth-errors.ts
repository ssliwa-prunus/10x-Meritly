// ---------------------------------------------------------------------------
// Auth error codes. Only a fixed code travels in the ?error= URL; the page maps it to dictionary
// text (t.auth.signinErrors / t.auth.signupErrors), so a crafted link cannot put arbitrary text on
// the page. Pure (no astro:* imports) so it is unit-testable.
// ---------------------------------------------------------------------------

export const SIGNUP_ERROR_CODES = [
  "not_configured",
  "weak_password",
  "user_already_exists",
  "email_address_invalid",
  "over_email_send_rate_limit",
  "signup_failed",
] as const;

export type SignupErrorCode = (typeof SIGNUP_ERROR_CODES)[number];

/** The URL code for a Supabase Auth signUp error code; anything unrecognised becomes signup_failed. */
export function signupErrorCode(supabaseCode: string | undefined): SignupErrorCode {
  switch (supabaseCode) {
    case "weak_password":
    case "user_already_exists":
    case "email_address_invalid":
    case "over_email_send_rate_limit":
      return supabaseCode;
    case "email_exists":
      return "user_already_exists";
    default:
      return "signup_failed";
  }
}

/**
 * Catalog text for an ?error= value: null when there is no error, the code's message when the
 * catalog has it, otherwise the fallback code's message.
 */
export function errorMessage<Code extends string>(
  catalog: Record<Code, string>,
  param: string | null,
  fallback: Code,
): string | null {
  if (param === null) return null;
  return Object.hasOwn(catalog, param) ? catalog[param as Code] : catalog[fallback];
}
