# Milestone Result Invariants Implementation Plan

## Overview

Make the approved milestone result (`milestone_results` header + `milestone_result_lines`) one aggregate whose consistency and immutability the database enforces for every role, and give the TypeScript side a thin port that refuses to render data that contradicts it. Source design: `context/domain/02-invariant-aggregate-refactor.md` (INV-05). Nothing recomputes a rule in TS.

## Current State Analysis

- The header CHECKs (`supabase/migrations/20261005120000_milestone_approval.sql:74-77`) only relate header columns to each other; nothing ties `payout_total`, `engagement_count`, `multiplier`, `project_id` or `approved_at` to the lines.
- Consistency today comes from `approve_milestone` writing header and lines in one CTE statement (`…milestone_approval.sql:324-386`). Immutability comes only from `revoke insert, update, delete, truncate … from authenticated` (`:85`, `:123`). `grep` for triggers on the result tables found none.
- The `notify-milestone-approved` Edge Function updates `milestone_result_lines` with the secret key (`supabase/functions/notify-milestone-approved/index.ts:272-306`), so that role has full UPDATE.
- TS reads header and lines in two queries (`src/lib/services/approvals.ts:312-331`), trusts the header for `within_pool` (`:271-272`) and renders a header with no lines as a valid empty result (`:334-358`). The milestone page logs and shows a generic error when the header is missing (`src/pages/projects/[id]/milestones/[milestoneId].astro:100-111`).
- Two consumers of "paid" disagree in source: the dashboard sums headers (`src/lib/services/dashboard.ts:44`, `src/lib/dashboard.ts:188`), the report and history sum lines (`supabase/migrations/20261015120000_bonus_report.sql:87-95`, `src/lib/history.ts:10-53`).

## Desired End State

- A committed transaction cannot leave an approved result with no lines, with `Σ bonus ≠ payout_total`, with `Σ bonus > payout_pool`, with `engagement_count ≠ count(lines)`, with a line whose `multiplier`/`project_id`/`approved_at` differs from the header, or with a header whose milestone is not `approved` (`MR016`).
- No role, including the table owner and `service_role`, can update or delete result rows or truncate the tables, except `approved_by` set to NULL by the profile FK, and `notified_at`/`notify_claimed_at` on lines (`MR017`).
- `getApprovedPayout` reads header and lines in one query and fails with the typed code `result_inconsistent` (logged at `error`) instead of rendering inconsistent numbers.
- Verify: `npx supabase test db`, `npm test`, `npm run test:integration`, `npm run test:e2e` all green; the new pgTAP file fails when a guard is removed (proof it can fail).

### Key Discoveries:

- `MR016`–`MR019` are unused: `grep -rnE "MR01[6-9]" supabase src docs context/foundation` returned nothing.
- The only foreign key that updates a result row is `milestone_results.approved_by … on delete set null` (`…milestone_approval.sql:73`); the line FKs to results, engagements, employees and projects are `on delete restrict`, so the guard needs exactly one extra exception.
- Existing pgTAP files insert result fixtures directly as the table owner, including a result for a non-approved milestone (`supabase/tests/milestone_approval.test.sql:208-232`, `:673-690`; `supabase/tests/rls_matrix.test.sql:148-165`). They run in one transaction that rolls back, so deferred triggers never fire there.
- `supabase/seed.sql:222` approves through `approve_milestone`, so seeding stays valid under the new triggers.
- Error-code convention: `GUARD_ERROR_CODES` and the EN-defined, PL-typed catalogs in `src/lib/services/approvals.ts:25-102,194-199`; SQLSTATE register in `docs/reference/contract-surfaces.md` ("Custom SQLSTATEs").

## What We're NOT Doing

- INV-09: the duplicated "open milestone" and "can approve" rules in SQL and TS (`dashboard.ts`, `assignments.ts`, the milestone page). Separate change.
- A domain "correct/reopen" function with audit. Decision: an operator correcting an approved result does it by hand with `alter table … disable trigger` (Q1).
- Snapshotting the approver's identity. Decision: `approved_by` stays `on delete set null` (Q2).
- Allowing a zero-line result. Decision: illegal; `MR016` makes the existing `MR014` rule a schema rule (Q3).
- Changing the shape or arithmetic of `approve_milestone`, `capped_payout_pool` or `milestone_payout_lines`.
- Changing how the dashboard, report or history sum money. Their agreement is guaranteed by the new constraint, not by code changes.
- Pool approval by a director (distillation D2) and any other distillation drift item.

## Implementation Approach

Test-first, database first. Phase 1 writes failing pgTAP cases. Phase 2 adds one migration that first checks existing data, then adds a deferred constraint trigger on both tables (spot-check at COMMIT, so insertion order inside `approve_milestone` does not matter) and BEFORE triggers that reject mutation for every role. Phase 3 does the same red→green for TS. Phase 4 runs the existing integration and e2e suites as regression and records the new names in the contract register. A new migration only; applied migrations are never edited.

## Critical Implementation Details

- **Testing deferred triggers:** pgTAP runs in one transaction that is rolled back, so a deferred constraint trigger never fires. New tests must call `set constraints all immediate` (or `set constraints <name> immediate`) before the statement under test, then assert `throws_ok` on `MR016`. Existing fixtures that deliberately insert an inconsistent or non-approved result (`milestone_approval.test.sql:673-690`, `rls_matrix.test.sql:148-165`) stay valid only because they never commit and never switch constraints to immediate; keep it that way and say so in a comment.
- **Immutability vs. API roles:** for `authenticated` the `revoke` fails first with `42501`, so existing expectations (`milestone_approval.test.sql:612`, `rls_matrix.test.sql:701-705,822-826`) are unchanged. `MR017` is observable only for the owner and `service_role`, and for the Edge Function's allowed columns.
- **Fail-fast on existing data:** the migration starts with a `do $$ … $$` block that raises if any stored result already violates the `MR016` conditions, so it never installs a constraint over inconsistent rows. A raise there is a finding to investigate, not a bug in the migration.
- **Catalog guard:** the migration adds `security definer` functions and triggers, so `supabase/tests/rls_catalog_guard.test.sql` and `supabase/tests/rls_matrix.test.sql` must be updated in the same change (CLAUDE.md RLS rules; `context/foundation/test-plan.md` §6.1).

## Phase 1: Red pgTAP tests

### Overview

Write `supabase/tests/milestone_result_invariants.test.sql` covering every legal and illegal case, and confirm each illegal case fails today for the right reason.

### Changes Required:

#### 1. New pgTAP file

**File**: `supabase/tests/milestone_result_invariants.test.sql`

**Intent**: Pin the INV-05 behaviour before any migration exists. Follow the isolation model of `milestone_approval.test.sql` (own fixtures in a free UUID range, no absolute counts, rollback at the end) and record the UUID range in the header as `test-plan.md` §6.2 requires.

**Contract**: Legal cases that must pass: approve a milestone with one engagement; with N engagements including a `bonus = 0.00` line; at maximum and at minimum multiplier; with a positive rounding residual (`payout_total + residual = payout_pool`); `service_role` stamps `notified_at` and `notify_claimed_at`; deleting the approver's profile sets `approved_by` to NULL and changes nothing else; supervisor, admin and the activated employee read the same figures as before.
Illegal cases, each asserted with `throws_ok` on the SQLSTATE, after `set constraints all immediate`: header without lines; `Σ bonus ≠ payout_total`; `Σ bonus > payout_pool`; `engagement_count ≠ count(lines)`; a line with a different `multiplier`, `project_id` or `approved_at`; a line added after approval; a header for a milestone that is not `approved` → `MR016`. As owner and as `service_role`: update of `bonus` or any header column, delete of a line or header, `truncate` of either table → `MR017`. Atomicity: `approve_milestone` on a milestone in a closed project (`MR003`) leaves no header or lines (`is_empty`).

### Success Criteria:

#### Automated Verification:

- The new file runs and every illegal case fails against the current schema for the expected reason (no trigger, so no `MR016`/`MR017`): `npx supabase test db`
- The existing suites are unchanged and still green: `npx supabase test db`

#### Manual Verification:

- Read each failing case and confirm it fails because the guard is missing, not because of a fixture error or a wrong SQLSTATE.

**Implementation Note**: After this phase and its automated checks, pause for manual confirmation before Phase 2.

---

## Phase 2: Migration and database guards

### Overview

One new migration adds the deferred consistency check and the immutability guard, with the matching catalog-guard and RLS-matrix updates, and turns Phase 1 green.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_milestone_result_invariants.sql` (name `YYYYMMDDHHmmss_…`, later than `20261015120000`)

**Intent**: Enforce INV-05 in the schema. Pre-check existing rows; add the consistency function and its two deferred constraint triggers; add the immutability function with BEFORE UPDATE/DELETE and BEFORE TRUNCATE triggers on both tables; revoke execute on the new functions.

**Contract**: `public.milestone_result_assert_consistent()` returns trigger, `security definer`, `set search_path = ''`, raises `MR016` for the conditions listed under Desired End State; attached as `milestone_results_consistent` (after insert or update) and `milestone_result_lines_consistent` (after insert, update or delete), both `constraint trigger … deferrable initially deferred for each row`. `public.milestone_results_guard_immutable()` returns trigger, `security definer`, `set search_path = ''`, raises `MR017` for every UPDATE/DELETE/TRUNCATE except (a) on `milestone_results` an UPDATE whose only change is `approved_by` becoming NULL, and (b) on `milestone_result_lines` an UPDATE whose only changes are `notified_at` and `notify_claimed_at`; attached as `milestone_results_immutable`, `milestone_result_lines_immutable` (before update or delete, per row) and `milestone_results_no_truncate`, `milestone_result_lines_no_truncate` (before truncate, per statement). `approve_milestone` is not modified. The sketch in `context/domain/02-invariant-aggregate-refactor.md` §4.3 is the reference design; if the statement-level truncate trigger cannot use the same function, give it its own.

#### 2. RLS catalog guard and matrix

**Files**: `supabase/tests/rls_catalog_guard.test.sql`, `supabase/tests/rls_matrix.test.sql`

**Intent**: Register the two new `security definer` functions (allowlist by signature, pinned `search_path`, no execute for `public`/`anon`) and add matrix cells for owner, `service_role`, admin, supervisor, employee and anon on the new refusals.

**Contract**: Follow the existing cell and allowlist conventions in each file; do not weaken any existing assertion.

### Success Criteria:

#### Automated Verification:

- Migration applies to a database with existing approved results: `npx supabase migration up --local`
- All pgTAP suites pass, including the new file: `npx supabase test db`
- Prove it can fail: with a scratch copy of the migration that omits the sum check (or the immutability guard), the matching Phase 1 case goes red; restore afterwards.
- Seed still loads: `npx supabase db reset --local` then `npm run smoke`

#### Manual Verification:

- If the pre-check raised on real data, the offending rows were reported and understood before any workaround.
- A deliberate `update milestone_result_lines set bonus = …` run as `postgres` in the SQL editor is refused with `MR017`.

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: TypeScript port

### Overview

Add a thin service that loads header and lines in one query, refuses inconsistent data, and maps the two new SQLSTATEs. It recomputes no domain rule beyond the three consistency checks it must reject.

### Changes Required:

#### 1. Red Vitest tests

**File**: `src/lib/services/__tests__/milestone-result.test.ts`

**Intent**: Write first, confirm red. Cover `assertConsistent` and `loadApprovedResult`, and the error-code mapping.

**Contract**: `assertConsistent` accepts a consistent result and throws `ResultInconsistentError` for empty lines, `Σ bonus ≠ payout_total` (including a one-grosz difference; arithmetic in integer grosze like `src/lib/history.ts:10`), and `engagement_count ≠ lines.length`. `loadApprovedResult`: no header → `data: null`; header without lines → error `result_inconsistent` and `logError` called at `error`. Mapping: `MR016` → `result_inconsistent`, `MR017` → `result_immutable`, both logged at `error`; `MR003`, `MR014`, `MR015`, `42501` map as today.

#### 2. Service and types

**Files**: `src/lib/services/milestone-result.ts` (new), `src/types.ts`

**Intent**: Put `loadApprovedResult` and `assertConsistent` in the new service per the `src/lib/services/` convention; add `ApprovedResult` and the error type to `src/types.ts`. `loadApprovedResult` uses a single PostgREST select of `milestone_results` with `milestone_result_lines(...)` embedded.

**Contract**: `loadApprovedResult(supabase, milestoneId, log?) → ServiceResult<ApprovedResult | null>`; `assertConsistent(r) → ApprovedResult` (throws `ResultInconsistentError`); `MilestoneResultErrorCode` extends the existing approval codes with `result_inconsistent` and `result_immutable`.

#### 3. Wire-up and catalogs

**Files**: `src/lib/services/approvals.ts`, `src/pages/projects/[id]/milestones/[milestoneId].astro`, i18n catalogs

**Intent**: `getApprovedPayout` delegates to the new loader and computes `within_pool` only after `assertConsistent`; `GUARD_ERROR_CODES` gains `MR016` and `MR017` (logged at `error`); the milestone page shows the typed error card instead of the generic `load_failed`. Add EN codes first and the PL catalog typed against them (`approvals.ts:25-102`; user-visible text lives in the catalogs per CLAUDE.md i18n rules). `approve.ts` keeps its current shape.

**Contract**: `src/pages/api/projects/[id]/milestones/[milestoneId]/approve.ts` unchanged apart from handling the two new codes through the existing mapping.

### Success Criteria:

#### Automated Verification:

- New tests are red before the implementation and green after: `npx vitest run src/lib/services/__tests__/milestone-result.test.ts`
- Unit suite passes: `npm test`
- Types and lint pass: `npx astro sync` then `npx astro check` and `npm run lint`
- UI literal check passes: `npm run lint:ui`

#### Manual Verification:

- With a deliberately corrupted result (triggers disabled locally, one bonus edited), the milestone page shows the error card with no figures, and the log carries `result_inconsistent` at `error`.
- A normal approved milestone renders exactly as before for supervisor and employee.

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: Regression and contract register

### Overview

Run the suites that exercise the paths the new guards touch, and record the new names.

### Changes Required:

#### 1. Regression runs

**Files**: `tests/integration/notify-milestone-approved.integration.test.ts`, `tests/e2e/us-01-approved-bonus-visible-only-to-its-employee.spec.ts`

**Intent**: Run, do not rewrite. The integration test proves the Edge Function can still stamp `notified_at` and `notify_claimed_at`; the e2e proves approve → employee sees only their own line. Edit them only if a real regression shows a test depended on a now-forbidden write.

#### 2. Contract register

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Add registry rows for the two functions, the six triggers and the TS names, add `MR016` (`result_inconsistent`) and `MR017` (`result_immutable`) to the Custom SQLSTATEs table, and add the contract sentence: `approve_milestone` is the only writer of `milestone_results`; the only permitted update of a line is `notified_at`/`notify_claimed_at`.

**Contract**: Match the existing table columns and wording style of neighbouring rows.

### Success Criteria:

#### Automated Verification:

- Integration suite passes (needs `npx supabase start`, `functions serve`, Mailpit): `npm run test:integration`
- E2E suite passes: `npm run test:e2e`
- Smoke passes: `npm run smoke`
- Full DB suite passes: `npx supabase test db`

#### Manual Verification:

- The register rows match the names in the migration and in `milestone-result.ts`.

---

## Testing Strategy

### Unit Tests:

- `assertConsistent`: valid result; empty lines; a one-grosz sum difference; count mismatch.
- Error mapping for `MR016`, `MR017` and the unchanged codes.

### Integration Tests:

- pgTAP: the legal and illegal matrix in Phase 1 plus the RLS matrix cells.
- Edge Function stamps still work under the guard.

### Manual Testing Steps:

1. Approve a milestone locally; confirm supervisor, admin and employee views are unchanged.
2. As `postgres`, try to change a stored `bonus`: expect `MR017`.
3. Disable the triggers on a scratch database, corrupt one line, reload the milestone page: expect the error card and an `error` log.

## Performance Considerations

The consistency trigger runs once per row at commit and aggregates one milestone's lines. Approvals are infrequent and small, so the cost is negligible.

## Migration Notes

The migration first scans existing results and aborts if any violate `MR016`. Manual corrections of an approved result now require `alter table … disable trigger` by an operator (decision Q1); no domain correction function is added.

## References

- Source design: `context/domain/02-invariant-aggregate-refactor.md`
- Distillation: `context/domain/01-domain-distillation.md` (§3 A2)
- Layer-spread findings: `context/changes/core-subdomain-spread/research.md`
- Snapshot schema and `approve_milestone`: `supabase/migrations/20261005120000_milestone_approval.sql:52-126,282-393`
- Error mapping and catalogs: `src/lib/services/approvals.ts:25-102,194-217,299-359`
- Register and test cookbook: `docs/reference/contract-surfaces.md`, `context/foundation/test-plan.md` §6.1–6.2

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Red pgTAP tests

#### Automated

- [ ] 1.1 The new file runs and every illegal case fails against the current schema for the expected reason
- [ ] 1.2 The existing suites are unchanged and still green

#### Manual

- [ ] 1.3 Each failing case fails because the guard is missing, not because of a fixture error or a wrong SQLSTATE

### Phase 2: Migration and database guards

#### Automated

- [ ] 2.1 Migration applies to a database with existing approved results
- [ ] 2.2 All pgTAP suites pass, including the new file
- [ ] 2.3 Prove it can fail: a scratch migration without a guard turns the matching Phase 1 case red
- [ ] 2.4 Seed still loads and smoke passes after a local reset

#### Manual

- [ ] 2.5 Any pre-check finding on real data was reported and understood before a workaround
- [ ] 2.6 A direct update of a stored bonus as postgres is refused with MR017

### Phase 3: TypeScript port

#### Automated

- [ ] 3.1 New Vitest tests are red before the implementation and green after
- [ ] 3.2 Unit suite passes
- [ ] 3.3 Types and lint pass
- [ ] 3.4 UI literal check passes

#### Manual

- [ ] 3.5 A deliberately corrupted result shows the error card with no figures and an error log
- [ ] 3.6 A normal approved milestone renders as before for supervisor and employee

### Phase 4: Regression and contract register

#### Automated

- [ ] 4.1 Integration suite passes
- [ ] 4.2 E2E suite passes
- [ ] 4.3 Smoke passes
- [ ] 4.4 Full DB suite passes

#### Manual

- [ ] 4.5 The register rows match the names in the migration and in milestone-result.ts
