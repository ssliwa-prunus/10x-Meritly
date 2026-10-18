// Polish dictionary: the shape source for every locale (`Messages = typeof pl`), namespaced by area.
// Values are plain strings (island props must be serialisable); `{name}` placeholders are filled by
// format() from @/lib/i18n. Later phases add their own namespaces here first, then in en.ts.

export const pl = {
  common: {
    appName: "Meritly",
    languageNamePl: "Polski",
    languageNameEn: "English",
    signIn: "Zaloguj się",
    signUp: "Załóż konto",
    signOut: "Wyloguj się",
    // Shared by the feature views: page-level load problems, column/field labels, small badges.
    supabaseNotConfigured: "Supabase nie jest skonfigurowany",
    profileLoadFailed: "Nie udało się wczytać Twojego profilu",
    unknownError: "Nieznany błąd",
    saving: "Zapisywanie…",
    save: "Zapisz",
    delete: "Usuń",
    // {name} is user data (milestone, employee).
    editName: "Edytuj: {name}",
    over100: "Ponad 100%",
    // Sentence about the open (time-share) total; shown on the employees list and on the milestone page.
    openTotalNote:
      "Otwarta suma to udział czasowy pracownika w kamieniach milowych, które nie są zakończone, anulowane ani zatwierdzone, w projektach, które są nadal otwarte. Powyżej 100% to tylko ostrzeżenie.",
    fields: {
      name: "Nazwa",
      period: "Okres",
      status: "Status",
      owner: "Właściciel",
      notes: "Notatki",
      startDate: "Data rozpoczęcia",
      endDate: "Data zakończenia",
      email: "E-mail",
      employee: "Pracownik",
      jobRole: "Rola",
      project: "Projekt",
      milestone: "Kamień milowy",
      targetPool: "Pula docelowa",
      timeShare: "Udział czasowy",
      rating: "Ocena",
      roleWeight: "Waga roli",
      ratingFactor: "Ocena → współczynnik",
      kpiMultiplier: "Mnożnik KPI",
      bonus: "Premia",
      openTotalAll: "Otwarta suma (wszystkie kamienie milowe)",
      openTotalOwn: "Otwarta suma (Twoje kamienie milowe)",
      chooseSupervisor: "Wybierz przełożonego",
    },
  },
  layout: {
    languageSwitch: "Język",
    switchToPl: "Przełącz na język polski",
    switchToEn: "Przełącz na język angielski",
    bannerAttention: "Uwaga:",
    bannerDocs: "Dokumentacja",
    supabaseNotConfigured: "Supabase nie jest skonfigurowany — funkcje uwierzytelniania są wyłączone.",
    supabaseDocsLabel: "Zobacz instrukcję konfiguracji",
    notSignedIn: "Nie zalogowano",
    nav: {
      dashboard: "Panel",
      projects: "Projekty",
      employees: "Pracownicy",
      myBonuses: "Moje premie",
      reports: "Raporty",
    },
  },
  landing: {
    // Smoke and E2E pin the pitch text (footer of the landing page).
    pitch: "Sprawiedliwy podział puli premiowej kamieni milowych",
    howItWorks: "Jak to działa",
    howItWorksLead: "Trzy kroki od wyniku kamienia milowego do premii na koncie.",
    goToDashboard: "Przejdź do panelu",
    nav: {
      label: "Główna",
      howItWorks: "Jak to działa",
      roles: "Dla kogo",
      guarantees: "Gwarancje",
    },
    badge: "Premie za kamienie milowe, bez arkuszy kalkulacyjnych",
    title: "Pula premiowa podzielona uczciwie. Co do złotówki.",
    lead: "Meritly przelicza wynik KPI kamienia milowego na pulę do wypłaty i dzieli ją według czasu pracy, wagi roli i oceny wkładu. Przełożony zatwierdza, a każdy pracownik widzi tylko swoją premię.",
    bullets: {
      withinPool: "Wypłaty nigdy nie przekraczają puli",
      draft: "Szkic do czasu zatwierdzenia",
    },
    // Illustrative marketing figures, kept as designed (whole złoty) and in pl-PL format in every locale.
    example: {
      ariaLabel: "Przykład podziału puli",
      title: "Kamień milowy: Wdrożenie v2",
      illustrative: "Przykład ilustracyjny",
      targetPool: { label: "Pula docelowa", value: "30 000 zł" },
      multiplier: { label: "Mnożnik KPI", value: "1,2", max: "/ 1,5" },
      payoutPool: { label: "Pula do wypłaty", value: "24 000 zł" },
      formula: "30 000 × 1,2 ÷ 1,5 = 24 000 zł",
      columns: {
        role: "Rola",
        time: "Czas",
        weight: "Waga",
        rating: "Ocena",
        bonus: "Premia",
      },
      rows: {
        lead: { role: "Lider techniczny", time: "100%", weight: "1,5", rating: "×1,2", bonus: "13 935 zł" },
        developer: { role: "Programistka", time: "100%", weight: "1,0", rating: "×0,8", bonus: "6 193 zł" },
        tester: { role: "Tester (½ etatu)", time: "50%", weight: "1,0", rating: "×1,0", bonus: "3 870 zł" },
      },
      sumLabel: "Suma wypłat:",
      sumValue: "23 998 zł",
      residual: "2 zł z zaokrągleń w dół zostaje w puli",
    },
    formula: {
      ariaLabel: "Formuła podziału",
      share: "udział pracownika",
      time: "czas pracy",
      roleWeight: "waga roli",
      ratingFactor: "współczynnik oceny",
    },
    steps: {
      pool: {
        title: "Pula do wypłaty",
        body: "Wynik KPI kamienia milowego skaluje pulę docelową do puli do wypłaty. Pula do wypłaty nigdy nie przekracza zatwierdzonej puli docelowej.",
      },
      share: {
        title: "Udział każdego pracownika",
        body: "Pula jest dzielona proporcjonalnie do iloczynu udziału czasowego, wagi roli i współczynnika oceny. Kwoty są zaokrąglane w dół, więc suma nigdy nie przekroczy puli.",
      },
      approval: {
        title: "Zatwierdzenie",
        body: "Wyniki są szkicem widocznym tylko dla przełożonego. Dopiero po zatwierdzeniu kamienia milowego każdy pracownik widzi swoją premię i dostaje e-mail.",
      },
    },
    roles: {
      title: "Każdy widzi to, co powinien",
      lead: "Trzy role z jasno określonymi uprawnieniami.",
      admin: {
        title: "Administrator",
        body: "Ustala globalną konfigurację: wagi ról, wagi KPI i mapowanie ocen na współczynniki. Widzi wszystkie projekty.",
      },
      supervisor: {
        title: "Przełożony",
        body: "Prowadzi swoje projekty i kamienie milowe, przypisuje ludzi, ocenia KPI i zatwierdza wyniki.",
      },
      employee: {
        title: "Pracownik",
        body: "Widzi tylko swoje zatwierdzone premie i ich historię. Cudzych kwot nie zobaczy nawet po zmianie adresu URL.",
      },
    },
    guarantees: {
      title: "Zasady, których system pilnuje sam",
      lead: "Reguły są egzekwowane w bazie danych, nie tylko w interfejsie.",
      budget: {
        title: "Budżet pod kontrolą",
        body: "Wypłaty nie przekroczą puli, a ryzyko przekroczenia budżetu projektu jest oznaczane z wyprzedzeniem.",
      },
      frozen: {
        title: "Zamrożone wyniki",
        body: "Zmiana wag lub współczynników działa tylko na przyszłe wyliczenia. Zatwierdzone kamienie milowe się nie zmieniają.",
      },
      overload: {
        title: "Ostrzeżenie o przeciążeniu",
        body: "Gdy łączny udział czasowy pracownika w aktywnych kamieniach milowych przekracza 100%, system to oznacza.",
      },
      privacy: {
        title: "Prywatność kwot",
        body: "Uprawnienia na poziomie wierszy w bazie gwarantują, że każdy widzi wyłącznie swoje dane.",
      },
    },
    finalCta: {
      title: "Podziel pierwszą pulę premiową w kilka minut",
    },
  },
  dashboard: {
    title: "Panel",
    welcome: "Witaj,",
    noRole: "brak roli",
    authOnly: "Ta strona jest dostępna tylko dla zalogowanych użytkowników.",
  },
  auth: {
    signin: {
      title: "Zaloguj się",
      heading: "Zaloguj się",
      noAccount: "Nie masz konta?",
    },
    signup: {
      title: "Załóż konto",
      heading: "Załóż konto",
      haveAccount: "Masz już konto?",
    },
    confirmEmail: {
      doneHeading: "Rejestracja zakończona",
      doneDescription: "Konto zostało utworzone. Możesz się teraz zalogować.",
      doneLink: "Przejdź do logowania",
      checkHeading: "Sprawdź skrzynkę e-mail",
      checkDescription: "Wysłaliśmy link potwierdzający na Twój adres e-mail. Kliknij go, aby aktywować konto.",
      checkLink: "Wróć do logowania",
    },
    setPassword: {
      title: "Ustaw hasło",
      heading: "Ustaw hasło",
      introForEmail: "Wybierz hasło dla konta {email}.",
      introGeneric: "Wybierz hasło do swojego konta.",
      introSuffix: "Będziesz go używać do logowania.",
      newPassword: "Nowe hasło",
      confirmPassword: "Potwierdź hasło",
      submit: "Ustaw hasło",
    },
    signinErrors: {
      invalid_credentials: "Nieprawidłowy e-mail lub hasło",
      email_not_confirmed: "Potwierdź adres e-mail przed zalogowaniem",
      invite_invalid: "Ten link z zaproszeniem jest nieprawidłowy lub wygasł. Poproś przełożonego o ponowne wysłanie.",
      not_configured: "Supabase nie jest skonfigurowany",
      signin_failed: "Nie udało się zalogować. Spróbuj ponownie.",
    },
    signupErrors: {
      not_configured: "Supabase nie jest skonfigurowany",
      weak_password: "Hasło jest za słabe. Wybierz dłuższe lub bardziej złożone hasło.",
      user_already_exists: "Konto z tym adresem e-mail już istnieje.",
      email_address_invalid: "Ten adres e-mail jest nieprawidłowy.",
      over_email_send_rate_limit: "Wysłano zbyt wiele wiadomości e-mail. Spróbuj ponownie za chwilę.",
      signup_failed: "Nie udało się założyć konta. Spróbuj ponownie.",
    },
    signInForm: {
      emailLabel: "E-mail",
      emailPlaceholder: "ty@przyklad.pl",
      emailRequired: "Podaj adres e-mail",
      emailInvalid: "Podaj prawidłowy adres e-mail",
      passwordLabel: "Hasło",
      passwordPlaceholder: "Twoje hasło",
      passwordRequired: "Podaj hasło",
      showPassword: "Pokaż hasło",
      hidePassword: "Ukryj hasło",
      submit: "Zaloguj się",
      pending: "Logowanie…",
    },
    signUpForm: {
      emailLabel: "E-mail",
      emailPlaceholder: "ty@przyklad.pl",
      emailRequired: "Podaj adres e-mail",
      emailInvalid: "Podaj prawidłowy adres e-mail",
      passwordLabel: "Hasło",
      passwordPlaceholder: "Min. {min} znaków",
      passwordRequired: "Podaj hasło",
      passwordTooShort: "Hasło musi mieć co najmniej {min} znaków",
      confirmLabel: "Potwierdź hasło",
      confirmPlaceholder: "Wpisz hasło ponownie",
      confirmRequired: "Potwierdź hasło",
      passwordMismatch: "Hasła nie są zgodne",
      // Resolved client-side with plural(locale, count, charsNeeded); {count} is filled by format().
      charsNeeded: {
        one: "Wpisz jeszcze {count} znak",
        few: "Wpisz jeszcze {count} znaki",
        many: "Wpisz jeszcze {count} znaków",
        other: "Wpisz jeszcze {count} znaku",
      },
      showPassword: "Pokaż hasło",
      hidePassword: "Ukryj hasło",
      submit: "Załóż konto",
      pending: "Zakładanie konta…",
    },
  },
  // Load errors: services return the code "load_failed" (or "settings_missing"); pages show these.
  projects: {
    loadFailed: "Nie udało się wczytać projektów. Spróbuj ponownie.",
    title: "Projekty",
    intro:
      "Kwota zarezerwowana to najgorszy przypadek: każdy nieanulowany kamień milowy w wysokości swojej puli docelowej. Przekroczenie budżetu jest tylko ostrzeżeniem.",
    listLoadFailedTitle: "Nie udało się wczytać projektów.",
    allProjects: "Wszystkie projekty",
    yourProjects: "Twoje projekty",
    empty: "Nie ma jeszcze projektów. Utwórz pierwszy poniżej.",
    columns: {
      budget: "Budżet",
      reserved: "Zarezerwowane",
      remaining: "Pozostało",
      budgetFlag: "Oznaczenie budżetu",
    },
    overBudget: "Budżet przekroczony",
    detail: {
      fallbackTitle: "Projekt",
      backToProjects: "Wróć do projektów",
      loadFailedTitle: "Nie udało się wczytać projektu.",
      notFound: "Nie znaleziono projektu.",
      notFoundDescription: "Projekt nie istnieje lub nie masz do niego dostępu.",
    },
    form: {
      detailsHeading: "Szczegóły projektu",
      newHeading: "Nowy projekt",
      description:
        "Kwoty w PLN, większe od 0, z najwyżej 2 miejscami po przecinku. Data zakończenia nie może być wcześniejsza niż data rozpoczęcia.",
      saved: "Projekt zapisany.",
      totalBudget: "Budżet całkowity (PLN)",
      save: "Zapisz projekt",
      create: "Utwórz projekt",
      creating: "Tworzenie…",
    },
    exposure: {
      heading: "Obciążenie budżetu",
      description:
        "Najgorszy przypadek: każdy nieanulowany kamień milowy jest zarezerwowany w wysokości swojej puli docelowej, czyli najwyższej możliwej wypłaty. Tylko informacyjnie; nic nie jest blokowane.",
      budget: "Budżet",
      reserved: "Zarezerwowane (najgorszy przypadek)",
      remaining: "Pozostało",
      unavailable: "Obciążenie budżetu nie jest dostępne dla tego projektu.",
    },
  },
  milestones: {
    assignmentsLoadFailed: "Nie udało się wczytać przypisań. Spróbuj ponownie.",
    bonusesLoadFailed: "Nie udało się wczytać premii. Spróbuj ponownie.",
    // Shown in place of a figure that needs all four KPI scores.
    unscored: "Wpisz wyniki KPI",
    // Button and label text that the approval notices quote by name (approvalNoticeMessage).
    emailsSent: "Wysłane e-maile",
    resendUnsentEmails: "Wyślij ponownie niewysłane e-maile",
    // Milestones card on the project page. {status} is a lower-cased t.status label.
    section: {
      heading: "Kamienie milowe",
      description:
        "Okres każdego kamienia milowego musi mieścić się w okresie projektu ({start} – {end}). Anulowane kamienie milowe nie są rezerwowane w budżecie; zatwierdzone rezerwują swoją faktyczną pulę do wypłaty.",
      saved: "Kamienie milowe zapisane.",
      adminReadOnly: "Administrator może przeglądać kamienie milowe, ale nie może ich zmieniać.",
      projectClosed:
        "Ten projekt jest {status}. Otwórz go ponownie (ustaw status planowany lub aktywny), zanim dodasz lub zmienisz jego kamienie milowe.",
      empty: "Nie ma jeszcze kamieni milowych.",
      emptyCanAdd: "Nie ma jeszcze kamieni milowych. Dodaj pierwszy poniżej.",
      addHeading: "Dodaj kamień milowy",
    },
    form: {
      targetPool: "Pula docelowa (PLN)",
      save: "Zapisz kamień milowy",
      add: "Dodaj kamień milowy",
      adding: "Dodawanie…",
    },
    // Milestone page.
    page: {
      fallbackTitle: "Kamień milowy",
      backTo: "Wróć do: {name}",
      backToProjects: "Wróć do projektów",
      loadFailedTitle: "Nie udało się wczytać kamienia milowego.",
      notFound: "Nie znaleziono kamienia milowego.",
      notFoundDescription: "Kamień milowy nie istnieje lub nie masz do niego dostępu.",
      detailsHeading: "Szczegóły kamienia milowego",
    },
    // Flash after an assignment form (?saved=<code>).
    saved: {
      created: "Pracownik przypisany.",
      updated: "Przypisanie zapisane.",
      deleted: "Przypisanie usunięte.",
    },
    // Why the KPI scores are read-only. {status} is a lower-cased t.status label.
    kpiReadOnly: {
      approved: "Zatwierdzone kamienie milowe są zamrożone; ich wyników KPI nie można zmienić.",
      admin: "Administrator może przeglądać wyniki KPI, ale nie może ich zmieniać.",
      cancelled: "Ten kamień milowy jest anulowany; jego wyników nie można zmienić.",
      projectClosed: "Ten projekt jest {status}. Otwórz go ponownie, zanim zmienisz wyniki KPI.",
    },
    // Why there is no Approve button. {status} is a lower-cased t.status label.
    approvalBlocked: {
      admin: "Administrator może przeglądać zatwierdzenia, ale nie może zatwierdzać kamieni milowych.",
      cancelled: "Ten kamień milowy jest anulowany; nie można go zatwierdzić.",
      projectClosed: "Ten projekt jest {status}. Otwórz go ponownie, zanim zatwierdzisz jego kamienie milowe.",
      payoutMissing: "Nie udało się wczytać wyliczonych premii; odśwież stronę przed zatwierdzeniem.",
      unscored: "Wpisz wszystkie cztery wyniki KPI przed zatwierdzeniem.",
      noEngagements: "Przypisz co najmniej jednego pracownika przed zatwierdzeniem.",
    },
    assignments: {
      heading: "Przypisania",
      adminReadOnly: "Administrator może przeglądać przypisania, ale nie może ich zmieniać.",
      approvedFrozen: "Zatwierdzone kamienie milowe są zamrożone; przypisań nie można już zmienić.",
      milestoneIs: "Ten kamień milowy jest {status}.",
      projectIs: "Ten projekt jest {status}.",
      reopen: "Otwórz go ponownie (ustaw status planowany lub aktywny), zanim zmienisz jego przypisania.",
      empty: "Nie przypisano jeszcze żadnego pracownika.",
      formerMember: "Były członek zespołu",
      deleteAssignmentOf: "Usuń przypisanie: {name}",
      assignHeading: "Przypisz pracownika",
      // Rendered as: noneLeftBefore <link>noneLeftLink</link>noneLeftAfter
      noneLeftBefore:
        "Żaden z Twoich pracowników nie pozostał do przypisania do tego kamienia milowego. Zarejestruj pracowników na stronie",
      noneLeftLink: "Pracownicy",
      noneLeftAfter: ".",
    },
    engagementForm: {
      chooseEmployee: "Wybierz pracownika",
      timeShare: "Udział czasowy (0.01–1.00)",
      rating: "Ocena (1–5)",
      save: "Zapisz przypisanie",
      assign: "Przypisz pracownika",
      assigning: "Przypisywanie…",
    },
    kpi: {
      heading: "Wyniki KPI",
      description:
        "Liczby całkowite od 0 do 100; dla każdego wyniku, także Ryzyko, wyższa wartość jest lepsza. Wpisz wszystkie cztery, aby wyliczyć premie.",
      saved: "Wyniki KPI zapisane.",
      hint: "0–100, więcej znaczy lepiej",
      save: "Zapisz wyniki KPI",
      none: "Nie wpisano jeszcze wyników KPI.",
    },
    payout: {
      heading: "Wyliczone premie",
      withinPool: "W granicach puli do wypłaty",
      exceedsPool: "Przekracza pulę do wypłaty",
      approvedOn: "Zatwierdzono {date} — wartości są zamrożone; każdy pracownik widzi swoją premię.",
      draft: "Wartości robocze (Szkic); pracownicy nie widzą ich, dopóki kamień milowy nie zostanie zatwierdzony.",
      formula:
        "Pula docelowa to zatwierdzone maksimum: pula do wypłaty to pula docelowa × mnożnik KPI ÷ maksymalny mnożnik, więc całą pulę docelową wypłaca tylko maksymalny wynik. Pula jest dzielona według iloczynu udział czasowy × waga roli × współczynnik oceny, a każda premia jest zaokrąglana w dół do pełnego grosza.",
      figures: {
        targetPoolMax: "Pula docelowa (maks.)",
        kpiMultiplier: "Mnożnik KPI",
        shareOfTargetPool: "Udział w puli docelowej",
        payoutPool: "Pula do wypłaty",
        payoutTotal: "Suma wypłat",
        residual: "Reszta z zaokrągleń",
      },
      // Rendered as: noLinesBefore <link>noLinesLink</link>noLinesAfter
      noLinesBefore: "Nie przypisano jeszcze żadnego pracownika. Przypisz pracowników w sekcji",
      noLinesLink: "Przypisania",
      noLinesAfter: ", aby podzielić pulę.",
      weightedContribution: "Ważony wkład",
      share: "Udział",
    },
    approval: {
      heading: "Zatwierdzenie",
      description:
        "Zatwierdzenie jest ostateczne: wyliczone premie zostają zamrożone i dopiero wtedy każdy pracownik widzi swoją premię.",
      approvedFlash: "Kamień milowy zatwierdzony.",
      resentFlash: "Niewysłane e-maile wysłane ponownie.",
      approvedOn: "Zatwierdzono {date}.",
      approvedNoDate: "Zatwierdzono.",
      frozenNote: "Wartości są zamrożone, a każdy pracownik widzi swoją premię.",
      countOf: "{sent} z {total}",
      sending: "Wysyłanie…",
      confirm: "Rozumiem, że to ostateczne; wartości zostaną zamrożone, a pracownicy powiadomieni",
      approve: "Zatwierdź kamień milowy",
      approving: "Zatwierdzanie…",
    },
  },
  employees: {
    loadFailed: "Nie udało się wczytać pracowników. Spróbuj ponownie.",
    title: "Pracownicy",
    listLoadFailedTitle: "Nie udało się wczytać pracowników.",
    // Flash after an employee form (?saved=<code>).
    saved: {
      created: "Pracownik zarejestrowany. Wyślij zaproszenie, kiedy zechcesz.",
      updated: "Pracownik zapisany.",
      invited: "Zaproszenie wysłane.",
    },
    allEmployees: "Wszyscy pracownicy",
    yourEmployees: "Twoi pracownicy",
    empty: "Nie ma jeszcze pracowników. Zarejestruj pierwszego poniżej.",
    fullName: "Imię i nazwisko",
    invite: "Zaproszenie",
    sendInvite: "Wyślij zaproszenie",
    resendInvite: "Wyślij zaproszenie ponownie",
    registerHeading: "Zarejestruj pracownika",
    registerNote:
      "Rejestracja nie wysyła e-maila. Wyślij zaproszenie z listy, kiedy zechcesz; potem adresu e-mail nie można już zmienić.",
    form: {
      emailLocked: "Zablokowany po pierwszym zaproszeniu.",
      chooseJobRole: "Wybierz rolę",
      archivedRole: "{name} (zarchiwizowana)",
      save: "Zapisz pracownika",
      register: "Zarejestruj pracownika",
    },
    detail: {
      fallbackTitle: "Pracownik",
      backToEmployees: "Wróć do pracowników",
      loadFailedTitle: "Nie udało się wczytać pracownika.",
      notFound: "Nie znaleziono pracownika.",
      notFoundDescription: "Pracownik nie istnieje lub nie masz do niego dostępu.",
      account: "Konto",
      currentAssignments: "Bieżące przypisania",
      assignmentsDescriptionAll:
        "Otwarte kamienie milowe: niezakończone, nieanulowane i niezatwierdzone, w projektach, które są nadal otwarte. Premie pojawią się poniżej po zatwierdzeniu kamienia milowego.",
      assignmentsDescriptionOwn:
        "Otwarte kamienie milowe w Twoich projektach: niezakończone, nieanulowane i niezatwierdzone, w projektach, które są nadal otwarte. Premie pojawią się poniżej po zatwierdzeniu kamienia milowego.",
      noOpenAssignments: "Brak otwartych przypisań.",
      historyAll: "Wszystkie zatwierdzone premie",
      historyOwn: "Zatwierdzone premie w Twoich projektach",
      historyDescription:
        "Zamrożone w chwili zatwierdzenia, pogrupowane według projektów, z sumą częściową dla każdego projektu i sumą całkowitą.",
    },
  },
  history: {
    loadFailed: "Nie udało się wczytać premii. Spróbuj ponownie.",
    empty: "Nie ma jeszcze zatwierdzonych premii.",
    // {milestones} is one of approvedMilestones, picked with plural(); {count} is filled by format().
    totalAcross: "Razem za {milestones}",
    approvedMilestones: {
      one: "{count} zatwierdzony kamień milowy",
      few: "{count} zatwierdzone kamienie milowe",
      many: "{count} zatwierdzonych kamieni milowych",
      other: "{count} zatwierdzonego kamienia milowego",
    },
    subtotal: "Suma częściowa",
    approvedAt: "Zatwierdzono",
    roleWeightOf: "Waga roli ({role})",
  },
  myBonuses: {
    loadFailed: "Nie udało się wczytać premii. Spróbuj ponownie.",
    title: "Moje premie",
    loadFailedTitle: "Nie udało się wczytać Twoich premii.",
    approvedHeading: "Zatwierdzone premie",
    description:
      "Twoja premia za każdy zatwierdzony kamień milowy, pogrupowana według projektów, z sumą częściową dla każdego projektu i sumą całkowitą, wraz z wartościami, z których ją wyliczono. Zatwierdzone wyniki są ostateczne.",
    notLinked:
      "Twoje konto nie jest jeszcze powiązane z rekordem pracownika; poproś przełożonego o wysłanie zaproszenia.",
  },
  // Aggregate bonus report (/reports/bonuses) and its CSV export.
  reports: {
    title: "Raport premii",
    resultsHeading: "Premie według pracowników",
    scopeAll: "Premie z zatwierdzonych kamieni milowych we wszystkich projektach, zsumowane dla każdego pracownika.",
    scopeOwn:
      "Premie z zatwierdzonych kamieni milowych w Twoich projektach, zsumowane dla każdego pracownika. Jeśli pracownik pracował też w projektach innego przełożonego, jego suma obejmuje tylko Twoje projekty.",
    filter: {
      legend: "Okres zatwierdzenia",
      from: "Zatwierdzone od",
      to: "Zatwierdzone do",
      hint: "Dzień zatwierdzenia kamienia milowego (czas polski), obie granice włącznie. Puste pole oznacza brak granicy.",
      submit: "Pokaż",
      clear: "Wyczyść",
    },
    columns: {
      employee: "Pracownik",
      milestones: "Zatwierdzone kamienie milowe",
      total: "Suma premii",
    },
    // Header row of the CSV export; amounts in the file have no currency sign.
    csv: {
      name: "Pracownik",
      milestones: "Liczba zatwierdzonych kamieni milowych",
      total: "Suma premii (PLN)",
    },
    grandTotal: "Razem",
    downloadCsv: "Pobierz CSV",
    empty: "Nie ma jeszcze zatwierdzonych premii.",
    emptyInRange: "Brak zatwierdzonych premii w wybranym okresie.",
    invalidTitle: "Nieprawidłowy zakres dat.",
    // Keyed by the parseBonusReportFilter error code.
    filterErrors: {
      invalid_date: "Podaj prawidłowe daty w formacie RRRR-MM-DD.",
      range_reversed: "Data „od” nie może być późniejsza niż data „do”.",
    },
    loadFailedTitle: "Nie udało się wczytać raportu.",
    loadFailed: "Nie udało się wczytać raportu premii. Spróbuj ponownie.",
  },
  admin: {
    loadFailed: "Nie udało się wczytać konfiguracji. Spróbuj ponownie.",
    settingsMissing: "Brak ustawień premii.",
    title: "Administracja",
    signedInAs: "Zalogowano jako",
    adminOnly: "Ta strona jest dostępna tylko dla administratorów.",
    bonusSettings: "Ustawienia premii",
    settings: {
      backToAdmin: "Wróć do administracji",
      intro:
        "Zmiany dotyczą tylko przyszłych wyliczeń. Zatwierdzone kamienie milowe zachowują wartości, z którymi zostały wyliczone.",
      loadFailedTitle: "Nie udało się wczytać konfiguracji premii.",
    },
    jobRoles: {
      heading: "Role",
      description:
        "Waga roli jest większa od 0 i wynosi najwyżej 3, z maksymalnie 2 miejscami po przecinku. Zarchiwizowane role pozostają widoczne w istniejących przypisaniach, ale nie można ich wybrać do nowych.",
      saved: "Role zapisane.",
      active: "Aktywne role",
      archived: "Zarchiwizowane role",
      weight: "Waga",
      descriptionLabel: "Opis",
      archive: "Archiwizuj",
      restore: "Przywróć",
      addHeading: "Dodaj rolę",
      add: "Dodaj rolę",
    },
    kpi: {
      heading: "KPI kamienia milowego",
      description:
        "Wagi KPI muszą sumować się do 1,00. Mnożnik kamienia milowego pozostaje między dolną a górną granicą.",
      saved: "Ustawienia KPI zapisane.",
      weightsLegend: "Wagi KPI (muszą sumować się do 1,00)",
      boundsLegend: "Granice mnożnika kamienia milowego (0 < min < max ≤ 3)",
      minMultiplier: "Minimalny mnożnik",
      maxMultiplier: "Maksymalny mnożnik",
      save: "Zapisz ustawienia KPI",
    },
    factors: {
      heading: "Współczynniki oceny wkładu",
      description:
        "Współczynnik stosowany dla każdej oceny wkładu. Wartości nie mogą maleć od oceny 1 do oceny 5; każda jest większa od 0 i wynosi najwyżej 3.",
      saved: "Współczynniki oceny zapisane.",
      ratingN: "Ocena {rating}",
      save: "Zapisz współczynniki oceny",
    },
  },
  status: {
    role: {
      admin: "Administrator",
      supervisor: "Przełożony",
      employee: "Pracownik",
    },
    // Project and milestone statuses (projekt and kamień milowy are masculine).
    work: {
      planned: "Planowany",
      active: "Aktywny",
      completed: "Zakończony",
      cancelled: "Anulowany",
    },
    milestone: {
      planned: "Planowany",
      active: "Aktywny",
      completed: "Zakończony",
      cancelled: "Anulowany",
      approved: "Zatwierdzony",
    },
    invite: {
      not_invited: "Bez zaproszenia",
      invited: "Zaproszenie wysłane",
      active: "Konto aktywne",
    },
  },
};

export type Messages = typeof pl;
