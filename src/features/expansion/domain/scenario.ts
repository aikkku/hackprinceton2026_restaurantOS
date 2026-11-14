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
