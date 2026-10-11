// Proof for the Claude Code hooks in .claude/hooks (wired in .claude/settings.json).
// Each case pipes a hook payload into the real script inside a throwaway git repo and asserts the
// exit code and channel: exit 2 + stderr is the only signal Claude sees. ESLint, the UI literal
// guard, Vitest and astro check are stubbed by marker-flagging scripts; git and the hooks are real.
// Run: npm run test:hooks
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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

// Supabase CLI: logs each call; the markers live under the gitignored node_modules/ so they never
// count as changes. SUPABASE_APPLIED lists the versions local Supabase already has; migration up
// adds the pending ones.
const SUPABASE_STUB = `
const fs = require("node:fs"); const path = require("node:path");
const cmd = process.argv.slice(2).join(" ");
fs.appendFileSync("node_modules/SUPABASE_CALLS", cmd + "\\n");
const sql = (d) => fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }).filter((f) => f.endsWith(".sql")).map((f) => path.join(d, f)) : [];
const has = (files, marker) => files.some((f) => fs.readFileSync(f, "utf8").includes(marker));
const APPLIED = "node_modules/SUPABASE_APPLIED";
const applied = () => fs.existsSync(APPLIED) ? fs.readFileSync(APPLIED, "utf8").split("\\n") : [];
const versions = () => sql("supabase/migrations").map((f) => path.basename(f).split("_")[0]);
console.error("A new version of Supabase CLI is available");
if (cmd.startsWith("migration list")) {
  if (fs.existsSync("node_modules/SUPABASE_DOWN")) { console.error("failed to connect to postgres"); process.exit(1); }
  if (fs.existsSync("node_modules/SUPABASE_GARBAGE")) { console.log("Connecting to local database..."); process.exit(0); }
  console.log(JSON.stringify({ migrations: versions().map((v) => ({ local: v, remote: applied().includes(v) ? v : "" })), message: "Migrations listed" }));
} else if (cmd.startsWith("migration up")) {
  if (has(sql("supabase/migrations"), "MIGRATION_ERROR")) { console.log("ERROR: syntax error at or near MIGRATION_ERROR"); process.exit(1); }
  for (const v of versions().filter((v) => !applied().includes(v))) fs.appendFileSync(APPLIED, v + "\\n");
} else if (cmd === "test db") {
  if (has(sql("supabase"), "PGTAP_FAIL")) { console.log("rls_matrix.test.sql .. Failed 1/260 subtests"); process.exit(1); }
}`;

const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "agent-hooks-"));
let counter = 0;
const repos: string[] = [];

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
  // No package.json in the fixture, so a .js file loads as CommonJS.
  put("node_modules/supabase/dist/supabase.js", SUPABASE_STUB);
}

const supabaseCalls = (dir: string) => {
  const log = path.join(dir, "node_modules/SUPABASE_CALLS");
  return existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
};

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
  repos.push(dir);
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

// Mirrors ledgerPath in .claude/hooks/lib.mjs: one ledger per fixture repository, in os.tmpdir().
const ledgerFile = (dir: string) => {
  const common = git(dir, "rev-parse", "--path-format=absolute", "--git-common-dir");
  const key = createHash("sha256")
    .update(path.resolve(common).split(path.sep).join("/").toLowerCase())
    .digest("hex")
    .slice(0, 16);
  return path.join(os.tmpdir(), "claude-hooks", `${key}.ledger.json`);
};

afterAll(() => {
  for (const dir of repos) rmSync(ledgerFile(dir), { force: true });
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
    expect(supabaseCalls(repo)).toEqual([]);
  });

  it("passes a clean code change", () => {
    const repo = makeRepo();
    write(repo, "src/clean.ts", "export const ok = 2;\n");
    expect(hook("end-of-turn.mjs", stop(repo))).toMatchObject({ status: 0, stderr: "" });
    expect(supabaseCalls(repo)).toEqual([]);
  });

  describe("pgTAP on SQL changes", () => {
    const MIGRATION = "supabase/migrations/20261001120000_add_thing.sql";

    it("blocks a failing pgTAP run on a migration-only turn", () => {
      const repo = makeRepo();
      write(repo, MIGRATION, "drop policy x on t; -- PGTAP_FAIL\n");
      const r = hook("end-of-turn.mjs", stop(repo));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("pgTAP fails (npx supabase test db");
      expect(r.stderr).toContain("db reset --local");
    });

    it("runs migration up before test db", () => {
      const repo = makeRepo();
      write(repo, MIGRATION, "create table t (id int);\n");
      hook("end-of-turn.mjs", stop(repo));
      expect(supabaseCalls(repo)).toEqual([
        "migration list --local --output-format json",
        "migration up --local",
        "test db",
      ]);
    });

    it("blocks a migration that fails to apply", () => {
      const repo = makeRepo();
      write(repo, MIGRATION, "create tabel MIGRATION_ERROR;\n");
      const r = hook("end-of-turn.mjs", stop(repo));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("Migration failed to apply");
      expect(r.stderr).toContain("MIGRATION_ERROR");
      expect(supabaseCalls(repo)).not.toContain("test db");
    });

    // A stale block is told once per content (the hook can't see a db reset): the same content
    // passes the next Stop, and a further edit blocks again.
    const expectToldOnce = (repo: string) => {
      rmSync(path.join(repo, "node_modules/SUPABASE_CALLS"));
      expect(hook("end-of-turn.mjs", stop(repo))).toMatchObject({ status: 0, stderr: "" });
      expect(supabaseCalls(repo)).toEqual(["migration list --local --output-format json", "test db"]);
      write(repo, MIGRATION, "create table t (id text);\n");
      expect(hook("end-of-turn.mjs", stop(repo)).stderr).toContain(`${MIGRATION}: already applied to local Supabase`);
    };

    it("blocks a committed, applied migration that changed, once per content", () => {
      const repo = makeRepo();
      write(repo, MIGRATION, "create table t (id int);\n");
      git(repo, "add", "-A");
      git(repo, "commit", "-q", "-m", "migration");
      write(repo, "node_modules/SUPABASE_APPLIED", "20261001120000\n");
      write(repo, MIGRATION, "create table t (id bigint);\n");
      const r = hook("end-of-turn.mjs", stop(repo));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(MIGRATION);
      expect(r.stderr).toContain("already applied to local Supabase");
      expect(r.stderr).toContain("npx supabase db reset --local");
      expect(r.stderr).toContain("Reported once per content");
      expect(supabaseCalls(repo)).toEqual(["migration list --local --output-format json"]);
      expectToldOnce(repo);
    });

    it("passes the next turn when the uncommitted migration it applied is unchanged", () => {
      const repo = makeRepo();
      write(repo, MIGRATION, "create table t (id int);\n");
      expect(hook("end-of-turn.mjs", stop(repo)).status).toBe(0);
      expect(existsSync(ledgerFile(repo))).toBe(true);
      rmSync(path.join(repo, "node_modules/SUPABASE_CALLS"));

      expect(hook("end-of-turn.mjs", stop(repo))).toMatchObject({ status: 0, stderr: "" });
      expect(supabaseCalls(repo)).toEqual(["migration list --local --output-format json", "test db"]);
    });

    it("blocks an edit of an uncommitted migration after it was applied, once per content", () => {
      const repo = makeRepo();
      write(repo, MIGRATION, "create table t (id int);\n");
      expect(hook("end-of-turn.mjs", stop(repo)).status).toBe(0);
      write(repo, MIGRATION, "create table t (id bigint);\n");
      const r = hook("end-of-turn.mjs", stop(repo));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(`${MIGRATION}: already applied to local Supabase`);
      expectToldOnce(repo);
    });

    it("trusts an uncommitted migration applied by hand, then blocks a later edit of it", () => {
      const repo = makeRepo();
      write(repo, MIGRATION, "create table t (id int);\n");
      write(repo, "node_modules/SUPABASE_APPLIED", "20261001120000\n");
      expect(hook("end-of-turn.mjs", stop(repo))).toMatchObject({ status: 0, stderr: "" });
      expect(supabaseCalls(repo)).toEqual(["migration list --local --output-format json", "test db"]);

      write(repo, MIGRATION, "create table t (id bigint);\n");
      const r = hook("end-of-turn.mjs", stop(repo));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("already applied to local Supabase");
    });

    it("skips with a systemMessage when local Supabase is down", () => {
      const repo = makeRepo();
      write(repo, MIGRATION, "-- PGTAP_FAIL\n");
      write(repo, "node_modules/SUPABASE_DOWN", "");
      const r = hook("end-of-turn.mjs", stop(repo));
      expect(r).toMatchObject({ status: 0, stderr: "" });
      expect(JSON.parse(r.stdout)).toMatchObject({
        systemMessage: expect.stringContaining("pgTAP skipped — local Supabase not reachable") as unknown,
      });
    });

    it("adds the skip note to a block from another check", () => {
      const repo = makeRepo();
      write(repo, MIGRATION, "create table t (id int);\n");
      write(repo, "src/bash-written.ts", "const LINT_ERROR = 1;\n");
      write(repo, "node_modules/SUPABASE_DOWN", "");
      const r = hook("end-of-turn.mjs", stop(repo));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("ESLint errors in changed files");
      expect(r.stderr).toContain("pgTAP skipped");
    });

    it("fails visibly when the migration list can't be parsed", () => {
      const repo = makeRepo();
      write(repo, MIGRATION, "create table t (id int);\n");
      write(repo, "node_modules/SUPABASE_GARBAGE", "");
      const r = hook("end-of-turn.mjs", stop(repo));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("Could not parse the output of supabase migration list");
    });

    it("blocks a failing pgTAP test file change when no migration changed", () => {
      const repo = makeRepo();
      write(repo, "supabase/tests/rls_matrix.test.sql", "select ok(false); -- PGTAP_FAIL\n");
      const r = hook("end-of-turn.mjs", stop(repo));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("pgTAP fails (npx supabase test db");
    });

    it("passes a clean SQL change silently", () => {
      const repo = makeRepo();
      write(repo, MIGRATION, "create table t (id int);\n");
      write(repo, "supabase/tests/t.test.sql", "select ok(true);\n");
      expect(hook("end-of-turn.mjs", stop(repo))).toMatchObject({ status: 0, stdout: "", stderr: "" });
    });

    it("fails visibly when the Supabase CLI is not installed", () => {
      const repo = makeRepo();
      rmSync(path.join(repo, "node_modules/supabase"), { recursive: true });
      write(repo, MIGRATION, "create table t (id int);\n");
      const r = hook("end-of-turn.mjs", stop(repo));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("node_modules/supabase/dist/supabase.js not found");
    });

    it("runs once when a registered sibling worktree also has SQL changes", () => {
      const repo = makeRepo();
      const wt = path.join(tmpRoot, `sql-wt${String(counter)}`);
      git(repo, "worktree", "add", "-q", wt);
      installTools(wt);
      const session = { session_id: `sql-wt-session-${String(counter)}` };
      // The per-edit hook registers a checkout only for a linted file.
      const file = write(wt, "src/clean.ts", "export const ok = 2;\n");
      expect(hook("check-edited-file.mjs", edit(repo, file, session)).status).toBe(0);
      write(repo, MIGRATION, "create table t (id int);\n");
      write(wt, "supabase/migrations/20261002120000_other.sql", "create table u (id int);\n");

      expect(hook("end-of-turn.mjs", stop(repo, session))).toMatchObject({ status: 0, stderr: "" });
      expect([...supabaseCalls(repo), ...supabaseCalls(wt)]).toEqual([
        "migration list --local --output-format json",
        "migration up --local",
        "test db",
      ]);
    });
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
