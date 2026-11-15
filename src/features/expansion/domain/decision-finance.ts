import { z } from "zod";
import { monthlyOccupancyRange, serviceInclusion, type SpaceCandidate } from "./matching.ts";
import { rentEstimateSchema } from "./rent-estimate.ts";
import { requiredSalesMonthly } from "./scenario.ts";

export const DECISION_FINANCE_VERSION = "expansion-decision-finance-v1";
const amount = z.number().finite().nonnegative().max(1e12);
export const upfrontCategories = ["deposit", "build_out", "equipment", "fees", "initial_working_capital"] as const;
/**
 * Explicitly labeled illustrative values the owner may opt into for blank
 * fields. Deliberately excludes fixed costs, funds, upfront costs and sales:
 * those are owner/site-specific, and assumed sales would be invented demand.
 */
export const ILLUSTRATIVE_VALUES = { contributionMargin: 0.35, averageSpend: 25, operatingDays: 26 } as const;
export const illustrativeKeys = ["contributionMargin", "averageSpend", "operatingDays"] as const;
export type IllustrativeKey = typeof illustrativeKeys[number];
export const decisionFinanceInputsSchema = z.object({
  additionalOccupancyMonthly: amount.nullable(),
  fixedCostsMonthly: amount.nullable(),
  fixedCostBasis: z.enum(["includes_occupancy", "excludes_occupancy"]),
  contributionMargin: z.number().finite().min(0).max(1).nullable(),
  totalFunds: amount.nullable(),
  reserve: amount.nullable(),
  upfront: z.array(z.object({ category: z.enum(upfrontCategories), amount: amount.nullable() })).max(5),
  averageSpend: amount.positive().nullable(),
  operatingDays: z.number().finite().positive().max(31).nullable(),
  assumedSalesMonthly: amount.nullable(),
  /** Fields currently holding ILLUSTRATIVE_VALUES (absent in pre-illustrative saves → []). */
  illustrative: z.array(z.enum(illustrativeKeys)).max(illustrativeKeys.length).default([]),
  /**
   * Opted-in derived base-rent estimate (D-033 precedent: additive optional
   * field with a default, like `illustrative`). Old saved inputs without the
   * field parse unchanged and recompute identically: the field defaults to
   * null and the calculation is unchanged when null. An estimate is base
   * rent only and NEVER changes the matching assessment.
   */
  occupancyEstimate: rentEstimateSchema.nullable().default(null),
}).superRefine((value, ctx) => {
  if (new Set(value.illustrative).size !== value.illustrative.length)
    ctx.addIssue({ code: "custom", path: ["illustrative"], message: "Duplicate illustrative field." });
  for (const key of value.illustrative) if (value[key] !== ILLUSTRATIVE_VALUES[key])
    ctx.addIssue({ code: "custom", path: ["illustrative"], message: `${key} is labeled illustrative but holds a different value.` });
  if (new Set(value.upfront.map(x => x.category)).size !== value.upfront.length)
    ctx.addIssue({ code: "custom", message: "An upfront category can only be counted once." });
  if (value.reserve !== null && value.totalFunds !== null && value.reserve > value.totalFunds)
    ctx.addIssue({ code: "custom", path: ["reserve"], message: "Reserve exceeds total funds." });
});
export type DecisionFinanceInputs = z.infer<typeof decisionFinanceInputsSchema>;
export const emptyFinanceInputs = (): DecisionFinanceInputs => ({
  additionalOccupancyMonthly: null, fixedCostsMonthly: null, fixedCostBasis: "excludes_occupancy",
  contributionMargin: null, totalFunds: null, reserve: null,
  upfront: upfrontCategories.map(category => ({ category, amount: null })),
  averageSpend: null, operatingDays: null, assumedSalesMonthly: null, illustrative: [],
  occupancyEstimate: null,
});
/** Fill only blank illustrative-eligible fields; existing owner inputs are never overwritten. */
export function applyIllustrative(inputs: DecisionFinanceInputs): DecisionFinanceInputs {
  const next = { ...inputs, illustrative: [...inputs.illustrative] };
  for (const key of illustrativeKeys) if (next[key] === null) { next[key] = ILLUSTRATIVE_VALUES[key]; next.illustrative.push(key); }
  return decisionFinanceInputsSchema.parse(next);
}

export type MoneyRange = { low: number; high: number | null };
/**
 * Display-only split of the occupancy total (not part of saved results):
 * base rent from the quoted rent — or, when the quote is unknown and the
 * owner opted into a derived estimate, the estimate's monthly range — plus
 * nonincluded charges once. The estimate is base rent only; it never
 * changes the matching assessment.
 */
export function occupancyBreakdown(candidate: SpaceCandidate, additionalOccupancyMonthly: number | null, estimateMonthly: { low: number; high: number } | null = null): { baseRent: MoneyRange | null; additional: { status: "included_in_rent" | "known" | "unknown"; monthly: number | null } } {
  const inclusion = serviceInclusion(candidate.rent?.serviceTypeCode ?? null);
  const base = monthlyOccupancyRange(candidate, 0, "not_included");
  const baseRent = "known" in base ? base.known : estimateMonthly !== null ? { ...estimateMonthly } : null;
  return {
    baseRent,
    additional: inclusion === "included" ? { status: "included_in_rent", monthly: null } : additionalOccupancyMonthly === null ? { status: "unknown", monthly: null } : { status: "known", monthly: additionalOccupancyMonthly },
  };
}
const range = z.object({ low: amount, high: amount.nullable() });
export const decisionFinanceResultSchema = z.object({
  modelVersion: z.literal(DECISION_FINANCE_VERSION),
  occupancy: range.nullable(), fixedCosts: range.nullable(), requiredSales: range.nullable(),
  guestsPerDay: range.nullable(), usableFunds: amount.nullable(),
  knownUpfront: amount, completeUpfront: amount.nullable(), openingFundsRemaining: z.number().finite().nullable(),
  assumedContributionAfterFixed: z.object({ low: z.number().finite().nullable(), high: z.number().finite() }).nullable(),
  sensitivity: z.array(z.object({ fixedCostMultiplier: z.number(), requiredSales: range.nullable() })),
  gaps: z.array(z.string()), notes: z.array(z.string()),
});
export type DecisionFinanceResult = z.infer<typeof decisionFinanceResultSchema>;

/** Thresholds, never a demand forecast. Recurring rent is never an upfront charge. */
export function calculateDecisionFinance(candidate: SpaceCandidate, raw: DecisionFinanceInputs): DecisionFinanceResult {
  const input = decisionFinanceInputsSchema.parse(raw);
  const occupancyResult = monthlyOccupancyRange(candidate, input.additionalOccupancyMonthly, serviceInclusion(candidate.rent?.serviceTypeCode ?? null));
  let occupancy = "known" in occupancyResult ? occupancyResult.known : null;
  const gaps: string[] = [];
  const notes = ["All edited finance inputs are user planning assumptions. No demand or payback prediction is made."];
  if (input.illustrative.length) notes.push(`Illustrative (not sourced, not the owner's figures): ${input.illustrative.map(key => `${key} = ${ILLUSTRATIVE_VALUES[key]}`).join(", ")}. Results using them are illustrations only.`);
  // Opted-in derived estimate replaces an unknown quoted base rent only.
  // Base-rent-only rule: while extra charges are unknown the high bound
  // stays null, and the estimate NEVER changes the matching assessment.
  if (!("known" in occupancyResult) && input.occupancyEstimate?.monthly) {
    const estimate = input.occupancyEstimate.monthly;
    occupancy = {
      low: estimate.low + (input.additionalOccupancyMonthly ?? 0),
      high: input.additionalOccupancyMonthly === null ? null : estimate.high + input.additionalOccupancyMonthly,
    };
    notes.push(`Base rent uses the market estimate (${input.occupancyEstimate.comparableCount} comparable listings, ${input.occupancyEstimate.method}); it is derived, not this listing's price.`);
  }
  if (!occupancy || occupancy.high === null) gaps.push("Total monthly occupancy is incomplete.");
  if ("notes" in occupancyResult) notes.push(...occupancyResult.notes);
  let fixedCosts: { low: number; high: number | null } | null = null;
  if (input.fixedCostsMonthly !== null) {
    if (input.fixedCostBasis === "includes_occupancy") {
      fixedCosts = { low: input.fixedCostsMonthly, high: input.fixedCostsMonthly };
      notes.push("Supplied complete fixed costs include occupancy; rent is not added again.");
    } else if (occupancy) {
      fixedCosts = { low: input.fixedCostsMonthly + occupancy.low, high: occupancy.high === null ? null : input.fixedCostsMonthly + occupancy.high };
    }
  }
  if (!fixedCosts) gaps.push("Supply fixed costs and their occupancy basis.");
  const salesFor = (multiplier: number) => {
    if (!fixedCosts || input.contributionMargin === null) return null;
    const low = requiredSalesMonthly({ fixedCostsMonthly: fixedCosts.low * multiplier, contributionMargin: input.contributionMargin }).requiredSalesMonthly;
    const high = fixedCosts.high === null ? null : requiredSalesMonthly({ fixedCostsMonthly: fixedCosts.high * multiplier, contributionMargin: input.contributionMargin }).requiredSalesMonthly;
    return low === null ? null : { low, high };
  };
  const requiredSales = salesFor(1);
  if (!requiredSales) gaps.push("Required sales need supported fixed costs and a positive contribution margin.");
  const guestsPerDay = requiredSales && input.averageSpend !== null && input.operatingDays !== null
    ? { low: requiredSales.low / input.averageSpend / input.operatingDays, high: requiredSales.high === null ? null : requiredSales.high / input.averageSpend / input.operatingDays } : null;
  if (!guestsPerDay) gaps.push("Guests/day needs required sales, average spend and operating days.");
  const usableFunds = input.totalFunds !== null && input.reserve !== null ? input.totalFunds - input.reserve : null;
  if (usableFunds === null) gaps.push("Usable opening funds need total funds and an explicit reserve; a missing reserve is not zero.");
  const knownUpfront = input.upfront.reduce((sum, x) => sum + (x.amount ?? 0), 0);
  const completeUpfront = input.upfront.length === upfrontCategories.length && input.upfront.every(x => x.amount !== null) ? knownUpfront : null;
  if (completeUpfront === null) gaps.push("Upfront plan is incomplete; supply every category (including explicit zero where appropriate).");
  const assumedContributionAfterFixed = input.assumedSalesMonthly !== null && input.contributionMargin !== null && fixedCosts
    ? { low: fixedCosts.high === null ? null : input.assumedSalesMonthly * input.contributionMargin - fixedCosts.high, high: input.assumedSalesMonthly * input.contributionMargin - fixedCosts.low } : null;
  return decisionFinanceResultSchema.parse({
    modelVersion: DECISION_FINANCE_VERSION, occupancy, fixedCosts, requiredSales, guestsPerDay, usableFunds,
    knownUpfront, completeUpfront, openingFundsRemaining: usableFunds === null || completeUpfront === null ? null : usableFunds - completeUpfront,
    assumedContributionAfterFixed, sensitivity: [0.8, 1, 1.2].map(fixedCostMultiplier => ({ fixedCostMultiplier, requiredSales: salesFor(fixedCostMultiplier) })), gaps, notes,
  });
}
