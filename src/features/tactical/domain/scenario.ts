import { layoutCounts } from "./layout.ts";
import { assumptionsSchema, seatCountSchema, scenarioSettingsSchema, scenarioSchema, type Assumptions, type Scenario } from "./schemas.ts";

function contributionResult(draftSeats: number, seatChange: number, additionalCoversPerDay: number, inputs: Assumptions): Scenario["result"] {
  const incrementalRevenuePerMonth = additionalCoversPerDay * inputs.averageCheck * inputs.operatingDaysPerMonth;
  const incrementalContributionPerMonth = (incrementalRevenuePerMonth * inputs.incrementalContributionMargin) || 0;
  const payback = additionalCoversPerDay > 0 && incrementalContributionPerMonth > 0
    ? inputs.investmentCost / incrementalContributionPerMonth
    : null;

  return {
    draftSeats,
    seatChange,
    additionalCoversPerDay,
    incrementalRevenuePerMonth,
    incrementalContributionPerMonth,
    simplePaybackMonths: payback !== null && Number.isFinite(payback) ? payback : null,
  };
}

export function simulateSeating(baselineSeats: number, draftSeats: number, assumptions: Assumptions): Scenario["result"] {
  seatCountSchema.parse(baselineSeats);
  seatCountSchema.parse(draftSeats);
  const inputs = assumptionsSchema.parse(assumptions);
  const seatChange = draftSeats - baselineSeats;
  const additionalCoversPerDay = (seatChange * inputs.turnsPerDay * inputs.occupancyFraction) || 0;
  return contributionResult(draftSeats, seatChange, additionalCoversPerDay, inputs);
}

export function simulateTurnover(baselineSeats: number, targetTurnsPerDay: number, assumptions: Assumptions): Scenario["result"] {
  seatCountSchema.parse(baselineSeats);
  scenarioSettingsSchema.parse({ action: "turnover", label: "Turnover", targetTurnsPerDay });
  const inputs = assumptionsSchema.parse(assumptions);
  const additionalCoversPerDay = (baselineSeats * (targetTurnsPerDay - inputs.turnsPerDay) * inputs.occupancyFraction) || 0;
  return contributionResult(baselineSeats, 0, additionalCoversPerDay, inputs);
}

export function scenarioAction(scenario: Scenario) {
  return scenario.action ?? "seating";
}

export function scenarioLabel(scenario: Scenario) {
  return scenario.label ?? `${scenario.baselineSeats} → ${scenario.result.draftSeats} seats`;
}

export function recomputeScenario(scenario: Scenario, assumptions = scenario.assumptions) {
  if (scenarioAction(scenario) === "turnover") {
    return simulateTurnover(scenario.baselineSeats, scenario.targetTurnsPerDay!, assumptions);
  }
  return simulateSeating(scenario.baselineSeats, scenario.result.draftSeats, assumptions);
}


// Compare persisted projections with the current implementation of their recorded model.
export function isScenarioReproducible(value: unknown): value is Scenario {
  const parsed = scenarioSchema.safeParse(value);
  if (!parsed.success) return false;
  const scenario = parsed.data;
  if (scenarioAction(scenario) === "seating" && layoutCounts(scenario.layout).seats !== scenario.result.draftSeats) return false;
  const expected = recomputeScenario(scenario);
  return (Object.keys(expected) as Array<keyof typeof expected>).every((key) => {
    const actualValue = scenario.result[key];
    const expectedValue = expected[key];
    if (actualValue === null || expectedValue === null) return actualValue === expectedValue;
    return Math.abs(actualValue - expectedValue) <= 1e-8 * Math.max(1, Math.abs(expectedValue));
  });
}
