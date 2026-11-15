import { z } from "zod";
import type { FinancialBaseline } from "./intake.ts";
import {
  rentSchema,
  scenarioInputsSchema,
  scenarioResultsSchema,
  type ExpansionProperty,
  type ScenarioInputs,
} from "./schemas.ts";

export const FINANCE_VERSION = "expansion-finance-v1";

export function baseRentMonthly(
  rent: ExpansionProperty["askingRent"],
  floorAreaSqFt: number | null,
): number | null {
  if (rent === null) return null;
  rentSchema.parse(rent);
  if (rent.unit === "USD_PER_MONTH") return rent.amount;
  if (floorAreaSqFt === null) return null;
  if (!Number.isFinite(floorAreaSqFt) || floorAreaSqFt <= 0)
    throw new Error("Floor area must be positive");
  const result = (rent.amount * floorAreaSqFt) / 12;
  if (!Number.isFinite(result))
    throw new Error("Rent calculation exceeds supported range");
  return result;
}

export function calculateScenario(value: ScenarioInputs) {
  const inputs = scenarioInputsSchema.parse(value);
  const occupancyMonthly = inputs.baseRentMonthly + inputs.passThroughMonthly;
  const fixedMonthly = occupancyMonthly + inputs.otherFixedMonthly;
  const contributionAfterFixedMonthly =
    inputs.assumedSalesMonthly === null
      ? null
      : inputs.assumedSalesMonthly * inputs.contributionMargin - fixedMonthly;
  return scenarioResultsSchema.parse({
    occupancyMonthly,
    fixedMonthly,
    requiredSalesMonthly:
      inputs.contributionMargin > 0
        ? fixedMonthly / inputs.contributionMargin
        : null,
    contributionAfterFixedMonthly,
    paybackMonths:
      contributionAfterFixedMonthly !== null &&
      contributionAfterFixedMonthly > 0
        ? inputs.initialInvestment / contributionAfterFixedMonthly
        : null,
    initialCashRequired: inputs.initialInvestment + inputs.workingCapital,
  });
}

export function baselineFor(property: ExpansionProperty): ScenarioInputs {
  const baseRent = baseRentMonthly(property.askingRent, property.floorAreaSqFt);
  if (baseRent === null)
    throw new Error(
      "Enter a base-rent assumption before simulating this property",
    );
  return {
    baseRentMonthly: baseRent,
    passThroughMonthly: 750,
    otherFixedMonthly: 6000,
    contributionMargin: 0.35,
    initialInvestment: 90000,
    workingCapital: 25000,
    assumedSalesMonthly: null,
  };
}

export function propertyMatches(
  property: ExpansionProperty,
  budget: number,
  minimumArea: number,
) {
  const rent = baseRentMonthly(property.askingRent, property.floorAreaSqFt);
  return (
    property.availability !== "unavailable" &&
    rent !== null &&
    rent <= budget &&
    property.floorAreaSqFt !== null &&
    property.floorAreaSqFt >= minimumArea
  );
}

// ---------------------------------------------------------------------------
// Callable finance tool boundary (Phase 2). Pure, schema-validated DTOs;
// Phase 3's Python worker invokes these through the documented contracts and
// must not reimplement the arithmetic.

export const FINANCE_TOOL_VERSION = "expansion-finance-tool-v1";

export const requiredSalesInputSchema = z.object({
  fixedCostsMonthly: z.number().finite().nonnegative().max(1e12),
  contributionMargin: z.number().finite().min(0).max(1),
});
export type RequiredSalesInput = z.infer<typeof requiredSalesInputSchema>;

export const requiredSalesOutputSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    requiredSalesMonthly: z.number().finite().nonnegative(),
  }),
  z.object({
    status: z.literal("unavailable"),
    requiredSalesMonthly: z.literal(null),
    reason: z.string().min(1),
  }),
]);
export type RequiredSalesOutput = z.infer<typeof requiredSalesOutputSchema>;

/**
 * Required monthly sales = fixed costs / contribution margin.
 * Zero margin has no attainable threshold; missing inputs are unavailable,
 * never replaced with defaults.
 */
export function requiredSalesMonthly(
  input: RequiredSalesInput,
): RequiredSalesOutput {
  const parsed = requiredSalesInputSchema.parse(input);
  if (parsed.contributionMargin <= 0) {
    return {
      status: "unavailable",
      requiredSalesMonthly: null,
      reason:
        "No sales threshold is attainable at a zero contribution margin.",
    };
  }
  const result = parsed.fixedCostsMonthly / parsed.contributionMargin;
  if (!Number.isFinite(result)) {
    return {
      status: "unavailable",
      requiredSalesMonthly: null,
      reason: "The requested calculation exceeds the supported numeric range.",
    };
  }
  return requiredSalesOutputSchema.parse({
    status: "available",
    requiredSalesMonthly: result,
  });
}

/**
 * Phase 3: deterministic finance inputs derived from the intake baseline.
 * The Python finance specialist calls finance.required_sales with exactly
 * these values (or none); the worker never derives margin itself.
 *
 * - Fixed costs = fixed labor + other fixed costs excluding occupancy
 *   (occupancy is analyzed per candidate separately).
 * - Contribution margin = (net sales − variable costs) / net sales when all
 *   inputs are observed and net sales is positive; zero/negative net sales
 *   yields no usable margin.
 */
export function financeInputsFromBaseline(
  baseline: FinancialBaseline,
): {
  fixedCostsMonthly: number | null;
  contributionMargin: number | null;
  origin: "derived" | "unavailable";
  reasons: string[];
} {
  const reasons: string[] = [];
  if (baseline.origin !== "observed") {
    return {
      fixedCostsMonthly: null,
      contributionMargin: null,
      origin: "unavailable",
      reasons: ["The financial baseline is unavailable, so no fixed costs or margin can be derived."],
    };
  }
  let fixedCostsMonthly: number | null = null;
  if (
    baseline.fixedLaborCosts !== null &&
    baseline.otherFixedCostsExcludingOccupancy !== null
  ) {
    const total = baseline.fixedLaborCosts + baseline.otherFixedCostsExcludingOccupancy;
    if (Number.isFinite(total) && total >= 0) fixedCostsMonthly = total;
  } else {
    reasons.push(
      "Fixed labor costs or other fixed costs are missing, so required sales cannot be derived.",
    );
  }
  let contributionMargin: number | null = null;
  if (
    baseline.netSales !== null &&
    baseline.variableCosts !== null &&
    baseline.netSales > 0
  ) {
    const margin = (baseline.netSales - baseline.variableCosts) / baseline.netSales;
    if (Number.isFinite(margin) && margin > 0 && margin <= 1) {
      contributionMargin = margin;
    } else if (Number.isFinite(margin) && margin <= 0) {
      reasons.push("Variable costs meet or exceed net sales, so no positive contribution margin exists.");
    }
  } else {
    reasons.push(
      "Net sales or variable costs are missing (or net sales is zero), so the contribution margin cannot be derived.",
    );
  }
  if (fixedCostsMonthly === null || contributionMargin === null) {
    return {
      fixedCostsMonthly,
      contributionMargin,
      origin: "unavailable",
      reasons: reasons.length ? reasons : ["The financial baseline cannot support required-sales calculation."],
    };
  }
  return { fixedCostsMonthly, contributionMargin, origin: "derived", reasons: [] };
}
