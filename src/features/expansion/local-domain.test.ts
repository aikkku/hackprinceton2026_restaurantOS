import assert from "node:assert/strict";
import test from "node:test";
import { latLngToCell } from "h3-js";
import { localFailure } from "./backend/http.ts";
import {
  MAX_QUERY_LIMIT,
  MAX_QUERY_OFFSET,
  normalizedRecordSchema,
  parseLocalQuery,
  queryCoverageSchema,
} from "./domain/local-data.ts";
import {
  areaSchema,
  evidenceSchema,
  propertySchema,
  scenarioSchema,
  type ScenarioInputs,
} from "./domain/schemas.ts";
import { baseRentMonthly, calculateScenario } from "./domain/scenario.ts";
import {
  DEFAULT_WEIGHTS,
  LOCAL_SCORE_VERSION,
  scoreArea,
} from "./domain/scoring.ts";
import {
  decodeScenarios,
  LOCAL_STORAGE_KEY,
  persistScenarios,
  STORAGE_KEY,
} from "./frontend/storage.ts";

// Synthetic geography and records only. These fixtures are unrelated to sponsor data.
const latitude = 40;
const longitude = -75;
const h3Index = latLngToCell(latitude, longitude, 8);
const normalized = {
  id: "synthetic-property:1",
  sourcePropertyId: "synthetic-1",
  sourceListingId: null,
  recordKind: "property" as const,
  cityId: "synthetic-city",
  name: "Synthetic property",
  address: null,
  latitude,
  longitude,
  h3Index,
  floorAreaSqFt: null,
  askingRent: null,
  originalRentUnit: null,
  rentBasis: null,
  availability: "unknown" as const,
  previousUse: null,
  parkingSpaces: null,
  propertyType: null,
  recordDate: null,
  datasetDate: null,
  sourceIds: ["synthetic-source:1"],
  isDemo: false as const,
};
const property = propertySchema.parse(normalized);
const evidence = evidenceSchema.parse({
  id: "synthetic-source:1",
  provider: "Synthetic test provider",
  recordId: "synthetic-1",
  label: "Synthetic source",
  origin: "observed",
  isDemo: false,
  observedAt: null,
  rights: "Synthetic test data",
  notes: "No current availability or source date is known.",
});
const inputs: ScenarioInputs = {
  baseRentMonthly: 3000,
  passThroughMonthly: 250,
  otherFixedMonthly: 5000,
  contributionMargin: 0.4,
  initialInvestment: 50000,
  workingCapital: 10000,
  assumedSalesMonthly: null,
};

function localSnapshot() {
  return scenarioSchema.parse({
    schemaVersion: 2,
    modelVersion: "expansion-finance-v1",
    scoreModelVersion: LOCAL_SCORE_VERSION,
    id: "synthetic-snapshot-1",
    restaurantId: "local-planning-restaurant",
    propertyId: property.id,
    propertyName: property.name,
    cityId: property.cityId,
    label: "Synthetic opening plan",
    createdAt: "2026-11-14T18:00:00.000Z",
    isDemo: false,
    dataMode: "local",
    datasetId: "synthetic-dataset-v1",
    datasetDate: null,
    propertySnapshot: property,
    evidenceSnapshot: [evidence],
    inputs,
    results: calculateScenario(inputs),
    weights: DEFAULT_WEIGHTS,
    sourceIds: property.sourceIds,
    assumptionNotes: ["Every editable financial input is a user assumption."],
    monthlyBudget: 8000,
  });
}

test("local normalized records preserve missing geography, units, dates and availability", () => {
  const record = normalizedRecordSchema.parse({
    ...normalized,
    latitude: null,
    longitude: null,
    h3Index: null,
    originalRentUnit: "unsupported source unit",
  });
  assert.equal(record.latitude, null);
  assert.equal(record.longitude, null);
  assert.equal(record.h3Index, null);
  assert.equal(record.askingRent, null);
  assert.equal(record.originalRentUnit, "unsupported source unit");
  assert.equal(record.datasetDate, null);
  assert.equal(record.recordDate, null);
  assert.equal(record.availability, "unknown");
  assert.equal(record.floorAreaSqFt, null);
});

test("local normalized coordinates require a valid complete pair and resolution-8 membership", () => {
  for (const changes of [
    { latitude: 91 },
    { longitude: -181 },
    { latitude: NaN },
    { latitude: null },
    { h3Index: null },
    { h3Index: "not-an-h3-cell" },
    { h3Index: latLngToCell(latitude, longitude, 7) },
    { h3Index: latLngToCell(latitude + 1, longitude, 8) },
    { latitude: null, longitude: null },
  ]) {
    assert.equal(
      normalizedRecordSchema.safeParse({ ...normalized, ...changes }).success,
      false,
    );
  }
});

test("local normalized records distinguish property identity from listing identity", () => {
  assert.equal(normalizedRecordSchema.safeParse(normalized).success, true);
  assert.equal(
    normalizedRecordSchema.safeParse({ ...normalized, recordKind: "listing" })
      .success,
    false,
  );
  assert.equal(
    normalizedRecordSchema.safeParse({
      ...normalized,
      recordKind: "listing",
      sourceListingId: "synthetic-listing-1",
      sourceSpaceId: "synthetic-space-1",
    }).success,
    true,
  );
  assert.equal(
    normalizedRecordSchema.safeParse({
      ...normalized,
      sourceListingId: "synthetic-listing-1",
    }).success,
    false,
  );
});

test("local rents reject unknown canonical units and invalid amounts without filling missing values", () => {
  for (const askingRent of [
    { amount: 10, unit: "UNKNOWN" },
    { amount: -1, unit: "USD_PER_SF_YEAR" },
    { amount: Infinity, unit: "USD_PER_MONTH" },
    { amount: null, unit: "USD_PER_SF_YEAR" },
  ]) {
    assert.equal(
      normalizedRecordSchema.safeParse({ ...normalized, askingRent }).success,
      false,
    );
  }
  assert.equal(baseRentMonthly(null, null), null);
  assert.equal(
    baseRentMonthly({ amount: 36, unit: "USD_PER_SF_YEAR" }, null),
    null,
  );
  assert.equal(
    baseRentMonthly({ amount: 36, unit: "USD_PER_SF_YEAR" }, 1500),
    4500,
  );
  assert.equal(
    baseRentMonthly({ amount: 4500, unit: "USD_PER_MONTH" }, null),
    4500,
  );
});

const validParams = () =>
  new URLSearchParams({
    cityId: "synthetic-city",
    west: "-76",
    south: "39",
    east: "-74",
    north: "41",
  });

test("local query parser applies bounded defaults and validates explicit filters", () => {
  assert.deepEqual(parseLocalQuery(validParams()), {
    cityId: "synthetic-city",
    west: -76,
    south: 39,
    east: -74,
    north: 41,
    limit: 100,
    offset: 0,
    includeUnknown: true,
  });
  const params = validParams();
  params.set("limit", String(MAX_QUERY_LIMIT));
  params.set("offset", String(MAX_QUERY_OFFSET));
  params.set("monthlyBudget", "6000");
  params.set("minimumArea", "1500");
  params.set("includeUnknown", "false");
  params.set("availability", "unknown");
  params.set("propertyType", "Retail");
  const query = parseLocalQuery(params);
  assert.equal(query.limit, MAX_QUERY_LIMIT);
  assert.equal(query.offset, MAX_QUERY_OFFSET);
  assert.equal(query.includeUnknown, false);
  assert.equal(query.monthlyBudget, 6000);
  assert.equal(query.minimumArea, 1500);
  assert.equal(query.availability, "unknown");
});

test("local query parser rejects invalid bounds, limits, numeric values and ambiguous parameters", () => {
  for (const [key, value] of [
    ["limit", String(MAX_QUERY_LIMIT + 1)],
    ["limit", "0"],
    ["limit", "1.5"],
    ["offset", String(MAX_QUERY_OFFSET + 1)],
    ["offset", "-1"],
    ["west", "-181"],
    ["east", "-77"],
    ["east", "-60"],
    ["north", "38"],
    ["monthlyBudget", "0"],
    ["minimumArea", "-1"],
    ["limit", "Infinity"],
    ["south", "NaN"],
    ["cityId", ""],
    ["includeUnknown", "1"],
    ["availability", "active"],
    ["unknownField", "true"],
  ]) {
    const params = validParams();
    params.set(key, value);
    assert.throws(() => parseLocalQuery(params), `${key}=${value}`);
  }
  const duplicate = validParams();
  duplicate.append("cityId", "other-city");
  assert.throws(() => parseLocalQuery(duplicate));
  const missing = validParams();
  missing.delete("west");
  assert.throws(() => parseLocalQuery(missing));
});

test("query response coverage refuses counts above the rendering limits", () => {
  const coverage = {
    totalMatching: 1000,
    returned: 100,
    limit: 100,
    offset: 0,
    areasReturned: 200,
    areasLimited: true,
  };
  assert.equal(queryCoverageSchema.safeParse(coverage).success, true);
  assert.equal(
    queryCoverageSchema.safeParse({ ...coverage, returned: 201 }).success,
    false,
  );
  assert.equal(
    queryCoverageSchema.safeParse({ ...coverage, areasReturned: 201 }).success,
    false,
  );
});

test("API failure responses distinguish configuration and invalid queries while redacting source errors", async () => {
  const configuration = localFailure({ code: "not_configured" });
  assert.equal(configuration.status, 503);
  assert.equal((await configuration.json()).error.code, "not_configured");
  const invalid = localFailure({ code: "invalid_query" });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, "invalid_query");
  const source = localFailure(new Error("synthetic private/path.sqlite: raw source failure"));
  assert.equal(source.status, 503);
  assert.equal(source.headers.get("Cache-Control"), "private, no-store");
  const body = await source.text();
  assert.equal(JSON.parse(body).error.code, "source_failure");
  assert.equal(body.includes("private/path.sqlite"), false);
  assert.equal(body.includes("raw source failure"), false);
});

test("real areas remain unscored when weights change or fictional factors are supplied", () => {
  const area = areaSchema.parse({
    h3Index,
    h3Resolution: 8,
    cityId: "synthetic-city",
    label: "Synthetic area",
    factors: { demand: 100, similarity: 100, competition: 100, cost: 100 },
    sourceIds: [evidence.id],
    isDemo: false,
    averageBaseRentMonthly: 1000,
    metrics: {
      propertyCount: 1,
      listingCount: 0,
      rentSampleCount: 0,
      averageAskingRentPerSfYear: null,
    },
  });
  for (const weights of [
    DEFAULT_WEIGHTS,
    { demand: 0, similarity: 0, competition: 0, cost: 100 },
    { demand: 0, similarity: 0, competition: 0, cost: 0 },
  ]) {
    const result = scoreArea(area, weights, 8000);
    assert.equal(result.score, null);
    assert.equal(result.coverage, 0);
    assert.equal(result.modelVersion, LOCAL_SCORE_VERSION);
    assert.deepEqual(result.factors, {
      demand: null,
      similarity: null,
      competition: null,
      cost: null,
    });
  }
});

test("version-2 local snapshots retain dated property evidence and reproducible assumptions", () => {
  const snapshot = localSnapshot();
  const decoded = decodeScenarios(JSON.stringify([snapshot]));
  assert.deepEqual(decoded, [snapshot]);
  assert.equal(decoded[0].isDemo, false);
  assert.equal(decoded[0].schemaVersion, 2);
  if (decoded[0].schemaVersion !== 2) assert.fail("Expected version 2");
  assert.equal(decoded[0].datasetDate, null);
  assert.equal(decoded[0].propertySnapshot.availability, "unknown");
  assert.equal(decoded[0].results.requiredSalesMonthly, 8250 / 0.4);
  assert.equal(decoded[0].results.contributionAfterFixedMonthly, null);
});

test("local snapshots reject mixed demo provenance, missing evidence and tampered results", () => {
  const snapshot = localSnapshot();
  for (const changed of [
    { ...snapshot, isDemo: true },
    { ...snapshot, scoreModelVersion: "expansion-area-demo-v1" },
    { ...snapshot, propertySnapshot: { ...property, isDemo: true } },
    { ...snapshot, propertySnapshot: { ...property, id: "other-property" } },
    { ...snapshot, evidenceSnapshot: [] },
    { ...snapshot, evidenceSnapshot: [{ ...evidence, isDemo: true }] },
    { ...snapshot, sourceIds: ["missing-source"] },
    { ...snapshot, results: { ...snapshot.results, fixedMonthly: 0 } },
  ]) {
    assert.throws(() => decodeScenarios(JSON.stringify([changed])));
  }
});

test("legacy demo snapshots remain readable and local snapshots use separate storage", () => {
  const local = localSnapshot();
  const legacy = scenarioSchema.parse({
    ...local,
    schemaVersion: 1,
    scoreModelVersion: "expansion-area-demo-v1",
    id: "synthetic-legacy-demo",
    restaurantId: "demo-restaurant",
    isDemo: true,
  });
  assert.deepEqual(decodeScenarios(JSON.stringify([legacy])), [legacy]);
  const store = new Map<string, string>();
  const storage = { setItem: (key: string, value: string) => store.set(key, value) };
  persistScenarios(storage, [legacy]);
  persistScenarios(storage, [local], "local");
  assert.deepEqual(decodeScenarios(store.get(STORAGE_KEY)!), [legacy]);
  assert.deepEqual(decodeScenarios(store.get(LOCAL_STORAGE_KEY)!), [local]);
  assert.throws(() => persistScenarios(storage, [local], "demo"));
  assert.throws(() => persistScenarios(storage, [legacy], "local"));
});
