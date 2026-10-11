// Shared helpers for the Claude Code hooks in this directory (Node, because jq is not
// available on every dev machine). Signal contract: exit 2 + stderr reaches the agent;
// exit 0 means "checked and clean" or "nothing to check"; never exit 1.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const PLAIN_ENV = { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", CI: "1" };

// Files ESLint covers (eslint.config.js: TS/JS, React, eslint-plugin-astro).
export const LINTED = /\.(ts|tsx|js|jsx|mjs|cjs|astro)$/;
// Excluded from both ESLint (globalIgnores) and tsconfig: never a reason to lint or typecheck.
export const OUT_OF_SCOPE = /^(\.claude|supabase\/functions)\//;
// Code the unit suite (vitest.config.ts: src/**/*.test.ts) can depend on.
export const UNIT_SCOPE = /^src\/.*\.(ts|tsx|js|jsx)$/;
// The hooks, their config and their proof (scripts/__tests__/agent-hooks.test.ts).
export const HOOK_PROOF_SCOPE =
  /^(\.claude\/hooks\/|\.claude\/settings\.json$|scripts\/__tests__\/agent-hooks\.|vitest\.hooks\.config\.ts$)/;
// SQL that pgTAP (npx supabase test db) can see: migrations and the tests themselves.
export const PGTAP_SCOPE = /^supabase\/(migrations|tests)\/[^/]+\.sql$/;

export function readPayload() {
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function git(cwd, args) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: PLAIN_ENV });
  return r.status === 0 ? r.stdout.trim() : null;
}

export const norm = (p) => path.resolve(p).split(path.sep).join("/").toLowerCase();

export const stripAnsi = (s) => s.replace(/\u001b\[[0-9;]*m/g, "");

// Runs a repo-local Node tool (no npx: it costs ~40 s per call on Windows). A missing tool
// is a failure, never a pass. timeoutMs: kill a hanging call before the harness kills the hook,
// which would leave no report at all.
export function runTool(root, relBin, args, { timeoutMs } = {}) {
  const bin = path.join(root, relBin);
  if (!existsSync(bin)) {
    return { ok: false, output: `${relBin} not found in ${root}: run npm install.` };
  }
  const r = spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    encoding: "utf8",
    env: PLAIN_ENV,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
    timeout: timeoutMs,
  });
  const output = stripAnsi(`${r.stdout ?? ""}${r.stderr ?? ""}`).trim();
  if (r.error?.code === "ETIMEDOUT") {
    const note = `${relBin} ${args.join(" ")} timed out after ${timeoutMs / 1000} s.`;
    return { ok: false, timedOut: true, output: output ? `${output}\n${note}` : note };
  }
  if (r.error) return { ok: false, output: `${relBin} did not run: ${r.error.message}` };
  return { ok: r.status === 0, output };
}

export const ESLINT = "node_modules/eslint/bin/eslint.js";
export const VITEST = "node_modules/vitest/vitest.mjs";
export const ASTRO = "node_modules/astro/bin/astro.mjs";
export const UI_LITERALS = "scripts/check-ui-literals.mjs";
export const SUPABASE = "node_modules/supabase/dist/supabase.js";
// Per Supabase CLI call, well inside the Stop hook's 180 s; the env override keeps the proof fast.
export const SUPABASE_TIMEOUT_MS = Number(process.env.CLAUDE_HOOK_SUPABASE_TIMEOUT_MS) || 60_000;

// Checkouts the per-edit hook touched this session, so the Stop hook sweeps sibling worktrees too.
export function registryPath(sessionId) {
  const sid = String(sessionId ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  return sid ? path.join(os.tmpdir(), "claude-hooks", `${sid}.roots`) : null;
}

// Hashes of the applied migrations the Stop hook has seen, per repository: all its
// worktrees share one local database. `changed` is relative to HEAD, not to the turn, so this
// tells "applied earlier, untouched since" from "edited after it was applied".
export function ledgerPath(root) {
  const common = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common) return null;
  const key = createHash("sha256").update(norm(common)).digest("hex").slice(0, 16);
  return path.join(os.tmpdir(), "claude-hooks", `${key}.ledger.json`);
}

export function block(message) {
  process.stderr.write(`${message.trim()}\n`);
  process.exit(2);
}
