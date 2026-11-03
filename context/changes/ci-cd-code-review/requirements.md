## Overall concept

- GHA workflow run for every new pull request to master
- composite action for the review itself so that main workflow is easy to reason about

## Input parameters

- pull request title
- pull request description (?? cost tradeoff)
- git diff

## Code Review Criteria

Each criterion is graded 1-10, where a higher score is always better (for complexity, 10 = simple).

1. **Implementation correctness** - does the code do what the change intends, including edge cases and error paths?
   - 1: clearly broken; wrong logic, crashes or data loss on the main path.
   - 10: behaves correctly on the main path and in edge cases; no defects visible in the diff.
2. **Idiomaticity** - does the code follow the conventions of the language, framework and this repository?
   - 1: ignores project conventions and reinvents what the stack or existing helpers already provide.
   - 10: reads like the rest of the codebase; uses established patterns, helpers and naming.
3. **Complexity** - is the solution as simple as the problem allows (size, nesting, indirection, coupling)?
   - 1: convoluted or over-engineered; hard to follow, with deep nesting or needless abstraction.
   - 10: minimal and clear; a new reader grasps it quickly and nothing is superfluous.
4. **Test / risk coverage** - do tests (or other safeguards) cover the changed behaviour and its riskiest paths?
   - 1: risky changes ship with no tests, or the tests cannot fail.
   - 10: new and changed behaviour, edge cases and failure modes are covered by meaningful tests.
5. **Documentation** - are non-obvious decisions, public interfaces and user-facing changes explained where readers will look?
   - 1: behaviour or interface changes are undocumented, or existing docs/comments are now wrong.
   - 10: docs, comments and config notes are accurate and explain the "why" without restating the code.
6. **Security and safety** - does the change avoid vulnerabilities and unsafe behaviour (access control, input handling, secrets, data exposure)?
   - 1: introduces an exploitable flaw, leaks secrets or bypasses access control.
   - 10: validates inputs, respects access boundaries and handles secrets and data safely; no new risk surface.

## Parked for later

- business alignment (require broader context)
- architectural fit (require broader context)

## Expected side-effects

- PR comment with summary
- labels: 'ai-cr:failed' (red) OR 'ai-cr:passed' (green)

## Expected behavior

- on-demand retry when label 'ai-cr:review' is added
