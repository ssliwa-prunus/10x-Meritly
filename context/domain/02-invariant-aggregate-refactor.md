---
title: Plan refaktoru — agregat MilestoneResult jako jedyny strażnik spójności zatwierdzonego wyniku
created: 2026-10-31
type: refactor-plan
---

# Plan refaktoru: zatwierdzony wynik jako jeden spójny agregat

Produkt to **plan**. Nie zmieniono żadnego kodu produkcyjnego. Cytaty `plik:linia` zweryfikowano w repo (2026-10-31, `develop`, `bd2fcdd`). Dokument rozwija `01-domain-distillation.md` (zwłaszcza §3 A2 i D-rozjazdy).

## 0. Kontekst

- Wymagania: `context/foundation/prd.md` (Guardrails l. 42–46, US-01 l. 50–63, FR-012/016/018 l. 102, 114, 119, Business Logic l. 134–150), `CLAUDE.md` (Invariants, RLS rules), `context/foundation/test-plan.md` (ryzyka #3–#5, l. 50–52, cookbook §6.1–6.2).
- Stack: Astro 7 SSR + React 19 + Supabase (Postgres, Auth, Edge Functions) na Cloudflare Workers (`context/foundation/tech-stack.md:22-39`).
- **Gdzie żyje logika domenowa:** w Postgresie. Wzór, zamrożenie i zatwierdzenie są funkcjami/triggerami SQL (`supabase/migrations/`); TS w `src/lib/services/` tylko czyta, mapuje SQLSTATE na komunikaty i wyświetla (`src/types.ts:146-147`: „display them, never recompute them”).
- **Konsekwencja dla projektu:** „agregat” w tym repo nie może być klasą TS liczącą na nowo reguły — to byłaby druga kopia niezmiennika, czyli dokładnie to, czego plan ma uniknąć. Agregat jest więc **rezydentny w bazie** (jedyny mutator + ograniczenia), a po stronie TS powstaje cienki port (repozytorium + typowane błędy), który niczego nie przelicza, tylko odmawia wyświetlenia niespójnych danych.
- Dyscyplina testowa: test-first pgTAP (`supabase/tests/`, `npx supabase test db`) i Vitest (`npm test`); hook Stop uruchamia je po zmianie migracji (`CLAUDE.md`, sekcja Commands `test:hooks`). Rejestr kontraktów: `docs/reference/contract-surfaces.md`.

---

## 1. Niezmienniki biznesowe (identyfikacja)

| ID         | Niezmiennik                                                                                                                                                                                                           | Źródło dokumentu                                                                            | Źródło w kodzie                                                                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INV-01     | Σ premii ≤ pula do wypłaty ≤ pula docelowa                                                                                                                                                                            | `prd.md:44`, `:59`                                                                          | `20261004130000_milestone_payout_hard_cap.sql:28-39`, `:153`; CHECK-i `20261005120000_milestone_approval.sql:75-76`                                                  |
| INV-02     | Mnożnik skaluje pulę, nie wagi pracowników                                                                                                                                                                            | `prd.md:148`, `:60`                                                                         | `…hard_cap.sql:36`, `:129-135`                                                                                                                                       |
| INV-03     | Zatwierdzony kamień jest nieodwracalnie zamrożony; zmiany wag/mapowania działają tylko w przód                                                                                                                        | `prd.md:70`, `:72`, `:76`; `CLAUDE.md` Invariants                                           | `milestones_check_frozen` `…milestone_approval.sql:227-272`; żywe RPC odmawiają (MR015) `20261009120000_payout_rpcs_refuse_approved.sql:1-21`                        |
| INV-04     | Kamień przechodzi w „approved” tylko przez `approve_milestone`, atomowo, i tylko gdy ma KPI i ≥1 przypisanie                                                                                                          | `prd.md:119`, `:54`                                                                         | `…milestone_approval.sql:257-262`, `:297-321`, `:324-391`                                                                                                            |
| **INV-05** | **Zatwierdzony wynik jest jedną całością: nagłówek (`payout_total`, `engagement_count`, `multiplier`) zgadza się z liniami, każdy zatwierdzony kamień ma nagłówek i ≥1 linię, a snapshot po zapisie się nie zmienia** | wynika z `prd.md:59` + `:102` (to, co widzi pracownik, jest tym, co przełożony zatwierdził) | tylko konwencja jednej instrukcji CTE `…milestone_approval.sql:28-33`, `:324-386`; weryfikacja ex post w teście `supabase/tests/milestone_approval.test.sql:391-399` |
| INV-06     | Pracownik widzi tylko własne linie zatwierdzonego kamienia                                                                                                                                                            | `prd.md:45`, `:129`; `CLAUDE.md` RLS                                                        | polityka `…milestone_approval.sql:210-217`                                                                                                                           |
| INV-07     | Linie nie niosą puli/sumy/reszty/udziału (nie da się wyliczyć cudzych kwot)                                                                                                                                           | `prd.md:129`                                                                                | schemat `…milestone_approval.sql:18-26`, `:93-116`                                                                                                                   |
| INV-08     | E-mail tylko dla zatwierdzonego, raz, tylko własna kwota                                                                                                                                                              | `prd.md:114`, `:54`                                                                         | funkcja Edge `supabase/functions/notify-milestone-approved/index.ts:6-19`; claim `20261006120000_result_lines_notify_claim.sql:114-127`                              |
| INV-09     | „Otwarty” kamień (planned/active, projekt nieskończony) definiuje flagę >100%, bramki MR007/MR008/MR012                                                                                                               | `prd.md:46`, `:63`, `:100`                                                                  | 4× SQL + 5× TS (zob. `01-…` §3 A4; dodatkowe kopie w §3 niżej)                                                                                                       |
| INV-10     | Flaga >100% jest informacyjna, nie blokuje                                                                                                                                                                            | `prd.md:101`                                                                                | `20261009130000_time_share_excludes_closed_projects.sql:32-44`                                                                                                       |
| INV-11     | Konfiguracja zmieniona po zatwierdzeniu nie rusza wyniku                                                                                                                                                              | `prd.md:70`                                                                                 | snapshot kopiuje wagi `…milestone_approval.sql:376-386`                                                                                                              |
| INV-12     | Nie dziel puli między mniej osób niż zaangażowanych                                                                                                                                                                   | (projektowy)                                                                                | `20261009120000_…sql` (wyjątek przy niewidocznej wadze; kopia treści `…kpi_and_payouts.sql:184-195`)                                                                 |

Poza listą świadomie: „pula docelowa zatwierdzona przez prezesa/dyrektora” — w kodzie nie jest niezmiennikiem, tylko brakującym bytem (`01-…` D2, decyzja właściciela).

---

## 2. Klasyfikacja i wybór #1

Osie: **(a)** rdzeniowość wobec wizji — „stosuje formułę **a jednocześnie** czyni wynik przejrzystym dla pracowników” (`prd.md:22`) i Guardrail #1 (`prd.md:44`); **(b)** rozsmarowanie po warstwach; **(c)** egzekwowanie.

| ID         | (a) rdzeń | (b) warstwy / miejsca                          | (c) egzekwowanie                                                    |
| ---------- | --------- | ---------------------------------------------- | ------------------------------------------------------------------- |
| INV-01     | 5         | 2 (SQL: funkcja + CHECK; TS: tylko komentarz)  | **egzekwowane** (konstrukcja `div()` + CHECK)                       |
| INV-02     | 5         | 1                                              | **egzekwowane**                                                     |
| INV-03     | 5         | 4+ (SQL: trigger, 2 RPC; UI: 4 kopie warunków) | **egzekwowane** dla ról API; patrz INV-05 dla ról uprzywilejowanych |
| INV-04     | 5         | 2                                              | **egzekwowane**                                                     |
| **INV-05** | **5**     | **3 warstwy, 3 źródła „kwoty”** (zob. §3)      | **deklarowane / naruszalne**                                        |
| INV-06/07  | 5/4       | 1–2                                            | egzekwowane (RLS + kształt schematu)                                |
| INV-08     | 3         | 3 (SQL kolumny, Edge, TS)                      | egzekwowane w funkcji Edge, nie w bazie                             |
| INV-09     | 3         | 9 miejsc                                       | egzekwowane w bazie, duplikowane w UI                               |
| INV-10     | 3         | 3                                              | deklarowane z założenia (decyzja FR-011)                            |
| INV-11/12  | 5/4       | 1–2                                            | egzekwowane                                                         |

### Wybór: INV-05 — spójność zatwierdzonego wyniku

**Dlaczego ten:** jest jednocześnie w najwyższej klasie (a) — to jest dokładnie to, co pracownik czyta jako „swoją premię” i co przełożony podpisał — i jedynym z rdzeniowych, który nie ma mechanizmu wymuszającego, tylko konwencję (c). Pozostałe rdzeniowe (INV-01…04, 06, 07, 11, 12) mają CHECK-i, triggery albo RLS.

**Dlaczego nie INV-09 (kandydat #1 z `01-…` §5):** tamten ranking mnożył wartość przez ryzyko _dryfu_. Tu kryterium jest ostrzejsze (rdzeń **i** najsłabsze egzekwowanie), a INV-09 jest egzekwowany w bazie — jego problem to duplikacja (oś b), nie możliwość naruszenia. Zostaje następną zmianą (§5, faza 6).

---

## 3. Diagnoza INV-05

### 3.1 Gdzie reguła żyje dziś (wszystkie warstwy)

| Warstwa      | Miejsce                                                                                   | Co robi                                                                                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schemat      | `milestone_results` CHECK-i `…milestone_approval.sql:74-77`                               | pilnują tylko _wewnątrz nagłówka_: `payout_pool ≤ target_pool`, `payout_total ≤ payout_pool`, `residual = pool − total`. **Nie widzą linii**                    |
| Schemat      | `milestone_result_lines` `…milestone_approval.sql:93-116`                                 | unikalność `(milestone_id, employee_id)` `:115`, `bonus ≥ 0` `:114`; **brak** powiązania sumy z nagłówkiem                                                      |
| Funkcja      | `approve_milestone` `…milestone_approval.sql:324-386`                                     | jedna instrukcja z CTE (`pl as materialized`, `totals`, `header_ins`) — spójność zapewnia sposób napisania, nie ograniczenie                                    |
| Funkcja      | status → `approved` dopiero po istnieniu nagłówka `…milestone_approval.sql:257-262`       | pilnuje _nagłówek istnieje_, nie _linie istnieją/sumują się_                                                                                                    |
| Uprawnienia  | `revoke insert, update, delete … from authenticated` `…milestone_approval.sql:85`, `:123` | jedyna ochrona niezmienności snapshotu; **brak triggera** na obu tabelach (`grep "create trigger" … \| grep -i result` → 0 trafień)                             |
| Funkcja Edge | `notify-milestone-approved/index.ts:272-275`, `:287-290`, `:306-`                         | pisze do `milestone_result_lines` kluczem secret (`ctx.supabaseAdmin`), czyli z pełnym UPDATE — dziś tylko `notify_*`, ale nic technicznie nie zabrania `bonus` |
| Test         | `supabase/tests/milestone_approval.test.sql:391-399`                                      | sprawdza Σ=total **dla jednego fixture’a**, po fakcie                                                                                                           |
| Serwis TS    | `src/lib/services/approvals.ts:312-331`                                                   | nagłówek i linie czytane **dwoma osobnymi zapytaniami**                                                                                                         |
| Serwis TS    | `approvals.ts:271-272`                                                                    | `within_pool` liczone z samych liczb nagłówka („The header CHECK … guarantees this”)                                                                            |
| Serwis TS    | `approvals.ts:334-358`                                                                    | nagłówek bez linii → `lines: []`, `share: 0`, `line_count: 0` — wynik renderuje się jako poprawny                                                               |
| Strona       | `src/pages/projects/[id]/milestones/[milestoneId].astro:100-111`                          | brak nagłówka dla `approved` → tylko `logError` + generyczny błąd karty, bez typowanego błędu                                                                   |
| Konsument #1 | `src/lib/services/dashboard.ts:44`, `src/lib/dashboard.ts:188`                            | „wypłacono w roku” = Σ `milestone_results.payout_total` (**nagłówek**)                                                                                          |
| Konsument #2 | `20261015120000_bonus_report.sql:87-95`; `src/lib/history.ts:10-53`                       | raport i historia = Σ `milestone_result_lines.bonus` (**linie**)                                                                                                |

### 3.2 Czego nie egzekwują warstwy

1. **Baza nie ma ograniczenia łączącego nagłówek z liniami.** Po `approve_milestone` nic nie powstrzyma operatora (rola `postgres`, SQL editor — `…milestone_approval.sql:14-16` wprost przewiduje „operator fix in the database”) ani przyszłej migracji przed rozjechaniem `payout_total` i Σ `bonus`.
2. **Snapshot chroni wyłącznie brak uprawnień.** Rola `service_role` (funkcja Edge) i właściciel omijają RLS i mają pełne UPDATE/DELETE; triggerów brak.
3. **Dwa źródła „kwoty wypłaconej”.** Dashboard sumuje nagłówki, raport i historia pracownika — linie. Przy rozjeździe przełożony widzi na dashboardzie inną sumę niż pracownik w `/my-bonuses` i niż eksport CSV — bez żadnego błędu.
4. **Spójność nagłówek↔linie jest sprawdzana tylko w teście, tylko na jednym fixture.** Ryzyko #3 z `test-plan.md:50` formalnie pokryte, ale na poziomie danych istniejących w produkcji nie ma nic.

### 3.3 Niespójność egzekwowania

- Reguła „approved ⇒ nagłówek” jest pilnowana w bazie (`…milestone_approval.sql:257-262`) **i** wykrywana po stronie strony (log, `[milestoneId].astro:100-111`) — a „nagłówek ⇒ linie” nie jest pilnowana nigdzie.
- Zamrożenie kamienia dla ról API jest silne (MR015), ale zamrożenie _jego wyniku_ — tylko uprawnieniami.

### 3.4 Gdzie klient jest jedynym strażnikiem

Dla INV-05 klient nie jest strażnikiem (nie ma tam reguły) — i to jest właśnie problem: UI **ufa** nagłówkowi (`approvals.ts:271-272`) i nie ma jak zauważyć rozjazdu. Pokrewny wzorzec (poza INV-05, do fazy 6): gotowość do zatwierdzenia jest liczona w UI od nowa (`[milestoneId].astro:131-132`, `:156-172`; `src/lib/dashboard.ts:36-39`, `:92-116`), a baza dopiero odrzuca.

### 3.5 Gdzie błąd jest „połykany”

- `approvals.ts:334-358` — nagłówek bez linii nie jest błędem, tylko pustą tabelą.
- `[milestoneId].astro:100-111` — przy braku nagłówka zapis w logu i ogólny „load_failed”; brak nazwanego błędu domenowego, którego monitoring mógłby szukać.
- `mapPostgrestError` `approvals.ts:205-217`: nieznany SQLSTATE spada do `save_failed` (z `logError("error")`), więc przyszły kod naruszenia spójności byłby widoczny użytkownikowi jako „spróbuj ponownie”.

---

## 4. Projekt agregatu-strażnika: `MilestoneResult`

### 4.1 Granica agregatu

**Root:** `milestone_results` (nagłówek). **Elementy wewnętrzne:** `milestone_result_lines`. Odwołanie na zewnątrz tylko po `milestone_id`. Mutowany **wyłącznie** przez `approve_milestone` (jedyna metoda domenowa tworząca); po utworzeniu nie ma metod mutujących poza stemplami powiadomień (część techniczna, nie domenowa).

### 4.2 Niezmienniki agregatu (każdy dostaje nazwany błąd)

| Kod     | Nazwa domenowa        | Znaczenie                                                                                                                                                                                                                                                   |
| ------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MR016` | `result_inconsistent` | po zatwierdzeniu transakcji: brak linii, `Σ bonus ≠ payout_total`, `count ≠ engagement_count`, linia o innym `multiplier`/`project_id`/`milestone_id`/`approved_at` niż nagłówek, `Σ bonus > payout_pool`, albo nagłówek bez kamienia w statusie `approved` |
| `MR017` | `result_immutable`    | UPDATE/DELETE/TRUNCATE nagłówka lub linii poza dozwolonym wyjątkiem                                                                                                                                                                                         |

(Kody `MR016+` są wolne — `grep -rn "MR01[6-9]" supabase src docs context/foundation` → 0 trafień.)

### 4.3 Mechanizm w bazie (pseudokod; implementacja w nowej migracji, nigdy edycja zastosowanych)

```sql
-- (1) Spójność sprawdzana PRZY COMMICIE, więc approve_milestone może wstawiać w dowolnej
--     kolejności, a całość i tak musi się zgadzać. Dotyczy też zapisów spoza approve_milestone.
create function public.milestone_result_assert_consistent()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(new.milestone_id, old.milestone_id);
        h public.milestone_results;
        v_sum numeric; v_cnt int; v_bad int;
begin
  select * into h from public.milestone_results where milestone_id = v_id;
  if not found then return null; end if;                 -- usunięcie blokuje MR017, nie tu
  select coalesce(sum(bonus),0), count(*),
         count(*) filter (where multiplier <> h.multiplier or project_id <> h.project_id
                              or approved_at <> h.approved_at)
    into v_sum, v_cnt, v_bad
    from public.milestone_result_lines where milestone_id = v_id;
  if v_cnt = 0                         then raise exception 'result has no lines'            using errcode='MR016'; end if;
  if v_sum <> h.payout_total           then raise exception 'sum of bonuses <> payout_total' using errcode='MR016'; end if;
  if v_sum > h.payout_pool             then raise exception 'sum of bonuses > payout_pool'   using errcode='MR016'; end if;
  if v_cnt <> h.engagement_count       then raise exception 'line count <> engagement_count' using errcode='MR016'; end if;
  if v_bad > 0                         then raise exception 'line disagrees with header'     using errcode='MR016'; end if;
  if not public.is_approved_milestone(v_id)
                                       then raise exception 'result of a milestone that is not approved' using errcode='MR016'; end if;
  return null;
end $$;

create constraint trigger milestone_results_consistent
  after insert or update on public.milestone_results
  deferrable initially deferred for each row execute function public.milestone_result_assert_consistent();
create constraint trigger milestone_result_lines_consistent
  after insert or update or delete on public.milestone_result_lines
  deferrable initially deferred for each row execute function public.milestone_result_assert_consistent();

-- (2) Niezmienność dla KAŻDEJ roli, także service_role i właściciela.
create function public.milestone_results_guard_immutable() returns trigger ... as $$
begin
  if tg_op = 'UPDATE'
     and tg_table_name = 'milestone_results'
     and (to_jsonb(new) - 'approved_by') = (to_jsonb(old) - 'approved_by')
     and new.approved_by is null then
    return new;     -- jedyny wyjątek: FK "on delete set null" przy usunięciu konta zatwierdzającego
  end if;
  if tg_op = 'UPDATE'
     and tg_table_name = 'milestone_result_lines'
     and (to_jsonb(new) - 'notified_at' - 'notify_claimed_at')
       = (to_jsonb(old) - 'notified_at' - 'notify_claimed_at') then
    return new;     -- stemple powiadomień (funkcja Edge)
  end if;
  raise exception 'approved results are immutable' using errcode = 'MR017';
end $$;
-- BEFORE UPDATE OR DELETE na obu tabelach + BEFORE TRUNCATE (statement-level).
```

Uwagi projektowe:

- Wyjątek `approved_by` jest konieczny: `milestone_results.approved_by … on delete set null` (`…milestone_approval.sql:73`) aktualizuje wiersz przy usunięciu profilu; bez wyjątku usunięcie konta byłoby niemożliwe.
- `approve_milestone` **nie zmienia kształtu** (te same argumenty, ta sama instrukcja CTE); zyskuje tylko to, że jego poprawność jest teraz sprawdzana, a nie założona. Zachowuje atomowość: jedna funkcja plpgsql = jedna transakcja; sprawdzenie odroczone odpala się przy COMMIT, po `update … set status='approved'` `…milestone_approval.sql:389-391`, więc warunek „kamień jest approved” jest już prawdziwy.
- Migracja musi najpierw **sprawdzić dane istniejące** (blok `do $$ … raise exception …`), żeby nie założyć ograniczenia na niespójnych wierszach — fail-fast przy wdrożeniu.
- „Operator fix” (`…milestone_approval.sql:14-16`) wymaga teraz świadomego `alter table … disable trigger` — to zamierzone tarcie; zob. pytanie Q1.

### 4.4 Port po stronie TS (nic nie przelicza)

Nowy moduł `src/lib/services/milestone-result.ts` (konwencja `CLAUDE.md`: logika wyciągnięta → `src/lib/services/`), typy w `src/types.ts`.

```ts
// Nazwane błędy domenowe (kody = SQLSTATE zamapowane, nie wolny tekst)
export type MilestoneResultErrorCode =
  | "not_found"
  | "not_approvable"
  | "already_approved"
  | "project_closed" // MR014/MR015/MR003/42501 (istnieją, approvals.ts:194-199)
  | "result_inconsistent" // MR016  — NOWY
  | "result_immutable"; // MR017  — NOWY

export interface ApprovedResult {
  header: MilestoneResult;
  lines: MilestoneResultLine[];
}

/** Jedno zapytanie (osadzone linie) = jeden snapshot odczytu. null = kamień bez wyniku (Draft). */
export function loadApprovedResult(
  sb: SupabaseClient,
  milestoneId: string,
  log?: LogContext,
): Promise<ServiceResult<ApprovedResult | null>>;

/** Fail-fast przed renderem; nie przelicza reguł bazy, tylko odmawia danych, które jej przeczą.
 *  Rzuca ResultInconsistentError(reason) gdy: lines=∅, Σbonus≠payout_total, count≠engagement_count. */
export function assertConsistent(r: ApprovedResult): ApprovedResult;

/** Jedyny punkt wejścia dla komendy. Błąd domenowy jako { error: { code } } (konwencja serwisów). */
export function approveMilestone(sb: SupabaseClient, milestoneId: string, log?: LogContext): Promise<WriteResult>;
```

`loadApprovedResult` używa jednego zapytania PostgREST `milestone_results.select("…, milestone_result_lines(…)")` (relacja istnieje: `…milestone_approval.sql:95`), więc nagłówek i linie pochodzą z jednego odczytu. `assertConsistent` jest _ostatnią linią obrony_, nie źródłem prawdy: po zmianach z §4.3 powinno nigdy nie zadziałać, a gdy zadziała — `logError("error", …)` i **żaden wynik nie jest renderowany** (karta błędu bez liczb).

### 4.5 Cienka trasa

`src/pages/api/projects/[id]/milestones/[milestoneId]/approve.ts` zostaje w obecnym kształcie (`:48-61`): parse (`approveInputSchema`) → `approveMilestone` → mapowanie `error.code` na redirect. Zmiana: tablica `GUARD_ERROR_CODES` (`approvals.ts:194-199`) dostaje `MR016 → result_inconsistent`, `MR017 → result_immutable`, oba logowane na poziomie `error` (nie „domain rejection”, bo oznaczają błąd systemu, nie użytkownika), z komunikatami w katalogach EN/PL (`approvals.ts:25-43`, `:45-102`; EN definiuje kody, PL jest typowane względem nich). Egzekucja nie przenosi się z klienta (klient jej dziś nie ma); przenosi się z konwencji do schematu.

---

## 5. Before / after, fazy i testy

### 5.1 Before / after dla każdego dzisiejszego miejsca

| Miejsce dziś                                                                         | Before                      | After                                                                             |
| ------------------------------------------------------------------------------------ | --------------------------- | --------------------------------------------------------------------------------- |
| `…milestone_approval.sql:74-77` CHECK-i nagłówka                                     | tylko wewnątrz nagłówka     | bez zmian + trigger odroczony spina z liniami (MR016)                             |
| `…milestone_approval.sql:93-116` linie                                               | brak powiązania sum         | j.w.; dodatkowo MR017 na UPDATE/DELETE                                            |
| `…milestone_approval.sql:324-386` CTE                                                | spójność z konstrukcji      | bez zmian kodu; poprawność weryfikowana przy COMMIT                               |
| `…milestone_approval.sql:85`, `:123` revoke                                          | jedyna ochrona snapshotu    | + trigger MR017 działa także dla `service_role` i właściciela                     |
| `notify-milestone-approved/index.ts:272-290`                                         | pełny UPDATE kluczem secret | bez zmian kodu; guard dopuszcza tylko `notified_at`/`notify_claimed_at`           |
| `approvals.ts:312-331` dwa zapytania                                                 | niezależne odczyty          | jedno zapytanie z osadzonymi liniami                                              |
| `approvals.ts:271-272` `within_pool` z nagłówka                                      | zaufanie nagłówkowi         | liczone po `assertConsistent`                                                     |
| `approvals.ts:334-358` nagłówek bez linii                                            | pusta tabela, „OK”          | `ResultInconsistentError` → karta błędu, `logError("error")`                      |
| `[milestoneId].astro:100-111`                                                        | log + `load_failed`         | typowany kod `result_inconsistent`                                                |
| `approvals.ts:194-199`                                                               | MR003/MR014/MR015           | + MR016/MR017 (poziom `error`)                                                    |
| `dashboard.ts:44`, `dashboard.ts(lib):188` vs `bonus_report.sql:87-95`, `history.ts` | dwa źródła „kwoty”          | bez zmian kodu — równość gwarantowana ograniczeniem (jedno źródło prawdy w bazie) |
| `milestone_approval.test.sql:391-399`                                                | test ex post, 1 fixture     | zostaje + nowe przypadki poniżej                                                  |

### 5.2 Plan faz

| Faza                                  | Zakres                                                                                                                                                                                                                                                                                                                                                                                                                       | Test-first?                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **0** Decyzje                         | Q1–Q3 poniżej                                                                                                                                                                                                                                                                                                                                                                                                                | —                                                                                         |
| **1** Czerwone testy pgTAP            | nowy plik `supabase/tests/milestone_result_invariants.test.sql` (fixtures w wolnym zakresie UUID; zapisać mapę w nagłówku wg `test-plan.md` §6.2) — wszystkie nielegalne przypadki z §5.3 muszą być **czerwone** na obecnym schemacie                                                                                                                                                                                        | **tak** (obowiązkowo; sprawdzić, że czerwone z właściwego powodu)                         |
| **2** Migracja                        | `supabase/migrations/2026…_milestone_result_invariants.sql`: blok kontroli danych istniejących → funkcje → triggery → `revoke execute`. Wg `CLAUDE.md` zaktualizować `supabase/tests/rls_catalog_guard.test.sql` (nowe funkcje `security definer`, allowlista po sygnaturze, pinned `search_path`) i `supabase/tests/rls_matrix.test.sql` (komórki: właściciel, `service_role`, admin, pracownik, anon — tylko odmowy MR017) | pgTAP zielone; „prove it can fail”: scratch migracja psująca regułę (`test-plan.md` §6.1) |
| **3** Testy Vitest (red)              | `src/lib/services/__tests__/milestone-result.test.ts`: `assertConsistent`, mapowanie MR016/MR017                                                                                                                                                                                                                                                                                                                             | **tak**                                                                                   |
| **4** Port TS                         | `milestone-result.ts`, typy, zmiana `getApprovedPayout` → `loadApprovedResult`, katalogi i18n EN/PL                                                                                                                                                                                                                                                                                                                          | po fazie 3                                                                                |
| **5** Integracja i E2E                | rozszerzyć istniejący `tests/integration/notify-milestone-approved.integration.test.ts` (stemple nadal działają przy guardzie) i `tests/e2e/us-01-approved-bonus-visible-only-to-its-employee.spec.ts` (bez regresji)                                                                                                                                                                                                        | uruchomić, nie pisać od nowa                                                              |
| **6** Rejestr kontraktów              | dopisać wiersze (lista w §5.4) do `docs/reference/contract-surfaces.md`                                                                                                                                                                                                                                                                                                                                                      | —                                                                                         |
| **7** _(osobna zmiana, nie ten plan)_ | INV-09: jedna funkcja `milestone_approval_readiness(p_milestone_id)` zwracająca powód zamiast kopii w `[milestoneId].astro:131-172`, `dashboard.ts:36-116`, `assignments.ts:22-23`, `MilestonesSection.astro:35-39`, `projects/[id].astro:68`                                                                                                                                                                                | wg własnego `/10x-new`                                                                    |

### 5.3 Przypadki testowe niezmiennika INV-05

**Legalne (muszą przejść):**

1. Zatwierdzenie kamienia z 1 przypisaniem.
2. Zatwierdzenie z N przypisaniami, w tym z linią `bonus = 0,00` (liczy się do `engagement_count`).
3. Maks. mnożnik: `payout_pool = target_pool`, Σ ≤ pula.
4. Min. mnożnik; jedno przypisanie wchłaniające całą pulę.
5. Reszta z zaokrągleń > 0: `payout_total + residual = payout_pool`.
6. `service_role` ustawia `notified_at` i `notify_claimed_at` (claim i release).
7. Usunięcie konta zatwierdzającego: `approved_by` → NULL, wszystkie inne kolumny bez zmian.
8. Odczyt jako przełożony, admin i aktywowany pracownik daje te same liczby co przed zmianą (regresja ryzyka #1/#4).

**Nielegalne (muszą dać nazwany błąd; sprawdzać `throws_ok` na kodzie):**

1. Nagłówek bez żadnej linii, commit → `MR016`.
2. Linie o Σ ≠ `payout_total` → `MR016`; Σ > `payout_pool` → `MR016`.
3. `engagement_count` ≠ liczba linii → `MR016`.
4. Linia z innym `multiplier`, `project_id` lub `approved_at` niż nagłówek → `MR016`.
5. Dodanie linii do istniejącego wyniku po zatwierdzeniu → `MR016` (zmienia count/Σ).
6. Nagłówek dla kamienia, który nie został przestawiony na `approved` w tej transakcji → `MR016`.
7. `UPDATE milestone_result_lines SET bonus = …` jako owner, `service_role`, przełożony, admin → `MR017` (lub brak wiersza dla ról API, zgodnie z macierzą §6.1; owner/service_role: `MR017`).
8. `DELETE` linii / nagłówka; `TRUNCATE` obu tabel → `MR017`.
9. `UPDATE milestone_results SET payout_total = …` → `MR017`.
10. Atomowość: `approve_milestone` przy błędzie w środku (np. kamień w zamkniętym projekcie, MR003) nie zostawia nagłówka ani linii (`is_empty`).

**Vitest (TS):**

- `assertConsistent`: poprawny wynik przechodzi; `lines=[]` rzuca; Σ≠`payout_total` rzuca; rozjazd w jednym groszu rzuca (arytmetyka w groszach, nie float — jak `history.ts:10`); `engagement_count` ≠ długość rzuca.
- `loadApprovedResult`: brak nagłówka → `data: null`; nagłówek bez linii → błąd `result_inconsistent`, `logError` wywołane na poziomie `error`.
- Mapowanie: `MR016`→`result_inconsistent`, `MR017`→`result_immutable`, nadal `MR014/15/03/42501` jak dziś.
- Test architektury: `grep` w teście, że w `src/` nie ma drugiego miejsca liczącego `payout_total` z linii poza `milestone-result.ts`/`history.ts`/`bonus-report.ts` (te dwa ostatnie pozostają czystymi sumatorami wyświetlanymi).

### 5.4 Nowe nazwy „load-bearing” do rejestru (`docs/reference/contract-surfaces.md`)

- `public.milestone_result_assert_consistent()` — funkcja triggera, security definer, `search_path = ''`, `revoke execute`.
- `public.milestone_results_guard_immutable()` — funkcja triggera j.w.
- Triggery: `milestone_results_consistent`, `milestone_result_lines_consistent` (constraint, deferrable initially deferred), `milestone_results_immutable`, `milestone_result_lines_immutable`, `milestone_results_no_truncate`, `milestone_result_lines_no_truncate`.
- SQLSTATE `MR016` (`result_inconsistent`), `MR017` (`result_immutable`) w katalogu kodów obok MR014/MR015.
- TS: `ApprovedResult`, `loadApprovedResult`, `assertConsistent`, `MilestoneResultErrorCode`, `ResultInconsistentError`.
- Kody komunikatów: `result_inconsistent`, `result_immutable` w `APPROVAL_ERROR_MESSAGES` (EN/PL).
- Zapis kontraktowy: **jedyną drogą zapisu do `milestone_results` jest `approve_milestone`; jedyna dozwolona aktualizacja linii to `notified_at`/`notify_claimed_at`**.

### 5.5 Ryzyka planu

- **Odroczony trigger a wydajność** — koszt jednorazowy przy zatwierdzeniu, mała skala (`prd.md:8-11`); pomijalny.
- **Blokada operatora** — świadoma (Q1). Gdyby właściciel chciał „korektę” zatwierdzonego wyniku, to osobna funkcja domenowa (np. `reopen`/`correct`) z audytem, nie obejście triggera.
- **Dane istniejące** — jeśli kontrola w fazie 2 znajdzie niespójny wiersz, migracja ma się zatrzymać; to wynik, nie awaria.

## 6. Pytania do właścicieli

| #   | Pytanie                                                                                                                                                                                                        | Kto zna odpowiedź                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Q1  | Czy „operator fix” zatwierdzonego wyniku (`…milestone_approval.sql:14-16`) ma pozostać ręczną procedurą (wymaga wyłączenia triggera), czy potrzebna jest domenowa „korekta” z audytem?                         | Właściciel procesu premiowego + administrator bazy |
| Q2  | Czy przy usunięciu konta zatwierdzającego ma zostać `approved_by = NULL` (dzisiejsze zachowanie), czy zachować tożsamość (snapshot e-maila/nazwy)?                                                             | Właściciel PRD / zgodność (RODO)                   |
| Q3  | Czy wynik z 0 liniami kiedykolwiek ma być legalny (np. kamień bez uczestników zatwierdzany „na zero”)? Dziś `approve_milestone` tego nie dopuszcza (`…milestone_approval.sql:318-321`, MR014), plan to utrwala | Właściciel PRD                                     |
