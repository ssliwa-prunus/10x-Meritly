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

const MULTIPLIER_FORMAT = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 4 });

/** Display text for a milestone multiplier with up to 4 decimals (1.1875 → "1,1875"). Presentation only. */
export function formatMultiplier(value: number): string {
  return MULTIPLIER_FORMAT.format(value);
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
