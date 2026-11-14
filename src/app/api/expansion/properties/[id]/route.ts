import { getPropertyDetail } from "../../../../../features/expansion/backend/local-dataset.ts";
import { localFailure, localResponse } from "../../../../../features/expansion/backend/http.ts";
import { propertyDetailResponseSchema } from "../../../../../features/expansion/domain/local-data.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9:_-]{1,200}$/.test(id) || [...new URL(request.url).searchParams].length) return localResponse({error: {code: "invalid_query", message: "Provide a valid property or space identifier."}}, 400);
  try {
    const result = await getPropertyDetail(id);
    if (!result) return localResponse({error: {code: "not_found", message: "This record is absent or has no supported map location in this snapshot."}}, 404);
    const parsed = propertyDetailResponseSchema.safeParse(result);
    if (!parsed.success) return localFailure(new Error("Invalid normalized source"));
    return localResponse(parsed.data);
  } catch (error) { return localFailure(error); }
}
