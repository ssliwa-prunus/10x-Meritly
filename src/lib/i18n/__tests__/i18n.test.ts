import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  format,
  getMessages,
  LOCALE_COOKIE,
  localeCookieOptions,
  parseLocale,
  plural,
  resolveLocale,
} from "@/lib/i18n";
import { en } from "@/lib/i18n/messages/en";
import { pl } from "@/lib/i18n/messages/pl";

// Expected values come from the change's decisions (plan "Locale foundation"): cookie `lang`,
// Polish by default, cookie before profile, the profile restores a missing cookie.

describe("parseLocale", () => {
  it.each(["pl", "en"])("accepts %s", (value) => {
    expect(parseLocale(value)).toBe(value);
  });

  it.each(["de", "PL", "", " en", "en-US"])("rejects the unknown value %j", (value) => {
    expect(parseLocale(value)).toBeNull();
  });

  it.each([undefined, null, 1, {}, ["pl"]])("rejects the non-string %j", (value) => {
    expect(parseLocale(value)).toBeNull();
  });
});

describe("resolveLocale", () => {
  it("prefers a valid cookie and does not rewrite it", () => {
    expect(resolveLocale({ cookie: "en", profileLocale: "pl" })).toEqual({ locale: "en", writeCookie: false });
  });

  it("falls back to the profile and restores the cookie when there is no cookie", () => {
    expect(resolveLocale({ cookie: undefined, profileLocale: "en" })).toEqual({ locale: "en", writeCookie: true });
  });

  it("treats an invalid cookie as missing: profile wins and the cookie is rewritten", () => {
    expect(resolveLocale({ cookie: "de", profileLocale: "en" })).toEqual({ locale: "en", writeCookie: true });
  });

  it("defaults to Polish without writing a cookie when neither is set", () => {
    expect(resolveLocale({ cookie: undefined, profileLocale: null })).toEqual({ locale: "pl", writeCookie: false });
    expect(resolveLocale({ cookie: "xx", profileLocale: "yy" })).toEqual({ locale: "pl", writeCookie: false });
    expect(DEFAULT_LOCALE).toBe("pl");
  });
});

describe("format", () => {
  it("fills named placeholders", () => {
    expect(format("{count} z {total}", { count: 2, total: "5" })).toBe("2 z 5");
  });

  it("leaves unknown placeholders as written", () => {
    expect(format("Hello {name}", {})).toBe("Hello {name}");
  });
});

describe("plural (Polish)", () => {
  const forms = { one: "pracownik", few: "pracowników-few", many: "pracowników-many" };

  it.each([
    [1, "pracownik"],
    [2, "pracowników-few"],
    [4, "pracowników-few"],
    [5, "pracowników-many"],
    [12, "pracowników-many"],
    [22, "pracowników-few"],
    [25, "pracowników-many"],
  ])("%d → %s", (n, expected) => {
    expect(plural("pl", n, forms)).toBe(expected);
  });

  it("uses other (or many) for English plurals", () => {
    expect(plural("en", 1, { ...forms, other: "employees" })).toBe("pracownik");
    expect(plural("en", 3, { ...forms, other: "employees" })).toBe("employees");
  });
});

describe("dictionaries", () => {
  interface Tree {
    [key: string]: string | Tree;
  }

  function walk(tree: Tree, prefix = ""): [string, string][] {
    return Object.entries(tree).flatMap(([key, value]) =>
      typeof value === "string" ? [[`${prefix}${key}`, value] as [string, string]] : walk(value, `${prefix}${key}.`),
    );
  }

  const plEntries = walk(pl);
  const enEntries = walk(en);

  it("pl and en have identical key paths", () => {
    expect(enEntries.map(([path]) => path).sort()).toEqual(plEntries.map(([path]) => path).sort());
  });

  it("no message is empty", () => {
    const empty = [...plEntries.map(([p, v]) => [`pl.${p}`, v]), ...enEntries.map(([p, v]) => [`en.${p}`, v])]
      .filter(([, value]) => value.trim() === "")
      .map(([path]) => path);
    expect(empty).toEqual([]);
  });

  it("getMessages returns the dictionary for the locale", () => {
    expect(getMessages("pl").layout.languageSwitch).toBe("Język");
    expect(getMessages("en").layout.languageSwitch).toBe("Language");
  });
});

describe("locale cookie", () => {
  it("is named lang, lives a year and is secure only over https", () => {
    expect(LOCALE_COOKIE).toBe("lang");
    expect(localeCookieOptions(new URL("https://meritly.example/"))).toEqual({
      path: "/",
      maxAge: 31536000,
      sameSite: "lax",
      httpOnly: true,
      secure: true,
    });
    expect(localeCookieOptions(new URL("http://localhost:4321/")).secure).toBe(false);
  });
});
