---
date: 2026-10-01T20:40:56+02:00
researcher: Claude (claude-opus-5-5) for ssliwa
git_commit: 1ac6060a32a528c0738170c89fee65c431fb82f2
branch: develop
repository: 10x-Meritly
topic: "UI audit of /projects/[id] (project detail) against the repo's design-system contract"
tags: [research, ui, design-tokens, shadcn, projects, budget-exposure, milestones]
status: complete
last_updated: 2026-10-01
last_updated_by: Claude (claude-opus-5-5)
---

# Research: UI audit of `/projects/[id]` against the design-system contract

**Date**: 2026-10-01T20:40:56+02:00
**Researcher**: Claude (claude-opus-5-5) for ssliwa
**Git Commit**: 1ac6060a32a528c0738170c89fee65c431fb82f2 (working tree has uncommitted skill/CLAUDE.md edits; none touch the audited files)
**Branch**: develop
**Repository**: 10x-Meritly

## Research Question

Two-way audit (`/10x-ui`) of the project detail view — `src/pages/projects/[id].astro` and the components it composes from `src/components/projects/` — producing 3–5 charges (file, line, user impact) in the three categories: missing tokens, missing shared component, accidental architecture. Also: blast radius of the shared pieces, and which states of the 7-state matrix the view can render.

Coverage: investigated locally (single view, ~490 lines plus shared files); no sub-agents dispatched. Inspected: the four view files, `src/components/form-classes.ts`, `src/components/Topbar.astro`, `src/layouts/Layout.astro`, `src/styles/global.css`, `src/components/ui/button.tsx`, `src/components/auth/SubmitButton.tsx`, `src/middleware.ts`, `package.json`, `components.json`, `CLAUDE.md`, `AGENTS.md`, archived plans/research, `context/foundation/prd.md`. No `context/foundation/lessons.md` exists.

## Summary

The view uses the "fresh starter with a dead token file" variant. `src/styles/global.css:6-109` ships the full shadcn token set (`:root`, `.dark`, `@theme inline`), but a grep for token utility classes (`bg|text|border|ring|outline-{primary,secondary,muted,accent,destructive,card,background,foreground,border,input,ring,popover}`) over `src/**/*.{astro,tsx,ts}` outside `src/components/ui/` returns **0 hits** — no view in the app reads a token. `.dark` is defined (`global.css:41`) but no file under `src/` applies a `dark` class, so the dark values are unreachable. The view instead hand-writes a dark "cosmic" theme from palette literals: the hardcoded-value scan finds **66 hit lines** across the six files the page renders (baseline below).

On the component side, `src/components/ui/` holds `button.tsx` and `LibBadge.astro`; the view imports neither. It uses `buttonClass`/`inputClass` string constants from `src/components/form-classes.ts` (shared by 10 files) and a copied panel class string (present in 15 files).

Five charges are confirmed below. Two cross-cutting facts shape the plan: (1) `form-classes.ts`, `Topbar.astro` and the panel pattern are shared beyond this view, so changing them changes other views; (2) the view is server-rendered HTML forms with no client JS, so "loading" means a full page navigation and a pending-submit state needs either a React island (the `SubmitButton` pattern) or is N/A.

## Charges

Scan baseline (pattern from the `/10x-ui` skill, `grep -cE` lines with ≥1 hit):

| File                                                | Hit lines | Token classes | `components/ui` imports |
| --------------------------------------------------- | --------- | ------------- | ----------------------- |
| `src/pages/projects/[id].astro`                     | 25        | 0             | 0                       |
| `src/components/projects/ProjectForm.astro`         | 14        | 0             | 0                       |
| `src/components/Topbar.astro`                       | 9         | 0             | 0                       |
| `src/components/projects/MilestoneForm.astro`       | 8         | 0             | 0                       |
| `src/components/projects/BudgetExposurePanel.astro` | 7         | 0             | 0                       |
| `src/components/form-classes.ts`                    | 3         | 0             | 0                       |
| **Total**                                           | **66**    | **0**         | **0**                   |

### C1 — Missing tokens: surface, text and accent roles are palette literals

- Evidence:
  - `src/pages/projects/[id].astro:86` — `bg-cosmic … text-white`; `bg-cosmic` is a `@utility` with three hex stops at `src/styles/global.css:113-115`, outside `:root`/`.dark`, so it is not a token. Should be `bg-background text-foreground`.
  - `src/pages/projects/[id].astro:90` — title gradient `from-blue-200 to-purple-200` with `text-transparent`. Should be `text-foreground` (the skill's "purple/blue gradient" smell).
  - Links: `[id].astro:93`, `:183`, `:213` and `Topbar.astro` (all nav links) — `text-purple-300 hover:text-purple-100`. Should be a `primary` role.
  - Secondary text: `text-blue-100/60` (`[id].astro:112`, `:128`, `:157`, `:201`; `BudgetExposurePanel.astro:38`; `ProjectForm.astro` hint), `text-blue-100/70` (`[id].astro:161`, `:235`; `BudgetExposurePanel.astro:47`), `text-blue-100/80` (every field label in `MilestoneForm.astro:93-127` and `ProjectForm.astro`). Three opacities of one colour stand in for `muted-foreground`.
  - Native `<option class="bg-slate-900">` at `MilestoneForm.astro:108` and `ProjectForm.astro` (status and owner selects) works around the page not declaring a dark `color-scheme`.
- Token that should cover it: `--background`, `--foreground`, `--primary`, `--muted-foreground` (all defined at `global.css:6-75`, published at `:75-111`).
- **User impact:** link, label and hint colours vary by file and nothing ties them together, so a re-theme or contrast fix needs edits in every file, and native dropdowns depend on a hardcoded patch.

### C2 — Missing tokens: status colours bypass `destructive`

- Evidence (error, red palette): `[id].astro:99`, `:105-107`, `:139`; `MilestoneForm.astro:87`; `BudgetExposurePanel.astro:33` (badge), `:51` (`text-red-200` on figures), `:60`; `ProjectForm.astro` error banner. Success: `[id].astro:134` and `ProjectForm.astro` saved banner use `emerald-500/15` / `emerald-100`, and the token set has no success role (`global.css:6-39`).
- Token that should cover it: `--destructive` (defined `global.css:22`, `:56`; published `:94`); a success role would be a new token.
- Not colour-only: every red block observed above carries text ("Over budget", the error message), and the alert blocks carry `role="alert"`/`role="status"`.
- **User impact:** the same failure is painted with four slightly different reds (`red-500/15`, `/20`, `red-400/40`, `red-200`) depending on which section raised it, so "this is an error" is not one visual signal.

### C3 — Missing shared components: card, button, badge, field

- Panel/card: `rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur-xl sm:p-6` at `[id].astro:123`, `BudgetExposurePanel.astro:26`, `ProjectForm.astro:25` (with a `p-6` variant at `[id].astro:110`); the string appears in 15 files under `src/`. Inner tiles repeat `rounded-xl border border-white/10 bg-white/5` (`BudgetExposurePanel.astro:46`, `[id].astro:211`). No `Card` exists in `src/components/ui/`.
- Button: `buttonClass` (`form-classes.ts:10-11`) used at `MilestoneForm.astro:131` and `ProjectForm.astro` submit duplicates `src/components/ui/button.tsx`, which already has token variants, `disabled:` and `focus-visible:` styles (`button.tsx:8-25`). `buttonVariants` is exported (`button.tsx:50`), so `.astro` files can apply its classes without hydrating React.
- Badge: hand-made pill at `BudgetExposurePanel.astro:33` (same pattern on `src/pages/projects/index.astro:144`).
- Field: `inputClass` (`form-classes.ts:4-7`) plus a hand-written `<label><span>` wrapper repeated for every field in both forms; no shadcn `input`/`label`/`select`/`textarea`. Prior decision: `context/archive/2026-09-26-admin-configures-bonus-rules/plan.md:248` already allowed adding shadcn `input`, `label`, `table` via `npx shadcn@latest add` and rendering them statically; it was not acted on (`context/archive/2026-09-29-supervisor-assigns-employee-engagement/research.md:125`: "Only shadcn `button` is installed").
- **User impact:** buttons, panels and badges are restyled independently per view, so they already differ slightly (e.g. `SubmitButton` overrides `Button` with `bg-purple-600`, `src/components/auth/SubmitButton.tsx:18`), and each new view copies the drift.

### C4 — States: focus-visible, disabled/pending not covered

- Focus: `inputClass` styles `focus:` (not `focus-visible:`) with `purple-300` instead of `--ring` (`form-classes.ts:6`). Links (`[id].astro:93`, `:183`), the `<summary>` toggle (`:213`) and `buttonClass` have no focus style of their own; they fall back to the base `outline-ring/50` from `global.css:119`, where `--ring` is the light value `oklch(0.708 0 0)` because `.dark` is never applied.
- Disabled/pending: submits are plain `<button type="submit">` in server-rendered forms (`MilestoneForm.astro:131`, `ProjectForm.astro`); `buttonClass` has no `disabled:` style and nothing disables the button while the POST is in flight. The repo's existing pending pattern is the React `SubmitButton` with `useFormStatus` (`SubmitButton.tsx:12-17`), used only on auth pages.
- Loading: the page renders server-side after `Promise.all` (`[id].astro:50-56`); there is no client fetch, so a skeleton state has nothing to cover → candidate N/A (reason: full SSR navigation).
- Empty: `[id].astro:157` "No milestones yet." — a single muted line; when milestones are editable the add form follows (`:233-238`), when not (admin `:143-146`, closed `:148-153`) an explanation precedes it. Acceptable baseline, to restyle with tokens.
- **User impact:** keyboard users get a faint grey browser-style outline (or a purple ring on inputs only), and a slow save shows no feedback, so a second click submits the form again.

### C5 — Accidental architecture: page order mirrors feature order

- `[id].astro:116-118` — the page opens on the editable `ProjectForm` (name, dates, status, budget, notes, save), then `BudgetExposurePanel`, then milestones. The budget figures a supervisor checks (PRD invariant: worst-case payout flagged against budget, `CLAUDE.md`) appear only after a full edit form.
- `[id].astro:206-225` — each milestone's edit form is a `<details>` inside a `<tbody>` row (`colspan="4"`) of a table wrapped in `overflow-x-auto` (`:159`); with N editable milestones the table is interleaved with N collapsible forms. On a phone the form sits in the horizontally scrollable region. The PRD requires all Supervisor flows to be usable on a smartphone browser (`context/foundation/prd.md:130`).
- Entry paths (checked): logged out → redirect to `/auth/signin` (`src/middleware.ts:59-62`); invalid/missing/RLS-hidden id → "Project not found" panel (`[id].astro:66-67`, `:109-113`); load failure → alert panel (`:104-108`). Employee role → raw text `Forbidden` 403 (`middleware.ts:79-80`), no layout — see Open Questions (shared middleware, not this view's files).
- **User impact:** a supervisor opening a project from the list lands on a wall of inputs before any figures, and editing a milestone on a phone means scrolling a form sideways inside a table.

### Not a charge

- Agent rules: `CLAUDE.md` has no UI/token rule and no rule inviting arbitrary values (grep for `arbitrary|w-\[|token|color` in `CLAUDE.md`/`AGENTS.md`: only the `cn()` convention, `CLAUDE.md:30`). `AGENTS.md` is `@CLAUDE.md`. Nothing to remove; the change must add the UI block (skill "Make it stick").
- Arbitrary values: none in the view files (the scan's `-[Npx|rem]` arm found 0 in the four view files; `min-w-[40rem]` exists only on `src/pages/projects/index.astro:82`).

### Deferred (recorded 2026-10-01, after implementation)

Charges or parts of charges that `plan.md` left for a later change:

- **`src/components/form-classes.ts` and its 8 other importers** (admin sections, `EmployeeForm`, `EngagementForm`, `set-password.astro`, `employees/index.astro`, `projects/[id]/milestones/[milestoneId].astro`). This is the rest of C1/C3 outside this view. Reason: the change covers one view plus global tokens. Migrating those importers changes about 8 views and needs its own audit and screenshots.
- **`src/components/Topbar.astro`** (9 scan hits; renders on every page). Reason: it is shared chrome, and restyling it would change every page.
- **C5, mobile half: milestone edit `<details>` inside table rows** (`MilestonesSection.astro`). It still scrolls sideways at 390px. Reason: it is a structural change (card list rather than table), and the row-error opening logic needs retesting. The section reorder, the other half of C5, shipped in `98abd7d`.
- **Raw-text `Forbidden` 403 for employees** (`src/middleware.ts:79-80`). Reason: the fix is in shared middleware and also affects `/employees`.
- **The other 12 `bg-cosmic` pages' literal classes.** Reason: they look unchanged because `bg-cosmic` now comes from tokens. Moving each one onto token classes is its own per-view change.
- **Form errors aren't tied to the failing field** (`MilestoneForm.astro`, `ProjectForm.astro`). The error is a destructive Alert above the form. No input gets `aria-invalid`/`aria-describedby`, even though `[id].astro` reads the `field` query param and the shadcn inputs already style `aria-invalid`. This was the same before this change. Reason: it needs `errorField` passed into both forms and mapped to input ids (review F5).
- **Kitchen-sink ids repeat**:
  - `milestones` / `milestones-heading` (5 `MilestonesSection` instances)
  - `exposure` / `exposure-heading` (3 `BudgetExposurePanel` instances)
  - the add form's `milestone-new-*` field ids (2×)
  - `project-*` field ids (3 `ProjectForm` instances)

  The ids come from fixed section ids. Label clicks and `aria-labelledby` resolve to the first match on that page, so focus and label checks belong on `/projects/[id]`, where every id is unique; the page says so in a note. Reason it stays: fixing it would need id-prefix props on four components just for the demo page (review F4).

## Detailed Findings

### Token source → views

- `global.css:4` declares `@custom-variant dark (&:is(.dark *))`; `.dark` values at `:41-75`; `@theme inline` publishes `--color-*` and `--radius-*` at `:75-111` via `var()` (no raw colours inside `@theme inline`, so the toggle would work once `.dark` is applied).
- `global.css:117-124` base layer: `* { border-border outline-ring/50 }`, `body { bg-background text-foreground }`. Because `.dark` is never set, `body` paints the light `--background` (white); every page hides it under a full-height `bg-cosmic` wrapper (`[id].astro:86`). `Layout.astro` sets no `dark` class and no `color-scheme` (`src/layouts/Layout.astro:14-36`).
- Token set has no success/warning role (`global.css:6-39`).

### Blast radius of shared pieces

- `form-classes.ts` is imported by 10 files: `admin/{JobRolesSection,KpiSettingsSection,RatingFactorsSection}.astro`, `employees/EmployeeForm.astro`, `engagements/EngagementForm.astro`, `projects/{MilestoneForm,ProjectForm}.astro`, `pages/auth/set-password.astro`, `pages/employees/index.astro`, `pages/projects/[id]/milestones/[milestoneId].astro`.
- The panel class string appears in 15 files (incl. `dashboard.astro`, all auth pages, `admin/index.astro`, `employees/index.astro`, `projects/index.astro`, the milestone page).
- `ProjectForm.astro` is also rendered by `src/pages/projects/index.astro:4`; `Topbar.astro` by every app page.
- Applying `.dark` (or changing `:root`) in `Layout.astro`/`global.css` affects every page, but since no page reads tokens today the only visible global effect is `body` background behind `bg-cosmic` and the base `outline-ring` colour.

### Tooling for the gate and guard

- No Playwright config, no Storybook (`ls playwright.config.* .storybook` → none). Visual gate = kitchen-sink page + manual screenshots.
- Pre-commit: lint-staged runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}` (`package.json:59-66`); `prettier-plugin-tailwindcss` installed (`package.json:53`). No Tailwind lint plugin; a hardcoded-value check would be a new script or an ESLint rule.

## Code References

- `src/pages/projects/[id].astro:86-96` — page shell, title gradient, back link
- `src/pages/projects/[id].astro:98-113` — page error, load error, not-found panels
- `src/pages/projects/[id].astro:116-118` — section order (ProjectForm → BudgetExposurePanel → milestones)
- `src/pages/projects/[id].astro:156-231` — milestones table with nested `<details>` edit forms
- `src/components/projects/BudgetExposurePanel.astro:23-64` — exposure panel, over-budget badge and red figures
- `src/components/projects/MilestoneForm.astro:85-136` — milestone form fields and submit
- `src/components/form-classes.ts:4-11` — shared `inputClass` / `buttonClass`
- `src/components/ui/button.tsx:7-37,50` — shadcn Button and exported `buttonVariants`
- `src/components/auth/SubmitButton.tsx:12-33` — existing pending-state pattern (React, `useFormStatus`)
- `src/styles/global.css:4,6-124` — token source, `bg-cosmic`, base layer
- `src/layouts/Layout.astro:14-36` — html/body, no theme class
- `src/middleware.ts:59-82` — entry guards for `/projects/*`

## Architecture Insights

- Server-rendered `.astro` forms posting to `/api/projects/...` with `?saved=`/`?error=` redirects (`[id].astro:23-35`); no islands on this view. Shared components should therefore be static: shadcn components can be rendered from `.astro` without a `client:` directive, or their `cva` variant functions applied as classes.
- The dark look is the de-facto product theme (every page wraps in `bg-cosmic`), while the token file is shadcn's untouched neutral default. Making the view read tokens requires choosing token _values_ that reproduce the dark theme, i.e. applying `.dark` and/or editing `.dark`/`:root` values — a global decision.

## Historical Context (from prior changes)

- `context/archive/2026-09-26-admin-configures-bonus-rules/plan.md:248` — permitted adding shadcn `input`/`label`/`table` via `npx shadcn@latest add`, rendered statically. Supported as a convention; not implemented (see next).
- `context/archive/2026-09-27-supervisor-creates-project-and-milestones/plan.md:427` — chose server-rendered sections "in the `KpiSettingsSection.astro` style" reusing `buttonClass`/`inputClass`. This is the origin of the projects components' literal styling; its path `src/components/admin/form-classes.ts` is stale — the file now lives at `src/components/form-classes.ts`.
- `context/archive/2026-09-29-supervisor-assigns-employee-engagement/research.md:125` — "Only shadcn `button` is installed… React is used on auth pages only." Still supported at this commit.

## Related Research

- `context/archive/2026-09-29-supervisor-assigns-employee-engagement/research.md` — engagement UI; same form-classes pattern.

## Open Questions

1. **Theme mechanism (global):** apply `class="dark"` on `<html>` in `Layout.astro` and tune `.dark` values to the cosmic palette, or rewrite `:root` values as a dark-only theme? Either touches every page's `body`/`outline` but no page's classes. `bg-cosmic`'s gradient: keep as a background utility built from tokens, or drop for flat `--background`?
2. **Scope of shared files:** `form-classes.ts` (10 importers), `Topbar.astro` (all pages) and `ProjectForm.astro` (also on `/projects`). Migrate in place (other views change too), or have this view stop importing them and leave the shared files for a follow-up? The skill's "one view plus global tokens" rule argues for the latter, with the shared migration deferred.
3. **Success token:** add a `--success` role (new token) for the saved banners, or render "saved" in neutral `muted`/`primary` styling?
4. **Pending state:** introduce a React island (reuse/generalise `SubmitButton`) on this view, or mark pending as N/A for no-JS forms?
5. **Layout reorder (C5):** in scope for this change (move exposure first, move milestone edit out of the table) or deferred to its own change? It changes structure, not tokens.
6. **Employee 403 as raw text** (`middleware.ts:79-80`): accidental-architecture finding on this view's entry path, but the fix lives in shared middleware affecting `/projects` and `/employees`; likely deferred to its own change.
