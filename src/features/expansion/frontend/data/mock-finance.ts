import { intakeSchema, type RestaurantIntake } from "../../domain/intake.ts";

export const MOCK_FINANCE_SOURCE_ID = "mock-finance-monthly-v1";
export const MOCK_FINANCE_NOTICE = "Mock financial data: example monthly sales and expenses, not your restaurant’s records. Required sales exclude rent and extra building charges; they are not a sales forecast.";

/**
 * Temporary, explicit finance demo adapter. The saved profile and canonical
 * missing-data fixture remain untouched. A run containing these synthetic
 * records is always marked demo, even when the restaurant profile is real.
 * `observed` here describes a record in the simulated intake, not real accounts.
 */
export function withMockFinance(intake: RestaurantIntake): RestaurantIntake {
  const copy = structuredClone(intake);
  const baseline = copy.financialBaseline;
  if (baseline.origin !== "unavailable" || [baseline.netSales, baseline.variableCosts, baseline.fixedLaborCosts, baseline.otherFixedCostsExcludingOccupancy].some((value) => value !== null)) return copy;
  return intakeSchema.parse({
    ...copy,
    isDemo: true,
    origin: "simulated_finance",
    description: `${copy.description} ${MOCK_FINANCE_NOTICE}`,
    financialBaseline: {
      ...baseline,
      origin: "observed",
      currency: "USD",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      netSales: 60000,
      variableCosts: 36000,
      fixedLaborCosts: 12000,
      otherFixedCostsExcludingOccupancy: 4000,
      sourceAnswerIds: [MOCK_FINANCE_SOURCE_ID],
    },
    sourceAnswers: [...copy.sourceAnswers, {
      id: MOCK_FINANCE_SOURCE_ID,
      question: "What does the synthetic monthly finance fixture contain?",
      answer: "MOCK DATA, not an owner answer or real financial record. October 2026: net sales $60,000; variable costs $36,000; fixed labor $12,000; other fixed costs excluding occupancy $4,000. Do not infer actual performance or future demand.",
    }],
    followUpQuestions: copy.followUpQuestions.filter((question) => question.field !== "financialBaseline"),
    matchingNotes: [...copy.matchingNotes, MOCK_FINANCE_NOTICE],
  });
}

export function usesMockFinance(intake: RestaurantIntake): boolean {
  return intake.isDemo && intake.financialBaseline.sourceAnswerIds.includes(MOCK_FINANCE_SOURCE_ID);
}
