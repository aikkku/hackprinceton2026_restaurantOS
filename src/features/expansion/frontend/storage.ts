import { calculateScenario } from "../domain/scenario.ts";
import { savedScenariosSchema, type Scenario } from "../domain/schemas.ts";

export const STORAGE_KEY = "restaurantos.expansion.demo.scenarios.v1";
export const LOCAL_STORAGE_KEY = "restaurantos.expansion.local.scenarios.v2";
export const MODE_STORAGE_KEY = "restaurantos.expansion.mode";

export const storageKeyFor = (mode: "demo" | "local") =>
  mode === "local" ? LOCAL_STORAGE_KEY : STORAGE_KEY;

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
  mode: "demo" | "local" = "demo",
) {
  const validated = decodeScenarios(JSON.stringify(scenarios));
  if (validated.some((scenario) => scenario.isDemo !== (mode === "demo")))
    throw new Error("Snapshot data mode does not match its storage key");
  storage.setItem(storageKeyFor(mode), JSON.stringify(validated));
}
