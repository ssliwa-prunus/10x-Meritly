---
starter_id: 10x-astro-starter
package_manager: npm
project_name: meritly
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-workers
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
---

## Why this stack

Meritly is a solo, after-hours, 7-week web-app MVP for a small team, with role-based
auth (Admin/Supervisor/Employee) and strict per-user data visibility as a
non-negotiable guardrail — exactly the profile the recommended default for
`(web-app, js)` targets. 10x Astro Starter (Astro + React + TypeScript + Supabase +
Cloudflare) ships Postgres, auth, and storage out of the box via Supabase, and its
TypeScript-first, convention-based shape clears all four agent-friendly gates,
which matters for a short, mostly-unsupervised timeline. Payments, realtime, and AI
are out of scope per the PRD, so the starter's edge-runtime constraint on
long-running tasks is not a concern here. Deployment targets Cloudflare Workers
(not Pages — `@astrojs/cloudflare` 14.x supports Workers only); CI runs on GitHub
Actions for lint/check/build/smoke, with auto-deploy-on-merge handled by Cloudflare
Workers Builds (GitHub-connected), the lowest-friction flow for a solo build.
Bootstrapper confidence is first-class —
expect scaffolding to be mostly smooth with occasional manual steps, particularly
around Supabase row-level security, which must be configured early given the
per-role visibility guardrail in the PRD.
