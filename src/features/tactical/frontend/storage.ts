import { z } from "zod";
import { layoutSchema, scenarioSchema, type Scenario } from "../domain/schemas.ts";

import { isScenarioReproducible } from "../domain/scenario.ts";

export function recoverScenarios(value: unknown, restaurantId: string) {
  if (!Array.isArray(value)) return { value: [], issue: true } as { value: Scenario[]; issue: boolean };
  const valid: Scenario[] = [];
  const ids = new Set<string>();
  let issue = false;
  for (const item of value) {
    const parsed = scenarioSchema.safeParse(item);
    if (!parsed.success || parsed.data.layout.restaurantId !== restaurantId
      || !isScenarioReproducible(parsed.data) || ids.has(parsed.data.id)) {
      issue = true;
      continue;
    }
    valid.push(parsed.data);
    ids.add(parsed.data.id);
  }
  return { value: valid, issue };
}

export function readScenarios(key: string, restaurantId: string) {
  const stored = readSaved(key, z.unknown());
  if (stored.value === null) return { value: [], issue: stored.issue } as { value: Scenario[]; issue: boolean };
  return recoverScenarios(stored.value, restaurantId);
}

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
  const scenarios = readScenarios(scenariosKey, restaurantId);
  return { layoutKey, scenariosKey, layout, scenarios };
}

let fallbackId = 0;

export function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${++fallbackId}`;
}
