import assert from "node:assert/strict";
import test from "node:test";
import json from "./frontend/data/demo-restaurant.json" with { type: "json" };
import {
  displayLength, fitsRoom, footprint, hasOverlap, layoutCounts, overlappingIds, positionObject, toMeters,
} from "./domain/layout.ts";
import { simulateSeating } from "./domain/scenario.ts";
import { fixtureSchema, layoutSchema } from "./domain/schemas.ts";

const fixture = fixtureSchema.parse(json);
const { layout } = fixture;
const assumptions = {
  turnsPerDay: 1.5, occupancyFraction: 0.65, averageCheck: 34,
  operatingDaysPerMonth: 26, incrementalContributionMargin: 0.32, investmentCost: 2400,
};
const room = { width: 12, depth: 7.5 };
const sampleTable = { id: "sample", type: "table_2", rotation: 0, width: 1.4, depth: 0.9, seats: 2, x: 1, y: 1 } as const;

test("the demo links its mission to distinct reviews and has a valid starting layout", () => {
  assert.equal(fixture.isDemo, true);
  assert.equal(fixture.profile.id, layout.restaurantId);
  const citedReviews = fixture.reviews.filter(({ id }) => fixture.mission.evidenceIds.includes(id));
  assert.deepEqual(new Set(citedReviews.map(({ id }) => id)), new Set(fixture.mission.evidenceIds));
  assert.equal(overlappingIds(layout.objects).size, 0);
  assert.deepEqual(layoutCounts({ ...layout, objects: [sampleTable] }), { seats: 2, tables: 1 });
  assert.deepEqual(layoutCounts({ ...layout, objects: [] }), { seats: 0, tables: 0 });
});

test("fixture validation rejects dangling evidence, duplicate IDs, and out-of-bounds furniture", () => {
  assert.equal(fixtureSchema.safeParse({
    ...fixture, mission: { ...fixture.mission, evidenceIds: ["unsupported"] },
  }).success, false);
  assert.equal(layoutSchema.safeParse({ ...layout, room, objects: [sampleTable, sampleTable] }).success, false);
  assert.equal(layoutSchema.safeParse({ ...layout, room, objects: [{ ...sampleTable, x: room.width }] }).success, false);
});

test("furniture positions snap in meters and clamp to the rotated footprint", () => {
  const object = { ...sampleTable, rotation: 90 as const };
  assert.deepEqual(footprint(object), { width: object.depth, depth: object.width });
  const placed = positionObject(object, room, 0.18, 99, true);
  assert.equal(placed.x, 0.25);
  assert.equal(placed.y, room.depth - object.width);
  assert.equal(fitsRoom(placed, room), true);

  const fractional = { ...room, width: 11.99995 };
  assert.equal(fitsRoom(positionObject(object, fractional, 99, 0, true), fractional), true);
});

test("touching furniture edges are allowed and interior overlap is identified", () => {
  const first = sampleTable;
  const adjacent = { ...first, id: "adjacent", x: first.x + first.width };
  assert.equal(hasOverlap(first, adjacent), false);
  assert.deepEqual([...overlappingIds([first, { ...adjacent, x: adjacent.x - 0.01 }])], [first.id, adjacent.id]);
});

test("feet and meters preserve the same geometry across a unit round-trip", () => {
  assert.equal(toMeters(10, "ft"), 3.048);
  assert.ok(Math.abs(toMeters(displayLength(7.5, "ft"), "ft") - 7.5) < 1e-10);
  assert.equal(displayLength(7.5, "m"), 7.5);
});

test("six added seats produce reproducible results and respond to assumption changes", () => {
  const result = simulateSeating(23, 29, assumptions);
  assert.deepEqual(result, simulateSeating(23, 29, assumptions));
  assert.equal(result.seatChange, 6);
  assert.ok(Math.abs(result.additionalCoversPerDay - 5.85) < 1e-8);
  assert.ok(Math.abs(result.incrementalRevenuePerMonth - 5171.4) < 1e-8);
  assert.ok(Math.abs(result.incrementalContributionPerMonth - 1654.848) < 1e-8);
  assert.ok(Math.abs((result.simplePaybackMonths ?? 0) - 2400 / 1654.848) < 1e-8);
  assert.ok(simulateSeating(23, 29, { ...assumptions, occupancyFraction: 0.8 }).incrementalRevenuePerMonth > result.incrementalRevenuePerMonth);
});

test("zero demand, zero margin, negative margin, and fewer seats have no payback", () => {
  assert.equal(simulateSeating(23, 29, { ...assumptions, occupancyFraction: 0 }).simplePaybackMonths, null);
  assert.equal(simulateSeating(23, 29, { ...assumptions, incrementalContributionMargin: 0 }).simplePaybackMonths, null);
  assert.equal(simulateSeating(23, 29, { ...assumptions, incrementalContributionMargin: -0.25 }).simplePaybackMonths, null);
  assert.equal(simulateSeating(23, 23, assumptions).additionalCoversPerDay, 0);
  const reduced = simulateSeating(23, 19, assumptions);
  assert.ok(reduced.incrementalRevenuePerMonth < 0);
  assert.equal(reduced.simplePaybackMonths, null);
  assert.equal(simulateSeating(23, 19, { ...assumptions, incrementalContributionMargin: -0.25 }).simplePaybackMonths, null);
});

test("invalid assumptions and noninteger capacity fail at the simulation boundary", () => {
  assert.throws(() => simulateSeating(23.5, 29, assumptions));
  assert.throws(() => simulateSeating(23, 29, { ...assumptions, occupancyFraction: 1.1 }));
  assert.throws(() => simulateSeating(23, 29, { ...assumptions, averageCheck: Infinity }));
  assert.throws(() => simulateSeating(23, 29, { ...assumptions, operatingDaysPerMonth: 32 }));
});
