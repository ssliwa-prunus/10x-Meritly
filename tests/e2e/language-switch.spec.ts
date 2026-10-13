// risk: context/changes/language-switch-pl-en/plan.md Phase 5 — the PL | EN switch on the first page
//       changes the language, the choice survives navigation and sign-in, and the latest choice wins
//       (also after a reload)
// seed: tests/e2e/seed.spec.ts
//
// The seed user's profile keeps the last language chosen while signed in. The test ends on PL and the
// afterEach guard resets PL even when the test fails midway, so other specs see a Polish profile.
import { test, expect, type Page } from "@playwright/test";

// Dictionary text (src/lib/i18n/messages/{pl,en}.ts): landing pitch and switch labels.
const PL_PITCH = "Sprawiedliwy podział puli premiowej kamieni milowych";
const EN_PITCH = "Fair split of milestone bonus pools";

// The risk starts signed out with no language cookie, so this test opts out of the saved session.
test.use({ storageState: { cookies: [], origins: [] } });

test.afterEach(async ({ page, baseURL }) => {
  // Guard: leave the seed user's profile on PL even when the test stopped before its last step.
  // The same POST the PL button sends; Astro's origin check rejects a form POST without Origin.
  await page.request.post("/api/locale", {
    form: { locale: "pl", next: "/" },
    headers: { Origin: baseURL ?? "" },
    maxRedirects: 0,
  });
});

async function expectPolish(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("lang", "pl");
  await expect(page.getByText(PL_PITCH)).toBeVisible();
  await expect(page.getByRole("button", { name: "Przełącz na język polski" })).toHaveAttribute("aria-pressed", "true");
}

async function expectEnglish(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByText(EN_PITCH)).toBeVisible();
  await expect(page.getByRole("button", { name: "Switch to English" })).toHaveAttribute("aria-pressed", "true");
}

test("the language switch changes the language, survives sign-in, and the latest choice wins", async ({ page }) => {
  const username = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD;
  if (!username || !password) {
    throw new Error("Set E2E_USERNAME and E2E_PASSWORD (see context/foundation/test-stack.md, ## E2E)");
  }

  // No cookie: Polish is the default.
  await page.goto("/");
  await expectPolish(page);

  // EN on the first page: a plain form POST that returns to the same page.
  await page.getByRole("button", { name: "Przełącz na język angielski" }).click();
  await expectEnglish(page);

  // Navigate to sign-in: still English.
  await page.getByRole("link", { name: "Sign in", exact: true }).first().click();
  await page.waitForURL("/auth/signin");
  await expect(page.getByRole("heading", { name: "Sign in", level: 1 })).toBeVisible();

  // SignInForm hydrates after load (client:load); retry the idempotent fill + submit until it leaves sign-in.
  await expect(async () => {
    await page.getByRole("textbox", { name: "Email" }).fill("");
    await page.getByRole("textbox", { name: "Email" }).fill(username);
    await page.getByRole("textbox", { name: "Password" }).fill("");
    await page.getByRole("textbox", { name: "Password" }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/signin"), { timeout: 5_000 });
  }).toPass();

  // Signed in, back on the landing page, still English.
  await page.waitForURL("/");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expectEnglish(page);

  // The latest choice wins: PL while signed in, and it survives a reload.
  await page.getByRole("button", { name: "Switch to Polish" }).click();
  await expectPolish(page);
  await expect(page.getByRole("button", { name: "Wyloguj się" })).toBeVisible();

  await page.reload();
  await expectPolish(page);

  // Cleanup: the last switch above left the seed user's profile on PL (the afterEach repeats it).
  // Don't sign out: sign-out may revoke the shared test user's sessions, which other specs depend on.
});
