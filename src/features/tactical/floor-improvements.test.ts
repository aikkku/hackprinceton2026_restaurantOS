import assert from "node:assert/strict";
import test from "node:test";
import { layoutSchema, type Layout, type LayoutObject } from "./domain/schemas.ts";
import { layoutCounts, objectClearance, footprintGap, suggestClearPosition, hasOverlap, fitsRoom } from "./domain/layout.ts";
import { initialLibrary } from "./domain/layout-library.ts";
import { applyObjectMeasurements } from "./frontend/layout-edit.ts";
import { parseLibraryBackup, writeLibrary, maxLibraryBytes } from "./frontend/layout-storage.ts";
import { floorOverlapIds, floorWarnings, modernFloor, resizeFurniture, resizeFromCorner } from "./domain/floor-editor.ts";

const table: LayoutObject = { id: "table", type: "table_2", seats: 2, x: 1, y: 1, width: 2, depth: 1, rotation: 0 };
const chair: LayoutObject = { id: "chair", type: "chair", seats: 1, x: 4, y: 1, width: .5, depth: .5, rotation: 0 };
const plan: Layout = { schemaVersion: 1, restaurantId: "juniper-table", name: "Current", unit: "m", room: { width: 8, depth: 6 }, objects: [table, chair], updatedAt: "2026-11-14T00:00:00.000Z" };

test("resizing preserves the existing seat count as a reference across incremental edits", () => {
  const wider = resizeFurniture(plan, table, 2.4, 1);
  assert.equal(wider.seats, 2);
  const expanded = resizeFurniture(plan, wider, 2.6, 1);
  assert.equal(expanded.seats, 4);
  assert.equal(resizeFurniture(plan, expanded, 2, 1).seats, 2);
  const rotated = resizeFromCorner(plan, { ...table, rotation: 90 }, 1, 2.6);
  assert.equal(rotated.seats, 4);
  assert.equal(rotated.width, 2.6);
  assert.equal(rotated.depth, 1);
  assert.equal(resizeFromCorner(plan, table, 99, 99).width, 7);
  assert.equal(resizeFurniture(plan, chair, 2, 2).seats, 1);
});

test("placement warnings identify overlapping and nearby objects by name", () => {
  assert.equal(floorOverlapIds([table, { ...chair, x: 3.1 }]).size, 0);
  assert.deepEqual([...floorOverlapIds([table, { ...chair, x: 2.9 }])].sort(), [table.id, chair.id].sort());
  assert.equal(floorOverlapIds([table, { ...chair, x: 2.9, seatOwnerId: table.id }]).size, 0);
  const near = floorWarnings([table, { ...chair, x: 3.1 }]);
  assert.match(near.get(table.id)![0], /0.10 m from Chair/);
  const overlapping = floorWarnings([table, { ...chair, x: 2.9 }]);
  assert.match(overlapping.get(chair.id)![0], /Overlaps Table for 2/);
  assert.equal(floorWarnings([table, chair]).size, 0);
  assert.equal(floorWarnings([table, { ...chair, x: 2.9, seatOwnerId: table.id }]).size, 0);
});

test("legacy floor plans lose kitchen zones and gain a cashier stand when its location is clear", () => {
  const legacy = { ...plan, room: { width: 12, depth: 7.5 }, objects: [...plan.objects, { id: "kitchen", type: "kitchen_zone" as const, x: .4, y: .45, width: 3.65, depth: 2.45, rotation: 0 as const }] };
  const migrated = modernFloor(legacy);
  assert.equal(migrated.objects.some(object => object.type === "kitchen_zone"), false);
  assert.equal(migrated.objects.some(object => object.type === "cashier_stand"), true);
  assert.strictEqual(modernFloor(migrated), migrated);
});

test("legacy seats remain unchanged; assigned chairs count only in their seating group", () => {
  assert.equal(layoutCounts(layoutSchema.parse(plan)).seats, 3);
  const edited = applyObjectMeasurements(plan, chair, { ...chair, seatOwnerId: table.id }, "m");
  const assigned = layoutSchema.parse({ ...plan, schemaVersion: 2, objects: [table, edited] });
  assert.equal(layoutCounts(assigned).seats, 2);
  const restored = parseLibraryBackup(JSON.stringify(initialLibrary(assigned)), plan.restaurantId);
  assert.equal(restored.entries[0].layout.objects[1].seatOwnerId, table.id);
  const unassigned = applyObjectMeasurements(assigned, edited, { ...edited, seatOwnerId: null }, "m");
  assert.equal(layoutCounts({ ...assigned, objects: [table, unassigned] }).seats, 3);
  assert.equal(chair.seatOwnerId, undefined);
});

test("seat ownership rejects v1 links, dangling owners, non-group owners and excess assigned capacity", () => {
  const linked = { ...chair, seatOwnerId: table.id };
  for (const candidate of [
    { ...plan, objects: [table, linked] },
    { ...plan, schemaVersion: 2, objects: [linked] },
    { ...plan, schemaVersion: 2, objects: [table, { ...linked, seatOwnerId: chair.id }] },
    { ...plan, schemaVersion: 2, objects: [table, { ...linked, seats: 3 }] },
    { ...plan, schemaVersion: 2, objects: [{ ...table, seatOwnerId: chair.id }, chair] },
  ]) assert.equal(layoutSchema.safeParse(candidate).success, false);
  const assigned = layoutSchema.parse({ ...plan, schemaVersion: 2, objects: [table, { ...linked, seats: 2 }] });
  assert.throws(() => applyObjectMeasurements(assigned, table, { ...table, seats: 1 }, "m"), /cannot exceed/);
});

test("gap measurements use rotated footprint edges and distinguish zero from no neighbors", () => {
  assert.equal(footprintGap(table, chair), 1);
  assert.equal(footprintGap({ ...table, rotation: 90 }, chair), 2);
  assert.equal(footprintGap(table, { ...chair, x: 3 }), 0);
  assert.equal(footprintGap(table, { ...chair, x: 2 }), 0);
  assert.equal(footprintGap(table, { ...chair, x: 4, y: 3 }), Math.SQRT2);
  assert.deepEqual(objectClearance(plan, table), { wallGap: 1, nearest: { id: "chair", gap: 1 } });
  assert.equal(objectClearance({ ...plan, objects: [table] }, table).nearest, null);
});

test("move proposals fit the room, avoid every footprint and never mutate the working layout", () => {
  const overlapping = { ...plan, objects: [table, { ...chair, x: 1, y: 1 }] };
  const before = JSON.stringify(overlapping);
  const candidate = suggestClearPosition(overlapping, chair.id)!;
  assert.ok(candidate);
  assert.ok(fitsRoom(candidate, plan.room));
  assert.equal(hasOverlap(candidate, table), false);
  assert.equal(JSON.stringify(overlapping), before);
  assert.equal(suggestClearPosition({ ...plan, room: { width: 1, depth: 1 }, objects: [{ ...table, x: 0, y: 0, width: 1, depth: 1 }, { ...chair, x: 0, y: 0 }] }, chair.id), null);
  assert.equal(suggestClearPosition(plan, "missing"), null);
});

class MemoryStore {
  values = new Map<string, string>();
  failKey: string | null = null;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (key === this.failKey) throw new Error("Quota exceeded"); this.values.set(key, value); }
}

test("library storage blocks stale tabs, validates restaurant ownership and preserves corrupt bytes on explicit recovery", () => {
  const store = new MemoryStore(), library = initialLibrary(plan);
  const raw = writeLibrary(store, "library", null, library, plan.restaurantId);
  assert.throws(() => writeLibrary(store, "library", null, library, plan.restaurantId), /Another tab/);
  assert.equal(store.getItem("library"), raw);
  assert.throws(() => parseLibraryBackup(raw, "other-restaurant"), /different restaurant/);
  store.setItem("library", "corrupt{");
  assert.throws(() => parseLibraryBackup("corrupt{", plan.restaurantId), /valid library JSON/);
  writeLibrary(store, "library", "corrupt{", library, plan.restaurantId, true);
  assert.equal(store.getItem("library:recovery"), "corrupt{");
  assert.deepEqual(parseLibraryBackup(store.getItem("library")!, plan.restaurantId), library);
});

test("failed library writes and oversized or invalid backups cannot replace existing work", () => {
  const store = new MemoryStore(), library = initialLibrary(plan), raw = JSON.stringify(library);
  store.setItem("library", raw);
  store.failKey = "library:recovery";
  assert.throws(() => writeLibrary(store, "library", raw, library, plan.restaurantId, true), /Quota/);
  assert.equal(store.getItem("library"), raw);
  store.failKey = "library";
  assert.throws(() => writeLibrary(store, "library", raw, { ...library, entries: [{ ...library.entries[0], layout: { ...plan, name: "Edited" } }] }, plan.restaurantId), /Quota/);
  assert.equal(store.getItem("library"), raw);
  assert.throws(() => parseLibraryBackup(" ".repeat(maxLibraryBytes + 1), plan.restaurantId), /4 MB/);
  assert.throws(() => parseLibraryBackup(JSON.stringify({ ...library, activeId: "missing" }), plan.restaurantId), /Invalid library/);
  assert.throws(() => parseLibraryBackup(JSON.stringify({ ...library, entries: Array.from({ length: 51 }, (_, i) => ({ id: String(i), layout: plan })) }), plan.restaurantId), /Invalid library/);
});
