---
project: meritly
researched_at: 2026-09-20
recommended_platform: Cloudflare Workers (with static assets)
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 7 (SSR) + React 19 islands, @astrojs/cloudflare 14
  runtime: Cloudflare workerd (Workers), Supabase (external Postgres + auth)
---

## Recommendation

**Deploy on Cloudflare Workers (with static assets), not Cloudflare Pages.**

Cloudflare scored 5/5 on the agent-friendly criteria, costs $0 at Meritly's traffic (a few thousand requests a day against a 100k/day free allowance), and is the only candidate that needs no adapter change: `@astrojs/cloudflare` 14.x and the existing `wrangler.jsonc` already target it. The interview answers (minimize cost, single region, external providers fine, no platform familiarity) neutralised the edge and co-location advantages, but cost and zero-migration effort kept Cloudflare on top. Decision: proceed with the leader after the anti-bias cross-check, risks absorbed into the register below.

**Correction to `tech-stack.md`:** its `deployment_target: cloudflare-pages` hint is stale. `@astrojs/cloudflare` 14 "no longer supports deployment on Cloudflare Pages"; the deploy command is `astro build && wrangler deploy`, never `wrangler pages deploy`.

## Platform Comparison

Interview answers: persistent connections = Don't know (treated as No per PRD: no realtime, no background jobs), cost = minimize, familiarity = none, geography = single region, co-location = external providers fine. Scoring: Pass = 1, Partial = 0.5, Fail = 0. Status checked 2026-09-20.

| Platform           | CLI-first                 | Managed/Serverless   | Agent-readable docs | Stable deploy API | MCP / Integration          | Total |
| ------------------ | ------------------------- | -------------------- | ------------------- | ----------------- | -------------------------- | ----- |
| Cloudflare Workers | Pass                      | Pass                 | Pass                | Pass              | Pass                       | 5.0   |
| Vercel             | Pass                      | Pass                 | Pass                | Pass              | Partial (MCP beta)         | 4.5   |
| Netlify            | Partial (no CLI rollback) | Pass                 | Pass                | Partial           | Pass (MCP GA)              | 4.0   |
| Fly.io             | Pass                      | Partial (containers) | Pass                | Partial           | Partial (MCP experimental) | 3.5   |
| Railway            | Partial (no CLI rollback) | Pass                 | Pass                | Partial           | Partial (MCP beta)         | 3.5   |
| Render             | Partial (no CLI rollback) | Pass                 | Pass                | Partial           | Partial (MCP beta)         | 3.5   |

- **Cloudflare**: `wrangler deploy`, `rollback`, `versions`, `tail` all GA; `llms.txt` per product and docs on GitHub; remote MCP servers (docs, bindings, builds, observability) with no beta labels on the fetched page. Free tier covers the load. Adapter 14 targets Workers only.
- **Vercel**: adapter `@astrojs/vercel` 11.0.10 GA for Astro 7, `vercel rollback`/`logs`/`env` GA, docs as markdown + `llms.txt`. MCP is beta (OAuth). Hobby is non-commercial only, so an internal company tool needs Pro at $20/developer seat/month. Default function region is `iad1`; must set `fra1`.
- **Netlify**: adapter 8.2.6 GA for Astro 7, MCP GA, draft-by-default `netlify deploy`. No CLI rollback (UI/API). Function region selection is Pro/Enterprise only, so Free/Personal SSR likely runs in Ohio. Free tier is a hard credit cap that pauses all sites.
- **Fly.io**: `@astrojs/node` in a container; `fly launch` generates the Dockerfile. About $2-4/month in `fra` (Warsaw is not offered). No `fly rollback`; redeploy a previous image. `fly mcp server` experimental. No ongoing free allowance.
- **Railway**: Railpack builder GA, Hobby $5/month plus usage (about $5-8 for an always-on service). Rollback to older deployments is dashboard-only. MCP beta.
- **Render**: Free tier spins down after 15 minutes with about a 1-minute wake, which breaks the 2-second view-load NFR, so Starter at $7/month is required. Rollback via dashboard/API only. MCP beta.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Full marks on all five criteria, $0 at MVP scale, and zero migration: adapter, `wrangler` 4.131 and `wrangler.jsonc` are already in the repo. `astro dev`/`astro preview` run on real workerd, so local behaviour matches production. Global edge is unneeded (single region) but harmless.

#### 2. Vercel

Best raw DX and a clean `vercel rollback`. Loses on cost (mandatory Pro, $20/seat/month vs. $0) and on migration effort (adapter swap, region pinning to `fra1`), and MCP is only beta. This is the runner-up if Cloudflare's CPU/subrequest limits prove unworkable.

#### 3. Fly.io

Cheapest non-edge option (about $2-4/month), persistent Node process with no per-request CPU cap, Frankfurt region. Loses on managed level (Dockerfile/fly.toml to own), image-based rollback, experimental MCP, and an adapter swap to `@astrojs/node`. Fallback if the app ever needs long-running work.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **Stale tech-stack hint.** `tech-stack.md` says `cloudflare-pages`, but adapter 14 supports Workers only, so `wrangler pages deploy` is the wrong command. The Worker name in `wrangler.jsonc` is still `10x-astro-starter` and becomes the public URL subdomain.
2. **Free plan's 10 ms CPU cap per request.** Waiting on Supabase does not count, but SSR of React trees, JWT/cookie handling and the FR-015 aggregate report over many rows do. Exceeding it fails the request. Escape hatch: Workers Paid, $5/month.
3. **50 subrequests per request on Free.** FR-016 emails every employee on approval; each Supabase query and each email API call is a subrequest. Approving a milestone with 50+ employees in one request would fail partway.
4. **Edge-to-database latency.** Workers run near the user while Supabase sits in one region. Auth check plus several sequential queries multiplies the round trip against the 2-second NFR. Region placement hints are GA; Smart Placement is beta.
5. **Weak runtime logging.** `wrangler tail` is not persisted, allows at most 10 viewers and may sample under load. Retention of Workers Logs (enabled via `observability` in `wrangler.jsonc`) was not verified.

### Pre-Mortem — How This Could Fail

Meritly went live on the free Workers plan and worked in demos. In week three a Department Head approved a large milestone. The approval handler updated the results and looped over 60 employees, making one email API call each. Around the 50th subrequest the Worker failed. Half the employees had emails and the milestone state was ambiguous. Payroll saw an inconsistency between what employees were told and what the Supervisor saw. Nobody could reconstruct what happened, because `wrangler tail` wasn't running and the sampled logs were gone. Meanwhile pages had crept past two seconds because Supabase lived in a different region from the edge location serving users. A CPU-limit error on the aggregate report went unnoticed. A preview deploy URL, publicly reachable by default, was shared in chat and exposed a version with real compensation data. The team lost trust, and every fix (paid plan, batch email, region pinning, access protection, persistent logs) was something a pre-launch check would have caught.

### Unknown Unknowns

- **Version-driven behaviour (adapter 14 / Astro 7).** `astro dev` and `astro preview` already run on real workerd via the Cloudflare Vite plugin, so `wrangler dev` is redundant. `Astro.locals.runtime` is removed; use `import { env } from "cloudflare:workers"` (or `astro:env`). CLAUDE.md's "Deploy: `npx wrangler deploy`" needs `astro build` first. The exact deploy-config file the adapter generates could not be confirmed from docs; verify locally before the deploy plan.
- **Preview and production URLs are public by default.** Versioned preview URLs and `workers.dev` are on when `workers_dev` is enabled. The app shows compensation data, so protect with Cloudflare Access or disable them.
- **Supabase Auth must know the production origin.** Site URL and redirect allow-list must be set, or confirm-email and OAuth links point at localhost.
- **Implicit resources.** Astro sessions auto-provision a `SESSION` KV binding and the image service an `IMAGES` binding at deploy time. The project uses Supabase cookies; check whether either is needed before the first deploy.
- **Wrangler is being rebuilt.** Cloudflare has announced a rewrite for agents (reported April 2026). Pin the wrangler version and expect CLI surface changes.

## Operational Story

- **Preview deploys**: Workers preview URLs (`<version>-<worker>.<subdomain>.workers.dev`; versioned URLs need Wrangler 3.74+, aliased 4.21+). Generated by `npx wrangler versions upload` from CI or by Workers Builds (GitHub-connected; free plan 3,000 build minutes/month, 1 concurrent build; preview builds run `versions upload`). Previews are public by default; put Cloudflare Access in front or disable them, because the app serves compensation data. Not available for Durable Object/Container Workers (not used here).
- **Secrets**: production secrets in the Worker via `npx wrangler secret put SUPABASE_URL` / `SUPABASE_KEY` (or `wrangler secret bulk`); local dev in `.dev.vars` (gitignored). CI token as GitHub Secret `CLOUDFLARE_API_TOKEN`, scoped to this one Worker (no DNS, no billing, no other accounts). The Supabase service-role key must never be set on the Worker (see CLAUDE.md RLS rules). Rotation: `wrangler secret put` again, then redeploy.
- **Rollback**: `npx wrangler rollback [version-id]` (list with `npx wrangler deployments list --json` / `npx wrangler versions list`); typically seconds. Caveat: only code rolls back, not Supabase migrations; a migration that isn't backward compatible needs a forward fix. Gradual rollout is available via `wrangler versions deploy <id>@10%`.
- **Approval**: human-only: first production deploy, rotating `SUPABASE_KEY` or the API token, deleting the Worker, any Supabase destructive migration. Agent may unattended: preview `versions upload`, `deployments list`, `versions list`, `tail`, and `wrangler rollback` only on explicit human instruction.
- **Logs**: live: `npx wrangler tail --format json --status error` (non-persisted, at most 10 viewers, may sample). Persistent: Workers Logs is enabled via `observability.enabled` in `wrangler.jsonc`; verify retention on the plan in use. Optional: Cloudflare Observability MCP server (OAuth) for structured queries.

## Risk Register

| Risk                                                                            | Source           | Likelihood | Impact | Mitigation                                                                                                                                                                                        |
| ------------------------------------------------------------------------------- | ---------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy plan uses Pages commands per stale `tech-stack.md` hint                  | Devil's advocate | H          | M      | Use `astro build && wrangler deploy` only; update `tech-stack.md` `deployment_target` to Workers; rename Worker from `10x-astro-starter` to `meritly`                                             |
| Free-plan 10 ms CPU cap hit by SSR, JWT handling or the FR-015 report           | Devil's advocate | M          | M      | Keep heavy aggregation in Postgres (SQL/RLS-safe view), not in the Worker; measure CPU on a seeded dataset; upgrade to Workers Paid ($5/month) if errors appear                                   |
| Approval email fan-out exceeds 50 subrequests (Free)                            | Pre-mortem       | M          | H      | Use a batch email API endpoint, or send from a Supabase-side queue/function; make approval state transition idempotent and separate from sending; consider Workers Paid (higher subrequest limit) |
| Edge-to-Supabase latency breaks the 2-second NFR                                | Devil's advocate | M          | M      | Pin Worker placement near the Supabase region (`placement.region`, GA); minimise sequential queries per page; measure with a seeded milestone                                                     |
| Compensation data exposed via public preview or `workers.dev` URLs              | Pre-mortem       | M          | H      | Cloudflare Access on previews, or disable preview URLs; use a custom domain for production; never seed previews with real data                                                                    |
| Insufficient log retention/sampling hides a bonus-calculation incident          | Pre-mortem       | M          | M      | Verify Workers Logs retention; log approval events with milestone id and result counts (no figures); consider paid logging if retention is too short                                              |
| Supabase Auth redirect URLs point at localhost after deploy                     | Unknown unknowns | H          | M      | Set Site URL and redirect allow-list in Supabase to the production origin before first sign-up; run `npm run smoke` equivalent against the deployed URL                                           |
| Adapter-generated deploy config or KV/IMAGES bindings surprise the first deploy | Unknown unknowns | M          | L      | Run `npm run build` and inspect generated output; run `npx wrangler deploy --dry-run` first; review any auto-provisioned bindings in the deploy plan                                              |
| Wrangler CLI surface changes in the announced rewrite                           | Unknown unknowns | L          | M      | Pin wrangler in `package.json` (currently ^4.131.1; use exact version for CI); read release notes before upgrading                                                                                |
| Node-only npm packages fail on workerd                                          | Research finding | L          | M      | Keep `nodejs_compat` flag; send email through an HTTP API, not SMTP; run `astro check` and `npm run smoke` against `astro preview` (workerd) before deploy                                        |
| Smart Placement / host-based placement are not GA                               | Research finding | L          | L      | Use the GA `placement.region` hint only; do not rely on Smart Placement (beta) or host-based placement (experimental), status checked 2026-09-20                                                  |
| Cloudflare MCP servers and Workers Builds are not independently tested          | Research finding | L          | L      | Start with the CLI (auditable, no schema cost); add MCP only if repeated `--help` traversal appears                                                                                               |

## Getting Started

Validated against `astro` ^7.3.2, `@astrojs/cloudflare` ^14.3.1, `wrangler` ^4.131.1 as pinned in `package.json`.

1. **Fix the Worker identity.** In `wrangler.jsonc` change `"name": "10x-astro-starter"` to `"meritly"`. Keep `main: "@astrojs/cloudflare/entrypoints/server"`, the `assets` block and `nodejs_compat`. Update `tech-stack.md` to `deployment_target: cloudflare-workers`.
2. **Develop locally without wrangler dev.** Use `npm run dev` / `npm run preview` (both run on workerd via the adapter's Vite plugin). Secrets go in `.dev.vars` (see CLAUDE.md), pointing at local Supabase.
3. **Authenticate (human step).** `npx wrangler login` interactively, or create a Worker-scoped `CLOUDFLARE_API_TOKEN` (no DNS, no billing) and export it.
4. **Set production secrets.** `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_KEY` (the public anon key only). Create a hosted Supabase project in an EU region and add the deployed origin to its Auth Site URL and redirect allow-list.
5. **Build and dry-run, then deploy.** `npm run build`, then `npx wrangler deploy --dry-run` (inspect the generated config and any auto-provisioned bindings), then `npx wrangler deploy`. Verify with `BASE_URL=https://<worker>.<subdomain>.workers.dev npm run smoke` and `npx wrangler tail --format json --status error`.

Next step: use Plan Mode with `@infrastructure.md` and `@tech-stack.md` to produce `context/deployment/deploy-plan.md`.

## Out of Scope

The following were not evaluated in this research:

- Docker image configuration
- CI/CD pipeline setup
- Production-scale architecture (multi-region, HA, DR)
