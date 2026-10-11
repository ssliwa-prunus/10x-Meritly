// risk: test-plan.md §3 Phase 4 (US-01, cross-cutting #1) — approve → the employee sees only their own result;
//       before approval no employee sees the milestone's figures
// seed: tests/e2e/seed.spec.ts
//
// Residue (accepted; same precedent as tests/integration): approval is irreversible by design (no
// un-approve, nothing is deleted), so every run leaves one uniquely named project with an approved
// milestone. `npx supabase db reset --local` clears it. The run's token is in the report annotation.
import { test, expect, type APIResponse, type Page } from "@playwright/test";
import { waitForHydration } from "./support/hydration";

// Seeded employee records owned by supervisor@meritly.local (supabase/seed.sql).
const LOCAL_EMPLOYEE_ID = "00000000-0000-4000-8000-000000000031"; // linked to E2E_EMPLOYEE_USERNAME
const LOCAL_EMPLOYEE_2_ID = "00000000-0000-4000-8000-000000000033"; // the colleague

// Oracle, derived by hand from the PRD formula (not from the code): all four KPI scores at 100 give
// M = multiplier max, so the payout pool is the whole 2000.00 target pool. Same job role and rating,
// so the pool splits by time share alone: 0.60 → 1200.00 (own), 0.40 → 800.00 (colleague).
const OWN_BONUS = /^1200,00\s*zł$/;
const COLLEAGUE_BONUS = /800,00\s*zł/;

/** Posts an app form the way the browser does (same-origin), without following the redirect. */
async function postForm(page: Page, baseURL: string, path: string, form: Record<string, string>) {
  return page.request.post(path, { form, headers: { Origin: new URL(baseURL).origin }, maxRedirects: 0 });
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
    const employeeEmail = process.env.E2E_EMPLOYEE_USERNAME;
    const employeePassword = process.env.E2E_EMPLOYEE_PASSWORD;
    if (!employeeEmail || !employeePassword) {
      throw new Error("Set E2E_EMPLOYEE_USERNAME and E2E_EMPLOYEE_PASSWORD in .dev.vars (see .env.example)");
    }
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
        target_pool: "2000",
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

    // The employee gets their own session, signed in through the API (not the UI).
    const employeeContext = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try {
      const signIn = await employeeContext.request.post("/api/auth/signin", {
        form: { email: employeeEmail, password: employeePassword },
        headers: { Origin: new URL(baseURL).origin },
        maxRedirects: 0,
      });
      expect(signIn.status()).toBe(302);
      expect(signIn.headers().location).toBe("/");
      const employeePage = await employeeContext.newPage();

      // Draft: the employee does not see the milestone's results before approval.
      await employeePage.goto("/my-bonuses");
      await expect(employeePage.getByRole("heading", { name: "Approved bonuses" })).toBeVisible();
      await expect(employeePage.getByRole("row").filter({ hasText: projectName })).toHaveCount(0);

      // The supervisor reviews the draft figures and approves the milestone.
      await page.goto(milestonePath);
      await waitForHydration(page);
      await page.getByRole("checkbox", { name: /I understand this is final/ }).check();
      await page.getByRole("button", { name: "Approve milestone" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Milestone approved." })).toBeVisible();

      // Approved: the employee sees exactly their own line, with their own bonus.
      await employeePage.reload();
      const ownRows = employeePage.getByRole("row").filter({ hasText: projectName });
      await expect(ownRows).toHaveCount(1);
      await expect(ownRows.getByRole("cell", { name: milestoneName, exact: true })).toBeVisible();
      await expect(ownRows.getByRole("cell", { name: OWN_BONUS })).toBeVisible();
      // ...and never the colleague's figure for the same milestone.
      await expect(employeePage.getByText(COLLEAGUE_BONUS)).toHaveCount(0);
    } finally {
      await employeeContext.close();
    }
    // No cleanup: approval is irreversible by design (see the residue note at the top).
  });
});
