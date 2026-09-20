# First production deploy of Meritly to Cloudflare Workers

## Context

`context/foundation/infrastructure.md` already picked Cloudflare Workers (not Pages) as the deploy target, and the repo is mostly aligned: `@astrojs/cloudflare` 14.x + `wrangler.jsonc` already use the Workers-style config, and `wrangler.jsonc`'s `name` has already been changed from the starter's `10x-astro-starter` to `meritly` in the working tree. What's still missing before a real first deploy: `context/foundation/tech-stack.md`'s hint still says `cloudflare-pages` (a stale contradiction flagged in the infra research's own risk register), `.env.example` was deleted from the working tree which breaks the documented local-dev bootstrap in README.md/CLAUDE.md, there is no production Supabase project yet, and Cloudflare hasn't been authenticated in this environment.

Per the project owner's decisions: the production Supabase project needs to be created, Cloudflare auth (`wrangler login` or a scoped API token) hasn't happened yet, and — importantly — ongoing auto-deploy-on-push-to-`master` will be handled by **Cloudflare's own Workers Builds** (GitHub-connected in the Cloudflare dashboard), not a GitHub Actions job. So this pass gets the app live via one manual `wrangler deploy`, and only wires the GitHub connection in Cloudflare's dashboard for future pushes — the existing `.github/workflows/ci.yml` (lint/`astro check`/build + smoke) stays untouched, no new CI job is added.

The deployed surface today is just the auth skeleton (`/auth/signin`, `/auth/signup`, `/auth/confirm-email`, protected `/dashboard`) — FR-015 (aggregate report) and FR-016 (approval email) aren't implemented yet, so the Workers CPU-cap and 50-subrequest risks the infra research flagged for those features are not live concerns for this deploy; they stay in the risk register for when that work starts.

## Prerequisites

These are the two manual setup gates, spelled out in full so there's no ambiguity when doing them. Everything else in "Execution sequence" below assumes both are done.

### A. Configure the Cloudflare CLI (wrangler)

`wrangler` is already a project devDependency (`^4.131.1`), so no install is needed — only authentication.

1. Pick one:
   - **Interactive login (simplest for solo/manual use):** run `npx wrangler login`. This opens a browser to authorize the CLI against the Cloudflare account and stores an OAuth token locally (outside the repo). Confirm with `npx wrangler whoami` — it should print the account email and account ID.
   - **Scoped API token (needed anyway for step 11's dashboard GitHub-connect, and safer to keep separate from a personal login):** in the Cloudflare dashboard go to **My Profile → API Tokens → Create Token**, start from the "Edit Cloudflare Workers" template, and restrict it to this one account with **no DNS, no billing, no zone access** (per the infra doc's production-access boundary — a scoped token, not a master key). Export it in the shell as `CLOUDFLARE_API_TOKEN` (not committed anywhere) and verify with `npx wrangler whoami`.
2. Find the account's `workers.dev` subdomain — this is account-level, set once, independent of any specific Worker: Cloudflare dashboard → **Workers & Pages** → the account home page shows (or offers to set, if first time) the subdomain, e.g. `yourname.workers.dev`. Note it down; the deployed app's URL will be `meritly.<that-subdomain>.workers.dev`. This is needed before configuring Supabase's redirect URLs in step B.4.

### B. Configure the production Supabase project

1. At [supabase.com/dashboard](https://supabase.com/dashboard), click **New Project**. Choose the organization, name it (e.g. `meritly-prod`), generate a strong database password (store it in a password manager — the app itself never uses it, only the `anon` key, since it only touches Supabase Auth's built-in `auth.users` table today), and pick an **EU region** close to users (matches the infra research's region guidance and keeps latency down against the 2-second NFR). Wait ~2 minutes for provisioning.
2. **Settings → API**: copy the **Project URL** and the **`anon` `public`** key. This anon key is what becomes `SUPABASE_KEY` — never copy the `service_role` key for this (CLAUDE.md: service-role bypasses RLS and must never reach a user-facing route).
3. **Authentication → Providers → Email**: confirm Email is enabled (it is by default). Unlike the local-dev instructions in README.md, leave **Confirm email ON** for production — real users should verify their address.
4. **Authentication → URL Configuration**: set **Site URL** to `https://meritly.meritly.workers.dev` (the live deployed URL, confirmed 2026-09-20), and add that same URL to the **Redirect URLs** allow-list. This is what the infra research flagged as a real risk — without it, confirm-email and any future OAuth links would point at `localhost`.
5. No migrations to run — per README, this project only needs Supabase Auth's built-in `auth.users` table; nothing in `supabase/migrations/` is required for today's auth-only surface.

## Execution sequence

Steps marked **[HUMAN]** are things only the project owner can do (interactive login, dashboard clicks, pasting real secret values — see Prerequisites A/B above for the detail). Steps marked **[AGENT]** are things the agent runs directly.

- [x] 1. **[AGENT]** Write this plan to `context/changes/deployment/deployment-plan.md` — done first, before any other change, so it exists in the repo as the plan of record; step 12 below updates this same file in place with the actual outcome once the deploy is done.
- [x] 2. **[AGENT]** Fix the stale hint in `context/foundation/tech-stack.md`: change frontmatter `deployment_target: cloudflare-pages` → `cloudflare-workers`, and correct the prose sentence "Deployment stays on the starter's default, Cloudflare Pages" to say Workers. _(Done 2026-09-20.)_
- [x] 3. **[AGENT]** Restore `.env.example` (`git checkout -- .env.example`). It was deleted in the working tree, which breaks the two documented onboarding copies in README.md (`cp .env.example .env`, `cp .env.example .dev.vars`) and the instructions in CLAUDE.md. Its restored contents point at the starter's own shared demo Supabase project, which CLAUDE.md already warns not to sign real users up against — expected template behavior, not something introduced here. _(Done 2026-09-20.)_
- [x] 4. **[AGENT]** `npm run build` — confirm the production build succeeds as-is before touching Cloudflare. _(Done 2026-09-20 — build succeeded. Notable output: the adapter auto-enables an `IMAGES` Cloudflare Images binding and a `SESSION` KV binding, neither of which is declared in `wrangler.jsonc` yet — this is exactly the "adapter-generated deploy config surprises" risk `infrastructure.md`'s register called out. Needs a look at `wrangler deploy --dry-run` output in step 8 before the real deploy.)_
- [x] 5. **[HUMAN]** Complete Prerequisite A (Cloudflare CLI auth + find `workers.dev` subdomain). _(Done 2026-09-20 — `wrangler whoami` confirms OAuth login as sebastian.sliwa@prunus.pl's Account, account ID `e7faab2995948cb51e02255ed4fe999c`. Note: this is a broad personal OAuth login, not the narrower scoped API token the plan's Prerequisite A also offered — acceptable for a solo project, flagged here for awareness rather than as a blocker.)_
- [x] 6. **[HUMAN]** Complete Prerequisite B (create production Supabase project, configure URLs). _(Done 2026-09-20. Project created, secrets copied, and B.4 URL Configuration corrected after an initial gap: a manual browser sign-up first surfaced that Site URL was still Supabase's default `http://localhost:3000` — `infrastructure.md`'s flagged "redirect URLs point at localhost" risk, confirmed real. Fixed via Supabase dashboard → Authentication → URL Configuration → Site URL set to `https://meritly.meritly.workers.dev`, added to Redirect URLs. **Confirmed working**: sign-in now succeeds end-to-end in the browser.)_
- [x] 7. **[HUMAN]** Set production secrets: `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_KEY`, pasting the real production project's URL and **anon key only** (from B.2) when prompted. _(Done 2026-09-20 — `wrangler secret list` now shows both `SUPABASE_KEY` and `SUPABASE_URL` present, values not shown.)_
- [x] 8. **[AGENT]** `npx wrangler deploy --dry-run` — inspect the generated config and any auto-provisioned bindings (Astro sessions can auto-add a `SESSION` KV binding, the image service an `IMAGES` binding) before the real deploy, per the infra doc's risk register. _(Done 2026-09-20 — clean: only `env.SESSION` (KV), `env.IMAGES`, `env.ASSETS`, no surprise bindings.)_
- [x] 9. **[AGENT]** `npx wrangler deploy` — the actual first production deploy. _(Done 2026-09-20 — succeeded. Cloudflare auto-provisioned the `SESSION` KV namespace (`meritly-session`, id `22da3386c5fd4b5bab08aa33b8563393`) on first deploy. Live at **https://meritly.meritly.workers.dev**, confirmed HTTP 200. Version ID `6f68e751-3799-492f-acbe-9434a6c57096`. **Caveat: no `SUPABASE_URL`/`SUPABASE_KEY` secrets are set yet** — the app is live but auth is currently a no-op per `src/lib/supabase.ts`'s graceful-null fallback; sign-up/sign-in won't work until step 6/7 complete.)_
- [x] 10. **[AGENT]** Verify: `BASE_URL=https://meritly.meritly.workers.dev npm run smoke` (walks sign-up/sign-in/protected-page/sign-out against the live Worker and the real production Supabase project — first time this runs against real infra instead of local Supabase), watching `npx wrangler tail --format json --status error` during the run. _(Done 2026-09-20 — 6/8 steps passed: home renders, anonymous redirect, wrong-password rejection, signout, post-signout redirect all correct. **2 failures, one root cause, not an infra bug:** `scripts/smoke.mjs` generates `@example.com` test emails, and Supabase Auth rejects `example.com`/`.org`/`.net` as invalid (RFC 2606 reserved-domain denylist) — this is a real, well-formed rejection from Supabase, not a server error. `wrangler tail --status error` captured zero output during the run, confirming no Worker-side errors — the Cloudflare↔Supabase wiring itself is working; only the smoke script's hardcoded test domain is incompatible with hosted Supabase's validation. The dependent "dashboard renders for signed-in user" step then also fails since no account was created. Not fixed here — out of scope for "run smoke", flagged for a follow-up decision: either point the script at an accepted test domain, or treat this as an expected local-Supabase-only check per CLAUDE.md ("CI runs it against the production preview with a local Supabase") and rely on manual browser verification against hosted Supabase instead.)_
- [ ] 11. **[HUMAN]** Once verification passes: in the Cloudflare dashboard, connect the Worker to this GitHub repo (Workers & Pages → the `meritly` Worker → Settings → Builds), set the production branch to `master` so Workers Builds deploys automatically on future pushes. Since preview builds are public by default, consider disabling them or gating with Cloudflare Access once the app carries real employee/compensation data — not urgent today since only the auth skeleton is live.
- [ ] 12. **[AGENT]** Update `context/changes/deployment/deployment-plan.md` with the actual outcome: exact commands run, production Supabase project reference (URL only, never keys), secret names set (not values), deployed URL, smoke-test result, and the Workers Builds GitHub-connection state.

## Files touched

- `context/foundation/tech-stack.md` — edit (stale hint fix)
- `.env.example` — restored (git checkout of an already-committed file)
- `context/changes/deployment/deployment-plan.md` — this file
- No `src/` changes — nothing about the app code changes for this deploy.

## Explicitly out of scope

- No GitHub Actions deploy job — auto-deploy-on-push is Cloudflare Workers Builds, not CI-driven.
- No work on FR-015/FR-016 — unimplemented; their Workers CPU-cap/subrequest risks stay in `infrastructure.md`'s risk register for when that work starts.
- No Cloudflare Access / preview-URL lockdown yet — flagged for later once real employee data is live, not needed for today's auth-only surface.

## Verification

- `npm run build` succeeds.
- `npx wrangler deploy --dry-run` shows only expected bindings (`ASSETS`; no surprise `SESSION`/`IMAGES` unless intended).
- `npx wrangler deploy` completes and prints the live `*.workers.dev` URL.
- `npm run smoke` passes against that URL with the real production Supabase project.
- Manual spot-check in a browser: `/auth/signup` → `/auth/confirm-email` → `/auth/signin` → `/dashboard` redirect behavior on the live URL.
- This file accurately reflects what was actually done (updated post-deploy).

## Status

**Deployed, wired to production Supabase, and end-to-end auth confirmed working.** Steps 1–10 done; the localhost-redirect gap found during manual testing (see step 6) has been fixed and re-verified — sign-in now succeeds end-to-end in a real browser at **https://meritly.meritly.workers.dev**.

**Remaining:**

1. **[HUMAN]** Step 11: connect the Worker to GitHub in the Cloudflare dashboard for auto-deploy-on-push via Workers Builds.
2. Separately, decide on the smoke-script `@example.com` issue noted in step 10 (fix the script's test domain, or accept it as a local-Supabase-only check).
