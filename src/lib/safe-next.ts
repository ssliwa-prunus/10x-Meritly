import { z } from "zod";

// ---------------------------------------------------------------------------
// Post-sign-in return target (?next=). Only a same-origin path is accepted, so a crafted link
// cannot turn sign-in into an open redirect: it starts with "/", not with "//" or "/\" (both are
// protocol-relative to browsers), and carries no scheme, backslash or control character.
// Middleware, the sign-in page and the sign-in API all use this one check.
// ---------------------------------------------------------------------------

const NEXT_MAX_LENGTH = 512;

export const safeNextSchema = z
  .string()
  .max(NEXT_MAX_LENGTH)
  .refine((value) => value.startsWith("/"), "must be a path")
  .refine((value) => !value.startsWith("//"), "must not be protocol-relative")
  .refine((value) => !value.includes("\\"), "must not contain a backslash")
  .refine((value) => !/^\/*[a-z][a-z0-9+.-]*:/i.test(value), "must not carry a scheme")
  // eslint-disable-next-line no-control-regex -- intentional: rejects control characters (e.g. tab/newline smuggling)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "must not contain control characters");

/** The value as a same-origin path, or null when it is missing or unsafe. */
export function safeNext(value: unknown): string | null {
  const parsed = safeNextSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
