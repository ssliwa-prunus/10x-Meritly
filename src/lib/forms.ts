import type { z } from "zod";

// ---------------------------------------------------------------------------
// Catalog-agnostic form helpers. Each service owns its error catalog and passes its type guard;
// schema issue messages are catalog codes, and anything outside the catalog becomes
// invalid_form, so free text never reaches a redirect URL.
// ---------------------------------------------------------------------------

export interface FormError<C extends string> {
  code: C | "invalid_form";
  field?: string;
}

/** First issue of a failed parse as an error code plus the offending field, if any. */
export function firstIssueError<C extends string>(
  error: z.ZodError,
  isCode: (value: string) => value is C,
): FormError<C> {
  const issue = error.issues.at(0);
  if (!issue || !isCode(issue.message)) return { code: "invalid_form" };
  const field = typeof issue.path[0] === "string" ? issue.path[0] : undefined;
  return { code: issue.message, field };
}

/** Reads the request body as form data and validates it; a body that isn't form data is an error, not a 500. */
export async function parseForm<T extends z.ZodType, C extends string>(
  request: Request,
  schema: T,
  isCode: (value: string) => value is C,
): Promise<{ data: z.output<T>; error?: undefined } | { data?: undefined; error: FormError<C> }> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { error: { code: "invalid_form" } };
  }
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: firstIssueError(parsed.error, isCode) };
  return { data: parsed.data };
}
