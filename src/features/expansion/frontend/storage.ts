import { calculateScenario } from "../domain/scenario.ts";
import { savedScenariosSchema, type Scenario } from "../domain/schemas.ts";

export const STORAGE_KEY = "restaurantos.expansion.demo.scenarios.v1";

export function decodeScenarios(raw: string | null): Scenario[] {
  if (raw === null) return [];
  const scenarios = savedScenariosSchema.parse(JSON.parse(raw));
  if (new Set(scenarios.map((x) => x.id)).size !== scenarios.length)
    throw new Error("Duplicate saved scenario IDs");
  for (const scenario of scenarios) {
    const expected = calculateScenario(scenario.inputs);
    for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
      if (expected[key] !== scenario.results[key])
        throw new Error("Saved results do not match their inputs");
    }
  }
  return scenarios;
}

export function persistScenarios(
  storage: Pick<Storage, "setItem">,
  scenarios: Scenario[],
) {
  const validated = decodeScenarios(JSON.stringify(scenarios));
  storage.setItem(STORAGE_KEY, JSON.stringify(validated));
}
