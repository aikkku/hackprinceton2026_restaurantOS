import { z } from "zod";
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
