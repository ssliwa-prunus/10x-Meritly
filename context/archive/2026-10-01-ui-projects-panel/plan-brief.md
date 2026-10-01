# Project detail view on the design-system contract — Plan Brief

> Full plan: `context/changes/ui-projects-panel/plan.md`
> Research: `context/changes/ui-projects-panel/research.md`

## What & Why

`/projects/[id]` is where a supervisor checks a project's budget exposure and manages its milestones. It was built feature by feature from palette literals: 54 hardcoded-value lines across its 4 files, 0 token classes, 0 shared components, so every restyle or contrast fix is a hunt through files and the next view copies the drift. This change puts the view on the repo's existing shadcn tokens and components, fixes its focus/pending/error states, and leaves a rule and a check behind.

## Starting Point

`src/styles/global.css` ships shadcn's default neutral tokens and a `.dark` set that nothing applies; the dark "cosmic" look comes from literals and a hex `bg-cosmic` utility. `src/components/ui/` holds only `button.tsx`. Forms are server-rendered `.astro` with shared class strings (`form-classes.ts`).

## Desired End State

The app runs with `<html class="dark">` and `.dark` values that reproduce today's look. `/projects/[id]` uses only token classes and `ui/` components (scan: 0), shows budget exposure first, gives every control a visible focus ring and every submit a disabled "Saving…" state. A dev-only kitchen sink shows all 7 states; `CLAUDE.md` and `npm run lint:ui` keep the next agent on the contract.

## Key Decisions Made

| Decision        | Choice                                                                                                                  | Why (1 sentence)                                                       | Source          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------- |
| Theme mechanism | `class="dark"` on `<html>`, retune `.dark`                                                                              | Uses the split shadcn ships, so `dark:` variants in components fire    | Plan            |
| `bg-cosmic`     | Rebuild from tokens (`--background`, new `--background-accent`)                                                         | 13 pages keep their look; hex leaves the utility                       | Plan            |
| Shared files    | Migrate the view's 4 files (incl. `ProjectForm`, so `/projects` create form changes); defer `form-classes.ts`, `Topbar` | One view plus global tokens per change                                 | Research → Plan |
| Success colour  | New `--success` / `--success-foreground`                                                                                | A save stays a distinct positive signal, reusable elsewhere            | Plan            |
| Pending state   | Generalise `SubmitButton` into a shared island with a native-submit hook                                                | Real disabled state, no double submit, existing pattern                | Plan            |
| C5 page order   | Reorder sections only (exposure → milestones → details); defer the in-table edit forms                                  | Figures first at low structural risk                                   | Plan            |
| Selects         | shadcn `native-select`                                                                                                  | Stays a native `<select>`, no JS                                       | Plan (Context7) |
| Visual gate     | Dev-only kitchen-sink page + manual screenshots                                                                         | No Playwright/Storybook in repo; skill forbids installing one for this | Research        |

## Scope

**In scope:**

- shadcn `card badge input label textarea native-select alert table`; shared `SubmitButton` + `useFormPending`
- Dark theme on globally; `.dark` values; `--success`, `--success-foreground`, `--background-accent`; token-based `bg-cosmic`
- `[id].astro`, `ProjectForm`, `MilestoneForm`, `BudgetExposurePanel`, new `MilestonesSection`
- Kitchen sink `/dev/projects-kitchen-sink`; `CLAUDE.md` UI block; `scripts/check-ui-literals.mjs` in lint-staged + CI

**Out of scope:**

- `form-classes.ts` and its 8 other importers; `Topbar.astro`; other `bg-cosmic` pages' literals
- Milestone edit forms inside table rows (C5 mobile half); raw-text 403 in middleware
- New test tooling or lint dependencies; light-theme toggle; any data/API/RLS change

## Architecture / Approach

Values first, then classes: Phase 2 changes token values globally without touching any view class, so other pages stay visually the same (except the auth button, which now reads `--primary`). Phase 3 swaps the view's literals for token classes and statically rendered shadcn React components (`defaultValue`, no hydration); only submit buttons hydrate, as `client:load` islands whose hook listens for native `submit` at `document` level so React-side validation that cancels the submit is respected.

## Phases at a Glance

| Phase            | What it delivers                                                                | Key risk                                                  |
| ---------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1. Library       | shadcn components, shared `SubmitButton` + `useFormPending`, auth forms updated | Pending fires on a cancelled auth submit (listener order) |
| 2. Token values  | Dark theme on, cosmic look in tokens, `tokens.md`                               | Other pages shift visually; contrast of muted text        |
| 3. The view      | 4 files on tokens/components, `MilestonesSection`, new section order; scan 0    | Row-error `<details>` opening or form field names regress |
| 4. States & gate | Focus/hover/disabled/error/empty covered; kitchen sink; screenshots             | Kitchen sink leaking into production                      |
| 5. Make it stick | `CLAUDE.md` UI block, `lint:ui` in lint-staged + CI, deferred charges recorded  | Rule written inside the CLI-managed block                 |

**Prerequisites:** local Supabase (`npx supabase start`) with a supervisor, an admin and a project with milestones for manual checks; `npm run smoke` setup.
**Estimated effort:** ~1–1.5 days across 5 phases.
