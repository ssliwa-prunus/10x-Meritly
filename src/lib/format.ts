const PLN_FORMAT = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" });

/** Display text for a PLN amount. Presentation only: amounts arrive already floored from SQL. */
export function formatPln(value: number): string {
  return PLN_FORMAT.format(value);
}

const PERCENT_FORMAT = new Intl.NumberFormat("pl-PL", { style: "percent", maximumFractionDigits: 0 });

/** Display text for a fraction as a whole percentage (1.1 → "110%"). Presentation only. */
export function formatPercent(value: number): string {
  return PERCENT_FORMAT.format(value);
}

const MULTIPLIER_FORMAT = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 6 });

/** Display text for a multiplier or weight with up to 6 decimals, the most M carries (1.1875 → "1,1875"). Presentation only. */
export function formatMultiplier(value: number): string {
  return MULTIPLIER_FORMAT.format(value);
}

// en-CA formats as YYYY-MM-DD, matching how the app shows plain dates; Warsaw time, not the Worker's UTC.
const DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Display date (YYYY-MM-DD, Warsaw time) of an ISO timestamp such as approved_at. Presentation only. */
export function formatDate(timestamp: string): string {
  return DATE_FORMAT.format(new Date(timestamp));
}

const SHARE_FORMAT = new Intl.NumberFormat("pl-PL", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Display text for a fraction as a percentage with one decimal (0.4317 → "43,2%"). Presentation only. */
export function formatShare(value: number): string {
  return SHARE_FORMAT.format(value);
}
