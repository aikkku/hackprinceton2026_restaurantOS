import assert from "node:assert/strict";
import test from "node:test";
import fixtureJson from "./frontend/data/demo-restaurant.json" with { type: "json" };
import { isScenarioReproducible, scenarioAction, scenarioLabel, simulateSeating, simulateTurnover } from "./domain/scenario.ts";
import { fixtureSchema, scenarioSchema, type Scenario } from "./domain/schemas.ts";
import { layoutCounts } from "./domain/layout.ts";

const fixture = fixtureSchema.parse(fixtureJson);
const assumptions = {
  turnsPerDay: 1.5, occupancyFraction: 0.65, averageCheck: 34,
  operatingDaysPerMonth: 26, incrementalContributionMargin: 0.32, investmentCost: 2400,
};

function legacySnapshot(): Scenario {
  const seats = layoutCounts(fixture.layout).seats;
  return {
    id: "old-snapshot", schemaVersion: 1, modelVersion: "seating-v1",
    createdAt: "2026-11-14T00:00:00.000Z",
    missionTitle: fixture.mission.title,
    evidence: fixture.reviews,
    layout: fixture.layout,
    baselineSeats: seats,
    assumptions,
    result: simulateSeating(seats, seats, assumptions),
  };
}

test("turnover uses existing seats times changed turns and keeps seat count fixed", () => {
  const result = simulateTurnover(20, 2, assumptions);
  assert.equal(result.draftSeats, 20);
  assert.equal(result.seatChange, 0);
  assert.equal(result.additionalCoversPerDay, 6.5);
  assert.equal(result.incrementalRevenuePerMonth, 5746);
  assert.ok(Math.abs(result.incrementalContributionPerMonth - 1838.72) < 1e-8);
  assert.ok(Math.abs(result.simplePaybackMonths! - 2400 / 1838.72) < 1e-8);
});

test("turnover handles unchanged target, lower target, empty capacity, and zero contribution", () => {
  assert.equal(simulateTurnover(20, 1.5, assumptions).simplePaybackMonths, null);
  assert.ok(simulateTurnover(20, 1, assumptions).additionalCoversPerDay < 0);
  assert.equal(simulateTurnover(20, 1, assumptions).simplePaybackMonths, null);
  assert.equal(simulateTurnover(0, 2, assumptions).additionalCoversPerDay, 0);
  assert.equal(simulateTurnover(20, 2, { ...assumptions, incrementalContributionMargin: 0 }).simplePaybackMonths, null);
  assert.throws(() => simulateTurnover(20, NaN, assumptions));
  assert.throws(() => simulateTurnover(20, 25, assumptions));
  assert.throws(() => simulateTurnover(-1, 2, assumptions));
});

test("legacy snapshots preserve seating semantics and get a readable fallback label", () => {
  const parsed = scenarioSchema.parse(legacySnapshot());
  assert.equal(scenarioAction(parsed), "seating");
  assert.match(scenarioLabel(parsed), /seats$/);
  assert.equal(isScenarioReproducible(parsed), true);
});

test("persisted projections must match the recorded inputs and layout", () => {
  const valid = legacySnapshot();
  assert.equal(isScenarioReproducible({ ...valid, result: { ...valid.result, incrementalRevenuePerMonth: 5 } }), false);
  assert.equal(isScenarioReproducible({ ...valid, result: { ...valid.result, draftSeats: valid.result.draftSeats + 2 } }), false);
  const turnover = { ...valid, action: "turnover", modelVersion: "turnover-v1", targetTurnsPerDay: 2, result: simulateTurnover(valid.baselineSeats, 2, assumptions) };
  assert.equal(isScenarioReproducible(turnover), true);
  assert.equal(isScenarioReproducible({ ...turnover, targetTurnsPerDay: undefined }), false);
  assert.equal(isScenarioReproducible({ ...turnover, modelVersion: "seating-v1" }), false);
});
