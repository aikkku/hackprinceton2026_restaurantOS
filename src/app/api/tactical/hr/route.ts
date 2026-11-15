import { createHrHandler, hrMongoStore } from "../../../../features/tactical/backend/hr-service";
import { loadDataset } from "../../../../features/tactical/backend/load-dataset";
export const runtime = "nodejs";
export const maxDuration = 90;
const handle = createHrHandler({ load: async () => (await loadDataset()).dataset, store: process.env.TACTICAL_DATA_SOURCE === "mongodb" ? hrMongoStore : undefined });
export const GET = handle;
export const POST = handle;
