#!/usr/bin/env node
// Stop: sweep every file changed in the session's checkouts before the agent finishes, one retry.
// Catches edits made through Bash, which never reach the per-edit hook.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  ASTRO,
  ESLINT,
  HOOK_PROOF_SCOPE,
  LINTED,
  OUT_OF_SCOPE,
  PGTAP_SCOPE,
  SUPABASE,
  UI_LITERALS,
  UNIT_SCOPE,
  VITEST,
  block,
  git,
  ledgerPath,
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
let skipNote = "";
let sqlChecked = false;

// Applies new migrations, then runs pgTAP. An edited, already-applied migration would need
// db reset, which wipes local data, so that is left to the agent.
function checkSql(root, files) {
  const list = runTool(root, SUPABASE, ["migration", "list", "--local", "--output-format", "json"]);
  if (!existsSync(path.join(root, SUPABASE))) return void report.push(`pgTAP not run (${root}):\n${list.output}`);
  if (!list.ok) {
    // Docker may simply be off: say so instead of blocking. CI's smoke job is the hard gate.
    skipNote =
      "end-of-turn.mjs: pgTAP skipped — local Supabase not reachable (npx supabase start); CI smoke still runs it.";
    return;
  }
  let applied, pending;
  try {
    // The CLI can print an update banner around the JSON.
    const json = JSON.parse(list.output.slice(list.output.indexOf("{"), list.output.lastIndexOf("}") + 1));
    applied = new Set(json.migrations.map((m) => m.remote).filter(Boolean));
    pending = json.migrations.some((m) => m.local && !m.remote);
  } catch {
    return void report.push(
      `Could not parse the output of supabase migration list --local --output-format json (${root}):\n${list.output}`,
    );
  }

  const version = (f) => path.basename(f).split("_")[0];
  const hash = (f) =>
    createHash("sha256")
      .update(readFileSync(path.join(root, f)))
      .digest("hex");
  const migrations = files.filter((f) => f.startsWith("supabase/migrations/"));
  const uncommitted = migrations.filter((f) => git(root, ["cat-file", "-e", `HEAD:${f}`]) === null);
  const ledgerFile = ledgerPath(root);
  let ledger = {};
  try {
    const parsed = JSON.parse(readFileSync(ledgerFile, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ledger = parsed;
  } catch {
    // Missing or corrupt: every applied uncommitted migration is trusted once.
  }
  const saveLedger = () => {
    try {
      mkdirSync(path.dirname(ledgerFile), { recursive: true });
      writeFileSync(ledgerFile, JSON.stringify(ledger));
    } catch {
      // Best effort: a lost ledger only means the next edit is trusted once.
    }
  };

  // Applied and changed since the ledger saw it: stale. A committed one without an entry changed;
  // an uncommitted one without an entry was applied by hand, so trust it. Each version is reported
  // once (the hook can't see a db reset), so its current hash is recorded either way.
  const stale = migrations.filter((f) => {
    if (!applied.has(version(f))) return false;
    const seen = ledger[version(f)] ?? (uncommitted.includes(f) ? hash(f) : undefined);
    ledger[version(f)] = hash(f);
    return seen !== hash(f);
  });
  saveLedger();
  if (stale.length > 0) {
    return void report.push(
      `${stale.join(", ")}: already applied to local Supabase, so pgTAP can't see this edit (${root}).\n` +
        "Put the change in a new migration, or run `npx supabase db reset --local` (wipes local data) " +
        "and then `npx supabase test db`. Reported once per content: fix it now, the next turn trusts " +
        "this version of the file.",
    );
  }
  if (pending) {
    const up = runTool(root, SUPABASE, ["migration", "up", "--local"]);
    if (!up.ok)
      return void report.push(`Migration failed to apply (npx supabase migration up --local, ${root}):\n${up.output}`);
    // Applied now, whatever pgTAP says next.
    for (const f of uncommitted) ledger[version(f)] = hash(f);
    saveLedger();
  }
  const tests = runTool(root, SUPABASE, ["test", "db"]);
  if (!tests.ok) {
    report.push(
      `pgTAP fails (npx supabase test db, ${root}). Migrations applied in this step stay applied: after ` +
        "editing one, run `npx supabase db reset --local` or add a follow-up migration, then re-run " +
        `\`npx supabase test db\`.\n${tests.output}`,
    );
  }
}

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

  // Once per Stop, in the first checkout with SQL changes: worktrees share one local database.
  const sql = changed.filter((f) => PGTAP_SCOPE.test(f) && existsSync(path.join(root, f)));
  if (sql.length > 0 && !sqlChecked) {
    sqlChecked = true;
    checkSql(root, sql);
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

if (report.length > 0) block(`Fix these before you finish:\n\n${[...report, skipNote].filter(Boolean).join("\n\n")}`);

// Green: the registered checkouts are clean, start the next turn with an empty registry.
if (registry && existsSync(registry)) {
  try {
    writeFileSync(registry, "");
  } catch {
    // Stale entries only widen the next sweep.
  }
}
if (skipNote) process.stdout.write(JSON.stringify({ systemMessage: skipNote }));
process.exit(0);
