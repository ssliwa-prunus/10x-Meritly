# Review follow-ups: new-landingpage-view

Source: `context/changes/new-landingpage-view/reviews/impl-review.md`

## F5: widen the UI literal guard's arbitrary-value check

- **Where**: `scripts/check-ui-literals.mjs:30-31` (the `LITERAL` regex).
- **Problem**: The arbitrary-value branch only matches `-[<number>px|rem]`. Other arbitrary values that CLAUDE.md also forbids pass the guard, for example `w-[58%]`, `text-[clamp(2rem,4vw,3rem)]` and `ring-[3]`.
- **Proposed fix**: Match any Tailwind arbitrary value `-[…]`, with exclusions as needed for:
  - CSS-variable forms (`-[--x]`, `-[var(--x)]`), if the team wants to allow them
  - non-class text, such as prose or regex in `.ts`
- **Scope**: A separate change (`/10x-new`), because tightening the guard re-checks every view in `CLEAN_PATHS` and may surface existing hits that need migrating first.
- **Verify**: `npm run lint:ui` passes on the current views, and a deliberately added `w-[58%]` in a clean view fails it.
