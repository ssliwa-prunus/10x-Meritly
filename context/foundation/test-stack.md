# Test stack

## E2E

<!-- Written by /10x-e2e-setup. Re-run it to change this section; other skills only read it. -->

- runner: Playwright Test, @playwright/test 1.64.0
- config: playwright.config.ts
- single-spec command: npx playwright test tests/e2e/<name>.spec.ts
- full-suite command: npx playwright test
- base URL: http://localhost:4321
- port: 4321 (detected from Astro's default preview port; no port in astro.config.mjs or the npm scripts; detected default 4321, override with E2E_PORT)
- web server command: npm run build && npm run preview -- --port $E2E_PORT (ASTRO_PREVIEW_BACKGROUND=1 keeps Astro 7 preview in the foreground); reuseExistingServer outside CI. Needs local Supabase running (`npx supabase start`); the Cloudflare preview reads .dev.vars, which points at it
- auth setup project: setup (tests/e2e/auth.setup.ts), credentials from E2E_USERNAME / E2E_PASSWORD in .dev.vars (seeded local account supervisor@meritly.local from supabase/seed.sql; never load .env, it points at the hosted project)
- storageState: playwright/.auth/user.json (gitignored)
- seed: tests/e2e/seed.spec.ts — protects #6 (slice auth-gate-roundtrip): a signed-out visit to a protected page goes to sign-in and returns to that page after sign-in
- browser CLI: playwright-cli (session `-s=10x-Meritly`), command skill at .claude/skills/playwright-cli/SKILL.md
- updated: 2026-10-11
