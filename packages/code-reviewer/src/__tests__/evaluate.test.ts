import { describe, expect, it } from "vitest";
import { evaluate } from "../evaluate.js";
import type { Scores } from "../schemas/review.js";

const good: Scores = {
  correctness: 8,
  idiomaticity: 8,
  complexity: 8,
  testCoverage: 8,
  documentation: 8,
  security: 8,
};

describe("evaluate", () => {
  it("passes when every score is high", () => {
    expect(evaluate(good)).toEqual({ passed: true, failing: [] });
  });

  it("passes at exactly 6 for non-security criteria and 7 for security", () => {
    const edge: Scores = { ...good, correctness: 6, documentation: 6, security: 7 };
    expect(evaluate(edge).passed).toBe(true);
  });

  it("fails when a non-security criterion is 5", () => {
    const result = evaluate({ ...good, documentation: 5 });
    expect(result.passed).toBe(false);
    expect(result.failing).toEqual([{ criterion: "documentation", score: 5, required: 6 }]);
  });

  it("fails when security is 6 even though 6 is enough elsewhere", () => {
    const result = evaluate({ ...good, security: 6 });
    expect(result.passed).toBe(false);
    expect(result.failing).toEqual([{ criterion: "security", score: 6, required: 7 }]);
  });

  it("reports every failing criterion", () => {
    const result = evaluate({ ...good, correctness: 2, testCoverage: 4, security: 3 });
    expect(result.failing.map((f) => f.criterion)).toEqual(["correctness", "testCoverage", "security"]);
  });
});
