import example from "../../../../../docs/expansion/examples/restaurant-intake.sample.json" with { type: "json" };
import { parseIntake } from "../../domain/intake.ts";

/**
 * The fictional Cedar Kitchen example intake.
 *
 * Single canonical source: docs/expansion/examples/restaurant-intake.sample.json.
 * Every load is schema-validated; callers receive a clone so the frozen
 * example is never mutated. The profile is explicitly fictional — no real
 * restaurant, financial records, or property sources were used.
 */
const EXAMPLE_INTAKE = parseIntake(example);

export function exampleIntake() {
  return structuredClone(EXAMPLE_INTAKE);
}
