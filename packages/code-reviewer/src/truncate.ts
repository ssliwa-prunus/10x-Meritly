export const DEFAULT_MAX_DIFF_CHARS = 60000;

export interface TruncatedDiff {
  diff: string;
  truncated: boolean;
  originalChars: number;
}

export function maxDiffCharsFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(env.REVIEW_MAX_DIFF_CHARS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_DIFF_CHARS;
}

// Cuts on a line boundary so the model never sees half a line.
export function truncateDiff(diff: string, maxChars: number = DEFAULT_MAX_DIFF_CHARS): TruncatedDiff {
  const originalChars = diff.length;
  if (originalChars <= maxChars) return { diff, truncated: false, originalChars };
  const cut = diff.lastIndexOf("\n", maxChars);
  const kept = cut > 0 ? diff.slice(0, cut) : diff.slice(0, maxChars);
  return { diff: kept, truncated: true, originalChars };
}
