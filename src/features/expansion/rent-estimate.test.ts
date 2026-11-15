import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { exampleIntake } from "./frontend/data/intake-example.ts";
import { normalizeRequirements } from "./domain/requirements.ts";
import {
  candidateSchema,
  evaluateCandidate,
  groupFor,
  monthlyOccupancyRange,
  type SpaceCandidate,
} from "./domain/matching.ts";
import {
  calculateDecisionFinance,
  decisionFinanceInputsSchema,
  emptyFinanceInputs,
  occupancyBreakdown,
} from "./domain/decision-finance.ts";
import {
  estimateRent,
  estimateRentsResponseSchema,
  rentEstimateSchema,
  RENT_ESTIMATE_MODEL_VERSION,
  RENT_ESTIMATES_RESPONSE_VERSION,
  type RentComparableRow,
  type RentEstimate,
  type RentEstimateTarget,
} from "./domain/rent-estimate.ts";
import { rentEstimatesForCandidates } from "./backend/rent-estimates.ts";
import { LocalDataError } from "./backend/local-dataset.ts";
import {
  displayOrder,
  estimateCostLabel,
  estimateMethodText,
  estimatePin,
} from "./frontend/sprout/model.ts";
import type { AssessedCandidate } from "./domain/matching.ts";

const requirements = normalizeRequirements(exampleIntake(), {
  revisionId: "rent-estimate-test",
  revisionNumber: 0,
  createdAt: "2026-11-15T00:00:00.000Z",
});

const DATASET = { datasetId: "synthetic-rent-tests", datasetDate: "2026-11-01" };
const NOW = "2026-11-15T00:00:00.000Z";
const fixedNow = () => NOW;

const comparable = (id: string, over: Partial<RentComparableRow> = {}): RentComparableRow => ({
  id,
  cityId: "houston",
  latitude: 29.76,
  longitude: -95.36,
  rateLow: 20,
  rateHigh: 20,
  rateBasis: 2,
  currencyCode: 1,
  measurementCode: 1,
  spaceUse: 5,
  statusCode: 1,
  ...over,
});

const target = (over: Partial<RentEstimateTarget> = {}): RentEstimateTarget => ({
  id: "costar-space:9000",
  cityId: "houston",
  latitude: 29.76,
  longitude: -95.36,
  floorAreaSqFt: 1000,
  sizeRangeSqFt: { minimum: 1000, maximum: 1000 },
  ...over,
});

const atLatitude = (id: string, latOffsetDegrees: number, rate: number) =>
  comparable(id, { latitude: 29.76 + latOffsetDegrees, rateLow: rate, rateHigh: rate });

function makeEstimate(over: Partial<RentEstimate> = {}): RentEstimate {
  return rentEstimateSchema.parse({
    modelVersion: RENT_ESTIMATE_MODEL_VERSION,
    method: "nearest_neighbors",
    comparableCount: 8,
    radiusKm: 5,
    medianAnnualPerSqFt: 30,
    p25AnnualPerSqFt: 24,
    p75AnnualPerSqFt: 36,
    monthly: { low: 2000, high: 3000 },
    sizeBasis: "exact",
    sourceIds: ["costar-space:1"],
    datasetId: DATASET.datasetId,
    datasetDate: DATASET.datasetDate,
    origin: "derived",
    generatedAt: NOW,
    notes: ["a", "b"],
    ...over,
  });
}

test("nearest selection: exactly the 8 nearest within 5 km are used; a 6 km comparable is excluded", () => {
  const rows = [
    ...Array.from({ length: 10 }, (_, index) => atLatitude(`costar-space:${index + 1}`, (index + 1) * 0.001, 11 + index)),
    atLatitude("costar-space:far-a", 0.06, 50),
    atLatitude("costar-space:far-b", 0.07, 51),
  ];
  const estimate = estimateRent(target(), rows, DATASET, { now: fixedNow });
  assert.ok(estimate);
  assert.equal(estimate.method, "nearest_neighbors");
  assert.equal(estimate.comparableCount, 8);
  assert.equal(estimate.radiusKm, 5);
  assert.deepEqual(estimate.sourceIds, [
    "costar-space:1", "costar-space:2", "costar-space:3", "costar-space:4",
    "costar-space:5", "costar-space:6", "costar-space:7", "costar-space:8",
  ]);
  assert.ok(!estimate.sourceIds.includes("costar-space:far-a"));
  assert.ok(!estimate.sourceIds.includes("costar-space:far-b"));
  // The 8 nearest rates are 11..18 per sq ft per year; exact-size pricing.
  assert.ok(Math.abs(estimate.p25AnnualPerSqFt - 12.75) < 1e-9);
  assert.equal(estimate.medianAnnualPerSqFt, 14.5);
  assert.ok(Math.abs(estimate.p75AnnualPerSqFt - 16.25) < 1e-9);
  assert.equal(estimate.monthly?.low, 1062.5);
  assert.ok(Math.abs((estimate.monthly?.high ?? 0) - 1354.1666666666667) < 1e-9);
  assert.equal(estimate.sizeBasis, "exact");
  assert.equal(estimate.origin, "derived");
  assert.equal(estimate.modelVersion, RENT_ESTIMATE_MODEL_VERSION);
  assert.equal(estimate.generatedAt, NOW);
  // Mandated honesty notes are always present.
  assert.ok(estimate.notes.some((note) => note.includes("derived base-rent estimate")));
  assert.ok(estimate.notes.some((note) => note.includes("Base rent only")));
});

test("city fallback: fewer than minNearby within the radius uses all qualifying city comparables with a note", () => {
  const rows = [
    atLatitude("costar-space:1", 0.001, 10),
    atLatitude("costar-space:2", 0.002, 20),
    atLatitude("costar-space:3", 0.003, 30),
    atLatitude("costar-space:4", 0.06, 40),
    atLatitude("costar-space:5", 0.07, 50),
    atLatitude("costar-space:6", 0.08, 60),
  ];
  const estimate = estimateRent(target(), rows, DATASET, { now: fixedNow });
  assert.ok(estimate);
  assert.equal(estimate.method, "city_fallback");
  assert.equal(estimate.comparableCount, 6);
  assert.equal(estimate.radiusKm, 5);
  assert.deepEqual(estimate.sourceIds, ["costar-space:1", "costar-space:2", "costar-space:3", "costar-space:4", "costar-space:5", "costar-space:6"]);
  assert.ok(estimate.notes.some((note) => note.includes("city fallback")));
  assert.ok(estimate.notes.some((note) => note.includes("fewer than the 5 minimum")));
});

test("a target without coordinates falls back to all city comparables", () => {
  const rows = [
    atLatitude("costar-space:1", 0.001, 10),
    atLatitude("costar-space:2", 0.002, 20),
    atLatitude("costar-space:3", 0.003, 30),
  ];
  const estimate = estimateRent(target({ latitude: null, longitude: null }), rows, DATASET, { now: fixedNow });
  assert.ok(estimate);
  assert.equal(estimate.method, "city_fallback");
  assert.equal(estimate.comparableCount, 3);
  assert.ok(estimate.notes.some((note) => note.includes("no coordinates")));
});

test("size range prices p25×min and p75×max; unknown size prices nothing monthly", () => {
  const rows = [
    comparable("costar-space:1", { rateLow: 10, rateHigh: 10 }),
    comparable("costar-space:2", { rateLow: 20, rateHigh: 20 }),
    comparable("costar-space:3", { rateLow: 30, rateHigh: 30 }),
    comparable("costar-space:4", { rateLow: 40, rateHigh: 40 }),
  ];
  const ranged = estimateRent(
    target({ floorAreaSqFt: null, sizeRangeSqFt: { minimum: 1000, maximum: 2000 } }),
    rows,
    DATASET,
    { now: fixedNow },
  );
  assert.ok(ranged);
  assert.equal(ranged.sizeBasis, "range");
  // Percentiles over [10,20,30,40]: p25 17.5, median 25, p75 32.5.
  assert.equal(ranged.p25AnnualPerSqFt, 17.5);
  assert.equal(ranged.medianAnnualPerSqFt, 25);
  assert.equal(ranged.p75AnnualPerSqFt, 32.5);
  assert.ok(Math.abs((ranged.monthly?.low ?? 0) - (17.5 / 12) * 1000) < 1e-9);
  assert.ok(Math.abs((ranged.monthly?.high ?? 0) - (32.5 / 12) * 2000) < 1e-9);
  const unknownSize = estimateRent(
    target({ floorAreaSqFt: null, sizeRangeSqFt: { minimum: null, maximum: 2000 } }),
    rows,
    DATASET,
    { now: fixedNow },
  );
  assert.ok(unknownSize);
  assert.equal(unknownSize.monthly, null);
  assert.equal(unknownSize.sizeBasis, "unknown");
  const unknownBoth = estimateRent(
    target({ floorAreaSqFt: null, sizeRangeSqFt: { minimum: null, maximum: null } }),
    rows,
    DATASET,
    { now: fixedNow },
  );
  assert.equal(unknownBoth?.monthly, null);
  assert.equal(unknownBoth?.sizeBasis, "unknown");
});

test("rate-basis conversion: per-month ×12 vs per-year ×1; midpoints and single bounds", () => {
  // per-year 20–30 → 25 annual; per-month 20–30 → 300 annual (×12 apart).
  const rows = [
    comparable("costar-space:year", { rateBasis: 2, rateLow: 20, rateHigh: 30 }),
    comparable("costar-space:month", { rateBasis: 1, rateLow: 20, rateHigh: 30 }),
  ];
  const estimate = estimateRent(target({ latitude: null, longitude: null }), rows, DATASET, { now: fixedNow });
  assert.ok(estimate);
  assert.equal(estimate.comparableCount, 2);
  // Sorted representative annual rates: [25, 300].
  assert.equal(estimate.medianAnnualPerSqFt, 162.5);
  assert.equal(estimate.p25AnnualPerSqFt, 93.75);
  assert.equal(estimate.p75AnnualPerSqFt, 231.25);
  // Only one positive bound → that bound alone.
  const single = estimateRent(
    target({ latitude: null, longitude: null }),
    [comparable("costar-space:low", { rateBasis: 2, rateLow: 20, rateHigh: null }), comparable("costar-space:high", { rateBasis: 2, rateLow: null, rateHigh: 40 })],
    DATASET,
    { now: fixedNow },
  );
  assert.ok(single);
  assert.deepEqual([...single.sourceIds].sort(), ["costar-space:high", "costar-space:low"]);
  assert.equal(single.medianAnnualPerSqFt, 30);
});

test("ineligible rows are excluded: zero/negative rates, units, basis, status, use, city, self", () => {
  const valid = [comparable("costar-space:a"), comparable("costar-space:b")];
  const invalid = [
    comparable("costar-space:zero", { rateLow: 0, rateHigh: 0 }),
    comparable("costar-space:negative", { rateLow: -5, rateHigh: -1 }),
    comparable("costar-space:currency", { currencyCode: 2 }),
    comparable("costar-space:measurement", { measurementCode: 2 }),
    comparable("costar-space:basis", { rateBasis: 3 }),
    comparable("costar-space:inactive", { statusCode: 3 }),
    comparable("costar-space:use", { spaceUse: 1 }),
    comparable("costar-space:other-city", { cityId: "los-angeles" }),
    comparable(target().id, { id: target().id }),
  ];
  const estimate = estimateRent(target({ latitude: null, longitude: null }), [...valid, ...invalid], DATASET, { now: fixedNow });
  assert.ok(estimate);
  assert.equal(estimate.comparableCount, 2);
  assert.deepEqual([...estimate.sourceIds].sort(), ["costar-space:a", "costar-space:b"]);
  // Legacy zero rates (0/0) are never a listed rate.
  const zerosOnly = estimateRent(target(), [comparable("costar-space:zero", { rateLow: 0, rateHigh: 0 })], DATASET, { now: fixedNow });
  assert.equal(zerosOnly, null);
});

test("zero qualifying comparables yield no estimate (never invented)", () => {
  assert.equal(estimateRent(target(), [], DATASET, { now: fixedNow }), null);
  assert.equal(
    estimateRent(target(), [comparable("costar-space:x", { cityId: "los-angeles" })], DATASET, { now: fixedNow }),
    null,
  );
});

test("an estimate never changes the matching assessment or the occupancy range", () => {
  const noRent = candidateSchema.parse({
    id: "costar-space:9000", name: "No-rent suite", address: "1 Test St", suite: "X", cityId: "houston",
    latitude: 29.76, longitude: -95.36, h3Index: null, floorAreaSqFt: 1000,
    sizeRangeSqFt: { minimum: 1000, maximum: 1000 }, rent: null,
    spaceUseCode: 5, listingStatusCode: 1, propertyId: "1", sourceIds: ["costar:listing:9"],
    recordDate: null, datasetDate: null, isDemo: false,
  });
  const assessments = evaluateCandidate(noRent, requirements, []);
  const cost = assessments.find((a) => a.requirementId === "occupancy.monthlyLimit");
  assert.ok(cost);
  assert.equal(cost.status, "unknown");
  assert.equal(cost.reasonCode, "ambiguous_basis");
  assert.equal(groupFor(assessments), "needs_verification");
  const range = monthlyOccupancyRange(noRent, null, "unknown");
  assert.ok("unknown" in range);
});

test("finance: an opted-in estimate adds known charges but keeps the high bound null without them", () => {
  const noRent = candidateSchema.parse({
    id: "costar-space:9000", name: "No-rent suite", address: "1 Test St", suite: "X", cityId: "houston",
    latitude: 29.76, longitude: -95.36, h3Index: null, floorAreaSqFt: 1000,
    sizeRangeSqFt: { minimum: 1000, maximum: 1000 }, rent: null,
    spaceUseCode: 5, listingStatusCode: 1, propertyId: "1", sourceIds: ["costar:listing:9"],
    recordDate: null, datasetDate: null, isDemo: false,
  });
  const estimate = makeEstimate({ monthly: { low: 2000, high: 3000 }, comparableCount: 6, method: "city_fallback" });
  // Without an estimate nothing changes.
  const baseline = calculateDecisionFinance(noRent, emptyFinanceInputs());
  assert.equal(baseline.occupancy, null);
  assert.ok(baseline.gaps.includes("Total monthly occupancy is incomplete."));
  // Estimate + unknown charges → low known, high null, gap remains.
  const unknownCharges = calculateDecisionFinance(noRent, { ...emptyFinanceInputs(), occupancyEstimate: estimate });
  assert.deepEqual(unknownCharges.occupancy, { low: 2000, high: null });
  assert.ok(unknownCharges.gaps.includes("Total monthly occupancy is incomplete."));
  assert.ok(unknownCharges.notes.some((note) => note.includes("market estimate")));
  // Estimate + known charges → both bounds include charges once.
  const knownCharges = calculateDecisionFinance(noRent, {
    ...emptyFinanceInputs(), occupancyEstimate: estimate, additionalOccupancyMonthly: 700,
  });
  assert.deepEqual(knownCharges.occupancy, { low: 2700, high: 3700 });
});

test("saved-plan compat: old financeInputs without occupancyEstimate parse and recompute identically", () => {
  const noRent = candidateSchema.parse({
    id: "costar-space:9000", name: "No-rent suite", address: "1 Test St", suite: "X", cityId: "houston",
    latitude: 29.76, longitude: -95.36, h3Index: null, floorAreaSqFt: 1000,
    sizeRangeSqFt: { minimum: 1000, maximum: 1000 }, rent: null,
    spaceUseCode: 5, listingStatusCode: 1, propertyId: "1", sourceIds: ["costar:listing:9"],
    recordDate: null, datasetDate: null, isDemo: false,
  });
  // A hand-written old save: no occupancyEstimate field at all.
  const oldSave = {
    additionalOccupancyMonthly: null, fixedCostsMonthly: null, fixedCostBasis: "excludes_occupancy" as const,
    contributionMargin: null, totalFunds: null, reserve: null,
    upfront: [], averageSpend: null, operatingDays: null, assumedSalesMonthly: null, illustrative: [],
  };
  const parsed = decisionFinanceInputsSchema.parse(oldSave);
  assert.equal(parsed.occupancyEstimate, null);
  const expected = calculateDecisionFinance(noRent, { ...oldSave, occupancyEstimate: null });
  const recomputed = calculateDecisionFinance(noRent, parsed);
  // The brief's superRefine recompute check stays satisfied for old briefs.
  assert.equal(JSON.stringify(recomputed), JSON.stringify(expected));
  assert.equal(recomputed.occupancy, null);
});

test("occupancyBreakdown shows the estimate only when the quoted rent is unknown", () => {
  const noRent = candidateSchema.parse({
    id: "costar-space:9000", name: "No-rent suite", address: "1 Test St", suite: "X", cityId: "houston",
    latitude: 29.76, longitude: -95.36, h3Index: null, floorAreaSqFt: 1000,
    sizeRangeSqFt: { minimum: 1000, maximum: 1000 }, rent: null,
    spaceUseCode: 5, listingStatusCode: 1, propertyId: "1", sourceIds: ["costar:listing:9"],
    recordDate: null, datasetDate: null, isDemo: false,
  });
  assert.deepEqual(occupancyBreakdown(noRent, null, { low: 2000, high: 3000 }).baseRent, { low: 2000, high: 3000 });
  assert.equal(occupancyBreakdown(noRent, null).baseRent, null);
  const listed = candidateSchema.parse({
    id: "costar-space:1", name: "Listed suite", address: "1 Test St", suite: "A", cityId: "houston",
    latitude: 29.76, longitude: -95.36, h3Index: null, floorAreaSqFt: 1000,
    sizeRangeSqFt: { minimum: 1000, maximum: 1000 },
    rent: { low: 2, high: 2, rateBasisCode: 1, currencyCode: 1, measurementCode: 1, serviceTypeCode: 13 },
    spaceUseCode: 5, listingStatusCode: 1, propertyId: "1", sourceIds: ["costar:listing:1"],
    recordDate: null, datasetDate: null, isDemo: false,
  });
  // A listed rent wins over the estimate.
  assert.deepEqual(occupancyBreakdown(listed, null, { low: 2000, high: 3000 }).baseRent, { low: 2000, high: 2000 });
});

// ---------------------------------------------------------------------------
// Service level (in-memory sqlite, no server)

function memorySpaces(rows: SpaceRow[]): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE spaces (id TEXT, city_id TEXT, lat REAL, lon REAL, rate_low REAL, rate_high REAL, rate_basis INTEGER, currency_code INTEGER, measurement_code INTEGER, space_use INTEGER, status_code INTEGER)",
  );
  const insert = db.prepare("INSERT INTO spaces VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  for (const row of rows) {
    insert.run(
      row.id, row.city_id, row.lat, row.lon, row.rate_low, row.rate_high, row.rate_basis,
      row.currency_code, row.measurement_code, row.space_use, row.status_code,
    );
  }
  return db;
}

type SpaceRow = {
  id: string;
  city_id: string;
  lat: number | null;
  lon: number | null;
  rate_low: number | null;
  rate_high: number | null;
  rate_basis: number | null;
  currency_code: number | null;
  measurement_code: number | null;
  space_use: number | null;
  status_code: number | null;
};

const candidate = (id: string, rent: SpaceCandidate["rent"]): SpaceCandidate =>
  candidateSchema.parse({
    id, name: `Suite ${id}`, address: "1 Test St", suite: null, cityId: "houston",
    latitude: 29.76, longitude: -95.36, h3Index: null, floorAreaSqFt: 1200,
    sizeRangeSqFt: { minimum: 1200, maximum: 1200 }, rent,
    spaceUseCode: 5, listingStatusCode: 1, propertyId: "1", sourceIds: ["costar:listing:1"],
    recordDate: null, datasetDate: null, isDemo: false,
  });

test("rentEstimatesForCandidates: only unlisted-rent candidates get an entry, from the same snapshot", () => {
  const db = memorySpaces([
    { id: "costar-space:1", city_id: "houston", lat: 29.76, lon: -95.36, rate_low: 2, rate_high: 2, rate_basis: 1, currency_code: 1, measurement_code: 1, space_use: 5, status_code: 1 },
    { id: "costar-space:2", city_id: "houston", lat: 29.76, lon: -95.36, rate_low: 4, rate_high: 4, rate_basis: 1, currency_code: 1, measurement_code: 1, space_use: 5, status_code: 1 },
    { id: "costar-space:9", city_id: "houston", lat: 29.76, lon: -95.36, rate_low: 0, rate_high: 0, rate_basis: 1, currency_code: 1, measurement_code: 1, space_use: 5, status_code: 1 },
  ]);
  try {
    const listed = candidate("costar-space:1", { low: 2, high: 2, rateBasisCode: 1, currencyCode: 1, measurementCode: 1, serviceTypeCode: 13 });
    const unlisted = candidate("costar-space:9", null);
    const estimates = rentEstimatesForCandidates(db, [listed, unlisted], DATASET);
    assert.equal(estimates.length, 1);
    assert.equal(estimates[0].candidateId, "costar-space:9");
    assert.ok(estimates[0].estimate);
    assert.equal(estimates[0].estimate?.comparableCount, 2);
    assert.equal(estimates[0].estimate?.method, "city_fallback");
    // Annual rates 24 and 48 → p25 30, p75 42 → ×1200 sq ft / 12.
    assert.equal(estimates[0].estimate?.monthly?.low, 3000);
    assert.equal(estimates[0].estimate?.monthly?.high, 4200);
    assert.equal(estimates[0].estimate?.datasetId, DATASET.datasetId);
  } finally {
    db.close();
  }
});

test("rentEstimatesForCandidates propagates a LocalDataError-style failure, never invented data", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE spaces (other TEXT)");
  try {
    assert.throws(
      () => rentEstimatesForCandidates(db, [candidate("costar-space:9", null)], DATASET),
      (error: unknown) => error instanceof LocalDataError && error.code === "source_failure",
    );
  } finally {
    db.close();
  }
});

test("estimateRentsResponseSchema validates the wire envelope", () => {
  const estimate = makeEstimate();
  const envelope = estimateRentsResponseSchema.parse({
    modelVersion: RENT_ESTIMATES_RESPONSE_VERSION,
    runId: "run-1",
    datasetId: DATASET.datasetId,
    datasetDate: DATASET.datasetDate,
    generatedAt: NOW,
    estimates: [
      { candidateId: "costar-space:9", estimate },
      { candidateId: "costar-space:8", estimate: null },
    ],
  });
  assert.equal(envelope.estimates.length, 2);
  assert.equal(envelope.estimates[1].estimate, null);
});

// ---------------------------------------------------------------------------
// Display helpers

function assessedItem(candidate: SpaceCandidate, group: AssessedCandidate["group"], rank: number): AssessedCandidate {
  return { candidate, assessments: [], group, rank, orderingNotes: [] };
}

test("displayOrder never crosses groups and never puts a no-rent candidate ahead of a listed one", () => {
  const listedA = assessedItem(candidate("a", { low: 2, high: 2, rateBasisCode: 1, currencyCode: 1, measurementCode: 1, serviceTypeCode: 13 }), "meets_assessed_requirements", 1);
  const listedB = assessedItem(candidate("b", { low: 3, high: 3, rateBasisCode: 1, currencyCode: 1, measurementCode: 1, serviceTypeCode: 13 }), "needs_verification", 2);
  const noRentC = assessedItem(candidate("c", null), "meets_assessed_requirements", 3);
  const noRentD = assessedItem(candidate("d", null), "meets_assessed_requirements", 4);
  const noRentE = assessedItem(candidate("e", null), "does_not_meet", 5);
  const estimates = new Map<string, RentEstimate>([
    ["c", makeEstimate({ monthly: { low: 2000, high: 3000 } })], // under cap
    ["d", makeEstimate({ monthly: { low: 6000, high: 7000 } })], // over cap
    ["e", makeEstimate({ monthly: { low: 2000, high: 3000 } })],
  ]);
  const shuffled = [noRentD, listedB, noRentE, noRentC, listedA];
  const ordered = displayOrder(shuffled, estimates, 5000);
  assert.deepEqual(ordered.map((x) => x.candidate.id), ["a", "c", "d", "b", "e"]);
  // Without a cap the no-rent candidates keep their original relative order.
  const orderedNoCap = displayOrder([noRentD, noRentC], estimates, null);
  assert.deepEqual(orderedNoCap.map((x) => x.candidate.id), ["d", "c"]);
});

test("estimate copy: labels, pins and method text stay honest", () => {
  const estimate = makeEstimate({ monthly: { low: 2300, high: 3400 }, medianAnnualPerSqFt: 30 });
  assert.equal(estimateCostLabel(estimate), "≈ $2,300–$3,400/mo + building charges");
  assert.equal(estimateCostLabel(estimate, true), "≈ $2.3k–$3.4k/mo + building charges");
  assert.equal(estimatePin(estimate), "≈ $2.3k–$3.4k");
  const noSize = makeEstimate({ monthly: null, sizeBasis: "unknown" });
  assert.equal(estimateCostLabel(noSize), "≈ $30/sq ft/yr (no size to price)");
  assert.equal(estimatePin(noSize), "≈ $30/sq ft");
  const nearest = makeEstimate();
  assert.equal(estimateMethodText(nearest), "8 listed retail spaces within 5 km, median $30/sq ft/yr, CoStar snapshot 2026-11-01");
  const fallback = makeEstimate({ method: "city_fallback", comparableCount: 6 });
  assert.match(estimateMethodText(fallback), /6 listed retail spaces across the city \(fallback\), median \$30\/sq ft\/yr, CoStar snapshot 2026-11-01/);
});
