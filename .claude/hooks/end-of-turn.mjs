#!/usr/bin/env node
// Stop: sweep every file changed in the session's checkouts before the agent finishes, one retry.
// Catches edits made through Bash, which never reach the per-edit hook.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  ASTRO,
  ESLINT,
  HOOK_PROOF_SCOPE,
  LINTED,
  OUT_OF_SCOPE,
  UI_LITERALS,
  UNIT_SCOPE,
  VITEST,
  block,
  git,
  readPayload,
  registryPath,
  runTool,
} from "./lib.mjs";

const payload = readPayload();

// Already sent back once by this hook: let it finish. The pre-commit gate catches the rest.
// (loop_count covers Cursor, which imports .claude/settings.json hooks.)
if (payload.stop_hook_active === true || Number(payload.loop_count ?? 0) > 0) process.exit(0);

const cwd = typeof payload.cwd === "string" && payload.cwd ? payload.cwd : process.cwd();
const registry = registryPath(payload.session_id);
const candidates = [git(cwd, ["rev-parse", "--show-toplevel"])];
if (registry && existsSync(registry)) candidates.push(...readFileSync(registry, "utf8").split(/\r?\n/));
const roots = [...new Set(candidates.filter((r) => r && existsSync(r)).map((r) => path.resolve(r)))];

if (roots.length === 0) {
  // Not silent: the user sees why nothing was checked.
  process.stdout.write(
    JSON.stringify({ systemMessage: `end-of-turn.mjs: no git checkout at ${cwd}, nothing checked.` }),
  );
  process.exit(0);
}

const report = [];
for (const root of roots) {
  const diff = git(root, ["diff", "--name-only", "HEAD"]);
  const untracked = git(root, ["ls-files", "-o", "--exclude-standard"]);
  if (diff === null || untracked === null) {
    report.push(`git could not list changes in ${root}; nothing was checked there.`);
    continue;
  }
  const changed = [...new Set(`${diff}\n${untracked}`.split(/\r?\n/).filter(Boolean))];

  // These hooks changed: re-prove them (npm run test:hooks, ~10 s).
  if (changed.some((f) => HOOK_PROOF_SCOPE.test(f))) {
    const proof = runTool(root, VITEST, ["run", "--config", "vitest.hooks.config.ts"]);
    if (!proof.ok) report.push(`Agent hook proof fails (npm run test:hooks, ${root}):\n${proof.output}`);
  }

  const code = changed.filter((f) => LINTED.test(f) && !OUT_OF_SCOPE.test(f) && existsSync(path.join(root, f)));
  // Q&A turns and docs-only changes: nothing to check here.
  if (code.length === 0) continue;

  const lint = runTool(root, ESLINT, ["--quiet", ...code]);
  if (!lint.ok) report.push(`ESLint errors in changed files (${root}):\n${lint.output}`);

  const ui = runTool(root, UI_LITERALS, code);
  if (!ui.ok) report.push(`UI literal check (npm run lint:ui) failed (${root}):\n${ui.output}`);

  // The whole unit suite runs in ~2 s, so run all of it: it also catches a red test in a
  // module this turn only imported.
  if (code.some((f) => UNIT_SCOPE.test(f) || f === "vitest.config.ts" || f === "package.json")) {
    const tests = runTool(root, VITEST, ["run"]);
    if (!tests.ok) report.push(`Unit tests fail (${root}):\n${tests.output}`);
  }

  // astro check syncs the generated .astro/ types itself and also covers .astro files (~35 s).
  const typecheck = runTool(root, ASTRO, ["check"]);
  if (!typecheck.ok) report.push(`astro check fails (${root}):\n${typecheck.output}`);
}

if (report.length > 0) block(`Fix these before you finish:\n\n${report.join("\n\n")}`);

// Green: the registered checkouts are clean, start the next turn with an empty registry.
if (registry && existsSync(registry)) {
  try {
    writeFileSync(registry, "");
  } catch {
    // Stale entries only widen the next sweep.
  }
}
process.exit(0);
