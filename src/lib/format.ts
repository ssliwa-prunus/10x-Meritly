const PLN_FORMAT = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" });

/** Display text for a PLN amount. Presentation only: amounts arrive already floored from SQL. */
export function formatPln(value: number): string {
  return PLN_FORMAT.format(value);
}
