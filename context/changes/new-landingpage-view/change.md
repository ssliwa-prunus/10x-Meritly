---
change_id: new-landingpage-view
title: New landingpage view
status: impl_reviewed
created: 2026-10-18
updated: 2026-10-18
archived_at: null
---

## Notes

- 2026-10-18 impl-review F1: the landing fonts are self-hosted via `@fontsource/*` (imported in `src/pages/index.astro`) instead of the Google Fonts links the plan and brief describe, so no visitor request goes to a third-party font CDN. See `reviews/impl-review.md`.
