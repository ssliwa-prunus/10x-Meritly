---
name: 10x-ui
description: >
  Audit and improve ONE view that already renders, as a normal 10x change with a
  design-system contract — audit into 3–5 charges (missing tokens, missing shared
  component, accidental architecture), fix the contract before the pixels, cover a
  7-state matrix, gate with a screenshot, and leave a rule so the next agent keeps
  using the tokens and components. The UI entry to /10x-research → /10x-plan →
  /10x-implement, sharing the same change folder and Progress. Use when the user wants
  a theme, a restyle, "make it prettier", shadcn/Tailwind work, design tokens, dark
  mode, a visible-focus pass, or cleanup of UI an agent built feature by feature. Not a
  generator for a view that does not exist yet, not a component catalog, not a
  Playwright course.
argument-hint: "<change-id> | <route or view file>"
---

# 10x-ui — design-system contract for a single visual change

UI is a normal 10x change. Do not open a vibes chat on the CRUD thread, and do not start
from a prompt that says only "make it nicer".

**This skill iterates on UI that is already there.** It assumes a view you can open and
screenshot: the markup renders, the data flows, the screen does its job and just is not good
enough. Producing that first view is ordinary feature work for the Core Skills Chain; this
skill picks up the moment it is on screen.

It does not replace the chain. It opens the change, runs the audit brief through
`/10x-research`, shapes the plan `/10x-plan` writes, and adds UI checks to each
`/10x-implement` phase. Those skills keep their own contracts — same `plan.md`, same
`## Progress`, same commit ritual.

Target: `$ARGUMENTS`

If `context/foundation/lessons.md` exists, read it once for recurring UI failures in this repo.

## When to run it — and on which view

- **When:** after the first vertical slice renders with real data — the core flow works end
  to end, and it looks like it was built feature by feature. Earlier, there is nothing to
  audit; much later, every new view copies the drift. The best moment is before the second
  or third view, so they inherit the contract instead of the literals.
- **Which view:** the one users hit most in the core flow (the list/dashboard after login,
  not the settings page). A landing page counts only if it already exists and is the
  change you care about — it gets its own change, not a ride-along.
- **Not now:** a view that does not exist yet (build it through the ordinary chain, then come
  back), a whole-MVP rebrand, parallel agents or `/goal` for throughput (a later lesson), a
  design-tool file as the only source of truth (this skill works from the running app).

## On invocation

1. **Resolve the target.**
   - `context/changes/<arg>/` exists → that change; read `change.md` and any `research.md`
     and `plan.md`, then resume at the first router step not yet done.
   - A route or a view file → the view to audit. Suggest a change-id and copy
     `/10x-new <change-id>` to the clipboard; in `change.md` name **one** view and the token
     source (or motif) this change works against.
   - No argument → ask which view, with the guidance above, and stop until answered.
   - Refuse `context/archive/` paths: "This change is archived. Open a new change with
     `/10x-new` instead."
2. **Pre-audit (minutes, not research):** locate the value source, the shared components
   directory, the agent rules file(s) (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*`,
   `.windsurfrules`, `copilot-instructions.md`), and run the hardcoded-value scan below on
   the view's files. Report the counts — they tell you which contract variant applies.
3. **Hand off to `/10x-research`** with the audit brief from _The audit_ below; copy the
   command to the clipboard. The charges land in `research.md` under `## Charges`.

> **Clipboard.** Pipe the exact command to `pbcopy` / `clip.exe` / `xclip -selection
clipboard` / `Set-Clipboard`, fall back silently if none exists, then print it on its own
> line suffixed with `(✓ copied)`.

## Router

1. `/10x-new <change-id>` — one view, one token source or motif.
2. `/10x-research <change-id>` — the two-way audit below. Output: `## Charges` in `research.md`.
3. `/10x-plan <change-id>` — phases in this order: **environment/library → token values →
   one view → states**. Each charge maps to a phase or is listed as deferred. The states
   phase carries the 7-state matrix as its success criteria.
4. `/10x-implement <change-id>` phase by phase. After every visual phase: screenshot at
   desktop and one mobile width, and re-run the hardcoded-value scan on the view.
5. **Visual gate** — kitchen sink or `toHaveScreenshot` on that one view.
6. **Leave a guard** — the rule (and, if the repo has a linter, the check) that keeps the next
   agent on the contract. See _Make it stick_.
7. `/10x-impl-review` — UI findings are not "cosmetic skip" by default. Then the review loop.

## The audit: three categories of charge

Before any CSS, walk the view and write **3–5 charges**. Each charge gets a **file and
line**, and **one sentence about the effect on the user**. A charge list is the input to the
plan; "make it nicer" is not.

The audit runs in **two directions**:

- **Source → views.** Where do the values live, where do shared components live, and which
  views actually read them? Count usages of token classes/variables and imports from the
  components directory per view. A token file nothing reads is a finding, not a baseline.
- **View → source.** For every literal in the view, which token or component should have
  covered it? That is the charge's evidence.

Also read the agent rules file(s) for UI instructions. A rule that tells the agent to use
one-off values (e.g. "use arbitrary values like `w-[123px]` for precise designs") is an
accidental-architecture charge: it is why the views drifted, and it will undo the fix.

| Category                     | What it looks like                                                                                                                                                                                                                      | Evidence to record                                                               | Typical fix                                                                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Missing tokens**           | literal colours in the view — hex/rgb/oklch, and on Tailwind **palette classes** (`bg-blue-900`, `text-purple-200`, `from-indigo-900`) and arbitrary values (`p-[13px]`); three shades of the same "primary"; spacing invented per file | file:line of the literal, plus the token that should have covered it             | move the value into this repo's token source and reference it by role (`bg-primary`, `text-muted-foreground` in the Tailwind variant) |
| **Missing shared component** | a second `Button` built from `div`+classes, a card that copies a DS card, copy-pasted form field                                                                                                                                        | file:line of the duplicate, plus the component it shadows (or the one to add)    | import the real component, or add it through the stack's own path (e.g. `npx shadcn add <name>`)                                      |
| **Accidental architecture**  | the screen mirrors the order features were added: unauthenticated route returning raw JSON, a modal that is a page, a "settings" tab holding four unrelated things, an agent rule that invites one-off styles                           | the route/component/rule path, plus what the user sees when they arrive that way | fix the entry point (guard, redirect, layout) or the rule, not the colour                                                             |

The third category is the hardest to see on a screenshot and the easiest to skip. Ask
explicitly: _what happens if someone reaches this view logged out, with no data, or straight
from a link?_

Charges the plan does not address stay in `## Charges` marked **deferred** with a reason —
not deleted.

### Hardcoded-value scan

A candidate list, not a verdict — each hit is a possible missing-token charge. Run it on the
view's files (never on the token source itself), in the pre-audit and after each visual phase:

```bash
grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|-\[[0-9.]+(px|rem)\]|\b(bg|text|border|ring|outline|from|via|to|fill|stroke|shadow|divide)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b' <view files>
```

Non-Tailwind stacks: keep the colour-function part, drop the palette-class part, and add
the stack's own literal form (a hex inside a styled-component, a colour in a `sx` prop).
The count should drop phase by phase; a count that goes up is a regression.

## Design-system contract

The contract has two halves, and neither names a tool:

1. **Semantic tokens** — one source of values, with names describing the **role** (`primary`,
   `surface`, `muted`, `destructive`), never the colour (`purple-600`).
2. **Importable components that live in the repo** — readable by the agent, not a black-box
   dependency it can only guess at.

Without both, the agent reinvents primitives on every view. With both, it has somewhere to look.

| Stack                                                                  | Where the values live                                                  | Where the components live                                          |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Tailwind v4 + shadcn/ui** (the course variant)                       | `:root` / `.dark` in CSS, published through `@theme` / `@theme inline` | copied into the repo, usually `src/components/ui`                  |
| **CSS Modules / plain CSS variables**                                  | a variables file (`:root`, often `theme.css` / `variables.css`)        | a shared components directory, imported by path                    |
| **CSS-in-JS with a theme** (styled-components, vanilla-extract, Panda) | a theme object or `.css.ts` token file                                 | styled primitives exported from one module                         |
| **Component library with a theme** (MUI, Chakra, Mantine)              | the library's theme/config object, extended in your code               | the library's components, wrapped locally where you customise them |

Tailwind detail: `:root` / `.dark` hold the **values**, `@theme inline` **publishes** them as
`--color-*`, and only then does `bg-primary` exist. Raw colours written straight into
`@theme inline` are the classic dark-mode break — the `.dark` values are there, the toggle
does nothing. Other stacks have their own version of this split; find it before you edit.

Pick the variant that matches the repo and write it into `change.md`:

- **Existing design system** — read its value source, shared components and design notes
  before you propose anything. Extend it; do not fork a second palette or run a second
  `shadcn init`. An existing, worse system beats a better one you bring in.
- **Fresh starter with a dead token file** — the most common greenfield case: the starter
  ships tokens and one or two components, the screens use literal classes. Phase 1 is not
  choosing a theme; it is making the existing view read the tokens already there. Only then
  are new values worth choosing.
- **No design system** — introducing the contract **is** the change. Propose it under three
  conditions stated in `change.md`: (1) marked as adding a dependency — the learner decides;
  (2) scoped to a token block plus the 2–3 components this view uses, not a whole library;
  (3) it loses to anything the repo already has.
- **Named motif or preset** — map its values onto the existing variable names; keep the count
  small (primary, surface, border, muted, destructive, plus radius and spacing scale).

Whatever the source of the values, **deposit them in the repo**: the raw values in a file in
the change folder, plus a line naming where they came from next to the block you edited.
Values that live only in a chat window are values the next session will invent again.

Adding a component: use the stack's own path — `npx shadcn add <name>` (or shadcn MCP if
already configured) in the course variant. Do not require `mcp init` to finish the change.

## Definition of done: the 7-state matrix

The states phase is done when every cell is **shown** (in the kitchen sink) or marked
**N/A with a reason** — not when the happy path looks right.

| State         | What to check                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------ |
| default       | built from tokens and repo components only                                                       |
| hover         | visible change, token-driven                                                                     |
| focus-visible | keyboard focus visible on every control; own token (`--ring` in shadcn), not the browser default |
| disabled      | looks and behaves disabled, still readable                                                       |
| error         | message next to the field/action, `destructive` token, not colour alone                          |
| empty         | no data: a real empty state, not a blank frame or raw JSON                                       |
| loading       | skeleton or spinner; no layout jump when data arrives                                            |

`disabled`, `error` and `focus-visible` drift first, because nothing in the happy path
exercises them. Moving the accent does not move the focus token — review it separately.

Floor, not a WCAG course: every control has an accessible name, and contrast on token changes
survives both themes if the app has dark mode. Dark mode changes at the token layer; a
dark-mode pass that edits component classes is the missing-tokens charge in disguise.
Desktop plus **one** mobile width — not a responsive matrix.

## Visual gate

One view, every state visible at once. The cheapest form needs no test runner: a
**kitchen-sink page** rendering the view in all seven states side by side, screenshotted at
desktop and one mobile width. It doubles as review evidence and works on any stack.

If the repo already has a screenshot-testing tool, wire the gate into it — e.g.
`await expect(page).toHaveScreenshot({ maxDiffPixels: 100 })` with Playwright, masking
volatile regions (dates, avatars, counters). Do not install one to satisfy this skill.
Never update a baseline to make CI green without explaining the visual delta first.

## Make it stick

The fix lasts one session unless the next agent is told where to look. Before the review:

1. **Rule.** Add a short UI block to the repo's agent rules file (the one the pre-audit found;
   extend it, do not create a second one; write it **outside** the
   `<!-- BEGIN @przeprogramowani/10x-cli -->` … `<!-- END … -->` block, which the CLI rewrites
   on every `get`): where the tokens live, where the components live,
   "check `<components dir>` before creating a component; add missing ones via
   `<stack's path>`", "no literal colours or arbitrary values in views — use tokens", and
   where the kitchen sink lives. Remove or rewrite any rule that invites one-off values.
2. **Check.** If the repo already has a linter or a pre-commit hook, add the hardcoded-value
   scan (or the linter's own rule for it) scoped to the views this change cleaned — a
   failing check beats a rule the agent forgot. A new lint dependency follows the same three
   conditions as a new design system: proposed, scoped, and the learner decides.
3. **Docs as context.** If the repo has Storybook or component docs, point the rule at them
   instead of repeating them.

## Review loop: from charge to PR

A view can be technically correct and still unreadable — heading competing with the primary
button, every piece of information at the same weight, each small thing in its own card.
Judge layout **after** the view is built from tokens and repo components; on a screen glued
together from one-off classes, layout criticism collapses into cosmetic tweaks.

1. Get the critique: `/10x-impl-review`, plus an optional layout pass (Impeccable,
   `frontend-design`) if the learner has it installed. Do not vendor those tools into the repo.
2. Triage each finding by **effect on the user**: a missing focus ring or a dead tab deserves
   as concrete a decision as a logic bug.
3. Fix, or record the finding as deferred with a reason. Silence is not triage.
4. Re-run the visual gate. A finding that changed the view without changing the baseline is a
   warning sign.

Merge checklist: [`ui-quality-checklist`](references/ui-quality-checklist.md). Green CI alone
is not the gate — a screenshot test passes happily on a view whose `disabled` state was never
rendered.

## Model routing (phase first, availability second)

No specific model is required; the work needs **vision** (read a screenshot) and **tool use**.
Route by phase: the strongest model you have for audit, plan and review (a wrong call there
costs a dozen edits in the wrong direction; for review, ideally not the one that wrote the
code); a cheaper working tier for implementing charges in the render → compare → fix loop.
Escalate only when the **same charge survives two rounds**. One model for everything is fine —
the split changes the bill, not the method. No vision at all? Render the kitchen sink,
describe the states in text, keep the screenshot gate in CI.

## Hard rules

- No prompt that is only "make it nicer / prettier".
- Every charge carries file, line and user impact before it enters the plan.
- Colours, type, radius, spacing: a token from **this repo's** system, not a literal in the view.
- Reuse an existing component or add one through the stack's own path; never a second `Button`.
- One view plus global tokens per change. Not a whole-MVP rebrand.
- The change ends with a rule in the agent rules file, not only with a nicer screenshot.

## Failures to refuse

| Smell                                                                            | Do this instead                                   |
| -------------------------------------------------------------------------------- | ------------------------------------------------- |
| Default purple/blue gradient "AI landing"                                        | Change `--primary` / theme tokens first           |
| New primitive `div`+CSS that copies a DS component                               | Import the real component                         |
| "Selected" tab that is only CSS, not clickable                                   | Wire the state                                    |
| Unauthenticated or empty-state entry that dumps raw JSON / a blank frame         | Fix the entry point; it is an architecture charge |
| `shadcn init` (or equivalent) on a repo that already ships tokens and components | Extend the first system                           |
| Updating a screenshot baseline to make CI green                                  | Explain the visual delta; update only if intended |
| "Fix the design" as one agent task on the CRUD thread                            | New change folder, audit, plan, gate              |

## Playbooks

All of them keep the charge list.

- **Theme or restyle of one view** — the default path, start at tokens.
- **Inherited agent slop** — expect all three categories; fix tokens and the shared component
  before touching layout, and check the agent rules file for the instruction that caused it.
- **Single component** — skip the token phase only if its values already come from tokens.
- **Dark mode** — token layer, both themes in the kitchen sink, contrast check in the gate.
- **Focus/keyboard pass** — the states phase carries it: focus-visible, control names, tab order.
