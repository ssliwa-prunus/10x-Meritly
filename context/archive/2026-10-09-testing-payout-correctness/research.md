---
date: 2026-10-09T17:08:17+02:00
researcher: Claude (Opus 5.5) for ssliwa
git_commit: ecbb6fe
branch: develop
repository: 10x-Meritly
topic: "Test rollout Phase 2 — payout correctness, approval freeze and supervisor flags (risks #3, #4, #7)"
tags: [research, testing, pgtap, payouts, approval, budget-exposure, time-share]
status: complete
last_updated: 2026-10-09
last_updated_by: Claude (Opus 5.5) for ssliwa
---

# Research: Test rollout Phase 2 — payout correctness, approval freeze and supervisor flags

**Date**: 2026-10-09T17:08:17+02:00
**Researcher**: Claude (Opus 5.5) for ssliwa
**Git Commit**: ecbb6fe (working tree has uncommitted `.claude/skills/**` edits only; cited `src/` and `supabase/` files are as committed)
**Branch**: develop
**Repository**: 10x-Meritly

## Research Question

For `context/foundation/test-plan.md` §3 Phase 2 (risks #3, #4, #7), ground the "Context `/10x-research` must ground" column of §2 Risk Response Guidance:

- **#3** — where the payout computation runs (TS vs SQL), where inputs are validated server-side vs only in the form, and which boundary cases are already proven.
- **#4** — what approval persists as a snapshot and whether any read path recomputes from live config.
- **#7** — how worst-case budget exposure is aggregated, the definition of an "active" milestone, and the flags' boundary predicates.
- Decide whether Phase 2 needs to bootstrap Vitest ("if the logic lives in TS").

## Summary

1. **All payout and flag arithmetic lives in SQL.** The multiplier, payout pool, per-line bonus, residual and `within_pool` are computed by four `stable`, `security invoker` SQL/PLpgSQL functions (`kpi_multiplier`, `capped_payout_pool`, `milestone_payout_lines`, `milestone_payout_summary`); both supervisor flags are `security_invoker` views. TS reads results and states it does no money arithmetic (`src/lib/services/payouts.ts:112-114`). **Consequence for Phase 2:** risks #3, #4 and #7 are cheapest to cover in pgTAP. The only TS logic touching these risks is zod input validation (duplicating DB CHECKs) and one display-only share division (`src/lib/services/approvals.ts:264,279`). Bootstrapping Vitest is therefore _optional_ for Phase 2 — see Open Questions Q1.
2. **The independent oracle exists and reproduces.** PRD Business Logic (`context/foundation/prd.md:134-150`) plus the S-04 linear KPI→M mapping and Phase 5 worked table give hand figures. I recomputed the three default-config rows independently in integer grosze (node, not SQL) and they match the archive: 9 134.61 / 5 384.61 / 10 000.00 pools with bonuses 3 943.51 / 3 470.29 / 1 720.80, etc.
3. **Existing pgTAP already covers the main worked example, min/max multiplier, "different KPI → different totals", equal-weight rounding, score range rejection, and the freeze after config edits** (`milestone_payouts.test.sql`, `milestone_approval.test.sql`). Phase 2 is therefore a _gap-filling_ phase, not a greenfield one. The gaps are listed per risk below.
4. **Σ bonus ≤ payout pool ≤ target pool is enforced by CHECK only on the approval snapshot** (`20261005120000_milestone_approval.sql:74-77`, SQLSTATE 23514). For Draft results it holds by construction (truncating `div` in integer grosze) and is merely reported as `within_pool`.
5. **Latent freeze gap (risk #4):** `milestone_payout_summary` / `milestone_payout_lines` do not check milestone status and are granted to `authenticated`; called directly for an Approved milestone they recompute from live config. The app never does this — the supervisor page branches on `status === "approved"` (`src/pages/projects/[id]/milestones/[milestoneId].astro:87`) and employees read only the snapshot — so Approved figures _as shown_ are frozen, but the guarantee is page-level, not DB-level.
6. **Latent flag gap (risk #7):** `employee_time_share_totals` filters on milestone status only, so engagements on `planned`/`active` milestones inside a **cancelled or completed project** still count toward the >100 % flag. A fixture for exactly this case exists (`employees_rls.test.sql`, engagement `…0446`) but nothing asserts on it.

## Detailed Findings

### Risk #3 — payout computation and server-side validation

**Formula as implemented** (current definitions: `supabase/migrations/20261004130000_milestone_payout_hard_cap.sql`, abbreviated CAP; `20261004120000_milestone_kpi_and_payouts.sql`, KPI):

| Step                  | SQL                                                                                                                                         | Anchor      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| M                     | `least(max, greatest(min, min + (wS·S + wB·B + wQ·Q + wR·R)·0.01·(max−min)))`; `strict` → null if any score missing; Ryzyko higher = better | KPI:105-128 |
| payout pool           | `div(target·100·(M·1e6), max·100·1e4)·0.01` = floor to grosz of target·M/max                                                                | CAP:28-39   |
| e_i (display)         | `time_share·role_weight·rating_factor`                                                                                                      | CAP:132     |
| e_scaled (split)      | `(ts·100)(rw·100)(rf·100)` — exact integer                                                                                                  | CAP:133     |
| share (display)       | `e_scaled / Σ e_scaled`                                                                                                                     | CAP:150     |
| bonus                 | `div(pool_grosze·e_scaled, Σ e_scaled)·0.01` — floor to grosz                                                                               | CAP:151-153 |
| residual, within_pool | `pool − Σ bonus`; `Σ bonus <= pool` (flag only)                                                                                             | CAP:169-219 |

- Rounding unit is the grosz (0.01 PLN), matching PRD `prd.md:146`.
- Unresolvable role weight or invisible `bonus_settings` raises P0001 rather than silently splitting among fewer people (CAP:83-98; asserted `milestone_payouts.test.sql:512-527`).
- Σ e_scaled = 0 is unreachable when ≥1 line exists: time_share, role weight and rating factor are all CHECKed > 0 (ENG:71,76; CFG:18,26,47-51). Zero engagements → no lines, no division.
- M ≤ max holds because KPI weights must sum to exactly 1 (CFG:59-61); the clamp is an unreachable fallback while that CHECK stands.
- Overflow: intermediates are unbounded `numeric`; inputs are `numeric(12,2)` (max 9 999 999 999.99) so the snapshot columns (also `numeric(12,2)`) always fit since pool ≤ target.

**Hard guards (snapshot only)** — `milestone_results` CHECKs at `20261005120000_milestone_approval.sql:74-77`: `payout_pool >= 0`, `payout_pool <= target_pool`, `0 <= payout_total <= payout_pool`, `residual = payout_pool − payout_total`; lines `bonus >= 0` (APR:114). No constraint ties Σ line bonuses to the header's `payout_total`; no CHECK that stored M ∈ [min, max].

**Server-side validation per input** (DB first, zod second):

| Input                     | DB                                            | zod                                         |
| ------------------------- | --------------------------------------------- | ------------------------------------------- |
| KPI scores                | smallint 0–100, all-or-none (KPI:49-55)       | `^(100\|[1-9]?[0-9])$` (`payouts.ts:64-65`) |
| KPI weights               | numeric(3,2) ∈ [0,1], Σ = 1 (CFG:41-44,55-61) | `bonus-config.ts:86-87,99-117`              |
| min/max M                 | 0 < min < max ≤ 3 (CFG:45-46,62-64)           | `bonus-config.ts:82-83,113-115`             |
| rating factors            | (0,3], non-decreasing (CFG:47-51,65-75)       | `bonus-config.ts:120-140`                   |
| role weight               | (0,3] (CFG:18,26)                             | `bonus-config.ts:91`                        |
| time_share                | numeric(3,2) ∈ (0,1] (ENG:71,76)              | `engagements.ts:70`                         |
| rating                    | smallint 1–5 (ENG:72,77)                      | `engagements.ts:77-78`                      |
| target_pool, total_budget | numeric(12,2) > 0 (PRJ:42,52,75,84)           | `projects.ts:76,93-95`                      |

Within the inspected migrations and services, every formula input has a DB range CHECK; the only TS-only rule is "at most 2 decimals" (`src/lib/forms.ts:49-59`) — the DB rounds extra decimals into `numeric(p,2)` instead of rejecting them, which cannot break the ceilings. Out-of-range rejection tests already exist in `bonus_config_rls.test.sql:227-262`, `employees_rls.test.sql:265-296`, `projects_rls.test.sql:188-200`, `milestone_payouts.test.sql:357-380`.

**Existing coverage in `milestone_payouts.test.sql`** (plan of 55; expected values are hand literals from the worked example, except `budget_share = round(multiplier/1.30, 6)` at :236 which mirrors the implementation):

- Present: M for 80/90/85/60, all-0, all-100, risk-up, missing score (:156-179); `capped_payout_pool(10000,1.1875)=9134.61` (:180-184); worked example pool/total/residual/bonuses (:228-255); identical engagement, different KPI → different totals at 0s, 100s and risk 90 (:262-318); equal weights 3 × 33.33 residual 0.01 (:331-342); no engagements (:343-352); score range and all-or-none 23514, MR013, MR003 (:357-405).
- Absent: single employee gets the whole pool (residual 0); pools near 9 999 999 999.99; non-default config in a Draft recompute (KPI weights, `multiplier_max ≠ 1.30`, factors); extreme weights/factors (3.00) and min time_share (0.01) with a bonus flooring to 0.00; many lines where residual approaches n−1 grosze; a generic "Σ bonus ≤ pool ≤ target" property over varied inputs.

### Risk #4 — approval freeze

- **What approval writes:** `approve_milestone(uuid)` (`security definer`, APR:282-393) checks ownership (42501), locks the milestone `for update`, refuses MR015 (already approved) / MR014 (cancelled, unscored, no engagements), then inserts header `milestone_results` (APR:52-78) and lines `milestone_result_lines` (APR:93-116) in one data-modifying CTE from the same `milestone_payout_lines` rows (APR:324-386), then sets `status = 'approved'` (APR:389-391). An MR003 on that update rolls the snapshot back (asserted `milestone_approval.test.sql:310-322`).
- **Snapshot content:** header stores names, `target_pool`, four KPI scores, `multiplier`, `multiplier_min`, `multiplier_max`, `budget_share`, `payout_pool`, `payout_total`, `residual`, `engagement_count`; lines store names, `time_share`, `role_weight`, `rating`, `rating_factor`, `weighted_contribution`, `multiplier`, `bonus` (no share/pool, privacy split APR:18-26). KPI weights are not stored (folded into `multiplier`). No FK to `job_roles` or `bonus_settings` — config cannot cascade into the snapshot.
- **Edits blocked after approval:** any milestone column incl. un-approve → MR015 (`milestones_check_frozen`, APR:252-255); engagement insert/update/delete → MR007 (closed set incl. `approved`, APR:519-522); milestone/employee delete → no API delete policy plus `on delete restrict` FKs. `milestones_check_frozen` does not fire on DELETE.
- **Edits allowed with no snapshot effect:** `bonus_settings` (weights, bounds, factors), `job_roles` (weight, rename, archive), employee name/role, project rename/status/owner.
- **Read paths:** supervisor page reads the snapshot for Approved (`approvals.ts:233-287`) and errors rather than falling back to live if the header is missing (`[milestoneId].astro:94-101`); `/my-bonuses` reads only `milestone_result_lines` (`approvals.ts:370-409`); `notify-milestone-approved` takes `bonus` from the snapshot and only email/name from a live join; `project_budget_exposure` reads stored `payout_pool`. The Assignments table on the supervisor page reads live names (`engagements.ts:193,233-234`) — names only, no money.
- **Latent gap:** live RPCs (CAP:48-222, granted to `authenticated` at CAP:222) accept an Approved id and recompute from live config. Not reachable via any page; reachable via PostgREST by the owning Supervisor/Admin. Not a correctness bug in what users see, but the freeze is not a DB-level guarantee on those functions.
- **Draft reflects live config:** yes — nothing is stored before approval; all four functions read `bonus_settings`/`job_roles` per call.
- **Existing coverage in `milestone_approval.test.sql`:** snapshot = live Draft output just before approval (differential, :131-136, :370-390); hand literals for header and lines (:346-363); Σ bonus = total ≤ pool ≤ target (:391-400); **freeze after editing KPI weights, `multiplier_max`, factors, job-role weight/name, employee name/role, project name — hand literals unchanged** (:422-465); MR015/MR007 refusals (:473-517); snapshot CHECK 23514 (:207-242); budget view after approval 12 134.61 (:529-533).
- **Absent:** "Draft milestone reflects the new config" (no test re-reads a Draft after a config edit); live RPC on an Approved id (neither divergence nor block pinned); rating-only update on an approved engagement (same trigger as time_share, untested separately); approval concurrent with config/engagement writes.

### Risk #7 — supervisor flags

**Budget exposure (FR-017)** — view `project_budget_exposure`, `security_invoker` (APR:590-616, verified):

- `reserved_total = Σ (approved ? coalesce(stored payout_pool, target_pool) : target_pool)` over milestones with `status <> 'cancelled'`; `over_budget = reserved_total > total_budget` (strict: equality is not over).
- `completed`, `planned`, `active` and unscored milestones reserve the full `target_pool`; no milestones → 0. Project status is ignored.
- History: S-02 reserved `target × multiplier_max`; corrected 2026-10-04 to `target_pool` (CAP:1-21); S-05 swapped in the stored pool for Approved.
- Covered: 6000/8000 reserve, equality → false, 0.01 over → true, `multiplier_max` change does not move the reservation, empty project (`projects_rls.test.sql:285-328,409-415`); 13 000 → 12 134.61 after approval (`milestone_approval.test.sql:268-272,529-533`).
- Absent: `over_budget` asserted on a mix of Approved and non-Approved (project budget there is 100 000, far from the boundary); approval flipping the flag from true to false; `completed` milestone reserving at target; fallback when the snapshot is invisible; closed-project behaviour; cross-project isolation of totals.

**Time-share (FR-011)** — view `employee_time_share_totals`, `security_invoker` (APR:568-578, verified):

- `open_total = Σ time_share` over engagements whose milestone status ∉ {completed, cancelled, approved}; `over_allocated = open_total > 1` (strict: exactly 1.00 is not flagged).
- "Active" = `planned` or `active`; no date-overlap logic — user decision 2026-09-29 (`context/archive/2026-09-29-supervisor-assigns-employee-engagement/research.md:290-303`); `approved` added to the closed set by S-05.
- Scope via RLS: a Supervisor's total covers only their own milestones (accepted tradeoff — 0.6 + 0.6 across two Supervisors flags for neither); Admin sees all; employees get no rows; no row → TS falls back to 0/false (`engagements.ts:214-236`, `employees.ts:197-237`).
- Covered: 1.10 → true with completed excluded, 0.50 → false (`employees_rls.test.sql:378-389`); Admin exactly 1.00 → false across two Supervisors (:524-535); 1.20 → 0.70 after approval (`milestone_approval.test.sql:273-277,534-538`).
- Absent: cancelled milestone excluded; 1.01 just-over isolated; planned-only total; engagements inside a closed project (latent issue, fixture EA3/`…0446` exists unasserted); the cross-Supervisor non-flag as an explicit >1 case.

### Vitest decision input

Pure TS candidates within `src/lib` (none compute payouts or flags):

- `src/lib/forms.ts:48-59` — `toHundredths`, `hasAtMostTwoDecimals`, `decimalField` (float-safe decimal parsing that every weight/time-share input relies on; the "≤ 2 decimals" rule is TS-only).
- `src/lib/services/bonus-config.ts:82-140` — weights sum to 100 hundredths, min < max, non-decreasing factors.
- `src/lib/services/engagements.ts:69-80`, `src/lib/services/projects.ts:79-95`, `src/lib/services/payouts.ts:59-77` — range schemas.
- `src/lib/services/approvals.ts:264,279` — display-only share rebuild, 0 when total is 0.

These duplicate DB CHECKs already tested in pgTAP; a Vitest suite would add signal mainly on the float-safe decimal parsing (`0.1+0.2`-style inputs, `1e1`, leading zeros). Risk #3's "server-side validation parity" is already proven at the DB layer.

## Code References

- `supabase/migrations/20261004120000_milestone_kpi_and_payouts.sql:105-128` — `kpi_multiplier`
- `supabase/migrations/20261004130000_milestone_payout_hard_cap.sql:28-39` — `capped_payout_pool` (single home of the hard-cap rule)
- `supabase/migrations/20261004130000_milestone_payout_hard_cap.sql:48-222` — `milestone_payout_lines` / `milestone_payout_summary` (no status check)
- `supabase/migrations/20261005120000_milestone_approval.sql:52-116` — snapshot tables and CHECKs
- `supabase/migrations/20261005120000_milestone_approval.sql:227-272` — `milestones_check_frozen`
- `supabase/migrations/20261005120000_milestone_approval.sql:282-393` — `approve_milestone`
- `supabase/migrations/20261005120000_milestone_approval.sql:568-616` — `employee_time_share_totals`, `project_budget_exposure`
- `src/pages/projects/[id]/milestones/[milestoneId].astro:81-106` — Approved vs Draft read branch
- `src/lib/services/approvals.ts:233-287,370-409` — snapshot reads (supervisor, employee)
- `supabase/tests/milestone_payouts.test.sql` — formula suite (`…05xx` fixtures)
- `supabase/tests/milestone_approval.test.sql` — approval/freeze suite (`…06xx` fixtures)
- `supabase/seed.sql:16-18` — fixture UUID range registry (01xx–07xx used; `…08xx` next free)

## Architecture Insights

- **SQL is the single computation home.** Draft = live RPCs; Approved = snapshot tables written once by a definer function in one statement. Tests should target the DB functions/views directly as the signed-in role, matching §6.1 harness conventions.
- **Exact integer-grosze arithmetic** (`div` on scaled integers) is the design that makes Σ ≤ pool hold by construction; a test that recomputes with floating point can disagree by a grosz — oracles must be computed in integer grosze or hand-written.
- **Flags are informational** (PRD FR-010 L98-99, FR-011 L101): strict `>` predicates; tests must pin equality as _not_ flagged.
- **Harness conventions** from Phase 1 apply unchanged: `begin; plan(N); … finish(); rollback;`, identity via `set local role authenticated; set local request.jwt.claims`, clear claims after `reset role`, `@pgtap.test` emails, fixtures scoped by UUID range. Recipes to copy: approved-milestone fixture `milestone_approval.test.sql:57-70,132-345`; injected snapshot `:671-694`.

## Historical Context (from prior changes)

- `context/archive/2026-10-04-supervisor-scores-milestone-and-sees-computed-bonuses/plan.md:7,388-397` — Phase 5 hard-cap amendment and the current worked table (supported; recomputed independently). **Stale:** old-rule figures at `plan.md:41-44,118-119,370,592` (pool 11 875.00 etc.) are contradicted by the hard cap — do not use as oracle.
- `…/2026-10-04-…/plan-brief.md:21-22,76` — linear KPI→M mapping and Ryzyko higher = better (accepted departure from the spreadsheet). Supported by KPI:105-128.
- `context/archive/2026-09-26-admin-configures-bonus-rules/plan.md:36` — "store the config values on result rows to keep Approved frozen". Supported by APR:52-116.
- `context/archive/2026-10-05-supervisor-approves-milestone-employee-sees-bonus/plan-brief.md:108` — open risk "one snapshot relies on stable functions"; mitigated by the differential pgTAP check (supported).
- `context/archive/2026-10-07-testing-rls-matrix/plan.md:69` — explicitly hands payout/freeze tests to this phase.
- `context/foundation/roadmap.md:112,211` — still say non-Approved milestones reserve `target × maximum`. **Contradicted** by `roadmap.md:105`, PRD `prd.md:116-118` and APR:590-616. `src/components/projects/BudgetExposurePanel.astro:35-36` copy omits the Approved rule (display text only).
- PRD `prd.md:46` reads as a hard "never exceeds 100 %"; FR-011 (`prd.md:101`) and US-01 (`prd.md:63`) make it an informational flag — implementation follows FR-011.

## Related Research

- `context/archive/2026-10-07-testing-rls-matrix/research.md` — RLS harness and fixture conventions.
- `context/archive/2026-09-29-supervisor-assigns-employee-engagement/research.md` — "active milestone" decision.

## Open Questions

1. **Vitest in Phase 2?** Test-plan §3 says "bootstrap Vitest if the logic lives in TS". It does not: payout, freeze and flags are SQL. Options: (a) pgTAP only, move the Vitest bootstrap to Phase 3 (where route-gating logic in `middleware.ts`/`safe-next.ts` is TS); (b) bootstrap Vitest now with a small suite on `src/lib/forms.ts` decimal parsing. §5 marks "Vitest unit + integration" as "required after §3 Phase 2" — whichever is chosen, the plan must update that gate row. Product decision for `/10x-plan`.
2. **Live RPCs on Approved milestones** — test-only (pin current behaviour / document as accepted) or harden (make the functions refuse or redirect to the snapshot for `approved`)? Hardening is a migration and touches the catalog guard + matrix (§6.1 rule).
3. **Time-share in closed projects** — is counting engagements on open milestones inside a cancelled/completed project intended? PRD is silent ("active milestones"). If not intended, it is a fix (view change) found by this phase, analogous to Phase 1's F1/F2.
4. **Budget exposure for closed projects** — project status is ignored; likely intended (a completed project still shows its exposure) but unrecorded.
5. **Fixture range** — `…08xx` is next free per `supabase/seed.sql:16-18`; a new suite should register it there.
