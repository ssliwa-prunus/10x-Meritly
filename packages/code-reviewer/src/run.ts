import { reviewDiff, type Reviewer } from "./agents/reviewer.js";
import { evaluate, type Evaluation } from "./evaluate.js";
import { renderComment, type Usage } from "./render.js";
import type { Review } from "./schemas/review.js";
import { DEFAULT_MAX_DIFF_CHARS, truncateDiff } from "./truncate.js";

export interface RunInput {
  diff: string;
  title?: string;
  description?: string;
  maxDiffChars?: number;
}

export interface RunResult extends Evaluation {
  review: Review;
  truncated: boolean;
  usage: Usage;
  comment: string;
}

export function formatUsage(usage: Usage): string {
  return `Usage: ${usage.inputTokens ?? "?"} input, ${usage.outputTokens ?? "?"} output, ${usage.totalTokens ?? "?"} total tokens`;
}

export async function runReview(input: RunInput, agent?: Reviewer): Promise<RunResult> {
  const cut = truncateDiff(input.diff, input.maxDiffChars ?? DEFAULT_MAX_DIFF_CHARS);
  const { review, usage } = await reviewDiff(
    { diff: cut.diff, title: input.title, description: input.description },
    agent,
  );
  const evaluation = evaluate(review.scores);
  const comment = renderComment({
    review,
    evaluation,
    truncated: cut.truncated,
    originalChars: cut.originalChars,
    keptChars: cut.diff.length,
    usage,
  });
  return { ...evaluation, review, truncated: cut.truncated, usage, comment };
}
