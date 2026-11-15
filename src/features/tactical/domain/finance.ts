import { menuItemSchema, type MenuItem, type Transaction } from "./dataset.ts";

export function summarizeLedger(rows: Transaction[]) {
  const income = rows.filter(r => r.kind === "income");
  const revenueCents = income.reduce((sum, r) => sum + r.amountCents, 0);
  const expenseCents = rows.filter(r => r.kind === "expense").reduce((sum, r) => sum + r.amountCents, 0);
  return { revenueCents, expenseCents, netRecordedCents: revenueCents - expenseCents, dineInCents: income.filter(r => r.channel === "dine-in").reduce((sum, r) => sum + r.amountCents, 0), deliveryCents: income.filter(r => r.channel === "delivery").reduce((sum, r) => sum + r.amountCents, 0) };
}
export function channelContribution(item: MenuItem, channel: "dine-in" | "delivery", priceCents?: number) {
  menuItemSchema.parse(item);
  const price = priceCents ?? (channel === "delivery" ? item.deliveryPriceCents : item.dineInPriceCents);
  if (!Number.isSafeInteger(price) || price < 0 || price > 100_000_000) throw new Error("Invalid price");
  const fees = channel === "delivery" ? Math.round(price * item.deliveryCommissionFraction) + item.packagingCostCents : 0;
  return { priceCents: price, feesCents: fees, contributionCents: price - fees - item.ingredientCostCents };
}
export function stockStatus(current: number, threshold: number): "critical" | "low" | "good" | "overstock" {
  if (current < threshold * 0.5) return "critical";
  if (current < threshold) return "low";
  return current > threshold * 1.5 ? "overstock" : "good";
}
