import { readFile } from "node:fs/promises";
import { renderErrorComment, sanitizeErrorMessage } from "./render.js";

// Usage: tsx src/error-comment.ts <path-to-stderr-file>
// Prints the "review could not run" PR comment for the failed CLI run.
const path = process.argv[2];
const text = path === undefined ? "" : await readFile(path, "utf8").catch(() => "");
console.log(renderErrorComment(sanitizeErrorMessage(text)));
