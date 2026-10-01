<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Project detail view on the design-system contract

- **Plan**: context/changes/ui-projects-panel/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-10-01
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

## Evidence

- **Drift pass:** every planned change in phases 1–5 matches its intent and contract. The accepted adaptations (exact background oklch values, plain `<option selected>`, `Astro.response.status` 404, `section`-wrapped Cards, the `option` popover rule) were all done cleanly.
  - `[id].astro` lines 21–82 are byte-identical to `1ac6060`, so the row-error logic is unchanged.
  - Form `name`/`required`/`maxLength`/`inputMode`/`autoComplete` are unchanged.
  - `form-classes.ts`, `Topbar.astro`, `middleware.ts`, `src/lib`, `src/pages/api` and `supabase/` are untouched.
- **Dismissed claim:** the drift pass said static React slots leave an `<astro-static-slot>` element inside `<select>`/`<table>`. Astro strips those tags for non-hydrated components (`node_modules/astro/dist/runtime/server/render/component.js:254-267`, `removeStaticAstroSlot`), so the markup is clean.
- **Automated criteria (re-run 2026-10-01):** all pass.
  - lint, `astro check` (0 errors), build, `lint:ui` (7 files clean)
  - no old `SubmitButton` import, no hex in `global.css`, `@theme inline` uses `var()` only, no `form-classes` import in the view
  - the files under "NOT doing" are untouched
  - smoke 8/8 against a fresh production preview; the kitchen sink returns 404 there
- **Environment, not code:** the long-running dev server (pid 44040) answered 500 on every route, including `/` and `/auth/signin`, after `astro sync`/`build` ran alongside it. Restart it.
- **Safety:**
  - No XSS: there is no `set:html`, and names, notes and errors render escaped.
  - No authz, data or RLS change.
  - The kitchen sink's prod chunk compiles to `isDev = false` with a 404 and an empty body.
  - `useFormPending`: per-form matching, `defaultPrevented` handling, constraint-validation behaviour, cleanup and bfcache reset were all verified.
  - Ids and labels on `/projects/[id]` are unique, and every `htmlFor` matches its control.

## Findings

### F1 — React runtime and N+2 eager islands on pages that shipped no JS

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Performance)
- **Location**: src/components/projects/MilestoneForm.astro:74, src/components/projects/ProjectForm.astro:124
- **Detail**:
  - Before this change, `/projects/[id]` and `/projects` had no `client:` islands.
  - Both pages now load the React client runtime (~213 KB raw `client.*.js`) plus one `client:load` SubmitButton per form: ProjectForm, every milestone's edit form, and the add form.
  - The edit forms sit inside closed `<details>` but hydrate immediately, and each one adds its own `document` submit listener.
  - The plan accepted the runtime cost and named `client:visible` as the fallback "if a project has dozens of milestones". Eager hydration of hidden edit forms is the part that scales with N.
- **Fix A ⭐ Recommended**: Hydrate the per-milestone edit buttons with `client:visible` (they hydrate when the `<details>` opens). Keep `client:load` for ProjectForm and the add form.
  - Strength: The fallback the plan already named; one attribute; keeps the SubmitButton decision you made in planning.
  - Tradeoff: The React runtime still loads on both pages, and a click within milliseconds of opening a row submits natively with no "Saving…" (the submit still works).
  - Confidence: HIGH — `client:visible` uses an IntersectionObserver, and closed `<details>` content is not rendered, so it doesn't intersect.
  - Blind spot: Not measured on a real project with many milestones.
- **Fix B**: Replace the islands on server-rendered forms with a small inline `<script>` that disables `[type=submit]` on non-prevented `submit`. Keep SubmitButton for the React auth forms.
  - Strength: Zero React on the projects pages.
  - Tradeoff: Reopens a planning decision: you rejected "Tiny inline script" because it adds a second pending mechanism next to SubmitButton.
  - Confidence: MED — straightforward, but it touches both forms and the kitchen sink.
  - Blind spot: Styling the pending state without the React component (spinner, text swap) means duplicating markup.
- **Decision**: FIXED (Fix A) — edit-row SubmitButton now `client:visible`; add form keeps `client:load`.

### F2 — "Saving…" can stay stuck after a cancelled submit

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/components/hooks/useFormPending.ts:18-29, src/components/SubmitButton.tsx:22
- **Detail**:
  - If the user presses Esc or Stop after submitting, or the request hangs, the button stays disabled until a reload, because `pageshow` resets only on bfcache restores.
  - Firefox also persists a `<button>`'s dynamic `disabled` state across non-bfcache back navigations (documented on MDN). React hydration with `disabled={false}` doesn't patch that DOM property, so the button can come back stuck.
- **Fix**: Add `autoComplete="off"` to the Button in SubmitButton (MDN's documented fix for Firefox). In `useFormPending`, also reset `pending` on an `Escape` keydown after a submit.
- **Decision**: SKIPPED

### F3 — Screenshot evidence for checks 3.5, 4.4 and 4.5 is missing or duplicated

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/ui-projects-panel/screenshots/ (untracked)
- **Detail**:
  - Progress rows 3.5, 4.4 and 4.5 are ticked and name screenshot files. The folder holds `p3-desktop.jpeg`, `p3-mobile.jpeg` and `p4-focus.jpeg`.
  - `p4-focus.jpeg` is byte-identical to `p3-desktop.jpeg` (sha256 `07a057c4…`).
  - `p4-kitchen-desktop` and `p4-kitchen-mobile` don't exist, and nothing in the folder is committed.
  - The `/10x-ui` gate relies on these as review evidence.
- **Fix**: Re-capture the focus screenshot (mid-tab, ring visible), capture the kitchen sink at 1280px and 390px, then commit the `screenshots/` folder.
- **Decision**: FIXED (differently) — the user deleted the duplicate `p4-focus.jpeg`. `p3-desktop.jpeg` and `p3-mobile.jpeg` are committed as evidence for 3.5. Checks 4.4 and 4.5 (kitchen sink at 1280/390px, focus tab-through) were confirmed visually by the user, but no screenshot was captured.

### F4 — Kitchen sink repeats ids beyond what its note and research.md say

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Accessibility, dev page only)
- **Location**: src/pages/dev/projects-kitchen-sink.astro:178-269
- **Detail**:
  - The note and `research.md` mention only the 3 ProjectForm instances. The page also repeats:
    - `id="milestones"`/`milestones-heading` 5 times and `exposure`/`exposure-heading` 3 times
    - `milestone-new-*` field ids twice
  - On this page, label clicks and `aria-labelledby` resolve to the first match. Since this is the visual gate for focus and label checks, those checks can mislead here. The real `/projects/[id]` page is unaffected.
- **Fix**: Extend the on-page note and the `research.md` deferred entry to cover all four repeated id sets.
- **Decision**: FIXED — the kitchen-sink header note lists all four repeated id sets and points label/focus checks to `/projects/[id]`; the research.md deferred entry is updated.

### F5 — Form errors aren't tied to the failing field

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Accessibility, pre-existing)
- **Location**: src/components/projects/MilestoneForm.astro:28-32, src/components/projects/ProjectForm.astro:47-51
- **Detail**:
  - The error is a destructive Alert above the form. No input gets `aria-invalid`/`aria-describedby`, even though `[id].astro:25` reads the `field` query param and the shadcn inputs already style `aria-invalid`.
  - This is the same behaviour as before the change, so it isn't a regression. The 7-state matrix's "message next to the field" is met only at form level.
- **Fix**: Record it as a deferred charge in `research.md`. It needs `errorField` plumbed into both forms, which is beyond this change's scope.
- **Decision**: FIXED — recorded as a deferred charge in research.md `### Deferred`.

### F6 — Small documentation drift in CLAUDE.md and tokens.md

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: CLAUDE.md:42-44, CLAUDE.md:50-55, context/changes/ui-projects-panel/tokens.md:50-52
- **Detail**:
  - A blank line before the `npm run lint:ui` bullet splits the Commands list into two lists.
  - The plan's UI block was to say "`npm run lint:ui` lists the files already on the contract", but the UI section doesn't mention `lint:ui`.
  - In `tokens.md`, the two "on `--card`" contrast rows sit after a blank line, so they render as a headerless broken table.
- **Fix**: Remove the stray blank line, add one `lint:ui` / `CLEAN_PATHS` sentence to the UI section, and join the two rows into the contrast table. Stage only these CLAUDE.md lines; your 10x-cli block edits stay out.
- **Decision**: FIXED — Commands list rejoined, a UI "Guard" bullet added for `lint:ui`/`CLEAN_PATHS`, and the contrast rows joined back into the table.

### F7 — Two Radix import styles

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/ui/badge.tsx:4, src/components/ui/label.tsx:3, src/components/ui/button.tsx:2
- **Detail**: The new shadcn files import from the `radix-ui` umbrella package (new dependency `^1.6.7`), while `button.tsx` still uses `@radix-ui/react-slot`. Both work, but the repo now carries two dependency styles.
- **Fix**: Switch `button.tsx` to `import { Slot } from "radix-ui"` and uninstall `@radix-ui/react-slot`.
- **Decision**: FIXED — button.tsx imports `Slot` from `radix-ui` (`Slot.Root`); `@radix-ui/react-slot` uninstalled.

### F8 — UI literal check's hex pattern can flag hex-like anchors

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Tooling)
- **Location**: scripts/check-ui-literals.mjs:20
- **Detail**:
  - `#[0-9a-fA-F]{3,8}\b` also matches fragment links whose names are valid hex (`href="#add"`, `#face`, `#feed`), which would fail a commit for a non-colour.
  - No current file trips it.
  - Windows absolute paths, `[id]` brackets, spaces in the path and lint-staged filtering were all checked and work.
- **Fix**: Skip matches preceded by `href="` (or require a non-word/non-`/` character before `#`), keeping the regex otherwise identical to the `/10x-ui` scan.
- **Decision**: FIXED — hex arm now skips a `#` inside an `href` value (`(?<!href=["'][^"'s]*)`); verified on 8 samples plus the deliberate break.
