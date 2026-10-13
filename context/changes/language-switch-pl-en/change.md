---
change_id: language-switch-pl-en
title: Polish translation of all app text with a PL/EN language switch on the first page
status: implemented
created: 2026-10-13
updated: 2026-10-13
archived_at: null
---

## Notes

Translate all application text to Polish. Enable switch form EN to PL and PL to EN directly from first page of aplication

Manual production step (Phase 5): the hosted Supabase dashboard invite template (Authentication → Email Templates → Invite user) must be updated by hand with the body of `supabase/templates/invite.html` and the subject "Zaproszenie do Meritly"; `supabase/config.toml` only covers local Supabase.
