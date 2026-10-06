<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Supervisor Approves Milestone, Employee Sees Bonus

- **Plan**: context/changes/supervisor-approves-milestone-employee-sees-bonus/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-06
- **Verdict**: APPROVED (all 6 findings fixed in triage, 2026-10-06)
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Evidence

- **Drift sweep.** Every planned item is implemented (MATCH). Nothing listed in "What We're NOT Doing" was built.
  - Ten adaptations were reported during implementation; all are as described.
  - Three benign extras:
    - the roadmap status bookkeeping;
    - a sixth fail-safe `approvalBlockedReason`, used when payouts cannot be loaded;
    - a variable rename in `SignInForm.tsx`.
- **Security sweep.** No critical issues found. The following were checked against the code:
  - Employee isolation, privilege grants and `search_path` on the definer functions.
  - The 42501 ownership check runs before any MR guard code.
  - Concurrency: `FOR UPDATE` on approval, `FOR SHARE` on engagement writes.
  - Edge Function authorization comes before any admin-client use, and the email HTML is escaped.
  - Open-redirect cases (`//`, `/\`, `%5C`, control characters, schemes, `/%2F%2F`) are safe.
- **Automated criteria, re-run 2026-10-06:**
  - `npx supabase db reset`: pass.
  - `npx supabase test db`: pass (6 files, 348 tests).
  - `npx astro check`: 0 errors.
  - `npm run lint`: pass.
  - `npm run lint:ui`: 13 files clean.
  - `npm run build`: pass.
  - `npm run smoke`: 8/8 pass.
- **Manual criteria.** All 19 manual rows are checked and were confirmed by the user per phase:
  - Phase 1: 1.6.
  - Phase 2: 2.5–2.9.
  - Phase 3: 3.5–3.10.
  - Phase 4: 4.5–4.8.
- **Spot checks (reviewer).**
  - Edge Function end to end: sent=1, a repeat sent 0, and an unapproved milestone got 409. The logs contain no figures or addresses.
  - Sign-in return target: `next=/my-bonuses` gives `location: /my-bonuses`; `//evil.example` and `/\evil` give `/`.

## Findings

### F1 — Extra sequential round trips on the milestone page and /my-bonuses

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Performance)
- **Location**: src/pages/projects/[id]/milestones/[milestoneId].astro:82-95; src/lib/services/approvals.ts:373-386
- **Detail**:
  - The payout load used to run inside the page's `Promise.all`. It now runs after it, because the status decides between the frozen and the live figures. Every milestone page load, Draft or Approved, waits for one more sequential round trip to Supabase.
  - `listMyBonuses` likewise awaits the `current_employee_id` RPC before it selects the lines.
- **Fix A ⭐ Recommended**: Fetch the snapshot header inside the initial `Promise.all`, then call the Draft RPCs only when no header exists.
  - Strength: approved pages get back to a single round of parallel loads, and Draft pages make no wasted live computation.
  - Tradeoff: Draft pages still make one sequential hop, for the Draft RPCs. `getApprovedPayout` needs a small split into a header part and a lines part.
  - Confidence: MED — the gain is one network round trip, not measured.
  - Blind spot: the actual Worker-to-Supabase latency has not been measured.
- **Fix B**: Run the snapshot read and the Draft RPCs in parallel inside `Promise.all`, then choose by status. For `/my-bonuses`, run the RPC and the select in parallel and keep the id as a post-check.
  - Strength: back to one parallel round for every page.
  - Tradeoff: approved pages also compute the live Draft figures and throw them away (two extra RPCs).
  - Confidence: HIGH — straightforward.
  - Blind spot: none significant.
- **Decision**: FIXED (Fix A) — snapshot read moved into the page Promise.all (Draft RPCs only without a snapshot); listMyBonuses runs the RPC and select in parallel with a post-filter. Verified on preview: approved, Draft and /my-bonuses render correctly.

### F2 — Notify can double-send or over-count in rare races

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Reliability)
- **Location**: supabase/functions/notify-milestone-approved/index.ts:152, 276-293, 308
- **Detail**:
  - Two concurrent notify calls read the same unsent lines. With Resend, the identical `Idempotency-Key` dedupes them, but the second call can get a `409 concurrent_idempotent_requests`, which counts as failed and shows a misleading partial notice.
  - `stamp` adds `ids.length` to `sent` even when `.is("notified_at", null)` updated 0 rows, so counts can be inflated.
  - Duplicates remain possible in three cases:
    - after a stamp failure and a retry more than 24h later;
    - when chunking a set of more than 100 lines changes between retries;
    - when the email body changes between retries (live `full_name` or activation), which makes Resend reject the reused key.
- **Fix A ⭐ Recommended**: Claim lines atomically before sending, then stamp the claimed ids after the provider confirms; count `sent` from the rows the stamp actually updated.
  - How: set a claim with `update … set notify_claimed_at = now() where milestone_id = $1 and notified_at is null and (notify_claimed_at is null or notify_claimed_at < now() - interval '10 minutes') returning …` (new nullable column, written by the function only).
  - Strength: removes concurrent double-send and the count inflation for any transport.
  - Tradeoff: one more column and migration; a stale-claim timeout to reason about.
  - Confidence: MED — standard claim pattern, but it adds a migration after Phase 1.
  - Blind spot: interaction with the 24h idempotency window is not tested.
- **Fix B**: Keep the design; only count `sent` from the rows actually updated (`.select("id")` on the stamp), and document the residual window in the function header.
  - Strength: a tiny change; the counts become truthful.
  - Tradeoff: the concurrent and over-24h double-send windows stay (rare: manual re-send only).
  - Confidence: HIGH.
  - Blind spot: none significant.
- **Decision**: FIXED (Fix A) — new migration 20261006120000_result_lines_notify_claim.sql (notify_claimed_at); the function claims unsent lines with one atomic UPDATE ... RETURNING (stale after 10 min), counts sent from rows actually stamped, releases unconfirmed claims. pgTAP +1 (column not writable by authenticated; 349 pass). Verified locally: 4 concurrent calls → 1 email; fresh claim respected, stale claim taken over; Mailpit stopped → 502 with claim released, immediate re-send delivers.

### F3 — Non-ASCII `next` passes validation and yields a garbled Location header

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/safe-next.ts:12-20; src/pages/api/auth/signin.ts:26
- **Detail**:
  - `next=/ą` passes `safeNext`. The redirect sends raw UTF-8 bytes in `Location`; verified on the workerd preview, it does not crash, but the header is mangled.
  - It is not an open redirect: the target stays on the same origin.
  - Real routes are ASCII, and middleware-generated values are already URL-encoded.
- **Fix**: Restrict `safeNextSchema` to printable ASCII (`/^[\x21-\x7e]+$/`), so non-ASCII falls back to `/`.
- **Decision**: FIXED — safeNextSchema now requires printable ASCII (replaces the control-character check); "/ą", "/a b", "/a b" fall back to "/", URL-encoded paths still pass.

### F4 — Missing APP_URL silently sends relative links

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: supabase/functions/notify-milestone-approved/index.ts:271
- **Detail**: When `APP_URL` is unset, emails go out with a relative `/my-bonuses` link that doesn't work in mail clients. The README documents the variable, but nothing fails fast.
- **Fix**: Treat a missing `APP_URL` as `email_not_configured`, logged and returned before any send.
- **Decision**: FIXED — a missing/blank APP_URL now returns 500 email_not_configured (logged) before any claim or send; header comment and contract row updated.

### F5 — Email copy says "completed milestone"

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: supabase/functions/notify-milestone-approved/index.ts:112, 126
- **Detail**: The user decided that approval is allowed from planned, active or completed, but the email says "Your bonus for a completed milestone has been approved."
- **Fix**: Reword to "Your bonus for this milestone has been approved."
- **Decision**: FIXED — both email bodies now read "Your bonus for this milestone has been approved."

### F6 — Project handover now exposes approved results to the new owner (undocumented)

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: supabase/migrations/20261005120000_milestone_approval.sql:546-553; docs/reference/contract-surfaces.md
- **Detail**:
  - MR012 now treats approved milestones as closed, so an Admin can hand over a project whose approved milestones hold the old owner's employees.
  - Through `owns_milestone`, the new owner then reads those frozen lines (names, bonuses) and can re-send their emails.
  - This is consistent with results being scoped to the project, but it is not stated anywhere.
- **Fix**: Add one sentence to the migration header and to the contract-surfaces Privacy split rule: approved results follow project ownership.
- **Decision**: FIXED — contract-surfaces.md Privacy split rule now states that approved results follow project ownership (committed migration left untouched).
