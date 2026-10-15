import { describe, expect, it } from "vitest";
import { errorMessage, SIGNUP_ERROR_CODES, signupErrorCode } from "@/lib/auth-errors";
import { format, getMessages, plural } from "@/lib/i18n";

// Expected codes come from the plan ("Signup error codes") and Supabase Auth's documented error codes.

describe("signupErrorCode", () => {
  it.each(["weak_password", "user_already_exists", "email_address_invalid", "over_email_send_rate_limit"])(
    "passes the known code %s through",
    (code) => {
      expect(signupErrorCode(code)).toBe(code);
    },
  );

  it("maps email_exists to user_already_exists", () => {
    expect(signupErrorCode("email_exists")).toBe("user_already_exists");
  });

  it.each([undefined, "", "unexpected_failure", "not_configured", "<script>"])("maps %j to signup_failed", (code) => {
    expect(signupErrorCode(code)).toBe("signup_failed");
  });
});

describe("errorMessage", () => {
  const catalog = { known: "Known text", fallback: "Fallback text" };

  it("is null without an error parameter", () => {
    expect(errorMessage(catalog, null, "fallback")).toBeNull();
  });

  it("returns the catalog text for a known code", () => {
    expect(errorMessage(catalog, "known", "fallback")).toBe("Known text");
  });

  it.each(["", "Arbitrary injected text", "toString", "__proto__"])("returns the fallback for %j", (param) => {
    expect(errorMessage(catalog, param, "fallback")).toBe("Fallback text");
  });
});

describe("signup error dictionary", () => {
  it.each(["pl", "en"] as const)("has a message for every signup code in %s", (locale) => {
    const catalog = getMessages(locale).auth.signupErrors;
    expect(Object.keys(catalog).sort()).toEqual([...SIGNUP_ERROR_CODES].sort());
  });

  it("resolves an unknown code to the localised signup_failed text", () => {
    expect(errorMessage(getMessages("pl").auth.signupErrors, "nope", "signup_failed")).toBe(
      "Nie udało się założyć konta. Spróbuj ponownie.",
    );
    expect(errorMessage(getMessages("en").auth.signupErrors, "email_exists", "signup_failed")).toBe(
      "Could not create your account. Please try again.",
    );
  });
});

describe("sign-up 'characters needed' hint", () => {
  const hint = (locale: "pl" | "en", count: number) =>
    format(plural(locale, count, getMessages(locale).auth.signUpForm.charsNeeded), { count });

  it.each([
    [1, "Wpisz jeszcze 1 znak"],
    [3, "Wpisz jeszcze 3 znaki"],
    [5, "Wpisz jeszcze 5 znaków"],
  ])("Polish: %d → %s", (count, expected) => {
    expect(hint("pl", count)).toBe(expected);
  });

  it.each([
    [1, "1 more character needed"],
    [3, "3 more characters needed"],
  ])("English: %d → %s", (count, expected) => {
    expect(hint("en", count)).toBe(expected);
  });
});
