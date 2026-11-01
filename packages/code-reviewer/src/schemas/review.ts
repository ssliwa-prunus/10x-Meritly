import { z } from "zod";

export const FindingSchema = z.object({
  file: z.string().describe("Path of the file the finding refers to, as shown in the diff."),
  line: z
    .number()
    .int()
    .positive()
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

export const ReviewSchema = z.object({
  summary: z.string().describe("Two to four sentences describing what the change does and its overall quality."),
  verdict: z
    .enum(["approve", "request_changes", "comment"])
    .describe(
      "approve: no blocking issues; request_changes: critical or major issues must be fixed; comment: only non-blocking remarks.",
    ),
  findings: z.array(FindingSchema).describe("Issues found in the diff. Empty when there is nothing to report."),
});

export const ReviewInputSchema = z.object({
  diff: z.string().describe("Unified diff to review."),
  title: z.string().optional().describe("Title of the pull request or change."),
  description: z.string().optional().describe("Description of the pull request or change."),
});

export type Finding = z.infer<typeof FindingSchema>;
export type Review = z.infer<typeof ReviewSchema>;
export type ReviewInput = z.infer<typeof ReviewInputSchema>;
