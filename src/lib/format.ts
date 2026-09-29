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
