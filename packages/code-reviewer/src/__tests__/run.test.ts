import { describe, expect, it } from "vitest";
import type { Reviewer } from "../agents/reviewer.js";
import { formatUsage, runReview } from "../run.js";
import type { Review } from "../schemas/review.js";

const review: Review = {
  summary: "Fine.",
  scores: { correctness: 9, idiomaticity: 9, complexity: 9, testCoverage: 9, documentation: 9, security: 9 },
  findings: [],
};

function fakeAgent(output: Review = review) {
  const prompts: string[] = [];
  const agent = {
    generate: async ({ prompt }: { prompt: string }) => {
      prompts.push(prompt);
      return { output, totalUsage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
    },
  } as unknown as Reviewer;
  return { agent, prompts };
}

describe("runReview", () => {
  it("returns pass, comment and usage for a good review", async () => {
    const { agent } = fakeAgent();
    const result = await runReview({ diff: "diff --git a b" }, agent);
    expect(result.passed).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20, totalTokens: 120 });
    expect(result.comment).toContain("AI code review: passed");
  });

  it("fails the review when a score is below the threshold", async () => {
    const { agent } = fakeAgent({ ...review, scores: { ...review.scores, security: 6 } });
    const result = await runReview({ diff: "x" }, agent);
    expect(result.passed).toBe(false);
    expect(result.failing).toEqual([{ criterion: "security", score: 6, required: 7 }]);
  });

  it("passes title and description to the model and truncates the diff", async () => {
    const { agent, prompts } = fakeAgent();
    const result = await runReview(
      { diff: "line1\nline2\nline3", title: "My title", description: "My description", maxDiffChars: 8 },
      agent,
    );
    expect(result.truncated).toBe(true);
    expect(result.comment).toContain("truncated");
    expect(prompts[0]).toContain("Title: My title");
    expect(prompts[0]).toContain("My description");
    expect(prompts[0]).toContain("line1");
    expect(prompts[0]).not.toContain("line2");
  });
});

describe("formatUsage", () => {
  it("prints a question mark for unknown counts", () => {
    expect(formatUsage({ inputTokens: 5 })).toBe("Usage: 5 input, ? output, ? total tokens");
  });
});
