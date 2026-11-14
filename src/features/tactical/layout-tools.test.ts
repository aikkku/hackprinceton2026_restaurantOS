import assert from "node:assert/strict";
import test from "node:test";
import { applyObjectMeasurements, displayedMeasurement } from "./frontend/layout-edit.ts";
import { maxLayoutFileBytes, parseLayoutFile, readLayoutFile } from "./frontend/layout-transfer.ts";
import type { Layout, LayoutObject } from "./domain/schemas.ts";

const object: LayoutObject = { id: "table", type: "table_2", x: 1.2345678, y: 1, width: 1.4, depth: 0.9, rotation: 0, seats: 2 };
const layout: Layout = { schemaVersion: 1, restaurantId: "demo", name: "Demo", unit: "m", room: { width: 12, depth: 8 }, objects: [object], updatedAt: "2026-11-14T00:00:00.000Z" };

test("applying unchanged rounded feet values preserves precise furniture geometry", () => {
  const measurements = {
    x: displayedMeasurement(object.x, "ft"), y: displayedMeasurement(object.y, "ft"),
    width: displayedMeasurement(object.width, "ft"), depth: displayedMeasurement(object.depth, "ft"),
    rotation: object.rotation, seats: object.seats,
  };
  assert.deepEqual(applyObjectMeasurements(layout, object, measurements, "ft"), object);
});

test("editing furniture validates rotated bounds and seating counts", () => {
  assert.throws(() => applyObjectMeasurements(layout, object, { ...object, x: 11, rotation: 90, depth: 2 }, "m"), /fit inside/);
  assert.throws(() => applyObjectMeasurements(layout, object, { ...object, seats: 2.5 }, "m"));
  assert.throws(() => applyObjectMeasurements(layout, object, { ...object, width: Infinity }, "m"));
  const updated = applyObjectMeasurements(layout, object, { ...object, width: 2, seats: 3 }, "m");
  assert.equal(updated.width, 2);
  assert.equal(updated.seats, 3);
  assert.equal(layout.objects[0].width, 1.4);
});

test("layout JSON preserves the saved plan and rejects incompatible or invalid files", () => {
  assert.deepEqual(parseLayoutFile(JSON.stringify(layout), "demo"), layout);
  assert.throws(() => parseLayoutFile("{", "demo"), /valid layout JSON/);
  assert.throws(() => parseLayoutFile(JSON.stringify(layout), "another"), /different restaurant/);
  assert.throws(() => parseLayoutFile(JSON.stringify({ ...layout, schemaVersion: 2 }), "demo"), /could not be loaded/);
  assert.throws(() => parseLayoutFile(JSON.stringify({ ...layout, objects: [object, object] }), "demo"), /unique/);
});

test("oversized layout files are rejected before reading their contents", async () => {
  let read = false;
  await assert.rejects(readLayoutFile({
    size: maxLayoutFileBytes + 1,
    text: async () => { read = true; return JSON.stringify(layout); },
  }, "demo"), /smaller than 1 MB/);
  assert.equal(read, false);
});
