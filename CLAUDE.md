# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: Meritly

Web app where budget-holding supervisors split a milestone's bonus pool among employees with a weighted formula: the milestone KPI multiplier scales the target pool into a payout pool, which is split proportionally by time share × role weight × contribution-rating factor, rounded down. The multiplier scales the pool, never each employee's weight (it would cancel out in the proportional split). Requirements: @context/foundation/prd.md. Stack rationale: @context/foundation/tech-stack.md.

Roles: **Admin** (global config, sees everything), **Supervisor** (own projects, milestones, engagement, KPI scores), **Employee** (own Approved results and history only).

Invariants that must hold in code and in the database:

- A milestone's payouts never exceed its payout pool (target pool × KPI multiplier ÷ maximum multiplier, rounded down), and the payout pool never exceeds the target pool, which is the approved maximum. A project's worst-case payout (actual payout pool for Approved milestones, target pool for the rest) is flagged against the project budget.
- An employee's total time-share across active milestones is flagged when it exceeds 100%.
- Results are Draft (Supervisor-only, no email) until the Supervisor marks the milestone Approved (FR-018). Only then can the employee see them and get the email.
- Approved milestones are frozen: changes to role weights, KPI weights or the rating→factor mapping apply to future computations only.
- An employee must never see another employee's figures, including by changing IDs in a URL. Enforce this with RLS, not with page-level filtering.

RLS rules for this project:

- Store roles in a `profiles` table keyed to `auth.users`, not in `user_metadata` (users can edit it).
- Employee `select` policies on results must also require the parent milestone to be `approved`.
- Views over RLS-protected tables need `security_invoker = true`, otherwise they bypass RLS.
- `SUPABASE_KEY` is the public key, so queries run as the signed-in user and RLS applies. The service-role key bypasses RLS: server-side only, never in user-facing route handlers.
- A migration that adds or changes a table, view, policy, grant or `security definer` function must update `supabase/tests/rls_catalog_guard.test.sql` and `supabase/tests/rls_matrix.test.sql` (see `context/foundation/test-plan.md` §6.1). Exception: a migration that changes only the body of a view or `security invoker` function (same name, columns, `security_invoker`, grants and definer status) adds `rls_matrix` cells for the changed behaviour and leaves the catalog guard unchanged.

## Key conventions

- **Path alias**: `@/*` maps to `./src/*` (tsconfig paths).
- **Components**: use `.astro` unless the component needs state, effects or event handlers; only then use a React `.tsx` component.
- **Tailwind class merging**: use the `cn()` helper from `@/lib/utils` (clsx + tailwind-merge) for conditional/merged class names. Do not concatenate class strings manually.
- **shadcn/ui**: components live in `src/components/ui/`, "new-york" style variant. Install new ones with `npx shadcn@latest add [name]`.
- **API routes**: use uppercase `GET`, `POST` exports; validate input with zod.
- **Supabase migrations**: `supabase/migrations/` using naming format `YYYYMMDDHHmmss_short_description.sql`. Enable RLS in the same migration that creates the table, with one policy per operation (select, insert, update, delete) per role and no `for all` policies.
- **React**: no Next.js directives ("use client" etc.). Extract hooks to `src/components/hooks/`.
- **Services/helpers** go in `src/lib/` (or `src/lib/services/` for extracted business logic).
- **Shared types** (entities, DTOs) go in `src/types.ts`.
- **i18n (PL default, EN)**: user-visible text lives in `src/lib/i18n/messages/{pl,en}.ts` (or a service's locale-keyed catalog), never as literals. Read it via `getMessages(Astro.locals.locale)`; resolvers take `locale`; React islands get plain-string label props. Number formats stay pl-PL in both languages. Tests assert the PL dictionary text and pin `lang=pl` for seeded sessions.

## Commands

- `npm run smoke` — dependency-free auth-flow smoke test (`scripts/smoke.mjs`) against a running server, `BASE_URL` env (default `http://localhost:4321`). Run after dependency upgrades; the `smoke` job (PR and push to `master`) runs it against the production preview with a local Supabase. Needs Supabase reachable with email confirmation disabled. The role × route, `next`, path-normalisation and IDOR steps sign in as the seeded accounts and use the "Approved Demo Project" from `supabase/seed.sql` (local Supabase only); `npx supabase db reset --local` restores them.
- `npx astro sync` / `npx astro check` — regenerate Astro types / type-check. CI runs both (sync before lint) but there is no npm script for them.
- `npx supabase functions serve` — serves the Edge Functions locally; needed for employee invites and approval emails (copy `supabase/functions/.env.example` to `supabase/functions/.env` first; mail lands in the test inbox at `http://127.0.0.1:54324`). The Deno code in `supabase/functions/` is excluded from `tsconfig.json` and ESLint.
- `npm run lint:ui` — fails on literal colours, palette classes or arbitrary px/rem values in the views listed in `CLEAN_PATHS` (`scripts/check-ui-literals.mjs`). CI runs it after lint.

- `npm test` — Vitest unit tests (`src/**/*.test.ts`, plain `vitest.config.ts`, no Astro pipeline, so modules importing `astro:*` aren't unit-testable). Single file: `npx vitest run src/lib/__tests__/forms.test.ts`.
- `npm run test:hooks` — proof for the agent hooks in `.claude/hooks/` (`scripts/__tests__/agent-hooks.test.ts`, `vitest.hooks.config.ts`, ~10 s): runs the real hook scripts in throwaway git repos with a stubbed toolchain. The `Stop` hook re-runs it whenever a hook file changes. Per edit (`PostToolUse`): ESLint + UI literal check + related unit tests on the edited file; at end of turn (`Stop`, one retry): the same on every changed file, the full unit suite and `astro check`; when the turn changed `supabase/migrations` or `supabase/tests` SQL, also applies pending migrations (`supabase migration up --local`) and runs `supabase test db` (60 s per CLI call; reports an edited, already-applied migration once per content, then trusts it; blocks when the Supabase CLI is missing; never resets the database; skips with a message when local Supabase is unreachable or times out).
- `npm run test:mutation` — StrykerJS mutation testing of `src/lib` (`stryker.config.mjs`, HTML report in `reports/mutation/index.html`). The full run takes ~5 min; scope it with `npm run test:mutation -- --mutate src/lib/forms.ts`. Keep `vitest` on `^4`: under Vitest 5 the Stryker runner reports every mutant as survived.
- `npm run test:integration` — Vitest integration suite (`vitest.integration.config.ts`, `tests/integration/**/*.integration.test.ts`); not part of `npm test` or Stryker; CI runs it in the PR `integration` job. Needs `npx supabase start`, `npx supabase functions serve` (with `supabase/functions/.env`) and Mailpit, plus the env vars `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (`API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY` from `npx supabase status -o env`) and `MAILPIT_URL` (default `http://127.0.0.1:54324`). A missing variable fails the run, it never skips. Each run leaves fixture projects in the local database; `npx supabase db reset --local` clears them. Recipe: `context/foundation/test-plan.md` §6.4.
- `npm run test:e2e` — Playwright suite (`tests/e2e/`, `playwright.config.ts`; the webServer builds and starts the production preview itself); CI runs it in the PR `e2e` job. Needs `npx supabase start` and `.dev.vars` with the `E2E_*` seed-account vars (see `.env.example`). Each run leaves one approved US-01 project; `npx supabase db reset --local` clears it. Recipe: `context/foundation/test-plan.md` §6.5.

Pre-commit hooks (installed by the `prepare` script on `npm install`): husky + lint-staged runs `eslint --fix` and the UI literal check on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}`.

## UI

- **Tokens** live in `src/styles/global.css`: values in `:root` / `.dark`, published as Tailwind colours through `@theme inline`. The app runs dark (`<html class="dark">` in `Layout.astro`). Beyond shadcn's set there are `success`, `success-foreground` and `background-accent`; `bg-cosmic` is the page-shell gradient built from tokens. Value sources: `context/archive/*-ui-projects-panel/tokens.md` (or `context/changes/ui-projects-panel/tokens.md` until archived).
- **Components** live in `src/components/ui/` (shadcn). Check there before creating a component; add missing ones with `npx shadcn@latest add <name>`, then fix the `cn` import to `@/lib/utils` and drop any `"use client"`. Submit buttons use `src/components/SubmitButton.tsx` (`client:load`, shows a pending state).
- **No literal colours, palette classes (`text-purple-300`, `bg-white/10`) or arbitrary values (`ring-[3px]`) in views** — use token classes (`bg-card`, `text-muted-foreground`, `text-primary`, `ring-3`). Dark-mode or palette changes go into token values, not view classes. Views not yet migrated still use `src/components/form-classes.ts`; don't copy it into new views.
- **Kitchen sink**: `/dev/projects-kitchen-sink` (dev only, 404 in production) shows the project detail sections in all 7 states (default, hover, focus-visible, disabled, error, empty, loading). Use it as the visual gate when changing those components.
- **Guard**: `npm run lint:ui` (pre-commit and CI) checks the views listed in `CLEAN_PATHS` in `scripts/check-ui-literals.mjs`. When you migrate another view onto tokens, add it there.

## Architecture

**Astro 7 SSR app** with React 19 islands, Tailwind 4, Supabase auth, and shadcn/ui components. Deployed to Cloudflare Workers.

### Rendering mode

Full server-side rendering (`output: "server"` in astro.config.mjs). All pages and API routes are server-rendered by default.

### Auth flow

- `src/lib/supabase.ts` — creates a Supabase SSR client using `@supabase/ssr` with cookie-based sessions. Uses `astro:env/server` for `SUPABASE_URL` and `SUPABASE_KEY` (server-only secrets declared in astro.config.mjs `env.schema`).
- `src/middleware.ts` — runs on every request, resolves the current user, attaches to `context.locals.user`. Redirects unauthenticated users away from routes listed in `PROTECTED_ROUTES` to `/auth/signin?next=<page>` (pages only, validated by `safeNext`), so sign-in returns them there. `ADMIN_ROUTES` (`/admin`, `/api/admin`) require the `admin` role and `PROJECT_ROUTES` (`/projects`, `/api/projects`, `/employees`, `/api/employees`, `/reports`, `/api/reports`) require `supervisor` or `admin`, and `EMPLOYEE_ROUTES` (`/my-bonuses`) require `employee` (403 otherwise, 503 when the profile lookup failed); RLS still decides which projects and employees each role sees.
- API endpoints: `src/pages/api/auth/{signin,signup,signout,set-password}.ts`
- Language: the `lang` cookie (default `pl`) decides `locals.locale`. `POST /api/locale` (public form, `LanguageSwitch.astro` in Layout) sets it and, when signed in, saves it to `profiles.locale` via the `set_my_locale` RPC; sign-in saves the cookie's language the same way, and the middleware restores a missing cookie from the profile.
- Auth pages: `src/pages/auth/{signin,signup,confirm-email,set-password}.astro`
- `/auth/confirm` (`src/pages/auth/confirm.ts`) — public invite-link target: `verifyOtp` with the `token_hash` (type `invite`) signs the user in, then redirects to `/auth/set-password`, a protected page where the invited employee sets a password.
- Supabase Edge Functions `invite-employee` (`supabase/functions/invite-employee/`, sends invites) and `notify-milestone-approved` (`supabase/functions/notify-milestone-approved/`, emails each employee their own bonus after approval and stamps `notified_at`; Resend in production, Mailpit locally) are the only code that uses the secret key. They run in Supabase, not the Worker; the app calls them with the user's JWT via `supabase.functions.invoke`. The Worker still has only `SUPABASE_URL`/`SUPABASE_KEY`.
- Protected page example: `src/pages/dashboard.astro`

### Environment

- Node.js 22.22.3+ (see `.nvmrc`); older 22.x releases trigger `EBADENGINE` warnings from `eslint-plugin-astro` and `astro-eslint-parser`
- Env vars: `SUPABASE_URL`, `SUPABASE_KEY` (copy `.env.example` to `.env` for Node, or `.dev.vars` for Cloudflare local dev)
- Local Supabase: `npx supabase start` (requires Docker). Use it for development: `.env.example` points at a real hosted Supabase project, so overwrite its values with the `supabase start` output and don't sign up test users there.
- Cloudflare local dev: secrets go in `.dev.vars` (gitignored)
- Deploy: `npx wrangler deploy` (requires Cloudflare account + `wrangler` auth)

## CI

Two GitHub Actions workflows. `PR` (@.github/workflows/pr.yml) runs on pull requests into `master` or `develop`, with no secrets, in four jobs: `checks` (astro sync, lint, `lint:ui`, `astro check`, `npm test`, build), `smoke` (local Supabase, `supabase test db`, production preview, `npm run smoke`), `integration` (local Supabase with Mailpit and edge runtime, `supabase functions serve`, `npm run test:integration`) and `e2e` (local Supabase, Chromium, `npm run test:e2e` with the seed accounts; report uploaded on failure). `CI` (@.github/workflows/ci.yml) runs on push to `master`: a `ci` job (the `checks` steps; build needs the `SUPABASE_URL` and `SUPABASE_KEY` repository secrets) and the same `smoke` job. The Supabase CLI is the lockfile-pinned `npx supabase`. Branch protection on `master` requires all four PR checks `checks`, `smoke`, `integration` and `e2e`.
<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 3, Lesson 5 (Debugging)

Turn a failure into a fix the agent can defend: evidence first, then a failing test, then the fix.

```
signal (monitoring | log | flaky E2E | stack trace) -> gather evidence -> reproduce -> failing test -> fix -> verify
```

### Task Router - Where to start

| Skill                                                            | Use it when                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/10x-frame`                                                     | The report arrives as "bug + proposed fix". Check that the observed symptom and the stated cause actually match before anyone fixes anything.                                                                                                                    |
| `/10x-new` -> `/10x-research` -> `/10x-plan` -> `/10x-implement` | The fix is more than a one-liner. Research collects the evidence; the plan starts with the failing regression test.                                                                                                                                              |
| `/10x-tdd`                                                       | Writing the regression test that reproduces the bug before the fix.                                                                                                                                                                                              |
| `/10x-e2e`                                                       | The bug only shows up in the running app. Reproduce it in the browser and keep that test.                                                                                                                                                                        |
| `/10x-observability-audit`                                       | Errors are missing, noisy or impossible to diagnose in production. It audits the critical flows for code that hides failures and writes a dated report under `context/audits/observability/`. Use `--verify <report>` to re-check an earlier report after fixes. |

### Hard rules

- **Evidence before a hypothesis.** Use what the error tracker, the logs, a reproduction and the code each show. Never guess a cause from the stack trace alone.
- **The bug becomes a failing test first.** The fix is done when that test goes from red to green and stays in the suite.
- **Never hide the evidence.** No empty `catch`, no ignored promise rejections, no failures turned into redirects or `200`s, no dropped error causes. If the fix needs a `catch`, it logs or reports the error with its cause.
- **Fix the cause, not the test.** Don't edit an assertion to match the new behaviour unless the requirement itself changed.

### Lesson boundaries

- `/10x-observability-audit` reads code and writes a report. It never changes the audited code. Fixing what it finds goes through the change chain.
- Choosing a monitoring vendor is `/10x-infra-research`, not this lesson.

<!-- END @przeprogramowani/10x-cli -->
