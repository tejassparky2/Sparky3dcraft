/**
 * Price format of the live store (Shopify "money with currency"):
 *   Rs. 1,299.00 INR
 */
export function formatMoney(amount: number | string | null | undefined, currency = "inr"): string {
  const n = Number(amount ?? 0)
  const cur = currency.toUpperCase()
  const num = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0)
  if (cur === "INR") return `Rs. ${num} INR`
  return `${num} ${cur}`
}
