# Project detail view on the design-system contract — Implementation Plan

## Overview

Put `/projects/[id]` (the project detail view: `src/pages/projects/[id].astro` plus `ProjectForm`, `BudgetExposurePanel`, `MilestoneForm`) on the repo's design-system contract: shadcn tokens in `src/styles/global.css` and shadcn components in `src/components/ui/`. Today the view reads 0 tokens and 0 shared components and paints a dark "cosmic" theme from palette literals (66 scan hit lines). The change addresses charges C1–C4 and the section-order half of C5 from `research.md`, ends with a 7-state kitchen sink and a rule plus check that keep the next agent on the contract.

## Current State Analysis

- Token source `src/styles/global.css:6-111` is shadcn's untouched neutral default; `.dark` (`:41`) is never applied (`src/layouts/Layout.astro:14-36` sets no class, no `color-scheme`). The real theme lives in literals and in `@utility bg-cosmic` (`global.css:113-115`, three hex stops), used by 13 files.
- The view renders server-side `.astro` forms that POST and redirect with `?saved=`/`?error=` (`[id].astro:23-35`); no islands.
- Duplicated primitives: panel class string (15 files), `buttonClass`/`inputClass` (`src/components/form-classes.ts:4-11`, 10 importers), hand-made badge (`BudgetExposurePanel.astro:33`). Only `ui/button.tsx` and `ui/LibBadge.astro` exist.
- States: `inputClass` uses `focus:` + purple, links/summary have no own focus style; submits have no disabled/pending style.
- Order: `ProjectForm` → `BudgetExposurePanel` → milestones (`[id].astro:116-239`).

## Desired End State

- `<html class="dark">` with `color-scheme: dark`; `.dark` values reproduce today's cosmic look (purple primary, blue-tinted muted text, translucent surfaces); new `--success`, `--success-foreground`, `--background-accent` tokens exist in `:root` and `.dark` and are published in `@theme inline`; `bg-cosmic` is built from tokens, no hex outside `:root`/`.dark`.
- The four view files use only token classes and components from `src/components/ui/`; the hardcoded-value scan returns **0** hits on them.
- Page order: Budget exposure → Milestones → Project details.
- Every submit on the view shows a disabled "Saving…" state while the POST is in flight; every control shows a `--ring` focus-visible ring.
- A dev-only kitchen-sink page shows the view's sections in all 7 states; screenshots at 1280px and 390px are saved in the change folder.
- `CLAUDE.md` carries a UI block; `scripts/check-ui-literals.mjs` fails lint-staged and CI on literals in the cleaned files.

Verify: `npm run lint`, `npx astro check`, `npm run build`, `npm run lint:ui`, then the kitchen sink and `/projects/<id>` in the browser.

### Key Discoveries:

- `buttonVariants` is exported from `src/components/ui/button.tsx:50`; shadcn React components render statically from `.astro` without a `client:` directive.
- `SubmitButton` (`src/components/auth/SubmitButton.tsx:12`) uses `useFormStatus`, which only tracks React form actions; both callers (`SignInForm.tsx:43`, `SignUpForm.tsx:66`) are plain `method="POST"` forms with an `onSubmit` handler, so it cannot report pending for them or for Astro forms.
- shadcn ships `native-select` (`npx shadcn@latest add native-select`) — a styled native `<select>`, no Radix, no JS (Context7: ui.shadcn.com/docs/components/base/native-select).
- Prior decision `context/archive/2026-09-26-admin-configures-bonus-rules/plan.md:248` already allowed static shadcn `input`/`label`/`table`.
- Pre-commit is lint-staged (`package.json:59-66`); CI `ci` job runs `npm run lint` (`.github/workflows/ci.yml:20`). No Playwright/Storybook.
- `CLAUDE.md:77-91` is the `@przeprogramowani/10x-cli` managed block; the UI rule goes above it.

## What We're NOT Doing

- Migrating `src/components/form-classes.ts` and its 8 other importers (admin, employees, engagements, set-password, milestone page) — deferred charge.
- Restyling `src/components/Topbar.astro` (renders on every page; 9 scan hits) — deferred charge.
- Replacing the milestone edit `<details>` inside table rows with a card list (C5 mobile half) — deferred charge.
- Changing the raw-text `Forbidden` 403 in `src/middleware.ts:79-80` — deferred charge, shared middleware.
- Migrating the other 12 `bg-cosmic` pages' literal classes; they keep their look because `bg-cosmic` is rebuilt to the same colours.
- Installing Playwright/Storybook or any lint dependency; no light-theme toggle.
- Any data, API or RLS change.

## Implementation Approach

Follow the `/10x-ui` order: library → token values → one view → states, then gate and guard. Phase 1 only adds components and the pending hook (no visual change on this view). Phase 2 changes global values but no class in any view, so other pages must look unchanged except the auth submit button. Phase 3 swaps the view's literals for tokens/components and reorders sections. Phase 4 completes the state matrix and builds the kitchen sink. Phase 5 writes the rule and the check. After every visual phase (2, 3, 4): screenshot `/projects/<id>` at 1280px and 390px and re-run the scan on the view files; the count must not go up.

Scan command (from the `/10x-ui` skill), run on `src/pages/projects/[id].astro src/components/projects/*.astro`; baseline 54 hit lines on these 4 files (25+14+8+7):

```bash
grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|-\[[0-9.]+(px|rem)\]|\b(bg|text|border|ring|outline|from|via|to|fill|stroke|shadow|divide)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b' <files>
```

## Critical Implementation Details

- **Pending detection must run after React's handler.** The shared pending hook listens for `submit` on `document` (bubble phase), matches `event.target` to the button's own form, and ignores events with `defaultPrevented`. A listener on the form itself fires before React's root-delegated `onSubmit`, so it would mark auth forms pending even when their client validation cancels the submit. Set `disabled` only after the event (next tick), so the native submission is not cancelled; the buttons carry no `name`, so no submitter value is lost.
- **Static React form fields need uncontrolled props.** Rendering shadcn `Input`/`Textarea`/`NativeSelect` from `.astro` with `value=` triggers React's "value without onChange" warning; pass `defaultValue` (and `defaultValue` on the select instead of `selected` on options).
- **Row error opening must survive the extraction.** `rowErrorId` / `addFormError` / `sectionError` (`[id].astro:75-82`) decide where a milestones error renders and which `<details>` opens; move the computation as-is into the page and pass the results to `MilestonesSection` as props.

## Phase 1: Library — shadcn components and a shared pending button

### Overview

Add the shadcn components the view needs and make the existing `SubmitButton` usable on any server-rendered form. No change to `/projects/[id]` yet.

### Changes Required:

#### 1. shadcn components

**File**: `src/components/ui/{card,badge,input,label,textarea,native-select,alert,table}.tsx`

**Intent**: Install through the stack's own path so the view has real primitives instead of class strings.

**Contract**: `npx shadcn@latest add card badge input label textarea native-select alert table` (new-york, `components.json` unchanged; no `shadcn init`). In `card.tsx`, add `backdrop-blur-xl` to the Card base class so the translucent glass look lives in the component, not at each call site. Add a `success` variant to `alert.tsx` (`bg-success/10 text-success border-success/40`-style, token classes only).

#### 2. Pending hook

**File**: `src/components/hooks/useFormPending.ts`

**Intent**: Report whether the form containing a given element has been submitted, for native (non-action) forms.

**Contract**: `useFormPending(ref: RefObject<HTMLElement | null>): boolean`. Behaviour per _Critical Implementation Details_ (document-level listener, `closest("form")` match, `defaultPrevented` ignored). Resets on `pageshow` with `persisted` (back/forward cache) so a restored page is not stuck disabled.

#### 3. Shared SubmitButton

**File**: `src/components/SubmitButton.tsx` (moved from `src/components/auth/SubmitButton.tsx`); update imports in `src/components/auth/SignInForm.tsx`, `src/components/auth/SignUpForm.tsx`

**Intent**: One submit button with disabled + spinner + pending text for all forms, using Button's token variants.

**Contract**: props `{ pendingText: string; icon?: ReactNode; children: ReactNode; variant?: ButtonProps["variant"]; className?: string; pending?: boolean }` — `pending` forces the state (kitchen sink only). Uses `useFormPending` instead of `useFormStatus`; renders `Button type="submit" disabled={pending}`. Drop the `bg-purple-600 … text-white` override and the `border-white/30 border-t-white` spinner literals; spinner uses `border-current`-based classes. Auth callers keep `className="w-full"`.

### Success Criteria:

#### Automated Verification:

- `npx astro sync && npm run lint` passes
- `npx astro check` passes
- `npm run build` passes
- No file under `src/` imports `@/components/auth/SubmitButton`
- Scan on `src/components/SubmitButton.tsx` returns 0 hits

#### Manual Verification:

- `/auth/signin`: submitting valid credentials shows "Signing in..." with a disabled button; submitting with an empty field (client validation) leaves the button enabled
- `/auth/signup` behaves the same

**Implementation Note**: pause for manual confirmation before Phase 2.

---

## Phase 2: Token values — dark theme on, cosmic look in tokens

### Overview

Make the tokens carry the product theme, globally, without touching any view's classes.

### Changes Required:

#### 1. Apply the theme

**File**: `src/layouts/Layout.astro`

**Intent**: Turn on the `.dark` token set for every page and make native controls (date pickers, select popups, scrollbars) dark.

**Contract**: `<html lang="en" class="dark">`; `color-scheme: dark` declared for `.dark` in `global.css` (not inline in the layout).

#### 2. Token values

**File**: `src/styles/global.css`

**Intent**: Retune `.dark` to reproduce the current literals by role, add the three new roles, and rebuild `bg-cosmic` from tokens. Add a one-line comment above `.dark` naming the source: "values mapped from the pre-token cosmic literals — see context/changes/ui-projects-panel/tokens.md".

**Contract**: starting values (Tailwind v4 palette equivalents of today's literals; adjust only after the contrast check):

| Token (`.dark`)              | Value                                   | Replaces literal       |
| ---------------------------- | --------------------------------------- | ---------------------- |
| `--background`               | `oklch(0.155 0.02 266)`                 | `#0a0e1a`              |
| `--background-accent` (new)  | `oklch(0.19 0.04 267)`                  | `#0f1529`              |
| `--card`                     | `oklch(1 0 0 / 10%)`                    | `bg-white/10`          |
| `--muted`                    | `oklch(1 0 0 / 5%)`                     | `bg-white/5`           |
| `--accent`                   | `oklch(1 0 0 / 10%)`                    | `hover:bg-white/10–20` |
| `--muted-foreground`         | `oklch(0.932 0.032 255.585 / 70%)`      | `text-blue-100/60–80`  |
| `--primary`                  | `oklch(0.827 0.119 306.383)`            | `text-purple-300`      |
| `--primary-foreground`       | `oklch(0.205 0 0)`                      | —                      |
| `--ring`                     | `oklch(0.827 0.119 306.383)`            | `ring-purple-300`      |
| `--input`                    | `oklch(1 0 0 / 20%)`                    | `border-white/20`      |
| `--border`                   | `oklch(1 0 0 / 10%)` (unchanged)        | `border-white/10`      |
| `--destructive`              | `oklch(0.704 0.191 22.216)` (unchanged) | `red-*`                |
| `--success` (new)            | `oklch(0.765 0.177 163.223)`            | `emerald-*`            |
| `--success-foreground` (new) | `oklch(0.985 0 0)`                      | `text-emerald-100`     |

`:root` gets light counterparts for the three new roles (`--background-accent` = `--background`, `--success` `oklch(0.596 0.145 163.225)`, `--success-foreground` `oklch(0.985 0 0)`). `@theme inline` publishes `--color-success`, `--color-success-foreground`, `--color-background-accent` via `var()` only. `bg-cosmic` becomes `linear-gradient(to bottom, var(--background), var(--background-accent), var(--background))`.

#### 3. Deposit the values

**File**: `context/changes/ui-projects-panel/tokens.md`

**Intent**: Keep the raw mapping in the repo so the next session doesn't re-derive it.

**Contract**: the table above with final values, plus the contrast results from the manual check.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npx astro check`, `npm run build` pass
- `grep -nE '#[0-9a-fA-F]{3,8}' src/styles/global.css` returns 0 hits
- Every `--color-*` line inside `@theme inline` uses `var(` (no raw colour)
- View scan count on the 4 view files is still 54 (no view classes changed)

#### Manual Verification:

- `/projects/<id>`, `/projects`, `/dashboard`, `/admin`, `/employees`, `/auth/signin`: background gradient looks the same as before (screenshot before/after at 1280px)
- Auth submit button now uses `--primary` (expected, accepted change); text readable
- Native date picker and select popups render dark
- Contrast: `--muted-foreground` and `--primary` text on `--background` ≥ 4.5:1; `--primary-foreground` on `--primary` ≥ 4.5:1 (record in `tokens.md`)

**Implementation Note**: pause for manual confirmation before Phase 3.

---

## Phase 3: The view — tokens, components, section order

### Overview

Rebuild `/projects/[id]` and its three components from tokens and `ui/` components; reorder sections so figures come first.

### Changes Required:

#### 1. Page shell and order

**File**: `src/pages/projects/[id].astro`

**Intent**: Use token classes for shell, title and back link; render page-level error/load-error with `Alert variant="destructive"`, not-found with `Card`; order sections Budget exposure → Milestones → Project details.

**Contract**: wrapper `bg-cosmic min-h-screen p-4 text-foreground`; title `text-foreground` (no gradient, no `text-transparent`); back link `text-primary hover:underline` with `focus-visible` ring. Data loading and the `statusFor`/`rowErrorId`/`addFormError`/`sectionError` logic unchanged. Section anchors (`#exposure`, `#milestones`, `#project`) keep their ids because API redirects target them.

#### 2. Milestones section

**File**: `src/components/projects/MilestonesSection.astro` (new, extracted from `[id].astro:120-239`)

**Intent**: Make the milestones section renderable from props (for the kitchen sink) and build it from `Card`, `Table`, `Alert`.

**Contract**: props `{ project: Project; milestones: Milestone[]; isAdmin: boolean; canEditMilestones: boolean; saved: boolean; sectionError: string | null; rowErrorId: string | null; rowError: string | null; addFormError: string | null }`. Keeps the per-milestone `<tbody>` with the `<details>` edit row (structure deferred). Cancelled rows keep reduced emphasis via `text-muted-foreground` instead of `opacity-60`. Empty state: `text-muted-foreground` "No milestones yet." plus "Add the first one below." when `canEditMilestones`. `<summary>` gets `text-primary` and a focus-visible ring.

#### 3. Budget exposure panel

**File**: `src/components/projects/BudgetExposurePanel.astro`

**Intent**: `Card` container, `Badge variant="destructive"` for "Over budget", figure tiles on `bg-muted`, over-budget figures `text-destructive`, unavailable exposure as `Alert variant="destructive"`.

**Contract**: props unchanged.

#### 4. Forms

**Files**: `src/components/projects/ProjectForm.astro`, `src/components/projects/MilestoneForm.astro`

**Intent**: Replace `inputClass`/`buttonClass` and the `<label><span>` pattern with `Label` + `Input`/`Textarea`/`NativeSelect`, saved banner with `Alert variant="success"`, errors with `Alert variant="destructive"`, submit with `SubmitButton client:load` (`pendingText` "Saving…"/"Adding…"/"Creating…"). Both files stop importing `@/components/form-classes`; `option class="bg-slate-900"` goes away.

**Contract**: props unchanged; field `name`s, `required`, `maxlength`, `inputmode`, `autocomplete` unchanged (API contract). Uncontrolled `defaultValue` per _Critical Implementation Details_. Each `Label` has `htmlFor` matching a unique input `id` (ids prefixed per form instance, e.g. milestone id, since several MilestoneForms render on one page). `ProjectForm` change also applies to the create form on `/projects`.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npx astro check`, `npm run build` pass
- Scan on `src/pages/projects/[id].astro src/components/projects/*.astro` returns 0 hits
- `grep -rn "form-classes" src/components/projects "src/pages/projects/[id].astro"` returns nothing
- `npm run smoke` passes (with local Supabase + dev server)

#### Manual Verification:

- `/projects/<id>` as supervisor at 1280px and 390px: order is exposure → milestones → details; screenshots saved as `context/changes/ui-projects-panel/screenshots/p3-{desktop,mobile}.png`
- Save project, add milestone, edit milestone (valid + invalid input) still work; an invalid milestone edit reopens that row's `<details>` with the error
- As admin: owner select present, milestones read-only note shown
- Closed project: reopen note shown, no edit forms
- `/projects` create form renders and creates a project
- No React "value without onChange" warning in the dev server console

**Implementation Note**: pause for manual confirmation before Phase 4.

---

## Phase 4: States and the visual gate

### Overview

Close the 7-state matrix on this view and build the kitchen sink that shows every state at once.

### Changes Required:

#### 1. Focus and hover pass

**Files**: the 4 view files, `MilestonesSection.astro`

**Intent**: Every interactive element (links, `<summary>`, inputs, selects, textareas, buttons) shows a `--ring` focus-visible indicator and a token-driven hover change.

**Contract**: links and `<summary>` use `focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-sm` — same 3px ring as `button.tsx:8`, but written as `ring-3` because the scan flags the arbitrary `ring-[3px]` form in view files; inputs/buttons inherit from shadcn components.

#### 2. Kitchen sink

**File**: `src/pages/dev/projects-kitchen-sink.astro`

**Intent**: Render the view's sections side by side in every state from fixtures, as review evidence and the visual gate.

**Contract**: returns 404 unless `import.meta.env.DEV`. Uses `Layout`, `bg-cosmic`, and renders: `BudgetExposurePanel` (normal, over budget, `exposure=null`); `MilestonesSection` (empty+editable, rows+editable with one row error open, admin read-only, closed project, saved banner); `ProjectForm` (default, saved, error); `SubmitButton` with `pending` forced and a `disabled` Button. A header table lists the 7 states with "shown in section X" or "N/A — reason". Fixture data is inline in the page, typed with `@/types`.

State matrix to fill:

| State         | Where shown                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| default       | all sections                                                                                                                                        |
| hover         | manual (pointer) — noted in matrix                                                                                                                  |
| focus-visible | manual tab-through — screenshot `p4-focus.png`                                                                                                      |
| disabled      | forced-pending SubmitButton + disabled Button                                                                                                       |
| error         | ProjectForm error, MilestonesSection row/section error, exposure unavailable                                                                        |
| empty         | MilestonesSection empty                                                                                                                             |
| loading       | N/A — page is fully server-rendered after `Promise.all` (`[id].astro:50-56`); no client fetch to skeleton. Pending submit covers in-flight feedback |

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npx astro check`, `npm run build` pass
- Scan on the 4 view files + `MilestonesSection.astro` + the kitchen sink returns 0 hits
- Production build serves 404 for `/dev/projects-kitchen-sink` (`npm run preview`, `curl -o /dev/null -w "%{http_code}"` → 404)

#### Manual Verification:

- Kitchen sink at 1280px and 390px: every matrix row shown or marked N/A with reason; screenshots `p4-kitchen-{desktop,mobile}.png`
- Tab through `/projects/<id>`: focus ring visible on every control, in DOM order; screenshot `p4-focus.png`
- Submitting a form on `/projects/<id>` shows the disabled "Saving…" state; back-button return does not leave a stuck disabled button
- Error messages sit next to their form, use `destructive`, and carry text (not colour alone)

**Implementation Note**: pause for manual confirmation before Phase 5.

---

## Phase 5: Make it stick — rule, check, deferred charges

### Overview

Leave the contract where the next agent will read it, and a check that fails when it is broken.

### Changes Required:

#### 1. Agent rule

**File**: `CLAUDE.md` (above the `<!-- BEGIN @przeprogramowani/10x-cli -->` block at `:77`)

**Intent**: Short `## UI` block: tokens live in `src/styles/global.css` (`:root`/`.dark` values, published via `@theme inline`; dark theme is on via `<html class="dark">`; extra roles `success`, `background-accent`); components live in `src/components/ui/` — check there before creating one, add missing ones with `npx shadcn@latest add <name>`; no literal colours, palette classes or arbitrary values in views — use token classes; submit buttons use `src/components/SubmitButton.tsx`; kitchen sink at `/dev/projects-kitchen-sink`; `npm run lint:ui` lists the files already on the contract.

**Contract**: new section; update `## Commands` with `npm run lint:ui`.

#### 2. Literal check

**Files**: `scripts/check-ui-literals.mjs` (new), `package.json`, `.github/workflows/ci.yml`

**Intent**: Dependency-free scan with the skill's regex over an allowlist of cleaned files; fails with `file:line` output.

**Contract**: `CLEAN_PATHS` constant = the 4 view files, `MilestonesSection.astro`, `SubmitButton.tsx`, the kitchen sink. With file arguments it checks only those that are in `CLEAN_PATHS` (lint-staged); without arguments it checks all of `CLEAN_PATHS`. `package.json`: script `"lint:ui": "node scripts/check-ui-literals.mjs"`; lint-staged `*.{ts,tsx,astro}` gains `node scripts/check-ui-literals.mjs`. CI `ci` job: `npm run lint:ui` after `npm run lint`.

#### 3. Deferred charges

**File**: `context/changes/ui-projects-panel/research.md`

**Intent**: Mark what this change did not address, with reasons, under `## Charges`.

**Contract**: append `### Deferred` listing: `form-classes.ts` + 8 importers (scope: one view per change); `Topbar.astro` (renders on every page); milestone edit `<details>` inside table rows (C5 mobile half; structural); raw-text 403 in `middleware.ts:79-80` (shared middleware); remaining 12 `bg-cosmic` pages' literals.

### Success Criteria:

#### Automated Verification:

- `npm run lint:ui` exits 0
- Adding `text-purple-300` to `src/components/projects/BudgetExposurePanel.astro` makes `npm run lint:ui` exit 1 with that file:line (revert after)
- `npm run lint`, `npx astro check`, `npm run build` pass
- `CLAUDE.md` UI block sits outside the 10x-cli BEGIN/END markers

#### Manual Verification:

- `CLAUDE.md` UI block is short and names tokens, components, add path, no-literals rule, kitchen sink and `lint:ui`
- `research.md` lists every deferred charge with a reason

---

## Testing Strategy

### Unit Tests:

- None — the repo has no unit-test framework (`CLAUDE.md` Commands).

### Integration Tests:

- `npm run smoke` after Phase 3 (auth flow regression; auth `SubmitButton` changed in Phase 1).

### Manual Testing Steps:

1. As supervisor, open a project from `/projects`: exposure first, figures readable, over-budget badge when reserved > budget.
2. Edit the project (valid + invalid budget), add a milestone, edit a milestone with an end date outside the project period: each shows the saved/error alert in the right place, buttons show "Saving…".
3. As admin: read-only milestones note, owner select.
4. Set the project to completed: milestone forms disappear, reopen note shows.
5. Keyboard only: tab through the page; every control shows the ring.
6. 390px width: no page-level horizontal scroll outside the milestones table wrapper.

## Performance Considerations

One `client:load` React island per submit button (several MilestoneForms per page = several islands sharing one React runtime chunk). Acceptable at the expected milestone counts; if a project has dozens of milestones, revisit (`client:visible`).

## Migration Notes

No data migration. Visual change on other pages is limited to: body background (hidden under `bg-cosmic`), native control colour scheme, and the auth submit button now using `--primary`.

## References

- Research: `context/changes/ui-projects-panel/research.md`
- Skill contract: `.claude/skills/10x-ui/SKILL.md`
- Existing button: `src/components/ui/button.tsx:7-50`
- Pending pattern being replaced: `src/components/auth/SubmitButton.tsx:12`
- Prior shadcn allowance: `context/archive/2026-09-26-admin-configures-bonus-rules/plan.md:248`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Library — shadcn components and a shared pending button

#### Automated

- [x] 1.1 `npx astro sync && npm run lint` passes — 40f97bc
- [x] 1.2 `npx astro check` passes — 40f97bc
- [x] 1.3 `npm run build` passes — 40f97bc
- [x] 1.4 No file under `src/` imports `@/components/auth/SubmitButton` — 40f97bc
- [x] 1.5 Scan on `src/components/SubmitButton.tsx` returns 0 hits — 40f97bc

#### Manual

- [x] 1.6 `/auth/signin`: valid submit shows disabled "Signing in..."; client-validation failure leaves the button enabled — 40f97bc
- [x] 1.7 `/auth/signup` behaves the same — 40f97bc

### Phase 2: Token values — dark theme on, cosmic look in tokens

#### Automated

- [x] 2.1 `npm run lint`, `npx astro check`, `npm run build` pass — 845cdbe
- [x] 2.2 `grep -nE '#[0-9a-fA-F]{3,8}' src/styles/global.css` returns 0 hits — 845cdbe
- [x] 2.3 Every `--color-*` line inside `@theme inline` uses `var(` — 845cdbe
- [x] 2.4 View scan count on the 4 view files is still 54 — 845cdbe

#### Manual

- [x] 2.5 Background gradient unchanged on `/projects/<id>`, `/projects`, `/dashboard`, `/admin`, `/employees`, `/auth/signin` (before/after screenshots) — 845cdbe
- [x] 2.6 Auth submit button uses `--primary`; text readable — 845cdbe
- [x] 2.7 Native date picker and select popups render dark — 845cdbe
- [x] 2.8 Contrast checks pass and are recorded in `tokens.md` — 845cdbe

### Phase 3: The view — tokens, components, section order

#### Automated

- [x] 3.1 `npm run lint`, `npx astro check`, `npm run build` pass — 98abd7d
- [x] 3.2 Scan on `src/pages/projects/[id].astro src/components/projects/*.astro` returns 0 hits — 98abd7d
- [x] 3.3 No `form-classes` import in `src/components/projects` or `src/pages/projects/[id].astro` — 98abd7d
- [x] 3.4 `npm run smoke` passes — 98abd7d

#### Manual

- [x] 3.5 `/projects/<id>` order exposure → milestones → details; screenshots `p3-{desktop,mobile}.png` — 98abd7d
- [x] 3.6 Save project, add/edit milestone (valid + invalid) work; invalid edit reopens the row with its error — 98abd7d
- [x] 3.7 Admin: owner select present, milestones read-only note — 98abd7d
- [x] 3.8 Closed project: reopen note, no edit forms — 98abd7d
- [x] 3.9 `/projects` create form renders and creates a project — 98abd7d
- [x] 3.10 No React "value without onChange" warning in the dev console — 98abd7d

### Phase 4: States and the visual gate

#### Automated

- [x] 4.1 `npm run lint`, `npx astro check`, `npm run build` pass
- [x] 4.2 Scan on view files + `MilestonesSection.astro` + kitchen sink returns 0 hits
- [x] 4.3 Production preview serves 404 for `/dev/projects-kitchen-sink`

#### Manual

- [x] 4.4 Kitchen sink at 1280px and 390px shows every matrix row or N/A with reason; screenshots saved
- [x] 4.5 Keyboard tab-through shows the ring on every control; `p4-focus.png` saved
- [x] 4.6 Submit shows disabled "Saving…"; back-button return not stuck disabled
- [x] 4.7 Errors sit next to their form, use `destructive`, carry text

### Phase 5: Make it stick — rule, check, deferred charges

#### Automated

- [ ] 5.1 `npm run lint:ui` exits 0
- [ ] 5.2 Injected `text-purple-300` in `BudgetExposurePanel.astro` makes `npm run lint:ui` exit 1 (reverted)
- [ ] 5.3 `npm run lint`, `npx astro check`, `npm run build` pass
- [ ] 5.4 `CLAUDE.md` UI block sits outside the 10x-cli markers

#### Manual

- [ ] 5.5 `CLAUDE.md` UI block names tokens, components, add path, no-literals rule, kitchen sink, `lint:ui`
- [ ] 5.6 `research.md` lists every deferred charge with a reason
