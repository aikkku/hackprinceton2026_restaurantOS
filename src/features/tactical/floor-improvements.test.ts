import assert from "node:assert/strict";
import test from "node:test";
import { layoutSchema, type Layout, type LayoutObject } from "./domain/schemas.ts";
import { layoutCounts, objectClearance, footprintGap, suggestClearPosition, hasOverlap, fitsRoom } from "./domain/layout.ts";
import { initialLibrary } from "./domain/layout-library.ts";
import { applyObjectMeasurements } from "./frontend/layout-edit.ts";
import { parseLibraryBackup, writeLibrary, maxLibraryBytes } from "./frontend/layout-storage.ts";

const table: LayoutObject = { id: "table", type: "table_2", seats: 2, x: 1, y: 1, width: 2, depth: 1, rotation: 0 };
const chair: LayoutObject = { id: "chair", type: "chair", seats: 1, x: 4, y: 1, width: .5, depth: .5, rotation: 0 };
const plan: Layout = { schemaVersion: 1, restaurantId: "juniper-table", name: "Current", unit: "m", room: { width: 8, depth: 6 }, objects: [table, chair], updatedAt: "2026-11-14T00:00:00.000Z" };

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
