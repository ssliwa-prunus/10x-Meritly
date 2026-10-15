import { z } from "zod";
import type { BonusReportFilter, BonusReportRow } from "@/types";

// ---------------------------------------------------------------------------
// Aggregate bonus report (/reports/bonuses): filter parsing, grand total, CSV export and its
// file name. Pure, so it is unit- and mutation-tested without the Astro pipeline. The rows are
// already scoped by RLS and summed in SQL; this only validates, totals and serialises them.
// ---------------------------------------------------------------------------

export type BonusReportFilterError = "invalid_date" | "range_reversed";

/**
 * An optional YYYY-MM-DD calendar date; empty or missing means null. The round trip through
 * toISOString both rejects impossible dates (2026-02-30 rolls over to March) and pins the exact
 * format, since the value must equal the 10-character ISO day.
 */
const optionalDateField = () =>
  z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .refine((value) => {
      if (value === null) return true;
      const date = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    });

const filterSchema = z.object({ from: optionalDateField(), to: optionalDateField() });

/**
 * Reads `from` and `to` from the query string. A malformed or impossible date is `invalid_date`;
 * a valid `from` after `to` is `range_reversed` (ISO dates compare correctly as strings). Equal
 * bounds are one day.
 */
export function parseBonusReportFilter(
  params: URLSearchParams,
): { data: BonusReportFilter; error?: undefined } | { data?: undefined; error: BonusReportFilterError } {
  const parsed = filterSchema.safeParse({ from: params.get("from") ?? "", to: params.get("to") ?? "" });
  if (!parsed.success) return { error: "invalid_date" };
  const { from, to } = parsed.data;
  if (from !== null && to !== null && from > to) return { error: "range_reversed" };
  return { data: { from, to } };
}

/** Money in integer grosze, so sums are exact (0.10 + 0.20 is not 0.30 in floating point). */
const toGrosze = (amount: number) => Math.round(amount * 100);

/** Sum of every row's total, exact to the grosz. */
export function reportGrandTotal(rows: readonly BonusReportRow[]): number {
  return rows.reduce((sum, row) => sum + toGrosze(row.total_bonus), 0) / 100;
}

// ---------------------------------------------------------------------------
// CSV. Built for Excel in a Polish locale: UTF-8 BOM (so Excel detects the encoding), ";" as the
// separator, CRLF line ends (every row, the last one included), comma decimals with two places and
// no grouping. Amounts are written here, never through formatPln (it adds NBSP and "zł").
// Text cells are injection-safe: a leading =, +, -, @, tab or CR would make a spreadsheet read the
// cell as a formula, so it gets a "'" prefix; a cell with ;, ", CR or LF is then quoted with any "
// doubled. Header labels go through the same escaping.
// ---------------------------------------------------------------------------

const CSV_SEPARATOR = ";";
const CSV_LINE_END = "\r\n";
const BOM = "﻿";

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[;"\r\n]/;

function csvText(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** An amount as `1234,50`: two decimals, comma, no grouping. */
function csvAmount(amount: number): string {
  const grosze = toGrosze(amount);
  const sign = grosze < 0 ? "-" : "";
  const abs = Math.abs(grosze);
  return `${sign}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

export interface BonusReportCsvHeaders {
  name: string;
  milestones: string;
  total: string;
}

/** The report as a CSV document: a header row from the passed (localised) labels, then one row per employee. */
export function buildBonusReportCsv(rows: readonly BonusReportRow[], headers: BonusReportCsvHeaders): string {
  const lines = [
    [csvText(headers.name), csvText(headers.milestones), csvText(headers.total)],
    ...rows.map((row) => [csvText(row.employee_name), String(row.milestone_count), csvAmount(row.total_bonus)]),
  ];
  return BOM + lines.map((cells) => cells.join(CSV_SEPARATOR) + CSV_LINE_END).join("");
}

/**
 * Download name: `meritly-bonus-report[-from-<date>][-to-<date>].csv`, each bound only when set.
 * The bounds are labelled, so a from-only and a to-only export never share a name.
 */
export function bonusReportFilename(filter: BonusReportFilter): string {
  const parts = ["meritly-bonus-report"];
  if (filter.from !== null) parts.push("from", filter.from);
  if (filter.to !== null) parts.push("to", filter.to);
  return `${parts.join("-")}.csv`;
}
