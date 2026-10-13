import { en } from "./messages/en";
import { pl, type Messages } from "./messages/pl";

// ---------------------------------------------------------------------------
// Locale model, resolution rule and dictionaries. Pure (no astro:* imports) so it is unit-testable.
// The locale lives in the `lang` cookie and in profiles.locale; the latest explicit choice wins.
// Without either the app is Polish (no Accept-Language detection).
// ---------------------------------------------------------------------------

export type { Messages };

export const LOCALES = ["pl", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "pl";
export const LOCALE_COOKIE = "lang";
/** One year, in seconds (cookie maxAge). */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** The value as a supported locale, or null when it is missing, unknown or not a string. */
export function parseLocale(value: unknown): Locale | null {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value) ? (value as Locale) : null;
}

export interface LocaleInputs {
  /** Raw `lang` cookie value, if any. */
  cookie: unknown;
  /** The signed-in user's saved profiles.locale, if any. */
  profileLocale: unknown;
}

export interface ResolvedLocale {
  locale: Locale;
  /** True when the cookie should be (re)written from the profile (new device, cleared cookie). */
  writeCookie: boolean;
}

/** Cookie first, then the saved profile choice (which also restores the cookie), then Polish. */
export function resolveLocale({ cookie, profileLocale }: LocaleInputs): ResolvedLocale {
  const fromCookie = parseLocale(cookie);
  if (fromCookie) return { locale: fromCookie, writeCookie: false };
  const fromProfile = parseLocale(profileLocale);
  if (fromProfile) return { locale: fromProfile, writeCookie: true };
  return { locale: DEFAULT_LOCALE, writeCookie: false };
}

const DICTIONARIES: Record<Locale, Messages> = { pl, en };

export function getMessages(locale: Locale): Messages {
  return DICTIONARIES[locale];
}

/** Fills `{name}` placeholders from `vars`; an unknown placeholder is left as written. */
export function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

export interface PluralForms {
  one: string;
  few: string;
  many: string;
  other?: string;
}

/** Picks the plural form for `n` with Intl.PluralRules (Polish: 1 one, 2–4 few, 5+ many). */
export function plural(locale: Locale, n: number, forms: PluralForms): string {
  const category = new Intl.PluralRules(locale).select(n);
  switch (category) {
    case "one":
      return forms.one;
    case "few":
      return forms.few;
    case "many":
      return forms.many;
    default:
      return forms.other ?? forms.many;
  }
}

/** Cookie attributes shared by the switch endpoint and the middleware's restore-from-profile. */
export function localeCookieOptions(url: URL) {
  return {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax" as const,
    httpOnly: true,
    secure: url.protocol === "https:",
  };
}
