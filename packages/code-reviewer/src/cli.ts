import { readFile } from "node:fs/promises";
import { reviewDiff } from "./agents/reviewer.js";

const USAGE = "Usage: npm start -- <path-to-diff>   or   git diff | npm start";

async function readStdin(): Promise<string> {
  const chunks: string[] = [];
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    chunks.push(chunk as string);
  }
  return chunks.join("");
}

function formatError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const lines = [error.stack ?? error.message];
  let cause: unknown = error.cause;
  while (cause !== undefined) {
    if (cause instanceof Error) {
      lines.push(`Caused by: ${cause.stack ?? cause.message}`);
      cause = cause.cause;
    } else {
      lines.push(`Caused by: ${String(cause)}`);
      break;
    }
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (path === undefined && process.stdin.isTTY) {
    throw new Error(`No diff provided. ${USAGE}`);
  }

  let diff: string;
  if (path !== undefined) {
    try {
      diff = await readFile(path, "utf8");
    } catch (error) {
      throw new Error(`Could not read diff file "${path}".`, { cause: error });
    }
  } else {
    diff = await readStdin();
  }

  if (diff.trim() === "") {
    throw new Error(`The diff is empty; nothing to review. ${USAGE}`);
  }

  const review = await reviewDiff({ diff });
  console.log(JSON.stringify(review, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(formatError(error));
  process.exitCode = 1;
}
