import { getMarkets } from "../../../../features/expansion/backend/local-dataset.ts";
import { localFailure, localResponse } from "../../../../features/expansion/backend/http.ts";
import { marketsResponseSchema } from "../../../../features/expansion/domain/local-data.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if ([...new URL(request.url).searchParams].length) return localResponse({error: {code: "invalid_query", message: "The markets endpoint takes no query parameters."}}, 400);
  try {
    const result = await getMarkets();
    const parsed = marketsResponseSchema.safeParse(result);
    if (!parsed.success) return localFailure(new Error("Invalid normalized source"));
    return localResponse(parsed.data);
  } catch (error) {
    return localFailure(error);
  }
}
