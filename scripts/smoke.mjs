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
// Expected bonuses derived by hand in seed.sql: 1000.00 split 0.60 / 0.40 at the maximum multiplier.
// Written as /my-bonuses formats them (pl-PL currency), after whitespace normalisation.
const OWN_BONUS = "400,00 zł";
const OTHER_BONUS = "600,00 zł";
// Text only the /admin page renders.
const ADMIN_ONLY_TEXT = "This page is only for admins.";

/** One cookie jar per actor, so sessions never leak between roles. */
const jars = {
  smoke: new Map(),
  anon: new Map(),
  employee: new Map(),
  employee2: new Map(),
  supervisor: new Map(),
  admin: new Map(),
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
  storeCookies(jar, response);
  const text = response.status === 200 ? normaliseText(await response.text()) : "";
  return { status: response.status, location: response.headers.get("location") ?? "", text };
}

const signIn = (as, account, next) =>
  request("/api/auth/signin", {
    as,
    method: "POST",
    form: { email: account, password: SEED_PASSWORD, ...(next === undefined ? {} : { next }) },
  });

const steps = [
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
  ["employee 200 on /my-bonuses", () => request("/my-bonuses", { as: "employee" }), { status: 200 }],
  ["supervisor 200 on /projects", () => request("/projects", { as: "supervisor" }), { status: 200 }],
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

  console.log(`${problems.length ? "FAIL" : "PASS"}  ${name}  -> ${actual.status} ${actual.location}`);
  if (problems.length) {
    failed++;
    for (const problem of problems) console.log(`      ${problem}`);
  }
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
