import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_DIFF_CHARS, maxDiffCharsFromEnv, truncateDiff } from "../truncate.js";

describe("truncateDiff", () => {
  it("leaves a diff under the limit untouched", () => {
    expect(truncateDiff("a\nb", 10)).toEqual({ diff: "a\nb", truncated: false, originalChars: 3 });
  });

  it("leaves a diff exactly at the limit untouched", () => {
    expect(truncateDiff("abcde", 5).truncated).toBe(false);
  });

  it("cuts an oversized diff on a line boundary", () => {
    const result = truncateDiff("line1\nline2\nline3", 8);
    expect(result).toEqual({ diff: "line1", truncated: true, originalChars: 17 });
  });

  it("hard cuts when there is no newline to cut on", () => {
    const result = truncateDiff("abcdefghij", 4);
    expect(result.diff).toBe("abcd");
    expect(result.truncated).toBe(true);
  });
});

describe("maxDiffCharsFromEnv", () => {
  it("uses the default without a valid value", () => {
    expect(maxDiffCharsFromEnv({})).toBe(DEFAULT_MAX_DIFF_CHARS);
    expect(maxDiffCharsFromEnv({ REVIEW_MAX_DIFF_CHARS: "abc" })).toBe(DEFAULT_MAX_DIFF_CHARS);
    expect(maxDiffCharsFromEnv({ REVIEW_MAX_DIFF_CHARS: "0" })).toBe(DEFAULT_MAX_DIFF_CHARS);
  });

  it("reads a valid override", () => {
    expect(maxDiffCharsFromEnv({ REVIEW_MAX_DIFF_CHARS: "1000" })).toBe(1000);
  });
});
