import { createAiHandler } from "../../../../features/tactical/backend/ai-service";
import { loadDataset } from "../../../../features/tactical/backend/load-dataset";
export const runtime = "nodejs";
export const POST = createAiHandler({ load: async () => (await loadDataset()).dataset });
