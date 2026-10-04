# Review follow-ups: supervisor-scores-milestone-and-sees-computed-bonuses

Queued from `reviews/impl-review.md` triage on 2026-10-04.

## F1: single-snapshot payout computation (hard requirement for S-05)

- **Source**: impl-review F1 (Fix B chosen). The Draft display is left as is.
- **Today**: `getMilestonePayout` (`src/lib/services/payouts.ts`) calls `milestone_payout_summary` and `milestone_payout_lines` as two parallel RPCs, which take two snapshots. The summary also runs `milestone_payout_lines()` internally, so the split is computed twice per page load. For Draft figures this is acceptable because every read recomputes them.
- **S-05 must**: compute the approved result (summary totals and every line) in **one statement/snapshot** and persist exactly those figures. Never use two independent calls whose totals could disagree with the stored lines.
- **S-05 must also snapshot**:
  - `multiplier_max`, alongside M, the role weights and the rating factors, because the payout pool is `floor(target × M / multiplier_max)` since `20261004130000_milestone_payout_hard_cap.sql`;
  - the payout pool itself, which `project_budget_exposure` must use for Approved milestones.
- **Optional**, while S-05 touches this: give the Draft page the same single-RPC shape so it stops computing the split twice.
