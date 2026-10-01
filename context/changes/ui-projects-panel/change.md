---
change_id: ui-projects-panel
title: Ui projects panel
status: implementing
created: 2026-10-01
updated: 2026-10-01
archived_at: null
---

## Notes

UI change run through `/10x-ui`.

- **View (one):** `/projects/[id]` — `src/pages/projects/[id].astro` plus the components it composes in `src/components/projects/` (`ProjectForm`, `BudgetExposurePanel`, `MilestoneForm`) and their shared `src/components/form-classes.ts`.
- **Token source:** `src/styles/global.css` — shadcn `:root` / `.dark` values published through `@theme inline`. Components: `src/components/ui/` (shadcn, new-york).
- **Contract variant:** fresh starter with a dead token file — the view reads 0 token classes and imports nothing from `src/components/ui/`; `.dark` is never applied. Phase 1 makes the view read the existing tokens; new values come after.
- **Pre-audit baseline (hardcoded-value scan):** 66 hit lines — `[id].astro` 25, `ProjectForm` 14, `Topbar` 9, `MilestoneForm` 8, `BudgetExposurePanel` 7, `form-classes.ts` 3. Should fall phase by phase.
- **Draft charges** (to be confirmed in `research.md` → `## Charges`): accent/text roles as palette literals; status colours bypass `destructive`; duplicated card/button/badge primitives; focus-visible/disabled/pending states; page order mirrors feature order (edit form first, milestone edit forms nested in table rows).
- **Agent rules:** `CLAUDE.md` (`AGENTS.md` imports it) — no UI rule yet; the change ends by adding one.
