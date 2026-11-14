import { z } from "zod";
import { layoutSchema, scenarioSchema } from "../domain/schemas.ts";

export const savedScenariosSchema = z.array(scenarioSchema);

export function readSaved<T>(key: string, schema: z.ZodType<T>): { value: T | null; issue: boolean } {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return { value: null, issue: false };
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? { value: parsed.data, issue: false } : { value: null, issue: true };
  } catch {
    return { value: null, issue: true };
  }
}

export function loadDemoStorage(restaurantId: string) {
  const layoutKey = `restaurant-os:tactical:${restaurantId}:layout:v1`;
  const scenariosKey = `restaurant-os:tactical:${restaurantId}:scenarios:v1`;
  const layout = readSaved(layoutKey, layoutSchema.refine((saved) => saved.restaurantId === restaurantId));
  const scenarios = readSaved(scenariosKey, savedScenariosSchema.refine((items) => items.every((item) => item.layout.restaurantId === restaurantId)));
  return { layoutKey, scenariosKey, layout, scenarios };
}

let fallbackId = 0;

export function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${++fallbackId}`;
}
