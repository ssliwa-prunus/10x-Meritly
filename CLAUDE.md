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

## Commands

- `npm run smoke` — dependency-free auth-flow smoke test (`scripts/smoke.mjs`) against a running server, `BASE_URL` env (default `http://localhost:4321`). Run after dependency upgrades; the `smoke` job (PR and push to `master`) runs it against the production preview with a local Supabase. Needs Supabase reachable with email confirmation disabled. The role × route, `next`, path-normalisation and IDOR steps sign in as the seeded accounts and use the "Approved Demo Project" from `supabase/seed.sql` (local Supabase only); `npx supabase db reset --local` restores them.
- `npx astro sync` / `npx astro check` — regenerate Astro types / type-check. CI runs both (sync before lint) but there is no npm script for them.
- `npx supabase functions serve` — serves the Edge Functions locally; needed for employee invites and approval emails (copy `supabase/functions/.env.example` to `supabase/functions/.env` first; mail lands in the test inbox at `http://127.0.0.1:54324`). The Deno code in `supabase/functions/` is excluded from `tsconfig.json` and ESLint.
- `npm run lint:ui` — fails on literal colours, palette classes or arbitrary px/rem values in the views listed in `CLEAN_PATHS` (`scripts/check-ui-literals.mjs`). CI runs it after lint.

- `npm test` — Vitest unit tests (`src/**/*.test.ts`, plain `vitest.config.ts`, no Astro pipeline, so modules importing `astro:*` aren't unit-testable). Single file: `npx vitest run src/lib/__tests__/forms.test.ts`.
- `npm run test:mutation` — StrykerJS mutation testing of `src/lib` (`stryker.config.mjs`, HTML report in `reports/mutation/index.html`). The full run takes ~5 min; scope it with `npm run test:mutation -- --mutate src/lib/forms.ts`. Keep `vitest` on `^4`: under Vitest 5 the Stryker runner reports every mutant as survived.
- `npm run test:integration` — Vitest integration suite (`vitest.integration.config.ts`, `tests/integration/**/*.integration.test.ts`); not part of `npm test` or Stryker; CI runs it in the PR `integration` job. Needs `npx supabase start`, `npx supabase functions serve` (with `supabase/functions/.env`) and Mailpit, plus the env vars `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (`API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY` from `npx supabase status -o env`) and `MAILPIT_URL` (default `http://127.0.0.1:54324`). A missing variable fails the run, it never skips. Each run leaves fixture projects in the local database; `npx supabase db reset --local` clears them. Recipe: `context/foundation/test-plan.md` §6.4.

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
- `src/middleware.ts` — runs on every request, resolves the current user, attaches to `context.locals.user`. Redirects unauthenticated users away from routes listed in `PROTECTED_ROUTES` to `/auth/signin?next=<page>` (pages only, validated by `safeNext`), so sign-in returns them there. `ADMIN_ROUTES` (`/admin`, `/api/admin`) require the `admin` role and `PROJECT_ROUTES` (`/projects`, `/api/projects`, `/employees`, `/api/employees`) require `supervisor` or `admin`, and `EMPLOYEE_ROUTES` (`/my-bonuses`) require `employee` (403 otherwise, 503 when the profile lookup failed); RLS still decides which projects and employees each role sees.
- API endpoints: `src/pages/api/auth/{signin,signup,signout,set-password}.ts`
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

Two GitHub Actions workflows. `PR` (@.github/workflows/pr.yml) runs on pull requests into `master` or `develop`, with no secrets: `checks` (astro sync, lint, `lint:ui`, `astro check`, `npm test`, build), `smoke` (local Supabase, `supabase test db`, production preview, `npm run smoke`) and `integration` (local Supabase with Mailpit and edge runtime, `supabase functions serve`, `npm run test:integration`). `CI` (@.github/workflows/ci.yml) runs on push to `master`: a `ci` job (the `checks` steps; build needs the `SUPABASE_URL` and `SUPABASE_KEY` repository secrets) and the same `smoke` job. The Supabase CLI is the lockfile-pinned `npx supabase`. Branch protection on `master` requires the three PR checks `checks`, `smoke` and `integration`.
<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 3, Lesson 2

Lesson 2 is about **writing tests that actually protect code** — not just maximise coverage. The oracle problem and vibe-testing anti-patterns explain why LLM-generated tests fail on real code; the risk-first quality contract from Lesson 1 is the fix.

```
context/foundation/test-plan.md (§3 Phased Rollout)
        │
        ▼  (one rollout phase at a time)
   /10x-research  ──►  research.md  (oracle source: what code should do, not what it does)
        │
        ▼
   /10x-plan  ──►  plan.md  (cost × signal, two-layer strategy, ordered phases)
        │
        ▼
   /10x-implement  or  /10x-tdd   ──►  working tests + §6 cookbook update
```

`/10x-tdd` is an **optional test-first mode**, not a replacement for the chain. It reads the same `plan.md`, writes to the same `## Progress` section, and covers the same phases as `/10x-implement`. Use it only when you can name the first failing assertion before writing any code.

### Task Router — Where to start

| Skill / Prompt               | Use it when                                                                                                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/10x-research`              | Before writing any test for a risk. Research produces the oracle — what behaviour a test must prove — from sources (PRD, tech-stack, docs), not from the implementation shape. Also reveals whether a risk is already covered or has two separate faces (one safe, one real).                     |
| `/10x-plan`                  | Research is done. Plan decomposes the risk into ordered phases: environment setup first, then rules that depend on it, then hermetic stubs for failures that real infra cannot trigger, then cookbook update. Each phase names the behaviour it asserts and the regression it catches.            |
| `/10x-implement`             | Default executor for plan phases. Use for environment setup, existing code, scaffolding, and any phase where you cannot define a red test before writing code.                                                                                                                                    |
| `/10x-tdd`                   | Optional. Use instead of `/10x-implement` for a phase where you can name the first red test in one sentence. Agent writes the failing test first, then the minimal code to green it, then refactors. Stops at the assertion before touching the implementation — that pause is the point.         |
| `m3l2-ad-hoc-testing` prompt | You have a single file and want tests now, without the full research→plan→implement cycle. The prompt forces oracle-from-sources (reads PRD + TECH_STACK before asserting), behavioural assertions, edge cases from risk, and a regression table. Use it knowing you are trading depth for speed. |

### When to use `/10x-tdd` vs `/10x-implement`

The deciding question: _Can you name the first red test in one sentence?_

Good conditions for `/10x-tdd`:

- "promuje wyłącznie drafty w stanie `accepted`, a `pending`/`rejected` nigdy nie trafiają do talii"
- "zwraca `ok: true` i loguje `orphan_review_state`, gdy upsert stanu powtórek padnie w trakcie zapisu"
- "zwraca 401, gdy użytkownik nie ma dostępu do kursu"
- "resetuje interwał powtórki do jednego dnia, gdy ocena wynosi 0"

Each of these names an observable outcome, not an internal detail. If you cannot produce a sentence like this, stay on `/10x-implement` or return to `/10x-research`.

`/10x-tdd` is **not suited** for: environment setup, CI/CD config, documentation, thin wiring where the test would just rewrite the implementation, or a spike where you are still discovering the contract.

You can mix both modes in one plan:

```
/10x-implement <change-id> phase 1   # environment
/10x-tdd       <change-id> phase 2   # contract (new code)
/10x-tdd       <change-id> phase 3   # contract (API endpoint)
/10x-implement <change-id> phase 4   # cookbook + plan sync
```

Both write progress to the same `## Progress` section in `plan.md`.

### Two-layer test strategy (cost × signal)

For each risk, pick the **cheapest test that gives a real signal**. Do not default to e2e "because it's safest", and do not chase coverage percentage.

| Layer                              | When to use                                                                                              | When NOT to use                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Integration (real DB / real infra) | The rule involves DB constraints, cascades, real SQL, or unique constraints that a mock would lie about. | Auth flows gated by RLS that belong to a separate phase; anything where setup cost exceeds signal value. |
| Hermetic (stub client)             | Partial failures that real infra cannot trigger easily (e.g. second operation in a sequence fails).      | Rules that depend on actual DB state — a stub will lie about constraint violations and cascades.         |

A non-atomic save sequence (multiple independent operations without a transaction) means: write hermetic tests for partial-failure branches, not integration tests that force a mid-sequence error.

### Oracle rules

- The oracle — what the code _should_ do — must come from sources: PRD, docs, tech-stack constraints, domain knowledge. It must **not** come from reading the implementation.
- If the implementation has a bug, copying its output as the expected value produces a mirror test that passes against the bug.
- When sources do not resolve the expected behaviour unambiguously, **stop and ask** rather than guessing.
- Research's job is to surface the oracle before any test is written.

### Vibe-testing anti-patterns to avoid

| Anti-pattern          | How it looks                                                                  | What to do instead                                                                               |
| --------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Mirror implementation | Assertion computes the expected value with the same logic as the tested code. | Assert against a value derived from the oracle (PRD / domain rule), not from the implementation. |
| Happy paths only      | Tests only pass valid inputs; edge cases absent.                              | Add at least one edge case per risk: `null`, empty, dependency error, invalid input.             |
| Redundant copies      | Six nearly identical tests checking the same absence of a sentinel.           | One parameterised test (`it.each`) per property; each test catches a different regression.       |

### Mutation testing (Stryker) — selective quality gate

Coverage says "this line was executed". Mutation score says "would a test fail if I broke this line?" Use Stryker as a **selective gate** after a risk phase, not as a CI gate on every commit.

Workflow:

1. Tests pass for the risk phase.
2. Run `npx stryker run --mutate "path/to/file.ts"` (narrow scope to the changed module).
3. Open the HTML report; find survived mutants.
4. For each survived mutant ask: "Would this change hurt a user or the business?"
   - Yes → add an assertion that kills the mutant.
   - No (equivalent mutant or cosmetic change) → ignore consciously.
5. Do not chase 100% mutation score. A test that pins implementation details to kill a cosmetic mutant is itself a vibe test.

The integration gate can stay **ad hoc** (not on every commit) when running local infra is expensive. Mark it accordingly in `test-plan.md §4`.

### Lesson boundaries

- Do not configure hooks, hook lifecycle, or debugging hooks. That is Lesson 3.
- Do not configure MCP servers, Playwright API, e2e code, or multimodal scenario code. That is Lesson 4.
- Do not run the bug-to-fix-to-regression-test workflow. That is Lesson 5.
- Do not author CI/CD pipelines from scratch. That is Module 1 Lesson 5 / Module 2 Lesson 5.
- Do not run `/10x-test-plan` to change the risk strategy. That is Lesson 1. Use `/10x-test-plan --status` to read current state.
- Do not write tests without a research step unless using the ad-hoc prompt with full awareness of its trade-offs.

### Paths used by this lesson

- `context/foundation/test-plan.md` — §3 rollout state; §6 cookbook (filled in as phases ship)
- `context/changes/<change-id>/research.md` — oracle source per rollout phase
- `context/changes/<change-id>/plan.md` — ordered phases with `## Progress` as execution state
- `.claude/prompts/m3l2-ad-hoc-testing.md` — ad-hoc file-level testing prompt

<!-- END @przeprogramowani/10x-cli -->
