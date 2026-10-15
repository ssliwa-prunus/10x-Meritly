// Seed test: the exemplar every generated E2E test copies.
// Protects test-plan.md risk #6 (slice auth-gate-roundtrip): a protected page must send a
// signed-out user to sign-in and, after sign-in, back to the page they asked for, never elsewhere.
import { test, expect } from "@playwright/test";

// The risk is the signed-out path, so this test opts out of the saved session.
test.use({ storageState: { cookies: [], origins: [] } });

test("signed-out visit to a protected page returns there after sign-in", async ({ page, baseURL }) => {
  const username = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD;
  if (!username || !password) {
    throw new Error("Set E2E_USERNAME and E2E_PASSWORD (see context/foundation/test-stack.md, ## E2E)");
  }

  // The assertions use the Polish dictionary text. Pin the language as auth.setup.ts does: without a
  // cookie, sign-in restores the shared seed user's saved language, which language-switch.spec.ts
  // briefly sets to EN while it runs in parallel.
  await page.context().addCookies([{ name: "lang", value: "pl", url: baseURL ?? "" }]);

  await page.goto("/projects");

  // The gate redirects to sign-in and carries the requested page as the return target.
  await expect(page).toHaveURL("/auth/signin?next=%2Fprojects");
  await expect(page.getByRole("heading", { name: "Zaloguj się", level: 1 })).toBeVisible();

  // SignInForm hydrates after load (client:load); retry the idempotent fill + submit until it leaves sign-in.
  await expect(async () => {
    await page.getByRole("textbox", { name: "E-mail" }).fill("");
    await page.getByRole("textbox", { name: "E-mail" }).fill(username);
    await page.getByRole("textbox", { name: "Hasło" }).fill("");
    await page.getByRole("textbox", { name: "Hasło" }).fill(password);
    await page.getByRole("button", { name: "Zaloguj się" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/signin"), { timeout: 5_000 });
  }).toPass();

  // Back on the requested page (not the "/" fallback), signed in.
  await expect(page).toHaveURL("/projects");
  await expect(page.getByRole("heading", { name: "Projekty", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Wyloguj się" })).toBeVisible();

  // No cleanup: the test creates no data. Don't sign out here: sign-out may revoke the shared
  // test user's sessions, which the saved storageState of every other spec depends on.
});
