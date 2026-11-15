import { handleDatasetRequest } from "../../../../../features/tactical/backend/data-api";
export const runtime = "nodejs";
export async function POST(request: Request) { return handleDatasetRequest(request, undefined, true); }
