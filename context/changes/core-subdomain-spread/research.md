---
date: 2026-10-31
researcher: Claude (Sonnet 5.5) for ssliwa
git_commit: bd2fcdd
branch: develop
repository: 10x-Meritly
topic: "Jak głęboko subdomena Core jest dziś rozsmarowana po warstwach"
tags: [research, codebase, core, payout, approval, layers]
status: complete
last_updated: 2026-10-31
last_updated_by: Claude (Sonnet 5.5)
---

# Research: rozsmarowanie subdomeny Core po warstwach

**Date**: 2026-10-31 · **Git Commit**: bd2fcdd · **Branch**: develop

## Research Question

`context/domain/01-domain-distillation.md` §2 uznaje za Core: (A1) skalowanie puli KPI i podział proporcjonalny, (A2) zatwierdzenie → zamrożenie → podział widoczności. Jak daleko te dwa agregaty wychodzą dziś poza jedno miejsce, w podziale na warstwy (SQL, Edge, serwisy TS, helpery, UI, testy)?

## Summary

Arytmetyka wzoru jest w jednym języku (SQL), ale reguły Core są powielone w trzech warstwach. Dla inspected paths:

- **Wzór (A1)**: jedna definicja kwoty puli (`capped_payout_pool`) i jedna definicja podziału na linie (`milestone_payout_lines`), ale **3 wywołania** `capped_payout_pool` w aktualnych definicjach (lines, summary, `approve_milestone`) i **2 niezależne wyliczenia `budget_share`** (summary, approve). `milestone_payout_lines` była w migracjach definiowana w całości **3 razy** (kpi_and_payouts → hard_cap → refuse_approved); żywa jest ostatnia.
- **Reguły zatwierdzania (A2)**: warunki wstępne `approve_milestone` (MR014/MR015/MR003/42501) są **ręcznie odtworzone w TS w dwóch miejscach** (strona kamienia, `dashboard.ts`), a lokalna lista „zamknięty” jest w trzecim.
- **Przeliczenia w TS istnieją**, wbrew zdaniu z destylacji („Aplikacja TS niczego nie przelicza”): `share` jest odtwarzany z `weighted_contribution`, `within_pool` liczony ponownie, dashboard sumuje i liczy procenty. Nie jest to wzór premii, tylko wyprowadzenia z jego wyników.
- **E-mail (Edge)** tylko formatuje `bonus` z linii snapshotu; nie liczy.

## Detailed Findings

### 1. SQL — wzór (A1)

- `kpi_multiplier`: `supabase/migrations/20261004120000_milestone_kpi_and_payouts.sql:105` (jedyna definicja; wołana z lines `20261009120000_payout_rpcs_refuse_approved.sql:51`, summary `:211`, approve `20261005120000_milestone_approval.sql:347`).
- `capped_payout_pool`: definicja `20261004130000_milestone_payout_hard_cap.sql:28`, zaokrąglenie `div(...)` w `:36`. Wywołania w żywych definicjach: `…refuse_approved.sql:85` (lines), `:215` (summary), `…milestone_approval.sql:342` (approve). Każde ma własne przeskalowanie (`* 100` lub `round(…, 2)`); komentarz „already floored” powtórzony w `…refuse_approved.sql:83,214` i `…milestone_approval.sql:341`.
- Podział na linie: żywe `milestone_payout_lines` w `…refuse_approved.sql:24-142`; `div(v_pool_grosze * e_scaled, total_scaled) * 0.01` w `:136`; `case e.rating` w `:98-104`.
- Zastąpione pełne kopie tej funkcji: `…kpi_and_payouts.sql:145`, `…hard_cap.sql:48` (`case e.rating` `:115`, `div` `:153`). Nie są żywe, ale każda zmiana wzoru wymagała dotąd przepisania całego ciała.
- `budget_share = round(multiplier / multiplier_max, 6)` liczony niezależnie w summary (`…refuse_approved.sql:203`) i w approve (`…milestone_approval.sql:340`).
- `money_floor_mul` (`20260927120000_projects_and_milestones.sql:20-24`) to martwy, trzeci mechanizm zaokrąglania (D11 w destylacji).

### 2. SQL — zatwierdzenie i snapshot (A2)

- `approve_milestone`: `…milestone_approval.sql:282-393`. Snapshot nagłówka i linii powstaje z jednego CTE (`:324-386`). Linie bierze z `milestone_payout_lines` (`:353`), a **pulę i `budget_share` liczy osobno** w `src` (`:340-342`), nie z summary. Zgodność nagłówka z liniami zapewnia wspólny `capped_payout_pool` i wspólna migawka transakcji, nie wspólna funkcja wyniku.
- Zamrożenie: trigger `milestones_check_frozen` (`:227`); linie czytelne dla pracownika przez RLS i `is_approved_milestone` (`:150`, polityka `:210-217`).
- Zbiór „zamknięty” (granica Core↔Planowanie) w SQL: 3 żywe funkcje w `…milestone_approval.sql` (`:458`, `:519`, `:552`) plus widok w `20261009130000_time_share_excludes_closed_projects.sql:26-27`, który zastąpił wersję z `…milestone_approval.sql:577`. Razem 4 żywe kopie, zgodnie z A4 w destylacji.
- `project_budget_exposure` (`…milestone_approval.sql:590-616`) niezależnie koduje regułę „approved → payout_pool snapshotu, inaczej target_pool”.

### 3. Serwisy TS (`src/lib/services`)

- `approveMilestone` jest cienkie: jedno `rpc("approve_milestone")` i mapowanie kodów (`approvals.ts:280-288`, mapa `:197`). Nie powiela reguł.
- Przeliczenia pochodne:
  - `share` linii zatwierdzonej = `weighted_contribution / Σ weighted_contribution` (`approvals.ts:336,351`); w SQL `share` to `e_scaled / total_scaled` (`…refuse_approved.sql:133`). Dwa wzory na to samo w dwóch językach; snapshot nie przechowuje `share` celowo (privacy split, `types.ts:146-147`).
  - `within_pool = payout_total <= payout_pool` (`approvals.ts:272`); SQL liczy to samo w summary (`…refuse_approved.sql:207`) i CHECK w nagłówku (`…milestone_approval.sql:76`).
- `payouts.ts:288-289` tylko woła RPC i mapuje (`:232-233`).

### 4. Czyste helpery TS

- `src/lib/dashboard.ts:36-39,86-115`: `UNAPPROVABLE_STATUSES`, `isScored`, `isApprovable`, `isAwaitingApproval` — ręczne odbicie warunków `approve_milestone` (komentarz „mirroring the Approve button”, `:106`). Pomija ownership (42501), więc to częściowa kopia.
- Ten sam plik liczy w groszach: `reservedBudget`, `floorPercent` (`:140-158`), `supervisorStats.paid_total` (`:188`). `history.ts:35` i `bonus-report.ts:46-50` sumują `bonus` analogicznie. Pomocnik `toGrosze` jest zdefiniowany osobno w `dashboard.ts:30`, `history.ts:10`, `bonus-report.ts:46` (3 definicje); `forms.ts:48` (`toHundredths`) i `projects.ts:134` robią pokrewne konwersje.

### 5. UI (Astro)

- `src/pages/projects/[id]/milestones/[milestoneId].astro:153-172`: drabinka `approvalBlockedReason`/`canApprove` — **druga ręczna kopia** warunków wstępnych `approve_milestone` (komentarz `:153-155`: „approve_milestone enforces the same rules … this only explains up front”). Używa m.in. `payoutSummary.scored` i `engagement_count === 0`.
- Ten sam plik: `isClosedStatus` (`:131-132`) — lokalna lista statusów zamkniętych obok `assignments.ts:22` i `dashboard.ts:36-39`.
- `PayoutSection.astro:56-59` renderuje `within_pool` (tylko wyświetlanie); `MilestonesSection.astro:39` ukrywa edycję dla `approved`.

### 6. Edge Functions

- `notify-milestone-approved/index.ts:107,114` tylko formatuje `line.bonus` (pl-PL/PLN); `:323` czyta `bonus` z `milestone_result_lines`. Brak arytmetyki Core. Reguła „tylko Approved, raz” jest tu (409 `not_approved`), nie w bazie (destylacja A2).

### 7. Testy

- SQL: `supabase/tests/payout_correctness.test.sql`, `milestone_payouts.test.sql`, `milestone_approval.test.sql`. TS: `src/lib/__tests__/dashboard.test.ts`, `src/lib/services/__tests__/{approvals,payouts}.test.ts`.
- Na podstawie listy plików i grepa po `approve_milestone`/`payout` nie znalazłem testu wiążącego TS-ową `isApprovable` ani drabinkę strony z faktycznym zachowaniem `approve_milestone`. Treści testów nie czytałem w całości, więc to brak znalezionego dowodu, nie dowód braku.

## Code References

- `supabase/migrations/20261004130000_milestone_payout_hard_cap.sql:28-39` — `capped_payout_pool`
- `supabase/migrations/20261009120000_payout_rpcs_refuse_approved.sql:24-142` — żywe `milestone_payout_lines`
- `supabase/migrations/20261009120000_payout_rpcs_refuse_approved.sql:152-223` — żywe `milestone_payout_summary` (własne `budget_share`, `within_pool`)
- `supabase/migrations/20261005120000_milestone_approval.sql:282-393` — `approve_milestone`
- `supabase/migrations/20261005120000_milestone_approval.sql:590-616` — `project_budget_exposure`
- `src/lib/services/approvals.ts:272,336,351` — `within_pool`, `share` liczone w TS
- `src/lib/dashboard.ts:36-39,86-115` — kopia warunków zatwierdzenia
- `src/pages/projects/[id]/milestones/[milestoneId].astro:131-172` — druga kopia + lista „zamknięty”
- `supabase/functions/notify-milestone-approved/index.ts:107-114` — tylko formatowanie

## Architecture Insights

Rozsmarowanie ma trzy odrębne rodzaje, których nie warto mieszać w jednym refaktorze:

1. **Powielenie arytmetyki w SQL**: `capped_payout_pool` ×3, `budget_share` ×2, historyczne kopie `milestone_payout_lines`. Ryzyko: dryf przy zmianie wzoru.
2. **Powielenie reguły „czy można zatwierdzić”** (TS ×2, SQL ×1). Baza i tak odrzuci (MR014/015/003), więc skutek błędu to zły UX, nie naruszenie niezmiennika.
3. **Wyprowadzenia z wyników w TS** (`share`, `within_pool`, sumy, procenty). Ryzyko niskie: bazują na zamrożonych liczbach.

Egzekwowanie niezmienników (suma ≤ pula, zamrożenie, widoczność) zostaje w bazie; rozsmarowanie dotyczy wyjaśniania i prezentacji.

## Historical Context (from prior changes)

Nie przeszukano `context/archive/**` pod kątem decyzji o układzie warstw. Komentarze w kodzie (`dashboard.ts:106`, `[milestoneId].astro:153-155`) sugerują, że kopie w TS były świadome, ale to nie jest zweryfikowane planem.

## Related Research

- `context/domain/01-domain-distillation.md` — wejście; poniższa korekta dotyczy jednego jego zdania.

## Korekta destylacji

- `01-domain-distillation.md:45` („Aplikacja TS niczego nie przelicza”): zawęzić. TS nie liczy wzoru premii, ale liczy `share` (`approvals.ts:351`), `within_pool` (`approvals.ts:272`) i odbija warunki zatwierdzenia (`dashboard.ts:93-116`, `[milestoneId].astro:156-172`).
- `01-domain-distillation.md:179,241` (zbiór „otwarty”: 4× SQL, 2× TS): liczba SQL (4) się zgadza. W TS jest dodatkowo `isClosedStatus` w `[milestoneId].astro:131-132`, czyli co najmniej 3 kopie, nie 2. Nie grepowano całego `src/components`.

## Open Questions

1. Czy duplikat warunków zatwierdzenia w TS ma zostać (UX bez round-tripu), czy ma wynikać z jednego źródła (np. RPC zwracające `can_approve`/`blocked_reason`)? Decyzja architektoniczna.
2. Czy pula i `budget_share` powinny wychodzić z jednej funkcji używanej przez summary i `approve_milestone`? Nie sprawdzano testem, że dwa obliczenia dają dziś identyczny wynik dla wszystkich wejść; oba to `round(M / multiplier_max, 6)` w odczytanym kodzie.
3. Nie przeczytano w całości `supabase/tests/*.sql` ani `tests/**` (luka w pkt 7).
