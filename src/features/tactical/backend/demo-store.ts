import demo from "../frontend/data/demo-restaurant.json" with { type: "json" };
import { datasetSchema } from "../domain/dataset.ts";
import type { DatasetRecord } from "./mongodb.ts";
// Local demo writes intentionally last only for this server process; MongoDB is durable.
const state = globalThis as typeof globalThis & { tacticalDemoRecord?: DatasetRecord };
export function demoRecord(): DatasetRecord {
  return structuredClone(state.tacticalDemoRecord ??= { _id: demo.profile.id, revision: 1, updatedAt: new Date().toISOString(), dataset: datasetSchema.parse(demo) });
}
export function saveDemoRecord(record: DatasetRecord, expected: number) {
  if (demoRecord().revision !== expected) return false;
  state.tacticalDemoRecord = structuredClone(record); return true;
}
