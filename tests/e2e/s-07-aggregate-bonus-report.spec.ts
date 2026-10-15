// risk: aggregate-bonus-report — the Supervisor's per-employee totals on /reports/bonuses and in the
//       CSV export disagree, the export is not a usable download, or the approval-date filter
//       does not filter
// seed: tests/e2e/seed.spec.ts
//
// Residue: the oracle never pins an exact total. Every us-01 run approves one more milestone for the
// seeded employees (approval is irreversible, so nothing is cleaned up), and that residue stays in the
// local database until `npx supabase db reset --local`. The seed alone gives Local Employee one
// approved milestone and 600,00 zł (supabase/seed.sql), so the floor is count ≥ 1 and total ≥ 600,00 zł.
// The page and the CSV are compared with each other instead, and the empty state uses a range that
// starts tomorrow (Europe/Warsaw): approvals are stamped with now(), so no run, past or concurrent,
// can ever land in it. This test creates no data.
import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";

// Seeded employee record owned by supervisor@meritly.local (supabase/seed.sql), and its seeded
// approved bonus on "Approved Demo Project" (0.60 of the 1000.00 pool), in grosze.
const SEEDED_EMPLOYEE_NAME = "Local Employee";
const SEEDED_EMPLOYEE_MIN_TOTAL_GROSZE = 600_00;
const CSV_FILENAME = "meritly-bonus-report.csv";

/**
 * A pl-PL amount in grosze: "1 860,00 zł" (grouping with NBSP or narrow NBSP, as Intl renders it)
 * or the CSV's "1860,00". Anything else fails the test rather than being guessed at.
 */
function toGrosze(amount: string): number {
  const digits = amount.replace(/zł/g, "").replace(/\s/g, "");
  const match = /^(\d+),(\d{2})$/.exec(digits);
  if (!match) throw new Error(`Not a pl-PL amount: ${JSON.stringify(amount)}`);
  return Number(match[1]) * 100 + Number(match[2]);
}

/** The calendar day after today in Europe/Warsaw, as YYYY-MM-DD. */
function tomorrowInWarsaw(): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date());
  const next = new Date(`${today}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/** The seeded employee's report row as [name, count, total] text. */
async function seededEmployeeRow(page: Page): Promise<string[]> {
  const row = page
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: SEEDED_EMPLOYEE_NAME, exact: true }) });
  await expect(row).toHaveCount(1);
  return (await row.getByRole("cell").allInnerTexts()).map((text) => text.trim());
}

test.describe("S-07: aggregate bonus report", () => {
  test("supervisor's on-screen totals match the CSV export, and a range with no approvals is empty", async ({
    page,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("baseURL is not configured");
    // The assertions use the Polish dictionary text. Pin the language as auth.setup.ts does: a
    // language left on the shared seed user's profile cannot leak into this session.
    await page.context().addCookies([{ name: "lang", value: "pl", url: baseURL }]);

    // The report is reachable from the Topbar.
    await page.goto("/projects");
    await page.getByRole("link", { name: "Raporty", exact: true }).click();
    await expect(page).toHaveURL("/reports/bonuses");
    await expect(page.getByRole("heading", { name: "Raport premii", level: 1 })).toBeVisible();

    // The on-screen row and the CSV row must agree. A us-01 run in another worker may approve a
    // milestone between the page load and the download, so a mismatch reloads and compares again
    // (each run approves only once, so the second attempt sees a settled database).
    await expect(async () => {
      await page.reload();
      const [, countText, totalText] = await seededEmployeeRow(page);
      const count = Number(countText);
      const totalGrosze = toGrosze(totalText);
      expect(count).toBeGreaterThanOrEqual(1);
      expect(totalGrosze).toBeGreaterThanOrEqual(SEEDED_EMPLOYEE_MIN_TOTAL_GROSZE);

      const downloadEvent = page.waitForEvent("download");
      await page.getByRole("link", { name: "Pobierz CSV", exact: true }).click();
      const download = await downloadEvent;
      expect(download.suggestedFilename()).toBe(CSV_FILENAME);
      const csvPath = await download.path();
      const csv = await readFile(csvPath, "utf8");
      await test.info().attach(CSV_FILENAME, { path: csvPath, contentType: "text/csv" });

      // Built for Polish Excel: BOM, ";" separator, CRLF line ends, comma decimals without "zł".
      expect(csv.startsWith(String.fromCharCode(0xfeff))).toBe(true);
      const lines = csv.slice(1).split("\r\n");
      expect(lines[0]).toBe("Pracownik;Liczba zatwierdzonych kamieni milowych;Suma premii (PLN)");
      const csvRows = lines.map((line) => line.split(";")).filter(([name]) => name === SEEDED_EMPLOYEE_NAME);
      expect(csvRows).toHaveLength(1);
      const [, csvCount, csvTotal] = csvRows[0];
      expect(csvTotal).toMatch(/^\d+,\d{2}$/);
      expect(Number(csvCount)).toBe(count);
      expect(toGrosze(csvTotal)).toBe(totalGrosze);
    }).toPass();

    // A range no approval can fall in shows the empty state instead of the table.
    await page.getByLabel("Zatwierdzone od").fill(tomorrowInWarsaw());
    await page.getByRole("button", { name: "Pokaż", exact: true }).click();
    await expect(page).toHaveURL(/\/reports\/bonuses\?from=\d{4}-\d{2}-\d{2}/);
    await expect(page.getByText("Brak zatwierdzonych premii w wybranym okresie.")).toBeVisible();
    await expect(page.getByRole("link", { name: SEEDED_EMPLOYEE_NAME, exact: true })).toHaveCount(0);

    // No cleanup: the test only reads.
  });
});
