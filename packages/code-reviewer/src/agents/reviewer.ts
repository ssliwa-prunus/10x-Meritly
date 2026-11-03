import { Output, ToolLoopAgent, type LanguageModel } from "ai";
import { createModel } from "../model.js";
import { buildReviewPrompt, REVIEWER_INSTRUCTIONS } from "../prompts/reviewer.js";
import { ReviewInputSchema, ReviewSchema, type Review, type ReviewInput } from "../schemas/review.js";

export function createReviewer(options: { model?: LanguageModel } = {}) {
  return new ToolLoopAgent({
    model: options.model ?? createModel(),
    instructions: REVIEWER_INSTRUCTIONS,
    output: Output.object({ schema: ReviewSchema }),
  });
}

export type Reviewer = ReturnType<typeof createReviewer>;

export async function reviewDiff(input: ReviewInput, agent?: Reviewer): Promise<Review> {
  const parsed = ReviewInputSchema.parse(input);
  const reviewer = agent ?? createReviewer();
  const result = await reviewer.generate({ prompt: buildReviewPrompt(parsed) });
  return result.output;
}
