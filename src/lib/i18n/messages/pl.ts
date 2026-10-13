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
    },
  },
  landing: {
    pitch: "Sprawiedliwy podział puli premiowej kamieni milowych",
    howItWorks: "Jak to działa",
    goToDashboard: "Przejdź do panelu",
    steps: {
      pool: {
        title: "Pula do wypłaty",
        body: "Wynik KPI kamienia milowego skaluje pulę docelową do puli do wypłaty, która nigdy nie przekracza puli docelowej.",
      },
      share: {
        title: "Udział każdego pracownika",
        body: "Pula jest dzielona proporcjonalnie do iloczynu: udział czasowy × waga roli × współczynnik oceny, z zaokrągleniem w dół.",
      },
      approval: {
        title: "Zatwierdzenie",
        body: "Wyniki pozostają szkicem, dopóki przełożony nie zatwierdzi kamienia milowego. Dopiero wtedy każdy pracownik widzi swoją premię.",
      },
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
  },
  milestones: {
    assignmentsLoadFailed: "Nie udało się wczytać przypisań. Spróbuj ponownie.",
    bonusesLoadFailed: "Nie udało się wczytać premii. Spróbuj ponownie.",
    // Shown in place of a figure that needs all four KPI scores.
    unscored: "Wpisz wyniki KPI",
    // Button and label text that the approval notices quote by name (approvalNoticeMessage).
    emailsSent: "Wysłane e-maile",
    resendUnsentEmails: "Wyślij ponownie niewysłane e-maile",
  },
  employees: {
    loadFailed: "Nie udało się wczytać pracowników. Spróbuj ponownie.",
  },
  history: {
    loadFailed: "Nie udało się wczytać premii. Spróbuj ponownie.",
  },
  myBonuses: {
    loadFailed: "Nie udało się wczytać premii. Spróbuj ponownie.",
  },
  admin: {
    loadFailed: "Nie udało się wczytać konfiguracji. Spróbuj ponownie.",
    settingsMissing: "Brak ustawień premii.",
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
