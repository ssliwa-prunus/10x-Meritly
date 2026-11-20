Projekt powstał na potrzeby wewnątrz organizacyjne. Borykamy sie z problemem dobrego przydziału premi za zaangażowanie, realziacje projektów RnD w których uczestniczy bardzo wiele osób - od konstruktorów mechaników, elektroników , rozwojowców, programistów etc. Pierwotnie powstała koncepcja w excelu którą przenosiłem w ramach kursu na www. 
Kluczowę decyzje to na pewno stack technologiczny. Chociaż od kilku lat już nie programuje to lata temu pracowałem z .NET/ASP.NET. Chciałem przynajmniej "liznać" nowoczesności wiec poszedłem w kierunku proponowanym w 10xCards - Astro, Cloudflare, Supabase.  Niestety czasu zawsze było mało wiec czas był duży wyzwaniem aby dowieźć projekt w MVP, który pozwoli z niego realnie korzystac.
Wrażenie z kursu są bardzo pozytywne, w szczególnosci Deep Dive gdzie można było poszerzyć wiedze. A więc nie tylko zbudowałem aplikacje ale także poznałem kilka platform. Doża dawka wiedzy.



Zbuduj jeden sumaryczny raport architektoniczny z modułu 4 (ścieżka 10xArchitect).
Cel: zwięzły two-pager (~2 strony), czytelny dla człowieka, oparty wyłącznie na poniższych artefaktach. Nie wymyślaj faktów - jeśli czegoś brakuje, napisz wprost "BRAK artefaktu" i nie uzupełniaj luki domysłami.


Wejścia (artefakty z modułu 4):
- Mapa repozytorium (L2): C:\PRUNUS_PROJECTS\_github\open-mercato\context\map\repo-map.md
- Research wybranego ficzera (L3): C:\PRUNUS_PROJECTS\_github\open-mercato\context\changes\refactor-opportunities\research.md
- Plan refaktoryzacji (L4): C:\PRUNUS_PROJECTS\_github\open-mercato\context\changes\refactor-opportunities\plan.md
- Notatki o domenie / DDD (L5): C:\PRIV_PROJECTS\10xDev 4\10x-Meritly\context\domain\*.md}

Uwaga: artefakty mogą pochodzić z RÓŻNYCH projektów. Dla każdego wejścia podaj, na jakim repozytorium powstało.

Struktura raportu:

1. Opisane projekty
   - Dla każdego repo użytego w module: nazwa, stack, skala (orientacyjnie), i przy którym artefakcie się pojawiło (L2/L3/L4/L5).

2. Mapa projektu (z L2)
   - 3-5 kluczowych wniosków z mapy: strefy ryzyka, lokalne centra, entry pointy, najważniejsze unknowns.

3. Analiza ficzera (z L3)
   - Który przepływ badałeś i dlaczego (link do strefy ryzyka z mapy).
   - Feature overview w 3-4 zdaniach: skąd input, gdzie zmienia się stan, co wraca.
   - Technical debt: 2-3 najważniejsze ryzyka (kruche sprzężenia, luki testowe, blast radius), z których co najmniej jedno potwierdzone ast-grepem.

4. Plan refaktoryzacji (z L4)
   - Co refaktoryzowane: wybrana opcja i jej docelowy kształt.
   - Czego świadomie NIE robimy.
   - Fazy planu w jednej linijce każda + jak weryfikowane (auto/ręcznie).

5. Domena wg DDD (z L5)
   - Ubiquitous language: 3-5 kluczowych pojęć + najważniejsze rozjazdy model-vs-kod.
   - Niezmiennik #1 i agregat, do którego należy.
   - Anti-Corruption Layer: która zależność przecieka i przez ile warstw.

6. Decyzje, które należą do mnie
   - 3-5 zdań: co AI podpowiedziało, a co rozstrzygnąłeś samodzielnie i dlaczego.

Zasady:
- Maksymalnie dwie strony. Tnij, nie streszczaj wszystkiego.
- Każde twierdzenie strukturalne (liczby, "tylko tutaj") oprzyj na artefakcie, nie na własnej pamięci o kodzie.
- Zapisz wynik jako context/architect-report.md
