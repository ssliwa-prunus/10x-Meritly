import type { Page } from "@playwright/test";

/**
 * Resolves once every `client:load` Astro island on the page has hydrated (Astro removes the `ssr`
 * attribute from `astro-island` when it does). Use it before a non-idempotent action on a page with
 * such components, where a retry loop would repeat the action. `client:visible` / `client:idle`
 * islands are left out on purpose: one that is off-screen or hidden never hydrates.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => !document.querySelector('astro-island[ssr][client="load"]'));
}
