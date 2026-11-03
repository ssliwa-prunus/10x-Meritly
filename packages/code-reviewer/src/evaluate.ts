import { CRITERIA, type Criterion, type Scores } from "./schemas/review.js";

export const MIN_SCORE = 6;
export const MIN_SECURITY_SCORE = 7;

export interface FailingCriterion {
  criterion: Criterion;
  score: number;
  required: number;
}

export interface Evaluation {
  passed: boolean;
  failing: FailingCriterion[];
}

export function requiredScore(criterion: Criterion): number {
  return criterion === "security" ? MIN_SECURITY_SCORE : MIN_SCORE;
}

export function evaluate(scores: Scores): Evaluation {
  const failing: FailingCriterion[] = [];
  for (const criterion of CRITERIA) {
    const required = requiredScore(criterion);
    const score = scores[criterion];
    if (score < required) failing.push({ criterion, score, required });
  }
  return { passed: failing.length === 0, failing };
}
