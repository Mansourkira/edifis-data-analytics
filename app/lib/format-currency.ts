/**
 * Tunisian dinar (ISO 4217: TND) for dashboard amounts.
 */
export function formatCurrencyTnd(value: number, fractionDigits: 0 | 2 | 3 = 2): string {
  return new Intl.NumberFormat("fr-TN", {
    style: "currency",
    currency: "TND",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}
