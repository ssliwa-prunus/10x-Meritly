import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-next";

// The ?next= return target after sign-in must stay a same-origin path, so a crafted link cannot
// turn sign-in into an open redirect. Browsers treat "//host" and "/\host" as protocol-relative.

describe("safeNext", () => {
  it.each([
    "/projects",
    "/projects?tab=x",
    "/projects/a1/milestones/b2#approval",
    "/%2F%2Fevil.com",
    // A colon is only refused in a scheme-like first segment, not later in the path or query.
    "/projects?filter=status:active",
    "/2026:q1",
  ])("keeps the same-origin path %s", (value) => {
    expect(safeNext(value)).toBe(value);
  });

  it.each([
    ["protocol-relative", "//evil.com"],
    ["backslash authority", "/\\evil.com"],
    ["backslash later in the path", "/projects\\..\\evil"],
    ["absolute URL", "https://evil.com"],
    ["scheme without slash", "javascript:alert(1)"],
    ["scheme after a slash", "/javascript:alert(1)"],
    ["tab smuggling", "/\t/evil.com"],
    ["newline smuggling", "/\n/evil.com"],
    ["carriage return", "/projects\r\nLocation: https://evil.com"],
    ["space", "/projects list"],
    ["raw non-ASCII", "/projekty/ł"],
    ["relative path", "projects"],
    ["empty string", ""],
    ["over 512 characters", `/${"a".repeat(512)}`],
  ])("rejects %s", (_label, value) => {
    expect(safeNext(value)).toBeNull();
  });

  it.each([undefined, null, 42, ["/projects"]])("rejects the non-string %j", (value) => {
    expect(safeNext(value)).toBeNull();
  });

  it("accepts exactly 512 characters", () => {
    const value = `/${"a".repeat(511)}`;
    expect(safeNext(value)).toBe(value);
  });

  // Intended false positive: any first segment that looks like "scheme:" is refused.
  it("rejects a colon in the first segment", () => {
    expect(safeNext("/foo:bar")).toBeNull();
  });
});
