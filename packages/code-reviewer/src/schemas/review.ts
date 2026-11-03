import { z } from "zod";

export const FindingSchema = z.object({
  file: z.string().describe("Path of the file the finding refers to, as shown in the diff."),
  line: z
    .number()
    .int()
    .optional()
    .describe("Line number in the new version of the file. Omit when you are not certain."),
  severity: z
    .enum(["critical", "major", "minor", "nit"])
    .describe(
      "critical: bug, security hole or data loss; major: likely defect or serious design problem; minor: small issue worth fixing; nit: style or taste.",
    ),
  category: z
    .string()
    .describe("Short topic label, e.g. 'bug', 'security', 'performance', 'readability', 'tests'."),
  message: z.string().describe("What is wrong and why it matters, referring only to what is visible in the diff."),
  suggestion: z.string().optional().describe("Concrete fix or replacement code. Omit when there is no clear fix."),
});

export const CRITERIA = [
  "correctness",
  "idiomaticity",
  "complexity",
  "testCoverage",
  "documentation",
  "security",
] as const;

export type Criterion = (typeof CRITERIA)[number];

const ScoreSchema = z.number().int().min(1).max(10);

export const ScoresSchema = z.object({
  correctness: ScoreSchema.describe(
    "Implementation correctness: does the code do what the change intends, including edge cases and error paths? 1 = clearly broken, 10 = no defects visible in the diff.",
  ),
  idiomaticity: ScoreSchema.describe(
    "Idiomaticity: does the code follow the conventions of the language, framework and repository? 1 = ignores conventions, 10 = reads like the rest of the codebase.",
  ),
  complexity: ScoreSchema.describe(
    "Complexity, where higher is simpler: 1 = convoluted or over-engineered, 10 = minimal and clear with nothing superfluous.",
  ),
  testCoverage: ScoreSchema.describe(
    "Test and risk coverage: 1 = risky changes ship without tests or the tests cannot fail, 10 = new behaviour, edge cases and failure modes are covered by meaningful tests.",
  ),
  documentation: ScoreSchema.describe(
    "Documentation: 1 = behaviour or interface changes are undocumented or existing docs are now wrong, 10 = docs and comments are accurate and explain the why.",
  ),
  security: ScoreSchema.describe(
    "Security and safety: 1 = introduces an exploitable flaw, leaks secrets or bypasses access control, 10 = validates inputs, respects access boundaries, no new risk surface.",
  ),
});

export const ReviewSchema = z.object({
  summary: z.string().describe("Two to four sentences describing what the change does and its overall quality."),
  scores: ScoresSchema.describe("One score from 1 to 10 per criterion. A higher score is always better."),
  findings: z.array(FindingSchema).describe("Issues found in the diff. Empty when there is nothing to report."),
});

export const ReviewInputSchema = z.object({
  diff: z.string().describe("Unified diff to review."),
  title: z.string().optional().describe("Title of the pull request or change."),
  description: z.string().optional().describe("Description of the pull request or change."),
});

export type Scores = z.infer<typeof ScoresSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type Review = z.infer<typeof ReviewSchema>;
export type ReviewInput = z.infer<typeof ReviewInputSchema>;
