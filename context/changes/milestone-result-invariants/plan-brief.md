# Milestone Result Invariants — Plan Brief

> Full plan: `context/changes/milestone-result-invariants/plan.md`
> Source design: `context/domain/02-invariant-aggregate-refactor.md`
> Related research: `context/changes/core-subdomain-spread/research.md`

## What & Why

Make the approved milestone result one consistent, immutable unit enforced by the database. Today header and lines agree only because `approve_milestone` happens to write them in one statement, and the snapshot is protected only by missing grants. What the supervisor signed and what the employee reads must not be able to drift.

## Starting Point

`milestone_results` and `milestone_result_lines` have no triggers. Header CHECKs never look at the lines, the Edge Function holds full UPDATE with the secret key, and the TS service reads header and lines separately and renders a header with no lines as a valid empty result.

## Desired End State

A committed approved result always has lines that sum to its header, and no role can alter it (except the approver FK going NULL and the two notification stamps). If data is ever inconsistent, the app shows a typed error card with no figures and logs `result_inconsistent` at `error`.

## Key Decisions Made

| Decision                             | Choice                                                         | Why                                                          | Source |
| ------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------ | ------ |
| Where the aggregate lives            | In Postgres, with a thin TS port                               | Rules already live in SQL; a TS class would be a second copy | Plan   |
| Consistency check timing             | Deferred constraint trigger at COMMIT                          | Insert order inside `approve_milestone` stops mattering      | Plan   |
| Immutability                         | BEFORE triggers for every role, incl. owner and `service_role` | Grants alone do not stop the Edge Function or an operator    | Plan   |
| Q1 operator fix                      | Manual: `alter table … disable trigger`                        | Deliberate friction, no new audit scope                      | User   |
| Q2 `approved_by` on account deletion | Stays `on delete set null`                                     | Keeps current behaviour and data minimisation                | User   |
| Q3 result with 0 lines               | Illegal (`MR016`)                                              | Turns existing `MR014` into a schema rule                    | User   |
| INV-09 duplicates                    | Out of scope, separate change                                  | Different problem: duplication, not enforceability           | Plan   |

## Scope

**In scope:** migration with two deferred and four immutability triggers (`MR016`, `MR017`); pgTAP, catalog-guard and RLS-matrix updates; `milestone-result.ts` port, error mapping, EN/PL messages; contract register.

**Out of scope:** INV-09, a domain correction function, approver identity snapshot, changes to payout arithmetic or to dashboard/report sums.

## Architecture / Approach

Red pgTAP tests first, then one migration that pre-checks existing data and installs the guards, then red Vitest tests and the TS port, then regression runs and the register. `approve_milestone` is unchanged; it is now checked instead of trusted.

## Phases at a Glance

| Phase                      | What it delivers                                                    | Key risk                                                                               |
| -------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1. Red pgTAP tests         | Legal and illegal INV-05 cases, red for the right reason            | Deferred triggers never fire in rolled-back tests unless `set constraints … immediate` |
| 2. Migration and guards    | Triggers, catalog-guard and matrix updates, green DB suite          | Pre-check may find already inconsistent data                                           |
| 3. TypeScript port         | `loadApprovedResult`, `assertConsistent`, MR016/MR017 mapping, i18n | Keeping the port from recomputing domain rules                                         |
| 4. Regression and register | Integration and e2e pass; register updated                          | A test that relied on a now-forbidden write                                            |

**Prerequisites:** local Supabase, functions serve and Mailpit for integration and e2e.
**Estimated effort:** ~3–4 sessions across 4 phases.

## Open Risks & Assumptions

- Assumes no committed result is already inconsistent; the migration aborts if one is.
- Existing fixtures that insert inconsistent results stay valid only because they never commit.
- Operators lose the quiet SQL-editor fix; that is intended.

## Success Criteria (Summary)

- No role can commit an inconsistent or altered approved result; the new pgTAP cases prove it and can be shown to fail.
- The milestone page renders unchanged for valid data and shows a typed error with no figures for invalid data.
- `npx supabase test db`, `npm test`, `npm run test:integration`, `npm run test:e2e` and `npm run smoke` are green.
