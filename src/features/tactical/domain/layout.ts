import type { Layout, LayoutObject, ObjectKind, Room } from "./schemas.ts";

export const furniture = {
  chair: { label: "Chair", width: 0.5, depth: 0.5, seats: 1 },
  wall: { label: "Wall", width: 2, depth: 0.2, seats: 0 },
  window: { label: "Window", width: 1.5, depth: 0.2, seats: 0 },
  light: { label: "Lighting", width: 0.35, depth: 0.35, seats: 0 },
  decoration: { label: "Decoration", width: 0.5, depth: 0.5, seats: 0 },
  ac: { label: "AC unit", width: 1, depth: 0.35, seats: 0 },
  custom: { label: "Custom object", width: 1, depth: 1, seats: 0 },
  table_2: { label: "Table for 2", width: 1.4, depth: 0.9, seats: 2 },
  table_4: { label: "Table for 4", width: 1.7, depth: 1.7, seats: 4 },
  booth: { label: "Booth", width: 2, depth: 1.35, seats: 4 },
  counter: { label: "Counter", width: 2.4, depth: 1.1, seats: 3 },
  cashier_stand: { label: "Cashier stand", width: 1.15, depth: 0.65, seats: 0 },
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
    seats: layout.objects.reduce((seats, object) => seats + (object.seatOwnerId ? 0 : object.seats ?? 0), 0),
    tables: layout.objects.filter(({ type }) => type === "table_2" || type === "table_4" || type === "booth").length,
  };
}

/** Shortest Euclidean gap between the rotated, axis-aligned footprint edges. */
export function footprintGap(a: LayoutObject, b: LayoutObject) {
  const first = footprint(a), second = footprint(b);
  return Math.hypot(
    Math.max(0, a.x - b.x - second.width, b.x - a.x - first.width),
    Math.max(0, a.y - b.y - second.depth, b.y - a.y - first.depth),
  );
}

export function objectClearance(layout: Layout, object: LayoutObject) {
  const size = footprint(object);
  const neighbors = layout.objects.filter(item => item.id !== object.id)
    .map(item => ({ id: item.id, gap: footprintGap(object, item) }))
    .sort((a, b) => a.gap - b.gap || a.id.localeCompare(b.id));
  return {
    wallGap: Math.max(0, Math.min(object.x, object.y, layout.room.width - object.x - size.width, layout.room.depth - object.y - size.depth)),
    nearest: neighbors[0] ?? null,
  };
}

/** A bounded grid search for a single move, not a layout optimizer or route planner. */
export function suggestClearPosition(layout: Layout, id: string): LayoutObject | null {
  const object = layout.objects.find(item => item.id === id);
  if (!object) return null;
  const size = footprint(object);
  const obstacles = layout.objects.filter(item => item.id !== id);
  let best: LayoutObject | null = null;
  let distance = Infinity;
  for (let y = 0; y <= layout.room.depth - size.depth + 1e-8; y += gridStep) {
    for (let x = 0; x <= layout.room.width - size.width + 1e-8; x += gridStep) {
      const candidateDistance = Math.hypot(x - object.x, y - object.y);
      if (candidateDistance >= distance || candidateDistance < 1e-8) continue;
      const candidate = { ...object, x: roundLength(x), y: roundLength(y) };
      if (obstacles.every(other => !hasOverlap(candidate, other))) {
        best = candidate; distance = candidateDistance;
      }
    }
  }
  return best;
}
