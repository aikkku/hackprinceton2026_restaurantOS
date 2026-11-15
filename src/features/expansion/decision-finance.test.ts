import test from "node:test";
import assert from "node:assert/strict";
import { calculateDecisionFinance, decisionFinanceInputsSchema, emptyFinanceInputs, occupancyBreakdown, upfrontCategories } from "./domain/decision-finance.ts";
import { candidateSchema } from "./domain/matching.ts";
import { rentEstimateSchema, RENT_ESTIMATE_MODEL_VERSION } from "./domain/rent-estimate.ts";
import type { RentEstimate } from "./domain/rent-estimate.ts";

// Explicit synthetic inputs. These are not CoStar records or measured finances.
const candidate = candidateSchema.parse({ id: "synthetic:space-a", name: "Synthetic test suite", address: "1 Test St", suite: "A", cityId: "houston", latitude: 29.8, longitude: -95.4, h3Index: null, floorAreaSqFt: 1000, sizeRangeSqFt: { minimum: 1000, maximum: 1000 }, rent: { low: 48, high: 48, rateBasisCode: 2, currencyCode: 1, measurementCode: 1, serviceTypeCode: 13 }, spaceUseCode: 5, listingStatusCode: 1, propertyId: "synthetic:building", sourceIds: ["synthetic-test-input"], recordDate: null, datasetDate: null, isDemo: true });

test("synthetic complete $10k fixed costs / 0.4 margin = $25k required sales; no profit/payback invented", () => {
  const input = { ...emptyFinanceInputs(), fixedCostsMonthly: 10000, fixedCostBasis: "includes_occupancy" as const, contributionMargin: 0.4 };
  const result = calculateDecisionFinance(candidate, input);
  assert.deepEqual(result.requiredSales, { low: 25000, high: 25000 });
  assert.equal(result.assumedContributionAfterFixed, null);
  assert.equal(result.usableFunds, null);
  assert.equal(result.guestsPerDay, null);
  assert.equal(result.completeUpfront, null);
  assert.deepEqual(result.sensitivity.map(x => x.requiredSales?.low), [20000, 25000, 30000]);
  assert.deepEqual(result, calculateDecisionFinance(candidate, input));
});
test("rent units/ranges, unknown charges and included services preserve bounds", () => {
  const input = emptyFinanceInputs();
  assert.deepEqual(calculateDecisionFinance(candidate, input).occupancy, { low: 4000, high: null });
  input.additionalOccupancyMonthly = 800;
  assert.deepEqual(calculateDecisionFinance(candidate, input).occupancy, { low: 4800, high: 4800 });
  const ranged = structuredClone(candidate); ranged.rent!.high = 60;
  assert.deepEqual(calculateDecisionFinance(ranged, input).occupancy, { low: 4800, high: 5800 });
  ranged.rent!.serviceTypeCode = 7;
  assert.deepEqual(calculateDecisionFinance(ranged, input).occupancy, { low: 4000, high: 5000 });
  ranged.rent!.currencyCode = 2;
  assert.equal(calculateDecisionFinance(ranged, input).occupancy, null);
});
test("monthly versus annual asking rent has equivalent results; partial area stays unavailable", () => {
  const monthly = structuredClone(candidate); monthly.rent!.low = monthly.rent!.high = 4; monthly.rent!.rateBasisCode = 1;
  assert.deepEqual(calculateDecisionFinance(monthly, emptyFinanceInputs()).occupancy, calculateDecisionFinance(candidate, emptyFinanceInputs()).occupancy);
  monthly.floorAreaSqFt = null; monthly.sizeRangeSqFt.maximum = null;
  assert.equal(calculateDecisionFinance(monthly, emptyFinanceInputs()).occupancy, null);
});
test("fixed costs include occupancy only once and guests/day requires spend plus days", () => {
  const input = { ...emptyFinanceInputs(), additionalOccupancyMonthly: 800, fixedCostsMonthly: 5200, contributionMargin: 0.4, averageSpend: 25, operatingDays: 25 };
  let result = calculateDecisionFinance(candidate, input);
  assert.deepEqual(result.fixedCosts, { low: 10000, high: 10000 });
  assert.deepEqual(result.guestsPerDay, { low: 40, high: 40 });
  result = calculateDecisionFinance(candidate, { ...input, fixedCostBasis: "includes_occupancy" });
  assert.deepEqual(result.fixedCosts, { low: 5200, high: 5200 });
  assert.equal(calculateDecisionFinance(candidate, { ...input, operatingDays: null }).guestsPerDay, null);
});
test("reserve unknown remains unknown; deposits and working capital counted once and not as recurring costs", () => {
  const input = { ...emptyFinanceInputs(), totalFunds: 100000 };
  assert.equal(calculateDecisionFinance(candidate, input).usableFunds, null);
  input.reserve = 20000;
  input.upfront = upfrontCategories.map(category => ({ category, amount: 10000 }));
  const result = calculateDecisionFinance(candidate, input);
  assert.equal(result.usableFunds, 80000); assert.equal(result.completeUpfront, 50000); assert.equal(result.openingFundsRemaining, 30000);
  assert.deepEqual(result.occupancy, { low: 4000, high: null });
  assert.equal(decisionFinanceInputsSchema.safeParse({ ...input, upfront: [input.upfront[0], input.upfront[0]] }).success, false);
  assert.equal(decisionFinanceInputsSchema.safeParse({ ...input, reserve: 100001 }).success, false);
});
test("zero margin, missing fixed costs and invalid spend never produce finance defaults", () => {
  assert.equal(calculateDecisionFinance(candidate, { ...emptyFinanceInputs(), fixedCostsMonthly: 10000, contributionMargin: 0 }).requiredSales, null);
  assert.equal(calculateDecisionFinance(candidate, { ...emptyFinanceInputs(), contributionMargin: 0.4 }).requiredSales, null);
  assert.equal(decisionFinanceInputsSchema.safeParse({ ...emptyFinanceInputs(), averageSpend: 0 }).success, false);
  assert.equal(decisionFinanceInputsSchema.safeParse({ ...emptyFinanceInputs(), operatingDays: 0 }).success, false);
});

// ---------------------------------------------------------------------------
// Derived rent-estimate opt-in (base rent only; never a matching result)

const noRent = candidateSchema.parse({ id: "synthetic:space-no-rent", name: "No-rent test suite", address: "1 Test St", suite: "B", cityId: "houston", latitude: 29.8, longitude: -95.4, h3Index: null, floorAreaSqFt: 1000, sizeRangeSqFt: { minimum: 1000, maximum: 1000 }, rent: null, spaceUseCode: 5, listingStatusCode: 1, propertyId: "synthetic:building", sourceIds: ["synthetic-test-input"], recordDate: null, datasetDate: null, isDemo: true });

function estimate(monthly: { low: number; high: number }): RentEstimate {
  return rentEstimateSchema.parse({
    modelVersion: RENT_ESTIMATE_MODEL_VERSION,
    method: "city_fallback",
    comparableCount: 6,
    radiusKm: 5,
    medianAnnualPerSqFt: 30,
    p25AnnualPerSqFt: 24,
    p75AnnualPerSqFt: 36,
    monthly,
    sizeBasis: "exact",
    sourceIds: ["costar-space:1"],
    datasetId: "synthetic-test",
    datasetDate: null,
    origin: "derived",
    generatedAt: "2026-11-15T00:00:00.000Z",
    notes: ["a", "b"],
  });
}

test("estimate opt-in: null estimate changes nothing; known charges add once; unknown charges keep the gap", () => {
  const baseline = calculateDecisionFinance(noRent, emptyFinanceInputs());
  assert.equal(baseline.occupancy, null);
  // A null estimate (the default) recomputes exactly like the pre-change shape.
  assert.deepEqual(
    calculateDecisionFinance(noRent, { ...emptyFinanceInputs(), occupancyEstimate: null }),
    baseline,
  );
  const optedIn = { ...emptyFinanceInputs(), occupancyEstimate: estimate({ low: 2000, high: 3000 }) };
  const unknownCharges = calculateDecisionFinance(noRent, optedIn);
  assert.deepEqual(unknownCharges.occupancy, { low: 2000, high: null });
  assert.ok(unknownCharges.gaps.includes("Total monthly occupancy is incomplete."));
  assert.ok(unknownCharges.notes.some((note) => note.includes("market estimate")));
  const knownCharges = calculateDecisionFinance(noRent, { ...optedIn, additionalOccupancyMonthly: 700 });
  assert.deepEqual(knownCharges.occupancy, { low: 2700, high: 3700 });
});

test("estimate opt-in: old saves without the field parse unchanged and recompute identically", () => {
  const oldSave = {
    additionalOccupancyMonthly: null, fixedCostsMonthly: null, fixedCostBasis: "excludes_occupancy" as const,
    contributionMargin: null, totalFunds: null, reserve: null,
    upfront: [], averageSpend: null, operatingDays: null, assumedSalesMonthly: null, illustrative: [],
  };
  const parsed = decisionFinanceInputsSchema.parse(oldSave);
  assert.equal(parsed.occupancyEstimate, null);
  const expected = calculateDecisionFinance(noRent, { ...oldSave, occupancyEstimate: null });
  assert.equal(JSON.stringify(calculateDecisionFinance(noRent, parsed)), JSON.stringify(expected));
});

test("occupancyBreakdown: estimate used only when the quoted rent is unknown", () => {
  assert.deepEqual(occupancyBreakdown(noRent, 800, { low: 2000, high: 3000 }).baseRent, { low: 2000, high: 3000 });
  assert.equal(occupancyBreakdown(noRent, 800).baseRent, null);
  // A quoted rent wins over any estimate.
  assert.deepEqual(occupancyBreakdown(candidate, 800, { low: 2000, high: 3000 }).baseRent, { low: 4000, high: 4000 });
});
