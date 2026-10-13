// Smoke test: proves the built app, the Cloudflare adapter and the Supabase auth flow still work together,
// and is the HTTP gate for route gating (role × route, path normalisation, `next`) and for employee IDOR.
// Zero dependencies on purpose. Run against a live server: BASE_URL=http://localhost:4321 node scripts/smoke.mjs
//
// The role and IDOR steps use the accounts and the "Approved Demo Project" from supabase/seed.sql
// (local Supabase only). Local auth allows 30 sign-ins per window (supabase/config.toml), so each
// actor signs in once and keeps its own cookie jar.

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const email = `smoke-${Date.now()}@example.com`;
const password = "Smoke-Test-Passw0rd!";

// Seeded accounts and fixture ids (supabase/seed.sql).
const SEED_PASSWORD = "Meritly-Local-Passw0rd!";
const APPROVED_PROJECT = "00000000-0000-4000-8000-000000000012";
const APPROVED_MILESTONE = "00000000-0000-4000-8000-000000000023";
const DRAFT_MILESTONE = "00000000-0000-4000-8000-000000000024";
const EMPLOYEE_1 = "00000000-0000-4000-8000-000000000031";
const EMPLOYEE_2 = "00000000-0000-4000-8000-000000000033";
// A well-formed id with no employee behind it.
const MISSING_EMPLOYEE = "00000000-0000-4000-8000-000000000999";
// Expected bonuses derived by hand in seed.sql: 1000.00 split 0.60 / 0.40 at the maximum multiplier.
// Written as /my-bonuses formats them (pl-PL currency), after whitespace normalisation.
const OWN_BONUS = "400,00 zł";
const OTHER_BONUS = "600,00 zł";
// Draft Milestone (…0024): employee2 alone at 0.30, all KPI scores 100, so the Draft bonus is the
// whole 1000.00 target pool. The Supervisor's milestone page shows it; the employee detail page must not.
const DRAFT_BONUS = "1000,00 zł";
// Text only the /admin page renders. Pages render in Polish (the default with no `lang` cookie; the
// seeded actors pin `lang=pl`), so every UI needle below is the exact pl dictionary value
// (src/lib/i18n/messages/pl.ts).
const ADMIN_ONLY_TEXT = "Ta strona jest dostępna tylko dla administratorów.";
// The landing pitch in English (en dictionary), shown only with `lang=en`.
const EN_LANDING_TEXT = "Fair split of milestone bonus pools";

/** One cookie jar per actor, so sessions never leak between roles. */
const jars = {
  smoke: new Map(),
  anon: new Map(),
  // An anonymous visitor who already chose English.
  english: new Map([["lang", "en"]]),
  // A fresh anonymous visitor for each language-switch POST (no cookie carried over).
  switchToEn: new Map(),
  switchOffsite: new Map(),
  switchInvalid: new Map(),
  // Seeded actors pin Polish: sign-in saves the cookie's language to the profile (latest choice
  // wins), so a language left on a seeded profile by a manual check cannot switch the needles.
  employee: new Map([["lang", "pl"]]),
  employee2: new Map([["lang", "pl"]]),
  supervisor: new Map([["lang", "pl"]]),
  admin: new Map([["lang", "pl"]]),
};

function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function storeCookies(jar, response) {
  for (const raw of response.headers.getSetCookie()) {
    const [pair, ...attrs] = raw.split(";");
    const [name, ...rest] = pair.split("=");
    const expired = attrs.some((a) => /max-age=0/i.test(a.trim()));
    if (expired) jar.delete(name.trim());
    else jar.set(name.trim(), rest.join("="));
  }
}

/** Visible text of an HTML page: tags dropped, non-breaking spaces and whitespace runs collapsed to one space. */
function normaliseText(html) {
  return (
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
      .replace(/&amp;/g, "&")
      // \s also matches U+00A0 and U+202F, which Intl puts inside "400,00 zł".
      .replace(/\s+/g, " ")
      .trim()
  );
}

async function request(path, { as = "smoke", method = "GET", form } = {}) {
  const jar = jars[as];
  const response = await fetch(BASE_URL + path, {
    method,
    redirect: "manual",
    headers: {
      Cookie: cookieHeader(jar),
      Origin: BASE_URL,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const setCookies = response.headers.getSetCookie();
  storeCookies(jar, response);
  const html = response.status === 200 ? await response.text() : "";
  return {
    status: response.status,
    location: response.headers.get("location") ?? "",
    text: normaliseText(html),
    html,
    setCookies,
  };
}

const signIn = (as, account, next) =>
  request("/api/auth/signin", {
    as,
    method: "POST",
    form: { email: account, password: SEED_PASSWORD, ...(next === undefined ? {} : { next }) },
  });

const steps = [
  // Locale: Polish without a cookie, English with `lang=en`; the switch endpoint sets the cookie,
  // keeps only same-origin return targets and ignores an unsupported locale.
  ["home is Polish without a cookie", () => request("/", { as: "anon" }), { status: 200, htmlIncludes: ['lang="pl"'] }],
  [
    "home is English with lang=en",
    () => request("/", { as: "english" }),
    { status: 200, htmlIncludes: ['lang="en"'], bodyIncludes: [EN_LANDING_TEXT] },
  ],
  [
    "language switch sets lang=en and returns to next",
    () => request("/api/locale", { as: "switchToEn", method: "POST", form: { locale: "en", next: "/auth/signin" } }),
    { status: 302, exact: "/auth/signin", setsCookie: "lang=en" },
  ],
  [
    "language switch drops an off-site next",
    () =>
      request("/api/locale", { as: "switchOffsite", method: "POST", form: { locale: "en", next: "//evil.example" } }),
    { status: 302, exact: "/" },
  ],
  [
    "language switch ignores an unsupported locale",
    () => request("/api/locale", { as: "switchInvalid", method: "POST", form: { locale: "de", next: "/" } }),
    { status: 302, exact: "/", setsNoCookie: "lang" },
  ],

  // Auth flow with a fresh sign-up (default jar).
  ["home renders", () => request("/"), { status: 200 }],
  ["dashboard redirects anonymous user", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
  [
    "signup creates account",
    () => request("/api/auth/signup", { method: "POST", form: { email, password } }),
    { status: 302, location: "/auth/confirm-email" },
  ],
  [
    "signin rejects wrong password",
    () => request("/api/auth/signin", { method: "POST", form: { email, password: "wrong" } }),
    { status: 302, location: "/auth/signin?error=" },
  ],
  [
    "signin accepts correct password",
    () => request("/api/auth/signin", { method: "POST", form: { email, password } }),
    { status: 302, location: "/" },
  ],
  ["dashboard renders for signed-in user", () => request("/dashboard"), { status: 200 }],
  ["signout clears session", () => request("/api/auth/signout", { method: "POST" }), { status: 302, location: "/" }],
  ["dashboard redirects after signout", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],

  // Anonymous: pages keep their return target, API routes get none.
  [
    "anon page redirect keeps next",
    () => request("/projects?tab=x", { as: "anon" }),
    { status: 302, exact: "/auth/signin?next=%2Fprojects%3Ftab%3Dx" },
  ],
  [
    "anon API redirect has no next",
    () => request("/api/projects", { as: "anon" }),
    { status: 302, exact: "/auth/signin" },
  ],

  // Sign-in `next`: an off-site target is dropped, a same-origin path is honoured. One sign-in per actor.
  [
    "employee signin drops next=//evil.com",
    () => signIn("employee", "employee@meritly.local", "//evil.com"),
    { status: 302, exact: "/" },
  ],
  [
    "supervisor signin honours next=/projects",
    () => signIn("supervisor", "supervisor@meritly.local", "/projects"),
    { status: 302, exact: "/projects" },
  ],
  ["admin signin", () => signIn("admin", "admin@meritly.local"), { status: 302, exact: "/" }],
  ["employee2 signin", () => signIn("employee2", "employee2@meritly.local"), { status: 302, exact: "/" }],

  // Role × route.
  ["employee 403 on /projects", () => request("/projects", { as: "employee" }), { status: 403 }],
  ["employee 403 on /employees", () => request("/employees", { as: "employee" }), { status: 403 }],
  ["employee 403 on /admin", () => request("/admin", { as: "employee" }), { status: 403 }],
  [
    "employee 403 on POST /api/admin/job-roles",
    () =>
      request("/api/admin/job-roles", { as: "employee", method: "POST", form: { name: "Smoke Role", weight: "1" } }),
    { status: 403 },
  ],
  // Positive control for the employee2 excludes below: OTHER_BONUS renders in exactly this form.
  [
    "employee 200 on /my-bonuses",
    () => request("/my-bonuses", { as: "employee" }),
    { status: 200, bodyIncludes: [OTHER_BONUS, "Approved Milestone"] },
  ],
  ["supervisor 200 on /projects", () => request("/projects", { as: "supervisor" }), { status: 200 }],
  // Positive control for the employee2 excludes below: the Draft milestone's name renders.
  [
    "supervisor sees the Draft milestone on its project",
    () => request(`/projects/${APPROVED_PROJECT}`, { as: "supervisor" }),
    { status: 200, bodyIncludes: ["Draft Milestone"] },
  ],
  ["supervisor 403 on /admin", () => request("/admin", { as: "supervisor" }), { status: 403 }],
  ["supervisor 403 on /my-bonuses", () => request("/my-bonuses", { as: "supervisor" }), { status: 403 }],
  ["admin 200 on /admin", () => request("/admin", { as: "admin" }), { status: 200, bodyIncludes: [ADMIN_ONLY_TEXT] }],
  ["admin 403 on /my-bonuses", () => request("/my-bonuses", { as: "admin" }), { status: 403 }],

  // Path normalisation: encoded and doubled-slash variants must not slip past the gate.
  ["employee 403 on /%61dmin", () => request("/%61dmin", { as: "employee" }), { status: 403 }],
  // Pinned: the Workers runtime parses "//admin" as a protocol-relative URL (host "admin", path "/"),
  // so the request never reaches /admin and the public home page answers. The admin-only text must
  // not appear (the admin cell above proves the page carries it).
  [
    "employee never gets the admin page on //admin",
    () => request("//admin", { as: "employee" }),
    { status: 200, bodyExcludes: [ADMIN_ONLY_TEXT] },
  ],
  // Pinned: Astro routes are case-sensitive, so /ADMIN matches no page (and no gate).
  ["employee 404 on /ADMIN", () => request("/ADMIN", { as: "employee" }), { status: 404 }],

  // IDOR as employee2: no project pages or actions, and /my-bonuses shows only own Approved lines.
  [
    "employee2 403 on another's project",
    () => request(`/projects/${APPROVED_PROJECT}`, { as: "employee2" }),
    { status: 403 },
  ],
  [
    "employee2 403 on another's milestone",
    () => request(`/projects/${APPROVED_PROJECT}/milestones/${APPROVED_MILESTONE}`, { as: "employee2" }),
    { status: 403 },
  ],
  [
    "employee2 403 on POST notify",
    () =>
      request(`/api/projects/${APPROVED_PROJECT}/milestones/${APPROVED_MILESTONE}/notify`, {
        as: "employee2",
        method: "POST",
        form: {},
      }),
    { status: 403 },
  ],
  [
    "employee2 /my-bonuses shows only own Approved line",
    () => request("/my-bonuses", { as: "employee2" }),
    {
      status: 200,
      bodyIncludes: [OWN_BONUS, "Approved Demo Project", "Approved Milestone"],
      bodyExcludes: [OTHER_BONUS, "Draft Milestone"],
    },
  ],
  [
    "employee2 /my-bonuses ignores injected ids",
    () => request(`/my-bonuses?employee=${EMPLOYEE_1}&milestone=${DRAFT_MILESTONE}`, { as: "employee2" }),
    {
      status: 200,
      bodyIncludes: [OWN_BONUS, "Approved Demo Project", "Approved Milestone"],
      bodyExcludes: [OTHER_BONUS, "Draft Milestone"],
    },
  ],

  // Employee detail (S-06): Supervisor/Admin only, scoped by RLS; employees never reach an ID route.
  ["employee 403 on /employees/<id>", () => request(`/employees/${EMPLOYEE_1}`, { as: "employee" }), { status: 403 }],
  [
    "employee2 403 on another's /employees/<id>",
    () => request(`/employees/${EMPLOYEE_1}`, { as: "employee2" }),
    { status: 403 },
  ],
  // Positive control for the DRAFT_BONUS exclude below: the Draft figure renders in exactly this form.
  [
    "supervisor sees the Draft bonus on the Draft milestone, linked to the employee",
    () => request(`/projects/${APPROVED_PROJECT}/milestones/${DRAFT_MILESTONE}`, { as: "supervisor" }),
    { status: 200, bodyIncludes: [DRAFT_BONUS], htmlIncludes: [`href="/employees/${EMPLOYEE_2}"`] },
  ],
  [
    "supervisor's Approved milestone links each employee to their detail",
    () => request(`/projects/${APPROVED_PROJECT}/milestones/${APPROVED_MILESTONE}`, { as: "supervisor" }),
    { status: 200, htmlIncludes: [`href="/employees/${EMPLOYEE_1}"`, `href="/employees/${EMPLOYEE_2}"`] },
  ],
  [
    "supervisor sees employee2's history and open assignment, never a Draft figure",
    () => request(`/employees/${EMPLOYEE_2}`, { as: "supervisor" }),
    {
      status: 200,
      bodyIncludes: [
        "Local Employee 2",
        "Zatwierdzone premie w Twoich projektach",
        "Approved Demo Project",
        "Approved Milestone",
        OWN_BONUS,
        "Bieżące przypisania",
        "Draft Milestone",
        "30%",
      ],
      bodyExcludes: [DRAFT_BONUS],
    },
  ],
  [
    "admin sees employee2's full history",
    () => request(`/employees/${EMPLOYEE_2}`, { as: "admin" }),
    { status: 200, bodyIncludes: ["Wszystkie zatwierdzone premie", "Approved Milestone", OWN_BONUS] },
  ],
  [
    "supervisor gets not found for a missing employee",
    () => request(`/employees/${MISSING_EMPLOYEE}`, { as: "supervisor" }),
    { status: 200, bodyIncludes: ["Nie znaleziono pracownika."], bodyExcludes: [OWN_BONUS] },
  ],
  [
    "supervisor gets not found for a malformed id",
    () => request("/employees/not-a-uuid", { as: "supervisor" }),
    { status: 200, bodyIncludes: ["Nie znaleziono pracownika."] },
  ],
];

let failed = 0;
for (const [name, run, expected] of steps) {
  const actual = await run();
  const problems = [];
  if (actual.status !== expected.status) problems.push(`expected status ${expected.status}`);
  if (expected.location !== undefined && !actual.location.startsWith(expected.location))
    problems.push(`expected Location starting with "${expected.location}"`);
  if (expected.exact !== undefined && actual.location !== expected.exact)
    problems.push(`expected Location exactly "${expected.exact}"`);
  for (const needle of expected.bodyIncludes ?? [])
    if (!actual.text.includes(needle)) problems.push(`body is missing "${needle}"`);
  for (const needle of expected.bodyExcludes ?? [])
    if (actual.text.includes(needle)) problems.push(`body must not contain "${needle}"`);
  for (const needle of expected.htmlIncludes ?? [])
    if (!actual.html.includes(needle)) problems.push(`HTML is missing "${needle}"`);
  if (expected.setsCookie !== undefined && !actual.setCookies.some((raw) => raw.startsWith(`${expected.setsCookie};`)))
    problems.push(`expected Set-Cookie "${expected.setsCookie}"`);
  if (
    expected.setsNoCookie !== undefined &&
    actual.setCookies.some((raw) => raw.startsWith(`${expected.setsNoCookie}=`))
  )
    problems.push(`expected no "${expected.setsNoCookie}" Set-Cookie`);

  console.log(`${problems.length ? "FAIL" : "PASS"}  ${name}  -> ${actual.status} ${actual.location}`);
  if (problems.length) {
    failed++;
    for (const problem of problems) console.log(`      ${problem}`);
  }
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
