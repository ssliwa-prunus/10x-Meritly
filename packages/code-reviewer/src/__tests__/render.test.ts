import { describe, expect, it } from "vitest";
import { evaluate } from "../evaluate.js";
import { COMMENT_MARKER, renderComment, renderErrorComment, sanitizeErrorMessage } from "../render.js";
import type { Review } from "../schemas/review.js";

const review: Review = {
  summary: "Adds a thing.",
  scores: { correctness: 9, idiomaticity: 8, complexity: 7, testCoverage: 4, documentation: 8, security: 6 },
  findings: [
    { file: "a.ts", line: 3, severity: "major", category: "tests", message: "No test.", suggestion: "Add one." },
    { file: "b.ts", severity: "nit", category: "style", message: "Naming." },
  ],
};

function render(overrides: Partial<Parameters<typeof renderComment>[0]> = {}) {
  return renderComment({
    review,
    evaluation: evaluate(review.scores),
    truncated: false,
    originalChars: 100,
    keptChars: 100,
    ...overrides,
  });
}

describe("renderComment", () => {
  it("starts with the marker and a failed heading", () => {
    const text = render();
    expect(text.startsWith(COMMENT_MARKER)).toBe(true);
    expect(text).toContain("AI code review: failed");
  });

  it("marks the failing criteria in the table", () => {
    const text = render();
    expect(text).toContain("| Test / risk coverage | 4 | 6 | below threshold |");
    expect(text).toContain("| Security and safety | 6 | 7 | below threshold |");
    expect(text).toContain("| Implementation correctness | 9 | 6 | ok |");
  });

  it("marks a score exactly on the threshold as ok", () => {
    const edge: Review = {
      ...review,
      scores: { correctness: 6, idiomaticity: 6, complexity: 6, testCoverage: 6, documentation: 6, security: 7 },
    };
    const text = render({ review: edge, evaluation: evaluate(edge.scores) });
    expect(text).toContain("| Implementation correctness | 6 | 6 | ok |");
    expect(text).toContain("| Security and safety | 7 | 7 | ok |");
    expect(text).not.toContain("below threshold");
  });

  it("shows a passed heading when the evaluation passes", () => {
    const passing: Review = { ...review, scores: { ...review.scores, testCoverage: 8, security: 8 } };
    expect(render({ review: passing, evaluation: evaluate(passing.scores) })).toContain("AI code review: passed");
  });

  it("renders findings with location and suggestion, ordered by severity", () => {
    const text = render();
    expect(text).toContain("`a.ts:3` (tests) No test.");
    expect(text).toContain("Suggestion: Add one.");
    expect(text.indexOf("**major**")).toBeLessThan(text.indexOf("**nit**"));
  });

  it("shows the truncation notice only when truncated", () => {
    expect(render()).not.toContain("truncated");
    expect(render({ truncated: true, originalChars: 900, keptChars: 500 })).toContain(
      "500 of 900 characters reviewed",
    );
  });

  it("says when there are no findings and shows usage when given", () => {
    const text = render({ review: { ...review, findings: [] }, usage: { inputTokens: 10, outputTokens: 5 } });
    expect(text).toContain("No findings.");
    expect(text).toContain("Tokens: 10 input, 5 output");
  });
});

describe("renderErrorComment", () => {
  it("has the marker and the message and mentions the retry label", () => {
    const text = renderErrorComment("boom");
    expect(text.startsWith(COMMENT_MARKER)).toBe(true);
    expect(text).toContain("boom");
    expect(text).toContain("ai-cr:review");
  });
});

describe("sanitizeErrorMessage", () => {
  it("keeps only the first non-empty line and drops URLs", () => {
    const raw = "\nAI_APICallError: out of credits, see https://openrouter.ai/keys/abc123 to adjust\n    at stack frame";
    expect(sanitizeErrorMessage(raw)).toBe("AI_APICallError: out of credits, see [url] to adjust");
  });

  it("truncates long messages and handles empty input", () => {
    expect(sanitizeErrorMessage("x".repeat(500))).toHaveLength(300);
    expect(sanitizeErrorMessage("")).toBe("Unknown error");
  });
});
