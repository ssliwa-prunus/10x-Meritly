<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: PL/EN Language Switch

- **Plan**: context/changes/language-switch-pl-en/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-10-13
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | WARNING |

Success criteria re-run during review (HEAD 7ecfa7c, fresh build 22:04):

| Check              | Result                                                        |
| ------------------ | ------------------------------------------------------------- |
| `astro check`      | 0 errors                                                      |
| `npm test`         | 359 passed                                                    |
| `lint` / `lint:ui` | clean                                                         |
| `supabase test db` | PASS (682 tests)                                              |
| `test:e2e`         | 4 passed                                                      |
| `smoke`            | 2 steps failed, both `employee2 /my-bonuses`; F3 explains why |

Integration passed in Phase 5 (7/7). All manual Progress rows are checked, and the user confirmed each phase.

## Findings

### F1 — Smoke `lang="pl"` / `lang="en"` needles can never fail

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: scripts/smoke.mjs (locale steps "home is Polish without a cookie" / "home is English with lang=en")
- **Detail**: The steps assert `htmlIncludes: ['lang="pl"']`, but `LanguageSwitch.astro:32` renders `lang={option.value}` on both buttons. Every page therefore contains both `lang="pl"` and `lang="en"`, whatever `<html lang>` is. The PL step proves nothing. The EN step is saved only by its extra EN landing-text needle. The plan intended these steps to prove `<html lang>`.
- **Fix**: Match `<html lang="pl"` and `<html lang="en"` (the opening tag), and add a PL landing-text needle to the default step.
- **Decision**: FIXED — anchored to `<html lang=…` and added PL landing-text needle (scripts/smoke.mjs)

### F2 — Sign-in saves a cookie that may not be an explicit choice

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/signin.ts:27-35 (with src/middleware.ts:40-49, src/pages/api/auth/signout.ts)
- **Detail**: At sign-in, any valid `lang` cookie is written to the profile as "the latest choice". The cookie is not always a choice, though: the middleware also writes it from the profile, and sign-out never clears it. On a shared browser, user A's language therefore gets saved into user B's profile when B signs in. Separately, an old cookie on one device overwrites a newer choice made elsewhere. The impact is low, since only the UI language changes and the user can switch back, but it breaks the plan's "latest explicit choice wins" rule.
- **Fix A ⭐ Recommended**: Clear the `lang` cookie in `api/auth/signout.ts`.
  - Strength: One-line change. It closes the cross-user leak on shared browsers, and the next sign-in restores each user's own language from their profile.
  - Tradeoff: After signing out, the visitor sees the Polish default even if they chose EN. The stale-cookie-on-another-device case remains, which arguably still counts as "a choice made on this device".
  - Confidence: HIGH — the signout route is trivial and the middleware restore path is unit-tested.
  - Blind spot: Users who close the browser without signing out keep the cookie (same as today).
- **Fix B**: Tell an explicit cookie from a restored one (for example, the middleware sets a `lang_src=profile` marker), and skip the sign-in write for restored cookies.
  - Strength: Implements "latest explicit choice" exactly, for both the shared-browser and the multi-device case.
  - Tradeoff: Adds a second cookie and more state to reason about and test. The switch endpoint must clear the marker.
  - Confidence: MED — more moving parts, and needs new unit and smoke coverage.
  - Blind spot: Interaction with cookies issued before the fix.
- **Decision**: FIXED via Fix A — signout.ts deletes the `lang` cookie; smoke signout step asserts it is cleared

### F3 — Smoke `/my-bonuses` exclusion collides with the grand total once e2e fixtures pile up (existed before this change)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: scripts/smoke.mjs:251-266 (`bodyExcludes: [OTHER_BONUS]`)
- **Detail**: During review, smoke failed `employee2 /my-bonuses shows only own Approved line` and `…ignores injected ids`. The page was correct. Employee2 had 5 leftover approved US-01 lines (840 zł each, one per e2e run), so the grand total "Razem za …" was 400 + 5 × 840 = "4 600,00 zł". After whitespace normalisation that contains the excluded needle "600,00 zł". The grand total already existed at aa3a917 ("Total across"), so this fragility was there before this change. After a sixth e2e run (total 5 440,00 zł) every needle passes. CI is unaffected because it starts from a fresh database.
- **Fix**: Anchor the exclusion so it can't match a longer amount (for example a regex with a non-digit boundary before "600,00 zł"), or check line rows only. Otherwise document `npx supabase db reset --local` before running smoke locally.
- **Decision**: SKIPPED

### F4 — No automated proof that the profile is written at sign-in and restored from the profile

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: tests/e2e/language-switch.spec.ts
- **Detail**: pgTAP proves `set_my_locale`, and unit tests prove `resolveLocale`. The end-to-end path is only covered manually (1.8): sign in with a cookie → profile written → new browser with no cookie → language restored. The e2e test would still pass if the sign-in RPC failed, because the cookie keeps the page in English and the failure is only logged.
- **Fix**: In `language-switch.spec.ts`, after signing in with EN, open a second context with no cookies, sign in as the same user, and expect English (`html[lang=en]` plus the EN pitch). Then reset to PL as today.
  - Strength: Closes the only untested cross-boundary path (Worker → RPC → profile → middleware restore) in a test that already does the setup.
  - Tradeoff: About 10 more lines and one more sign-in in that spec.
  - Confidence: HIGH — follows the existing spec's patterns.
  - Blind spot: A parallel race on the shared seed profile is already handled by the `lang=pl` pins in the other specs.
- **Decision**: SKIPPED

### F5 — Deploy order: the Worker needs `profiles.locale` before it goes live

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:26; README.md production runbook
- **Detail**: The middleware now selects `locale`. If the Worker is deployed before `20261013120000_profiles_locale.sql` is pushed to the hosted database, every signed-in request gets `profileError`, and role-gated routes return 503. The plan's Migration Notes cover rollback order only; deploy order isn't written down anywhere.
- **Fix**: Add a line to the README deploy runbook and to the change notes: push the migration (`supabase db push`) before `wrangler deploy`.
- **Decision**: SKIPPED

### F6 — `/api/locale` returns 500 on a body that isn't a form

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/locale.ts:16
- **Detail**: `await context.request.formData()` isn't wrapped. The feature routes use `parseForm` (`src/lib/forms.ts:33-34`), which catches a malformed body. `signin.ts` has the same gap, which existed before this change.
- **Fix**: Wrap `formData()` in try/catch (or reuse the `parseForm` pattern) and redirect to `/` on failure.
- **Decision**: FIXED — formData() guarded, redirect to / on a malformed body; smoke step added

### F7 — `html` locator in the switch spec is an undocumented exception to the locator rule

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/e2e/language-switch.spec.ts:28,34
- **Detail**: `page.locator("html")` is a tag locator. CLAUDE.md forbids CSS/DOM locators, but no role exists for `<html lang>`, so the exception is justified. It just isn't explained in the code.
- **Fix**: Add a one-line comment explaining why `<html lang>` is checked through `page.locator("html")`.
- **Decision**: FIXED — comment documents the html-locator exception

### F8 — Polish plural boundaries 12 and 25 missing from unit tests

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/i18n/**tests**/i18n.test.ts:65-71
- **Detail**: The plan's Testing Strategy lists the boundaries 1, 2, 4, 5, 12, 22 and 25; the test covers 1, 2, 4, 5 and 22. Case 12 ("12 znaków", many, despite ending in 2) is the classic Polish plural trap.
- **Fix**: Add cases 12 → many and 25 → many.
- **Decision**: FIXED — 12 and 25 cases added
