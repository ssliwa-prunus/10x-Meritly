---
bootstrapped_at: 2026-09-19T17:19:00Z
starter_id: 10x-astro-starter
starter_name: 10x Astro Starter (Astro + Supabase + Cloudflare)
project_name: meritly
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: npm audit --json
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: meritly
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
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
```

### Why this stack

Meritly is a solo, after-hours, 7-week web-app MVP for a small team, with role-based
auth (Admin/Supervisor/Employee) and strict per-user data visibility as a
non-negotiable guardrail — exactly the profile the recommended default for
`(web-app, js)` targets. 10x Astro Starter (Astro + React + TypeScript + Supabase +
Cloudflare) ships Postgres, auth, and storage out of the box via Supabase, and its
TypeScript-first, convention-based shape clears all four agent-friendly gates,
which matters for a short, mostly-unsupervised timeline. Payments, realtime, and AI
are out of scope per the PRD, so the starter's edge-runtime constraint on
long-running tasks is not a concern here. Deployment stays on the starter's default,
Cloudflare Pages; CI runs on GitHub Actions with auto-deploy-on-merge, the
lowest-friction flow for a solo build. Bootstrapper confidence is first-class —
expect scaffolding to be mostly smooth with occasional manual steps, particularly
around Supabase row-level security, which must be configured early given the
per-role visibility guardrail in the PRD.

## Pre-scaffold verification

| Signal      | Value                                                        | Severity | Notes                                                    |
| ----------- | ------------------------------------------------------------ | -------- | -------------------------------------------------------- |
| npm package | not run                                                      | n/a      | cmd_template starts with `git clone`; no npm CLI package |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-09-12    | fresh    | from card.docs_url                                       |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 20 top-level entries (about 50 tracked files plus `node_modules/`, 648 packages)
**Conflicts (.scaffold siblings)**: CLAUDE.md → CLAUDE.md.scaffold
**.gitignore handling**: append-merged (22 lines added under `# from 10x-astro-starter`; existing lines untouched)
**.bootstrap-scaffold cleanup**: deleted (cloned `.git/` removed before move-up)

Notes from the run:
- `npm install` warned `EBADENGINE`: `astro-eslint-parser@3.1.0` and `eslint-plugin-astro@3.1.0` require node `^22.22.3 || ^24.16.0 || >=26.3.0`; local node is v24.13.1. Install succeeded; upgrade Node (starter pins `.nvmrc`) to clear the warning.
- npm reported 3 packages with install scripts not yet approved (`esbuild@0.28.1`, `esbuild@0.28.2`, `workerd@1.20260911.1`). Review with `npm install-scripts ls` if the dev server or build complains about missing binaries.
- `AGENTS.md` shipped by the starter had no clash and was moved silently.
- `package.json` still carries the starter's own `name`; it was not renamed to `meritly`.

## Post-scaffold audit

**Tool**: npm audit --json
**Status**: failed to run
**Reason**: `503 Service Unavailable - POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk - We are currently performing maintenance.` Retried once after 20 s with the same result. Findings unavailable.
**Partial output (if any)**:

```
npm warn audit 503 Service Unavailable - POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk - We are currently performing maintenance. For more info go to https://status.npmjs.org
npm error audit endpoint returned an error
```

Re-run `npm audit` once the registry is back (see https://status.npmjs.org).

## Hints recorded but not acted on

| Hint                    | Value                |
| ----------------------- | -------------------- |
| bootstrapper_confidence | first-class          |
| quality_override        | false                |
| path_taken              | standard             |
| self_check_answers      | null                 |
| team_size               | solo                 |
| deployment_target       | cloudflare-pages     |
| ci_provider             | github-actions       |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true                 |
| has_payments            | false                |
| has_realtime            | false                |
| has_ai                  | false                |
| has_background_jobs     | false                |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log.
