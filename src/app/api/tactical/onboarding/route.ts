import { createOnboardingHandler } from "../../../../features/tactical/backend/onboarding";
import { loadDataset } from "../../../../features/tactical/backend/load-dataset";

export const runtime = "nodejs";
export const POST = createOnboardingHandler(loadDataset);
