import { handleDatasetRequest } from "../../../../../../features/tactical/backend/data-api";
export const runtime = "nodejs";
type Context = { params: Promise<{ restaurantId: string }> };
export async function GET(request: Request, context: Context) { return handleDatasetRequest(request, (await context.params).restaurantId); }
export async function PUT(request: Request, context: Context) { return handleDatasetRequest(request, (await context.params).restaurantId); }
