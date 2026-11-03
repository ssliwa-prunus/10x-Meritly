---
title: Plan refaktoru — warstwa ochronna (ACL) dla tożsamości Supabase Auth
created: 2026-10-31
type: refactor-plan
---

# ACL dla tożsamości: `AuthGateway` + `Principal`

Produkt to **plan**; kod produkcyjny nie był zmieniany. Cytaty `plik:linia` zweryfikowano w repo (2026-10-31, `develop`, `bd2fcdd`). Fakty o kontrakcie biblioteki pochodzą z dokumentacji `supabase-js` pobranej przez Context7 w tej sesji (§5.3); czego tam nie znalazłem, oznaczam jako niezweryfikowane.

## 0. Kontekst

- Stack: Astro 7 SSR + React 19 + Supabase (Postgres, Auth, Edge Functions) na Cloudflare Workers (`context/foundation/tech-stack.md:22-39`). Zależności zewnętrzne ważne dla granic: `@supabase/supabase-js`, `@supabase/ssr`, `zod`, `@sentry/astro`, `@sentry/cloudflare` (`package.json`, sekcja `dependencies`).
- Warstwy: strony i trasy API (`src/pages/**`), middleware (`src/middleware.ts`), serwisy (`src/lib/services/*.ts`), czyste helpery (`src/lib/*.ts`), komponenty (`src/components/**`), baza z RLS (`supabase/migrations/`), funkcje Edge (`supabase/functions/`).
- **Deklaracje wymienialności: nie ma żadnej wprost.** Nie znalazłem w `prd.md`, `shape-notes.md`, `tech-stack.md`, `README.md`, `CLAUDE.md` ani `infrastructure.md` zdania typu „odseparowane, żeby dało się wymienić X”. Najbliższe są deklaracje _zamiaru zmiany_ (§3.1) — i tylko one służą tu jako sygnał rozjazdu intencja–kod.

---

## 1. Przeciekające zależności (identyfikacja)

| ID     | Zależność                                                                                    | Gdzie przecieka                                                             | Pliki, które ją znają (zweryfikowane)                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------ | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **L1** | **Tożsamość: Supabase Auth** (`supabase.auth.*`, typ `User`, `getClaims`/`amr`, kody błędów) | middleware, trasy API, strony/komponenty UI, kontrakt `App.Locals`, helpery | 15 plików w `src/` + funkcja Edge + 8 migracji (lista w §3.2)                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| L2     | Klient danych: `SupabaseClient`, `PostgrestError` w sygnaturach serwisów                     | serwisy, trasy API, strony                                                  | importy typów w 9 plikach (`approvals.ts:1`, `bonus-config.ts:1`, `dashboard.ts:1`, `employees.ts:1`, `engagements.ts:1`, `payouts.ts:1`, `projects.ts:1`, `reports.ts:1`, `set-password.ts:1`, wszystkie w `src/lib/…`), 36 plików zawiera `createClient(`: definicja `src/lib/supabase.ts`, `src/middleware.ts` i 34 strony/trasy; 6 prawie identycznych `mapPostgrestError` (`approvals.ts:205`, `bonus-config.ts:262`, `employees.ts:231`, `engagements.ts:210`, `payouts.ts:173`, `projects.ts:298`) |
| L3     | `zod` w sygnaturach i duplikacja opakowań                                                    | serwisy, helpery, trasy                                                     | 12 plików importuje `zod`; `z.ZodError`/`z.ZodType` w publicznych sygnaturach; `firstIssueError`/`parseForm` zdefiniowane 7× (`src/lib/forms.ts:15,26` + po jednej kopii w `approvals.ts:134,139`, `bonus-config.ts:211,216`, `employees.ts:165,170`, `engagements.ts:142,147`, `payouts.ts:112,117`, `projects.ts:218,223`)                                                                                                                                                                              |
| L4     | Transport powiadomień/zaproszeń: `supabase.functions.invoke`, `FunctionsHttpError`           | serwisy + moduł logowania                                                   | `approvals.ts:1,420`, `employees.ts:1,428`, `error-log.ts:3-5`                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| L5     | Sentry                                                                                       | konfiguracje                                                                | tylko `sentry.client.config.ts`, `sentry.server.config.ts`, `astro.config.mjs:9,19` — **bez przecieku** (grep po `@sentry` w `src/` → 0)                                                                                                                                                                                                                                                                                                                                                                  |
| L6     | `astro:env/server`                                                                           | 2 pliki                                                                     | `src/lib/supabase.ts:3`, `src/layouts/Layout.astro:13` — drobne                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Przeciek do klienta (bundla przeglądarki) nie występuje: komponenty React nie importują SDK (grep importów `@supabase`/`zod` w `src/components` → 0 trafień), a `SUPABASE_KEY` jest czytany tylko w kodzie serwerowym (`src/lib/supabase.ts:3`, `Layout.astro:13` — frontmatter `.astro`).

---

## 2. Klasyfikacja i wybór #1

| ID     | (a) Warstwy / pliki                                                                                              | (b) Ryzyko i koszt wymiany dziś                                                                                       | (c) Deklaracja zamiaru zmiany vs kod                                                                                                                                                                                                       |
| ------ | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **L1** | **5 warstw**: middleware, trasy API, strony, komponenty, kontrakt `Locals`, helpery, Deno, SQL; 15 plików `src/` | **wysokie**: krytyczne dla bezpieczeństwa (sesja, zaproszenia, role), kody błędów i kształt `amr` znane w 3 miejscach | **jest**: SSO/OAuth „downstream” (`prd.md:154`), Entra ID i Teams (`shape-notes.md:26`, `:185-186`); PRD wymaga „email + password **or OAuth**”, kod ma tylko hasło (`signin.ts:19`, `set-password.ts` API `:29`; `grep -i oauth src` → 0) |
| L2     | 4 warstwy, ~45 plików                                                                                            | wysokie, ale baza _jest_ domeną (RLS, funkcje) — wymiana klienta danych = przepisanie projektu                        | brak deklaracji                                                                                                                                                                                                                            |
| L3     | 3 warstwy, 12 plików                                                                                             | niskie–średnie; duplikacja pomocników, ale zod to konwencja (`CLAUDE.md`: „validate input with zod”)                  | brak                                                                                                                                                                                                                                       |
| L4     | 2 warstwy, 3 pliki                                                                                               | średnie; kanał Teams to „long-term target” (`prd.md:168`)                                                             | częściowa (kanały inne niż e-mail)                                                                                                                                                                                                         |
| L5     | 0                                                                                                                | —                                                                                                                     | —                                                                                                                                                                                                                                          |
| L6     | 2                                                                                                                | niskie                                                                                                                | brak                                                                                                                                                                                                                                       |

### Wybór #1: **L1 — tożsamość Supabase Auth**

Jedyna zależność, która jednocześnie (a) przecina wszystkie warstwy łącznie z kontraktem żądania `App.Locals`, (b) jest wrażliwa bezpieczeństwowo i (c) ma w dokumentach zadeklarowany zamiar zmiany mechanizmu logowania, którego kod nie odzwierciedla. L2 jest szersza liczbowo, ale to inna decyzja (zob. §6). L4 jest następna w kolejności.

---

## 3. Diagnoza L1

### 3.1 Co deklarują dokumenty

- „Login (email + password or OAuth). Company single sign-on integration was raised as a future option but is a downstream tech-stack decision, not locked here.” — `context/foundation/prd.md:154`.
- „Company SSO (Microsoft Entra ID) considered but deferred as a downstream tech-stack concern” — `context/foundation/shape-notes.md:26`; cel długoterminowy: aplikacja w MS Teams — `shape-notes.md:185-186`.
- Kod: tylko `signInWithPassword` (`src/pages/api/auth/signin.ts:19`, `src/pages/api/auth/set-password.ts:29`), `signUp` (`api/auth/signup.ts:14`), `verifyOtp` dla zaproszeń (`src/pages/auth/confirm.ts:36`). OAuth/SSO: 0 trafień.

Wniosek: dodanie dostawcy tożsamości dziś oznacza dotknięcie każdej warstwy — a PRD zapowiada to jako realny scenariusz.

### 3.2 Pełna lista miejsc, które „znają” Supabase Auth

| Warstwa             | Plik:linia                                                                                                                                                                                                                      | Co wie o bibliotece                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Kontrakt żądania    | `src/env.d.ts:3`                                                                                                                                                                                                                | `App.Locals.user: import("@supabase/supabase-js").User \| null` — typ biblioteki widoczny w każdej stronie i komponencie |
| Middleware          | `src/middleware.ts:21-22`                                                                                                                                                                                                       | `supabase.auth.getUser()` → `locals.user`                                                                                |
| Middleware          | `src/middleware.ts:29`, `:57`                                                                                                                                                                                                   | `user.id` (kształt obiektu `User`), `locals.user !== null`                                                               |
| Helper              | `src/lib/set-password.ts:1`, `:67-80`                                                                                                                                                                                           | `SupabaseClient`; `auth.getClaims()`; rekonstrukcja kształtu `amr` (`string \| {method}`), zbiór `INVITE_AMR_METHODS`    |
| Helper              | `src/lib/auth-errors.ts:19-30`                                                                                                                                                                                                  | kody błędów Supabase (`weak_password`, `user_already_exists`, `email_exists`, …)                                         |
| Logowanie           | `src/lib/error-log.ts:6`, `:127`, `:165`                                                                                                                                                                                        | `isAuthError`; `locals.user?.id` (to jedyne miejsce już zawężone do `{ id: string }`)                                    |
| Trasa API           | `src/pages/api/auth/signin.ts:19`, `:23-24`, `:36`                                                                                                                                                                              | `signInWithPassword`; kody `invalid_credentials`/`email_not_confirmed`; `data.user.id`                                   |
| Trasa API           | `src/pages/api/auth/signup.ts:14`, `:18`                                                                                                                                                                                        | `signUp`; `error.code` do `signupErrorCode`                                                                              |
| Trasa API           | `src/pages/api/auth/signout.ts:8`                                                                                                                                                                                               | `auth.signOut()`                                                                                                         |
| Trasa API           | `src/pages/api/auth/set-password.ts:21`, `:27`, `:29`                                                                                                                                                                           | `updateUser`, `locals.user?.email`, drugie `signInWithPassword`                                                          |
| Trasa               | `src/pages/auth/confirm.ts:32-36`                                                                                                                                                                                               | `locals.user`, `signOut({scope:"local"})`, `verifyOtp({token_hash,type})`                                                |
| Trasa API           | `src/pages/api/locale.ts:31`                                                                                                                                                                                                    | `locals.user` (prawda/fałsz)                                                                                             |
| UI                  | `src/components/Topbar.astro:19`, `:84`                                                                                                                                                                                         | `Astro.locals.user`, pole `user.email`                                                                                   |
| UI                  | `src/components/Welcome.astro:22`                                                                                                                                                                                               | `Boolean(Astro.locals.user)`                                                                                             |
| UI                  | `src/pages/auth/set-password.astro:14`                                                                                                                                                                                          | `Astro.locals.user?.email`                                                                                               |
| Funkcja Edge (Deno) | `supabase/functions/invite-employee/index.ts:75`                                                                                                                                                                                | `supabaseAdmin.auth.admin.inviteUserByEmail`                                                                             |
| Baza                | `supabase/migrations/*.sql` (8 plików z `auth.uid()`; `20260925120000_role_and_rls_scaffold.sql:13`, `:43-45` trigger na `auth.users`; `20260929120000_employees_and_engagements.sql:367-369` trigger `on_auth_user_confirmed`) | tożsamość = `auth.uid()` / `auth.users`                                                                                  |
| Konfiguracja        | `supabase/config.toml:158`, `:175`, `:209`                                                                                                                                                                                      | `jwt_expiry = 3600`, `minimum_password_length = 6`, `enable_confirmations = false`                                       |

### 3.3 Duplikacja i niespójność

1. **`signInWithPassword` w dwóch trasach** (`signin.ts:19`, `api/auth/set-password.ts:29`) z różną obsługą błędu: pierwsza mapuje dwa kody (`:23-24`), druga milcząco odsyła na `/auth/signin` (`:31-34`).
2. **Kody błędów Supabase znane w dwóch miejscach**: `signin.ts:23-24` (inline) i `auth-errors.ts:19-30` (osobny słownik dla `signUp`).
3. **Polityka haseł rozdzielona i niespójna**: reguły 6–72 w `set-password.ts:49-62` (komentarz `:49`: „Minimum matches supabase/config.toml minimum_password_length”), tej samej reguły nie ma przy rejestracji — tam pilnuje jej wyłącznie błąd `weak_password` z biblioteki (`auth-errors.ts:21-22`); minimum 6 żyje też w `config.toml:175`.
4. **Rekonstrukcja struktury `amr`** tylko w `set-password.ts:77-79` — kształt biblioteki (`string | {method}`) obsłużony ręcznie; brak jednego typu domenowego „skąd pochodzi sesja”.
5. **Obiekt `User` biblioteki w kontrakcie żądania**, choć UI potrzebuje tylko `id`/`email` — i `Profile` (`src/types.ts:7-14`) ma już `email`. `Topbar.astro:84` czyta `user.email` zamiast pola domenowego.
6. **Reguła domenowa ukryta w trasie**: „przyjęcie zaproszenia zamyka poprzednią sesję na tym urządzeniu” (`confirm.ts:30-34`) jest w handlerze HTTP, nie w modelu tożsamości.
7. **Klient tworzony wielokrotnie**: `createClient(` w 36 plikach (middleware `src/middleware.ts` i 34 strony/trasy), więc jedno żądanie może mieć kilka klientów powiązanych z tymi samymi ciasteczkami.

### 3.4 Gdzie błąd jest „połykany”

- `api/auth/set-password.ts:31-34`: nieudane logowanie po ustawieniu hasła — przekierowanie bez logu; jedyny ślad to brak sesji.
- `signin.ts:23-25`: każdy inny błąd niż dwa znane → `signin_failed` bez logowania przyczyny.
- `signup.ts:16-19`: j.w. dla rejestracji.

(Kod wyłącznie obserwacyjny: nie zmieniam zachowania w refaktorze, §5.4; dodanie logowania przyczyny w adapterze jest tanie i jawnie wpisane do planu.)

### 3.5 Klient jako jedyny strażnik

Nie dotyczy: reguły tożsamości są po stronie serwera (middleware + RLS). Problem jest odwrotny — serwerowy typ biblioteki wycieka do renderowanych widoków przez `Astro.locals`.

---

## 4. Projekt ACL

Katalog: `src/lib/auth/`. Moduły domenowe nie importują `astro:*` ani `@supabase/*` (zgodnie z konwencją testowalności: `route-access.ts:3-10`, `CLAUDE.md` — Vitest bez potoku Astro).

### 4.1 Obiekty domenowe (wartości)

```ts
// src/lib/auth/principal.ts — jedyna wiedza o tym, KIM jest zalogowany z punktu widzenia aplikacji
export interface Principal {
  readonly id: string;
  readonly email: string;
} // brak pól biblioteki
export const toPrincipal = (raw: { id: string; email?: string | null }): Principal | null =>
  raw.email ? { id: raw.id, email: raw.email } : null; // decyzja o braku e-maila w jednym miejscu

// src/lib/auth/session-origin.ts — zastępuje ręczne czytanie amr (set-password.ts:67-80)
export type SessionOrigin = "invite" | "password" | "other";
export function sessionOriginFromMethods(methods: readonly string[]): SessionOrigin {
  const latest = methods.find((m) => m !== "token_refresh"); // reguła dziś w set-password.ts:78
  if (latest === "invite" || latest === "otp") return "invite";
  return latest === "password" ? "password" : "other";
}

// src/lib/auth/password-policy.ts — jedyne miejsce reguły 6..72 (dziś set-password.ts:49-62 + config.toml:175)
export const PasswordPolicy = { min: 6, max: 72 } as const;
export function checkPassword(p: string): "ok" | "too_short" | "too_long";

// src/lib/auth/failures.ts — domenowe kody błędów; tylko one wychodzą poza adapter
export type SignInFailure = "invalid_credentials" | "email_not_confirmed" | "failed";
export type RegisterFailure = "weak_password" | "already_registered" | "invalid_email" | "rate_limited" | "failed";
export type InviteFailure = "invite_invalid";
```

### 4.2 Wąski port

```ts
// src/lib/auth/auth-gateway.ts
export type AuthResult<T, F extends string> = { ok: true; value: T } | { ok: false; failure: F };

export interface AuthGateway {
  /** Zweryfikowany po stronie serwera Auth (dziś: getUser). null = niezalogowany. */
  currentPrincipal(): Promise<Principal | null>;
  signInWithPassword(email: string, password: string): Promise<AuthResult<Principal, SignInFailure>>;
  /** Uwaga: gdy projekt ma włączone potwierdzanie e-mail i telefonu, istniejące konto może NIE zwrócić błędu (§5.3). */
  register(email: string, password: string): Promise<AuthResult<"check_email" | "signed_in", RegisterFailure>>;
  signOut(scope?: "global" | "local"): Promise<void>;
  /** Przyjęcie zaproszenia: kończy bieżącą sesję lokalnie, potem wymienia token. */
  acceptInvite(tokenHash: string): Promise<AuthResult<Principal, InviteFailure>>;
  sessionOrigin(): Promise<SessionOrigin>;
  changePassword(newPassword: string): Promise<AuthResult<void, "update_failed">>;
}
```

Nowy dostawca (OAuth/SSO) dodaje **jedną metodę** (np. `beginExternalSignIn(provider)`) do portu i jej implementację do adaptera; nic poza tym nie zna biblioteki.

### 4.3 Adapter

`src/lib/auth/supabase-auth-gateway.ts` — **jedyny** plik z `@supabase/supabase-js` w obszarze tożsamości:

```ts
export function supabaseAuthGateway(client: SupabaseClient, log?: LogContext): AuthGateway {
  return {
    async currentPrincipal() {
      const {
        data: { user },
      } = await client.auth.getUser(); // zachowanie bez zmian (middleware.ts:21)
      return user ? toPrincipal(user) : null;
    },
    async signInWithPassword(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) return fail(mapSignInError(error), "signIn", error, log); // tu jedna tablica kodów Supabase → domena
      return ok(toPrincipal(data.user)!); // brak e-maila = failed + log
    },
    async sessionOrigin() {
      const { data, error } = await client.auth.getClaims(); // zachowanie bez zmian (set-password.ts:75)
      if (error || !data) return "other"; // trzeci wariant {data:null,error:null} z dokumentacji
      return sessionOriginFromMethods((data.claims.amr ?? []).map((e) => (typeof e === "string" ? e : e.method)));
    },
    // register / signOut / acceptInvite (signOut local → verifyOtp({token_hash, type:"invite"})) / changePassword
  };
}
```

Fabryka żądania: `createAuthGateway(client)` w `src/lib/supabase.ts` (obok istniejącego `createClient`, który zostaje dla danych). Middleware tworzy klienta **raz** i wystawia `locals.auth: AuthGateway | null` oraz `locals.user: Principal | null`; trasy używają `locals.auth` zamiast własnego `createClient`.

### 4.4 Kontrakt `App.Locals` po zmianie

```ts
// src/env.d.ts
interface Locals {
  user: import("@/lib/auth/principal").Principal | null; // było: typ biblioteki (env.d.ts:3)
  auth: import("@/lib/auth/auth-gateway").AuthGateway | null; // nowe
  profile: Profile | null;
  profileError: boolean;
  locale: Locale;
}
```

---

## 5. Dowód izolacji, before/after, rozstrzygnięcia z dokumentacji

### 5.1 Wymiana/rozszerzenie dostawcy dotyka tylko adaptera

Scenariusz: dodać logowanie przez zewnętrznego dostawcę (OAuth/SSO) zgodnie z `prd.md:154`.

| Warstwa                                                 | Zmiana                                                                                                | Dotknięte?                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/lib/auth/supabase-auth-gateway.ts`                 | nowa metoda (wywołanie `signInWithOAuth` zwraca adres autoryzacji; potwierdzone w dokumentacji, §5.3) | **tak**                                                                         |
| `src/lib/auth/auth-gateway.ts`                          | jedna sygnatura w porcie                                                                              | tak (kontrakt)                                                                  |
| nowa trasa `src/pages/auth/<provider>.ts`               | 10 linii: wywołanie portu + redirect                                                                  | nowy plik                                                                       |
| `src/pages/auth/signin.astro`                           | przycisk                                                                                              | tak (UI, bez wiedzy o bibliotece)                                               |
| Serwisy, tabele, RLS, `Principal`, `Topbar`, middleware | brak                                                                                                  | **nie**                                                                         |
| Zmiana _samego_ serwisu Auth na inny (poza Supabase)    | dodatkowo SQL: `auth.uid()` w 8 migracjach i triggery na `auth.users`                                 | **poza zasięgiem ACL** — świadomie nie obiecuję; ten koszt jest widoczny w §3.2 |

### 5.2 Before / after

| Miejsce                                                                                        | Before                                           | After                                                                                                                                           |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `env.d.ts:3`                                                                                   | typ `User` biblioteki                            | `Principal`                                                                                                                                     |
| `middleware.ts:21-29,57`                                                                       | `supabase.auth.getUser()`, `user.id`             | `locals.auth.currentPrincipal()`, `principal.id`                                                                                                |
| `Topbar.astro:19,84`                                                                           | `user.email` z obiektu biblioteki                | `principal.email` (wartość domenowa)                                                                                                            |
| `Welcome.astro:22`, `set-password.astro:14`, `api/locale.ts:31`, `api/auth/set-password.ts:27` | obiekt biblioteki                                | `Principal`                                                                                                                                     |
| `signin.ts:19,23-24,36`                                                                        | wywołanie SDK + inline kody + `data.user.id`     | `auth.signInWithPassword` → `AuthResult<Principal, SignInFailure>`                                                                              |
| `api/auth/set-password.ts:21,29`                                                               | `updateUser` + drugie `signInWithPassword`       | `auth.changePassword` + `auth.signInWithPassword` (jedna implementacja logowania)                                                               |
| `signup.ts:14,18`, `auth-errors.ts:19-30`                                                      | `signUp` + słownik kodów Supabase                | `auth.register` → `RegisterFailure`; `auth-errors.ts` zostaje katalogiem kod→tekst bez kodów biblioteki                                         |
| `confirm.ts:30-36`                                                                             | reguła „zamknij sesję” w handlerze + `verifyOtp` | `auth.acceptInvite(tokenHash)` — reguła w adapterze                                                                                             |
| `set-password.ts:67-80`                                                                        | ręczny odczyt `amr`                              | `auth.sessionOrigin()` + `sessionOriginFromMethods` (czysta funkcja)                                                                            |
| `set-password.ts:49-62`, rejestracja                                                           | dwa mechanizmy walidacji haseł                   | `PasswordPolicy`/`checkPassword` użyte w obu trasach (tło: błąd `weak_password` z serwera zostaje jako zabezpieczenie, mapowany na ten sam kod) |
| `error-log.ts:165`                                                                             | `{ user: { id: string } \| null }`               | `{ user: Principal \| null }` (bez zmiany zachowania)                                                                                           |
| `createClient(` w trasach auth                                                                 | osobny klient na trasę                           | `locals.auth` z middleware (trasy danych bez zmian — L2 poza zakresem)                                                                          |

Warstwa UI dostaje `Principal` (id, e-mail), nigdy obiekt biblioteki: żaden `.astro` ani `.tsx` nie importuje `@supabase/*` ani nie czyta pól `User` poza `id`/`email`.

### 5.3 Pytania zależne od kontraktu biblioteki — rozstrzygnięte (Context7, `/supabase/supabase-js`, `/websites/supabase`)

| Pytanie                                                    | Co mówi dokumentacja                                                                                                                                                                                  | Rozstrzygnięcie i miejsce zakodowania                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jaki kształt ma `amr` w `getClaims()`?                     | `JwtPayload.amr?: AMREntry[] \| string[]` (RFC-8176 lub obiekty `{method, timestamp}`); wynik `getClaims` ma **trzy** warianty: `{data, error:null}`, `{data:null, error}`, `{data:null, error:null}` | Obecny kod obsługuje oba kształty (`set-password.ts:77`) i trzeci wariant (`if (error \|\| !data)`, `:76`). **Kodować w adapterze** (`sessionOrigin`) + test na obu kształtach i trzecim wariancie. Brak zmiany zachowania                                                                                                                                                        |
| Czy `getClaims` weryfikuje po stronie serwera Auth?        | Weryfikuje podpis lokalnie (JWKS, klucze asymetryczne), a przy algorytmie symetrycznym (`HS*`) lub braku WebCrypto **cofa się do `getUser()`**                                                        | Stąd `currentPrincipal` zostaje przy `getUser` (jak `middleware.ts:21`; wykrywa unieważnioną sesję), a `getClaims` służy tylko do `sessionOrigin`. Decyzja o ewentualnej zamianie na `getClaims` (koszt CPU na Workers — `infrastructure.md:60`; kompromis: `jwt_expiry = 3600`, `config.toml:158`) należy do adaptera i **nie** jest częścią tego refaktoru                      |
| Czy `verifyOtp` przyjmuje `type: "invite"` i zwraca sesję? | `EmailOtpType` zawiera `'invite'`, ale typ kończy się `(string & {})` — kompilator nie wyłapie literówki; po sukcesie sesja jest zapisana i zwracany `{user, session}`                                | **Adapter zawęża** do literału `"invite"` (jak `confirm.ts:11` `z.enum(["invite"])`) — port przyjmuje tylko `tokenHash`                                                                                                                                                                                                                                                           |
| Co zwraca `signUp` dla istniejącego konta?                 | Gdy włączone **zarówno** potwierdzanie e-mail, jak i telefonu (nawet z wyłączonym dostawcą SMS) — zwracany jest „obfuscated/fake user”; gdy **któreś** wyłączone — błąd `User already registered`     | Zachowanie zależy od ustawień projektu, a lokalnie `enable_confirmations = false` (`config.toml:209`). Port dokumentuje, że `already_registered` **może się nie pojawić**; testy kontraktu nie mogą go zakładać na produkcji. Wybór między jawnym a neutralnym komunikatem to decyzja produktowa (Q1), wpisana jako **jedna** stała polityki w use-case rejestracji, nie w trasie |
| Czy OAuth wymaga zmiany poza adapterem?                    | `signInWithOAuth({provider, options:{redirectTo,scopes,queryParams,skipBrowserRedirect}})` zwraca `{provider, url, flowId}` (w przeglądarce przekierowuje sam)                                        | Po stronie serwera port zwraca adres; trasa wykonuje redirect. Nazwa dostawcy dla Entra ID: **niezweryfikowana** w tej sesji — sprawdzić przy implementacji                                                                                                                                                                                                                       |

Niezweryfikowane: że maksymalna długość hasła 72 wynika z bcrypt (komentarz `set-password.ts:49`) — nie znalazłem tego w pobranej dokumentacji; reguła zostaje przeniesiona 1:1.

### 5.4 Zasada refaktoru

Brak zmian zachowania (HTTP, przekierowania, komunikaty, cookies). Jedyne dodatki: logowanie przyczyny w trzech połkniętych miejscach z §3.4 (w adapterze, przez istniejące `logError`, na poziomie `warn`/`error` wg `error-log.ts`) i mapowanie `RegisterFailure`/`SignInFailure` zamiast kodów biblioteki.

---

## 6. Weryfikacja i plan

### 6.1 Kryteria sukcesu (sprawdzalne)

1. `grep -rnE "\.auth\.(getUser|getClaims|signIn|signUp|signOut|updateUser|verifyOtp)|isAuthError|supabase-js\").User" src` → trafienia **wyłącznie** w `src/lib/auth/supabase-auth-gateway.ts` (i `src/lib/error-log.ts:6,127` jako dopuszczony normalizator błędów do logów — dopisany na listę wyjątków testu).
2. `grep -rn "@supabase/supabase-js" src` → tylko `src/lib/auth/`, `src/lib/error-log.ts` oraz dziewięć plików L2 z listy w §1 (świadomy, nazwany wyjątek; ich usunięcie to osobna zmiana).
3. `grep -rn "locals\.user\.\|Astro\.locals\.user\." src` → odczyty wyłącznie `id`/`email`; `App.Locals.user` nie wskazuje na typ z `node_modules`.
4. Nowy test `src/lib/__tests__/auth-boundary.test.ts` (wzorzec: `route-classification.test.ts`, który czyta pliki z `src/pages`) wykonuje 1–3 jako asercje; dodatkowo reguła ESLint `no-restricted-imports` dla `@supabase/supabase-js` poza `src/lib/auth/**`, `src/lib/error-log.ts` i listą L2.
5. `npm test`, `npx astro check`, `npm run lint`, `npm run smoke` (przepływ auth: `CLAUDE.md`, sekcja Commands) i `npm run test:e2e` zielone; zachowanie bez zmian.

### 6.2 Pliki: dziś znają zależność → po refaktorze

| Dziś znają Supabase Auth                                                                                                                                                                                                                  | Po refaktorze                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `env.d.ts`, `middleware.ts`, `set-password.ts`, `auth-errors.ts`, `error-log.ts`, `api/auth/{signin,signup,signout,set-password}.ts`, `auth/confirm.ts`, `api/locale.ts`, `Topbar.astro`, `Welcome.astro`, `auth/set-password.astro` (15) | tylko `src/lib/auth/supabase-auth-gateway.ts`; `error-log.ts` jako nazwany wyjątek logowania; reszta zna `Principal`/`AuthGateway` |
| `supabase/functions/invite-employee/index.ts:75` (Deno)                                                                                                                                                                                   | bez zmian — osobna runtime, własny punkt styku; zapisane jako znane pozostałe miejsce                                              |
| 8 migracji z `auth.uid()`                                                                                                                                                                                                                 | bez zmian — kontrakt „`profiles.id = auth.uid()`” zostaje jawnie opisany w rejestrze                                               |

### 6.3 Fazy (zgodne z konwencją: Vitest `src/**/*.test.ts`, test-first, bez zmian schematu)

| Faza | Zakres                                                                                                                                                                                                                                                                                                                                                          | Test-first                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 0    | Decyzje Q1–Q2                                                                                                                                                                                                                                                                                                                                                   | —                                                                                       |
| 1    | Testy (czerwone): `principal`, `session-origin` (oba kształty `amr`, `token_refresh` pominięty, pusta lista), `password-policy` (granice 5/6/72/73), `mapSignInError`/`mapRegisterError` (każdy dotychczasowy kod z `signin.ts:23-24` i `auth-errors.ts:19-30`), adapter z fałszywym klientem (trzy warianty `getClaims`, błąd `getUser`, `verifyOtp` z błędem) | **tak**                                                                                 |
| 2    | Implementacja `src/lib/auth/*` do zielonego; testy mutacyjne zakresu (`npm run test:mutation -- --mutate src/lib/auth/**`)                                                                                                                                                                                                                                      | po fazie 1                                                                              |
| 3    | Middleware: jeden klient, `locals.auth`, `locals.user: Principal`; aktualizacja `env.d.ts`                                                                                                                                                                                                                                                                      | smoke                                                                                   |
| 4    | Migracja tras: `signin` → `signup` → `signout` → `set-password` (API) → `confirm` → `locale`; po każdej `npm test` + `npm run smoke`                                                                                                                                                                                                                            | tak (istniejące `set-password.test.ts`, `auth-errors.test.ts` dostosować, nie osłabiać) |
| 5    | UI: `Topbar`, `Welcome`, `set-password.astro`; `error-log.ts:165`                                                                                                                                                                                                                                                                                               | `lint:ui`, kitchen-sink                                                                 |
| 6    | Strażnik: `auth-boundary.test.ts` + reguła ESLint; usunięcie martwych eksportów (`auth-errors.ts`)                                                                                                                                                                                                                                                              | tak                                                                                     |
| 7    | Rejestr `docs/reference/contract-surfaces.md` i sekcja „Auth flow” w `CLAUDE.md`                                                                                                                                                                                                                                                                                | —                                                                                       |

### 6.4 Nowe nazwy „load-bearing” do rejestru

`Principal`, `AuthGateway`, `AuthResult`, `SessionOrigin`, `sessionOriginFromMethods`, `PasswordPolicy`, `checkPassword`, `SignInFailure`, `RegisterFailure`, `InviteFailure`, `supabaseAuthGateway`, `createAuthGateway`, `locals.auth`, zmiana typu `locals.user` (`Principal`), plik-granica `src/lib/auth/supabase-auth-gateway.ts`; zapis kontraktowy: **„poza `src/lib/auth/` nikt nie wywołuje `supabase.auth.*`”**.

## 7. Pytania do właścicieli

| #   | Pytanie                                                                                                                                                                   | Kto zna odpowiedź        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Q1  | Czy przy rejestracji istniejącego e-maila pokazywać jawny błąd (dziś) czy neutralny komunikat „sprawdź skrzynkę” (odporny na ustawienia projektu i wyliczanie kont)?      | Właściciel PRD           |
| Q2  | Czy OAuth/SSO (Entra ID) wchodzi przed terminem 2026-11-04 (`prd.md:13`), czy tylko ma być „gotowe na”? Decyduje, czy faza 3–4 jest warunkiem dodania przycisku logowania | Właściciel PRD / sponsor |
| Q3  | Czy L4 (transport powiadomień, kanał Teams — `prd.md:168`) ma dostać analogiczny plan jako następny?                                                                      | Właściciel PRD           |
