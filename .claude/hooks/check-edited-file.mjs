#!/usr/bin/env node
// PostToolUse (Write|Edit): check only the file the agent just edited, in its own checkout:
// ESLint, the UI literal guard (it filters to CLEAN_PATHS itself) and, for src/, related unit tests.
import { appendFileSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  ESLINT,
  LINTED,
  OUT_OF_SCOPE,
  UI_LITERALS,
  UNIT_SCOPE,
  VITEST,
  block,
  git,
  norm,
  readPayload,
  registryPath,
  runTool,
} from "./lib.mjs";

const payload = readPayload();
const input = payload.tool_input ?? {};
const raw = input.file_path ?? input.notebook_path ?? input.path;
if (typeof raw !== "string" || raw === "") process.exit(0);

const cwd = typeof payload.cwd === "string" && payload.cwd ? payload.cwd : process.cwd();
const file = path.resolve(cwd, raw);
if (!LINTED.test(file) || !existsSync(file)) process.exit(0);

// Checkout of the edited file, not $CLAUDE_PROJECT_DIR (stale after EnterWorktree). Files of
// other repositories (~/.claude, other projects) are skipped; any worktree of this repo is checked.
const root = git(path.dirname(file), ["rev-parse", "--show-toplevel"]);
if (!root) process.exit(0);
const repo = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
const sessionRepo = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
if (!repo || !sessionRepo || norm(repo) !== norm(sessionRepo)) process.exit(0);

// realpath on both sides: on Windows the payload or %TEMP% can carry 8.3 short names (SEBAST~1)
// while git prints the long path, which would make the relative path escape the checkout.
const rel = path.relative(realpathSync.native(root), realpathSync.native(file)).split(path.sep).join("/");
if (rel.startsWith("../")) process.exit(0);
if (OUT_OF_SCOPE.test(rel)) process.exit(0);

const registry = registryPath(payload.session_id);
if (registry) {
  try {
    mkdirSync(path.dirname(registry), { recursive: true });
    appendFileSync(registry, `${root}\n`);
  } catch {
    // The registry only widens the Stop sweep; the cwd checkout is swept regardless.
  }
}

const failures = [];
const lint = runTool(root, ESLINT, ["--quiet", rel]);
if (!lint.ok) failures.push(`ESLint reported errors in ${rel}:\n${lint.output}`);

const ui = runTool(root, UI_LITERALS, [rel]);
if (!ui.ok) failures.push(`UI literal check (npm run lint:ui) failed for ${rel}:\n${ui.output}`);

if (UNIT_SCOPE.test(rel)) {
  const tests = runTool(root, VITEST, ["related", rel, "--run"]);
  if (!tests.ok) failures.push(`Unit tests related to ${rel} fail:\n${tests.output}`);
}

if (failures.length > 0) block(failures.join("\n\n"));
process.exit(0);
