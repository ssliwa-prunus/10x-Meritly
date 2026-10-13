import { describe, expect, it } from "vitest";
import { setPasswordErrorMessage } from "@/lib/set-password";

// Oracle: the code-in-URL contract (set-password.ts header) — a known code renders its catalog text
// in the request's locale; anything else renders the localized generic message.

describe("setPasswordErrorMessage", () => {
  it.each([
    ["en", "password_mismatch", "Passwords do not match"],
    ["pl", "password_mismatch", "Hasła nie są zgodne"],
    ["en", "password_too_short", "Password must be at least 6 characters"],
    ["pl", "password_too_short", "Hasło musi mieć co najmniej 6 znaków"],
  ] as const)("%s %s", (locale, code, expected) => {
    expect(setPasswordErrorMessage(code, locale)).toBe(expected);
  });

  it.each(["boom", "", "toString", "__proto__"])("falls back to the localized generic message for %j", (code) => {
    expect(setPasswordErrorMessage(code, "en")).toBe("Something went wrong. Please try again.");
    expect(setPasswordErrorMessage(code, "pl")).toBe("Coś poszło nie tak. Spróbuj ponownie.");
  });
});
