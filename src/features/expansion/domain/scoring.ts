import {
  factorKeys,
  factorsSchema,
  weightsSchema,
  type ExpansionArea,
  type Weights,
} from "./schemas.ts";

export const SCORE_VERSION = "expansion-area-demo-v1";
export const DEFAULT_WEIGHTS: Weights = {
  demand: 30,
  similarity: 25,
  competition: 20,
  cost: 25,
};
export const FACTOR_LABELS = {
  demand: "Demand indicator",
  similarity: "Looks like home",
  competition: "Competition fit",
  cost: "Base-rent fit",
} as const;
export const MIN_COVERAGE = 0.7;

export function weightedScore(
  factors: ExpansionArea["factors"],
  weights: Weights,
) {
  weightsSchema.parse(weights);
  // Validate even factors excluded by a zero weight.
  factorsSchema.parse(factors);
  const total = factorKeys.reduce((sum, key) => sum + weights[key], 0);
  const eligible = factorKeys.filter(
    (key) => weights[key] > 0 && factors[key] !== null,
  );
  const includedWeight = eligible.reduce((sum, key) => sum + weights[key], 0);
  const coverage = total > 0 ? includedWeight / total : 0;
  const missing = factorKeys.filter(
    (key) => weights[key] > 0 && factors[key] === null,
  );
  const contributions = Object.fromEntries(
    factorKeys.map((key) => [
      key,
      eligible.includes(key) && includedWeight > 0
        ? (factors[key]! * weights[key]) / includedWeight
        : null,
    ]),
  );
  return {
    score:
      coverage >= MIN_COVERAGE && includedWeight > 0
        ? eligible.reduce((sum, key) => sum + factors[key]! * weights[key], 0) /
          includedWeight
        : null,
    coverage,
    missing,
    contributions,
    modelVersion: SCORE_VERSION,
    factorSet: eligible.join(","),
  };
}

export function scoreArea(
  area: ExpansionArea,
  weights: Weights,
  monthlyBudget: number,
) {
  if (!Number.isFinite(monthlyBudget) || monthlyBudget <= 0)
    throw new Error("Budget must be greater than zero");
  // Versioned planning normalization: zero rent = 100, budget = 50, twice budget = 0.
  const factors = {
    ...area.factors,
    cost:
      area.averageBaseRentMonthly === null
        ? null
        : Math.max(
            0,
            Math.min(
              100,
              100 * (1 - area.averageBaseRentMonthly / (2 * monthlyBudget)),
            ),
          ),
  };
  return { ...weightedScore(factors, weights), factors };
}
