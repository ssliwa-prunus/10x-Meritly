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

- `npm run smoke` — dependency-free auth-flow smoke test (`scripts/smoke.mjs`) against a running server, `BASE_URL` env (default `http://localhost:4321`). Run after dependency upgrades; CI runs it against the production preview with a local Supabase. Needs Supabase reachable with email confirmation disabled.
- `npx astro sync` / `npx astro check` — regenerate Astro types / type-check. CI runs both (sync before lint) but there is no npm script for them.
- `npx supabase functions serve` — serves the Edge Functions locally; needed for employee invites (mail lands in the test inbox at `http://127.0.0.1:54324`). The Deno code in `supabase/functions/` is excluded from `tsconfig.json` and ESLint.
- `npm run lint:ui` — fails on literal colours, palette classes or arbitrary px/rem values in the views listed in `CLEAN_PATHS` (`scripts/check-ui-literals.mjs`). CI runs it after lint.

There is no unit-test framework, so no single-test command; `npm run smoke` is the only automated test.

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
- `src/middleware.ts` — runs on every request, resolves the current user, attaches to `context.locals.user`. Redirects unauthenticated users away from routes listed in `PROTECTED_ROUTES`. `ADMIN_ROUTES` (`/admin`, `/api/admin`) require the `admin` role and `PROJECT_ROUTES` (`/projects`, `/api/projects`, `/employees`, `/api/employees`) require `supervisor` or `admin` (403 otherwise, 503 when the profile lookup failed); RLS still decides which projects and employees each role sees.
- API endpoints: `src/pages/api/auth/{signin,signup,signout,set-password}.ts`
- Auth pages: `src/pages/auth/{signin,signup,confirm-email,set-password}.astro`
- `/auth/confirm` (`src/pages/auth/confirm.ts`) — public invite-link target: `verifyOtp` with the `token_hash` (type `invite`) signs the user in, then redirects to `/auth/set-password`, a protected page where the invited employee sets a password.
- `invite-employee` Supabase Edge Function (`supabase/functions/invite-employee/`) sends invites. It is the only code that uses the secret key, and it runs in Supabase, not the Worker; the app calls it with the user's JWT via `supabase.functions.invoke`. The Worker still has only `SUPABASE_URL`/`SUPABASE_KEY`.
- Protected page example: `src/pages/dashboard.astro`

### Environment

- Node.js 22.22.3+ (see `.nvmrc`); older 22.x releases trigger `EBADENGINE` warnings from `eslint-plugin-astro` and `astro-eslint-parser`
- Env vars: `SUPABASE_URL`, `SUPABASE_KEY` (copy `.env.example` to `.env` for Node, or `.dev.vars` for Cloudflare local dev)
- Local Supabase: `npx supabase start` (requires Docker). Use it for development: `.env.example` points at a real hosted Supabase project, so overwrite its values with the `supabase start` output and don't sign up test users there.
- Cloudflare local dev: secrets go in `.dev.vars` (gitignored)
- Deploy: `npx wrangler deploy` (requires Cloudflare account + `wrangler` auth)

## CI

GitHub Actions (@.github/workflows/ci.yml) runs on every push and PR to master: a `ci` job (lint, `astro check`, build; needs `SUPABASE_URL` and `SUPABASE_KEY` repository secrets) and a `smoke` job (local Supabase, production preview, `npm run smoke`; no secrets).
<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 5 (10xDevs 4.0 UI)

**For UI work on a view that already renders, use `/10x-ui`.** It runs the visual
change through the same chain as any other change (`/10x-new` → `/10x-research` →
`/10x-plan` → `/10x-implement` → `/10x-impl-review`) and carries the rules:
when to start and which view, the audit into charges, the design-system contract as
this repo realises it, the component states, the screenshot gate, and the rule that
keeps the next agent on the contract. Its `references/` hold the quality checklist.

Building a view for the first time is not a `/10x-ui` job — build it through the
ordinary chain, then come back to it with `/10x-ui`.

<!-- END @przeprogramowani/10x-cli -->
