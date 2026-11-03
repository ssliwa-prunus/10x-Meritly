import { Output, ToolLoopAgent, type LanguageModel } from "ai";
import { createModel } from "../model.js";
import { buildReviewPrompt, REVIEWER_INSTRUCTIONS } from "../prompts/reviewer.js";
import type { Usage } from "../render.js";
import { ReviewInputSchema, ReviewSchema, type Review, type ReviewInput } from "../schemas/review.js";

// Caps the answer length: bounds cost per run and avoids reserving the model's full default output budget.
export const MAX_OUTPUT_TOKENS = 8192;

export function createReviewer(options: { model?: LanguageModel } = {}) {
  return new ToolLoopAgent({
    model: options.model ?? createModel(),
    instructions: REVIEWER_INSTRUCTIONS,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    output: Output.object({ schema: ReviewSchema }),
  });
}

export type Reviewer = ReturnType<typeof createReviewer>;

export interface ReviewResult {
  review: Review;
  usage: Usage;
}

export async function reviewDiff(input: ReviewInput, agent?: Reviewer): Promise<ReviewResult> {
  const parsed = ReviewInputSchema.parse(input);
  const reviewer = agent ?? createReviewer();
  const result = await reviewer.generate({ prompt: buildReviewPrompt(parsed) });
  const { inputTokens, outputTokens, totalTokens } = result.totalUsage;
  return { review: result.output, usage: { inputTokens, outputTokens, totalTokens } };
}
