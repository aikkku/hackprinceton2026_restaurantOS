import assert from "node:assert/strict";
import test from "node:test";
import demo from "./frontend/data/demo-restaurant.json" with { type: "json" };
import { fixtureSchema, type Scenario } from "./domain/schemas.ts";
import { simulateSeating } from "./domain/scenario.ts";
import { layoutCounts } from "./domain/layout.ts";
import { recoverScenarios } from "./frontend/storage.ts";

const fixture = fixtureSchema.parse(demo);
const seats = layoutCounts(fixture.layout).seats;
const legacy: Scenario = {
  id: "legacy", schemaVersion: 1, modelVersion: "seating-v1",
  missionTitle: fixture.mission.title, createdAt: fixture.layout.updatedAt,
  layout: fixture.layout, baselineSeats: seats, assumptions: fixture.assumptions,
  evidence: fixture.reviews, result: simulateSeating(seats, seats, fixture.assumptions),
};

test("saved work preserves legacy snapshots and recovers valid entries alongside damaged entries", () => {
  const recovered = recoverScenarios([legacy, { id: "broken" }], fixture.profile.id);
  assert.equal(recovered.issue, true);
  assert.equal(recovered.value.length, 1);
  assert.equal(recovered.value[0].id, legacy.id);
  assert.equal(recoverScenarios([legacy], fixture.profile.id).issue, false);
});

test("saved work rejects changed financial results, other restaurants and duplicate IDs", () => {
  const damaged = { ...legacy, result: { ...legacy.result, incrementalRevenuePerMonth: 999999 } };
  assert.equal(recoverScenarios([damaged], fixture.profile.id).value.length, 0);
  assert.equal(recoverScenarios([legacy], "another-restaurant").value.length, 0);
  assert.equal(recoverScenarios([legacy, legacy], fixture.profile.id).value.length, 1);
  assert.equal(recoverScenarios(null, fixture.profile.id).issue, true);
});
