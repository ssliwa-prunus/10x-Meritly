---
name: 10x-e2e-setup
description: One-time, re-runnable Playwright E2E setup for an existing web app. Detects the stack, port, package manager, auth and any existing Playwright files, then fills only the gaps - installs @playwright/test, creates or extends playwright.config.ts (webServer on build + preview, a setup project with storageState, traces and screenshots on failure), writes and greens one seed test for a browser-level risk, wires playwright-cli into your agent, and records everything in context/foundation/test-stack.md. Hands off to /10x-e2e. Use when the user says "set up Playwright", "e2e setup", "prepare E2E tests", "no playwright config", or when /10x-e2e redirects here.
---

# 10x E2E Setup — Playwright Infrastructure for `/10x-e2e`

You take a project from "no Playwright" (or "some Playwright") to exactly what `/10x-e2e` needs, and nothing more:

```
DETECT → INSTALL → CONFIG → SEED → AGENT WIRING → RECORD → HAND OFF
```

Every step first checks whether its result is already there and only fills the gap. **A second run on a finished project changes no files** — no rewritten config, no second `playwright-cli` install, no new `updated` date. That is the test of this skill.

Optional argument: `$ARGUMENTS` — a risk id or a one-line risk for the seed (skips the risk question in step 4).

## What this skill owns — and what it won't do

It owns: the Playwright config, `tests/e2e/auth.setup.ts`, the seed test, the `playwright-cli` wiring, and the `## E2E` section of `context/foundation/test-stack.md`.

In the config, "owns" means the **app `webServer` entry** (the one whose `url` is the base URL) and every field `test-stack.md` records. `/10x-e2e` may later add extra `webServer` entries for mock servers (the array form) and hook its mock into the app entry (`references/playwright-setup-templates.md` → "Who owns what in the config"). A re-run reads and records only the app entry's build + preview command, url, port and `reuseExistingServer`, and never touches the extra entries.

It will not:

- write E2E tests beyond the seed — that is `/10x-e2e`;
- touch CI workflows;
- overwrite an existing config key or spec without asking;
- write to your agent's rules file (`CLAUDE.md`, `AGENTS.md`, …). The E2E rules matter only while you work on E2E tests, so they ship in the skills' `references/e2e-quality-rules.md` and load with `/10x-e2e`, not in every session. An E2E rules block an earlier version of this skill appended is left alone; you can delete it;
- read or print secret values, create users outside the local stack, or commit credentials;
- commit anything — the learner reviews and commits the result.

## Conventions

> **Asking the user — host-agnostic.** Wherever this skill says _ask the user_, use whichever interactive-question tool your agent exposes; don't hard-code one tool name. Before the first question, scan your available tools for one that asks the user a structured question (a `question` parameter plus an `options`/`choices` field) and use the first match. If there is none, ask in a plain conversational message listing the labelled options and wait for the reply — never block the procedure. The first time you ask, say which tool you used (or that you fell back to plain chat). Ask only what you could not detect.

> **Clipboard convention.** Wherever this skill says _copy `X` to the clipboard_, pipe the exact string `X` to the platform clipboard — try `pbcopy` (macOS), then `clip.exe` (Windows/WSL), then `xclip -selection clipboard` (Linux), or `Set-Clipboard` in PowerShell, and fall back silently if none exist. Then display the copied command on its own line suffixed with `(✓ copied)`.

> **Per-tool values.** Everything that differs per agent tool — the skill directory, the `playwright-cli install --skills` target, how a skill is invoked — lives in `references/tool-wiring.md`. Look it up there by the tool id; never guess it.

Keep a short checklist in the conversation, one line per step (`- [ ] 1. Detect` … `- [ ] 7. Hand off`), and mark each step `done`, `already in place` or `changed`. The final report is built from it.

---

## 1. Detect

Read, don't write. Collect these facts and show them to the user as one short table before step 2.

1. **Agent tool.** Resolve the tool id as described in `references/tool-wiring.md` → "Which tool is this?": the `.10x-cli-manifest.json` in the tool directory this skill is installed under (`<tool dir>/skills/10x-e2e-setup/` → `<tool dir>/.10x-cli-manifest.json`); otherwise the newest manifest among the table's manifest dirs; otherwise match the directory this skill runs from against the table's skill dirs; otherwise ask the user. From the table take the **skill dir** and **`--skills` target**.
2. **Package manager** from the lockfile: `package-lock.json` → npm, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `bun.lock`/`bun.lockb` → bun. Use it for every install and run command.
3. **Stack and commands.** From `package.json` scripts and the framework config: the build command and the production-like preview/start command. Prefer build + preview over the dev server.
4. **Port — read it, never assume it.** In order:
   - an explicit port in the framework config (e.g. `server.port` in `astro.config.*`, `preview.port`/`server.port` in `vite.config.*`);
   - a `--port`/`-p` flag in the preview/start script;
   - the framework's documented default for its preview/start command (e.g. Astro 4321, Vite preview 4173, Next.js 3000).
     Record where the number came from. If `E2E_PORT` is already set in the env file (a name, and a port number is not a secret, so read it), that is the port the run uses: the user answered the port question on an earlier run, so don't ask it again.
5. **Is the port free?** Check the port the run uses (`E2E_PORT` if set, else the detected one) before you rely on it: `lsof -nP -iTCP:<port> -sTCP:LISTEN` (macOS/Linux) or `netstat -ano | findstr :<port>` (Windows); `nc -z localhost <port>` also works. If something is listening, say so plainly and name the process if you can: with `reuseExistingServer` outside CI, Playwright would **silently test whatever app already runs there**. Offer two ways out — stop that process, or set `E2E_PORT=<free port>` in the env file (the config reads it). Never pick a new default port on your own.
6. **Existing Playwright.** `@playwright/test` in `package.json`; `playwright.config.*` (read it fully: `testDir`, `use.baseURL`, `webServer`, projects, `storageState`, `trace`, `screenshot`); existing specs (`*.spec.ts`, `*.setup.ts`); an existing seed (a file named `seed.spec.ts`, or the `seed` field of `test-stack.md`).
7. **Unit-test runner overlap.** If a unit runner (e.g. Vitest, Jest) is configured, check its include globs. If they would also collect `tests/e2e/**/*.spec.ts`, the E2E specs must be excluded there — note it for step 3.
8. **Auth approach.** Look at the middleware / route guards, the sign-in page and its form, and the auth provider (e.g. Supabase, Auth.js, Clerk, a custom session). Record: protected routes, the sign-in path, the post-login landing page, and whether the provider runs locally (e.g. `supabase/config.toml` → a local stack via `npx supabase start`). No login at all → `auth: none`.
9. **App env.** Which gitignored env file the app reads (e.g. `.env`), whether the preview reads a different one (see `references/playwright-setup-templates.md` → Preview env), and whether the backend URL there points at a local stack. Read variable **names** only, never values — except to check that a backend URL is local.
10. **Test plan and state.** `context/foundation/test-plan.md` (browser-level risks) and `context/foundation/test-stack.md` (an existing `## E2E` section).

If the project has no web app to drive (no server/preview command at all), stop and say that E2E needs a runnable app.

## 2. Install

Only what is missing:

- `@playwright/test` not in `package.json` → add it as a dev dependency with the detected package manager (`npm i -D @playwright/test`, `pnpm add -D @playwright/test`, `yarn add -D @playwright/test`, `bun add -d @playwright/test`).
- Browser: `npx playwright install chromium` (use the package manager's exec equivalent). It is a no-op when the browser is already there and changes no project files.

Record the installed version (`npx playwright --version`).

## 3. Config

Use `references/playwright-setup-templates.md`.

- **`.gitignore` first** (before the first `playwright-cli` call): append the missing Playwright lines from the template (at least `playwright/.auth/` and `.playwright-cli/`, which the first `playwright-cli` call creates, with snapshots and console logs that can hold credentials), and confirm the env file with the credentials is ignored.
- **Start the app for exploration.** Steps 3 and 4 explore the sign-in page and the seed's flow with `playwright-cli`, so the app must be running: run the build command, then start the preview command on the port from step 1.4–1.5 **in the background** (the same commands the `webServer` entry runs; check the template's stack notes first). Stop it, and any daemon it left behind, **before any `playwright test` run**, so `webServer` starts and owns the server. A server left running is silently reused and hides a stale build. Pass a named session on every `playwright-cli` call (`-s=<repo-name>`); the default session is shared by every project on the machine (see `references/tool-wiring.md` → "One browser session per project"). `playwright-cli fill` echoes the value it typed in its output and logs: when you type the test user's password, keep that line out of what you show the user.
- **No config** → create `playwright.config.ts` from the template, filled with the detected values: the `PORT` constant defaults to the detected port and reads `E2E_PORT` first; `webServer` runs build + preview **on that port** (the port passed explicitly to the preview command), `url: baseURL`, `reuseExistingServer: !process.env.CI`; `use.baseURL`; a `setup` project matching `*.setup.ts` whose session file is `playwright/.auth/user.json`, loaded through `use.storageState` by the browser project that depends on it; `trace: 'on-first-retry'` and `screenshot: 'only-on-failure'`; env loaded explicitly from the gitignored env file.
- **Config exists** → add only the missing pieces (template → "Extending an existing config"). If a key exists with a different value, ask the user before changing it and show both values. Keys that already match stay byte-identical. When `webServer` is an array, compare only the app entry; the other entries are `/10x-e2e`'s mock servers, so leave them as they are.
- **Auth setup** (skip when `auth: none`): if no `*.setup.ts` exists, open the sign-in page with `playwright-cli` (step 5 installs it; `npx -y @playwright/cli` works before that), take a snapshot, and write `tests/e2e/auth.setup.ts` from the template using the accessible names you saw. It signs in through the real UI with `E2E_USERNAME` / `E2E_PASSWORD` from the env file and saves `playwright/.auth/user.json`.
- **Test user**: if `E2E_USERNAME` / `E2E_PASSWORD` are not set, follow the template's "Test user (local only)" section — confirm the backend is local, create the user there (or ask the user to), and put the two variables in the gitignored env file.
- **`.env.example`**: whether or not the test user already existed, add the two names (no values) if that file exists and lacks them.
- **Unit-runner overlap** from step 1.7: ask before adding the E2E directory to that runner's exclude list.

## 4. Seed

The seed is the exemplar every generated test copies (`references/seed-test-pattern.md`), so it must be small, correct and green.

- **Seed exists** (the `seed` path from `test-stack.md`, or a `seed.spec.ts`) → do not rewrite it; just run it (below).
- **Seed absent → choose one risk.** If `$ARGUMENTS` names one, use it. Otherwise, if `context/foundation/test-plan.md` exists, take its **browser-level** risks and pick the one that is **quickest to make green without mocks**, e.g. an auth-gate redirect over a flow that calls an external API. A risk is browser-level when its row in the test plan's risk-response table names e2e as (part of) its cheapest layer, or when the E2E rollout phase names it in a scenario. Either way, it is not browser-level when that row steers away from e2e (this wins over the rollout phase listing it) (both hold: the cheapest layer is unit/integration **and** the anti-pattern column warns against e2e; a silent anti-pattern column doesn't exclude it). Keep the others for `/10x-e2e`. Only when there is no test plan, ask the user for one browser-level risk and the observable outcome that proves it. A risk without an id (one the user described) gets a short kebab-case slug, e.g. `auth-gate-roundtrip`.
- **Is the outcome built?** Explore the flow before you commit to the risk. If the observable outcome isn't what the app does today (e.g. the user expects a return to the protected page, but sign-in always lands on `/`), tell the user. Then seed the part that is built and record the rest as not built, or pick another risk. Never assert behaviour the app doesn't have.
- **Write** `tests/e2e/seed.spec.ts` (or the project's existing E2E directory) following the four patterns in `references/seed-test-pattern.md`: role-based locators, a self-contained setup → action → assertion → cleanup, waits for state, and a test name that names the risk. Explore the flow with `playwright-cli` first and use the accessible names the snapshot shows. Wait for the form to be interactive before typing (see the seed pattern: input typed into a form that hasn't hydrated yet is lost). Add a provenance comment with the risk id. A seed whose risk is the signed-out path opts out of the saved session (see the seed pattern).
- **Run it to green from a cold server** with the single-spec command (the `setup` project runs first as a dependency). Stop the exploration server first and confirm nothing listens on the port (the step 1.5 command prints nothing), so `webServer` builds and starts the app itself. A warm server hides hydration races and stale builds, so a seed that only went green against one is not proven. If the backend is a local stack, make sure it is running. On red: read the error and trace, fix the seed or the setup — never loosen the assertion until it can no longer fail, and never skip the test. Then ask the control question: would this assertion fail if the risk came true? If not, strengthen it. (The full deliberate-break check is `/10x-e2e`'s job.)

## 5. Agent wiring

Follow `references/tool-wiring.md` → "Wiring `playwright-cli` into the agent" with the tool id from step 1.1: the global CLI (only if `playwright-cli --version` fails), then the command skill with that tool's `--skills` target (only if it is not already in the tool's skill dir), then the copy step where the table says so. Report what `install` added (`.playwright/`, the `.playwright-cli/` line in `.gitignore`).

## 6. Record

Write the `## E2E` section of `context/foundation/test-stack.md` exactly as `references/test-stack-e2e-schema.md` defines it — every required field, filled with the facts from steps 1–5 (for `web server command`, the app entry's build + preview command only). Preserve the rest of the file. If every field except `updated` already matches, leave the file untouched. Create `context/foundation/` if it doesn't exist.

## 7. Hand off

Pick the next risk from `test-plan.md`: the highest-priority risk that (a) is **not the seed's risk**, (b) is **browser-level** (the step 4 rule, which reads the test plan's cheapest-layer column), and (c) has **no spec yet** (search the E2E directory's provenance headers and test names for its id). Copy `/10x-e2e <risk-id>` to the clipboard. If no risk qualifies, or there is no test plan, copy `/10x-e2e` without a risk (it asks for one). Never hand off the seed's risk. Then print:

```
E2E setup — done

[checklist: each step with done / already in place / changed]

Created or changed:
- [files, one per line — or "nothing: the project was already set up"]

Review before you commit:
- tests/e2e/seed.spec.ts — the pattern every generated test will copy
- playwright.config.ts (port [port] from [source]; override with E2E_PORT)

Never commit: playwright/.auth/, the env file with E2E_USERNAME / E2E_PASSWORD.

Next — write the first reviewed test for a risk:
→ /10x-e2e [risk-id, or nothing] (✓ copied)
```

Add one line with the invocation form for the detected tool from the table in `references/tool-wiring.md` when it differs from the slash form. Then STOP.

## References

- `references/tool-wiring.md` — per-tool skill dir, manifest dir, `--skills` target, invocation; `playwright-cli` install and what it changes.
- `references/playwright-setup-templates.md` — config, auth setup, test user and `.gitignore` templates.
- `references/test-stack-e2e-schema.md` — the `## E2E` section contract read by `/10x-e2e` and `/10x-tdd`.
- `references/seed-test-pattern.md` — the four patterns a seed carries, with an exemplar (shared with `/10x-e2e`).
- `references/e2e-quality-rules.md` — the E2E rules the seed follows and `/10x-e2e` enforces, with the reasoning behind them (shared with `/10x-e2e`).
