# Review follow-ups: aggregate-bonus-report

Queued from `reviews/impl-review.md`. Not part of this change; each needs its own `/10x-new`.

## F5 — `Cache-Control: private, no-store` for authenticated responses

- **Where**: `src/middleware.ts` (one place for every page), not per page.
- **Why**: pay pages (`/reports/bonuses`, `/employees/[id]`, `/my-bonuses`) send no `Cache-Control`, so a shared machine's browser or back/forward cache can keep bonus figures after sign-out. The CSV export already sends `no-store`. Workers do not edge-cache SSR responses, so the exposure is client-side only.
- **Scope**: set the header on responses to signed-in requests (or to `PROTECTED_ROUTES`); keep public pages cacheable. Add a smoke cell that checks the header on a protected page.
