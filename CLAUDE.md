# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: Meritly

Web app where budget-holding supervisors split a milestone's bonus pool among employees with a weighted formula (time share × role weight × contribution rating × milestone KPI multiplier, rounded down). Requirements: @context/foundation/prd.md. Stack rationale: @context/foundation/tech-stack.md.

Roles: **Admin** (global config, sees everything), **Supervisor** (own projects, milestones, engagement, KPI scores), **Employee** (own Approved results and history only).

Invariants that must hold in code and in the database:

- A milestone's payouts never exceed its pool; a project's milestone pools are flagged against the project budget.
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

There is no unit-test framework, so no single-test command; `npm run smoke` is the only automated test.

Pre-commit hooks (installed by the `prepare` script on `npm install`): husky + lint-staged runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}`.

## Architecture

**Astro 7 SSR app** with React 19 islands, Tailwind 4, Supabase auth, and shadcn/ui components. Deployed to Cloudflare Workers.

### Rendering mode

Full server-side rendering (`output: "server"` in astro.config.mjs). All pages and API routes are server-rendered by default.

### Auth flow

- `src/lib/supabase.ts` — creates a Supabase SSR client using `@supabase/ssr` with cookie-based sessions. Uses `astro:env/server` for `SUPABASE_URL` and `SUPABASE_KEY` (server-only secrets declared in astro.config.mjs `env.schema`).
- `src/middleware.ts` — runs on every request, resolves the current user, attaches to `context.locals.user`. Redirects unauthenticated users away from routes listed in `PROTECTED_ROUTES`.
- API endpoints: `src/pages/api/auth/{signin,signup,signout}.ts`
- Auth pages: `src/pages/auth/{signin,signup,confirm-email}.astro`
- Protected page example: `src/pages/dashboard.astro`

### Environment

- Node.js 22.22.3+ (see `.nvmrc`); older 22.x releases trigger `EBADENGINE` warnings from `eslint-plugin-astro` and `astro-eslint-parser`
- Env vars: `SUPABASE_URL`, `SUPABASE_KEY` (copy `.env.example` to `.env` for Node, or `.dev.vars` for Cloudflare local dev)
- Local Supabase: `npx supabase start` (requires Docker). Use it for development: `.env.example` points at a real hosted Supabase project, so overwrite its values with the `supabase start` output and don't sign up test users there.
- Cloudflare local dev: secrets go in `.dev.vars` (gitignored)
- Deploy: `npx wrangler deploy` (requires Cloudflare account + `wrangler` auth)

## CI

GitHub Actions (@.github/workflows/ci.yml) runs on every push and PR to master: a `ci` job (lint, `astro check`, build; needs `SUPABASE_URL` and `SUPABASE_KEY` repository secrets) and a `smoke` job (local Supabase, production preview, `npm run smoke`; no secrets).
