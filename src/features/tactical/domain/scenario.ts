import { assumptionsSchema, seatCountSchema, type Assumptions, type Scenario } from "./schemas.ts";

export function simulateSeating(baselineSeats: number, draftSeats: number, assumptions: Assumptions): Scenario["result"] {
  seatCountSchema.parse(baselineSeats);
  seatCountSchema.parse(draftSeats);
  const inputs = assumptionsSchema.parse(assumptions);

  const seatChange = draftSeats - baselineSeats;
  const additionalCoversPerDay = (seatChange * inputs.turnsPerDay * inputs.occupancyFraction) || 0;
  const incrementalRevenuePerMonth = additionalCoversPerDay * inputs.averageCheck * inputs.operatingDaysPerMonth;
  const incrementalContributionPerMonth = (incrementalRevenuePerMonth * inputs.incrementalContributionMargin) || 0;
  const payback = seatChange > 0 && incrementalContributionPerMonth > 0
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
