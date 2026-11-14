import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WEIGHTS,
  SCORE_VERSION,
  scoreArea,
  weightedScore,
} from "./domain/scoring.ts";
import {
  baseRentMonthly,
  baselineFor,
  calculateScenario,
  FINANCE_VERSION,
  propertyMatches,
} from "./domain/scenario.ts";
import {
  datasetSchema,
  propertySchema,
  scenarioSchema,
  type ScenarioInputs,
} from "./domain/schemas.ts";
import { fixtureProvider } from "./frontend/data/demo-market.ts";
import {
  decodeScenarios,
  persistScenarios,
  STORAGE_KEY,
} from "./frontend/storage.ts";

const allFactors = { demand: 80, similarity: 60, competition: 40, cost: 100 };
const inputs: ScenarioInputs = {
  baseRentMonthly: 4000,
  passThroughMonthly: 750,
  otherFixedMonthly: 6000,
  contributionMargin: 0.35,
  initialInvestment: 90000,
  workingCapital: 25000,
  assumedSalesMonthly: null,
};

test("Expansion scores are deterministic and factor contributions sum to the weighted mean", () => {
  const result = weightedScore(allFactors, DEFAULT_WEIGHTS);
  assert.equal(result.score, 72);
  assert.equal(result.coverage, 1);
  assert.equal(
    Object.values(result.contributions).reduce(
      (sum: number, item) => sum + (item ?? 0),
      0,
    ),
    72,
  );
  assert.deepEqual(weightedScore(allFactors, DEFAULT_WEIGHTS), result);
  assert.equal(
    weightedScore(allFactors, {
      demand: 100,
      similarity: 0,
      competition: 0,
      cost: 0,
    }).score,
    80,
  );
});

test("Expansion coverage uses intended weights and does not invent missing factors", () => {
  const partial = weightedScore({ ...allFactors, cost: null }, DEFAULT_WEIGHTS);
  assert.equal(partial.coverage, 0.75);
  assert.ok(Math.abs(partial.score! - 47 / 0.75) < 1e-8);
  assert.equal(partial.contributions.cost, null);
  assert.deepEqual(partial.missing, ["cost"]);
  assert.equal(
    weightedScore({ ...allFactors, demand: null, cost: null }, DEFAULT_WEIGHTS)
      .score,
    null,
  );
  assert.notEqual(
    weightedScore({ ...allFactors, demand: null }, DEFAULT_WEIGHTS).score,
    null,
  );
});

test("Expansion zero weights and no eligible data remain unscored", () => {
  for (const result of [
    weightedScore(allFactors, {
      demand: 0,
      similarity: 0,
      competition: 0,
      cost: 0,
    }),
    weightedScore(
      { demand: null, similarity: null, competition: null, cost: null },
      DEFAULT_WEIGHTS,
    ),
  ]) {
    assert.equal(result.score, null);
    assert.equal(result.coverage, 0);
  }
});

for (const bad of [-1, Infinity, NaN, 101]) {
  test(`Expansion rejects invalid factor weights and indices: ${bad}`, () => {
    assert.throws(() =>
      weightedScore(allFactors, { ...DEFAULT_WEIGHTS, cost: bad }),
    );
    assert.throws(() =>
      weightedScore({ ...allFactors, cost: bad }, DEFAULT_WEIGHTS),
    );
  });
}

test("Expansion normalizes area rent against budget without replacing missing cost", async () => {
  const data = await fixtureProvider.load();
  const area = { ...data.areas[0], averageBaseRentMonthly: 4000 };
  assert.equal(scoreArea(area, DEFAULT_WEIGHTS, 4000).factors.cost, 50);
  assert.equal(scoreArea(area, DEFAULT_WEIGHTS, 8000).factors.cost, 75);
  assert.equal(
    scoreArea({ ...area, averageBaseRentMonthly: null }, DEFAULT_WEIGHTS, 4000)
      .factors.cost,
    null,
  );
  assert.throws(() => scoreArea(area, DEFAULT_WEIGHTS, 0));
});

test("Expansion rent normalization preserves unknown rent and floor area", () => {
  assert.equal(
    baseRentMonthly({ amount: 24, unit: "USD_PER_SF_YEAR" }, 2000),
    4000,
  );
  assert.equal(
    baseRentMonthly({ amount: 4000, unit: "USD_PER_MONTH" }, null),
    4000,
  );
  assert.equal(
    baseRentMonthly({ amount: 24, unit: "USD_PER_SF_YEAR" }, null),
    null,
  );
  assert.equal(baseRentMonthly(null, 2000), null);
  assert.throws(() =>
    baseRentMonthly({ amount: -1, unit: "USD_PER_MONTH" }, 2000),
  );
  assert.throws(() =>
    baseRentMonthly({ amount: 24, unit: "USD_PER_SF_YEAR" }, 0),
  );
});

test("Expansion finance computes explicit costs and required sales without inventing demand", () => {
  const result = calculateScenario(inputs);
  assert.deepEqual(result, {
    occupancyMonthly: 4750,
    fixedMonthly: 10750,
    initialCashRequired: 115000,
    requiredSalesMonthly: 10750 / 0.35,
    contributionAfterFixedMonthly: null,
    paybackMonths: null,
  });
  assert.deepEqual(calculateScenario(inputs), result);
});

test("Expansion payback requires positive monthly contribution and handles explicit zero sales", () => {
  const positive = calculateScenario({ ...inputs, assumedSalesMonthly: 50000 });
  assert.equal(positive.contributionAfterFixedMonthly, 6750);
  assert.equal(positive.paybackMonths, 90000 / 6750);
  const zero = calculateScenario({ ...inputs, assumedSalesMonthly: 0 });
  assert.equal(zero.contributionAfterFixedMonthly, -10750);
  assert.equal(zero.paybackMonths, null);
  assert.equal(
    calculateScenario({ ...inputs, contributionMargin: 0 })
      .requiredSalesMonthly,
    null,
  );
  assert.equal(
    calculateScenario({ ...inputs, contributionMargin: 0 }).paybackMonths,
    null,
  );
  assert.equal(
    calculateScenario({
      ...inputs,
      initialInvestment: 0,
      assumedSalesMonthly: 50000,
    }).paybackMonths,
    0,
  );
});

test("Expansion reserves do not become monthly costs and edited assumptions change thresholds", () => {
  const result = calculateScenario({ ...inputs, workingCapital: 100000 });
  assert.equal(result.fixedMonthly, 10750);
  assert.equal(result.initialCashRequired, 190000);
  assert.ok(
    calculateScenario({ ...inputs, baseRentMonthly: 5000 })
      .requiredSalesMonthly! > result.requiredSalesMonthly!,
  );
});

for (const contributionMargin of [-1, 1.1, Infinity, NaN]) {
  test(`Expansion rejects invalid contribution margin: ${contributionMargin}`, () => {
    assert.throws(() => calculateScenario({ ...inputs, contributionMargin }));
  });
}

test("Expansion rejects negative costs and nonfinite calculated results", () => {
  assert.throws(() => calculateScenario({ ...inputs, otherFixedMonthly: -1 }));
  assert.throws(() =>
    calculateScenario({ ...inputs, contributionMargin: Number.MIN_VALUE }),
  );
});

test("Expansion JSON fixture preserves bounded H3 records, source labels and property filters", async () => {
  const data = await fixtureProvider.load();
  assert.equal(data.cities.length, 1);
  assert.equal(data.properties.length, 4);
  assert.equal(data.areas.length, 19);
  assert.equal(datasetSchema.safeParse(data).success, true);
  assert.ok(
    data.evidence.every(
      (e) => e.isDemo && e.origin === "simulated" && e.observedAt === null,
    ),
  );
  assert.equal(propertyMatches(data.properties[0], 4000, 2000), true);
  assert.equal(propertyMatches(data.properties[0], 3999, 2000), false);
  assert.equal(propertyMatches(data.properties[0], 4000, 2001), false);
  assert.equal(
    propertyMatches({ ...data.properties[0], askingRent: null }, 8000, 0),
    false,
  );
  assert.equal(
    propertyMatches(
      { ...data.properties[0], availability: "unavailable" },
      8000,
      0,
    ),
    false,
  );
  assert.equal(propertyMatches(data.properties[3], 8000, 0), true);
  assert.throws(() => baselineFor({ ...data.properties[0], askingRent: null }));
});

test("Expansion boundaries reject bad coordinates, inconsistent cells, sources and duplicate IDs", async () => {
  const data = await fixtureProvider.load();
  assert.equal(
    propertySchema.safeParse({ ...data.properties[0], latitude: 200 }).success,
    false,
  );
  assert.equal(
    propertySchema.safeParse({ ...data.properties[0], longitude: null })
      .success,
    false,
  );
  assert.equal(
    propertySchema.safeParse({
      ...data.properties[0],
      h3Index: data.properties[1].h3Index,
    }).success,
    false,
  );
  assert.equal(
    datasetSchema.safeParse({ ...data, evidence: [] }).success,
    false,
  );
  assert.equal(
    datasetSchema.safeParse({
      ...data,
      properties: [data.properties[0], data.properties[0]],
    }).success,
    false,
  );
  assert.equal(
    datasetSchema.safeParse({
      ...data,
      properties: [{ ...data.properties[0], isDemo: false }],
    }).success,
    false,
  );
});

test("Expansion fixture respects cancellation without source substitution", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fixtureProvider.load(controller.signal));
});

async function example() {
  const data = await fixtureProvider.load();
  const property = data.properties[0];
  const defaults = baselineFor(property);
  return scenarioSchema.parse({
    schemaVersion: 1,
    modelVersion: FINANCE_VERSION,
    scoreModelVersion: SCORE_VERSION,
    id: "snapshot-1",
    restaurantId: "demo-restaurant",
    propertyId: property.id,
    propertyName: property.name,
    cityId: property.cityId,
    label: "My scenario",
    createdAt: "2026-11-14T18:00:00.000Z",
    isDemo: true,
    inputs: defaults,
    results: calculateScenario(defaults),
    weights: DEFAULT_WEIGHTS,
    monthlyBudget: 8000,
    sourceIds: property.sourceIds,
    assumptionNotes: ["Illustrative assumptions."],
  });
}

test("Expansion snapshots round-trip without changing their baseline inputs", async () => {
  const scenario = await example();
  const before = structuredClone(scenario);
  const store = new Map<string, string>();
  persistScenarios(
    {
      setItem: (key, value) => {
        store.set(key, value);
      },
    },
    [scenario],
  );
  assert.deepEqual(decodeScenarios(store.get(STORAGE_KEY)!), [scenario]);
  assert.deepEqual(scenario, before);
  assert.deepEqual(decodeScenarios(null), []);
});

test("Expansion snapshot decoding rejects corrupt, incompatible, duplicate and tampered records", async () => {
  const scenario = await example();
  assert.throws(() => decodeScenarios("invalid json"));
  assert.throws(() =>
    decodeScenarios(JSON.stringify([{ ...scenario, schemaVersion: 2 }])),
  );
  assert.throws(() =>
    decodeScenarios(JSON.stringify([{ ...scenario, modelVersion: "unknown" }])),
  );
  assert.throws(() => decodeScenarios(JSON.stringify([scenario, scenario])));
  assert.throws(() =>
    decodeScenarios(
      JSON.stringify([
        { ...scenario, results: { ...scenario.results, fixedMonthly: 1 } },
      ]),
    ),
  );
  assert.throws(() =>
    decodeScenarios(
      JSON.stringify(
        Array.from({ length: 51 }, (_, i) => ({ ...scenario, id: String(i) })),
      ),
    ),
  );
});

test("Expansion storage propagates write errors so callers can preserve drafts", async () => {
  const scenario = await example();
  assert.throws(
    () =>
      persistScenarios(
        {
          setItem: () => {
            throw new Error("Quota exceeded");
          },
        },
        [scenario],
      ),
    /Quota exceeded/,
  );
});
