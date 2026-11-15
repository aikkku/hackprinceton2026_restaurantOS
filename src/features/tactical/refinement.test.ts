import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fixtureSchema, layoutSchema } from "./domain/schemas.ts";
import { initialLibrary, layoutLibrarySchema, layoutInsights } from "./domain/layout-library.ts";
import { applyObjectMeasurements } from "./frontend/layout-edit.ts";
import { floorPlanDraftSchema, rotatePlan, analyzeRequestSchema } from "./domain/analyze.ts";
const fixture = fixtureSchema.parse(JSON.parse(readFileSync(new URL("./frontend/data/demo-restaurant.json", import.meta.url), "utf8")));

test("legacy layout migrates and named alternatives retain independent metadata", () => {
  const library = initialLibrary(fixture.layout);
  const custom = { id: "fridge", type: "custom" as const, x: 0, y: 0, width: 1, depth: 1, rotation: 0 as const, name: "Refrigerator", description: "Beside kitchen entrance" };
  const alternative = layoutSchema.parse({ ...fixture.layout, name: "Renovation", objects: [custom] });
  library.entries.push({ id: "renovation", layout: alternative });
  library.activeId = "renovation";
  const roundtrip = layoutLibrarySchema.parse(JSON.parse(JSON.stringify(library)));
  assert.equal(roundtrip.baselineId, "current");
  assert.equal(roundtrip.entries[1].layout.objects[0].description, custom.description);
  assert.deepEqual(roundtrip.entries[0].layout, fixture.layout);
  const updated = applyObjectMeasurements(alternative, custom, { ...custom, name: "Walk-in fridge", description: "Insulated", width: 2 }, "m");
  assert.equal(updated.name, "Walk-in fridge");
  assert.equal(updated.width, 2);
});

test("library rejects dangling IDs, duplicates, and mixed restaurant ownership", () => {
  const library = initialLibrary(fixture.layout);
  assert.equal(layoutLibrarySchema.safeParse({ ...library, baselineId: "missing" }).success, false);
  assert.equal(layoutLibrarySchema.safeParse({ ...library, entries: [...library.entries, ...library.entries] }).success, false);
  assert.equal(layoutLibrarySchema.safeParse({ ...library, entries: [...library.entries, { id: "other", layout: { ...fixture.layout, restaurantId: "other" } }] }).success, false);
});

test("AC proximity yields a hypothesis tied to the seating object", () => {
  const layout = layoutSchema.parse({ ...fixture.layout, objects: [
    { id: "seat", type: "chair", x: 1, y: 1, width: 0.5, depth: 0.5, seats: 1, rotation: 0 },
    { id: "ac", type: "ac", x: 1, y: 0, width: 1, depth: 0.35, rotation: 0 },
  ] });
  const finding = layoutInsights(layout)[0];
  assert.ok(finding.objectIds.includes("ac"));
  assert.match(finding.explanation, /hypothesis/);
  assert.equal(finding.severity, "Potential problem");
});

test("photo imports reject incomplete data, huge seat counts and duplicate IDs", () => {
  assert.equal(floorPlanDraftSchema.safeParse({ room: { width: 30, depth: 20 }, tables: [] }).success, false);
  const plan = { room: { width: 30, depth: 20, confidence: 1 }, door: { wall: "E" as const, position: 0.25, label: "Entrance" }, fixtures: [], tables: [], questions: [] };
  assert.equal(rotatePlan(plan, 90).door.position, 0.75);
  assert.deepEqual(rotatePlan(rotatePlan(plan, 180), 180), plan);
  assert.equal(analyzeRequestSchema.safeParse({ photos: ["not an image"] }).success, false);
  const table = { id: "t1", x: 1, y: 1, width: 2, depth: 2, shape: "rect", seats: 4, chairs_visible: 4, confidence: 1, is_joined_group: false, label: "T1" };
  assert.equal(floorPlanDraftSchema.safeParse({ ...plan, tables: [table, table] }).success, false);
  assert.equal(floorPlanDraftSchema.safeParse({ ...plan, tables: [{ ...table, seats: 999999 }] }).success, false);
});
