# PL/EN Language Switch — Plan Brief

> Full plan: `context/changes/language-switch-pl-en/plan.md`
> Research: `context/changes/language-switch-pl-en/research.md`

## What & Why

Meritly's UI is almost entirely English, but the product is Polish-first (PLN, Polish KPI names). This change translates every user-facing string into Polish, makes Polish the default, and adds a PL↔EN switch that's reachable from the first page so either language is one click away.

## Starting Point

No i18n exists: `lang="en"` is hardcoded and there's no locale anywhere. About 450 strings sit in roughly 40 views, with as many again in six service catalogs. Errors and notices already travel as codes in the URL and are mapped to text at render time, which gives translation a clean place to plug in. Two spots use English labels as logic, signup passes raw text in the URL, and the e2e and smoke tests check English copy.

## Desired End State

A first-time visitor sees Polish. A **PL | EN** switch in the bottom-right corner of every page (including `/` and sign-in) re-renders the same page in the other language. The choice is kept in a cookie and on the user's profile, so it follows them to a new device after sign-in. Every page, form, error, status label and both emails are translated, with emails in Polish only. `/` becomes a real Meritly landing page.

## Key Decisions Made

| Decision                   | Choice                                         | Why (1 sentence)                                                                                                                 | Source          |
| -------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Where the locale lives     | `lang` cookie, no URL prefix                   | `route-access` matches by prefix with no deny-by-default, so `/pl/...` would bypass the gate                                     | Research        |
| Default language           | Polish when no cookie                          | Matches "translate all to Polish" and the Polish-first product                                                                   | Plan            |
| Persistence                | Cookie + `profiles.locale`                     | The choice should follow the user across devices                                                                                 | Plan            |
| Profile write path         | `security definer` RPC `set_my_locale(text)`   | A self-update policy on `profiles` would let users change `role`                                                                 | Plan (security) |
| Cookie vs profile conflict | Latest choice wins                             | Sign-in saves the cookie to the profile, and a missing cookie is filled from the profile, so a choice is never silently reverted | Plan            |
| Emails                     | Polish only                                    | Employees without accounts have no profile to hold a preference                                                                  | Plan            |
| Number format              | pl-PL in both languages                        | Keeps the decision settled in earlier changes and avoids test churn on amounts                                                   | Research + Plan |
| First page                 | Replace starter Welcome with a Meritly landing | The page that carries the switch shouldn't be boilerplate                                                                        | Plan            |
| Island text                | Plain-string `labels` props                    | Hydrated island props must be serialisable                                                                                       | Plan            |

## Scope

**In scope:**

- i18n module (typed `pl`/`en` dictionaries, resolution rule, `format`, Polish plurals)
- Middleware `locals.locale`, `POST /api/locale`, sign-in sync, `<html lang>`, the `LanguageSwitch`
- Migration (`profiles.locale` and `set_my_locale`) with RLS guard and matrix cells
- Every page, component and island, the service catalogs and load errors, status/role/invite labels
- Signup moved to error codes; the two label-as-logic spots fixed
- Polish invite and approval emails
- Test updates and a new switch e2e spec; CLAUDE.md conventions

**Out of scope:** URL prefixes, `Accept-Language` detection, per-recipient email language, English number formats, the middleware 403/503 text, the kitchen sink's own strings, user data, the KPI names, SQL exception text, and saving the language to the profile on invite acceptance.

## Architecture / Approach

`src/lib/i18n/` (pure) → middleware resolves `cookie → profile → "pl"` into `locals.locale`, filling a missing cookie from the profile → pages and components call `getMessages(Astro.locals.locale)` → service resolvers take `locale` → islands get string labels. The switch is a no-JS form POST to `/api/locale`. That endpoint sets the cookie, saves to the profile via the RPC when signed in, and redirects to `safeNext(next)`.

## Phases at a Glance

| Phase                          | What it delivers                                                                      | Key risk                                               |
| ------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 1. Locale foundation           | Locale plumbing, migration + RPC + RLS tests, switch endpoint and UI                  | The RPC's scope must be exactly "own row, locale only" |
| 2. First page, shell and auth  | Landing, Topbar/Layout/dashboard, auth pages and islands, signup codes, e2e auth text | Island props must stay serialisable                    |
| 3. Service catalogs and labels | Locale-aware catalogs, load-error codes, shared status labels, label-as-logic fixes   | Resolver signature change touches every caller         |
| 4. Feature views               | Projects, milestones, employees, admin, history, my-bonuses; smoke and us-01 on PL    | Missed strings; long Polish labels breaking layout     |
| 5. Emails, switch e2e and docs | Polish emails, `language-switch.spec.ts`, CLAUDE.md i18n rule                         | The hosted invite template needs a manual update       |

**Prerequisites:** local Supabase running (`npx supabase start`), `.dev.vars` with `E2E_*`, and `supabase functions serve` for Phase 5.
**Estimated effort:** about 4–6 sessions. Phases 2 and 4 are mostly bulk translation.

## Open Risks & Assumptions

- The Polish wording is agent-written using the glossary in the plan. A native-speaker review happens in the manual steps of Phases 2 and 4.
- Tests now check Polish dictionary text, so changing the wording later means updating the tests in the same diff.
- Rolling back the migration alone breaks the middleware's profile select. App and migration roll back together.
- The production invite email stays English until someone updates the hosted dashboard template.

## Success Criteria (Summary)

- A new visitor sees Polish everywhere, and one click on the first page switches the whole app to English and back.
- The chosen language survives navigation, sign-in and a new device (via the profile).
- No English remains in PL mode except user data, the KPI names and the out-of-scope items, and all suites (unit, pgTAP, smoke, integration, e2e) are green.
