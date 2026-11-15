import { handleDatasetRequest } from "../../../../features/tactical/backend/data-api";
export const runtime = "nodejs";
export async function GET(request: Request) { return handleDatasetRequest(request); }
