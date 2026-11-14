import type { Layout, LayoutObject, ObjectKind, Room } from "./schemas.ts";

export const furniture = {
  table_2: { label: "Table for 2", width: 1.4, depth: 0.9, seats: 2 },
  table_4: { label: "Table for 4", width: 1.7, depth: 1.7, seats: 4 },
  booth: { label: "Booth", width: 2, depth: 1.35, seats: 4 },
  counter: { label: "Counter", width: 2.4, depth: 1.1, seats: 3 },
  kitchen_zone: { label: "Kitchen zone", width: 3.1, depth: 2, seats: 0 },
  door: { label: "Door", width: 1.15, depth: 0.45, seats: 0 },
  divider: { label: "Divider", width: 1.6, depth: 0.28, seats: 0 },
  plant: { label: "Plant", width: 0.5, depth: 0.5, seats: 0 },
} satisfies Record<ObjectKind, { label: string; width: number; depth: number; seats: number }>;

const epsilon = 1e-8;
export const gridStep = 0.25;
const metersPerFoot = 0.3048;

export function displayLength(meters: number, unit: "m" | "ft") {
  return unit === "ft" ? meters / metersPerFoot : meters;
}

export function toMeters(length: number, unit: "m" | "ft") {
  return unit === "ft" ? length * metersPerFoot : length;
}

export function roundLength(length: number) {
  return Number(length.toFixed(4));
}

export function footprint(object: LayoutObject) {
  return object.rotation === 90 || object.rotation === 270
    ? { width: object.depth, depth: object.width }
    : { width: object.width, depth: object.depth };
}

export function fitsRoom(object: LayoutObject, room: Room) {
  const { width, depth } = footprint(object);
  return object.x >= -epsilon && object.y >= -epsilon
    && object.x + width <= room.width + epsilon
    && object.y + depth <= room.depth + epsilon;
}

export function positionObject(
  object: LayoutObject,
  room: Room,
  x: number,
  y: number,
  snap: boolean,
): LayoutObject {
  const { width, depth } = footprint(object);
  const align = (value: number) => roundLength(snap ? Math.round(value / gridStep) * gridStep : value);
  return {
    ...object,
    x: Math.max(0, Math.min(align(x), room.width - width)),
    y: Math.max(0, Math.min(align(y), room.depth - depth)),
  };
}

export function hasOverlap(a: LayoutObject, b: LayoutObject) {
  const first = footprint(a);
  const second = footprint(b);
  return a.x + first.width - b.x > epsilon && b.x + second.width - a.x > epsilon
    && a.y + first.depth - b.y > epsilon && b.y + second.depth - a.y > epsilon;
}

export function overlappingIds(objects: LayoutObject[]) {
  const ids = new Set<string>();
  for (const [index, object] of objects.entries()) {
    for (const other of objects.slice(index + 1)) {
      if (hasOverlap(object, other)) {
        ids.add(object.id);
        ids.add(other.id);
      }
    }
  }
  return ids;
}

export function layoutCounts(layout: Layout) {
  return {
    seats: layout.objects.reduce((seats, object) => seats + (object.seats ?? 0), 0),
    tables: layout.objects.filter(({ type }) => type === "table_2" || type === "table_4" || type === "booth").length,
  };
}
