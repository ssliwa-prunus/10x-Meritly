---
title: Słownik domeny Meritly dla agentów
created: 2026-10-31
type: domain-glossary
---

# Słownik domeny Meritly

Krótki słownik do czytania przed pracą nad kodem. Dowody i cytaty: `01-domain-distillation.md`. Zasada: **w kodzie używaj kolumny „Nazwa w kodzie”, w UI polskiej etykiety z `src/lib/i18n/messages/pl.ts`**.

## Ludzie i dostęp

| Termin             | Co znaczy                                                                                                       | Nazwa w kodzie                                              | Jak tego NIE nazywać                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------- |
| Przełożony         | Kierownik z budżetem premiowym, właściciel projektów i zespołu; każdy poziom (PM, TL, dyrektor) to ta sama rola | `supervisor`, `AppRole`, `is_supervisor()`, `supervisor_id` | manager, PM, szef, user                       |
| Administrator      | Konfiguruje globalne reguły, widzi wszystko, nie zatwierdza ani nie edytuje przypisań                           | `admin`, `is_admin()`                                       | superuser, root                               |
| Pracownik (konto)  | Rola dostępu, widzi tylko własne **zatwierdzone** premie                                                        | `employee` w `AppRole`, `current_employee_id()`             | user, klient                                  |
| Pracownik (rekord) | Osoba w zespole przełożonego; konto jest opcjonalne i aktywowane zaproszeniem                                   | tabela `employees`, typ `Employee`                          | profil, user, konto (to są `profiles`)        |
| Rola dostępu       | admin / supervisor / employee                                                                                   | `app_role`, `profiles.role`                                 | „rola” bez przymiotnika                       |
| Rola zawodowa      | Nazwana rola niosąca wagę                                                                                       | `job_roles`, `JobRole`, `job_role_id`                       | „rola” bez przymiotnika, stanowisko, position |
| Waga roli          | Mnożnik z roli zawodowej, `0 < w ≤ 3`                                                                           | `weight`, `role_weight`                                     | współczynnik roli (współczynnik = ocena)      |

## Pieniądze i pule

| Termin               | Co znaczy                                                                                                            | Nazwa w kodzie                                             | Jak tego NIE nazywać                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| Budżet projektu      | Całkowity budżet premiowy projektu, względem którego flagowana jest ekspozycja                                       | `projects.total_budget`                                    | pula, bonus pool                                                   |
| Pula docelowa        | Zatwierdzone **maksimum** wypłat kamienia                                                                            | `milestones.target_pool`                                   | pula premiowa, bonus pool, budżet kamienia                         |
| Pula do wypłaty      | Pula docelowa przeskalowana KPI: `target × M ÷ multiplier_max`, w dół do grosza, nigdy > docelowej                   | `payout_pool`, `capped_payout_pool()`                      | pula po KPI, wypłacalna, effective pool                            |
| Premia               | Kwota jednego pracownika w jednym kamieniu                                                                           | `bonus`                                                    | wypłata (wypłata/`payout` = poziom puli), payment                  |
| Suma wypłat          | Σ premii kamienia                                                                                                    | `payout_total`                                             | total bonus (to jest `total_bonus` w raporcie)                     |
| Reszta z zaokrągleń  | `payout_pool − Σ bonus`, pokazywana, nie gubiona                                                                     | `residual`                                                 | nadwyżka, saldo                                                    |
| Grosz                | Jednostka zaokrąglania: zawsze w dół, w całkowitych groszach                                                         | `div()` w SQL, `toGrosze` w TS tylko do sum wyświetlanych  | zaokrąglanie matematyczne, `round()`, rzutowanie na `numeric(p,2)` |
| Ekspozycja budżetowa | Najgorszy przypadek: faktyczna pula zatwierdzonych + pula docelowa pozostałych (bez anulowanych); flaga informacyjna | `project_budget_exposure`, `reserved_total`, `over_budget` | wykorzystanie budżetu, spend                                       |

## Wzór

| Termin             | Co znaczy                                                                                                             | Nazwa w kodzie                                          | Jak tego NIE nazywać                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------- |
| Wynik KPI          | Jedna z 4 ocen kamienia (Termin, Budżet, Jakość, Ryzyko), całkowita 0–100, wyższe = lepiej także dla Ryzyka           | `kpi_schedule`, `kpi_budget`, `kpi_quality`, `kpi_risk` | ocena, rating (rating = ocena wkładu)                     |
| Wagi KPI           | Cztery wagi sumujące się do 1                                                                                         | `kpi_weight_*` w `bonus_settings`                       | współczynniki KPI                                         |
| Mnożnik KPI (M)    | Liniowe odwzorowanie ważonych wyników na `[multiplier_min, multiplier_max]`; **skaluje pulę, nigdy wagi pracowników** | `multiplier`, `kpi_multiplier()`                        | współczynnik projektu, mnożnik pracownika                 |
| Ocena wkładu       | Ocena pracownika w kamieniu, 1–5                                                                                      | `rating`                                                | score, wynik                                              |
| Współczynnik oceny | Wartość przypisana ocenie 1–5 w konfiguracji                                                                          | `rating_factor`, `rating_factor_1…5`                    | waga, performance factor                                  |
| Udział czasowy     | Część czasu pracownika w kamieniu, `0 < x ≤ 1`                                                                        | `time_share`                                            | procent, FTE, zaangażowanie (zaangażowanie = cały wiersz) |
| Ważony wkład       | `time_share × role_weight × rating_factor`                                                                            | `weighted_contribution` (e_i)                           | udział (udział = `share`, tylko do wyświetlania)          |
| Ustawienia premii  | Singleton konfiguracji: wagi KPI, min/max mnożnika, współczynniki ocen                                                | `bonus_settings`, `BonusSettings`                       | config, parametry                                         |

## Planowanie i zespół

| Termin              | Co znaczy                                                                                   | Nazwa w kodzie                                                                | Jak tego NIE nazywać                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Projekt             | Zadanie B+R z okresem, statusem, budżetem i jednym właścicielem                             | `projects`, `Project`                                                         | zlecenie, program                                                                                                         |
| Kamień milowy       | Jednostka wypłaty premii w projekcie                                                        | `milestones`, `Milestone` (UI: „Kamień milowy”)                               | etap, stage, phase, sprint                                                                                                |
| Zaangażowanie       | Udział pracownika w kamieniu: `time_share` + `rating`                                       | `milestone_engagements`, `Engagement` (UI: „Przypisanie”)                     | alokacja, allocation, zasób; w kodzie nie „assignment” poza `src/lib/assignments.ts`/`OpenAssignment` (nazwa historyczna) |
| Zespół przełożonego | Pracownicy, których właścicielem jest przełożony; przypisać można tylko swoich              | `employees.supervisor_id`                                                     | team_id, dział                                                                                                            |
| Kamień otwarty      | Nie `completed`, `cancelled` ani `approved`, w projekcie nie `completed`/`cancelled`        | brak jednej nazwy; zbiór skopiowany w kilku miejscach (zob. destylacja §3 A4) | aktywny (`active` to **jedna** z wartości statusu)                                                                        |
| Status realizacji   | `planned`, `active`, `completed`, `cancelled`                                               | `WorkStatus`                                                                  | state                                                                                                                     |
| Flaga >100%         | Informacyjne ostrzeżenie, gdy suma udziałów po otwartych przypisaniach > 1; nic nie blokuje | `over_allocated`, `open_total`, widok `employee_time_share_totals`            | limit, blokada                                                                                                            |

## Wyniki

| Termin                        | Co znaczy                                                                                             | Nazwa w kodzie                                                               | Jak tego NIE nazywać                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Szkic                         | Wyniki liczone na żywo, widoczne tylko przełożonemu; **nie jest zapisanym stanem**, to brak snapshotu | brak pola; funkcje `milestone_payout_summary()`, `milestone_payout_lines()`  | status `draft`, wersja robocza w bazie                           |
| Zatwierdzony                  | Nieodwracalnie zamrożony kamień: snapshot + widoczność pracownika + e-mail                            | `milestones.status = 'approved'`, `approve_milestone()`                      | opublikowany, finalny, zamknięty (zamknięty = także `completed`) |
| Wynik zatwierdzony (nagłówek) | Zamrożona pula, suma i reszta; tylko przełożony i admin                                               | `milestone_results`, `MilestoneResult`                                       | raport, podsumowanie                                             |
| Linia wyniku                  | Zamrożone liczby jednego pracownika; jedyne, co czyta pracownik                                       | `milestone_result_lines`, `MilestoneResultLine`, `MyBonusLine`               | wynik pracownika (bez słowa „linia”), payslip                    |
| Snapshot                      | Kopia wag, współczynników i kwot wykonana przy zatwierdzeniu                                          | kolumny `role_weight`, `rating_factor`, `multiplier` w liniach               | cache, historia wersji                                           |
| Podział widoczności           | Pracownik nie dostaje puli, sumy, reszty ani udziału                                                  | brak kolumn `share`/`payout_pool` w `milestone_result_lines`                 | filtr w UI (to jest RLS, nie filtr strony)                       |
| Raport zbiorczy               | Suma premii i liczba kamieni na pracownika, z zakresem dat strefy Warszawy                            | `bonus_report()`, `BonusReportRow`                                           | eksport, Raport (nazwa zakładki arkusza)                         |
| Powiadomienie                 | E-mail z własną premią po zatwierdzeniu; stempel i claim zapobiegają dublom                           | `notified_at`, `notify_claimed_at`, funkcja Edge `notify-milestone-approved` | push, alert                                                      |
| Zaproszenie / aktywacja       | Konto pracownika powstaje z zaproszenia, aktywowane potwierdzeniem e-maila                            | `invited_at`, `activated_at`, `InviteStatus`, funkcja Edge `invite-employee` | rejestracja pracownika                                           |

## Kody błędów domeny (SQLSTATE)

| Kod                   | Znaczy                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| MR001                 | właściciel nie jest przełożonym                                                                    |
| MR002 / MR004         | okres kamienia poza okresem projektu / zmiana okresu projektu wyrzuciłaby kamień                   |
| MR003                 | projekt zamknięty (`completed`/`cancelled`)                                                        |
| MR005                 | zmiana roli przełożonego, który ma projekty lub pracowników                                        |
| MR007                 | zapis przypisania przy zamkniętym kamieniu lub projekcie                                           |
| MR008 / MR012         | zmiana właściciela pracownika / projektu przy otwartych przypisaniach u innego przełożonego        |
| MR009 / MR010 / MR011 | zmiana e-maila po zaproszeniu / zarchiwizowana rola zawodowa / pracownik spoza zespołu właściciela |
| MR013                 | zmiana wyników KPI anulowanego kamienia                                                            |
| MR014                 | kamienia nie można zatwierdzić (anulowany, bez KPI, bez przypisań, poza `approve_milestone`)       |
| MR015                 | kamień zatwierdzony (zamrożony)                                                                    |
