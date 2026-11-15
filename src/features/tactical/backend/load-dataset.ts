import { demoRecord } from "./demo-store";
import { restaurantIdSchema } from "../domain/dataset";
import { mongoDatasets } from "./mongodb";

export async function loadDataset() {
  const mode = process.env.TACTICAL_DATA_SOURCE ?? "demo";
  if (mode === "demo") return { dataset: demoRecord().dataset, source: "Local mock fixture", revision: null };
  if (mode !== "mongodb") throw new Error("Unknown dataset mode");
  const id = restaurantIdSchema.parse(process.env.TACTICAL_RESTAURANT_ID);
  const record = await mongoDatasets.read(id);
  if (!record) throw new Error("Dataset not found");
  return { dataset: record.dataset, source: "MongoDB · mock data", revision: record.revision };
}
