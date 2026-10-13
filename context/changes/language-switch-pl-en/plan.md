# PL/EN Language Switch Implementation Plan

## Overview

Translate every user-facing string in Meritly into Polish and add a PL↔EN switch that's available on every page, including the first page (`/`) and `/auth/signin`. Polish is the default. A choice is remembered in a `lang` cookie and in `profiles.locale`, and the latest explicit choice wins. Numbers stay pl-PL in both languages. Both emails become Polish only. The starter Welcome page is replaced by a real Meritly landing page.

## Current State Analysis

Grounded in `context/changes/language-switch-pl-en/research.md`.

- **No i18n exists.** `astro.config.mjs` has no `i18n` block, there's no package for it, `src/layouts/Layout.astro:14` hardcodes `lang="en"`, and `App.Locals` (`src/env.d.ts:2-9`) has no locale field.
- **About 450 English strings** sit in about 40 `.astro`/`.tsx` files. About as many again live in six service catalogs (`src/lib/services/{projects,employees,engagements,payouts,bonus-config,approvals}.ts`) plus `src/lib/set-password.ts`.
- Some text is already Polish: the config banner (`Layout.astro:22-33`, `config-status.ts:15`), the KPI labels Termin/Budżet/Jakość/Ryzyko, and the seeded job-role names.
- **Errors and notices already travel as codes in the URL** (`?error=`, `?saved=`, `?notice=`) and are resolved at render time (`projects.ts:63-67`). The exceptions are:
  - `src/pages/api/auth/signup.ts:11,16`, which passes free text;
  - six `mapLoadError` functions (`projects.ts:252-256` and its siblings), which return English strings.
- **Statuses are rendered as raw enum values** using CSS `capitalize` (`projects/index.astro:129`, `MilestonesSection.astro:71,119-124`, `[milestoneId].astro:137,152,235-237,323-324`, `ProjectForm.astro:78`, `MilestoneForm.astro:52`). No label map exists.
- **Two places use a label as logic:**
  - `BudgetExposurePanel.astro:49` (`figure.label !== "Budget"`);
  - `PayoutSection.astro:19,76` (`UNSCORED = "Enter KPI scores"` is also used as a sentinel).
- **Routing:** `decideAccess` uses `startsWith` matching with no deny-by-default (`src/lib/route-access.ts:8-9,49-50,81`). That rules out a URL prefix, so the locale goes in a cookie.
- **`profiles`** has columns id, email, display_name, role and created_at, and no self-update policy; only `profiles_update_admin` exists (`20260925120000_role_and_rls_scaffold.sql:98-121`). A self-update policy would let a user change their own `role`.
- **The catalog guard allowlists definer functions by signature** (`supabase/tests/rls_catalog_guard.test.sql:179-199`).
- **Tests that check English text:**
  - `tests/e2e/auth.setup.ts:17-24`;
  - `tests/e2e/seed.spec.ts:20-35`;
  - `tests/e2e/us-01-…spec.ts:150-160`;
  - `scripts/smoke.mjs` (`:30`, `:248-274`);
  - `src/lib/services/__tests__/approvals.test.ts:141`.
- **Emails:**
  - `supabase/templates/invite.html` with its subject at `supabase/config.toml:232`. The production template is configured in the Supabase dashboard.
  - `supabase/functions/notify-milestone-approved/index.ts:42-43,109-147`.
  - Both are English.

## Desired End State

- A visitor with no cookie sees the whole app in Polish, with `<html lang="pl">`.
- A compact **PL | EN** switch, rendered by `Layout.astro`, is visible on every page, including `/` and `/auth/signin`. Clicking it re-renders the same page (same path and query) in the other language.
- **Persistence:**
  - The choice is kept in a `lang` cookie (one year).
  - When the user is signed in, the switch also saves it to `profiles.locale`.
  - Signing in with a cookie present saves the cookie's language to the profile.
  - A signed-in request without a cookie gets the cookie set from `profiles.locale` when that column is set.
- **Every user-facing string has a Polish and an English version:** pages, components, islands (labels, placeholders, aria-labels, client-side validation), service catalogs, load errors, status/role/invite labels and page titles. The two exceptions are listed in "What We're NOT Doing".
- Money, percent and multiplier formatting are unchanged (pl-PL) in both languages.
- The invite email and the approval email are Polish.
- `/` is a Meritly landing page.

Verify with `npx astro check`, `npm test`, `npm run lint:ui`, `npx supabase test db`, `npm run smoke`, `npm run test:e2e` (including the new switch spec), `npm run test:integration`, and a manual walk-through in both languages.

### Key Discoveries:

- The code-in-URL, map-at-render design (`projects.ts:56-67`) is the seam for translation. Resolvers gain a `locale` argument, and no API route or redirect contract changes.
- `middleware.ts:23-27` already reads the caller's profile on every signed-in request. Adding `locale` to that select costs no extra query.
- Password sign-in completes in exactly one place, `api/auth/signin.ts:17-28`, which is the hook for saving the cookie's language to the profile.
- Astro props passed to hydrated islands must be serialisable. Island label sets are therefore plain strings with `{placeholder}` templates, never functions.
- Supabase Auth signup errors carry stable `code`s (`weak_password`, `user_already_exists`, `email_exists`, `email_address_invalid`, `over_email_send_rate_limit`; Context7 `/supabase/supabase` error-codes), the same pattern signin already uses (`signin.ts:21-23`).

## What We're NOT Doing

- **No URL prefixes or Astro `i18n` routing config.** The locale is cookie-based (avoids the `route-access` bypass and the test churn).
- **No `Accept-Language` detection.** Without a cookie the language is always Polish.
- **No per-recipient email language.** Both emails are Polish for everyone, and no locale column is added on `employees`.
- **Number formats don't follow the UI language.** `src/lib/format.ts` stays pl-PL, and dates stay `YYYY-MM-DD`.
- **The middleware's plain-text `Forbidden` / `Service temporarily unavailable` (403/503) responses stay English.**
- **The hard-coded strings and fixtures of the dev kitchen sink (`/dev/projects-kitchen-sink`) stay English.** Components it renders follow the active locale automatically.
- **User data isn't translated:** seed names, project, milestone and employee names, job-role names.
- **The KPI names Termin/Budżet/Jakość/Ryzyko stay as-is in both languages.** They're product terms from `prd.md:84`.
- **SQL `raise exception` messages aren't changed.** They never reach the UI.
- **The invite-acceptance path (`/auth/confirm` → set password) doesn't save the cookie's language to the profile.** The next switch click saves it.
- **No restyling of auth pages** beyond the text and the switch. They keep their existing palette classes and aren't added to `CLEAN_PATHS`.

## Implementation Approach

A small pure i18n module (`src/lib/i18n/`) owns the locale model, the cookie name, the resolution rule and two typed dictionaries. `en` is typed as the shape of `pl`, so a missing key fails `astro check`.

The middleware resolves `locals.locale` on every request. Astro pages and components read `Astro.locals.locale` and use `getMessages(locale)`. Service resolvers take `locale` as an explicit argument. React islands get a plain-string label set as a prop.

A public `POST /api/locale` form endpoint sets the cookie, saves the choice to the profile through a narrow `security definer` RPC when the user is signed in, and redirects back. It works without JavaScript and follows the app's POST-redirect pattern.

Each phase translates a layer and updates the tests that check that layer's text in the same phase, so every phase ends green.

**Terminology (PL glossary, used across all phases for consistency):**

| English                                  | Polish                                       |
| ---------------------------------------- | -------------------------------------------- |
| milestone                                | kamień milowy                                |
| bonus                                    | premia                                       |
| target pool                              | pula docelowa                                |
| payout pool                              | pula do wypłaty                              |
| supervisor                               | przełożony                                   |
| employee                                 | pracownik                                    |
| admin                                    | administrator                                |
| assignment / engagement                  | przypisanie                                  |
| time share                               | udział czasowy                               |
| role weight                              | waga roli                                    |
| rating                                   | ocena                                        |
| multiplier                               | mnożnik                                      |
| budget                                   | budżet                                       |
| Draft                                    | Szkic                                        |
| Approved                                 | Zatwierdzony                                 |
| planned / active / completed / cancelled | planowany / aktywny / zakończony / anulowany |
| invite                                   | zaproszenie                                  |
| Sign in / Sign out / Sign up             | Zaloguj się / Wyloguj się / Załóż konto      |
| Email / Password                         | E-mail / Hasło                               |

## Critical Implementation Details

- **Island props must be serialisable.** Labels passed to `client:*` components are strings only. Interpolation uses `{name}` placeholders filled by a shared `format()` helper. The Polish plural in `SignUpForm.tsx:60-61` passes the `one/few/many` forms and the locale and is resolved client-side with `Intl.PluralRules`.
- **Resolution order in the middleware.** The locale is resolved after the profile lookup and before `decideAccess`, so it's set even on redirect/403 paths (the redirect target renders in the right language). A cookie written from the profile uses the same attributes as the switch endpoint.
- **Profile writes never block the user.** A failed `set_my_locale` call (in the switch endpoint or at sign-in) is logged with `console.error` and the request continues. The cookie remains the source of what's rendered.

## Phase 1: Locale foundation

### Overview

Add the locale model, how the locale is resolved and persisted, the database column and RPC with RLS coverage, the switch endpoint and the switch UI. User-visible text other than the switch itself is still English after this phase. It only gets `lang`, locale plumbing and empty-but-typed dictionaries ready for content.

### Changes Required:

#### 1. i18n module

**File**: `src/lib/i18n/index.ts`, `src/lib/i18n/messages/pl.ts`, `src/lib/i18n/messages/en.ts`

**Intent**: Single source for the locale type, cookie name, the resolution rule and the dictionaries. It stays pure (no `astro:*` imports) so Vitest can cover it.

**Contract**:

- `type Locale = "pl" | "en"`, `LOCALES`, `DEFAULT_LOCALE = "pl"`, `LOCALE_COOKIE = "lang"`, `LOCALE_COOKIE_MAX_AGE` (one year).
- `parseLocale(value: unknown): Locale | null`.
- `resolveLocale({ cookie, profileLocale }): { locale: Locale; writeCookie: boolean }`. Rules:
  - valid cookie → cookie, `writeCookie: false`;
  - else valid profile locale → profile, `writeCookie: true`;
  - else → `"pl"`, `writeCookie: false`.
- `getMessages(locale): Messages`.
- `format(template, vars)` for `{name}` placeholders.
- `plural(locale, n, forms: { one; few; many; other? })` using `Intl.PluralRules`.
- `pl.ts` exports `pl` (the shape source, namespaced by area: `common`, `layout`, `landing`, `auth`, `projects`, `milestones`, `employees`, `admin`, `history`, `myBonuses`, `status`, `email`). `export type Messages = typeof pl`. `en.ts` exports `en: Messages`.
- Phase 1 adds the `common` and `layout` namespaces (switch labels). Later phases add their own namespaces.

#### 2. Locals and types

**File**: `src/env.d.ts`, `src/types.ts`

**Intent**: Make the resolved locale available to every page and endpoint, and carry the profile's saved locale.

**Contract**: `App.Locals.locale: import("@/lib/i18n").Locale`; `Profile.locale: Locale | null`.

#### 3. Middleware resolution

**File**: `src/middleware.ts`

**Intent**: Resolve `locals.locale` on every request, and fill a missing cookie from the profile (the "new device" half of latest-choice-wins).

**Contract**:

- The profile select adds `locale`.
- After the profile lookup, call `resolveLocale` with the `lang` cookie and `profile?.locale`. Set `context.locals.locale`. When `writeCookie`, `context.cookies.set(LOCALE_COOKIE, …)` with `path: "/"`, `maxAge`, `sameSite: "lax"`, `httpOnly: true`, `secure` when the request is https.
- Runs before `decideAccess`.

#### 4. Migration: `profiles.locale` + `set_my_locale`

**File**: `supabase/migrations/20261013120000_profiles_locale.sql`

**Intent**: Persist the choice per user without opening a general self-update path on `profiles`, where `role` lives.

**Contract**:

- `alter table public.profiles add column locale text null check (locale in ('pl','en'))`. Existing rows stay null.
- `create function public.set_my_locale(p_locale text) returns void`, `language plpgsql security definer set search_path = ''`. It raises when `auth.uid()` is null, then runs `update public.profiles set locale = p_locale where id = auth.uid()`. The check constraint rejects other values (23514).
- `revoke execute … from public, anon`; `grant execute … to authenticated`.
- No new policy and no change to table grants.

#### 5. RLS tests

**File**: `supabase/tests/rls_catalog_guard.test.sql`, `supabase/tests/rls_matrix.test.sql`

**Intent**: Classify the new definer function deliberately and prove its scope (CLAUDE.md RLS rule).

**Contract**:

- Catalog guard: add `('set_my_locale(text)')` to the definer allowlist with a one-line comment ("own row, locale column only").
- Matrix: new cells, with the `plan(n)` count updated:
  - E1 `set_my_locale('en')` sets only E1's `profiles.locale`; E2's row is unchanged (fingerprint check).
  - E1's `role` is unchanged after the call.
  - `set_my_locale('de')` raises 23514.
  - anon cannot execute it (42501).
  - An admin calling it changes only the admin's own row.

#### 6. Switch endpoint

**File**: `src/pages/api/locale.ts`, `src/lib/route-access.ts`

**Intent**: Let anyone, signed in or not, change the language with a plain form POST, and save the choice when signed in.

**Contract**:

- `POST` with form fields `locale`, `next`, validated with zod.
- Valid `locale`: set the `lang` cookie (same attributes as the middleware). If `locals.user` is set, call `supabase.rpc("set_my_locale", { p_locale })`; on error, log it and don't block.
- Invalid `locale`: change nothing.
- Always redirect to `safeNext(next) ?? "/"`.
- Add `"/api/locale"` to `PUBLIC_ROUTES`.

#### 7. Sign-in sync

**File**: `src/pages/api/auth/signin.ts`

**Intent**: The "latest choice wins" half that happens at sign-in. A language chosen before signing in is saved to the profile.

**Contract**: After a successful `signInWithPassword`, if `parseLocale(lang cookie)` is non-null, call `set_my_locale` with it; on error, log it and don't block. The redirect behaviour is unchanged.

#### 8. Layout and switch UI

**File**: `src/layouts/Layout.astro`, `src/components/LanguageSwitch.astro`, `scripts/check-ui-literals.mjs`

**Intent**: Show the switch on every page and set the document language.

**Contract**:

- `<html lang={Astro.locals.locale} class="dark">`.
- Layout renders `<LanguageSwitch />`. It's fixed in the bottom-right corner so it can't collide with Topbar's right-hand sign-out.
- `LanguageSwitch` is an `.astro` form posting to `/api/locale` with a hidden `next = Astro.url.pathname + Astro.url.search` and two submit buttons, `name="locale" value="pl"|"en"`, labelled `PL` / `EN`.
- The active language's button has `aria-pressed="true"`. The form has an `aria-label` from `t.layout.languageSwitch` ("Język" / "Language").
- Token classes only, via `cn()`. Add `src/components/LanguageSwitch.astro` to `CLEAN_PATHS`.

#### 9. Unit tests

**File**: `src/lib/i18n/__tests__/i18n.test.ts`, `src/lib/__tests__/route-access.test.ts`

**Intent**: Lock the resolution rule and dictionary integrity.

**Contract**:

- `parseLocale` cases: valid, invalid, non-string.
- `resolveLocale`: all three branches, including an invalid cookie with a valid profile → profile and `writeCookie: true`.
- `format` and `plural` with Polish forms: 1 → one, 2–4 → few, 5 → many, 22 → few.
- Dictionary parity: `pl` and `en` have identical key paths and no empty strings, checked by a recursive walk.
- `decideAccess("/api/locale", …)` allows anonymous users.

### Success Criteria:

#### Automated Verification:

- Migration applies and pgTAP passes: `npx supabase migration up --local && npx supabase test db`
- Type check passes: `npx astro sync && npx astro check`
- Unit tests pass: `npm test`
- Lint and UI literal check pass: `npm run lint && npm run lint:ui`
- Smoke passes unchanged: `npm run smoke` (against `npm run build && npm run preview`)

#### Manual Verification:

- The switch is visible on `/`, `/auth/signin` and `/projects` and doesn't overlap the Topbar or page content at phone width.
- Clicking EN or PL returns to the same URL (query kept), and `<html lang>` follows the choice.
- Signed in as the seeded supervisor: switch to EN, sign out, delete the `lang` cookie, sign in again. The cookie is restored as `en` from the profile.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: First page, shell and auth

### Overview

Translate everything an anonymous visitor sees and the shared shell, replace the starter landing page, move signup to error codes, and pass labels into the islands. Update the e2e tests that check this text.

### Changes Required:

#### 1. Landing page

**File**: `src/components/Welcome.astro` (rewritten), `scripts/check-ui-literals.mjs`

**Intent**: Replace the "10x Astro Starter" boilerplate with a short Meritly landing page in PL/EN.

**Contract**:

- Keep `<Topbar/>`.
- Content: "Meritly" heading, a one-line pitch ("Sprawiedliwy podział puli premiowej kamieni milowych" / "Fair split of milestone bonus pools"), and a 2–3 item explanation of the formula in plain words.
- CTA: anonymous → Sign in + Sign up; signed in → "Przejdź do panelu" / "Go to dashboard" (`/dashboard`).
- Token classes only. Add it to `CLEAN_PATHS`. Text lives in `t.landing`.

#### 2. Shell

**File**: `src/layouts/Layout.astro`, `src/components/Topbar.astro`, `src/pages/dashboard.astro`, `src/lib/config-status.ts`

**Intent**: Translate the shared chrome.

**Contract**:

- Layout's default title becomes "Meritly". The banner text ("Uwaga:", "Dokumentacja") and the `config-status.ts` message move into `t.layout` with EN versions.
- Topbar's links and the "Not signed in" text move into `t.layout`.
- Dashboard shows a role label from `t.status.role` instead of the raw `profile.role`.

#### 3. Auth pages and islands

**File**: `src/pages/auth/{signin,signup,confirm-email,set-password}.astro`, `src/components/auth/{SignInForm,SignUpForm,PasswordToggle}.tsx`

**Intent**: Translate the auth flow, including client-side validation, placeholders and aria-labels.

**Contract**:

- `SIGNIN_ERROR_MESSAGES` (`signin.astro:8-14`) moves to `t.auth.signinErrors`, keyed by the same codes.
- Each island gains a `labels` prop: a plain-string object from `t.auth.signInForm` / `t.auth.signUpForm`, passed by the page. `PasswordToggle` receives `showLabel` / `hideLabel` from its parent form.
- The `SignUpForm` "N more characters needed" text uses `plural()`, with the forms and locale passed as props.
- Page titles are translated.

#### 4. Signup error codes

**File**: `src/pages/api/auth/signup.ts`, `src/pages/auth/signup.astro`

**Intent**: Stop passing free text in the URL, so the error can be translated and arbitrary text can't be injected.

**Contract**:

- Redirect with `?error=<code>`, where the code is one of `not_configured`, `weak_password`, `user_already_exists` (also mapped from `email_exists`), `email_address_invalid`, `over_email_send_rate_limit`, otherwise `signup_failed`.
- The page resolves the code through `t.auth.signupErrors`, the same way signin does. An unknown code maps to `signup_failed`.

#### 5. e2e text in the auth path

**File**: `tests/e2e/auth.setup.ts`, `tests/e2e/seed.spec.ts`

**Intent**: Keep the suite green under the Polish default. These checks are selectors on copy that changed, not behaviour changes.

**Contract**: Accessible names switch to the Polish dictionary values ("E-mail", "Hasło", "Zaloguj się", "Wyloguj się", heading "Zaloguj się"). The `/projects` heading assertion (`seed.spec.ts:34`) stays English until Phase 4 translates that page.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npx astro check`
- Unit tests pass: `npm test`
- Lint and UI literal check pass: `npm run lint && npm run lint:ui`
- Smoke passes: `npm run smoke`
- e2e passes: `npm run test:e2e`

#### Manual Verification:

- `/`, `/auth/signin`, `/auth/signup`, `/auth/confirm-email` and `/dashboard` read correctly in both languages, with no English left in PL mode.
- Signup with a short password shows a Polish client-side error with correct plural forms (1 / 3 / 5 characters).
- Signup with an existing email shows the translated server error.
- Tab order through the sign-in form still goes through the password toggle, whose aria-label is in the active language.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Service catalogs, labels and label-as-logic fixes

### Overview

Make every code→text catalog locale-aware, turn load errors into codes, add shared status/role/invite labels, and remove the two places where English text drives logic.

### Changes Required:

#### 1. Locale-aware catalogs

**File**: `src/lib/services/{projects,employees,engagements,payouts,bonus-config,approvals}.ts`, `src/lib/set-password.ts`, and every page calling their resolvers

**Intent**: Each catalog keeps its colocated shape and codes but holds both languages, and resolvers take the locale.

**Contract**:

- Each `X_ERROR_MESSAGES` / `FIELD_LABELS` / `GENERIC_ERROR_MESSAGE` / `APPROVAL_NOTICE_MESSAGES` becomes `Record<Locale, …>`. The PL entry is typed against the EN codes, so a missing code fails the type check.
- Resolvers gain a trailing `locale: Locale` parameter (e.g. `projectsErrorMessage(code, field, locale)`, `approvalNoticeMessage(code, locale)`). The `"Value"` fallback label is localised.
- Callers pass `Astro.locals.locale`.
- Approval notice text refers to button labels by name, so it must quote the translated button text from `t.milestones`.

#### 2. Load errors as codes

**File**: the same six service modules, and their calling pages

**Intent**: Services stop returning English sentences.

**Contract**:

- `mapLoadError` returns the code `"load_failed"`. `bonus-config.ts:253` returns `"settings_missing"`.
- The `{ error }` result type narrows to those codes.
- Pages render `t.<area>.loadFailed` / `t.admin.settingsMissing`.

#### 3. Shared labels

**File**: `src/lib/i18n/messages/{pl,en}.ts`

**Intent**: One place for enum labels instead of raw values and duplicated maps.

**Contract**:

- `t.status.work` covers `planned|active|completed|cancelled`. `t.status.milestone` adds `approved`. `t.status.invite` replaces the duplicated `STATUS_LABELS` at `employees/index.astro:68-72` and `employees/[id].astro:45-49`. `t.status.role` covers `admin|supervisor|employee`.
- Phase 4 views consume these.

#### 4. Label-as-logic fixes

**File**: `src/components/projects/BudgetExposurePanel.astro`, `src/components/milestones/PayoutSection.astro`

**Intent**: Styling and sentinel logic must not depend on display text.

**Contract**:

- `figures` entries carry a `key` (`"budget" | …`) or an `isBudget` flag, and the destructive style tests that instead of `label`.
- `PayoutSection` replaces the `UNSCORED` text sentinel with a `null`/flag check and renders the text from the dictionary.

#### 5. Unit tests

**File**: `src/lib/services/__tests__/*.test.ts`

**Intent**: Lock resolver behaviour in both languages.

**Contract**:

- `approvals.test.ts:141` asserts the EN text via `approvalNoticeMessage(code, "en")`, plus a PL case.
- For each resolver: a known code with a field label in PL and EN; an unknown code → localised generic message.
- Load-error results assert the `load_failed` code.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npx astro check`
- Unit tests pass: `npm test`
- Mutation score for the touched resolvers doesn't drop: `npm run test:mutation -- --mutate "src/lib/services/*.ts"`
- Lint and UI literal check pass: `npm run lint && npm run lint:ui`

#### Manual Verification:

- Trigger a validation error on the project form and the employee form in each language; the message and field label are translated.
- The Budget exposure panel still marks only non-budget figures red when over budget, in both languages (check in the kitchen sink and on a real project).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Feature views

### Overview

Translate every remaining view through the dictionaries and update smoke and the us-01 e2e test.

### Changes Required:

#### 1. Projects and milestones

**File**: `src/pages/projects/index.astro`, `src/pages/projects/[id].astro`, `src/pages/projects/[id]/milestones/[milestoneId].astro`, `src/components/projects/{ProjectForm,MilestoneForm,MilestonesSection,BudgetExposurePanel}.astro`, `src/components/milestones/{KpiScoresSection,PayoutSection,ApprovalSection}.astro`, `src/components/engagements/EngagementForm.astro`

**Intent**: Translate headings, labels, table headers, empty states, notes, buttons (including `SubmitButton` label and `pendingText`), aria-labels and page titles. Statuses render through `t.status` everywhere, including `<option>` text (the option values stay the enum).

**Contract**:

- Text lives in `t.projects` and `t.milestones`.
- Sentences that embed a status or name use `format()` templates. The `SAVED_MESSAGES` map at `[milestoneId].astro:44-48` moves into `t.milestones.saved`.
- The `capitalize` class is removed where a label replaces a raw enum.

#### 2. Employees, admin, history, my-bonuses

**File**: `src/pages/employees/index.astro`, `src/pages/employees/[id].astro`, `src/components/employees/EmployeeForm.astro`, `src/pages/admin/index.astro`, `src/pages/admin/settings.astro`, `src/components/admin/{JobRolesSection,KpiSettingsSection,RatingFactorsSection}.astro`, `src/components/history/EmployeeHistory.astro`, `src/pages/my-bonuses.astro`

**Intent**: Same as above for the remaining areas.

**Contract**:

- Text lives in `t.employees`, `t.admin`, `t.history` and `t.myBonuses`.
- The English `milestones()` plural helper (`EmployeeHistory.astro:18`) is replaced by `plural()`.
- Invite status uses `t.status.invite`.

#### 3. Smoke and us-01 e2e

**File**: `scripts/smoke.mjs`, `tests/e2e/us-01-approved-bonus-visible-only-to-its-employee.spec.ts`, `tests/e2e/seed.spec.ts`

**Intent**: Move the text these tests check to the Polish dictionary values, and add smoke checks for locale behaviour.

**Contract**:

- Smoke needles (`ADMIN_ONLY_TEXT`, "All approved bonuses", "Employee not found.", "Approved bonuses on your projects", "Current assignments") become the PL dictionary strings. Data names and amounts are unchanged.
- New smoke steps:
  - `GET /` without a cookie contains `lang="pl"`.
  - With `lang=en` it contains `lang="en"` and an EN landing string.
  - `POST /api/locale` with `locale=en&next=/auth/signin` → 302 to `/auth/signin` with `Set-Cookie: lang=en`.
  - `next=//evil.example` → 302 to `/`.
  - `locale=de` → no `lang` cookie set.
- us-01: "Zatwierdzone premie", the confirmation checkbox, the "Zatwierdź kamień milowy" button and the success status, using the exact PL dictionary values.
- seed.spec: the remaining Projects heading assertion.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npx astro check`
- Unit tests pass: `npm test`
- Lint and UI literal check pass: `npm run lint && npm run lint:ui`
- Smoke passes with the new locale steps: `npm run smoke`
- e2e passes: `npm run test:e2e`
- No English UI string left in translated views: a reviewed grep of `src/pages` and `src/components` (excluding `dev/` and `ui/`) for capitalised English words outside `t.`/dictionary references finds only data, code or comments

#### Manual Verification:

- Walk every page as admin, supervisor and employee in PL. No English text remains except user data and the KPI names.
- Repeat the walk in EN. Nothing is untranslated, and no PL text appears except the KPI names and data.
- Long Polish labels don't break table layouts or buttons at phone width (projects list, milestone page, employees list).
- The kitchen sink (`/dev/projects-kitchen-sink`) still renders all 7 states.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Emails, switch e2e and docs

### Overview

Polish emails, a browser-level test for the switch, and conventions for the next contributor.

### Changes Required:

#### 1. Invite email

**File**: `supabase/templates/invite.html`, `supabase/config.toml`

**Intent**: The invite reads in Polish.

**Contract**:

- Template body in Polish ("Zaproszenie do Meritly", "Przełożony dodał Cię…", "Przyjmij zaproszenie", "Link wygasa po 1 godzinie…"). Template variables are unchanged.
- `[auth.email.template.invite] subject = "Zaproszenie do Meritly"`.
- The manual production step (copying the template into the hosted Supabase dashboard) is recorded in the change notes.

#### 2. Approval email

**File**: `supabase/functions/notify-milestone-approved/index.ts`

**Intent**: The approval email reads in Polish.

**Contract**:

- Subject `Twoja premia za ${milestone_name} — ${project_name}`.
- Text and HTML bodies and `NO_ACCOUNT_LINE` are in Polish.
- The pl-PL amount, the ISO period, the from-address, the claim/stamp logic and the error codes are unchanged.

#### 3. Switch e2e

**File**: `tests/e2e/language-switch.spec.ts`

**Intent**: Prove the browser-level risk: the switch on the first page changes the language, survives navigation and sign-in, and the latest choice wins.

**Contract**:

- Uses a fresh, unauthenticated context (no `storageState`).
- On `/`, the Polish landing heading is shown. Clicking EN shows the English heading and `html[lang=en]`.
- Navigate to sign-in and sign in as the seed user: still English.
- Clicking PL shows Polish, and that persists after a reload.
- Waits on state only (`toBeVisible`, `waitForURL`). Role/label locators only.
- At the end it resets the seed user's language to PL by clicking PL, so other specs are unaffected.

#### 4. Docs

**File**: `CLAUDE.md`, `context/foundation/test-plan.md`

**Intent**: The next agent adds text through the dictionaries, not as literals.

**Contract**:

- CLAUDE.md "Key conventions" gains an i18n bullet:
  - user-visible text lives in `src/lib/i18n/messages/{pl,en}.ts` (or in a service's locale-keyed catalog);
  - read it via `getMessages(Astro.locals.locale)`;
  - islands get plain-string label props;
  - Polish is the default;
  - number formats stay pl-PL.
- The Auth-flow section mentions `POST /api/locale` and the `lang` cookie.
- test-plan notes that e2e/smoke assertions use PL dictionary text.

### Success Criteria:

#### Automated Verification:

- Integration suite passes: `npm run test:integration`
- e2e passes including the new spec: `npm run test:e2e`
- Deliberate break: changing the switch's EN button label or removing the cookie write makes `language-switch.spec.ts` fail (then restore)
- Unit tests and type check pass: `npm test && npx astro check`

#### Manual Verification:

- An invite sent locally (Mailpit at `http://127.0.0.1:54324`) has a Polish subject and body, and its link still signs the employee in.
- Approving a milestone locally delivers Polish emails with correct amounts.
- The hosted dashboard invite template is updated (production step, done by a human).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- i18n module:
  - `parseLocale`;
  - `resolveLocale` (three branches plus invalid cookie);
  - `format`;
  - Polish `plural` boundaries (1, 2, 4, 5, 12, 22, 25);
  - recursive dictionary parity with no empty strings.
- Route access: `/api/locale` is public.
- Each service resolver in both locales; unknown code → localised generic message; load errors → `load_failed`.

### Integration Tests:

- pgTAP: `set_my_locale` scope cells in `rls_matrix.test.sql` and the allowlist in `rls_catalog_guard.test.sql`.
- Smoke: default `lang="pl"`, cookie-driven EN, `/api/locale` cookie and redirect, `next` safety, invalid locale ignored.
- `test:integration`: the notify suite stays green with Polish copy (it asserts amounts only).
- e2e: the existing specs on PL text, plus `language-switch.spec.ts`.

### Manual Testing Steps:

1. Fresh browser on `/`: Polish landing page and the switch visible bottom-right.
2. Click EN on `/auth/signin?next=%2Fprojects`, sign in as the supervisor, land on `/projects` in English.
3. Sign out, clear cookies, sign in again: English is restored from the profile.
4. Switch to PL on the milestone page with a `?error=` in the URL: the same error is shown in Polish.
5. Phone-width check of the switch and of long Polish labels.

## Performance Considerations

None material. Dictionaries are module constants, resolution happens once per request, and the profile select gains one column. The cookie write from the profile happens at most once per device.

## Migration Notes

- `profiles.locale` is nullable with no backfill. Existing users render Polish until they switch.
- Rolling back means dropping the function and the column. The middleware selects `profiles.locale`, so an app build from this change fails its profile lookup (503 on role-gated routes) without the column. Roll back the app before or together with the migration, never the migration alone.
- Production: the hosted invite template is updated by hand (Phase 5).

## References

- Research: `context/changes/language-switch-pl-en/research.md`
- Code-catalog pattern: `src/lib/services/projects.ts:13-67`
- Signin error-code pattern: `src/pages/api/auth/signin.ts:17-24`, `src/pages/auth/signin.astro:8-22`
- Route gate: `src/lib/route-access.ts:13-24,49-50`
- Profile lookup: `src/middleware.ts:23-35`
- Definer allowlist: `supabase/tests/rls_catalog_guard.test.sql:179-199`
- Astro i18n docs (cookie approach chosen over URL routing): Context7 `/withastro/docs`, internationalization guide

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Locale foundation

#### Automated

- [x] 1.1 Migration applies and pgTAP passes — 31ee1ee
- [x] 1.2 Type check passes — 31ee1ee
- [x] 1.3 Unit tests pass — 31ee1ee
- [x] 1.4 Lint and UI literal check pass — 31ee1ee
- [x] 1.5 Smoke passes unchanged — 31ee1ee

#### Manual

- [x] 1.6 Switch visible on /, /auth/signin and /projects without overlap at phone width — 31ee1ee
- [x] 1.7 Switch returns to the same URL and html lang follows the choice — 31ee1ee
- [x] 1.8 Profile restores the cookie after sign-in on a cleared browser — 31ee1ee

### Phase 2: First page, shell and auth

#### Automated

- [x] 2.1 Type check passes
- [x] 2.2 Unit tests pass
- [x] 2.3 Lint and UI literal check pass
- [x] 2.4 Smoke passes
- [x] 2.5 e2e passes

#### Manual

- [x] 2.6 Landing, auth pages and dashboard read correctly in both languages
- [x] 2.7 Signup client-side error shows correct Polish plural forms
- [x] 2.8 Signup existing-email error is translated
- [x] 2.9 Password toggle aria-label follows the active language

### Phase 3: Service catalogs, labels and label-as-logic fixes

#### Automated

- [ ] 3.1 Type check passes
- [ ] 3.2 Unit tests pass
- [ ] 3.3 Mutation score for touched resolvers does not drop
- [ ] 3.4 Lint and UI literal check pass

#### Manual

- [ ] 3.5 Project and employee form errors translated in both languages
- [ ] 3.6 Budget exposure styling unchanged in both languages

### Phase 4: Feature views

#### Automated

- [ ] 4.1 Type check passes
- [ ] 4.2 Unit tests pass
- [ ] 4.3 Lint and UI literal check pass
- [ ] 4.4 Smoke passes with the new locale steps
- [ ] 4.5 e2e passes
- [ ] 4.6 No English UI string left in translated views

#### Manual

- [ ] 4.7 Full PL walk as admin, supervisor and employee
- [ ] 4.8 Full EN walk with nothing untranslated
- [ ] 4.9 Long Polish labels fit at phone width
- [ ] 4.10 Kitchen sink still renders all 7 states

### Phase 5: Emails, switch e2e and docs

#### Automated

- [ ] 5.1 Integration suite passes
- [ ] 5.2 e2e passes including the new spec
- [ ] 5.3 Deliberate break makes the switch spec fail
- [ ] 5.4 Unit tests and type check pass

#### Manual

- [ ] 5.5 Local invite email is Polish and its link works
- [ ] 5.6 Local approval emails are Polish with correct amounts
- [ ] 5.7 Hosted dashboard invite template updated
