// risk: test-plan.md §3 Phase 4 (US-01, cross-cutting #1) — approve → the employee sees only their own result;
//       before approval no employee sees the milestone's figures
// seed: tests/e2e/seed.spec.ts
//
// Residue (accepted; same precedent as tests/integration): approval is irreversible by design (no
// un-approve, nothing is deleted), so every run leaves one uniquely named project with an approved
// milestone. `npx supabase db reset --local` clears it. The run's token is in the report annotation.
import { test, expect, type APIResponse, type BrowserContext, type Page } from "@playwright/test";
import { waitForHydration } from "./support/hydration";

// Seeded employee records owned by supervisor@meritly.local (supabase/seed.sql).
const LOCAL_EMPLOYEE_ID = "00000000-0000-4000-8000-000000000031"; // linked to E2E_EMPLOYEE_USERNAME
const LOCAL_EMPLOYEE_2_ID = "00000000-0000-4000-8000-000000000033"; // linked to E2E_EMPLOYEE2_USERNAME
// Seeded project with an Approved milestone for both employees (supabase/seed.sql).
const SEEDED_APPROVED_PROJECT = "Approved Demo Project";

// Oracle, derived by hand from the PRD formula (not from the code): all four KPI scores at 100 give
// M = multiplier max, so the payout pool is the whole 2100.00 target pool. Same job role and rating,
// so the pool splits by time share alone: 0.60 → 1260.00 own for employee 1, 0.40 → 840.00 own for
// employee 2. Each employee sees their own figure in their row and never the other's anywhere.
// `^…$` pins the own cell; `(?<!\d\s?)` keeps the absence check from matching a larger
// amount ending in the same digits, e.g. "1840,00 zł" or pl-PL's grouped "30 840,00 zł".
// Why 2100 and not a rounder target: /my-bonuses also shows a total. Employee 2's total is the seeded
// 400.00 plus 840.00 per run (residue), employee 1's is 600.00 plus 1260.00 per run; neither total can
// ever equal the other employee's bonus, so the page-wide absence check stays sound. (With 2000 the
// fresh-database total 400 + 800 = 1200 would equal employee 1's bonus.)
const EMPLOYEE_1_BONUS_CELL = /^1260,00\s*zł$/;
const EMPLOYEE_2_BONUS_CELL = /^840,00\s*zł$/;
const EMPLOYEE_1_BONUS_ANYWHERE = /(?<!\d\s?)1260,00\s*zł/;
const EMPLOYEE_2_BONUS_ANYWHERE = /(?<!\d\s?)840,00\s*zł/;

interface Credentials {
  email: string;
  password: string;
}

/** Reads one account's credentials from the environment, failing loudly when either is missing. */
function requireCredentials(userVar: string, passwordVar: string): Credentials {
  const email = process.env[userVar];
  const password = process.env[passwordVar];
  if (!email || !password) {
    throw new Error(`Set ${userVar} and ${passwordVar} in .dev.vars (see .env.example)`);
  }
  return { email, password };
}

/** Posts an app form the way the browser does (same-origin), without following the redirect. */
async function postForm(page: Page, baseURL: string, path: string, form: Record<string, string>) {
  return page.request.post(path, { form, headers: { Origin: new URL(baseURL).origin }, maxRedirects: 0 });
}

/** Signs an isolated, cookie-less context in through the API (not the UI) and opens a page in it. */
async function signIn(context: BrowserContext, baseURL: string, { email, password }: Credentials) {
  // The assertions use the Polish dictionary text. Pin the language as auth.setup.ts does: sign-in
  // saves the cookie's choice to the profile, so a language left on a seeded profile cannot leak in.
  await context.addCookies([{ name: "lang", value: "pl", url: baseURL }]);
  const res = await context.request.post("/api/auth/signin", {
    form: { email, password },
    headers: { Origin: new URL(baseURL).origin },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(302);
  expect(res.headers().location).toBe("/");
  return context.newPage();
}

/** The app's form endpoints answer 302 with `saved=<what>` on success and `error=<code>` otherwise. */
function expectSaved(res: APIResponse, saved: string): string {
  expect(res.status()).toBe(302);
  const location = res.headers().location;
  expect(location).toContain(`saved=${saved}`);
  return location;
}

test.describe("US-01: supervisor approves a milestone and the employee sees their bonus", () => {
  test("approved bonus is visible only to its own employee, and only after approval", async ({
    page,
    browser,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("baseURL is not configured");
    const employee1 = requireCredentials("E2E_EMPLOYEE_USERNAME", "E2E_EMPLOYEE_PASSWORD");
    const employee2 = requireCredentials("E2E_EMPLOYEE2_USERNAME", "E2E_EMPLOYEE2_PASSWORD");
    const token = `${Date.now()}-${test.info().workerIndex}`;
    const projectName = `US-01 ${token}`;
    const milestoneName = `US-01 milestone ${token}`;
    test.info().annotations.push({ type: "test-data", description: projectName });

    // Setup (as the supervisor, saved session): a project with one scored, staffed milestone.
    const projectLocation = expectSaved(
      await postForm(page, baseURL, "/api/projects", {
        name: projectName,
        start_date: "2026-01-01",
        end_date: "2026-12-31",
        status: "active",
        total_budget: "10000",
        notes: "",
      }),
      "project",
    );
    const projectPath = new URL(projectLocation, baseURL).pathname;
    expectSaved(
      await postForm(page, baseURL, `/api${projectPath}/milestones`, {
        name: milestoneName,
        start_date: "2026-01-01",
        end_date: "2026-03-31",
        status: "active",
        target_pool: "2100",
        notes: "",
      }),
      "milestones",
    );
    await page.goto(projectPath);
    await page.getByRole("link", { name: milestoneName, exact: true }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}\/milestones\/[0-9a-f-]{36}$/);
    const milestonePath = new URL(page.url()).pathname;
    for (const [employeeId, timeShare] of [
      [LOCAL_EMPLOYEE_ID, "0.60"],
      [LOCAL_EMPLOYEE_2_ID, "0.40"],
    ]) {
      expectSaved(
        await postForm(page, baseURL, `/api${milestonePath}/engagements`, {
          employee_id: employeeId,
          time_share: timeShare,
          rating: "3",
        }),
        "created",
      );
    }
    expectSaved(
      await postForm(page, baseURL, `/api${milestonePath}/kpi`, {
        kpi_schedule: "100",
        kpi_budget: "100",
        kpi_quality: "100",
        kpi_risk: "100",
      }),
      "kpi",
    );

    // Each employee gets their own isolated session, signed in through the API (not the UI).
    const employee1Context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try {
      const employee2Context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
      try {
        const employee1Page = await signIn(employee1Context, baseURL, employee1);
        const employee2Page = await signIn(employee2Context, baseURL, employee2);

        // Draft: neither employee sees the milestone's results before approval. /my-bonuses groups
        // results per project as a region named after it; the seeded approved project's group being
        // visible proves the groups render, so the absence below cannot pass for the wrong reason.
        for (const employeePage of [employee1Page, employee2Page]) {
          await employeePage.goto("/my-bonuses");
          await expect(employeePage.getByRole("heading", { name: "Zatwierdzone premie" })).toBeVisible();
          await expect(employeePage.getByRole("region", { name: SEEDED_APPROVED_PROJECT, exact: true })).toBeVisible();
          await expect(employeePage.getByRole("region", { name: projectName, exact: true })).toHaveCount(0);
        }

        // The supervisor reviews the draft figures and approves the milestone.
        await page.goto(milestonePath);
        await waitForHydration(page);
        await page.getByRole("checkbox", { name: /Rozumiem, że to ostateczne/ }).check();
        await page.getByRole("button", { name: "Zatwierdź kamień milowy" }).click();
        await expect(page.getByRole("status").filter({ hasText: "Kamień milowy zatwierdzony." })).toBeVisible();

        // Approved: each employee sees exactly their own line, with their own bonus...
        const views = [
          { employeePage: employee1Page, ownBonus: EMPLOYEE_1_BONUS_CELL, otherBonus: EMPLOYEE_2_BONUS_ANYWHERE },
          { employeePage: employee2Page, ownBonus: EMPLOYEE_2_BONUS_CELL, otherBonus: EMPLOYEE_1_BONUS_ANYWHERE },
        ];
        for (const { employeePage, ownBonus, otherBonus } of views) {
          await employeePage.reload();
          const projectGroup = employeePage.getByRole("region", { name: projectName, exact: true });
          await expect(projectGroup).toBeVisible();
          // The milestone's row, not the group's subtotal (equal to the bonus for a one-milestone project).
          const ownRows = projectGroup.getByRole("row").filter({ hasText: milestoneName });
          await expect(ownRows).toHaveCount(1);
          await expect(ownRows.getByRole("cell", { name: milestoneName, exact: true })).toBeVisible();
          await expect(ownRows.getByRole("cell", { name: ownBonus })).toBeVisible();
          // ...and never the other employee's figure for the same milestone.
          await expect(employeePage.getByText(otherBonus)).toHaveCount(0);
        }
      } finally {
        await employee2Context.close();
      }
    } finally {
      await employee1Context.close();
    }
    // No cleanup: approval is irreversible by design (see the residue note at the top).
  });
});
