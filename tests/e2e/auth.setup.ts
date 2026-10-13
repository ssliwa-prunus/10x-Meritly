import { test as setup, expect } from "@playwright/test";

const authFile = "playwright/.auth/user.json";

setup("sign in once and save the session", async ({ page, baseURL }) => {
  const username = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD;
  if (!username || !password) {
    throw new Error("Set E2E_USERNAME and E2E_PASSWORD (see context/foundation/test-stack.md, ## E2E)");
  }

  // The assertions below use the Polish dictionary text. Pin the language explicitly: sign-in saves
  // the cookie's choice to the profile (latest choice wins), so a language left on the shared seed
  // user's profile by an earlier run or a manual check cannot leak into this session.
  await page.context().addCookies([{ name: "lang", value: "pl", url: baseURL ?? "" }]);
  await page.goto("/auth/signin");
  // SignInForm is a React island (client:load): input typed before it hydrates is dropped. Retry
  // fill + submit until the submit leaves the sign-in page; signing in twice changes nothing.
  // Clear before filling: re-filling the same value fires no change event in a controlled input.
  await expect(async () => {
    await page.getByRole("textbox", { name: "E-mail" }).fill("");
    await page.getByRole("textbox", { name: "E-mail" }).fill(username);
    await page.getByRole("textbox", { name: "Hasło" }).fill("");
    await page.getByRole("textbox", { name: "Hasło" }).fill(password);
    await page.getByRole("button", { name: "Zaloguj się" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/signin"), { timeout: 5_000 });
  }).toPass();
  await expect(page.getByRole("button", { name: "Wyloguj się" })).toBeVisible();

  await page.context().storageState({ path: authFile });
});
