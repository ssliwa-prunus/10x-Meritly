import { requiredScore, type Evaluation } from "./evaluate.js";
import { CRITERIA, type Criterion, type Finding, type Review } from "./schemas/review.js";

export const COMMENT_MARKER = "<!-- ai-cr -->";

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface RenderOptions {
  review: Review;
  evaluation: Evaluation;
  truncated: boolean;
  originalChars: number;
  keptChars: number;
  usage?: Usage;
}

const CRITERION_LABELS: Record<Criterion, string> = {
  correctness: "Implementation correctness",
  idiomaticity: "Idiomaticity",
  complexity: "Complexity (10 = simple)",
  testCoverage: "Test / risk coverage",
  documentation: "Documentation",
  security: "Security and safety",
};

const SEVERITY_ORDER: Finding["severity"][] = ["critical", "major", "minor", "nit"];

function renderFinding(finding: Finding): string {
  const location = finding.line === undefined ? finding.file : `${finding.file}:${finding.line}`;
  const suggestion = finding.suggestion ? `\n  Suggestion: ${finding.suggestion}` : "";
  return `- \`${location}\` (${finding.category}) ${finding.message}${suggestion}`;
}

function renderFindings(findings: Finding[]): string {
  if (findings.length === 0) return "No findings.";
  const sections: string[] = [];
  for (const severity of SEVERITY_ORDER) {
    const group = findings.filter((finding) => finding.severity === severity);
    if (group.length > 0) sections.push(`**${severity}**\n${group.map(renderFinding).join("\n")}`);
  }
  return sections.join("\n\n");
}

function renderUsage(usage: Usage): string {
  const parts: string[] = [];
  if (usage.inputTokens !== undefined) parts.push(`${usage.inputTokens} input`);
  if (usage.outputTokens !== undefined) parts.push(`${usage.outputTokens} output`);
  if (usage.totalTokens !== undefined) parts.push(`${usage.totalTokens} total`);
  return parts.length === 0 ? "" : `\n\n<sub>Tokens: ${parts.join(", ")}</sub>`;
}

export function renderComment(options: RenderOptions): string {
  const { review, evaluation } = options;
  const heading = evaluation.passed ? "AI code review: passed" : "AI code review: failed";

  const rows = CRITERIA.map((criterion) => {
    const score = review.scores[criterion];
    const required = requiredScore(criterion);
    const status = score >= required ? "ok" : "below threshold";
    return `| ${CRITERION_LABELS[criterion]} | ${score} | ${required} | ${status} |`;
  });
  const table = ["| Criterion | Score | Required | Status |", "| --- | --- | --- | --- |", ...rows].join("\n");

  const truncation = options.truncated
    ? `\n\n> The diff was truncated (${options.keptChars} of ${options.originalChars} characters reviewed); parts of the change were not reviewed.`
    : "";

  return `${COMMENT_MARKER}
## ${heading}

${review.summary}

${table}${truncation}

### Findings

${renderFindings(review.findings)}${options.usage ? renderUsage(options.usage) : ""}
`;
}

export function renderErrorComment(message: string): string {
  return `${COMMENT_MARKER}
## AI code review: could not run

The review did not complete, so no result label was set. Add the \`ai-cr:review\` label to retry.

\`\`\`
${message}
\`\`\`
`;
}

// Error text goes into a public PR comment: keep the first line only and drop URLs (they can embed key ids).
export function sanitizeErrorMessage(text: string, maxChars = 300): string {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== "") ?? "Unknown error";
  return firstLine.replace(/https?:\/\/\S+/g, "[url]").slice(0, maxChars);
}
