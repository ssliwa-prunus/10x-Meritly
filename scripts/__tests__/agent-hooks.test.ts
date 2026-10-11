// Proof for the Claude Code hooks in .claude/hooks (wired in .claude/settings.json).
// Each case pipes a hook payload into the real script inside a throwaway git repo and asserts the
// exit code and channel: exit 2 + stderr is the only signal Claude sees. ESLint, the UI literal
// guard, Vitest and astro check are stubbed by marker-flagging scripts; git and the hooks are real.
// Run: npm run test:hooks
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HOOKS_DIR = path.join(REPO_ROOT, ".claude/hooks");
const SETTINGS = JSON.parse(readFileSync(path.join(REPO_ROOT, ".claude/settings.json"), "utf8")) as {
  hooks: Record<string, { hooks: { command: string; timeout: number }[] }[]>;
};

// Stubs: each flags a marker string so a case can break exactly one check.
const ESLINT_STUB = `
const fs = require("node:fs");
let bad = 0;
for (const f of process.argv.slice(2).filter((a) => !a.startsWith("-"))) {
  if (fs.readFileSync(f, "utf8").includes("LINT_ERROR")) { console.log(f + ": error 'LINT_ERROR' is assigned a value but never used"); bad = 1; }
}
process.exit(bad);`;
const UI_STUB = `
const fs = require("node:fs");
let bad = 0;
for (const f of process.argv.slice(2)) {
  if (fs.readFileSync(f, "utf8").includes("UI_LITERAL")) { console.error(f + ":1: text-purple-300"); bad = 1; }
}
process.exit(bad);`;
const SRC_SCAN = `
const fs = require("node:fs"); const path = require("node:path");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const flagged = (marker) => (fs.existsSync("src") ? walk("src") : []).filter((f) => fs.readFileSync(f, "utf8").includes(marker));`;
const VITEST_STUB = `${SRC_SCAN}
const [mode, file] = process.argv.slice(2);
if (process.argv.includes("--config") && fs.existsSync(".claude/hooks/PROOF_FAILS")) { console.log("FAIL agent-hooks.test.ts"); process.exit(1); }
const bad = mode === "related" ? (fs.readFileSync(file, "utf8").includes("FAILING_TEST") ? [file] : []) : flagged("FAILING_TEST");
if (bad.length) { console.log("FAIL " + bad.join(", ") + ": expected 2 to be 3"); process.exit(1); }`;
const ASTRO_STUB = `${SRC_SCAN}
const bad = flagged("TYPE_ERROR");
if (bad.length) { console.log(bad[0] + ":1:7 - error ts(2322): Type 'string' is not assignable to type 'number'."); process.exit(1); }`;

const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "agent-hooks-"));
let counter = 0;

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function installTools(dir: string) {
  const put = (rel: string, body: string) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), body);
  };
  put("node_modules/eslint/bin/eslint.js", ESLINT_STUB);
  put(
    "node_modules/vitest/vitest.mjs",
    `import { createRequire } from "node:module"; const require = createRequire(import.meta.url);${VITEST_STUB}`,
  );
  put(
    "node_modules/astro/bin/astro.mjs",
    `import { createRequire } from "node:module"; const require = createRequire(import.meta.url);${ASTRO_STUB}`,
  );
}

/** A committed repo with the real hooks, a stubbed toolchain and one clean source file. */
function makeRepo() {
  const dir = path.join(tmpRoot, `repo${String(++counter)}`);
  mkdirSync(dir);
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "hooks@test.local");
  git(dir, "config", "user.name", "hooks test");
  git(dir, "config", "core.autocrlf", "false");
  cpSync(HOOKS_DIR, path.join(dir, ".claude/hooks"), { recursive: true });
  writeFileSync(path.join(dir, ".claude/settings.json"), JSON.stringify(SETTINGS));
  mkdirSync(path.join(dir, "scripts"));
  writeFileSync(
    path.join(dir, "scripts/check-ui-literals.mjs"),
    `import fs from "node:fs";${UI_STUB.replace('const fs = require("node:fs");', "")}`,
  );
  mkdirSync(path.join(dir, "src"));
  writeFileSync(path.join(dir, "src/clean.ts"), "export const ok = 1;\n");
  writeFileSync(path.join(dir, "README.md"), "# fixture\n");
  writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "fixture");
  installTools(dir);
  return dir;
}

function write(dir: string, rel: string, body: string) {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), body);
  return path.join(dir, rel);
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function hook(script: string, input: unknown, opts: { cwd?: string; env?: Record<string, string> } = {}): Run {
  const r = spawnSync(process.execPath, [path.join(HOOKS_DIR, script)], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    cwd: opts.cwd ?? tmpRoot,
    encoding: "utf8",
    env: { ...process.env, ...opts.env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const edit = (cwd: string, filePath: string, extra: Record<string, unknown> = {}) => ({
  session_id: `s${String(counter)}`,
  hook_event_name: "PostToolUse",
  tool_name: "Edit",
  cwd,
  tool_input: { file_path: filePath },
  ...extra,
});
const stop = (cwd: string, extra: Record<string, unknown> = {}) => ({
  session_id: `s${String(counter)}`,
  hook_event_name: "Stop",
  cwd,
  stop_hook_active: false,
  ...extra,
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("check-edited-file.mjs (PostToolUse Write|Edit)", () => {
  let repo: string;
  beforeAll(() => {
    repo = makeRepo();
  });

  it("blocks a lint error with exit 2 and names the file on stderr", () => {
    const file = write(repo, "src/lint-broken.ts", "const LINT_ERROR = 1;\n");
    const r = hook("check-edited-file.mjs", edit(repo, file));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("ESLint reported errors in src/lint-broken.ts");
    expect(r.stderr).toContain("LINT_ERROR");
  });

  it("blocks a UI literal in a .astro view", () => {
    const file = write(repo, "src/pages/view.astro", '<p class="UI_LITERAL">x</p>\n');
    const r = hook("check-edited-file.mjs", edit(repo, file));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("UI literal check (npm run lint:ui) failed for src/pages/view.astro");
  });

  it("blocks when related unit tests fail", () => {
    const file = write(repo, "src/lib/calc.ts", "export const FAILING_TEST = 1;\n");
    const r = hook("check-edited-file.mjs", edit(repo, file));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Unit tests related to src/lib/calc.ts fail");
  });

  it("passes a clean file silently", () => {
    const r = hook("check-edited-file.mjs", edit(repo, path.join(repo, "src/clean.ts")));
    expect(r).toMatchObject({ status: 0, stderr: "" });
  });

  it("accepts a Windows backslash path", () => {
    const file = write(repo, "src/win-broken.ts", "const LINT_ERROR = 1;\n");
    const r = hook("check-edited-file.mjs", edit(repo, file.split("/").join("\\")));
    expect(r.status).toBe(process.platform === "win32" ? 2 : 0);
  });

  it.each([
    ["an uncovered type", (d: string) => edit(d, path.join(d, "README.md"))],
    ["a nonexistent file", (d: string) => edit(d, path.join(d, "src/missing.ts"))],
    ["an empty object", () => ({})],
    ["a payload without a path", (d: string) => ({ tool_name: "Bash", cwd: d, tool_input: { command: "ls" } })],
    ["unparseable stdin", () => "not json"],
    ["empty stdin", () => ""],
    [
      "a Supabase Edge Function (excluded from ESLint and tsconfig)",
      (d: string) => edit(d, write(d, "supabase/functions/x/index.ts", "const LINT_ERROR = 1;\n")),
    ],
  ])("exits 0 for %s", (_name, payload) => {
    const r = hook("check-edited-file.mjs", payload(repo));
    expect(r).toMatchObject({ status: 0, stderr: "" });
  });

  it("resolves a relative path against the payload cwd, not the process cwd", () => {
    write(repo, "src/rel-broken.ts", "const LINT_ERROR = 1;\n");
    const r = hook("check-edited-file.mjs", edit(repo, "src/rel-broken.ts"), { cwd: tmpRoot });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("src/rel-broken.ts");
  });

  it("skips a broken file of another repository", () => {
    const other = makeRepo();
    const file = write(other, "src/foreign.ts", "const LINT_ERROR = 1;\n");
    const r = hook("check-edited-file.mjs", edit(repo, file));
    expect(r).toMatchObject({ status: 0, stderr: "" });
  });

  it("ignores CLAUDE_PROJECT_DIR pointing at a broken checkout", () => {
    const other = makeRepo();
    write(other, "src/clean.ts", "const LINT_ERROR = 1;\n");
    const r = hook("check-edited-file.mjs", edit(repo, path.join(repo, "src/clean.ts")), {
      env: { CLAUDE_PROJECT_DIR: other },
    });
    expect(r).toMatchObject({ status: 0, stderr: "" });
  });

  it("fails visibly when the linter is not installed", () => {
    const bare = makeRepo();
    rmSync(path.join(bare, "node_modules/eslint"), { recursive: true });
    const r = hook("check-edited-file.mjs", edit(bare, path.join(bare, "src/clean.ts")));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("node_modules/eslint/bin/eslint.js not found");
  });
});

describe("end-of-turn.mjs (Stop)", () => {
  it("passes without running any check when nothing changed", () => {
    const repo = makeRepo();
    // A check that ran would fail on the missing tools.
    rmSync(path.join(repo, "node_modules"), { recursive: true });
    expect(hook("end-of-turn.mjs", stop(repo))).toMatchObject({ status: 0, stderr: "" });
  });

  it("passes a docs-only change", () => {
    const repo = makeRepo();
    write(repo, "README.md", "# changed\n");
    expect(hook("end-of-turn.mjs", stop(repo))).toMatchObject({ status: 0, stderr: "" });
  });

  it("passes a clean code change", () => {
    const repo = makeRepo();
    write(repo, "src/clean.ts", "export const ok = 2;\n");
    expect(hook("end-of-turn.mjs", stop(repo))).toMatchObject({ status: 0, stderr: "" });
  });

  it("blocks a lint error written through a shell command (no per-edit payload)", () => {
    const repo = makeRepo();
    write(repo, "src/bash-written.ts", "const LINT_ERROR = 1;\n");
    const r = hook("end-of-turn.mjs", stop(repo));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("ESLint errors in changed files");
    expect(r.stderr).toContain("src/bash-written.ts");
  });

  it("blocks a type error and a failing unit test in one message", () => {
    const repo = makeRepo();
    write(repo, "src/clean.ts", "export const ok: number = 'TYPE_ERROR';\n");
    write(repo, "src/lib/other.ts", "export const FAILING_TEST = 1;\n");
    const r = hook("end-of-turn.mjs", stop(repo));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("astro check fails");
    expect(r.stderr).toContain("Unit tests fail");
  });

  it.each([
    ["stop_hook_active", { stop_hook_active: true }],
    ["Cursor loop_count", { loop_count: 1 }],
  ])("lets the agent finish on the retry (%s) even while the error is present", (_name, extra) => {
    const repo = makeRepo();
    write(repo, "src/still-broken.ts", "const LINT_ERROR = 1;\n");
    expect(hook("end-of-turn.mjs", stop(repo, extra))).toMatchObject({ status: 0, stderr: "" });
  });

  it.each([
    ["an empty object", {}],
    ["unparseable stdin", "not json"],
  ])("does not crash on %s", (_name, payload) => {
    const r = hook("end-of-turn.mjs", payload, { cwd: makeRepo() });
    expect(r).toMatchObject({ status: 0, stderr: "" });
  });

  it("tells the user when the cwd is not a git checkout", () => {
    const r = hook("end-of-turn.mjs", stop(tmpRoot));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({
      systemMessage: expect.stringContaining("nothing checked") as unknown,
    });
  });

  it("ignores CLAUDE_PROJECT_DIR pointing at a broken checkout", () => {
    const repo = makeRepo();
    const other = makeRepo();
    write(other, "src/clean.ts", "const LINT_ERROR = 1;\n");
    expect(hook("end-of-turn.mjs", stop(repo), { env: { CLAUDE_PROJECT_DIR: other } })).toMatchObject({ status: 0 });
  });

  it("sweeps a sibling worktree the per-edit hook registered, then clears the registry when green", () => {
    const repo = makeRepo();
    const wt = path.join(tmpRoot, `wt${String(counter)}`);
    git(repo, "worktree", "add", "-q", wt);
    installTools(wt);
    const file = write(wt, "src/wt-broken.ts", "const LINT_ERROR = 1;\n");
    const session = { session_id: `wt-session-${String(counter)}` };

    expect(hook("check-edited-file.mjs", edit(repo, file, session)).status).toBe(2);
    const r = hook("end-of-turn.mjs", stop(repo, session));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("src/wt-broken.ts");

    rmSync(file);
    expect(hook("end-of-turn.mjs", stop(repo, session))).toMatchObject({ status: 0, stderr: "" });
    const registry = path.join(os.tmpdir(), "claude-hooks", `${session.session_id}.roots`);
    expect(readFileSync(registry, "utf8")).toBe("");
  });

  it("re-runs the hook proof when a hook file changed", () => {
    const repo = makeRepo();
    write(repo, ".claude/hooks/PROOF_FAILS", "");
    const r = hook("end-of-turn.mjs", stop(repo));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Agent hook proof fails (npm run test:hooks");
  });

  it("fails visibly when astro check is not installed", () => {
    const repo = makeRepo();
    rmSync(path.join(repo, "node_modules/astro"), { recursive: true });
    write(repo, "src/clean.ts", "export const ok = 2;\n");
    const r = hook("end-of-turn.mjs", stop(repo));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("node_modules/astro/bin/astro.mjs not found");
  });
});

describe(".claude/settings.json commands", () => {
  // Claude Code runs hook commands through Git Bash on Windows; System32\bash.exe is WSL.
  const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
  const bash = process.platform === "win32" && existsSync(gitBash) ? gitBash : "bash";
  const commands = Object.values(SETTINGS.hooks).flatMap((groups) => groups.flatMap((g) => g.hooks));

  it("use timeouts in seconds", () => {
    for (const c of commands) expect(c.timeout).toBeLessThanOrEqual(600);
  });

  it("reach an executable script from a worktree with a stale CLAUDE_PROJECT_DIR", () => {
    const repo = makeRepo();
    const wt = path.join(tmpRoot, `cmd-wt${String(counter)}`);
    git(repo, "worktree", "add", "-q", wt);
    for (const c of commands) {
      const r = spawnSync(bash, ["-c", c.command], {
        cwd: wt,
        input: "{}",
        encoding: "utf8",
        env: { ...process.env, CLAUDE_PROJECT_DIR: path.join(tmpRoot, "does-not-exist") },
      });
      expect({ command: c.command, status: r.status, stderr: r.stderr }).toEqual({
        command: c.command,
        status: 0,
        stderr: "",
      });
    }
  });
});
