import { displayLength, furniture, toMeters } from "../domain/layout.ts";
import { layoutSchema, type Layout, type LayoutObject } from "../domain/schemas.ts";

export type ObjectMeasurements = {
  name?: string;
  description?: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  rotation: number;
  seats?: number;
};

export function displayedMeasurement(value: number, unit: "m" | "ft") {
  const displayed = displayLength(value, unit);
  const rounded = Number(displayed.toFixed(4));
  return rounded === 0 && displayed !== 0 ? displayed : rounded;
}

export function applyObjectMeasurements(
  layout: Layout,
  selected: LayoutObject,
  measurements: ObjectMeasurements,
  unit: "m" | "ft",
): LayoutObject {
  const convert = (value: number, existing: number) => value === displayedMeasurement(existing, unit)
    ? existing
    : toMeters(value, unit);

  const updated = {
    ...selected,
    ...(measurements.name !== undefined ? { name: measurements.name } : {}),
    ...(measurements.description !== undefined ? { description: measurements.description } : {}),
    x: convert(measurements.x, selected.x),
    y: convert(measurements.y, selected.y),
    width: convert(measurements.width, selected.width),
    depth: convert(measurements.depth, selected.depth),
    rotation: measurements.rotation,
    seats: furniture[selected.type].seats > 0 ? measurements.seats : undefined,
  };
  const index = layout.objects.findIndex((object) => object.id === selected.id);
  if (index < 0) throw new Error("Select furniture from the current layout before editing.");

  const parsed = layoutSchema.safeParse({
    ...layout,
    objects: layout.objects.map((object) => object.id === selected.id ? updated : object),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }
  return parsed.data.objects[index];
}
