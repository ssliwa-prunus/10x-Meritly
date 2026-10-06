-- Approval-email send claim (S-05 impl-review F2). notify-milestone-approved claims a milestone's
-- unsent lines with one atomic UPDATE ... RETURNING before it sends, so two concurrent calls (a
-- double-clicked re-send, an approve racing a re-send) never email the same line twice: under READ
-- COMMITTED the second UPDATE re-checks its WHERE after the first commits and claims nothing.
--
--   claim:   set notify_claimed_at = now() where notified_at is null and the claim is free or stale
--   success: set notified_at = now() (the claim stays as history)
--   failure: set notify_claimed_at = null, so a re-send can retry at once
--
-- A claim older than 10 minutes counts as abandoned (the function died between claim and stamp)
-- and can be taken over. Written only by the Edge Function with the secret key: authenticated keeps
-- no insert/update privilege on milestone_result_lines (20261005120000_milestone_approval.sql).

alter table public.milestone_result_lines add column notify_claimed_at timestamptz;
