import { createReviewAnalysisHandler } from "../../../../../features/tactical/backend/review-analysis";
import { loadDataset } from "../../../../../features/tactical/backend/load-dataset";
export const runtime = "nodejs";
export const maxDuration = 90;
const handle = createReviewAnalysisHandler({ load: async () => (await loadDataset()).dataset });
export const GET = handle;
export const POST = handle;
