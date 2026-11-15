import { fitsRoom, footprint, furniture, footprintGap, hasOverlap, positionObject, roundLength } from "./layout.ts";
import type { Layout, LayoutObject } from "./schemas.ts";
import { layoutLibrarySchema, type LayoutLibrary } from "./layout-library.ts";

export function modernFloor(layout: Layout): Layout {
  if (!layout.objects.some(object => object.type === "kitchen_zone")) return layout;
  const objects = layout.objects.filter(object => object.type !== "kitchen_zone");
  const cashier: LayoutObject = { id: "cashier", type: "cashier_stand", x: 1.35, y: 5.65, rotation: 0, width: furniture.cashier_stand.width, depth: furniture.cashier_stand.depth };
  if (layout.restaurantId === "juniper-table" && layout.objects.some(object => object.id === "kitchen" && object.type === "kitchen_zone")
    && !objects.some(object => object.id === cashier.id || object.type === "cashier_stand" || hasOverlap(object, cashier))
    && fitsRoom(cashier, layout.room)) objects.push(cashier);
  return { ...layout, objects };
}

export function modernFloorLibrary(library: LayoutLibrary): LayoutLibrary {
  return { ...library, entries: library.entries.map(entry => ({ ...entry, layout: modernFloor(entry.layout) })) };
}

export function sameFloor(a: Layout, b: Layout) {
  if (a.name !== b.name || a.room.width !== b.room.width || a.room.depth !== b.room.depth) return false;
  const furnitureState = (layout: Layout) => JSON.stringify(layout.objects.map(object =>
    Object.entries(object).filter(([, value]) => value !== undefined).sort(([key], [other]) => key.localeCompare(other))));
  return furnitureState(a) === furnitureState(b);
}

/** Keep browser versions accessible when opening a database-backed workspace. */
export function mergeFloorVersions(saved: LayoutLibrary, browser: LayoutLibrary): LayoutLibrary {
  const entries = [...saved.entries];
  let activeId = saved.activeId;
  for (const entry of browser.entries) {
    const existing = entries.find(saved => saved.id === entry.id);
    const id = existing && !sameFloor(existing.layout, entry.layout) ? `browser-${entry.id}` : entry.id;
    const known = entries.some(saved => saved.id === id);
    if (!known && entries.length < 50) {
      entries.push({ ...entry, id });
      if (entry.id === browser.activeId) activeId = id;
    }
  }
  return layoutLibrarySchema.parse({ ...saved, entries, activeId });
}

export function resizeFurniture(layout: Layout, object: LayoutObject, width: number, depth: number): LayoutObject {
  const resized = { ...object, width, depth };
  if (!object.seats || object.type === "chair" || (width === object.width && depth === object.depth)) return resized;
  const reference = object.seatSizing ?? { width: object.width, depth: object.depth, seats: object.seats };
  const step = object.type === "counter" ? .65 : .6;
  const steps = (length: number, base: number) => Math.trunc((roundLength(length - base) + Math.sign(length - base) * 1e-8) / step);
  const perRow = object.type === "counter" ? 1 : 2;
  const extraDepth = object.type === "table_4" ? steps(depth, reference.depth) * 2 : 0;
  const assigned = layout.objects.filter(item => item.seatOwnerId === object.id).reduce((sum, chair) => sum + (chair.seats ?? 0), 0);
  return { ...resized, seatSizing: reference, seats: Math.min(100, Math.max(1, assigned, reference.seats + steps(width, reference.width) * perRow + extraDepth)) };
}

export function resizeFromCorner(layout: Layout, object: LayoutObject, worldWidth: number, worldDepth: number) {
  const rotated = object.rotation === 90 || object.rotation === 270;
  const fittedWidth = Math.min(layout.room.width - object.x, Math.max(.25, roundLength(worldWidth)));
  const fittedDepth = Math.min(layout.room.depth - object.y, Math.max(.25, roundLength(worldDepth)));
  return resizeFurniture(layout, object, rotated ? fittedDepth : fittedWidth, rotated ? fittedWidth : fittedDepth);
}

export function clearFloorPosition(layout: Layout, object: LayoutObject) {
  const size = footprint(object);
  if (!fitsRoom({ ...object, x: 0, y: 0 }, layout.room)) return;
  const xs = new Set([0, layout.room.width - size.width]);
  const ys = new Set([0, layout.room.depth - size.depth]);
  for (const other of layout.objects) {
    const bounds = footprint(other);
    xs.add(other.x + bounds.width + .08);
    ys.add(other.y + bounds.depth + .08);
  }
  for (const y of [...ys].sort((a, b) => a - b)) for (const x of [...xs].sort((a, b) => a - b)) {
    const candidate = positionObject(object, layout.room, x, y, false);
    if (layout.objects.every(other => !hasOverlap(other, candidate))) return candidate;
  }
}

export function floorWarnings(objects: LayoutObject[]) {
  const warnings = new Map<string, string[]>();
  const label = (object: LayoutObject) => object.name ?? furniture[object.type].label;
  function add(id: string, warning: string) {
    warnings.set(id, [...(warnings.get(id) ?? []), warning]);
  }
  for (const [index, object] of objects.entries()) for (const other of objects.slice(index + 1)) {
    if (object.seatOwnerId === other.id || other.seatOwnerId === object.id) continue;
    const gap = footprintGap(object, other);
    const overlap = hasOverlap(object, other);
    const doorway = object.type === "door" || other.type === "door";
    if (!overlap && !(gap < (doorway ? .6 : .3))) continue;
    add(object.id, overlap ? `Overlaps ${label(other)}` : `${gap.toFixed(2)} m from ${label(other)}${doorway ? " near the doorway" : ""}`);
    add(other.id, overlap ? `Overlaps ${label(object)}` : `${gap.toFixed(2)} m from ${label(object)}${doorway ? " near the doorway" : ""}`);
  }
  return warnings;
}

// Assigned chairs intentionally share their owner's footprint. Other collisions are errors.
export function floorOverlapIds(objects: LayoutObject[]) {
  const ids = new Set<string>();
  for (const [index, object] of objects.entries()) for (const other of objects.slice(index + 1)) {
    if (object.seatOwnerId === other.id || other.seatOwnerId === object.id) continue;
    if (hasOverlap(object, other)) { ids.add(object.id); ids.add(other.id); }
  }
  return ids;
}
